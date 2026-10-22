"""
The whole pipeline, end to end.

    photo -> detect -> depth -> metric solve -> room box -> calibration
                                             -> placed objects
                                             -> palette

Detection runs *before* depth is interpreted, because the biggest threat to
fitting a floor is a bed sitting on it. Boxing the furniture first and
excluding those pixels turns "fit a plane to the lower half of a cluttered
photo" into "fit a plane to the parts of the floor you can actually see".
"""

from __future__ import annotations

import time
from dataclasses import dataclass, field

import numpy as np

from . import depth as depth_mod
from . import detect as detect_mod
from .geometry import intrinsics, ray_grid, solve_scene
from .planes import calibration_from_room, extract_room, surface_quads

# Objects nearer than this to a wall are treated as pushed against it, and
# get that wall's facing direction instead of a default.
WALL_SNAP = 0.55


@dataclass
class Options:
    camera_height: float = 1.5
    fov_deg: float = 60.0
    front_extension: float = 1.2
    ceiling_height: float = 2.7
    detect_conf: float | None = None
    detect: bool = True
    seed: int = 7


@dataclass
class Stage:
    name: str
    ms: float
    detail: str = ""


@dataclass
class Report:
    body: dict
    stages: list[Stage] = field(default_factory=list)


def _yaw_for_wall(x: float, z: float, w: float, d: float) -> tuple[float, str | None]:
    """
    Which wall an object is backed against, and the yaw that faces it away.

    Mirrors `againstWall` in lib/room/wallPlacement.ts so a detected bed ends
    up oriented the same way a library bed dragged to that wall would be.
    """
    gaps = {
        "back": z + d / 2,
        "front": d / 2 - z,
        "left": x + w / 2,
        "right": w / 2 - x,
    }
    surface = min(gaps, key=lambda k: gaps[k])
    if gaps[surface] > WALL_SNAP:
        return 0.0, None
    return (
        {"back": 0.0, "front": np.pi, "left": np.pi / 2, "right": -np.pi / 2}[surface],
        surface,
    )


def _median_depth(depth: np.ndarray, box_px: tuple[int, int, int, int]) -> float:
    """Depth of a detection, from the middle of its box only."""
    x0, y0, x1, y1 = box_px
    mx, my = (x1 - x0) * 0.2, (y1 - y0) * 0.2
    crop = depth[
        int(y0 + my) : max(int(y1 - my), int(y0 + my) + 1),
        int(x0 + mx) : max(int(x1 - mx), int(x0 + mx) + 1),
    ]
    crop = crop[np.isfinite(crop) & (crop > 0.05)]
    return float(np.median(crop)) if crop.size else float("nan")


