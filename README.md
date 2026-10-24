# AURA

**See your dream room before you buy anything.**

Photograph your room — one shot per surface — and AURA rebuilds it as real 3D
geometry: four walls, floor and ceiling, each textured from the photo that saw
it. Put your actual bed, desk and wardrobe in, then drop in aesthetic decor that
is sized to its true centimetres, snaps to your real walls, rests on your real
desk, and refuses to clip through anything.

```bash
npm install
npm run dev          # http://localhost:3000
```

Node 20+. No API keys, no accounts. It runs entirely in the browser.

### Optional: the analysis service

There is a Python service in [`backend/`](backend/) that reads depth and finds
furniture, turning the corner-marking step from a guess into a correction.

```bash
pip install -r backend/requirements.txt
npm run api          # http://localhost:8000
```

**The app does not need it.** If nothing is listening, onboarding solves the
perspective in the browser exactly as before — the service is an upgrade to
one step, not a dependency, and that is enforced by the order the code runs
in rather than by a try/catch: the local solve runs first and unconditionally,
so a usable answer is already on screen before the service is even asked.
A cold or wedged backend costs the user a 25-second timeout at worst.

---

## The idea

Most "room designer" tools either make you build a floor plan by hand or paste
flat PNG stickers over your photo. AURA does neither. It builds a *metric* room,
so a 60 x 90 cm poster is literally 0.6 x 0.9 world units against a wall of
known width. Every downstream feature - automatic scaling, snapping, collision,
stacking, the before/after - falls out of that one decision.

---

## Two ways to capture a room

### Full room - six photos, one per surface

The good path. Shoot each wall square-on, plus the floor and the ceiling, and
mark four corners in each. Every surface is then textured from the frame that
actually saw it: no grazing angles, no stretched pixels, no blank walls.

**Rectification** - `lib/room/homography.ts`
Four marked corners define a homography from the surface's unit square onto the
photo. That is *exact* - no camera pose, no focal length, no assumption about
where the photographer stood. A surface with no photo simply renders as clean
paint, so skipping the ceiling costs nothing.

**Scale** - typed, not inferred
Six independent photos share no camera to solve scale from, and a per-photo
estimate would compound error across six surfaces into a visibly
out-of-proportion room. So the dimensions are measured and typed, with a live
plan view that makes a typo obvious.

### Quick look - one photo

For trying it out. One image, perspective solved, a room built around it: the
wall you shot looks right and the rest is clean paint. Projects created this way
keep working and can have surface photos added later.

With the analysis service running, this path gets measured rather than
estimated: depth fixes the room's real proportions, the four corners arrive
already on the wall, and furniture the detector recognised is placed at its
true size. What was measured and what was assumed is shown, not averaged into
one confident-looking number — see [backend/README.md](backend/README.md) for
why that distinction is the interesting part.

**1. Vanishing point** - `lib/room/perspective.ts`
Downscale, Sobel, then a gradient-guided Hough transform (each edge pixel votes
only near its own gradient direction, ~90x cheaper than a full sweep), keeping
the *diagonal* lines - in a room photo those are the receding edges - and
intersecting them by weighted least squares. ~40 ms, no model weights, no
network call.

**2. Back wall** - the user confirms it
Four draggable corners over the photo, seeded from the estimate along the rays
from the vanishing point to the image corners (the "spidery mesh" of *Tour Into
The Picture*, Horry et al. 1997).

**3. Metric scale** - one honest assumption
A single image cannot determine absolute scale. AURA fixes it with the camera's
height above the floor, exposed as a slider rather than hidden as a magic
number, and derives everything else from the pinhole geometry.

### Texturing, both paths - `lib/room/mesh.ts`

Each surface is subdivided into a grid and every vertex solved exactly -
through a homography in full mode, through the reconstructed camera in quick
mode. Mapping a plane into an image is projective, but GPUs interpolate UVs
affinely per triangle, so two triangles per wall gives a visible crease down the
diagonal of a foreshortened floor. Each vertex also carries a `coverage` weight,
and the room material dissolves from photo texture into flat palette colour
exactly where no photo reached.

---

## Your actual furniture

A room full of decor floating in an empty box is not your room. Furniture
(`lib/catalog/furniture.ts`) puts the real volumes in:

- **From the library** - bed, desk, wardrobe, bookshelf, nightstand, dresser,
  sofa, chair, TV unit, door, window, at real sizes.
- **Traced from a photo** - `lib/room/wallPlacement.ts`. Draw a box around your
  wardrobe in a wall photo and the wall's homography converts those pixels back
  to metres: real width, real height, real position along that wall, with the
  traced crop textured onto its face.

Furniture reuses the `Product` shape deliberately, so placement, collision,
stacking, gravity and undo all work on it unchanged. Heights are the *surface*
height, not the silhouette - a bed is 50 cm because that is where a book would
land; headboards and chair backs are drawn above the box on purpose.

