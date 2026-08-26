"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import { ZoomIn, RotateCw } from "lucide-react";

interface AvatarCropperProps {
  open: boolean;
  imageSrc: string | null;
  onCancel: () => void;
  onConfirm: (blob: Blob) => void;
}

const OUTPUT_SIZE = 256; // square output
const DISPLAY_SIZE = 280;

export function AvatarCropper({
  open,
  imageSrc,
  onCancel,
  onConfirm,
}: AvatarCropperProps) {
  const imgRef = useRef<HTMLImageElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [naturalSize, setNaturalSize] = useState({ w: 0, h: 0 });
  const [zoom, setZoom] = useState(1);
  const [rotation, setRotation] = useState(0);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [dragging, setDragging] = useState(false);
  const dragStart = useRef({ x: 0, y: 0, ox: 0, oy: 0 });

  // Load image natural dimensions
  useEffect(() => {
    if (!imageSrc) return;
    const img = new Image();
    img.onload = () => {
      setNaturalSize({ w: img.naturalWidth, h: img.naturalHeight });
      // Reset transforms for new image
      setZoom(1);
      setRotation(0);
      setOffset({ x: 0, y: 0 });
    };
    img.src = imageSrc;
  }, [imageSrc]);

  // Compute the base scale so the image fills the crop circle at zoom=1
  const baseScale = (() => {
    if (!naturalSize.w || !naturalSize.h) return 1;
    const sw = DISPLAY_SIZE / naturalSize.w;
    const sh = DISPLAY_SIZE / naturalSize.h;
    return Math.max(sw, sh);
  })();

  const onPointerDown = (e: React.PointerEvent) => {
    setDragging(true);
    dragStart.current = {
      x: e.clientX,
      y: e.clientY,
      ox: offset.x,
      oy: offset.y,
    };
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  };

  const onPointerMove = (e: React.PointerEvent) => {
    if (!dragging) return;
    setOffset({
      x: dragStart.current.ox + (e.clientX - dragStart.current.x),
      y: dragStart.current.oy + (e.clientY - dragStart.current.y),
    });
  };

  const onPointerUp = () => setDragging(false);

  const produceBlob = useCallback(async (): Promise<Blob | null> => {
    if (!imageSrc || !naturalSize.w) return null;
    const canvas = document.createElement("canvas");
    canvas.width = OUTPUT_SIZE;
    canvas.height = OUTPUT_SIZE;
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;

    // Fill white background (for transparent PNGs)
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, OUTPUT_SIZE, OUTPUT_SIZE);

    // Draw a circular clip
    ctx.save();
    ctx.beginPath();
    ctx.arc(OUTPUT_SIZE / 2, OUTPUT_SIZE / 2, OUTPUT_SIZE / 2, 0, Math.PI * 2);
    ctx.clip();

    // Load the source image at full resolution
    const img = new Image();
    img.crossOrigin = "anonymous";
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = () => reject(new Error("Failed to load image"));
      img.src = imageSrc;
    });

    // Calculate the transform to match what the user sees.
    // The display shows the image scaled by baseScale * zoom, centered,
    // then offset by the user's drag.
    const effectiveScale = baseScale * zoom;
    const displayToOutput = OUTPUT_SIZE / DISPLAY_SIZE;

    ctx.translate(OUTPUT_SIZE / 2, OUTPUT_SIZE / 2);
    ctx.rotate((rotation * Math.PI) / 180);
    ctx.scale(effectiveScale * displayToOutput, effectiveScale * displayToOutput);
    ctx.translate(offset.x / effectiveScale, offset.y / effectiveScale);
    ctx.drawImage(img, -naturalSize.w / 2, -naturalSize.h / 2);

    ctx.restore();

    return new Promise((resolve) =>
      canvas.toBlob((b) => resolve(b), "image/png"),
    );
  }, [imageSrc, naturalSize, baseScale, zoom, rotation, offset]);

  const handleConfirm = async () => {
    const blob = await produceBlob();
    if (blob) onConfirm(blob);
  };

  const handleRotate = () => {
    setRotation((r) => (r + 90) % 360);
  };

  if (!imageSrc) return null;

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onCancel()}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Crop profile picture</DialogTitle>
        </DialogHeader>

        <div className="flex flex-col items-center gap-4 py-2">
          {/* Crop area with circular overlay */}
          <div
            ref={containerRef}
            className="relative select-none overflow-hidden rounded-full border-2 border-border bg-muted"
            style={{ width: DISPLAY_SIZE, height: DISPLAY_SIZE }}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerLeave={onPointerUp}
          >
            <img
              ref={imgRef}
              src={imageSrc}
              alt="Crop preview"
              draggable={false}
              className="pointer-events-none absolute left-1/2 top-1/2 origin-center"
              style={{
                transform: `translate(-50%, -50%) translate(${offset.x}px, ${offset.y}px) rotate(${rotation}deg) scale(${baseScale * zoom})`,
                willChange: "transform",
                cursor: dragging ? "grabbing" : "grab",
              }}
            />
            {/* Grid overlay for visual guide */}
            <div className="pointer-events-none absolute inset-0 rounded-full border border-white/20" />
            <div className="pointer-events-none absolute inset-[35%] rounded-full border border-white/20" />
          </div>

          <p className="text-center text-[11px] text-muted-foreground">
            Drag to reposition. Use the slider to zoom.
          </p>

          {/* Zoom slider */}
          <div className="flex w-full items-center gap-3 px-2">
            <ZoomIn className="h-4 w-4 shrink-0 text-muted-foreground" />
            <Slider
              value={[zoom]}
              min={1}
              max={3}
              step={0.05}
              onValueChange={(v) => setZoom(v[0])}
            />
          </div>

          {/* Rotate button */}
          <Button variant="outline" size="sm" onClick={handleRotate}>
            <RotateCw className="mr-2 h-3.5 w-3.5" />
            Rotate 90°
          </Button>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={onCancel}>
            Cancel
          </Button>
          <Button onClick={handleConfirm}>Apply &amp; upload</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