def _place(det, sol, opts: Options, K: np.ndarray) -> dict | None:
    """One detection -> a metric, room-frame placement."""
    info = det.info
    if info is None:
        return None

    h_px, w_px = sol.depth.shape
    f = float(K[0, 0])
    cx, cy = float(K[0, 2]), float(K[1, 2])
    x0, y0, x1, y1 = (
        det.box[0] * w_px,
        det.box[1] * h_px,
        det.box[2] * w_px,
        det.box[3] * h_px,
    )
    frame = sol.frame
    q = sol.floor_q

    grounded = info.mount in ("floor",)
    base_cam: np.ndarray | None = None

    if grounded:
        # Standing on the floor: intersect the ray through the bottom-centre
        # of the box with the floor plane. That is far steadier than reading
        # the depth map at an object's silhouette edge, where depth models
        # are at their least reliable.
        m = np.array([((x0 + x1) / 2 - cx) / f, (y1 - cy) / f, 1.0])
        denom = float(q @ m)
        if denom > 1e-6:
            base_cam = m / denom

    z_med = _median_depth(sol.depth, (int(x0), int(y0), int(x1), int(y1)))
    if base_cam is None:
        if not np.isfinite(z_med):
            return None
        m = np.array([((x0 + x1) / 2 - cx) / f, ((y0 + y1) / 2 - cy) / f, 1.0])
        base_cam = m * z_med

    z_ref = float(base_cam[2])
    if not np.isfinite(z_ref) or z_ref <= 0.05:
        return None

    # Pinhole scale at the object's own distance.
    width_m = float((x1 - x0) * z_ref / f)
    height_m = float((y1 - y0) * z_ref / f)

    p_room = frame.to_room(base_cam)[0]
    w, hgt, d = frame.width, frame.height, frame.depth

    if grounded:
        p_room = np.array([p_room[0], 0.0, p_room[2]])
    yaw, wall = _yaw_for_wall(float(p_room[0]), float(p_room[2]), w, d)

    depth_m = info.depth_m
    if wall in ("left", "right"):
        # Seen side-on, so the box measures the object's length and the prior
        # supplies its width -- the other way round from a head-on view.
        width_m, depth_m = depth_m, width_m

    # Keep it inside the room; a detection clipped by the frame edge can
    # otherwise put half a bed through a wall.
    half_w, half_d = width_m / 2, depth_m / 2
    x = float(np.clip(p_room[0], -w / 2 + half_w, w / 2 - half_w))
    z = float(np.clip(p_room[2], -d / 2 + half_d, d / 2 - half_d))
    y = 0.0 if grounded else float(np.clip(p_room[1], 0.0, hgt))

    return {
        "label": det.label,
        "confidence": round(float(det.confidence), 3),
        "box": [round(v, 4) for v in det.box],
        "productId": info.product,
        "mount": info.mount,
        "furniture": info.furniture,
        "position": [round(x, 3), round(y, 3), round(z, 3)],
        "yaw": round(float(yaw), 4),
        "sizeCm": {
            "w": round(max(width_m, 0.05) * 100, 1),
            "h": round(max(height_m, 0.05) * 100, 1),
            "d": round(max(depth_m, 0.05) * 100, 1),
        },
        "depthFromPrior": True,
        "againstWall": wall,
        "distance": round(z_ref, 3),
    }