The payoff is that you can now put a lamp **on** your desk. Small objects prefer
a real tabletop over the floor, ranked by what the furniture is *for* - a desk
and a nightstand exist to have things on them, a bed does not.

---

## Making it look real

The gap between "a 3D box with shapes in it" and "my room with that lamp in
it" is almost entirely lighting and contact. The things that close it here:

**Neon is lit, not drawn.** A sign is a glass tube with a hot core, an additive
bloom shell, standoff pins and — the part that matters — a halo thrown onto the
wall behind it. Real neon lights the wall around it; without that spill the eye
reads the tube as a sticker no matter how bright it is. There is deliberately
no dark backplate: a panel *occludes* the wall instead of lighting it, which is
what makes a sign look like it is floating in front of the room.

**Objects cast contact shadows.** Over a photo-textured room the light rig is
turned right down — the photo already contains its own lighting — which leaves
real shadows too faint to anchor anything. A soft ellipse scaled to each
object's footprint does the grounding instead.

**Corners are shaded.** Every surface vertex carries its distance to the
nearest edge, and the last ~35cm into each junction darkens. That reads as
ambient occlusion, and it turns the floor/wall seam from a hard mismatched line
into a soft shadow — which is exactly where a slightly-off calibration shows.

**Projector lamps project.** `components/studio/ProjectionPool.tsx` intersects
the beam with the room box and draws the pattern where it lands, sized by throw
distance and smeared when it hits at a grazing angle. Doing it geometrically
rather than through `SpotLight.map` avoids a shadow map per lamp and, more
importantly, actually renders.

**Lights respect the photo.** A lamp at full strength blows the wall next to it
to white, for the same reason the room rig is turned down: that wall already
has lighting baked into its pixels.

### Or use the actual product photo

Procedural models can be plausible; they can never be the specific thing you
are about to buy. So for flat wall decor — posters, prints, neon, wall lights —
you can drop in the seller's own image and it is background-removed
(`lib/three/cutout.ts`) and hung at its real centimetres. A flat cutout is not
an approximation there: the object really is flat.

The removal floods inward from the frame edge rather than thresholding on
colour, so white lettering *inside* a product survives while the white backdrop
around it goes. It warns you when the border looks busy, i.e. when you have
handed it a lifestyle shot rather than a studio one.

**The app ships no scraped photography.** Everything built in is procedural;
real photos are yours, added by you, for your own room.

---

## Your own items

Anything the catalog doesn't have can be added by the user: paste a link (a
Pinterest pin, an Amazon/IKEA/Etsy listing, any page with a product image, or a
direct image link), upload a photo, or build a plain shape. The builder asks
for the one thing a picture can't tell us — the real size — with presets and
the photo's proportions kept, then the item behaves exactly like a catalog
product: it snaps, stacks, collides and travels with the furniture it sits on.

In 3D a photo becomes a flat cutout (posters, prints), a raised cutout with
real thickness (signs, frames), a standee that turns to face the camera, or —
the default for standing things — a **3D** solid. One photo never sees an
object's back, so the 3D shape is built from what it does show exactly, the
outline: `lib/three/inflate.ts` puffs the silhouette into a rounded body at
the item's real width, height and depth (thick in the middle, a rounded rim,
the photo wrapped over the front and mirrored on the back). It is the classic
single-view "inflation" trick, runs in the browser in milliseconds and costs
nothing; true reconstruction of an unseen back needs a learned image-to-3D
model, which is a paid or GPU-hosted upgrade. Plain shapes get
the same finishes as the furniture (wood, fabric, metal, gloss).

**Security.** Link import runs through `app/api/import` because browsers
can't read other sites' pages. `lib/server/safeFetch.ts` only fetches public
http(s) addresses on default ports: every resolved IP is checked against
private, loopback and link-local ranges *inside the socket's own DNS lookup*
(no rebinding window), redirects are re-checked hop by hop, and responses are
capped in size and time. Images are accepted only if their bytes are
JPEG/PNG/WEBP/GIF, and the browser then redraws them onto a canvas before
use, so only pixels survive. Imported text is reduced to plain characters.

**For seeing, not selling.** User items exist to visualise decor in your own
room: they carry no price and no shop link, and import reads only a picture
and a name. They are saved only in this browser (and embedded in the rooms
that use them). Imported photos belong to whoever took them; they never feed
the shared catalog.

---

## Placement

`lib/placement/resolve.ts` is a single entry point that runs on every frame of a
drag: pick the legal target for this mount type → clamp the footprint to stay on
that surface → grid snap → align to neighbours (emitting guides) → push out of
collisions. It returns either a valid placement or a specific reason it isn't,
which the ghost renders as colour and the toolbar renders as a hint.

Things it gets right that are easy to get wrong:

