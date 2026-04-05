"use client";

import { useEffect, useRef } from "react";

const DOT_GAP = 30;
const DOT_RADIUS = 1.2;
const MOUSE_RADIUS = 300;
const PUSH_STRENGTH = 10;
const SPRITE_SIZE = 20;
const DOT_SPRITE_SIZE = 12;
const BIG_DOT_SPRITE_SIZE = 6;

// Idle-mode probability thresholds (applied to sprite-slots via cellRand)
const PACMAN_CHANCE = 0.01;
const BIG_DOT_CHANCE = 0.15; // shared between idle & game

// Pac-man moves one grid cell per this many ms
const MOVE_INTERVAL = 150;
// How long the death-freeze lasts before resetting
const DEATH_FREEZE_MS = 2000;

/** Deterministic hash for a grid cell — returns 0‥1, stable across frames */
function cellRand(row: number, col: number): number {
  let h = (row * 73856093) ^ (col * 19349669);
  h = ((h >> 16) ^ h) * 0x45d9f3b;
  h = ((h >> 16) ^ h) * 0x45d9f3b;
  h = (h >> 16) ^ h;
  return (h >>> 0) / 0xffffffff;
}

function isSpriteSlot(row: number, col: number): boolean {
  return (row % 6 === 3 && col % 8 === 4) || (row % 6 === 0 && col % 8 === 0);
}

/** What lives at a sprite-slot in both idle and game rendering */
function spriteSlotKind(row: number, col: number): "pacman" | "bigdot" | "ghost" {
  const rnd = cellRand(row, col);
  if (rnd < PACMAN_CHANCE) return "pacman";
  if (rnd < BIG_DOT_CHANCE) return "bigdot";
  return "ghost";
}

function ghostSrcForCell(row: number, col: number): string {
  // Use a second independent hash so the colour isn't correlated with spriteSlotKind
  let h = (row * 48271) ^ (col * 40692037);
  h = ((h >> 16) ^ h) * 0x119de1f3;
  h = (h >> 16) ^ h;
  return GHOST_SRCS[(h >>> 0) % GHOST_SRCS.length];
}

/** Return the single pac-man spawn for the current grid.
 *  Tries the first natural "pacman" sprite-slot (row>=1, col>=1 so it's visible),
 *  otherwise falls back to the first visible sprite-slot. */
function findPacmanSpawn(rows: number, cols: number): { row: number; col: number } {
  for (let r = 1; r < rows; r++)
    for (let c = 1; c < cols; c++)
      if (isSpriteSlot(r, c) && spriteSlotKind(r, c) === "pacman")
        return { row: r, col: c };
  // No natural pacman — pick the first visible sprite-slot
  for (let r = 1; r < rows; r++)
    for (let c = 1; c < cols; c++)
      if (isSpriteSlot(r, c)) return { row: r, col: c };
  return { row: 3, col: 4 };
}

const GHOST_SRCS = [
  "/sprites/red.gif",
  "/sprites/pink.gif",
  "/sprites/blue.gif",
  "/sprites/yellow.gif",
];
const PACMAN_SRC = "/sprites/mc.gif";
const DOT_SRC = "/sprites/dot.png";
const BIG_DOT_SRC = "/sprites/big_dot.gif";
const VULNERABLE_SRC = "/sprites/vulnerable.gif";
const VULNERABLE_REV_SRC = "/sprites/vulnerable_rev.gif";

// ---------------------------------------------------------------------------
// Game state (lives entirely in a ref so the rAF loop can mutate it freely)
// ---------------------------------------------------------------------------
interface GameState {
  pacRow: number;
  pacCol: number;
  prevRow: number;
  prevCol: number;
  dirR: number;
  dirC: number;
  nextDirR: number;
  nextDirC: number;
  lastMoveTime: number;
  eatenCells: Set<string>;
  vulnerableUntil: number;
  gridInfo: Map<string, { type: "ghost" | "bigdot"; ghostSrc?: string }>;
  totalCols: number;
  totalRows: number;
  over: boolean;
  deathTime: number;
  frozen: boolean;
}

// ---------------------------------------------------------------------------

interface MouseGlowProps {
  pacmanMode?: boolean;
  enabled?: boolean;
  isPlaying?: boolean;
  onGameOver?: () => void;
}

