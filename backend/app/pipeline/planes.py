"""
From a metric point cloud to something the app can actually load.

`geometry` gets us a camera-frame room. The web app wants two more things:
the six surfaces projected back into the photo, and a `RoomCalibration` --
the four back-wall corners plus a field of view and a camera height, which is
what its own reconstruction takes as input.

Emitting a calibration rather than a finished room is deliberate. The
frontend's solver is already verified, the corners stay draggable, and the
"AI" step becomes a very good first guess at a screen the user can still
correct -- instead of an opaque answer they have to accept. The catch is that
the frontend assumes a LEVEL camera with the principal point at the vanishing
point, while this pipeline solves a general pose. So the calibration is not
copied out of the solve; it is constructed by inverting the frontend's own
formulas, so that feeding it back reproduces the dimensions measured here.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Sequence

import numpy as np

from .geometry import DepthSolve, Plane, RoomFrame, build_room, ransac_planes

SURFACES = ("floor", "ceiling", "back", "front", "left", "right")


def surface_corners(surface: str, w: float, h: float, d: float) -> np.ndarray:
    """
    The four corners of a room surface, in room metres.

    Ordered top-left, top-right, bottom-right, bottom-left **as seen by
    someone standing inside the room facing that surface** -- the same
    convention as lib/room/surfaces.ts, so a quad produced here can be handed
    straight to the app's homography without a per-surface special case.
    """
    hw, hd = w / 2.0, d / 2.0
    table = {
        "back": [(-hw, h, -hd), (hw, h, -hd), (hw, 0, -hd), (-hw, 0, -hd)],
        "front": [(hw, h, hd), (-hw, h, hd), (-hw, 0, hd), (hw, 0, hd)],
        "left": [(-hw, h, hd), (-hw, h, -hd), (-hw, 0, -hd), (-hw, 0, hd)],
        "right": [(hw, h, -hd), (hw, h, hd), (hw, 0, hd), (hw, 0, -hd)],
        "floor": [(-hw, 0, -hd), (hw, 0, -hd), (hw, 0, hd), (-hw, 0, hd)],
        "ceiling": [(-hw, h, -hd), (hw, h, -hd), (hw, h, hd), (-hw, h, hd)],
    }
    return np.array(table[surface], dtype=np.float64)


@dataclass
class Projector:
    """Room metres -> pixels, for the camera that took the photo."""

    frame: RoomFrame
    f: float
    cx: float
    cy: float
    width: int
    height: int

    def to_camera(self, p_room: np.ndarray) -> np.ndarray:
        return (np.atleast_2d(p_room) - self.frame.camera_pos) @ self.frame.R

    def project(self, p_room: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
        """Returns (pixels Nx2, in-front-of-camera mask)."""
        cam = self.to_camera(p_room)
        z = cam[:, 2]
        ok = z > 1e-6
        safe = np.where(ok, z, 1.0)
        u = self.f * cam[:, 0] / safe + self.cx
        v = self.f * cam[:, 1] / safe + self.cy
        return np.column_stack([u, v]), ok

    def normalised(self, p_room: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
        px, ok = self.project(p_room)
        return px / np.array([self.width, self.height]), ok

    def horizon(self) -> np.ndarray:
        """
        Where the room's receding axis hits the image -- the vanishing point
        of every line running away from the camera into the back wall.
        """
        recede = -self.frame.R[2]  # room +Z points at the camera; invert it
        if recede[2] <= 1e-6:
            return np.array([self.cx, self.cy])
        return np.array(
            [
                self.f * recede[0] / recede[2] + self.cx,
                self.f * recede[1] / recede[2] + self.cy,
            ]
        )

    def roll_deg(self) -> float:
        """Camera roll about the optical axis, in degrees."""
        right = self.frame.R[0]  # room +X in camera frame
        return float(np.degrees(np.arctan2(-right[1], right[0])))


@dataclass
class RoomSolution:
    frame: RoomFrame
    projector: Projector
    planes: list[Plane]
    points: np.ndarray
    """Camera-frame cloud actually used, already thinned."""
    valid: np.ndarray
    """Flat pixel indices those points came from."""
    depth: np.ndarray
    """Metric depth, full resolution."""
    floor_q: np.ndarray
    """The floor plane as q.P = 1 in camera frame -- what objects stand on."""
    warnings: list[str] = field(default_factory=list)


def extract_room(
    solve: DepthSolve,
    disparity: np.ndarray,
    rays: np.ndarray,
    K: np.ndarray,
    camera_height: float,
    *,
    front_extension: float = 1.2,
    ignore_mask: np.ndarray | None = None,
    stride: int = 3,
    rng: np.random.Generator | None = None,
) -> RoomSolution:
    """Point cloud -> walls -> room box -> a projector for it."""
    rng = rng or np.random.default_rng(11)
    warnings: list[str] = []
    h, w = disparity.shape

    depth = solve.metric_depth(disparity)

    thin = np.zeros((h, w), dtype=bool)
    thin[::stride, ::stride] = True
    usable = thin.ravel() & np.isfinite(depth.ravel()) & (depth.ravel() > 0.05)
    if ignore_mask is not None:
        usable &= ~ignore_mask.ravel()

    idx = np.flatnonzero(usable)
    pts = rays.reshape(-1, 3)[idx] * depth.ravel()[idx, None]

    # Drop the far tail: a window, a mirror or an open door back-projects to
    # points that are not part of this room. The margin matters -- a flat wall
    # square-on puts a large share of its points at exactly one depth, and a
    # strict cut there deletes the entire wall.
    if pts.shape[0] > 64:
        far = np.percentile(pts[:, 2], 98.0) * 1.05
        near = pts[:, 2] <= far
        pts, idx = pts[near], idx[near]

    if pts.shape[0] < 200:
        warnings.append("too few 3D points to fit walls")
        planes: list[Plane] = []
    else:
        # Exclude the floor before looking for walls, otherwise the biggest
        # plane is found twice.
        nq = np.linalg.norm(solve.q)
        floor_dist = np.abs(pts @ solve.q - 1.0) / max(nq, 1e-9)
        rest = pts[floor_dist > 0.07]
        planes = (
            ransac_planes(
                rest,
                max_planes=4,
                threshold=0.05,
                min_inliers=max(150, rest.shape[0] // 30),
                rng=rng,
            )
            if rest.shape[0] > 200
            else []
        )
        if not planes:
            warnings.append("no walls found; room size is a default")

    frame = build_room(
        pts,
        solve.up,
        planes,
        camera_height,
        front_extension=front_extension,
    )
    for axis, src in frame.sources.items():
        if src == "default":
            warnings.append(f"{axis} could not be measured; using a default")

    projector = Projector(
        frame=frame,
        f=float(K[0, 0]),
        cx=float(K[0, 2]),
        cy=float(K[1, 2]),
        width=w,
        height=h,
    )
    roll = projector.roll_deg()
    if abs(roll) > 6.0:
        warnings.append(f"camera was rolled about {abs(roll):.0f} degrees")

    return RoomSolution(
        frame=frame,
        projector=projector,
        planes=planes,
        points=pts,
        valid=idx,
        depth=depth,
        floor_q=solve.q,
        warnings=warnings,
    )


def quad_dict(corners: np.ndarray) -> dict[str, list[float]]:
    """Four normalised corners -> the app's Quad shape."""
    keys = ("tl", "tr", "br", "bl")
    return {k: [float(c[0]), float(c[1])] for k, c in zip(keys, corners)}