def _palette(rgb: np.ndarray, sol, solve) -> dict[str, str]:
    """Dominant colours, split by which room surface the pixels belong to."""

    def hexof(pixels: np.ndarray, fallback: str) -> str:
        if pixels.size < 30:
            return fallback
        c = np.median(pixels.reshape(-1, 3), axis=0)
        return "#%02x%02x%02x" % tuple(int(np.clip(v, 0, 255)) for v in c)

    h, w = sol.depth.shape
    flat = rgb.reshape(-1, 3)
    pts, idx = sol.points, sol.valid

    # Height above the FLOOR. `pts` are camera-frame, and the camera is the
    # origin, so the dot product alone measures height above the camera --
    # which puts most of the walls in the floor bucket.
    above_floor = pts @ solve.up + sol.frame.camera_pos[1]
    ceiling_from = sol.frame.height - 0.55
    floor_px = flat[idx[above_floor < 0.25]]
    ceil_px = flat[idx[above_floor > ceiling_from]]
    wall_px = flat[idx[(above_floor >= 0.25) & (above_floor <= ceiling_from)]]

    # Accent: the most saturated thing in the room, which is usually the one
    # deliberate splash of colour a photo of a bedroom contains.
    sample = flat[:: max(1, flat.shape[0] // 20000)].astype(np.int16)
    sat = sample.max(axis=1) - sample.min(axis=1)
    accent = "#7c7cff"
    if sample.size and sat.size:
        top = sample[sat >= np.percentile(sat, 99)]
        if top.size:
            accent = hexof(top.astype(np.uint8), accent)

    return {
        "wall": hexof(wall_px, "#d8d5cf"),
        "floor": hexof(floor_px, "#9c8874"),
        "ceiling": hexof(ceil_px, "#f2f1ee"),
        "accent": accent,
    }


def _confidence(solve, sol, detections: int) -> float:
    score = 0.30
    if solve.method == "manhattan":
        score += 0.30
        if np.isfinite(solve.manhattan):
            score += 0.15 * max(0.0, 1.0 - solve.manhattan / 0.02)
    elif solve.method == "level":
        score += 0.08
    if solve.anchor == "floor":
        score += 0.10
    score += 0.05 * min(solve.planes, 4) / 4.0
    measured = sum(1 for v in sol.frame.sources.values() if v == "plane")
    score += 0.10 * measured / 3.0
    if detections:
        score += 0.02
    return round(float(np.clip(score, 0.0, 1.0)), 3)


def analyze(rgb: np.ndarray, opts: Options | None = None) -> Report:
    """Run everything and build the response body."""
    opts = opts or Options()
    stages: list[Stage] = []
    rng = np.random.default_rng(opts.seed)
    h, w = rgb.shape[:2]

    # --- detect -----------------------------------------------------------
    t = time.perf_counter()
    det_result = detect_mod.DetectResult()
    detect_error: str | None = None
    if opts.detect:
        try:
            det_result = detect_mod.detect(rgb, conf=opts.detect_conf)
        except detect_mod.ModelUnavailable as exc:
            detect_error = str(exc)
    stages.append(
        Stage(
            "detect",
            (time.perf_counter() - t) * 1000,
            detect_error or f"{len(det_result.detections)} objects",
        )
    )

    # --- depth ------------------------------------------------------------
    t = time.perf_counter()
    dr = depth_mod.estimate(rgb)
    stages.append(
        Stage("depth", (time.perf_counter() - t) * 1000, f"{dr.model} @ {dr.native_size}")
    )

    # --- geometry ---------------------------------------------------------
    t = time.perf_counter()
    K = intrinsics(w, h, opts.fov_deg)
    rays = ray_grid(w, h, K)
    solve = solve_scene(
        dr.disparity,
        rays,
        opts.camera_height,
        ceiling_height=opts.ceiling_height,
        ignore_mask=det_result.occluder_mask,
        rng=rng,
    )
    sol = extract_room(
        solve,
        dr.disparity,
        rays,
        K,
        opts.camera_height,
        front_extension=opts.front_extension,
        ignore_mask=det_result.occluder_mask,
        rng=rng,
    )
    stages.append(
        Stage("geometry", (time.perf_counter() - t) * 1000, f"{solve.method}, {solve.planes} planes")
    )

    # --- assemble ---------------------------------------------------------
    t = time.perf_counter()
    objects = []
    for det in det_result.detections:
        placed = _place(det, sol, opts, K)
        if placed is not None:
            objects.append(placed)

    body = {
        "ok": True,
        "image": {"width": w, "height": h},
        "calibration": calibration_from_room(
            sol, opts.fov_deg, opts.camera_height, opts.front_extension
        ),
        "dimensions": {
            "width": round(sol.frame.width, 3),
            "height": round(sol.frame.height, 3),
            "depth": round(sol.frame.depth, 3),
            "backWallDistance": round(sol.frame.back_wall_distance, 3),
            "measuredFrom": sol.frame.sources,
        },
        "surfaces": surface_quads(sol),
        "objects": objects,
        "unplaced": [
            {"label": d.label, "confidence": round(float(d.confidence), 3), "box": list(d.box)}
            for d in det_result.detections
            if d.info is None
        ],
        "palette": _palette(rgb, sol, solve),
        "camera": {
            "fovDeg": opts.fov_deg,
            "heightM": opts.camera_height,
            "rollDeg": round(sol.projector.roll_deg(), 2),
        },
        "quality": {
            "confidence": _confidence(solve, sol, len(objects)),
            "method": solve.method,
            "anchor": solve.anchor,
            "planes": solve.planes,
            "manhattan": None if not np.isfinite(solve.manhattan) else round(solve.manhattan, 6),
            "floorInliers": round(solve.inlier_ratio, 3),
            "depthModel": dr.model,
            "detectModel": det_result.model or None,
            "warnings": solve.notes + sol.warnings + ([detect_error] if detect_error else []),
        },
    }
    stages.append(Stage("assemble", (time.perf_counter() - t) * 1000, f"{len(objects)} placed"))

    body["timings"] = {s.name: round(s.ms, 1) for s in stages}
    body["timings"]["total"] = round(sum(s.ms for s in stages), 1)
    return Report(body=body, stages=stages)