- **Flat items on the same wall.** A 2 mm poster and a 25 mm neon sign barely
  overlap along the wall normal, so a collision tolerance large enough to stop
  objects fighting is also large enough to let two pictures hang in exactly the
  same place. On a wall, collision is a question about the wall *plane* only.
- **Rugs are surfaces, not obstacles.** Floor coverings under 4 cm are excluded
  from collision and included in stacking, so a plant dropped on a rug stands on
  the rug instead of being shoved off it.
- **Gravity after deletion.** Delete a shelf and its figures fall to the next
  surface below rather than hanging in mid-air.
- **Wall fallback.** Drag a poster over the floor and it slides along whichever
  wall is behind the cursor, instead of the ghost vanishing.

---

## Before / after

The payoff shot. The "after" renders from the room's reference viewpoint at its
exact aspect and principal point — an off-centre principal point has to be
expressed as a view offset out of a larger symmetric virtual frame, which
`lib/three/photoCamera.ts` works out. The result lines up pixel for pixel, so
the slider reveals a true transformation of the same frame rather than two
loosely similar views.

In quick mode that reference is the original photo. In full mode there is no
single view of the whole room, but there *is* a straight-on shot of each wall -
so the comparison flattens the hero wall's photo (`lib/room/rectify.ts`, a
piecewise-affine warp, because Canvas2D has no projective transform) and
compares it against the head-on render of that same wall.

It renders into the studio's existing canvas rather than opening a second one.
Two live WebGL contexts is enough to get one dropped on a modest GPU.

---

## What's real and what's seeded

| | |
|---|---|
| Perspective solve, reconstruction, placement, collision, stacking | Real, deterministic, no network |
| 94-product catalog | Curated seed data with true-to-life cm dimensions |
| 13-piece furniture set | Generic stand-ins at real sizes, or traced from your own photo |
| Product 3D models | Procedural — primitives, lathes and canvas textures, no downloaded assets |
| Product photography | None shipped. You can mount your own image on flat wall decor |
| Prices, brands, ratings | Representative house entries, **not** scraped listings |
| Marketplace links | `amazon.in` **search** URLs, not fabricated ASINs |
| Design assistant | Deterministic scoring engine, not a language model |
| Room analysis | Real: YOLOv8 detection + monocular depth, solved to metres. Optional service |
| AR | Camera passthrough with true-size scaling, not WebXR plane anchoring |

The catalog sits behind a `CatalogSource` interface (`lib/catalog/source.ts`), so
a live Amazon PA-API implementation drops in by changing one line. Set
`NEXT_PUBLIC_AMAZON_ASSOCIATE_TAG` to add an affiliate tag to outbound links.

### The design assistant

`lib/assistant/engine.ts` parses intent into an aesthetic vector, scores the
catalog against it plus what's already in the room, then resolves every
suggestion through the *same* placement pipeline the drag layer uses. That last
part matters: "Apply" can never produce a poster hanging through a wall, because
the room has already accepted each placement.

### AR mode

A deliberate trade. WebXR's `immersive-ar` exists only on Android Chrome;
`getUserMedia` works on iOS Safari, Android and desktop alike — and the question
users actually want answered ("how big is this neon sign *really*?") is about
scale, not plane anchoring. Distance is a control, and on-screen size is computed
from the product's true centimetres at that distance, so the preview is
dimensionally honest even though it isn't world-locked.

---

## Storage

Local-first. Projects — including the source photo as a downscaled data URL —
live in IndexedDB behind a `StorageAdapter` interface (`lib/storage/`). Nothing
is uploaded, there are no accounts, and clearing site data deletes everything.
A hosted backend implements the same five methods.

---

## Layout

```
app/                  routes: home, onboarding, studio/[id], spaces, discover, shop, profile
components/
  onboarding/         mode choice, dimensions, surface capture, corner marking
  studio/             viewport, panels, drag controller, furniture tracer, AR, before/after
  studio/models/      ~30 procedural product models + 11 furniture models
lib/
  room/               homography, six-surface plan, perspective solve, mesh, rectify
  placement/          transforms, snapping, collision, gravity
  catalog/            product types, seed decor, furniture, source adapter
  assistant/          intent parsing, scoring, layout planning
  three/              procedural environment, canvas textures, photo camera
  storage/            IndexedDB adapter + v1 to v2 migration
```

## Performance

Low-poly procedural geometry, no downloaded assets, at most 8 simultaneous real
lights (the rest glow via emissive materials and bloom, which is visually almost
identical and free per fragment), adaptive DPR, and shadow bounds fitted to the
room so the shadow map isn't spent on empty space.

## Known limits

- One photo drives the reconstruction. Extra uploads are kept with the project
  for reference but are not fused into the geometry.
- Two-point perspective (shot into a corner) falls back to a centred one-point
  fit for the user to drag from.
- Existing furniture in the photo is texture, not geometry — you can place
  objects in front of a real desk, but not *on* it.
