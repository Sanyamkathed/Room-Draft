"""
Runtime configuration.

Everything here is an environment variable with a working default, because the
service has to be startable on a machine that has never downloaded a model.
Weights are large and the developer's C: drive may not be where they belong —
hence AURA_MODEL_DIR, which relocates *both* caches (ultralytics writes next to
its weights file, torch.hub writes under TORCH_HOME).
"""

from __future__ import annotations

import os
from dataclasses import dataclass, field
from functools import lru_cache
from pathlib import Path


def _load_dotenv() -> None:
    """
    Read backend/.env into the environment, if it exists.

    Deliberately hand-rolled rather than pulling in python-dotenv: the whole
    feature is "KEY=VALUE, ignore blanks and #comments", and a service whose
    point is to be easy to start should not gain a dependency to read its own
    config file. Real environment variables always win, so a shell override
    or a container's env beats the file.
    """
    path = Path(__file__).resolve().parents[1] / ".env"
    try:
        raw = path.read_text(encoding="utf-8")
    except OSError:
        return
    for line in raw.splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, value = line.partition("=")
        os.environ.setdefault(key.strip(), value.strip().strip('"').strip("'"))


_load_dotenv()


def _flag(name: str, default: bool) -> bool:
    raw = os.environ.get(name)
    if raw is None:
        return default
    return raw.strip().lower() in {"1", "true", "yes", "on"}


def _num(name: str, default: float) -> float:
    try:
        return float(os.environ[name])
    except (KeyError, ValueError):
        return default


@dataclass(frozen=True)
class Settings:
    """Resolved once at import and treated as immutable."""

    model_dir: Path = field(
        default_factory=lambda: Path(
            os.environ.get("AURA_MODEL_DIR", Path(__file__).resolve().parents[1] / ".models")
        )
    )

    # --- models -----------------------------------------------------------
    # Nano by default: this runs on a laptop CPU, and for "where is the bed"
    # the extra mAP of the larger checkpoints buys nothing that survives being
    # collapsed into a metre-accurate box.
    yolo_weights: str = os.environ.get("AURA_YOLO_WEIGHTS", "yolov8n.pt")
    # Depth Anything V1 Small: the same DPT dense-prediction head as MiDaS,
    # trained on far more data, at a quarter of the size and several times
    # the speed on a CPU. It is also the pragmatic choice -- it ships
    # safetensors, and transformers refuses to torch.load a .bin checkpoint
    # unless torch is >= 2.6 (CVE-2025-32434), which rules out Intel's
    # dpt-hybrid-midas on the torch 2.5 line. Set AURA_DEPTH_MODEL to
    # Intel/dpt-hybrid-midas for literal MiDaS 3.0 once torch is new enough,
    # or to a bare name like MiDaS_small to go through torch.hub (needs timm).
    depth_model: str = os.environ.get(
        "AURA_DEPTH_MODEL", "LiheYoung/depth-anything-small-hf"
    )
    device: str = os.environ.get("AURA_DEVICE", "auto")

    # Downloads are opt-out so a first run works, but a locked-down or offline
    # deployment can refuse them and get a clean 503 instead of a hang.
    allow_download: bool = _flag("AURA_ALLOW_DOWNLOAD", True)
    # Loading both models costs ~90 s on a cold CPU. Off by default so the
    # process is up immediately and /health answers during the warm-up.
    preload: bool = _flag("AURA_PRELOAD", False)

    # --- image ------------------------------------------------------------
    # Depth runs at 256-384 internally anyway; anything above this is pixels
    # spent on JPEG decode for no extra geometry.
    max_side: int = int(_num("AURA_MAX_SIDE", 1024))
    max_upload_mb: float = _num("AURA_MAX_UPLOAD_MB", 24)

    # --- geometry ---------------------------------------------------------
    # A single image cannot determine absolute scale. This is the one honest
    # assumption the whole metric reconstruction hangs from, and it is exposed
    # per-request so the user can correct it rather than discover it.
    default_camera_height: float = _num("AURA_CAMERA_HEIGHT", 1.5)
    default_fov_deg: float = _num("AURA_FOV_DEG", 60.0)

    detect_conf: float = _num("AURA_DETECT_CONF", 0.30)

    cors_origins: tuple[str, ...] = tuple(
        o.strip()
        for o in os.environ.get(
            "AURA_CORS_ORIGINS", "http://localhost:3000,http://localhost:3210"
        ).split(",")
        if o.strip()
    )

    def prepare(self) -> None:
        """Point both model caches at model_dir before anything imports torch.hub."""
        self.model_dir.mkdir(parents=True, exist_ok=True)
        (self.model_dir / "torch").mkdir(exist_ok=True)
        (self.model_dir / "yolo").mkdir(exist_ok=True)
        os.environ.setdefault("TORCH_HOME", str(self.model_dir / "torch"))
        # transformers probes for TensorFlow and Flax on import, which costs
        # seconds and prints oneDNN banners into the logs. Nothing here is
        # anything but PyTorch.
        os.environ.setdefault("TRANSFORMERS_NO_TF", "1")
        os.environ.setdefault("USE_TF", "0")
        os.environ.setdefault("USE_FLAX", "0")
        os.environ.setdefault("YOLO_CONFIG_DIR", str(self.model_dir / "yolo"))
        # ultralytics resolves a bare weights name against its own settings dir;
        # giving it an absolute path keeps the checkpoint out of the CWD.
        os.environ.setdefault("AURA_YOLO_PATH", str(self.model_dir / "yolo" / self.yolo_weights))

    @property
    def yolo_path(self) -> Path:
        return self.model_dir / "yolo" / self.yolo_weights

    @property
    def torch_device(self) -> str:
        if self.device != "auto":
            return self.device
        try:
            import torch

            return "cuda" if torch.cuda.is_available() else "cpu"
        except Exception:
            return "cpu"


@lru_cache(maxsize=1)
def settings() -> Settings:
    s = Settings()
    s.prepare()
    return s
