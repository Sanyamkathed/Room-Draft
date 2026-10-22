"""
Object detection, and what a COCO label means to a room designer.

YOLOv8 on COCO already knows the things that matter here -- bed, couch,
chair, dining table, tv, potted plant -- so the detector is off the shelf.
The work is in the translation: a COCO box is a 2D rectangle with a word
attached, and the app needs a metric volume with a catalogue id and a mount
type.

Two pieces of that cannot come from the image at all:

  * **Front-to-back depth.** One view sees a bed's width and height and has
    nothing to say about its length. That comes from a per-class prior, and
    it is marked as a prior in the response rather than dressed up as a
    measurement.
  * **Which catalogue entry it is.** "couch" is not a product. It maps to the
    generic two-seat sofa so the volume is present and collidable, and the
    user swaps it for the real thing.
"""

from __future__ import annotations

import threading
from dataclasses import dataclass, field

import numpy as np

from ..config import settings


class ModelUnavailable(RuntimeError):
    """Raised when the detector cannot be loaded, with a fixable message."""


@dataclass(frozen=True)
class ClassInfo:
    """How one COCO class becomes a thing in a room."""

    product: str | None
    """Catalogue id, or None when nothing in the catalogue represents it."""
    mount: str
    depth_m: float
    """Front-to-back extent prior, metres. Never measured from one view."""
    furniture: bool = False
    """True when it is part of the room rather than something to buy."""


# Only classes that plausibly appear in a bedroom are mapped. Everything else
# YOLO finds is reported but not placed: a detected person or dog should not
# become furniture.
COCO_MAP: dict[str, ClassInfo] = {
    "bed": ClassInfo("fn-bed-double", "floor", 2.00, furniture=True),
    "couch": ClassInfo("fn-sofa", "floor", 0.90, furniture=True),
    "chair": ClassInfo("fn-chair", "floor", 0.55, furniture=True),
    "dining table": ClassInfo("fn-desk", "floor", 0.65, furniture=True),
    "desk": ClassInfo("fn-desk", "floor", 0.65, furniture=True),
    "toilet": ClassInfo(None, "floor", 0.70),
    "tv": ClassInfo(None, "wall", 0.08),
    "laptop": ClassInfo(None, "tabletop", 0.25),
    "keyboard": ClassInfo(None, "tabletop", 0.15),
    "mouse": ClassInfo(None, "tabletop", 0.10),
    "potted plant": ClassInfo("plant-monstera", "tabletop", 0.35),
    "vase": ClassInfo("vase-matte", "tabletop", 0.15),
    "book": ClassInfo("book-stack", "tabletop", 0.18),
    "clock": ClassInfo("wall-clock", "wall", 0.05),
    "bottle": ClassInfo(None, "tabletop", 0.08),
    "cup": ClassInfo(None, "tabletop", 0.09),
    "refrigerator": ClassInfo(None, "floor", 0.70),
    "microwave": ClassInfo(None, "tabletop", 0.40),
    "oven": ClassInfo(None, "floor", 0.60),
    "sink": ClassInfo(None, "floor", 0.50),
}

# Things that occlude the floor and must never be fitted as a room plane.
OCCLUDERS = {
    "bed", "couch", "chair", "dining table", "desk", "potted plant", "person",
    "dog", "cat", "toilet", "refrigerator", "oven", "sink", "suitcase",
    "backpack", "tv", "book", "vase",
}


@dataclass
class Detection:
    label: str
    confidence: float
    box: tuple[float, float, float, float]
    """x0, y0, x1, y1 in normalised image coordinates."""
    info: ClassInfo | None = None


@dataclass
class DetectResult:
    detections: list[Detection] = field(default_factory=list)
    model: str = ""
    occluder_mask: np.ndarray | None = None
    """(H, W) bool -- pixels belonging to non-room objects."""


_lock = threading.Lock()
_model = None
_loaded_path: str | None = None


def _load():
    global _model, _loaded_path

    cfg = settings()
    target = str(cfg.yolo_path)
    with _lock:
        if _model is not None and _loaded_path == target:
            return _model

        try:
            from ultralytics import YOLO
        except ImportError as exc:
            raise ModelUnavailable(
                "ultralytics is not installed: pip install ultralytics"
            ) from exc

        if not cfg.yolo_path.exists() and not cfg.allow_download:
            raise ModelUnavailable(
                f"{cfg.yolo_path} is missing and downloads are disabled "
                "(set AURA_ALLOW_DOWNLOAD=1)"
            )
        try:
            # Passing an absolute path keeps the checkpoint in the configured
            # model directory instead of the working directory, which matters
            # when the system drive is the one that is full.
            cfg.yolo_path.parent.mkdir(parents=True, exist_ok=True)
            _model = YOLO(str(cfg.yolo_path) if cfg.yolo_path.exists() else cfg.yolo_weights)
            if not cfg.yolo_path.exists():
                try:
                    src = getattr(_model, "ckpt_path", None)
                    if src and str(src) != target:
                        import shutil

                        shutil.copy2(src, target)
                except OSError:
                    pass  # a cache miss next run is not worth failing over
        except Exception as exc:
            raise ModelUnavailable(f"could not load YOLO weights: {exc}") from exc

        _loaded_path = target
        return _model


def available() -> bool:
    try:
        _load()
        return True
    except ModelUnavailable:
        return False


def detect(rgb: np.ndarray, *, conf: float | None = None) -> DetectResult:
    """Run the detector and build the occluder mask in one pass."""
    cfg = settings()
    model = _load()
    h, w = rgb.shape[:2]

    result = model.predict(
        rgb, conf=conf if conf is not None else cfg.detect_conf, verbose=False,
        device=cfg.torch_device,
    )[0]

    names = result.names
    mask = np.zeros((h, w), dtype=bool)
    found: list[Detection] = []

    boxes = getattr(result, "boxes", None)
    if boxes is not None:
        for xyxy, cls, score in zip(
            boxes.xyxy.cpu().numpy(),
            boxes.cls.cpu().numpy().astype(int),
            boxes.conf.cpu().numpy(),
        ):
            label = str(names.get(int(cls), int(cls)))
            x0, y0, x1, y1 = xyxy
            found.append(
                Detection(
                    label=label,
                    confidence=float(score),
                    box=(
                        float(np.clip(x0 / w, 0, 1)),
                        float(np.clip(y0 / h, 0, 1)),
                        float(np.clip(x1 / w, 0, 1)),
                        float(np.clip(y1 / h, 0, 1)),
                    ),
                    info=COCO_MAP.get(label),
                )
            )
            if label in OCCLUDERS:
                mask[
                    int(max(0, y0)) : int(min(h, y1)),
                    int(max(0, x0)) : int(min(w, x1)),
                ] = True

    return DetectResult(
        detections=found,
        model=cfg.yolo_weights,
        occluder_mask=mask,
    )
