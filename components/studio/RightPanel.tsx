"use client";

import * as React from "react";
import {
  ChevronRight,
  Copy,
  ExternalLink,
  PackagePlus,
  MousePointer2,
  Ruler,
  Trash2,
} from "lucide-react";
import { formatDims, formatINR, marketplaceUrl } from "@/lib/catalog/source";
import { isWallSurface } from "@/lib/placement/transform";
import { useSelected, useStudio } from "@/lib/store/studio";
import { Badge, Button, Divider, IconButton, SectionLabel, Slider } from "@/components/ui/primitives";
import type { Vec3 } from "@/lib/room/types";
import { ProductThumb } from "./ProductThumb";
import { RealPhotoField } from "./RealPhotoField";

const DEG = 180 / Math.PI;

/**
 * Inspector for the selected object.
 *
 * Position is expressed in the axes that make sense for how the item is
 * mounted — "across the wall" and "height" for a poster, "left–right" and
 * "front–back" for a plant — rather than raw world X/Y/Z, which would ask the
 * user to hold the room's coordinate frame in their head.
 */
export function RightPanel() {
  const setOpen = useStudio((s) => s.setRightPanel);
  const setLeftOpen = useStudio((s) => s.setLeftPanel);
  const room = useStudio((s) => s.room);
  const updateItem = useStudio((s) => s.updateItem);
  const resolveItem = useStudio((s) => s.resolveItem);
  const removeItem = useStudio((s) => s.removeItem);
  const duplicateItem = useStudio((s) => s.duplicateItem);
  const { item, product } = useSelected();

  return (
    <aside className="pointer-events-auto z-30 flex h-full w-full flex-col md:w-[286px] border-l border-white/8 bg-ink-1/90 backdrop-blur-xl">
      <header className="flex items-center justify-between gap-2 px-4 pb-3 pt-4">
        <h2 className="text-[14px] font-semibold tracking-[-0.02em]">
          {item ? "Selected" : "Nothing selected"}
        </h2>
        <IconButton label="Collapse panel" size="sm" onClick={() => setOpen(false)}>
          <ChevronRight className="size-4" />
        </IconButton>
      </header>

      {!item || !product || !room ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-3 px-6 text-center">
          <div className="grid size-11 place-items-center rounded-[13px] bg-white/5 text-chalk-3">
            <MousePointer2 className="size-4.5" />
          </div>
          <p className="text-[13px] font-medium text-chalk-2">Click something in your room</p>
          <p className="text-[12px] leading-relaxed text-chalk-4">
            Position, rotation and size controls appear here.
          </p>
        </div>
      ) : (
        <div className="min-h-0 flex-1 overflow-y-auto">
          {/* ---------------- Product ---------------- */}
          <div className="px-4 pb-4">
            <div className="flex gap-3">
              <ProductThumb product={product} className="size-16 shrink-0" />
              <div className="min-w-0 flex-1">
                <p className="text-[13px] font-semibold leading-tight tracking-[-0.015em]">
                  {product.name}
                </p>
                <p className="mt-0.5 text-[11.5px] text-chalk-4">{product.brand}</p>
                <p className="mt-1.5 text-[13px] font-semibold text-accent">
                  {formatINR(product.price)}
                </p>
              </div>
            </div>

            <a
              href={marketplaceUrl(product)}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-3 inline-flex h-8 w-full items-center justify-center gap-1.5 rounded-[10px] border border-white/12 text-[12.5px] font-medium text-chalk-2 transition-all hover:border-white/25 hover:text-chalk"
            >
              Find it on Amazon.in
              <ExternalLink className="size-3.5" />
            </a>

            {product.mount === "wall" && (
              <RealPhotoField
                current={item.customImage}
                onChange={(customImage) => updateItem(item.id, { customImage })}
              />
            )}
          </div>

          <Divider />

          {/* ---------------- Size ---------------- */}
          <div className="space-y-3 px-4 py-4">
            <SectionLabel
              action={
                <Badge tone={Math.abs(item.scale - 1) < 0.01 ? "accent" : "neutral"}>
                  {Math.abs(item.scale - 1) < 0.01 ? "TRUE SIZE" : `${Math.round(item.scale * 100)}%`}
                </Badge>
              }
            >
              Size
            </SectionLabel>

            <p className="flex items-center gap-1.5 text-[11.5px] tabular-nums text-chalk-3">
              <Ruler className="size-3 text-chalk-4" />
              {formatDims(product)}
              {Math.abs(item.scale - 1) >= 0.01 && (
                <span className="text-chalk-4">
                  → {(product.dims.w * item.scale).toFixed(0)} ×{" "}
                  {(product.dims.h * item.scale).toFixed(0)} cm
                </span>
              )}
            </p>

            <Slider
              label="Scale"
              value={item.scale}
              min={0.35}
              max={2.5}
              step={0.01}
              format={(v) => `${Math.round(v * 100)}%`}
              onChange={(scale) => updateItem(item.id, { scale }, false)}
              onCommit={() => resolveItem(item.id)}
            />

            {Math.abs(item.scale - 1) >= 0.01 && (
              <button
                onClick={() => {
                  updateItem(item.id, { scale: 1 });
                  resolveItem(item.id);
                }}
                className="text-[11.5px] font-medium text-accent transition-opacity hover:opacity-75"
              >
                Reset to real-world size
              </button>
            )}
          </div>

          <Divider />

          {/* ---------------- Rotation ---------------- */}
          <div className="space-y-3 px-4 py-4">
            <SectionLabel>Rotation</SectionLabel>
            {isWallSurface(item.surface) ? (
              <Slider
                label="Tilt on wall"
                value={item.spin * DEG}
                min={-45}
                max={45}
                step={1}
                format={(v) => `${Math.round(v)}°`}
                onChange={(deg) => updateItem(item.id, { spin: deg / DEG }, false)}
                onCommit={() => resolveItem(item.id)}
              />
            ) : (
              <Slider
                label="Turn"
                value={item.yaw * DEG}
                min={-180}
                max={180}
                step={1}
                format={(v) => `${Math.round(v)}°`}
                onChange={(deg) => updateItem(item.id, { yaw: deg / DEG }, false)}
                onCommit={() => resolveItem(item.id)}
              />
            )}
            <div className="flex gap-1.5">
              {[0, 45, 90, 180].map((deg) => (
                <button
                  key={deg}
                  onClick={() => {
                    const rad = (deg / DEG) * (deg === 0 ? 0 : 1);
                    updateItem(
                      item.id,
                      isWallSurface(item.surface) ? { spin: deg > 45 ? 0 : rad } : { yaw: rad },
                    );
                    resolveItem(item.id);
                  }}
                  className="h-7 flex-1 rounded-[8px] bg-white/5 text-[11px] font-medium text-chalk-3 transition-colors hover:bg-white/10 hover:text-chalk"
                >
                  {deg}°
                </button>
              ))}
            </div>
          </div>

          <Divider />

          {/* ---------------- Position ---------------- */}
          <div className="space-y-3 px-4 py-4">
            <SectionLabel>Position</SectionLabel>
            <PositionControls
              itemId={item.id}
              position={item.position}
              surface={item.surface}
              roomWidth={room.dimensions.width}
              roomHeight={room.dimensions.height}
              roomDepth={room.dimensions.depth}
              onChange={(position) => updateItem(item.id, { position }, false)}
              onCommit={() => resolveItem(item.id)}
            />
            {item.supportId && (
              <p className="text-[11.5px] text-chalk-4">
                Resting on another object — it&apos;ll follow if you move that.
              </p>
            )}
          </div>

          <Divider />

          {/* ---------------- Actions ---------------- */}
          {product.stackable && product.model !== "rug" && product.model !== "checkerRug" ? (
            <div className="px-4 pt-4">
              <Button
                variant="primary"
                size="sm"
                className="w-full"
                onClick={() => {
                  // The library's "+" now targets this surface. On phones the
                  // two panels share the bottom of the screen, so this one
                  // steps aside; the selection itself stays.
                  setLeftOpen(true);
                  if (window.matchMedia("(max-width: 767px)").matches) setOpen(false);
                }}
              >
                <PackagePlus className="size-3.5" />
                Put something on it
              </Button>
            </div>
          ) : null}
          <div className="flex gap-2 px-4 py-4">
            <Button
              variant="secondary"
              size="sm"
              className="flex-1"
              onClick={() => duplicateItem(item.id)}
            >
              <Copy className="size-3.5" />
              Duplicate
            </Button>
            <Button
              variant="danger"
              size="sm"
              className="flex-1"
              onClick={() => removeItem(item.id)}
            >
              <Trash2 className="size-3.5" />
              Delete
            </Button>
          </div>
        </div>
      )}
    </aside>
  );
}

