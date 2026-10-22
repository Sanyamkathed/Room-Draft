"use client";

import { del, get, keys, set } from "idb-keyval";
import type {
  LegacyProjectV1,
  Project,
  ProjectSummary,
  StorageAdapter,
  UserPreferences,
} from "./types";
import { DEFAULT_PREFERENCES, migrateProject } from "./types";

const PROJECT_PREFIX = "aura:project:";
const PREFS_KEY = "aura:prefs";

function summarise(p: Project): ProjectSummary {
  return {
    id: p.id,
    name: p.name,
    updatedAt: p.updatedAt,
    itemCount: p.items.length,
    thumbnail: p.thumbnail,
    aesthetic: p.aesthetic,
    mode: p.mode,
    surfacesCaptured: p.plan ? Object.keys(p.plan.surfaces).length : 0,
  };
}

/**
 * Local-first storage.
 *
 * Projects carry their source photos inline as data URLs, so a design survives
 * a reload, a browser restart and being offline. Nothing leaves the device.
 * Reads run through `migrateProject`, so a room saved before six-surface
 * capture existed still opens.
 */
export class IdbStorageAdapter implements StorageAdapter {
  async listProjects(): Promise<ProjectSummary[]> {
    const allKeys = (await keys()) as string[];
    const projectKeys = allKeys.filter(
      (k) => typeof k === "string" && k.startsWith(PROJECT_PREFIX),
    );

    const projects = await Promise.all(
      projectKeys.map((k) => get<Project | LegacyProjectV1>(k)),
    );

    return projects
      .filter((p): p is Project | LegacyProjectV1 => Boolean(p))
      .map((p) => summarise(migrateProject(p)))
      .sort((a, b) => b.updatedAt - a.updatedAt);
  }

  async getProject(id: string): Promise<Project | undefined> {
    const raw = await get<Project | LegacyProjectV1>(PROJECT_PREFIX + id);
    return raw ? migrateProject(raw) : undefined;
  }

  async saveProject(project: Project): Promise<void> {
    await set(PROJECT_PREFIX + project.id, project);
  }

  async deleteProject(id: string): Promise<void> {
    await del(PROJECT_PREFIX + id);
  }

  async getPreferences(): Promise<UserPreferences> {
    const stored = await get<UserPreferences>(PREFS_KEY);
    return { ...DEFAULT_PREFERENCES, ...(stored ?? {}) };
  }

  async savePreferences(prefs: UserPreferences): Promise<void> {
    await set(PREFS_KEY, prefs);
  }
}

export const storage: StorageAdapter = new IdbStorageAdapter();

export function newProjectId(): string {
  return `sp_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
}

export function newImageId(): string {
  return `img_${Math.random().toString(36).slice(2, 9)}`;
}
