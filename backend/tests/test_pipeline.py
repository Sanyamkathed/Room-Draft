"""
Pipeline tests: the calibration contract, object placement, and the API.

None of these load a model. Depth and detection are substituted with exact
synthetic data, which makes the tests fast, deterministic, and runnable on a
machine with no checkpoints -- and means a failure points at this code rather
than at a checkpoint that shifted under it.
"""

from __future__ import annotations

import numpy as np
import pytest

from app.pipeline import analyze as A
from app.pipeline import depth as depth_mod
from app.pipeline import detect as detect_mod
from app.pipeline.geometry import intrinsics, ray_grid, solve_scene
from app.pipeline.planes import calibration_from_room, extract_room, surface_quads

from test_geometry import render, scramble

CAMH = 1.45
TRUE = dict(ceiling=2.60, back=3.80, left=-1.70, right=1.90)


@pytest.fixture(scope="module")
def solved():
    """A fully solved synthetic room, shared by the tests below."""
    rays, z, label, _ = render(camera_height=CAMH, pitch_deg=6.0, **TRUE)
    disp = scramble(z, 3.7, -0.42)
    h, w = disp.shape
    K = intrinsics(w, h, 62.0)
    solve = solve_scene(disp, rays, CAMH, rng=np.random.default_rng(3))
    sol = extract_room(solve, disp, rays, K, CAMH, rng=np.random.default_rng(11))
    return solve, sol, K, disp, rays, z, label


# --------------------------------------------------------------------------
# The calibration contract
# --------------------------------------------------------------------------


def frontend_reconstruct(cal: dict, img_w: int, img_h: int) -> dict:
    """
    A faithful port of reconstructRoom in lib/room/reconstruct.ts.

    The service does not send the app a finished room; it sends the four
    corners the app's own solver consumes. That is only worth anything if
    feeding them back reproduces what the service measured, so the check has
    to run the app's arithmetic rather than the service's.
    """
    f = img_w / 2 / np.tan(np.radians(cal["fovDeg"]) / 2)
    cx = cal["vanishingPoint"][0] * img_w
    cy = cal["vanishingPoint"][1] * img_h
    q = cal["backWall"]

    u_left = min(q["tl"][0], q["bl"][0]) * img_w
    u_right = max(q["tr"][0], q["br"][0]) * img_w
    v_top = min(q["tl"][1], q["tr"][1]) * img_h
    v_bottom = max(q["bl"][1], q["br"][1]) * img_h

    base_below = max(v_bottom - cy, img_h * 0.02)
    d = np.clip(cal["cameraHeight"] * f / base_below, 0.8, 16)
    width = np.clip((u_right - u_left) * d / f, 1.6, 12)
    height = np.clip(cal["cameraHeight"] + max((cy - v_top) * d / f, 0.15), 2.0, 4.6)
    depth = np.clip(d + cal["frontExtension"], 1.6, 14)
    return {"width": width, "height": height, "depth": depth, "backWallDistance": d}


def test_calibration_round_trips_through_the_frontend_solver(solved):
    _, sol, _, disp, *_ = solved
    h, w = disp.shape
    cal = calibration_from_room(sol, 62.0, CAMH, 1.2)

    got = frontend_reconstruct(cal, w, h)

    assert got["backWallDistance"] == pytest.approx(sol.frame.back_wall_distance, rel=1e-6)
    assert got["width"] == pytest.approx(sol.frame.width, rel=1e-6)
    assert got["height"] == pytest.approx(sol.frame.height, rel=1e-6)
    assert got["depth"] == pytest.approx(sol.frame.depth, rel=1e-6)


def test_calibration_vanishing_point_tracks_the_pitch():
    """Tilt the camera down and the horizon must rise in the frame."""
    seen = []
    for pitch in (-6.0, 0.0, 10.0):
        rays, z, _, _ = render(camera_height=CAMH, pitch_deg=pitch, **TRUE)
        disp = scramble(z, 3.7, -0.42)
        hh, ww = disp.shape
        K = intrinsics(ww, hh, 62.0)
        solve = solve_scene(disp, rays, CAMH, rng=np.random.default_rng(3))
        sol = extract_room(solve, disp, rays, K, CAMH, rng=np.random.default_rng(11))
        seen.append(calibration_from_room(sol, 62.0, CAMH, 1.2)["vanishingPoint"][1])

    assert seen[0] > seen[1] > seen[2], f"horizon did not move monotonically: {seen}"
    assert seen[1] == pytest.approx(0.5, abs=0.06), "a level camera puts it at the centre"


