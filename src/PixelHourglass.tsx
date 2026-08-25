"use client";

import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { Cell, SandGrid } from "./sand-sim";

const GRID_WIDTH = 46;
const GRID_HEIGHT = 78;
const DRAG_SENSITIVITY = 0.012;
const FRICTION = 0.9;
const SIM_STEPS_PER_SECOND = 24;
const TILT_SMOOTHING = 0.08; // how quickly the angle follows device tilt

type DeviceOrientationEventWithPermission = typeof DeviceOrientationEvent & {
  requestPermission?: () => Promise<"granted" | "denied">;
};

function cssColorToRgba(colorString: string, alpha: number): [number, number, number, number] {
  if (typeof document === "undefined") return [0, 0, 0, alpha * 255];
  const canvas = document.createElement("canvas");
  canvas.width = 1;
  canvas.height = 1;
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = colorString;
  ctx.fillRect(0, 0, 1, 1);
  const [r, g, b] = ctx.getImageData(0, 0, 1, 1).data;
  return [r, g, b, Math.round(alpha * 255)];
}

function hash2(x: number, y: number): number {
  const v = Math.sin(x * 127.1 + y * 311.7) * 43758.5453;
  return v - Math.floor(v);
}

export default function PixelHourglass() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const gridRef = useRef<SandGrid | null>(null);
  const angleRef = useRef(0);
  const angleVelocityRef = useRef(0);
  const dragRef = useRef<{ dragging: boolean; lastX: number; lastY: number } | null>(null);
  const tiltTargetRef = useRef<number | null>(null);

  const [cursorGrabbing, setCursorGrabbing] = useState(false);
  const [tiltAvailable] = useState(
    () => typeof window !== "undefined" && !!window.DeviceOrientationEvent,
  );
  const [tiltNeedsPermission] = useState(() => {
    if (typeof window === "undefined") return false;
    const DOE = window.DeviceOrientationEvent as DeviceOrientationEventWithPermission | undefined;
    return typeof DOE?.requestPermission === "function";
  });
  const [tiltEnabled, setTiltEnabled] = useState(false);

  useEffect(() => {
    if (!tiltEnabled) return;

    // beta/gamma aren't "0 when at rest" — people hold a phone upright to
    // look at the screen, where beta sits around 70-90deg, not 0. Treating
    // 0 as the neutral pose (as a naive sin(beta)/sin(gamma) reading does)
    // means the glass reads as tilted even while just being held normally.
    // Instead, calibrate against whatever pose the device is in the moment
    // tilt is enabled, and track the deviation from that baseline.
    let baseline: { beta: number; gamma: number } | null = null;

    const angleDiffDeg = (a: number, b: number) => {
      const diff = a - b;
      return Math.atan2(Math.sin((diff * Math.PI) / 180), Math.cos((diff * Math.PI) / 180)) * (180 / Math.PI);
    };

    const handler = (e: DeviceOrientationEvent) => {
      if (e.beta === null || e.gamma === null) return;
      if (!baseline) {
        baseline = { beta: e.beta, gamma: e.gamma };
        return;
      }
      const deltaBeta = angleDiffDeg(e.beta, baseline.beta);
      const deltaGamma = angleDiffDeg(e.gamma, baseline.gamma);
      const gx = Math.sin((deltaGamma * Math.PI) / 180);
      const gy = Math.sin((deltaBeta * Math.PI) / 180);
      tiltTargetRef.current = Math.atan2(gx, gy);
    };

    window.addEventListener("deviceorientation", handler);
    return () => window.removeEventListener("deviceorientation", handler);
  }, [tiltEnabled]);

  const enableTilt = async () => {
    const DOE = window.DeviceOrientationEvent as DeviceOrientationEventWithPermission | undefined;
    if (DOE?.requestPermission) {
      try {
        const result = await DOE.requestPermission();
        if (result !== "granted") return;
      } catch {
        return;
      }
    }
    setTiltEnabled(true);
  };

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const grid = new SandGrid({ width: GRID_WIDTH, height: GRID_HEIGHT });
    grid.fillTopBulb(0.8);
    gridRef.current = grid;

    const rootStyle = getComputedStyle(document.documentElement);
    const wallColor = cssColorToRgba(rootStyle.getPropertyValue("--foreground").trim() || "#171717", 0.4);
    const sandColor = cssColorToRgba(rootStyle.getPropertyValue("--accent").trim() || "#d97706", 1);

    const imageData = ctx.createImageData(GRID_WIDTH, GRID_HEIGHT);

    const draw = () => {
      const data = imageData.data;
      for (let y = 0; y < GRID_HEIGHT; y++) {
        for (let x = 0; x < GRID_WIDTH; x++) {
          const i = y * GRID_WIDTH + x;
          const p = i * 4;
          const cell = grid.get(x, y);
          if (cell === Cell.Wall) {
            data[p] = wallColor[0];
            data[p + 1] = wallColor[1];
            data[p + 2] = wallColor[2];
            data[p + 3] = wallColor[3];
          } else if (cell === Cell.Sand) {
            const grain = 0.82 + 0.3 * hash2(x, y);
            data[p] = Math.min(255, sandColor[0] * grain);
            data[p + 1] = Math.min(255, sandColor[1] * grain);
            data[p + 2] = Math.min(255, sandColor[2] * grain);
            data[p + 3] = 255;
          } else {
            data[p] = 0;
            data[p + 1] = 0;
            data[p + 2] = 0;
            data[p + 3] = 0;
          }
        }
      }
      ctx.putImageData(imageData, 0, 0);
    };

    let rafId: number;
    let lastTime = performance.now();
    let simAccumulator = 0;
    const simStepDuration = 1 / SIM_STEPS_PER_SECOND;

    const tick = (now: number) => {
      const dt = Math.min(0.1, (now - lastTime) / 1000);
      lastTime = now;

      const drag = dragRef.current;
      if (drag?.dragging) {
        // angleVelocityRef is being driven live by pointermove; apply it
        // every frame so the glass keeps rotating even between move events.
        angleRef.current += angleVelocityRef.current;
      } else if (tiltEnabled && tiltTargetRef.current !== null) {
        // Follow the device-reported angle smoothly, and stop any leftover
        // drag momentum so it doesn't fight the tilt signal.
        let diff = tiltTargetRef.current - angleRef.current;
        diff = Math.atan2(Math.sin(diff), Math.cos(diff));
        angleRef.current += diff * TILT_SMOOTHING;
        angleVelocityRef.current = 0;
      } else {
        angleRef.current += angleVelocityRef.current;
        angleVelocityRef.current *= FRICTION;
      }

      simAccumulator += dt;
      while (simAccumulator >= simStepDuration) {
        grid.step(angleRef.current);
        simAccumulator -= simStepDuration;
      }

      draw();
      // Spin the glass itself to match the same angle driving gravity in the
      // simulation. Because the sand's fall direction is computed in the
      // canvas's own (unrotated) pixel space and then this rotation is
      // layered on top visually, the two cancel out and the sand keeps
      // seeking true screen-down no matter how the glass is spun — just
      // like actually turning a real hourglass over in your hand.
      canvas.style.transform = `rotate(${angleRef.current}rad)`;
      rafId = requestAnimationFrame(tick);
    };

    rafId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafId);
  }, [tiltEnabled]);

  const handlePointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    dragRef.current = { dragging: true, lastX: e.clientX, lastY: e.clientY };
    setCursorGrabbing(true);
    e.currentTarget.setPointerCapture(e.pointerId);
  };

  const handlePointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag?.dragging) return;
    const dx = e.clientX - drag.lastX;
    drag.lastX = e.clientX;
    drag.lastY = e.clientY;
    angleVelocityRef.current = dx * DRAG_SENSITIVITY;
  };

  const handlePointerUp = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (dragRef.current) dragRef.current.dragging = false;
    setCursorGrabbing(false);
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId);
    }
  };

  return (
    <div className="flex flex-col items-center gap-4">
      <div
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
        style={{
          touchAction: "none",
          cursor: cursorGrabbing ? "grabbing" : "grab",
          width: "min(70vw, 320px)",
          aspectRatio: `${GRID_WIDTH} / ${GRID_HEIGHT}`,
        }}
      >
        <canvas
          ref={canvasRef}
          width={GRID_WIDTH}
          height={GRID_HEIGHT}
          style={{ width: "100%", height: "100%", imageRendering: "pixelated", willChange: "transform" }}
        />
      </div>
      {tiltAvailable && !tiltEnabled && (
        <button
          type="button"
          onClick={enableTilt}
          className="rounded-full border border-foreground/20 px-4 py-1.5 text-sm text-foreground/70 hover:border-accent/50 hover:text-accent"
        >
          {tiltNeedsPermission ? "Enable tilt controls" : "Use device tilt"}
        </button>
      )}
    </div>
  );
}