function PositionControls({
  position,
  surface,
  roomWidth,
  roomHeight,
  roomDepth,
  onChange,
  onCommit,
}: {
  itemId: string;
  position: Vec3;
  surface: string | null;
  roomWidth: number;
  roomHeight: number;
  roomDepth: number;
  onChange: (p: Vec3) => void;
  onCommit: () => void;
}) {
  const onSideWall = surface === "left" || surface === "right";
  const onWall = isWallSurface(surface as never);

  if (onWall) {
    // Along a side wall the item slides in Z; along the back wall, in X.
    const acrossValue = onSideWall ? position[2] : position[0];
    const acrossLimit = onSideWall ? roomDepth / 2 : roomWidth / 2;

    return (
      <>
        <Slider
          label="Across wall"
          value={acrossValue}
          min={-acrossLimit}
          max={acrossLimit}
          step={0.01}
          format={(v) => `${v >= 0 ? "+" : ""}${v.toFixed(2)} m`}
          onChange={(v) =>
            onChange(
              onSideWall ? [position[0], position[1], v] : [v, position[1], position[2]],
            )
          }
          onCommit={onCommit}
        />
        <Slider
          label="Height from floor"
          value={position[1]}
          min={0}
          max={roomHeight}
          step={0.01}
          format={(v) => `${v.toFixed(2)} m`}
          onChange={(v) => onChange([position[0], v, position[2]])}
          onCommit={onCommit}
        />
      </>
    );
  }

  return (
    <>
      <Slider
        label="Left – right"
        value={position[0]}
        min={-roomWidth / 2}
        max={roomWidth / 2}
        step={0.01}
        format={(v) => `${v >= 0 ? "+" : ""}${v.toFixed(2)} m`}
        onChange={(v) => onChange([v, position[1], position[2]])}
        onCommit={onCommit}
      />
      <Slider
        label="Back – front"
        value={position[2]}
        min={-roomDepth / 2}
        max={roomDepth / 2}
        step={0.01}
        format={(v) => `${v >= 0 ? "+" : ""}${v.toFixed(2)} m`}
        onChange={(v) => onChange([position[0], position[1], v])}
        onCommit={onCommit}
      />
      <Slider
        label="Height"
        value={position[1]}
        min={0}
        max={Math.max(0.1, roomHeight - 0.1)}
        step={0.01}
        format={(v) => `${v.toFixed(2)} m`}
        onChange={(v) => onChange([position[0], v, position[2]])}
        onCommit={onCommit}
      />
    </>
  );
}
