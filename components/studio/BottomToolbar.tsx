"use client";

import * as React from "react";
import {
  Box,
  Camera,
  Eye,
  Grid3x3,
  Image as ImageIcon,
  Move,
  MousePointer2,
  Orbit,
  Redo2,
  Scan,
  Square,
  Undo2,
  User,
} from "lucide-react";
import { ISSUE_MESSAGES } from "@/lib/placement/resolve";
import { useStudio, type CameraMode, type ToolMode } from "@/lib/store/studio";
import { IconButton, Segmented } from "@/components/ui/primitives";
import { cn } from "@/lib/utils/cn";

const CAMERA_OPTIONS: { value: CameraMode; label: string; icon: React.ReactNode }[] = [
  { value: "first", label: "Inside", icon: <User className="size-3.5" /> },
  { value: "orbit", label: "Orbit", icon: <Orbit className="size-3.5" /> },
  { value: "top", label: "Top", icon: <Square className="size-3.5" /> },
  { value: "photo", label: "Photo", icon: <Camera className="size-3.5" /> },
];

const TOOL_OPTIONS: { value: ToolMode; label: string; icon: React.ReactNode }[] = [
  { value: "view", label: "View", icon: <Eye className="size-3.5" /> },
  { value: "select", label: "Select", icon: <MousePointer2 className="size-3.5" /> },
  { value: "move", label: "Move", icon: <Move className="size-3.5" /> },
];

export function BottomToolbar({ onOpenAr }: { onOpenAr: () => void }) {
  const cameraMode = useStudio((s) => s.cameraMode);
  const setCameraMode = useStudio((s) => s.setCameraMode);
  const tool = useStudio((s) => s.tool);
  const setTool = useStudio((s) => s.setTool);
  const gridSnap = useStudio((s) => s.gridSnap);
  const toggleGridSnap = useStudio((s) => s.toggleGridSnap);
  const photoTexture = useStudio((s) => s.photoTexture);
  const setPhotoTexture = useStudio((s) => s.setPhotoTexture);
  const undo = useStudio((s) => s.undo);
  const redo = useStudio((s) => s.redo);
  const canUndo = useStudio((s) => s.past.length > 0);
  const canRedo = useStudio((s) => s.future.length > 0);
  const draft = useStudio((s) => s.draft);

  const issue = draft?.result?.issue ?? null;

  return (
    <div className="pointer-events-none absolute inset-x-0 bottom-0 z-30 flex flex-col items-center gap-2.5 px-3 pb-3 md:px-4 md:pb-4">
      {/* Live placement feedback sits directly above the toolbar so the eye
          doesn't have to leave the object being dragged */}
      <div
        className={cn(
          "pointer-events-none transition-all duration-250 ease-[cubic-bezier(0.16,1,0.3,1)]",
          draft ? "translate-y-0 opacity-100" : "translate-y-2 opacity-0",
        )}
      >
        <div
          className={cn(
            "flex items-center gap-2 rounded-full px-3.5 py-1.5 text-[12px] font-medium edge-light",
            issue ? "bg-danger/15 text-danger" : "glass-strong text-chalk",
          )}
        >
          <span
            className={cn(
              "size-1.5 rounded-full",
              issue ? "bg-danger" : "bg-accent animate-breathe",
            )}
          />
          {issue
            ? ISSUE_MESSAGES[issue]
            : draft?.result?.stacked
              ? "Stacking on top"
              : "Release to place"}
        </div>
      </div>

      {/* One row that scrolls sideways on a narrow phone, rather than wrapping
          into a second row that eats the room. */}
      <div className="no-scrollbar pointer-events-auto flex max-w-full flex-nowrap items-center gap-1.5 overflow-x-auto rounded-[16px] glass-strong p-1.5 edge-light">
        <Segmented
          options={CAMERA_OPTIONS}
          value={cameraMode}
          onChange={setCameraMode}
          size="sm"
          compact
          className="shrink-0 border-0 bg-transparent p-0"
        />

        <span className="hidden h-6 w-px bg-white/10 sm:block" />

        <Segmented
          options={TOOL_OPTIONS}
          value={tool}
          onChange={setTool}
          size="sm"
          compact
          className="shrink-0 border-0 bg-transparent p-0"
        />

        <span className="hidden h-6 w-px bg-white/10 sm:block" />

        <div className="flex shrink-0 items-center gap-0.5">
          <IconButton
            label={gridSnap ? "Grid snapping on" : "Grid snapping off"}
            size="sm"
            active={gridSnap}
            onClick={toggleGridSnap}
          >
            <Grid3x3 className="size-4" />
          </IconButton>

          <IconButton
            label={photoTexture ? "Showing your photo" : "Showing clean materials"}
            size="sm"
            active={photoTexture}
            onClick={() => setPhotoTexture(!photoTexture)}
          >
            {photoTexture ? <ImageIcon className="size-4" /> : <Box className="size-4" />}
          </IconButton>

          <IconButton label="Undo" size="sm" disabled={!canUndo} onClick={undo}>
            <Undo2 className="size-4" />
          </IconButton>

          <IconButton label="Redo" size="sm" disabled={!canRedo} onClick={redo}>
            <Redo2 className="size-4" />
          </IconButton>
        </div>

        <span className="hidden h-6 w-px bg-white/10 sm:block" />

        <button
          onClick={onOpenAr}
          className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-[9px] bg-white/7 px-3 text-[12.5px] font-medium text-chalk transition-all hover:bg-white/12"
        >
          <Scan className="size-3.5" />
          AR
        </button>
      </div>
    </div>
  );
}