def test_room_frame_faces_the_camera(solved):
    """
    Room +Z must point back at the photographer, not into the back wall.
    Getting this backwards still produces plausible dimensions -- they are
    read off absolute offsets -- while reporting 180 degrees of roll and
    every surface behind the camera.
    """
    _, sol, *_ = solved
    assert abs(sol.projector.roll_deg()) < 2.0
    assert sol.projector.horizon()[1] < sol.projector.height


def test_surface_quads_are_projectable(solved):
    _, sol, *_ = solved
    quads = surface_quads(sol)
    assert set(quads) == {"floor", "ceiling", "back", "front", "left", "right"}
    assert quads["back"]["visible"], "the wall the camera is pointed at must project"
    assert quads["back"]["framed"] > 0.0
    # The wall behind the photographer is behind the camera by definition.
    assert not quads["front"]["visible"]


# --------------------------------------------------------------------------
# Placement
# --------------------------------------------------------------------------


def place_one(solved, label: str, box: tuple[float, float, float, float]):
    _, sol, K, *_ = solved
    det = detect_mod.Detection(
        label=label, confidence=0.9, box=box, info=detect_mod.COCO_MAP[label]
    )
    return A._place(det, sol, A.Options(camera_height=CAMH, fov_deg=62.0), K)


def test_floor_objects_land_on_the_floor(solved):
    out = place_one(solved, "bed", (0.30, 0.55, 0.72, 0.88))
    assert out is not None
    assert out["position"][1] == 0.0, "a bed rests on the floor, exactly"
    assert out["mount"] == "floor"
    assert out["productId"] == "fn-bed-double"
    assert out["furniture"] is True


def test_placed_objects_stay_inside_the_room(solved):
    _, sol, *_ = solved
    w, d = sol.frame.width, sol.frame.depth
    # A detection clipped hard against the frame edge.
    out = place_one(solved, "chair", (0.0, 0.60, 0.22, 0.95))
    assert out is not None
    x, _, z = out["position"]
    half_w = out["sizeCm"]["w"] / 200.0
    half_d = out["sizeCm"]["d"] / 200.0
    assert -w / 2 <= x - half_w + 1e-6 and x + half_w <= w / 2 + 1e-6
    assert -d / 2 <= z - half_d + 1e-6 and z + half_d <= d / 2 + 1e-6


def test_depth_is_always_flagged_as_a_prior(solved):
    """One view cannot see how deep a bed is. Saying so is part of the API."""
    out = place_one(solved, "bed", (0.30, 0.55, 0.72, 0.88))
    assert out["depthFromPrior"] is True
    assert out["sizeCm"]["d"] == pytest.approx(
        detect_mod.COCO_MAP["bed"].depth_m * 100, rel=1e-6
    )


def test_side_wall_objects_swap_width_and_depth(solved):
    """Seen side-on, the box measures length; the prior supplies width."""
    _, sol, *_ = solved
    out = place_one(solved, "bed", (0.0, 0.58, 0.30, 0.95))
    if out is not None and out["againstWall"] in ("left", "right"):
        assert out["sizeCm"]["w"] == pytest.approx(
            detect_mod.COCO_MAP["bed"].depth_m * 100, rel=1e-6
        )


def test_yaw_matches_the_apps_wall_convention():
    """Mirrors againstWall() in lib/room/wallPlacement.ts."""
    w, d = 3.6, 5.0
    assert A._yaw_for_wall(0.0, -d / 2 + 0.2, w, d) == (0.0, "back")
    assert A._yaw_for_wall(0.0, d / 2 - 0.2, w, d)[1] == "front"
    assert A._yaw_for_wall(-w / 2 + 0.2, 0.0, w, d) == (pytest.approx(np.pi / 2), "left")
    assert A._yaw_for_wall(w / 2 - 0.2, 0.0, w, d) == (pytest.approx(-np.pi / 2), "right")
    # Out in the middle of the room, nothing to align to.
    assert A._yaw_for_wall(0.0, 0.0, w, d) == (0.0, None)


def test_unmapped_classes_are_not_placed(solved):
    _, sol, K, *_ = solved
    det = detect_mod.Detection(label="person", confidence=0.9, box=(0.4, 0.4, 0.6, 0.9))
    assert A._place(det, sol, A.Options(), K) is None


