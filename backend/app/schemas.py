"""
Response shapes.

These mirror the TypeScript in lib/room/types.ts and lib/placement/types.ts
closely enough that the client adapter is a rename rather than a translation.
Where they differ, it is because the service knows something the app's own
types have no place for -- how a number was arrived at, and how much to trust
it. `measuredFrom` and `quality` exist so the UI can say "3.4 m, measured"
versus "3.5 m, assumed", which is the difference between a tool and a guess.
"""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field

SurfaceId = Literal["floor", "ceiling", "back", "front", "left", "right"]
Vec2 = tuple[float, float]
Vec3 = tuple[float, float, float]


class Quad(BaseModel):
    """Four corners in normalised image coordinates, origin top-left."""

    tl: Vec2
    tr: Vec2
    br: Vec2
    bl: Vec2


class Calibration(BaseModel):
    """Exactly the app's RoomCalibration, ready to drop into a project."""

    backWall: Quad
    vanishingPoint: Vec2
    fovDeg: float
    cameraHeight: float
    frontExtension: float


class Dimensions(BaseModel):
    width: float
    height: float
    depth: float
    backWallDistance: float
    measuredFrom: dict[str, Literal["plane", "extent", "default"]] = Field(
        description=(
            "Per axis: 'plane' means two opposing surfaces were fitted and the "
            "distance between them measured; 'extent' means only the visible "
            "point cloud bounded it, which is a lower bound; 'default' means "
            "it could not be determined at all."
        )
    )


class SurfaceView(BaseModel):
    quad: Quad
    visible: bool = Field(
        description="All four corners are in front of the camera, so the quad "
        "is a usable homography target."
    )
    framed: float = Field(
        ge=0, le=1, description="Fraction of corners inside the photo."
    )
    behindCamera: int


class SizeCm(BaseModel):
    w: float
    h: float
    d: float


class DetectedObject(BaseModel):
    label: str
    confidence: float
    box: list[float] = Field(min_length=4, max_length=4)
    productId: str | None
    mount: Literal["wall", "floor", "tabletop", "ceiling", "edge"]
    furniture: bool
    position: Vec3 = Field(
        description="Room-local metres. The CONTACT point, matching PlacedItem."
    )
    yaw: float
    sizeCm: SizeCm
    depthFromPrior: bool = Field(
        description=(
            "Always true. One view cannot see how deep an object is, so the "
            "front-to-back extent is a per-class prior, not a measurement."
        )
    )
    againstWall: SurfaceId | None
    distance: float


class UnplacedObject(BaseModel):
    """Detected, but nothing in the catalogue represents it."""

    label: str
    confidence: float
    box: list[float]


class Palette(BaseModel):
    wall: str
    floor: str
    ceiling: str
    accent: str


class CameraInfo(BaseModel):
    fovDeg: float
    heightM: float
    rollDeg: float


class Quality(BaseModel):
    confidence: float = Field(ge=0, le=1)
    method: Literal["manhattan", "level", "partial", "fallback"]
    anchor: Literal["floor", "ceiling", "none"]
    planes: int
    manhattan: float | None
    floorInliers: float
    depthModel: str
    detectModel: str | None
    warnings: list[str]


class ImageInfo(BaseModel):
    width: int
    height: int


class AnalyzeResponse(BaseModel):
    ok: bool
    image: ImageInfo
    calibration: Calibration
    dimensions: Dimensions
    surfaces: dict[str, SurfaceView]
    objects: list[DetectedObject]
    unplaced: list[UnplacedObject]
    palette: Palette
    camera: CameraInfo
    quality: Quality
    timings: dict[str, float]


class AnalyzeOptions(BaseModel):
    """Form fields accepted alongside the upload."""

    cameraHeight: float = Field(1.5, ge=0.3, le=3.0)
    fovDeg: float = Field(60.0, ge=20.0, le=140.0)
    frontExtension: float = Field(1.2, ge=0.0, le=6.0)
    ceilingHeight: float = Field(2.7, ge=1.9, le=4.5)
    detectConf: float = Field(0.30, ge=0.01, le=0.95)
    detect: bool = True


class ModelStatus(BaseModel):
    name: str
    ready: bool
    detail: str | None = None


class HealthResponse(BaseModel):
    ok: bool
    version: str
    device: str
    modelDir: str
    models: list[ModelStatus]
    maxSide: int
