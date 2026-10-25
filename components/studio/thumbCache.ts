"use client";

import * as React from "react";
import { del, get, keys, set } from "idb-keyval";
import type { Product } from "@/lib/catalog/types";

/**
 * The light half of the 3D thumbnails: the cache and the hook.
 *
 * Every page with a product card uses this, so it must stay small. It serves
 * renders from memory or IndexedDB, and only when one is genuinely missing
 * does it load the renderer (./thumbs, which pulls in three.js) in the
 * background. A returning visitor never downloads the 3D engine just to see
 * the shop; a first-time visitor sees cards immediately and renders fade in.
 *
 * Bump THUMB_VERSION whenever the models change so stale renders refresh.
 */

const THUMB_VERSION = "v9";
const PREFIX = `aura:thumb:${THUMB_VERSION}:`;

const memory = new Map<string, string>();
const listeners = new Map<string, Set<() => void>>();
const pending = new Set<string>();
let cleanedOld = false;

export function thumbKey(p: Product): string {
  return `${p.id}:${p.custom?.updatedAt ?? 0}`;
}

function notify(key: string) {
  listeners.get(key)?.forEach((l) => l());
}

function store(key: string, url: string) {
  memory.set(key, url);
  notify(key);
  set(PREFIX + key, url).catch(() => undefined);
}

/** Rendered thumbnail for a product, or undefined until it's ready. */
export function useProductRender(product: Product): string | undefined {
  // User photos are their own best thumbnail; nothing to render.
  const skip = Boolean(product.custom?.image);
  const key = thumbKey(product);
  const [, force] = React.useReducer((n: number) => n + 1, 0);

  React.useEffect(() => {
    if (skip) return;
    let subs = listeners.get(key);
    if (!subs) listeners.set(key, (subs = new Set()));
    subs.add(force);
    if (!memory.has(key)) void request(key, product);
    return () => {
      subs!.delete(force);
    };
    // product identity changes with key; key is the real dependency.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, skip]);

  return skip ? undefined : memory.get(key);
}

async function request(key: string, product: Product) {
  if (pending.has(key)) return;
  pending.add(key);
  try {
    const stored = await get<string>(PREFIX + key);
    if (stored) {
      memory.set(key, stored);
      notify(key);
      return;
    }
  } catch {
    /* storage blocked: just render */
  } finally {
    if (!cleanedOld) {
      cleanedOld = true;
      void dropOldVersions();
    }
  }
  try {
    const { enqueueRender } = await import("./thumbs");
    enqueueRender(key, product, (url) => {
      pending.delete(key);
      if (url) store(key, url);
    });
  } catch {
    // The renderer couldn't load (offline, no WebGL): the drawn glyph stays.
    pending.delete(key);
  }
}

/** Remove renders left behind by earlier THUMB_VERSIONs. */
async function dropOldVersions() {
  try {
    const all = (await keys()) as string[];
    await Promise.all(
      all
        .filter((k) => typeof k === "string" && k.startsWith("aura:thumb:") && !k.startsWith(PREFIX))
        .map((k) => del(k)),
    );
  } catch {
    /* ignore */
  }
}
