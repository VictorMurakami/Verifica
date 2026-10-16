"use client";

import { useState, useCallback, useEffect } from "react";
import { Play } from "lucide-react";
import ThemeToggle, { ThemeId } from "@/components/ThemeToggle";
import MouseGlow from "@/components/MouseGlow";
import Footer from "@/components/Footer";
import ThemeLogo from "@/components/ThemeLogo";
import { DebugProvider } from "@/context/DebugContext";

interface AppShellProps {
  retroFontClass: string;
  children: React.ReactNode;
}

export default function AppShell({ retroFontClass, children }: AppShellProps) {
  const [pacmanMode, setPacmanMode] = useState(false);
  const [showDots, setShowDots] = useState(true);
  const [isGamePlaying, setIsGamePlaying] = useState(false);

  // Read persisted dot preference after hydration
  useEffect(() => {
    const saved = localStorage.getItem("verifica-dots");
    if (saved === "false") setShowDots(false);
  }, []);

  const handleThemeChange = useCallback((id: ThemeId) => {
    setPacmanMode(id === "pacman");
  }, []);

  const handleGameOver = useCallback(() => setIsGamePlaying(false), []);

  // Stop the game if pac-man mode or dots get disabled
  useEffect(() => {
    if (!pacmanMode || !showDots) setIsGamePlaying(false);
  }, [pacmanMode, showDots]);

  const toggleDots = useCallback(() => {
    setShowDots((prev) => {
      const next = !prev;
      localStorage.setItem("verifica-dots", String(next));
      return next;
    });
  }, []);

  // Toggle retro 8-bit font on the whole page when pacman mode is active
  useEffect(() => {
    const root = document.documentElement;
    if (pacmanMode) {
      root.classList.add("pacman-mode", retroFontClass);
    } else {
      root.classList.remove("pacman-mode", retroFontClass);
    }
  }, [pacmanMode, retroFontClass]);

  return (
    <DebugProvider>
      <MouseGlow pacmanMode={pacmanMode} enabled={showDots} isPlaying={isGamePlaying} onGameOver={handleGameOver} />
      <header className={`navbar px-4 sm:px-6 relative z-10 ${pacmanMode ? "bg-base-200" : ""}`}>
        <div className="flex-1 flex items-center gap-3">
          <div className="w-28 flex items-center max-w-[40px] cursor-pointer" onClick={() => {
            if (window.location.pathname === "/") {
              window.dispatchEvent(new CustomEvent("verifica:new-analysis"));
            } else {
              window.location.href = "/";
            }
          }}>
            <ThemeLogo type="logo" />
          </div>
          {pacmanMode && showDots && !isGamePlaying && (
            <button
              onClick={() => setIsGamePlaying(true)}
              className="btn btn-xs bg-yellow-400 hover:bg-yellow-300 text-black border border-yellow-500 shadow shadow-yellow-400/30 rounded-full gap-1.5"
            >
              <Play size={12} fill="black" />
              PLAY
            </button>
          )}
        </div>
        <div className="flex-none flex items-center gap-2">
          <div className="tooltip tooltip-bottom" data-tip={showDots ? "Ocultar pontos" : "Mostrar pontos"}>
            <button
              onClick={toggleDots}
              aria-label={showDots ? "Ocultar pontos do fundo" : "Mostrar pontos do fundo"}
              className={`btn btn-xs btn-ghost rounded-full px-2.5 transition-all duration-200 ${showDots ? "opacity-100" : "opacity-40"
                }`}
            >
              <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="4" cy="4" r="1.5" /><circle cx="12" cy="4" r="1.5" /><circle cx="20" cy="4" r="1.5" />
                <circle cx="4" cy="12" r="1.5" /><circle cx="12" cy="12" r="1.5" /><circle cx="20" cy="12" r="1.5" />
                <circle cx="4" cy="20" r="1.5" /><circle cx="12" cy="20" r="1.5" /><circle cx="20" cy="20" r="1.5" />
              </svg>
            </button>
          </div>
          <ThemeToggle onThemeChange={handleThemeChange} />
        </div>
      </header>
      <div className="flex-1 flex flex-col relative z-10">{children}</div>
      <Footer />
    </DebugProvider>
  );
}
