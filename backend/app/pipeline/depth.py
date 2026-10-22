"""
Monocular depth.

The model is loaded lazily and cached for the life of the process. That is
not just a startup optimisation: it means the service boots, answers /health
and serves its schema on a machine that has never downloaded a checkpoint,
and only the endpoint that genuinely needs depth fails -- with a message
saying what to install.

Output is DISPARITY (inverse depth, larger = nearer) on an arbitrary affine
scale. Resolving that scale is `geometry`'s job; nothing here pretends to
know metres.
"""

from __future__ import annotations

import threading
from dataclasses import dataclass

import numpy as np

from ..config import settings


class ModelUnavailable(RuntimeError):
    """Raised when a checkpoint cannot be loaded, with a fixable message."""


@dataclass
class DepthResult:
    disparity: np.ndarray
    """(H, W) float32, affine-ambiguous inverse depth."""
    model: str
    native_size: tuple[int, int]


_lock = threading.Lock()
_model = None
_processor = None
_loaded_name: str | None = None


def _load():
    """
    Load the depth model once, under a lock.

    Two model families are supported behind the same name. Anything with a
    slash is a Hugging Face id and goes through transformers -- including
    `Intel/dpt-hybrid-midas`, which is MiDaS 3.0 itself, so the default path
    needs no timm and no torch.hub checkout. A bare name is treated as a
    torch.hub MiDaS variant for anyone who already has that set up.
    """
    global _model, _processor, _loaded_name

    cfg = settings()
    name = cfg.depth_model
    with _lock:
        if _model is not None and _loaded_name == name:
            return _model, _processor

        try:
            import torch
        except ImportError as exc:  # pragma: no cover - torch is a hard dep
            raise ModelUnavailable("PyTorch is not installed") from exc

        if "/" in name:
            try:
                from transformers import AutoImageProcessor, AutoModelForDepthEstimation
            except ImportError as exc:
                raise ModelUnavailable(
                    "transformers is required for Hugging Face depth models: "
                    "pip install transformers"
                ) from exc
            try:
                kwargs = {"cache_dir": str(cfg.model_dir / "hf")}
                if not cfg.allow_download:
                    kwargs["local_files_only"] = True
                _processor = AutoImageProcessor.from_pretrained(name, **kwargs)
                _model = AutoModelForDepthEstimation.from_pretrained(name, **kwargs)
            except Exception as exc:
                raise ModelUnavailable(
                    f"could not load depth model {name!r}: {exc}"
                ) from exc
        else:
            try:
                _model = torch.hub.load("intel-isl/MiDaS", name, trust_repo=True)
                transforms = torch.hub.load("intel-isl/MiDaS", "transforms", trust_repo=True)
                _processor = (
                    transforms.small_transform
                    if "small" in name.lower()
                    else transforms.dpt_transform
                )
            except Exception as exc:
                raise ModelUnavailable(
                    f"could not load torch.hub MiDaS {name!r}: {exc}. "
                    "The hub variants need timm (pip install timm), or use a "
                    "Hugging Face id such as Intel/dpt-hybrid-midas."
                ) from exc

        _model.to(cfg.torch_device).eval()
        _loaded_name = name
        return _model, _processor


def available() -> bool:
    """Whether depth could run right now, without forcing a download."""
    try:
        _load()
        return True
    except ModelUnavailable:
        return False


def estimate(rgb: np.ndarray) -> DepthResult:
    """
    Disparity for an RGB uint8 image, resampled back to its own resolution.

    The network runs at its own native size (384 square for the DPT family)
    and the result is resized up. Nothing is lost by that: the depth map is
    smooth, and every consumer downstream fits planes over thousands of
    pixels rather than reading individual ones.
    """
    import torch

    cfg = settings()
    model, processor = _load()
    h, w = rgb.shape[:2]

    with torch.no_grad():
        if hasattr(processor, "__call__") and not isinstance(processor, type):
            try:
                inputs = processor(images=rgb, return_tensors="pt")
            except TypeError:
                # torch.hub transforms take a positional array and add the
                # batch dimension themselves.
                inputs = {"pixel_values": processor(rgb)}
        else:  # pragma: no cover - defensive
            inputs = {"pixel_values": torch.from_numpy(rgb).permute(2, 0, 1)[None].float()}

        inputs = {k: v.to(cfg.torch_device) for k, v in dict(inputs).items()}
        out = model(**inputs)
        pred = out.predicted_depth if hasattr(out, "predicted_depth") else out
        if pred.ndim == 3:
            pred = pred.unsqueeze(1)

        native = (int(pred.shape[-2]), int(pred.shape[-1]))
        pred = torch.nn.functional.interpolate(
            pred, size=(h, w), mode="bicubic", align_corners=False
        )
        disparity = pred.squeeze().detach().cpu().numpy().astype(np.float32)

    return DepthResult(disparity=disparity, model=cfg.depth_model, native_size=native)
