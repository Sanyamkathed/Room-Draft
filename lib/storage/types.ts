import type { AestheticId, Product } from "@/lib/catalog/types";
import type { PlacedItem } from "@/lib/placement/types";
import type {
  CaptureMode,
  RoomCalibration,
  RoomGeometry,
  RoomPlan,
} from "@/lib/room/types";

/** One uploaded photo, downscaled. Referenced by id from surfaces and traces. */
export interface ProjectImage {
  id: string;
  /** Data URL — survives reloads, unlike an object URL. */
  dataUrl: string;
  width: number;
  height: number;
  /** Original filename, shown when picking which photo covers which surface. */
  label?: string;
}

export const PROJECT_VERSION = 2;

export interface Project {
  id: string;
  version: number;
  name: string;
  createdAt: number;
  updatedAt: number;

  /**
   * How this room was captured.
   *   quick — one photo, reconstructed by solving its perspective
   *   full  — one photo per surface, each rectified onto its own plane
   */
  mode: CaptureMode;
  images: ProjectImage[];

  /** Quick mode: the single-photo solve. */
  calibration?: RoomCalibration;
  /** Full mode: measured dimensions plus per-surface photo assignments. */
  plan?: RoomPlan;

  palette: RoomGeometry["palette"];
  items: PlacedItem[];
  aesthetic: AestheticId | null;
  /** Small JPEG data URL for the project card. */
  thumbnail?: string;
  /**
   * The user-made items this room uses, embedded so the room still renders
   * them on another device or after the item library is cleared.
   */
  customProducts?: Product[];
}

/** The pre-v2 shape, kept so saved rooms survive the upgrade. */
export interface LegacyProjectV1 {
  id: string;
  name: string;
  createdAt: number;
  updatedAt: number;
  source: { imageDataUrl: string; width: number; height: number };
  calibration: RoomCalibration;
  palette: RoomGeometry["palette"];
  items: PlacedItem[];
  aesthetic: AestheticId | null;
  thumbnail?: string;
}

/**
 * Bring a stored project up to the current shape.
 *
 * A v1 project is exactly a full project with one photo and no plan, so the
 * upgrade is a rename rather than a conversion — which is the point of keeping
 * both capture modes rather than replacing one with the other. The user can
 * then add surface photos to it later without losing anything.
 */
export function migrateProject(raw: Project | LegacyProjectV1): Project {
  if ("version" in raw && raw.version >= PROJECT_VERSION) return raw;

  const legacy = raw as LegacyProjectV1;
  return {
    id: legacy.id,
    version: PROJECT_VERSION,
    name: legacy.name,
    createdAt: legacy.createdAt,
    updatedAt: legacy.updatedAt,
    mode: "quick",
    images: [
      {
        id: "src",
        dataUrl: legacy.source.imageDataUrl,
        width: legacy.source.width,
        height: legacy.source.height,
        label: "Room photo",
      },
    ],
    calibration: legacy.calibration,
    palette: legacy.palette,
    items: legacy.items ?? [],
    aesthetic: legacy.aesthetic ?? null,
    thumbnail: legacy.thumbnail,
  };
}

export function primaryImage(project: Project): ProjectImage | undefined {
  return project.images[0];
}

export function imageById(project: Project, id: string): ProjectImage | undefined {
  return project.images.find((i) => i.id === id);
}

export interface ProjectSummary {
  id: string;
  name: string;
  updatedAt: number;
  itemCount: number;
  thumbnail?: string;
  aesthetic: AestheticId | null;
  mode: CaptureMode;
  /** How many of the six surfaces have a photo (full mode only). */
  surfacesCaptured: number;
}

/**
 * Persistence seam. The shipped implementation is IndexedDB in the browser;
 * a hosted backend implements the same five methods without the app noticing.
 */
export interface StorageAdapter {
  listProjects(): Promise<ProjectSummary[]>;
  getProject(id: string): Promise<Project | undefined>;
  saveProject(project: Project): Promise<void>;
  deleteProject(id: string): Promise<void>;
  getPreferences(): Promise<UserPreferences>;
  savePreferences(prefs: UserPreferences): Promise<void>;
}

export interface UserPreferences {
  savedProductIds: string[];
  savedAesthetics: AestheticId[];
  lastProjectId: string | null;
  /** Renderer quality; "auto" downgrades itself if the frame budget is missed. */
  quality: "auto" | "high" | "balanced" | "performance";
  /** Preferred units for room dimensions. */
  units: "m" | "ft";
}

export const DEFAULT_PREFERENCES: UserPreferences = {
  savedProductIds: [],
  savedAesthetics: [],
  lastProjectId: null,
  quality: "auto",
  units: "m",
};
