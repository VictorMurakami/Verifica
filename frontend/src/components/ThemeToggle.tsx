"use client";

import { useEffect, useState, useRef } from "react";
import { Monitor, Sun, Moon, Stars, Joystick } from "lucide-react";
import { useDebug } from "@/context/DebugContext";

const baseThemes = [
  { id: "auto", label: "Automático", Icon: Monitor },
  { id: "light", label: "Claro", Icon: Sun },
  { id: "dark", label: "Escuro", Icon: Moon },
  { id: "dim", label: "Dim", Icon: Stars },
] as const;

const pacmanTheme = { id: "pacman", label: "Pac-Man", Icon: Joystick } as const;

export type ThemeId = "auto" | "light" | "dark" | "dim" | "pacman";

function getSystemTheme() {
  if (typeof window === "undefined") return "dark";
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

function resolveDataTheme(id: ThemeId): string {
  if (id === "auto") return getSystemTheme();
  if (id === "pacman") return "night";
  return id;
}

interface Props {
  onThemeChange?: (id: ThemeId) => void;
}

export default function ThemeToggle({ onThemeChange }: Props) {
  const [active, setActive] = useState<ThemeId>("auto");
  const { debugMode } = useDebug();

  const themes = debugMode
    ? [...baseThemes, pacmanTheme]
    : [...baseThemes];

  useEffect(() => {
    const saved = (localStorage.getItem("verifica-theme") || "auto") as ThemeId;
    // If pacman was saved but debug is off, fall back to dark
    const effective = saved === "pacman" && !debugMode ? "dark" : saved;
    setActive(effective);
    document.documentElement.setAttribute("data-theme", resolveDataTheme(effective));
    onThemeChange?.(effective);

    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const handler = () => {
      const current = (localStorage.getItem("verifica-theme") || "auto") as ThemeId;
      if (current === "auto") {
        document.documentElement.setAttribute("data-theme", getSystemTheme());
      }
    };
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, [onThemeChange]);

  // Hook to automatically select pacman theme when debugMode turns on
  const prevDebugMode = useRef(debugMode);
  useEffect(() => {
    if (!prevDebugMode.current && debugMode) {
      select("pacman");
    } else if (prevDebugMode.current && !debugMode && active === "pacman") {
      select("dark");
    }
    prevDebugMode.current = debugMode;
  }, [debugMode]);

  function select(id: ThemeId) {
    setActive(id);
    localStorage.setItem("verifica-theme", id);
    document.documentElement.setAttribute("data-theme", resolveDataTheme(id));
    onThemeChange?.(id);
  }

  return (
    <div className="join join-horizontal bg-base-200 rounded-full p-0.5">
      {themes.map(({ id, label, Icon }) => (
        <div key={id} className="tooltip tooltip-bottom" data-tip={label}>
          <button
            onClick={() => select(id as ThemeId)}
            aria-label={label}
            className={`join-item btn btn-xs btn-ghost rounded-full px-2.5 transition-all duration-200 ${
              active === id
                ? id === "pacman"
                  ? "bg-yellow-400 text-black shadow-sm hover:bg-yellow-400"
                  : "bg-primary text-primary-content shadow-sm hover:bg-primary"
                : "hover:bg-base-300"
            }`}
          >
            <Icon size={14} strokeWidth={active === id ? 2.5 : 2} />
          </button>
        </div>
      ))}
    </div>
  );
}
