"""
Geometry tests against synthetic rooms with known ground truth.

These render a box room by ray-tracing, scramble the depth exactly the way a
relative-depth model does (an unknown affine transform of inverse depth), and
then check that the solver recovers the scramble and the room. Ground truth
is known to the millimetre, which is the only way to tell a plausible-looking
reconstruction from a correct one.
"""

from __future__ import annotations

import numpy as np
import pytest

from app.pipeline import geometry as G

W, H = 288, 216
FOV = 62.0


def render(
    camera_height: float = 1.45,
    pitch_deg: float = 0.0,
    roll_deg: float = 0.0,
    ceiling: float = 2.60,
    back: float = 3.80,
    left: float = -1.70,
    right: float = 1.90,
):
    """Ray-trace a box room. Returns (rays, true depth, surface label)."""
    K = G.intrinsics(W, H, FOV)
    rays = G.ray_grid(W, H, K)

    # Rc maps camera directions into world, so a camera tilted DOWN needs the
    # negative angle here.
    p, r = np.radians(-pitch_deg), np.radians(roll_deg)
    Rx = np.array([[1, 0, 0], [0, np.cos(p), -np.sin(p)], [0, np.sin(p), np.cos(p)]])
    Rz = np.array([[np.cos(r), -np.sin(r), 0], [np.sin(r), np.cos(r), 0], [0, 0, 1]])
    Rc = Rx @ Rz
    world = rays @ Rc.T

    planes = [
        (np.array([0.0, 1.0, 0.0]), camera_height),
        (np.array([0.0, 1.0, 0.0]), camera_height - ceiling),
        (np.array([0.0, 0.0, 1.0]), back),
        (np.array([1.0, 0.0, 0.0]), left),
        (np.array([1.0, 0.0, 0.0]), right),
    ]
    z = np.full((H, W), np.inf)
    label = np.full((H, W), -1)
    for i, (n, o) in enumerate(planes):
        den = world @ n
        with np.errstate(divide="ignore", invalid="ignore"):
            t = np.where(np.abs(den) > 1e-9, o / den, -1.0)
        hit = (t > 1e-6) & (t < z)
        z[hit], label[hit] = t[hit], i
    assert np.isfinite(z).all(), "every ray must hit the box"
    return rays, z, label, Rc


def scramble(z: np.ndarray, a: float, b: float) -> np.ndarray:
    """Inverse depth put through the affine ambiguity a model would add."""
    return (1.0 / z - b) / a


POSES = [
    pytest.param(0.0, 0.0, id="level"),
    pytest.param(12.0, 0.0, id="pitched-down-12"),
    pytest.param(8.0, 5.0, id="pitched-8-rolled-5"),
    pytest.param(-7.0, 0.0, id="pitched-up-7"),
]


@pytest.mark.parametrize("pitch,roll", POSES)
def test_recovers_the_affine_scramble(pitch, roll):
    camh, ceiling = 1.45, 2.60
    a_t, b_t = 3.7, -0.42
    rays, z, _, Rc = render(
        camera_height=camh, pitch_deg=pitch, roll_deg=roll, ceiling=ceiling
    )

    # Pitched far enough up, the floor leaves the frame and scale has to come
    # off the ceiling instead. Telling the solver the true ceiling height is
    # what makes that path exact -- see the companion test below for what the
    # error looks like when the assumption is wrong.
    sol = G.solve_scene(
        scramble(z, a_t, b_t), rays, camh, ceiling_height=ceiling,
        rng=np.random.default_rng(3),
    )

    assert sol.method == "manhattan"
    assert sol.a == pytest.approx(a_t, rel=0.01)
    assert sol.b == pytest.approx(b_t, rel=0.02)

    # The recovered vertical must match the true one.
    true_up = Rc.T @ np.array([0.0, -1.0, 0.0])
    angle = np.degrees(np.arccos(np.clip(sol.up @ true_up, -1, 1)))
    assert angle < 0.5, f"up is {angle:.2f} deg out"

    # And therefore metric depth, everywhere, not just on the floor.
    err = np.abs(sol.metric_depth(scramble(z, a_t, b_t)) - z)
    assert err.max() < 0.05, f"max depth error {err.max()*1000:.1f} mm"


def test_ceiling_anchor_inherits_the_assumed_height_error():
    """
    Shot steeply upward there is no floor to measure against, so scale comes
    from an assumed ceiling height. The error that introduces should be
    exactly proportional to how wrong the assumption is -- no worse, and not
    quietly hidden.
    """
    camh, ceiling = 1.45, 2.60
    rays, z, _, _ = render(camera_height=camh, pitch_deg=-7.0, ceiling=ceiling)
    disp = scramble(z, 3.7, -0.42)

    assumed = 2.70
    sol = G.solve_scene(
        disp, rays, camh, ceiling_height=assumed, rng=np.random.default_rng(3)
    )
    assert sol.anchor == "ceiling"
    assert any("ceiling" in n for n in sol.notes)

    expected = (assumed - camh) / (ceiling - camh)
    assert sol.metric_depth(disp).mean() / z.mean() == pytest.approx(expected, rel=0.02)


