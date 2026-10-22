"use client";

import { useCallback, useEffect, useState } from "react";
import { storage } from "@/lib/storage/idb";
import type { ProjectSummary, UserPreferences } from "@/lib/storage/types";
import { DEFAULT_PREFERENCES } from "@/lib/storage/types";

export function useProjects() {
  const [projects, setProjects] = useState<ProjectSummary[] | null>(null);

  const refresh = useCallback(async () => {
    try {
      setProjects(await storage.listProjects());
    } catch {
      // A blocked/absent IndexedDB is a valid state, not a crash — the app
      // still works, it just has nothing saved to show.
      setProjects([]);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const remove = useCallback(
    async (id: string) => {
      await storage.deleteProject(id);
      await refresh();
    },
    [refresh],
  );

  return { projects, refresh, remove, loading: projects === null };
}

export function usePreferences() {
  const [prefs, setPrefs] = useState<UserPreferences | null>(null);

  useEffect(() => {
    let alive = true;
    storage
      .getPreferences()
      .then((p) => alive && setPrefs(p))
      .catch(() => alive && setPrefs(DEFAULT_PREFERENCES));
    return () => {
      alive = false;
    };
  }, []);

  const update = useCallback(
    async (patch: Partial<UserPreferences>) => {
      const next = { ...(prefs ?? DEFAULT_PREFERENCES), ...patch };
      setPrefs(next);
      await storage.savePreferences(next);
    },
    [prefs],
  );

  const toggleSavedProduct = useCallback(
    async (id: string) => {
      const current = prefs ?? DEFAULT_PREFERENCES;
      const has = current.savedProductIds.includes(id);
      await update({
        savedProductIds: has
          ? current.savedProductIds.filter((p) => p !== id)
          : [...current.savedProductIds, id],
      });
    },
    [prefs, update],
  );

  return { prefs: prefs ?? DEFAULT_PREFERENCES, ready: prefs !== null, update, toggleSavedProduct };
}
