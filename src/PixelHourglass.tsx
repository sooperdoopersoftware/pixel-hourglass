"use client";

import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { Cell, SandGrid } from "./sand-sim";

const GRID_WIDTH = 46;
const GRID_HEIGHT = 78;
const FRICTION = 0.9; // spin kept per 1/60s once a drag is released
const MAX_SPIN = 14; // rad/s
const DRAG_DEAD_RADIUS = 10; // px around the centre where a drag can't steer
const FLING_TIMEOUT_MS = 80; // a pointer held still this long releases with no spin
const SIM_STEPS_PER_SECOND = 24;
const TILT_SMOOTHING = 0.08; // how quickly gravity follows device tilt, per 1/60s
const TILT_MIN_PULL = 0.25; // below this the device is lying too flat to say which way is down

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

function wrapAngle(angle: number): number {
  return Math.atan2(Math.sin(angle), Math.cos(angle));
}

export default function PixelHourglass() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const gridRef = useRef<SandGrid | null>(null);
  const angleRef = useRef(0);
  const angleVelocityRef = useRef(0);
  const dragRef = useRef<{ dragging: boolean; lastPointerAngle: number; lastMoveTime: number } | null>(null);
  const tiltTargetRef = useRef<number | null>(null);
  const tiltAngleRef = useRef(0);

  const [cursorGrabbing, setCursorGrabbing] = useState(false);
  // Desktop browsers expose DeviceOrientationEvent too, with no sensor
  // behind it, so only offer tilt where the primary input is touch.
  const [tiltAvailable] = useState(
    () =>
      typeof window !== "undefined" &&
      !!window.DeviceOrientationEvent &&
      window.matchMedia("(pointer: coarse)").matches,
  );
  const [tiltNeedsPermission] = useState(() => {
    if (typeof window === "undefined") return false;
    const DOE = window.DeviceOrientationEvent as DeviceOrientationEventWithPermission | undefined;
    return typeof DOE?.requestPermission === "function";
  });
  const [tiltEnabled, setTiltEnabled] = useState(false);

  useEffect(() => {
    if (!tiltEnabled) return;

    const handler = (e: DeviceOrientationEvent) => {
      if (e.beta === null || e.gamma === null) return;
      const beta = (e.beta * Math.PI) / 180;
      const gamma = (e.gamma * Math.PI) / 180;
      // Real gravity projected onto the face of the device, as (right, down)
      // in portrait. Reading it this way rather than from beta/gamma
      // directly means a phone held upright to look at the screen (beta
      // around 70-90deg) already reads as "down is down" with no
      // calibration step, and turning the phone over turns gravity over.
      const right = Math.cos(beta) * Math.sin(gamma);
      const down = Math.sin(beta);
      // Lying nearly flat, the in-plane pull is mostly sensor noise — hold
      // the last good reading instead of letting the sand chase it.
      if (Math.hypot(right, down) < TILT_MIN_PULL) return;
      // The page rotates with the screen, the sensor axes don't.
      const screenAngle = ((window.screen.orientation?.angle ?? 0) * Math.PI) / 180;
      const screenRight = right * Math.cos(screenAngle) + down * Math.sin(screenAngle);
      const screenDown = down * Math.cos(screenAngle) - right * Math.sin(screenAngle);
      tiltTargetRef.current = Math.atan2(screenRight, screenDown);
    };

    window.addEventListener("deviceorientation", handler);
    return () => {
      window.removeEventListener("deviceorientation", handler);
      tiltTargetRef.current = null;
    };
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

    let wallColor: [number, number, number, number];
    let sandColor: [number, number, number, number];
    const readColors = () => {
      const rootStyle = getComputedStyle(document.documentElement);
      wallColor = cssColorToRgba(rootStyle.getPropertyValue("--foreground").trim() || "#171717", 0.4);
      sandColor = cssColorToRgba(rootStyle.getPropertyValue("--accent").trim() || "#d97706", 1);
    };
    readColors();
    // The theme variables follow the OS colour scheme; pick up a switch
    // without needing a reload.
    const colorScheme = window.matchMedia("(prefers-color-scheme: dark)");
    colorScheme.addEventListener("change", readColors);

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
            const grain = 0.82 + 0.3 * (grid.shadeAt(x, y) / 255);
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

      // While dragging, pointermove sets the angle directly; otherwise let
      // whatever spin the release left behind coast to a stop.
      if (!dragRef.current?.dragging) {
        angleRef.current += angleVelocityRef.current * dt;
        angleVelocityRef.current *= Math.pow(FRICTION, dt * 60);
      }

      // Device tilt moves gravity, not the picture: the glass is already
      // being turned for real, in the hand holding the phone.
      const tiltTarget = tiltTargetRef.current ?? 0;
      tiltAngleRef.current +=
        wrapAngle(tiltTarget - tiltAngleRef.current) * (1 - Math.pow(1 - TILT_SMOOTHING, dt * 60));

      const gravityAngle = angleRef.current + tiltAngleRef.current;
      simAccumulator += dt;
      while (simAccumulator >= simStepDuration) {
        grid.step(gravityAngle);
        simAccumulator -= simStepDuration;
      }

      draw();
      // Spin the glass itself by the same angle the drag adds to gravity in
      // the simulation. Because the sand's fall direction is computed in the
      // canvas's own (unrotated) pixel space and then this rotation is
      // layered on top visually, the two cancel out and the sand keeps
      // seeking true screen-down no matter how the glass is spun — just
      // like actually turning a real hourglass over in your hand.
      canvas.style.transform = `rotate(${angleRef.current}rad)`;
      rafId = requestAnimationFrame(tick);
    };

    rafId = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(rafId);
      colorScheme.removeEventListener("change", readColors);
    };
  }, []);

  // Dragging turns the glass about its centre, following the pointer the way
  // a hand on the rim would, rather than mapping sideways travel to spin.
  const pointerAngle = (e: ReactPointerEvent<HTMLDivElement>): number | null => {
    const rect = e.currentTarget.getBoundingClientRect();
    const dx = e.clientX - (rect.left + rect.width / 2);
    const dy = e.clientY - (rect.top + rect.height / 2);
    // Right at the centre the direction to the pointer is meaningless and a
    // pixel of travel would swing the glass half a turn.
    if (Math.hypot(dx, dy) < DRAG_DEAD_RADIUS) return null;
    return Math.atan2(dy, dx);
  };

  const handlePointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    dragRef.current = { dragging: true, lastPointerAngle: pointerAngle(e) ?? NaN, lastMoveTime: e.timeStamp };
    angleVelocityRef.current = 0;
    setCursorGrabbing(true);
    e.currentTarget.setPointerCapture(e.pointerId);
  };

  const handlePointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag?.dragging) return;
    const angle = pointerAngle(e);
    if (angle === null) {
      drag.lastPointerAngle = NaN;
      return;
    }
    if (!Number.isNaN(drag.lastPointerAngle)) {
      const delta = wrapAngle(angle - drag.lastPointerAngle);
      const elapsed = Math.max(1, e.timeStamp - drag.lastMoveTime) / 1000;
      angleRef.current += delta;
      // Smoothed, so one jittery sample at the moment of release doesn't
      // decide how hard the glass gets flung.
      const spin = Math.max(-MAX_SPIN, Math.min(MAX_SPIN, delta / elapsed));
      angleVelocityRef.current = angleVelocityRef.current * 0.6 + spin * 0.4;
    }
    drag.lastPointerAngle = angle;
    drag.lastMoveTime = e.timeStamp;
  };

  const handlePointerUp = (e: ReactPointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (drag?.dragging && e.timeStamp - drag.lastMoveTime > FLING_TIMEOUT_MS) angleVelocityRef.current = 0;
    if (drag) drag.dragging = false;
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