def test_a_photo_of_one_flat_wall_is_refused():
    """
    A wide shallow room shot head-on is 99% back wall. There is no room in
    that image, and the solver must say so rather than invent one.
    """
    camh = 1.45
    rays, z, _, _ = render(
        camera_height=camh, pitch_deg=5.0, ceiling=2.40, back=2.60, left=-2.40, right=2.40
    )
    sol = G.solve_scene(scramble(z, 3.7, -0.42), rays, camh, rng=np.random.default_rng(3))
    assert sol.method in ("partial", "fallback")
    assert sol.notes


def test_scale_is_independent_of_the_scramble():
    """Different a, b; same room. The solve must not care."""
    camh = 1.45
    rays, z, _, _ = render(camera_height=camh)
    out = [
        G.solve_scene(scramble(z, a, b), rays, camh, rng=np.random.default_rng(3))
        for a, b in [(3.7, -0.42), (0.8, 2.1), (21.0, 0.03)]
    ]
    depths = [s.metric_depth(scramble(z, a, b))
              for s, (a, b) in zip(out, [(3.7, -0.42), (0.8, 2.1), (21.0, 0.03)])]
    for d in depths:
        assert np.abs(d - z).max() < 0.05


def test_camera_height_sets_absolute_scale():
    """
    The one assumption the whole reconstruction hangs from. Doubling the
    assumed camera height must double every distance -- nothing else in the
    image can pin it down.
    """
    rays, z, _, _ = render(camera_height=1.45)
    disp = scramble(z, 3.7, -0.42)
    a = G.solve_scene(disp, rays, 1.45, rng=np.random.default_rng(3))
    b = G.solve_scene(disp, rays, 2.90, rng=np.random.default_rng(3))
    ratio = b.metric_depth(disp) / a.metric_depth(disp)
    assert np.allclose(ratio, 2.0, rtol=1e-3)


def test_survives_noisy_disparity():
    camh = 1.45
    rays, z, _, _ = render(camera_height=camh)
    disp = scramble(z, 3.7, -0.42)
    disp = disp + np.random.default_rng(5).normal(0, 0.01 * disp.std(), disp.shape)

    sol = G.solve_scene(disp, rays, camh, rng=np.random.default_rng(3))
    assert sol.method == "manhattan"
    assert sol.a == pytest.approx(3.7, rel=0.03)
    err = np.abs(sol.metric_depth(disp) - z)
    assert np.median(err) < 0.02


@pytest.mark.parametrize(
    "ceiling,back,left,right",
    [(2.60, 3.80, -1.70, 1.90), (3.10, 5.00, -1.20, 1.30), (2.70, 4.20, -2.10, 2.10)],
)
def test_measures_the_room(ceiling, back, left, right):
    camh = 1.45
    rays, z, _, _ = render(
        camera_height=camh, pitch_deg=5.0, ceiling=ceiling, back=back, left=left, right=right
    )
    disp = scramble(z, 3.7, -0.42)
    sol = G.solve_scene(disp, rays, camh, rng=np.random.default_rng(3))

    zm = sol.metric_depth(disp)
    pts = (rays[::3, ::3] * zm[::3, ::3, None]).reshape(-1, 3)
    pts = pts[pts[:, 2] <= np.percentile(pts[:, 2], 98) * 1.05]
    floor_d = np.abs(pts @ sol.q - 1.0) / np.linalg.norm(sol.q)
    planes = G.ransac_planes(
        pts[floor_d > 0.07], max_planes=4, threshold=0.05,
        min_inliers=200, rng=np.random.default_rng(11),
    )
    frame = G.build_room(pts, sol.up, planes, camh)

    assert frame.width == pytest.approx(right - left, abs=0.12)
    assert frame.height == pytest.approx(ceiling, abs=0.15)
    assert frame.back_wall_distance == pytest.approx(back, abs=0.15)
    # And the frame must face the camera, not the wall.
    assert frame.R[2] @ np.array([0.0, 0.0, 1.0]) < 0


def test_flat_depth_map_degrades_rather_than_crashes():
    rays, z, _, _ = render()
    sol = G.solve_scene(np.full_like(z, 0.5), rays, 1.45, rng=np.random.default_rng(3))
    assert sol.method == "fallback"
    assert sol.notes


def test_affine_ambiguity_is_real():
    """
    Guards the reasoning the solver is built on: shifting inverse depth by a
    constant maps a plane to another plane, so planarity alone cannot fix b.
    If this ever fails, the Manhattan constraint is no longer necessary.
    """
    rays, z, label, _ = render()
    m = rays.reshape(-1, 3)[(label == 0).ravel()]
    inv = (1.0 / z).ravel()[(label == 0).ravel()]

    for shift in (0.0, 0.15, -0.08):
        pts = m * (1.0 / (inv + shift))[:, None]
        centred = pts - pts.mean(axis=0)
        s = np.linalg.svd(centred, compute_uv=False)
        # A perfect plane has a vanishing third singular value at every shift.
        assert s[2] / s[0] < 1e-9