export default function MouseGlow({
  pacmanMode = false,
  enabled = true,
  isPlaying = false,
  onGameOver,
}: MouseGlowProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const overlayRef = useRef<HTMLDivElement>(null);
  const mouse = useRef({ x: -9999, y: -9999 });
  const raf = useRef(0);

  const pacmanModeRef = useRef(pacmanMode);
  pacmanModeRef.current = pacmanMode;
  const isPlayingRef = useRef(isPlaying);
  isPlayingRef.current = isPlaying;
  const onGameOverRef = useRef(onGameOver);
  onGameOverRef.current = onGameOver;

  const gameRef = useRef<GameState | null>(null);
  const dotImgRef = useRef<HTMLImageElement | null>(null);

  // ------ Preload images ------
  useEffect(() => {
    const img = new Image();
    img.src = DOT_SRC;
    img.onload = () => {
      dotImgRef.current = img;
    };
    for (const src of [BIG_DOT_SRC, VULNERABLE_SRC, VULNERABLE_REV_SRC, PACMAN_SRC, ...GHOST_SRCS]) {
      const i = new Image();
      i.src = src;
    }
  }, []);

  // ------ Initialise / tear-down game state ------
  useEffect(() => {
    if (isPlaying) {
      const cols = Math.ceil(window.innerWidth / DOT_GAP) + 1;
      const rows = Math.ceil(window.innerHeight / DOT_GAP) + 1;

      const spawn = findPacmanSpawn(rows, cols);
      const gridInfo = new Map<string, { type: "ghost" | "bigdot"; ghostSrc?: string }>();

      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          if (!isSpriteSlot(r, c)) continue;
          if (r === spawn.row && c === spawn.col) continue; // player spawn — regular dot
          const kind = spriteSlotKind(r, c);
          if (kind === "bigdot") {
            gridInfo.set(`${r}-${c}`, { type: "bigdot" });
          } else {
            // "ghost" and "pacman" slots both become ghosts in game
            gridInfo.set(`${r}-${c}`, { type: "ghost", ghostSrc: ghostSrcForCell(r, c) });
          }
        }
      }

      gameRef.current = {
        pacRow: spawn.row,
        pacCol: spawn.col,
        prevRow: spawn.row,
        prevCol: spawn.col,
        dirR: 0,
        dirC: 1,
        nextDirR: 0,
        nextDirC: 1,
        lastMoveTime: performance.now(),
        eatenCells: new Set([`${spawn.row}-${spawn.col}`]),
        vulnerableUntil: 0,
        gridInfo,
        totalCols: cols,
        totalRows: rows,
        over: false,
        deathTime: 0,
        frozen: false,
      };
    } else {
      gameRef.current = null;
    }
  }, [isPlaying]);

  // ------ Arrow-key handler for game ------
  useEffect(() => {
    if (!isPlaying) return;

    function handleKey(e: KeyboardEvent) {
      const s = gameRef.current;
      if (!s || s.over) return;
      switch (e.key) {
        case "ArrowUp":
          s.nextDirR = -1;
          s.nextDirC = 0;
          e.preventDefault();
          break;
        case "ArrowDown":
          s.nextDirR = 1;
          s.nextDirC = 0;
          e.preventDefault();
          break;
        case "ArrowLeft":
          s.nextDirR = 0;
          s.nextDirC = -1;
          e.preventDefault();
          break;
        case "ArrowRight":
          s.nextDirR = 0;
          s.nextDirC = 1;
          e.preventDefault();
          break;
      }
    }

    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [isPlaying]);

  // ------ Main canvas + sprite render loop (runs once) ------
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

    // --- Sprite DOM element pool ---
    const spriteElements = new Map<string, HTMLImageElement>();

    function getOrCreateSprite(key: string, src: string, size: number = SPRITE_SIZE): HTMLImageElement {
      let el = spriteElements.get(key);
      if (!el) {
        el = document.createElement("img");
        el.draggable = false;
        Object.assign(el.style, {
          position: "absolute",
          top: "0",
          left: "0",
          width: size + "px",
          height: size + "px",
          pointerEvents: "none",
          imageRendering: "pixelated",
          willChange: "transform",
        });
        overlay!.appendChild(el);
        spriteElements.set(key, el);
      }
      if (el.dataset.csrc !== src) {
        el.src = src;
        el.dataset.csrc = src;
      }
      if (el.style.width !== size + "px") {
        el.style.width = size + "px";
        el.style.height = size + "px";
      }
      return el;
    }

    /** Freeze every visible GIF by snapshotting its current frame onto a canvas */
    function freezeSprites() {
      const tmp = document.createElement("canvas");
      const tmpCtx = tmp.getContext("2d")!;
      spriteElements.forEach((el) => {
        if (el.style.display === "none") return;
        const sz = el.naturalWidth || SPRITE_SIZE;
        tmp.width = sz;
        tmp.height = sz;
        tmpCtx.clearRect(0, 0, sz, sz);
        tmpCtx.drawImage(el, 0, 0, sz, sz);
        try {
          el.src = tmp.toDataURL("image/png");
          el.dataset.csrc = "frozen";
        } catch {
          // ignore cross-origin errors
        }
      });
    }

    const activeKeys = new Set<string>();

    // ========================= draw =========================
    function draw() {
      const state = gameRef.current;
      const now = performance.now();

      // ---- Death freeze: hold last frame for 2 s, then reset ----
      if (state && state.over) {
        if (!state.frozen) {
          freezeSprites();
          state.frozen = true;
        }
        if (now - state.deathTime >= DEATH_FREEZE_MS) {
          gameRef.current = null;
          isPlayingRef.current = false;
          onGameOverRef.current?.();
        }
        raf.current = requestAnimationFrame(draw);
        return; // keep the frozen frame on screen
      }

      ctx.clearRect(0, 0, w, h);

      const isDark =
        document.documentElement.getAttribute("data-theme") !== "light";
      const dotColor = isDark ? "rgba(255,255,255,0.08)" : "rgba(0,0,0,0.08)";

      const mx = mouse.current.x;
      const my = mouse.current.y;
      const isPac = pacmanModeRef.current;
      const isGame = isPlayingRef.current;

      activeKeys.clear();

      // -------------------------------------------------------
      // GAME MODE
      // -------------------------------------------------------
      if (isGame && state) {
        // ---- update pac-man ----
        const elapsed = now - state.lastMoveTime;
        if (elapsed >= MOVE_INTERVAL) {
          state.dirR = state.nextDirR;
          state.dirC = state.nextDirC;
          state.prevRow = state.pacRow;
          state.prevCol = state.pacCol;
          state.pacRow = (state.pacRow + state.dirR + state.totalRows) % state.totalRows;
          state.pacCol = (state.pacCol + state.dirC + state.totalCols) % state.totalCols;
          state.lastMoveTime = now;

          const key = `${state.pacRow}-${state.pacCol}`;
          const cellInfo = state.gridInfo.get(key);

          if (cellInfo && !state.eatenCells.has(key)) {
            if (cellInfo.type === "ghost") {
              if (now < state.vulnerableUntil) {
                state.eatenCells.add(key);
              } else {
                // Death — start freeze
                state.over = true;
                state.deathTime = now;
                // render one last frame then freeze kicks in next loop
              }
            } else if (cellInfo.type === "bigdot") {
              state.eatenCells.add(key);
              state.vulnerableUntil = now + 10_000;
            }
          }

          if (!state.eatenCells.has(key)) {
            state.eatenCells.add(key);
          }
        }

        // ---- render grid ----
        const { totalRows: rows, totalCols: cols } = state;

        for (let row = 0; row < rows; row++) {
          for (let col = 0; col < cols; col++) {
            const key = `${row}-${col}`;
            if (state.eatenCells.has(key)) continue;

            const x = col * DOT_GAP;
            const y = row * DOT_GAP;
            const cellInfo = state.gridInfo.get(key);

            if (cellInfo) {
              if (cellInfo.type === "ghost") {
                let src = cellInfo.ghostSrc!;
                if (now < state.vulnerableUntil) {
                  const timeLeft = state.vulnerableUntil - now;
                  if (timeLeft <= 4000) {
                    const phase = Math.floor((now % 1000) / 500);
                    src = phase === 0 ? VULNERABLE_SRC : VULNERABLE_REV_SRC;
                  } else {
                    src = VULNERABLE_SRC;
                  }
                }
                const sk = `g-${row}-${col}`;
                activeKeys.add(sk);
                const el = getOrCreateSprite(sk, src);
                el.style.transform = `translate(${x - SPRITE_SIZE / 2}px,${y - SPRITE_SIZE / 2}px)`;
                el.style.display = "";
              } else {
                const sk = `bd-${row}-${col}`;
                activeKeys.add(sk);
                const el = getOrCreateSprite(sk, BIG_DOT_SRC, BIG_DOT_SPRITE_SIZE);
                el.style.transform = `translate(${x - BIG_DOT_SPRITE_SIZE / 2}px,${y - BIG_DOT_SPRITE_SIZE / 2}px)`;
                el.style.display = "";
              }
            } else {
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
          }
        }

        // ---- render pac-man ----
        const moveElapsed = now - state.lastMoveTime;
        const progress = Math.min(1, moveElapsed / MOVE_INTERVAL);

        let drawRow: number;
        let drawCol: number;

        if (
          Math.abs(state.pacRow - state.prevRow) > 1 ||
          Math.abs(state.pacCol - state.prevCol) > 1
        ) {
          drawRow = state.pacRow;
          drawCol = state.pacCol;
        } else {
          drawRow = state.prevRow + (state.pacRow - state.prevRow) * progress;
          drawCol = state.prevCol + (state.pacCol - state.prevCol) * progress;
        }

        const pacX = drawCol * DOT_GAP;
        const pacY = drawRow * DOT_GAP;

        let dirTransform = "";
        if (state.dirC === -1) dirTransform = "scaleX(-1)";
        else if (state.dirR === -1) dirTransform = "rotate(-90deg)";
        else if (state.dirR === 1) dirTransform = "rotate(90deg)";

        const pacKey = "player-pac";
        activeKeys.add(pacKey);
        const pacEl = getOrCreateSprite(pacKey, PACMAN_SRC);
        pacEl.style.transform = `translate(${pacX - SPRITE_SIZE / 2}px,${pacY - SPRITE_SIZE / 2}px) ${dirTransform}`;
        pacEl.style.display = "";

        // -------------------------------------------------------
        // PAC-MAN IDLE MODE
        // -------------------------------------------------------
      } else if (isPac) {
        const cols = Math.ceil(w / DOT_GAP) + 1;
        const rows = Math.ceil(h / DOT_GAP) + 1;
        const pacSpawn = findPacmanSpawn(rows, cols);

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

            if (isSpriteSlot(row, col)) {
              // Exactly one pac-man at the spawn position
              if (row === pacSpawn.row && col === pacSpawn.col) {
                const key = `p-${row}-${col}`;
                activeKeys.add(key);
                const el = getOrCreateSprite(key, PACMAN_SRC);
                el.style.transform = `translate(${x - SPRITE_SIZE / 2}px,${y - SPRITE_SIZE / 2}px)`;
                el.style.display = "";
              } else {
                const kind = spriteSlotKind(row, col);
                if (kind === "bigdot") {
                  const key = `bd-${row}-${col}`;
                  activeKeys.add(key);
                  const el = getOrCreateSprite(key, BIG_DOT_SRC, BIG_DOT_SPRITE_SIZE);
                  el.style.transform = `translate(${x - BIG_DOT_SPRITE_SIZE / 2}px,${y - BIG_DOT_SPRITE_SIZE / 2}px)`;
                  el.style.display = "";
                } else {
                  // "ghost" and other "pacman" slots → ghost
                  const key = `g-${row}-${col}`;
                  activeKeys.add(key);
                  const el = getOrCreateSprite(key, ghostSrcForCell(row, col));
                  el.style.transform = `translate(${x - SPRITE_SIZE / 2}px,${y - SPRITE_SIZE / 2}px)`;
                  el.style.display = "";
                }
              }
            } else {
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
          }
        }

        // -------------------------------------------------------
        // NORMAL MODE (plain dot grid)
        // -------------------------------------------------------
      } else {
        const cols = Math.ceil(w / DOT_GAP) + 1;
        const rows = Math.ceil(h / DOT_GAP) + 1;

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

      // Hide sprites that are no longer active
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
