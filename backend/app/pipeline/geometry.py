"""
Turning a relative depth map into a metric room.

The hard part of monocular reconstruction is not depth, it is SCALE. MiDaS
returns disparity that is affine-ambiguous -- the true inverse depth is
`a * d + b` for two unknown constants -- so naively inverting it gives a room
that is the wrong size and, worse, the wrong SHAPE: flat floors come out
curved, which then breaks every plane fit downstream.

Write the ray through a pixel as m = K^-1 [u v 1] (note m_z = 1 by
construction) and a plane as q.P = 1, where |q| = 1/(distance to the plane).
A pixel on that plane satisfies

    P = z * m,  q.P = 1   =>   1/z = q.m   and   1/z = a*d + b
    =>   a*d + b = qx*mx + qy*my + qz

so fixing a = 1 leaves an ordinary three-unknown least squares in
(qx, qy, c), where **c = b - qz**:

    d = qx*mx + qy*my - c                                          (1)

That is all a single plane can ever give. `b` and `qz` only ever appear as
their difference, and this is not a conditioning problem that a better solver
would fix -- it is exact. Adding a constant to inverse depth maps *every*
plane to another plane (1/z' = 1/z + c sends q to q + c*e_z), so the whole
one-parameter family is a geometrically consistent scene made entirely of
planes. No number of fitted planes can separate them.

What breaks it is one piece of knowledge about rooms rather than about
images: **a room is a box.** Its surfaces meet at right angles. Every fitted
plane's normal is a known function of the one remaining unknown,

    q_i(b) = (qxi, qyi, b - ci)

so the right b is the one that makes the whole set mutually parallel or
perpendicular, and finding it is a search over a single scalar. That is worth
doing rather than assuming the floor is "the bottom of the frame": in a level
shot of a small room the back wall covers two thirds of the lower image, and
a position prior confidently fits the wall and calls it the floor. Nothing
downstream can recover from that. The Manhattan score needs no prior at all,
and it identifies which plane is the floor as a by-product -- once b is
known, the floor is simply the one whose normal points down.

The last degree of freedom, absolute size, is the one thing a single photo
genuinely cannot know, so it comes from the assumed camera height -- a
request parameter rather than a hidden constant.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Literal, Sequence

import numpy as np

SurfaceId = Literal["floor", "ceiling", "back", "front", "left", "right"]

# Camera frame throughout this module is OpenCV's: +X right, +Y DOWN,
# +Z forward. The room frame the app uses is +X right, +Y UP, +Z toward the
# camera. The conversion happens once, in `RoomFrame`.


def intrinsics(width: int, height: int, fov_deg: float) -> np.ndarray:
    """Pinhole K from a horizontal field of view, principal point centred."""
    f = 0.5 * width / np.tan(0.5 * np.radians(fov_deg))
    return np.array([[f, 0.0, width / 2.0], [0.0, f, height / 2.0], [0.0, 0.0, 1.0]])


def ray_grid(width: int, height: int, K: np.ndarray) -> np.ndarray:
    """(H, W, 3) array of K^-1 [u v 1] -- the unit-Z ray through every pixel."""
    us, vs = np.meshgrid(
        np.arange(width, dtype=np.float64) + 0.5,
        np.arange(height, dtype=np.float64) + 0.5,
    )
    Kinv = np.linalg.inv(K)
    flat = np.stack([us.ravel(), vs.ravel(), np.ones(us.size)], axis=1)
    return (flat @ Kinv.T).reshape(height, width, 3)


# --------------------------------------------------------------------------
# One plane, in "a = 1" depth units
# --------------------------------------------------------------------------


@dataclass
class PlaneFamily:
    """
    A plane fitted through equation (1), i.e. known except for `b`.

    `qx`, `qy` are final; the normal's third component is `b - c` and waits on
    the Manhattan solve.
    """

    c: float
    qx: float
    qy: float
    inliers: np.ndarray
    """Boolean mask over the pixel subset this was fitted on. Only meaningful
    to whoever passed that subset in -- use `support` after fit_families."""
    rmse: float
    support: np.ndarray | None = None
    """Absolute indices of the supporting pixels, filled in by fit_families."""
    count: int = 0
    """How many pixels supported it -- the weight in the Manhattan score."""
    row: float = 0.5
    """Mean normalised image row of its inliers, 0 = top. Tie-breaker only."""

    def q(self, b: float) -> np.ndarray:
        return np.array([self.qx, self.qy, b - self.c])

    def normal(self, b: float) -> np.ndarray:
        q = self.q(b)
        n = np.linalg.norm(q)
        return q / n if n > 1e-12 else np.array([0.0, 0.0, 1.0])


def _lsq_family(d: np.ndarray, m: np.ndarray) -> tuple[float, float, float] | None:
    """Least squares on d = qx*mx + qy*my - c. Returns (c, qx, qy)."""
    A = np.column_stack([m[:, 0], m[:, 1], -np.ones(d.size)])
    try:
        sol, *_ = np.linalg.lstsq(A, d, rcond=None)
    except np.linalg.LinAlgError:
        return None
    if not np.all(np.isfinite(sol)):
        return None
    return float(sol[2]), float(sol[0]), float(sol[1])


def fit_family(
    d: np.ndarray,
    m: np.ndarray,
    *,
    tol: float,
    iterations: int = 160,
    min_ratio: float = 0.35,
    rng: np.random.Generator | None = None,
) -> PlaneFamily | None:
    """RANSAC equation (1) over a candidate pixel set."""
    rng = rng or np.random.default_rng(7)
    n = d.size
    if n < 24:
        return None

    best: tuple[int, np.ndarray] | None = None
    for _ in range(iterations):
        pick = rng.choice(n, 3, replace=False)
        sol = _lsq_family(d[pick], m[pick])
        if sol is None:
            continue
        c, qx, qy = sol
        res = np.abs(d - (qx * m[:, 0] + qy * m[:, 1] - c))
        mask = res < tol
        hits = int(mask.sum())
        if best is None or hits > best[0]:
            best = (hits, mask)
            if hits > 0.97 * n:
                break

    if best is None or best[0] < max(24, min_ratio * n):
        return None

    mask = best[1]
    sol = _lsq_family(d[mask], m[mask])
    if sol is None:
        return None
    c, qx, qy = sol
    res = np.abs(d[mask] - (qx * m[mask, 0] + qy * m[mask, 1] - c))
    return PlaneFamily(
        c=c,
        qx=qx,
        qy=qy,
        inliers=mask,
        rmse=float(np.sqrt(np.mean(res**2))),
        count=int(mask.sum()),
    )


def fit_families(
    d: np.ndarray,
    m: np.ndarray,
    rows: np.ndarray,
    *,
    tol: float,
    max_models: int = 5,
    min_share: float = 0.04,
    rng: np.random.Generator | None = None,
) -> list[PlaneFamily]:
    """
    Sequential multi-model RANSAC of equation (1) over the whole image.

    Strongest plane, remove its pixels, repeat -- the standard greedy scheme.
    Small fragments are dropped: a plane holding under `min_share` of the
    frame is more often a tabletop or a picture than a room surface, and it
    only adds noise to the Manhattan score.
    """
    rng = rng or np.random.default_rng(7)
    total = d.size
    keep = np.ones(total, dtype=bool)
    out: list[PlaneFamily] = []

    for _ in range(max_models):
        idx = np.flatnonzero(keep)
        if idx.size < max(64, min_share * total):
            break
        fam = fit_family(d[idx], m[idx], tol=tol, min_ratio=0.12, rng=rng)
        if fam is None:
            break
        sel = idx[fam.inliers]
        if sel.size < min_share * total:
            break
        fam.support = sel
        fam.count = int(sel.size)
        fam.row = float(rows[sel].mean())
        out.append(fam)
        keep[sel] = False

    return out


# --------------------------------------------------------------------------
# The scene solve
# --------------------------------------------------------------------------


@dataclass
class DepthSolve:
    a: float
    b: float
    """1/z = a*disparity + b, in metres, once the camera height is applied."""
    q: np.ndarray
    """Floor plane as q.P = 1 in camera frame. |q| = 1 / camera height."""
    inlier_ratio: float
    rmse: float
    method: str
    """'manhattan' when the box constraint fixed the tilt, 'level' when only
    one plane was visible and we assumed a flat-held camera, 'partial' when
    the floor was never seen, 'fallback' when nothing fitted."""
    notes: list[str] = field(default_factory=list)
    planes: int = 0
    manhattan: float = float("nan")
    """Residual box-consistency penalty. Near zero is a clean solve."""
    anchor: str = "none"
    """Which surface fixed the scale: 'floor' (measured camera height) or
    'ceiling' (assumed room height, so less trustworthy)."""

    @property
    def trusted(self) -> bool:
        return self.method == "manhattan" and self.planes >= 3

    @property
    def up(self) -> np.ndarray:
        """Unit vector pointing UP in camera frame (away from the floor)."""
        return -self.q / np.linalg.norm(self.q)

    def metric_depth(self, disparity: np.ndarray) -> np.ndarray:
        inv = self.a * disparity + self.b
        # A non-positive inverse depth is a ray solving to behind the camera --
        # physically meaningless, so it is pushed past the far clip and dropped
        # by the range filter rather than folded back into the room.
        inv = np.where(inv > 1e-4, inv, 1e-4)
        return 1.0 / inv


def orthogonality_roots(f: PlaneFamily, w: PlaneFamily) -> list[float]:
    """
    Values of b making two planes exactly perpendicular.

    q_f . q_w = 0 expands to b^2 - b(c_f + c_w) + c_f*c_w + (qfx*qwx +
    qfy*qwy) = 0. Both roots are geometrically legal; the search uses them as
    seeds rather than trusting either.
    """
    s = f.c + w.c
    k = f.qx * w.qx + f.qy * w.qy
    disc = (f.c - w.c) ** 2 - 4.0 * k
    if disc < 0:
        return []
    r = float(np.sqrt(disc))
    return [0.5 * (s + r), 0.5 * (s - r)]


def manhattan_penalty(families: Sequence[PlaneFamily], b: float) -> float:
    """
    How far a set of planes is from being the faces of a box, at this b.

    Each pair should be either parallel or perpendicular, so the penalty per
    pair is how far |cos| sits from both 0 and 1, weighted by how much pixel
    support the two planes have. A pair at 45 degrees is maximally wrong.
    """
    if len(families) < 2:
        return float("inf")
    ns = [f.normal(b) for f in families]
    ws = [float(f.count) for f in families]
    total = 0.0
    norm = 0.0
    for i in range(len(families)):
        for j in range(i + 1, len(families)):
            c = abs(float(ns[i] @ ns[j]))
            w = ws[i] * ws[j]
            total += w * min(c, 1.0 - c)
            norm += w
    return total / norm if norm > 0 else float("inf")


def _b_bracket(d: np.ndarray) -> tuple[float, float]:
    """
    The range of b that could describe a real scene.

    The binding constraint is simply that every depth comes out positive:
    z = 1/(d + b) needs d_min + b > 0. Beyond that the bound is deliberately
    loose. The tempting extra constraint -- that the far wall is some healthy
    multiple of the near one -- is wrong often enough to matter: a level shot
    down a small room is mostly back wall, and its true near:far ratio can be
    as low as 1.2, which a "rooms span at least 1.8" rule rules out along with
    the correct answer. Selection is the candidate scoring's job, not this
    function's.
    """
    lo_d = float(np.percentile(d, 1.0))
    hi_d = float(np.percentile(d, 99.0))
    span = max(hi_d - lo_d, 1e-6)

    lo = -lo_d + 1e-3 * span
    # Something in the frame must be at least a few percent further away than
    # something else, or there is no depth variation to reconstruct from.
    hi = (hi_d - 1.05 * lo_d) / 0.05
    return lo, max(hi, lo + span)


def _is_room_like(families: Sequence[PlaneFamily], b: float) -> bool:
    """At this b, does the set contain both a floor-ish and a wall-ish plane?"""
    ys = [abs(float(f.normal(b)[1])) for f in families]
    return any(y > 0.55 for y in ys) and any(y < 0.45 for y in ys)


def solve_b(
    families: Sequence[PlaneFamily], d: np.ndarray
) -> tuple[float, float] | None:
    """
    Choose b from the exact pairwise perpendicularity roots.

    A continuous sweep of the penalty cannot be used directly: as |b| grows
    every normal tends to (0, 0, 1), the whole set becomes parallel, and a
    "parallel or perpendicular" score is perfectly happy with that. The
    degenerate branch always wins.

    The roots avoid it entirely. Each is the exact b at which one specific
    pair of planes is perpendicular, and since the floor really is
    perpendicular to the walls, the true value is among them -- so scoring
    that finite set picks the b at which the *rest* of the planes also line
    up, with no way to reach the collapse.
    """
    lo, hi = _b_bracket(d)
    seen: list[float] = []
    for i in range(len(families)):
        for j in range(i + 1, len(families)):
            for r in orthogonality_roots(families[i], families[j]):
                if lo <= r <= hi and not any(abs(r - s) < 1e-9 for s in seen):
                    seen.append(r)

    viable = [b for b in seen if _is_room_like(families, b)]
    if not viable:
        return None

    best = min(viable, key=lambda b: manhattan_penalty(families, b))

    # Polish against fit noise, in a window far too narrow to reach the
    # collapse. Golden section on a single scalar.
    win = 0.01 * (hi - lo)
    a, c = best - win, best + win
    gr = (np.sqrt(5.0) - 1.0) / 2.0
    for _ in range(40):
        x1, x2 = c - gr * (c - a), a + gr * (c - a)
        if manhattan_penalty(families, x1) < manhattan_penalty(families, x2):
            c = x2
        else:
            a = x1
    mid = 0.5 * (a + c)
    if manhattan_penalty(families, mid) < manhattan_penalty(families, best) and _is_room_like(
        families, mid
    ):
        best = mid
    return best, manhattan_penalty(families, best)


def solve_scene(
    disparity: np.ndarray,
    rays: np.ndarray,
    camera_height: float,
    *,
    ceiling_height: float = 2.7,
    ignore_mask: np.ndarray | None = None,
    max_pixels: int = 24000,
    rng: np.random.Generator | None = None,
) -> DepthSolve:
    """
    Recover metric depth and the floor plane from an affine-ambiguous
    disparity map.

    `ignore_mask` marks pixels that are not room surface -- everything the
    detector boxed -- so furniture does not get fitted as a plane.

    Always returns something. When the geometry cannot be trusted the method
    field says so, and the caller downgrades confidence rather than
    pretending.
    """
    rng = rng or np.random.default_rng(7)
    notes: list[str] = []
    h, w = disparity.shape

    usable = np.ones(h * w, dtype=bool)
    if ignore_mask is not None:
        usable &= ~ignore_mask.ravel()
    idx = np.flatnonzero(usable)
    if idx.size > max_pixels:
        idx = rng.choice(idx, max_pixels, replace=False)
    if idx.size < 500:
        notes.append("too little room surface visible")
        return _level_fallback(camera_height, notes)

    d = disparity.ravel()[idx]
    m = rays.reshape(-1, 3)[idx]
    rows = (np.repeat(np.arange(h), w) / max(h - 1, 1))[idx]

    spread = float(np.percentile(d, 97) - np.percentile(d, 3))
    if not np.isfinite(spread) or spread <= 1e-9:
        notes.append("depth map is flat; no geometry recoverable")
        return _level_fallback(camera_height, notes)

    families = fit_families(d, m, rows, tol=0.02 * spread, rng=rng)
    if not families:
        notes.append("no planar surface found")
        return _level_fallback(camera_height, notes)

    solved = solve_b(families, d) if len(families) >= 2 else None
    if solved is not None:
        b, penalty = solved
        method = "manhattan"
    else:
        # Nothing to constrain b with. Assume the camera was held level, which
        # puts the dominant plane's normal in the image's vertical plane, i.e.
        # qz = 0 -- true of a floor or a facing wall shot square-on.
        b, penalty = families[0].c, float("nan")
        method = "level"
        notes.append(
            "only one plane found; assumed a level camera"
            if len(families) < 2
            else "planes were not box-consistent; assumed a level camera"
        )

    # The floor is whichever plane ends up pointing down. q runs from the
    # camera toward its plane, and camera +Y is down, so the floor's q has
    # positive Y. Ties go to the plane sitting lower in the frame.
    scored = [(f, float(f.normal(b)[1])) for f in families]
    floors = [f for f, s in scored if s > 0.55]
    ceilings = [f for f, s in scored if s < -0.55]

    if floors:
        anchor = max(floors, key=lambda f: f.count * (0.6 + 0.4 * f.row))
        # The camera sits `camera_height` above the floor, and the distance
        # from the origin to q.P = 1 is exactly 1/|q|.
        distance = camera_height
    elif ceilings:
        # Shot angled upward -- common enough for a phone held low. The
        # ceiling is parallel to the floor, so it fixes the vertical axis just
        # as well; only the scale anchor has to change, and that now leans on
        # an assumed ceiling height rather than a measured camera height.
        anchor = max(ceilings, key=lambda f: f.count)
        distance = max(0.4, ceiling_height - camera_height)
        notes.append(
            "floor not visible; scale anchored on an assumed "
            f"{ceiling_height:.2f} m ceiling"
        )
    else:
        notes.append("no horizontal surface found; the floor may not be visible")
        return _level_fallback(camera_height, notes, method="partial")

    q = anchor.q(b)
    nq = float(np.linalg.norm(q))
    if nq < 1e-9 or not np.isfinite(nq):
        notes.append("degenerate surface normal")
        return _level_fallback(camera_height, notes)

    s = 1.0 / (distance * nq)
    a, b, q = s, s * b, s * q

    # Sanity. A photo that is almost entirely one flat wall contains no room,
    # and the machinery above will still produce numbers for it: one plane is
    # found, b is unconstrained, the level assumption picks an arbitrary
    # normal for a head-on wall, and the result is a kilometre-deep room
    # reported with a straight face. Checking that the depths it implies are
    # physically possible is what turns that into an honest refusal, which
    # the app already handles by falling back to guided corner marking.
    z_probe = 1.0 / np.maximum(a * d + b, 1e-6)
    near, far = np.percentile(z_probe, [1.0, 99.0])
    positive = float(np.mean(a * d + b > 0))
    if positive < 0.95 or not (0.15 < near < 40.0) or not (0.3 < far < 40.0):
        notes.append(
            "the reconstruction implies impossible distances "
            f"({near:.1f}-{far:.1f} m); the photo may be of a single flat wall"
        )
        return _level_fallback(camera_height, notes, method="partial")

    if floors:
        if q[1] < 0:  # keep q pointing down, i.e. toward the floor
            a, b, q = -a, -b, -q
    else:
        # q currently describes the ceiling. Re-express it as the floor plane:
        # same axis, pointing down, one camera height away.
        if q[1] > 0:
            a, b, q = -a, -b, -q
        q = -(q / np.linalg.norm(q)) / camera_height

    return DepthSolve(
        a=a,
        b=b,
        q=q,
        inlier_ratio=float(anchor.count) / float(idx.size),
        rmse=anchor.rmse,
        method=method,
        notes=notes,
        planes=len(families),
        manhattan=penalty,
        anchor="floor" if floors else "ceiling",
    )


def _level_fallback(
    camera_height: float, notes: list[str], method: str = "fallback"
) -> DepthSolve:
    """A level camera over a flat floor, with depth left in relative units."""
    q = np.array([0.0, 1.0 / camera_height, 0.0])
    return DepthSolve(
        a=1.0,
        b=0.0,
        q=q,
        inlier_ratio=0.0,
        rmse=float("nan"),
        method=method,
        notes=notes,
    )


# --------------------------------------------------------------------------
# Walls
# --------------------------------------------------------------------------


@dataclass
class Plane:
    normal: np.ndarray
    """Unit normal, oriented to point INTO the room (toward the camera)."""
    offset: float
    """Signed: normal.P = offset for points on the plane."""
    inliers: int

    def distance(self, pts: np.ndarray) -> np.ndarray:
        return np.abs(pts @ self.normal - self.offset)


def fit_plane(pts: np.ndarray) -> tuple[np.ndarray, float]:
    """Total-least-squares plane through a point set."""
    c = pts.mean(axis=0)
    _, _, vt = np.linalg.svd(pts - c, full_matrices=False)
    n = vt[-1]
    return n, float(n @ c)


def ransac_planes(
    pts: np.ndarray,
    *,
    max_planes: int = 4,
    threshold: float = 0.05,
    iterations: int = 200,
    min_inliers: int = 400,
    rng: np.random.Generator | None = None,
) -> list[Plane]:
    """Sequential RANSAC: strongest plane, remove its inliers, repeat."""
    rng = rng or np.random.default_rng(11)
    remaining = pts
    found: list[Plane] = []

    for _ in range(max_planes):
        if remaining.shape[0] < min_inliers:
            break
        best_mask: np.ndarray | None = None

        for _ in range(iterations):
            pick = rng.choice(remaining.shape[0], 3, replace=False)
            tri = remaining[pick]
            n = np.cross(tri[1] - tri[0], tri[2] - tri[0])
            norm = np.linalg.norm(n)
            if norm < 1e-8:
                continue
            n = n / norm
            o = float(n @ tri[0])
            mask = np.abs(remaining @ n - o) < threshold
            if best_mask is None or mask.sum() > best_mask.sum():
                best_mask = mask

        if best_mask is None or best_mask.sum() < min_inliers:
            break

        n, o = fit_plane(remaining[best_mask])
        # Orient toward the camera at the origin, so every normal faces inward.
        if o > 0:
            n, o = -n, -o
        found.append(Plane(normal=n, offset=o, inliers=int(best_mask.sum())))
        remaining = remaining[~best_mask]

    return found


# --------------------------------------------------------------------------
# Room frame
# --------------------------------------------------------------------------


@dataclass
class RoomFrame:
    """
    The rotation taking camera-frame points into the app's room frame, plus
    the camera's position in it.

    Room frame (matching lib/room/types.ts): +X right, +Y up, +Z toward the
    camera, floor at Y = 0, room centred on the origin in X and Z.
    """

    R: np.ndarray
    """3x3 -- rows are the room axes expressed in camera coordinates."""
    camera_pos: np.ndarray
    width: float
    height: float
    depth: float
    back_wall_distance: float
    sources: dict[str, str]
    """Per-dimension: 'plane' when a fitted wall gave it, 'extent' when the
    point cloud did, 'default' when neither could."""

    def to_room(self, pts: np.ndarray) -> np.ndarray:
        """Camera-frame points -> room-frame metres."""
        return (np.atleast_2d(pts) @ self.R.T) + self.camera_pos

    def direction_to_room(self, vecs: np.ndarray) -> np.ndarray:
        """Camera-frame directions -> room frame (rotation only)."""
        return np.atleast_2d(vecs) @ self.R.T


def _orthonormal(
    up: np.ndarray, forward_hint: np.ndarray
) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    """Gram-Schmidt a right-handed (right, up, forward) basis in camera frame."""
    up = up / np.linalg.norm(up)
    fwd = forward_hint - up * (forward_hint @ up)
    n = np.linalg.norm(fwd)
    if n < 1e-6:
        # Degenerate hint: pick any direction perpendicular to up.
        alt = np.array([1.0, 0.0, 0.0]) if abs(up[0]) < 0.9 else np.array([0.0, 0.0, 1.0])
        fwd = alt - up * (alt @ up)
        n = np.linalg.norm(fwd)
    fwd = fwd / n
    right = np.cross(up, fwd)  # right-handed: X = Y x Z
    return right, up, fwd


def build_room(
    pts: np.ndarray,
    up: np.ndarray,
    planes: Sequence[Plane],
    camera_height: float,
    *,
    front_extension: float = 1.2,
    defaults: tuple[float, float, float] = (3.5, 2.7, 4.0),
) -> RoomFrame:
    """
    Assemble the room box.

    Measured wall-to-wall distances are used wherever two opposing planes were
    actually found; otherwise the point cloud's extent along that axis, which
    is only a lower bound (you cannot see behind yourself); otherwise a
    default. Which of the three happened is reported, because "3.5 m because
    we measured it" and "3.5 m because that is the default" should not look
    identical to the user.
    """
    up = up / np.linalg.norm(up)
    vertical = [abs(float(p.normal @ up)) for p in planes]

    walls = [p for p, v in zip(planes, vertical) if v < 0.45]
    ceilings = [
        p for p, v in zip(planes, vertical) if v >= 0.45 and float(p.normal @ up) < 0
    ]

    # The back wall faces the camera most directly; among near-ties take the
    # one with the most support, since a big wall beats a glimpsed one.
    optical = np.array([0.0, 0.0, 1.0])
    # Room +Z points at the camera, so the hint runs back along the optical
    # axis, not down it.
    forward_hint = -(optical - up * (optical @ up))
    back: Plane | None = None
    if walls:

        def facing(p: Plane) -> float:
            f = -float(p.normal @ optical)  # inward normal points back at us
            return f * (0.5 + 0.5 * min(1.0, p.inliers / 4000))

        back = max(walls, key=facing)
        # `normal` already points from the back wall into the room, i.e.
        # toward the camera -- which is exactly room +Z. Negating it here put
        # the whole frame 180 degrees out and reported every surface as
        # behind the camera.
        forward_hint = back.normal

    right_ax, up_ax, fwd_ax = _orthonormal(up, forward_hint)
    R = np.stack([right_ax, up_ax, fwd_ax])  # rows = room axes in camera frame

    local = pts @ R.T if pts.size else np.zeros((0, 3))
    sources = {"width": "default", "height": "default", "depth": "default"}

    # --- height: floor to ceiling ---
    height = defaults[1]
    if ceilings:
        ceil = max(ceilings, key=lambda p: p.inliers)
        # Both offsets are distances from the camera along their own normals.
        h = camera_height + abs(ceil.offset)
        if 1.9 <= h <= 4.5:
            height, sources["height"] = h, "plane"
    if sources["height"] == "default" and local.shape[0]:
        h = camera_height + float(np.percentile(local[:, 1], 99.0))
        if 1.9 <= h <= 4.5:
            height, sources["height"] = h, "extent"

    # --- width: left wall to right wall ---
    side = [p for p in walls if p is not back and abs(float(p.normal @ right_ax)) > 0.6]
    width = defaults[0]
    if len(side) >= 2:
        d = [float(-p.offset / (p.normal @ right_ax)) for p in side]
        span = max(d) - min(d)
        if 1.5 <= span <= 12.0:
            width, sources["width"] = span, "plane"
    if sources["width"] == "default" and local.shape[0]:
        lo, hi = np.percentile(local[:, 0], [1.0, 99.0])
        span = float(hi - lo)
        if 1.5 <= span <= 12.0:
            width, sources["width"] = span, "extent"

    # --- depth: back wall to the camera, plus room behind the camera ---
    back_dist = defaults[2] - front_extension
    if back is not None:
        dist = abs(back.offset)
        if 0.8 <= dist <= 15.0:
            back_dist, sources["depth"] = dist, "plane"
    if sources["depth"] == "default" and local.shape[0]:
        dist = float(np.percentile(local[:, 2], 1.0))
        if -15.0 <= dist <= -0.8:
            back_dist, sources["depth"] = abs(dist), "extent"
    depth = back_dist + front_extension

    # Camera position in room coordinates: camera_height above the floor, and
    # back_dist in front of the back wall, which is at z = -depth/2.
    camera_pos = np.array([0.0, camera_height, -depth / 2.0 + back_dist])

    return RoomFrame(
        R=R,
        camera_pos=camera_pos,
        width=float(width),
        height=float(height),
        depth=float(depth),
        back_wall_distance=float(back_dist),
        sources=sources,
    )
