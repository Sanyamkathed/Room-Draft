# AURA room analysis service

One photo in, a metric room out: dimensions, the six surfaces projected back
into the photo, the furniture already in the room, and a calibration the web
app can load directly.

```bash
pip install -r requirements.txt
cp .env.example .env          # point AURA_MODEL_DIR somewhere with a few GB
uvicorn app.main:app --port 8000 --reload
```

`http://localhost:8000/docs` for the interactive schema.

```bash
curl -F image=@room.jpg "http://localhost:8000/analyze?cameraHeight=1.45&fovDeg=62"
```

Weights download on first use (~101 MB total) and are cached under
`AURA_MODEL_DIR`. Nothing is loaded at import, so the process starts
immediately and `/health` answers during the warm-up; `/models` is the
endpoint that actually probes.

---

## The problem worth explaining

Monocular depth models return **disparity on an unknown affine scale** — the
true inverse depth is `a·d + b` for two constants nobody tells you. Invert it
naively and the room is not merely the wrong size, it is the wrong *shape*:
flat floors come out curved, and every plane fit downstream fails.

Write the ray through a pixel as `m = K⁻¹[u v 1]` (note `m_z = 1`) and a plane
as `q·P = 1`, where `|q|` is one over the distance to it. A pixel on that
plane gives `1/z = q·m`, so with `a = 1`:

```
d = qx·mx + qy·my − c          where c = b − qz
```

That is all one plane can ever tell you. **`b` and `qz` only ever appear as
their difference**, and this is not a conditioning problem a better solver
would fix — adding a constant to inverse depth maps *every* plane to another
plane, so the entire one-parameter family is a geometrically consistent scene
made of planes. No number of fitted planes can separate them. There is a test
(`test_affine_ambiguity_is_real`) that pins this down, because it is the
reason for everything below.

What breaks the tie is a fact about rooms rather than images: **a room is a
box.** Every fitted plane's normal is a known function of the one remaining
unknown, `q_i(b) = (qxi, qyi, b − ci)`, so the correct `b` is the one making
the whole set mutually parallel-or-perpendicular — a search over a single
scalar.

Two details matter there:

- **Don't sweep `b` continuously.** As `|b|` grows every normal tends to
  `(0,0,1)`, the set becomes parallel, and a "parallel or perpendicular"
  score is perfectly happy with that. The degenerate branch always wins.
  Instead, score only the **exact pairwise perpendicularity roots** — since
  the floor really is perpendicular to the walls, the true value is among
  them, and the collapse is unreachable.
- **Don't guess the floor from pixel position.** In a level shot of a small
  room the back wall covers two thirds of the *lower* image, and a
  bottom-of-frame prior confidently fits the wall and calls it the floor.
  Nothing downstream recovers. Once `b` is known the floor identifies itself:
  it is the plane whose normal points down.

The last degree of freedom — absolute size — is the one thing a single photo
genuinely cannot know. It comes from the assumed camera height, which is a
request parameter rather than a hidden constant, for the same reason the app
exposes it as a slider.

Against ray-traced rooms with known ground truth, the solver recovers `a` and
`b` to within 1%, the vertical to under 0.5°, and metric depth to under 5 cm
everywhere in frame — across level, pitched and rolled cameras, three
different affine scrambles and 1% disparity noise.

## What it refuses to do

Confidence is reported, and so is how each number was arrived at:

- `dimensions.measuredFrom` is `plane` (two opposing surfaces fitted and the
  distance between them measured), `extent` (only the visible point cloud
  bounded it, so it is a lower bound — you cannot see behind yourself), or
  `default`. "3.4 m because we measured it" and "3.5 m because that is the
  default" should not look the same to a user.
- `depthFromPrior` is always `true` on detected objects. One view sees a
  bed's width and height and has nothing whatever to say about its length,
  so front-to-back extent is a per-class prior.
- A photo that is **almost entirely one flat wall** contains no room. The
  machinery will still produce numbers for it, so there is an explicit
  plausibility gate: if the solve implies impossible distances it downgrades
  to `partial` and says why, and the app falls back to guided corner marking.
- Shot steeply upward, the floor leaves the frame and scale is anchored on an
  assumed ceiling height instead. The error is then exactly proportional to
  how wrong that assumption is, it is flagged in `quality.anchor`, and there
  is a test asserting the proportionality rather than papering over it.

## Pipeline

```
photo ──> detect ──> depth ──> metric solve ──> room box ──> calibration
                                             └─> placed objects
                                             └─> palette
```

Detection runs **before** depth is interpreted, because the biggest threat to
fitting a floor is a bed sitting on it. Boxing the furniture first and
excluding those pixels turns "fit a plane to the lower half of a cluttered
photo" into "fit a plane to the parts of the floor you can actually see".

| module | job |
|---|---|
| `pipeline/detect.py` | YOLOv8 + the COCO→catalogue mapping and occluder mask |
| `pipeline/depth.py` | relative depth, lazily loaded |
| `pipeline/geometry.py` | the affine/Manhattan solve, plane RANSAC, room frame |
| `pipeline/planes.py` | point cloud → walls → surface quads → calibration |
| `pipeline/analyze.py` | orchestration, object placement, palette, confidence |

## Why it emits a calibration

The service does not send the app a finished room. It sends the four
back-wall corners the app's *own* solver already consumes, so the frontend's
verified reconstruction stays in charge, the corners stay draggable, and the
AI step becomes a very good first guess on a screen the user can still
correct — rather than an opaque answer they have to accept.

The catch: the frontend assumes a **level** camera with the principal point
at the vanishing point, while this pipeline solves a general pose. So the
calibration is not copied out of the solve, it is built by *inverting the
frontend's own formulas*, so that feeding it back reproduces the dimensions
measured here. `test_calibration_round_trips_through_the_frontend_solver`
ports those formulas from `lib/room/reconstruct.ts` and asserts agreement to
1e-6 — if the app's solver changes, that test fails rather than the rooms
quietly drifting.

## Models

| | default | why |
|---|---|---|
| depth | `LiheYoung/depth-anything-small-hf` | Same DPT dense-prediction head as MiDaS, far more training data, a quarter the size, ~1.5 s on a laptop CPU. Also the only pragmatic choice on the torch 2.5 line: transformers refuses to `torch.load` a `.bin` checkpoint unless torch ≥ 2.6 (CVE-2025-32434), and `Intel/dpt-hybrid-midas` ships no safetensors. |
| detection | `yolov8n.pt` | For "where is the bed", the extra mAP of the larger checkpoints does not survive being collapsed into a metre-accurate box. |

Set `AURA_DEPTH_MODEL` to `Intel/dpt-hybrid-midas` for literal MiDaS 3.0 once
torch is new enough, or to a bare name like `MiDaS_small` to go through
torch.hub (which additionally needs `timm`).

## Tests

```bash
python -m pytest tests/ -q        # 30 tests, ~8s, no checkpoints needed
```

They ray-trace box rooms with millimetre-known ground truth and scramble the
depth exactly the way a real model does. Depth and detection are stubbed, so
a failure points at this code rather than at a checkpoint that shifted under
it — and the suite runs on a machine that has never downloaded a model.

## Notes

- Uploads are capped (`AURA_MAX_UPLOAD_MB`) and downscaled to
  `AURA_MAX_SIDE`; the depth network runs at 384² internally regardless, and
  every consumer fits planes over thousands of pixels rather than reading
  individual ones.
- CORS is restricted to `AURA_CORS_ORIGINS` — the Next.js dev ports by
  default.
- The service is stateless. It stores nothing and never sees a user's photo
  twice.
