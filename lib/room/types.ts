/**
 * Room reconstruction types.
 *
 * Everything in this module is METRIC. All positions, dimensions and offsets
 * are in METRES, in a right-handed room-local coordinate frame:
 *
 *     +X → right (looking at the back wall)
 *     +Y → up    (0 = floor plane)
 *     +Z → toward the camera / front of the room
 *
 * The back wall sits at z = -depth/2, the front wall at z = +depth/2, so the
 * room is centred on the origin in X/Z and rests on Y=0. Keeping the floor at
 * Y=0 means "sit on the floor" is literally `y = 0` and gravity is a subtract.
 */

export type Vec2 = [number, number];
export type Vec3 = [number, number, number];

/** Which of the six room planes a surface is. */
export type SurfaceId = "floor" | "ceiling" | "back" | "front" | "left" | "right";

/** Normalised image coordinates (0..1), origin top-left. */
export interface Quad {
  tl: Vec2;
  tr: Vec2;
  br: Vec2;
  bl: Vec2;
}

/**
 * The user-editable inputs to reconstruction. This is the whole "calibration"
 * state — four back-wall corners plus two physical assumptions. Persisting
 * these lets us re-derive the room exactly without re-running any estimation.
 */
export interface RoomCalibration {
  /** Back wall rectangle in normalised image space (0..1). */
  backWall: Quad;
  /** Vanishing point in normalised image space. Also the assumed principal point. */
  vanishingPoint: Vec2;
  /** Horizontal field of view of the capturing camera, in degrees. */
  fovDeg: number;
  /** Height of the camera above the floor when the photo was taken, in metres. */
  cameraHeight: number;
  /** How far in front of the camera the room is considered to end, in metres. */
  frontExtension: number;
}

/**
 * How a surface gets its pixels.
 *
 *   none       — no photo covers it; render flat palette colour
 *   projected  — quick mode: one photo projected from the reconstructed camera
 *   rectified  — full mode: this surface's own photo, mapped by a homography
 */
export type SurfaceTexture =
  | { kind: "none" }
  | { kind: "projected" }
  | { kind: "rectified"; imageId: string; quad: Quad };

/** One planar surface of the room box. */
export interface RoomSurface {
  id: SurfaceId;
  /**
   * Corners in room-local metres, ordered TOP-LEFT, TOP-RIGHT, BOTTOM-RIGHT,
   * BOTTOM-LEFT **as seen by someone standing inside the room facing it**.
   *
   * That ordering is what makes surface-local (s,t) run the way a photo does —
   * s left-to-right, t top-to-bottom — so a rectified photo lands the right way
   * up without a per-surface special case. Winding is irrelevant here because
   * normals are written explicitly and the room material is double-sided.
   */
  corners: [Vec3, Vec3, Vec3, Vec3];
  /** Inward-facing normal (points into the room volume). */
  normal: Vec3;
  texture: SurfaceTexture;
}

export interface RoomDimensions {
  width: number;
  height: number;
  depth: number;
  /** Distance from camera to back wall, metres. */
  backWallDistance: number;
}

/** The full reconstructed room. */
export interface RoomGeometry {
  dimensions: RoomDimensions;
  surfaces: RoomSurface[];
  /** Reference camera pose in room-local space — the view a "before" shot came from. */
  camera: {
    position: Vec3;
    target: Vec3;
    fovDeg: number;
    /** Vertical fov derived from horizontal fov + image aspect, for three.js. */
    fovYDeg: number;
    /**
     * Principal point in the reference frame, normalised. Quick mode puts it
     * at the solved vanishing point, which is usually off-centre and has to be
     * reproduced exactly for a before/after to line up; a head-on full-mode
     * shot has no offset, so it sits at [0.5, 0.5].
     */
    principal: Vec2;
  };
  /** Aspect ratio (w/h) of the reference frame. */
  imageAspect: number;
  /** In full mode, which surface the head-on reference view shows. */
  hero?: SurfaceId;
  /** Dominant colours sampled from the photo, used for untextured surfaces. */
  palette: {
    wall: string;
    floor: string;
    ceiling: string;
    accent: string;
  };
}

export interface RoomSource {
  /** Object URL or data URL of the uploaded photo. */
  imageUrl: string;
  width: number;
  height: number;
}

/* ------------------------------------------------------------------ */
/* Full-room plan (six surfaces)                                       */
/* ------------------------------------------------------------------ */

/** One photo assigned to one surface, with the surface's corners marked in it. */
export interface SurfacePhoto {
  imageId: string;
  quad: Quad;
}

/**
 * The full-room capture.
 *
 * Dimensions are typed by the user rather than inferred. With six independent
 * photos there is no shared camera to solve scale from, and a per-photo
 * estimate would compound error across six surfaces into a visibly
 * out-of-proportion room. One measured wall beats six guesses.
 */
export interface RoomPlan {
  dimensions: { width: number; height: number; depth: number };
  surfaces: Partial<Record<SurfaceId, SurfacePhoto>>;
}

/** Which capture path produced a project. */
export type CaptureMode = "quick" | "full";

