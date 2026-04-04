"use client";

import { useEffect, useRef } from "react";

const DOT_GAP = 30;
const DOT_RADIUS = 1.2;
const MOUSE_RADIUS = 300;
const PUSH_STRENGTH = 10;
const SPRITE_SIZE = 20;
const DOT_SPRITE_SIZE = 12;

// Probability thresholds (0–1) — pacman is rarer than ghosts
const GHOST_CHANCE = 0.04;
const PACMAN_CHANCE = 0.01;

/** Deterministic hash for a grid cell — returns 0‥1, stable across frames */
function cellRand(row: number, col: number): number {
  let h = (row * 73856093) ^ (col * 19349669);
  h = ((h >> 16) ^ h) * 0x45d9f3b;
  h = ((h >> 16) ^ h) * 0x45d9f3b;
  h = (h >> 16) ^ h;
  return (h >>> 0) / 0xffffffff;
}

const GHOST_SRCS = [
  "/sprites/red.gif",
  "/sprites/pink.gif",
  "/sprites/blue.gif",
  "/sprites/yellow.gif",
];
const PACMAN_SRC = "/sprites/mc.gif";
const DOT_SRC = "/sprites/dot.png";

interface MouseGlowProps {
  pacmanMode?: boolean;
  enabled?: boolean;
}