# --------------------------------------------------------------------------
# End to end, with the models stubbed out
# --------------------------------------------------------------------------


@pytest.fixture
def stub_models(monkeypatch):
    """Exact synthetic depth in place of a checkpoint."""
    rays, z, _, _ = render(camera_height=CAMH, pitch_deg=6.0, **TRUE)
    disp = scramble(z, 3.7, -0.42).astype(np.float32)

    def fake_depth(rgb):
        h, w = rgb.shape[:2]
        assert (h, w) == disp.shape, "test image must match the rendered room"
        return depth_mod.DepthResult(disparity=disp, model="stub", native_size=(h, w))

    monkeypatch.setattr(depth_mod, "estimate", fake_depth)
    monkeypatch.setattr(
        detect_mod, "detect",
        lambda rgb, conf=None: detect_mod.DetectResult(
            detections=[
                detect_mod.Detection("bed", 0.88, (0.30, 0.55, 0.72, 0.88),
                                     detect_mod.COCO_MAP["bed"]),
                detect_mod.Detection("person", 0.71, (0.05, 0.40, 0.18, 0.90)),
            ],
            model="stub-yolo",
            occluder_mask=np.zeros(disp.shape, dtype=bool),
        ),
    )
    return disp.shape


def test_analyze_produces_a_complete_response(stub_models):
    from app.schemas import AnalyzeResponse

    h, w = stub_models
    rgb = np.random.default_rng(0).integers(60, 200, (h, w, 3), dtype=np.uint8)
    body = A.analyze(rgb, A.Options(camera_height=CAMH, fov_deg=62.0)).body

    # Validates every field, type and range in one go.
    parsed = AnalyzeResponse(**body)

    assert parsed.dimensions.width == pytest.approx(TRUE["right"] - TRUE["left"], abs=0.25)
    assert parsed.dimensions.height == pytest.approx(TRUE["ceiling"], abs=0.25)
    assert parsed.dimensions.backWallDistance == pytest.approx(TRUE["back"], abs=0.25)
    assert parsed.quality.method == "manhattan"
    assert parsed.quality.confidence > 0.6

    assert [o.label for o in parsed.objects] == ["bed"]
    assert [u.label for u in parsed.unplaced] == ["person"]
    assert set(parsed.timings) >= {"detect", "depth", "geometry", "assemble", "total"}


def test_analyze_survives_a_missing_detector(stub_models, monkeypatch):
    """Detection is optional; geometry is not."""
    def boom(rgb, conf=None):
        raise detect_mod.ModelUnavailable("ultralytics is not installed")

    monkeypatch.setattr(detect_mod, "detect", boom)
    h, w = stub_models
    rgb = np.random.default_rng(0).integers(60, 200, (h, w, 3), dtype=np.uint8)
    body = A.analyze(rgb, A.Options(camera_height=CAMH, fov_deg=62.0)).body

    assert body["ok"] and body["objects"] == []
    assert any("ultralytics" in warning for warning in body["quality"]["warnings"])


# --------------------------------------------------------------------------
# HTTP
# --------------------------------------------------------------------------


@pytest.fixture
def client():
    from fastapi.testclient import TestClient
    from app.main import app

    return TestClient(app)


def test_health_never_loads_a_model(client):
    body = client.get("/health").json()
    assert body["ok"] and body["device"] in ("cpu", "cuda")


def test_undecodable_upload_is_rejected(client):
    r = client.post("/analyze", files={"image": ("x.png", b"nonsense", "image/png")})
    assert r.status_code == 415


def test_empty_upload_is_rejected(client):
    r = client.post("/analyze", files={"image": ("x.png", b"", "image/png")})
    assert r.status_code == 422


def test_missing_depth_model_is_a_503_not_a_500(client, monkeypatch):
    import cv2

    def boom(rgb):
        raise depth_mod.ModelUnavailable("no checkpoint")

    monkeypatch.setattr(depth_mod, "estimate", boom)
    monkeypatch.setattr(
        detect_mod, "detect",
        lambda rgb, conf=None: detect_mod.DetectResult(occluder_mask=np.zeros(rgb.shape[:2], bool)),
    )
    png = cv2.imencode(".png", np.zeros((240, 320, 3), np.uint8))[1].tobytes()
    r = client.post("/analyze", files={"image": ("r.png", png, "image/png")})
    assert r.status_code == 503
    assert "depth model unavailable" in r.json()["detail"]