def surface_quads(sol: RoomSolution) -> dict[str, dict]:
    """Every room surface projected back into the photo."""
    f = sol.frame
    out: dict[str, dict] = {}
    for sid in SURFACES:
        corners = surface_corners(sid, f.width, f.height, f.depth)
        px, ok = sol.projector.normalised(corners)
        inside = float(
            np.mean(
                (px[:, 0] >= 0.0) & (px[:, 0] <= 1.0)
                & (px[:, 1] >= 0.0) & (px[:, 1] <= 1.0)
            )
        )
        # `visible` asks only whether the quad is geometrically usable -- all
        # four corners in front of the camera, so the homography is valid.
        # Whether the surface is wholly in shot is a separate question, and a
        # different one: at any normal field of view you cannot fit an entire
        # floor in one frame, yet its photo still textures the part you can
        # see. That is what `framed` is for, and why it is a fraction.
        out[sid] = {
            "quad": quad_dict(px),
            "visible": bool(ok.all()),
            "framed": round(inside, 3),
            "behindCamera": int((~ok).sum()),
        }
    return out


def calibration_from_room(
    sol: RoomSolution,
    fov_deg: float,
    camera_height: float,
    front_extension: float,
) -> dict:
    """
    Build the `RoomCalibration` the web app consumes.

    Constructed by inverting lib/room/reconstruct.ts rather than copied out of
    the solve, so that the app's own reconstruction -- which assumes a level
    camera with the principal point at the vanishing point -- lands back on
    the dimensions measured here:

        backWallDistance = cameraHeight * f / (vBottom - cy)
        width            = (uRight - uLeft) * D / f
        height           = cameraHeight + (cy - vTop) * D / f

    Solving each for the pixel it depends on gives the four corners directly.
    """
    frame = sol.frame
    w, h = sol.projector.width, sol.projector.height

    # The app derives f from the emitted fov and the image width, so use the
    # same relation here rather than the analysis focal length.
    f_out = (w / 2.0) / np.tan(0.5 * np.radians(fov_deg))
    vp = sol.projector.horizon()
    # A vanishing point far outside the frame means a steeply tilted camera;
    # the level-camera model cannot express that, and letting it run produces
    # a wall the user cannot even see the handles of.
    vp_u = float(np.clip(vp[0], -0.5 * w, 1.5 * w))
    vp_v = float(np.clip(vp[1], -0.5 * h, 1.5 * h))

    d = max(frame.back_wall_distance, 0.3)
    half_w = 0.5 * frame.width * f_out / d
    v_bottom = vp_v + camera_height * f_out / d
    v_top = vp_v - max(frame.height - camera_height, 0.15) * f_out / d

    u_left, u_right = vp_u - half_w, vp_u + half_w
    corners = np.array(
        [
            [u_left, v_top],
            [u_right, v_top],
            [u_right, v_bottom],
            [u_left, v_bottom],
        ]
    ) / np.array([w, h])

    return {
        "backWall": quad_dict(corners),
        "vanishingPoint": [vp_u / w, vp_v / h],
        "fovDeg": float(fov_deg),
        "cameraHeight": float(camera_height),
        "frontExtension": float(front_extension),
    }
