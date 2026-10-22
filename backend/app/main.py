"""
AURA room-analysis service.

    uvicorn app.main:app --reload --port 8000

One endpoint does the work. `/health` is deliberately cheap and never loads a
model, so a container orchestrator can call it during the ~30 s a cold
checkpoint takes to come up; `/models` is the one that actually probes.
"""

from __future__ import annotations

import io
import logging

import numpy as np
from fastapi import Depends, FastAPI, File, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware

from .config import settings
from .pipeline import analyze as pipeline
from .pipeline import depth as depth_mod
from .pipeline import detect as detect_mod
from .schemas import AnalyzeOptions, AnalyzeResponse, HealthResponse, ModelStatus

VERSION = "1.0.0"

log = logging.getLogger("aura")
app = FastAPI(
    title="AURA room analysis",
    version=VERSION,
    summary="Monocular photo to a metric room, its surfaces and its furniture.",
)

cfg = settings()
app.add_middleware(
    CORSMiddleware,
    allow_origins=list(cfg.cors_origins),
    allow_credentials=False,
    allow_methods=["GET", "POST", "OPTIONS"],
    allow_headers=["*"],
)


@app.on_event("startup")
def _startup() -> None:
    log.info("model dir: %s (device %s)", cfg.model_dir, cfg.torch_device)
    if not cfg.preload:
        return
    # Loading the depth checkpoint takes ~30s on a cold CPU. Doing it here
    # rather than on first request moves that cost off whichever user happens
    # to arrive first -- they would otherwise watch a progress screen for the
    # entire duration, for a result a warm server returns in two seconds.
    import time

    for name, mod in (("depth", depth_mod), ("detect", detect_mod)):
        started = time.perf_counter()
        try:
            ok = mod.available()
            log.info("preloaded %s: %s in %.1fs", name, ok, time.perf_counter() - started)
        except Exception as exc:  # pragma: no cover - best effort
            log.warning("preload of %s failed: %s", name, exc)


@app.get("/health", response_model=HealthResponse)
def health() -> HealthResponse:
    """Liveness. Reports what is *configured*, without loading anything."""
    return HealthResponse(
        ok=True,
        version=VERSION,
        device=cfg.torch_device,
        modelDir=str(cfg.model_dir),
        maxSide=cfg.max_side,
        models=[
            ModelStatus(
                name=cfg.depth_model,
                ready=depth_mod._loaded_name == cfg.depth_model,
                detail=None if depth_mod._loaded_name else "not loaded yet",
            ),
            ModelStatus(
                name=cfg.yolo_weights,
                ready=detect_mod._loaded_path is not None,
                detail=None
                if detect_mod._loaded_path
                else ("weights present, not loaded yet" if cfg.yolo_path.exists() else "weights not downloaded"),
            ),
        ],
    )


@app.get("/models", response_model=list[ModelStatus])
def models() -> list[ModelStatus]:
    """Readiness. Actually loads the checkpoints, so the first call is slow."""
    out: list[ModelStatus] = []
    for name, mod in ((cfg.depth_model, depth_mod), (cfg.yolo_weights, detect_mod)):
        try:
            mod._load()  # type: ignore[attr-defined]
            out.append(ModelStatus(name=name, ready=True))
        except Exception as exc:
            out.append(ModelStatus(name=name, ready=False, detail=str(exc)))
    return out


def _options(
    cameraHeight: float = 1.5,
    fovDeg: float = 60.0,
    frontExtension: float = 1.2,
    ceilingHeight: float = 2.7,
    detectConf: float = 0.30,
    detect: bool = True,
) -> AnalyzeOptions:
    return AnalyzeOptions(
        cameraHeight=cameraHeight,
        fovDeg=fovDeg,
        frontExtension=frontExtension,
        ceilingHeight=ceilingHeight,
        detectConf=detectConf,
        detect=detect,
    )


def decode(data: bytes, max_side: int) -> np.ndarray:
    """Bytes -> RGB uint8, downscaled so the long edge is at most max_side."""
    import cv2

    buf = np.frombuffer(data, dtype=np.uint8)
    bgr = cv2.imdecode(buf, cv2.IMREAD_COLOR)
    if bgr is None:
        raise HTTPException(415, "could not decode that image")

    h, w = bgr.shape[:2]
    if max(h, w) > max_side:
        s = max_side / max(h, w)
        bgr = cv2.resize(
            bgr, (max(1, int(round(w * s))), max(1, int(round(h * s)))),
            interpolation=cv2.INTER_AREA,
        )
    if min(bgr.shape[:2]) < 64:
        raise HTTPException(422, "image is too small to reconstruct a room from")
    return cv2.cvtColor(bgr, cv2.COLOR_BGR2RGB)


@app.post("/analyze", response_model=AnalyzeResponse)
async def analyze_endpoint(
    image: UploadFile = File(..., description="A photo of the room"),
    opts: AnalyzeOptions = Depends(_options),
) -> AnalyzeResponse:
    """
    Reconstruct a room from one photo.

    `cameraHeight` is the single assumption that fixes absolute scale, so it
    is a parameter rather than a constant: everything the response calls a
    metre is a metre only insofar as this value is right. The app exposes it
    as a slider for the same reason.
    """
    raw = await image.read()
    if not raw:
        raise HTTPException(422, "empty upload")
    if len(raw) > cfg.max_upload_mb * 1024 * 1024:
        raise HTTPException(413, f"image exceeds {cfg.max_upload_mb:g} MB")

    rgb = decode(raw, cfg.max_side)

    try:
        report = pipeline.analyze(
            rgb,
            pipeline.Options(
                camera_height=opts.cameraHeight,
                fov_deg=opts.fovDeg,
                front_extension=opts.frontExtension,
                ceiling_height=opts.ceilingHeight,
                detect_conf=opts.detectConf,
                detect=opts.detect,
            ),
        )
    except depth_mod.ModelUnavailable as exc:
        # 503 rather than 500: the request was fine, the server is not ready.
        raise HTTPException(503, f"depth model unavailable: {exc}") from exc
    except MemoryError as exc:  # pragma: no cover
        raise HTTPException(507, "ran out of memory analysing that image") from exc

    return AnalyzeResponse(**report.body)


@app.get("/")
def root() -> dict:
    return {
        "service": "aura-room-analysis",
        "version": VERSION,
        "endpoints": ["/health", "/models", "/analyze", "/docs"],
    }