export default function MouseGlow({ pacmanMode = false, enabled = true }: MouseGlowProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const overlayRef = useRef<HTMLDivElement>(null);
  const mouse = useRef({ x: -9999, y: -9999 });
  const raf = useRef(0);
  const pacmanModeRef = useRef(pacmanMode);
  pacmanModeRef.current = pacmanMode;

  // Preload dot.png for canvas rendering
  const dotImgRef = useRef<HTMLImageElement | null>(null);

  useEffect(() => {
    const img = new Image();
    img.src = DOT_SRC;
    img.onload = () => {
      dotImgRef.current = img;
    };
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    const overlay = overlayRef.current;
    if (!canvas || !overlay) return;

    if (window.matchMedia("(pointer: coarse)").matches) {
      canvas.style.display = "none";
      overlay.style.display = "none";
      return;
    }

    const ctx = canvas.getContext("2d")!;
    let w = 0;
    let h = 0;

    function resize() {
      w = canvas!.width = window.innerWidth;
      h = canvas!.height = window.innerHeight;
    }
    resize();
    window.addEventListener("resize", resize);

    function onMove(e: MouseEvent) {
      mouse.current.x = e.clientX;
      mouse.current.y = e.clientY;
    }
    window.addEventListener("mousemove", onMove);

    function onLeave() {
      mouse.current.x = -9999;
      mouse.current.y = -9999;
    }
    document.addEventListener("mouseleave", onLeave);

    // --- Sprite DOM elements management ---
    const spriteElements = new Map<string, HTMLImageElement>();

    function getOrCreateSprite(key: string, src: string): HTMLImageElement {
      let el = spriteElements.get(key);
      if (!el) {
        el = document.createElement("img");
        el.src = src;
        el.draggable = false;
        Object.assign(el.style, {
          position: "absolute",
          top: "0",
          left: "0",
          width: SPRITE_SIZE + "px",
          height: SPRITE_SIZE + "px",
          pointerEvents: "none",
          imageRendering: "pixelated",
          willChange: "transform",
        });
        overlay!.appendChild(el);
        spriteElements.set(key, el);
      }
      return el;
    }

    const activeKeys = new Set<string>();

    function draw() {
      ctx.clearRect(0, 0, w, h);

      const isDark =
        document.documentElement.getAttribute("data-theme") !== "light";
      const dotColor = isDark ? "rgba(255,255,255,0.08)" : "rgba(0,0,0,0.08)";

      const mx = mouse.current.x;
      const my = mouse.current.y;
      const cols = Math.ceil(w / DOT_GAP) + 1;
      const rows = Math.ceil(h / DOT_GAP) + 1;
      const isPac = pacmanModeRef.current;

      activeKeys.clear();

      for (let row = 0; row < rows; row++) {
        for (let col = 0; col < cols; col++) {
          const ox = col * DOT_GAP;
          const oy = row * DOT_GAP;

          const dx = ox - mx;
          const dy = oy - my;
          const dist = Math.sqrt(dx * dx + dy * dy);

          let x = ox;
          let y = oy;

          if (dist < MOUSE_RADIUS && dist > 0) {
            const factor = 1 - dist / MOUSE_RADIUS;
            const ease = factor * factor;
            const push = ease * PUSH_STRENGTH;
            x += (dx / dist) * push;
            y += (dy / dist) * push;
          }

          if (isPac) {
            // Grid-based sprite positions (organized layout)
            const isSpriteSlot =
              (row % 6 === 3 && col % 8 === 4) ||
              (row % 6 === 0 && col % 8 === 0);

            if (isSpriteSlot) {
              // Randomly pick ghost or pacman at this slot (pacman is rarer)
              const rnd = cellRand(row, col);
              const isPacChar = rnd < PACMAN_CHANCE;

              if (!isPacChar) {
                // Ghost — pick color with a well-distributed index
                const ci = ((row * 3 + col * 7 + 13) & 0x7fffffff) % GHOST_SRCS.length;
                const key = `g-${row}-${col}`;
                activeKeys.add(key);
                const el = getOrCreateSprite(key, GHOST_SRCS[ci]);
                el.style.transform = `translate(${x - SPRITE_SIZE / 2}px,${y - SPRITE_SIZE / 2}px)`;
                el.style.display = "";
              } else {
                const key = `p-${row}-${col}`;
                activeKeys.add(key);
                const el = getOrCreateSprite(key, PACMAN_SRC);
                el.style.transform = `translate(${x - SPRITE_SIZE / 2}px,${y - SPRITE_SIZE / 2}px)`;
                el.style.display = "";
              }
            } else {
              // Pac-dots — draw dot.png on canvas
              const dotImg = dotImgRef.current;
              if (dotImg) {
                ctx.drawImage(
                  dotImg,
                  x - DOT_SPRITE_SIZE / 2,
                  y - DOT_SPRITE_SIZE / 2,
                  DOT_SPRITE_SIZE,
                  DOT_SPRITE_SIZE,
                );
              }
            }
          } else {
            // Normal mode — standard dot grid
            const r =
              dist < MOUSE_RADIUS && dist > 0
                ? DOT_RADIUS + (1 - dist / MOUSE_RADIUS) ** 2 * 1.2
                : DOT_RADIUS;
            ctx.beginPath();
            ctx.arc(x, y, r, 0, Math.PI * 2);
            ctx.fillStyle = dotColor;
            ctx.fill();
          }
        }
      }

      // Hide sprites that are no longer active (mode off, window resized, etc.)
      spriteElements.forEach((el, key) => {
        if (!activeKeys.has(key)) {
          el.style.display = "none";
        }
      });

      raf.current = requestAnimationFrame(draw);
    }

    draw();

    return () => {
      cancelAnimationFrame(raf.current);
      window.removeEventListener("resize", resize);
      window.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseleave", onLeave);
      // Cleanup sprite DOM elements
      spriteElements.forEach((el) => el.remove());
      spriteElements.clear();
    };
  }, []);

  return (
    <>
      <canvas
        ref={canvasRef}
        className="fixed inset-0 z-0 pointer-events-none"
        aria-hidden="true"
        style={{ display: enabled ? undefined : "none" }}
      />
      <div
        ref={overlayRef}
        className="fixed inset-0 z-0 pointer-events-none overflow-hidden"
        aria-hidden="true"
        style={{ position: "fixed", inset: 0, display: enabled ? undefined : "none" }}
      />
    </>
  );
}
