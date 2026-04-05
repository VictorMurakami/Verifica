"use client";

import { useState, useCallback, useEffect } from "react";
import { Geist, Geist_Mono, Press_Start_2P } from "next/font/google";
import Script from "next/script";
import { Play } from "lucide-react";
import ThemeToggle, { ThemeId } from "@/components/ThemeToggle";
import MouseGlow from "@/components/MouseGlow";
import Footer from "@/components/Footer";
import { DebugProvider } from "@/context/DebugContext";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

const pressStart2P = Press_Start_2P({
  variable: "--font-retro",
  weight: "400",
  subsets: ["latin"],
});

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const [pacmanMode, setPacmanMode] = useState(false);
  const [showDots, setShowDots] = useState(true);
  const [isGamePlaying, setIsGamePlaying] = useState(false);

  // Read persisted dot preference after hydration
  useEffect(() => {
    const saved = localStorage.getItem("verifato-dots");
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
      localStorage.setItem("verifato-dots", String(next));
      return next;
    });
  }, []);

  // Toggle retro 8-bit font on the whole page when pacman mode is active
  useEffect(() => {
    const root = document.documentElement;
    if (pacmanMode) {
      root.classList.add("pacman-mode", pressStart2P.variable);
    } else {
      root.classList.remove("pacman-mode", pressStart2P.variable);
    }
  }, [pacmanMode]);

  return (
    <html
      lang="pt-BR"
      data-theme="dark"
      suppressHydrationWarning
      className={`${geistSans.variable} ${geistMono.variable} ${pressStart2P.variable} h-full antialiased`}
    >
      <head>
        <title>VeriFato - Detector Inteligente de Fake News</title>
        <meta name="description" content="Verifique a confiabilidade de textos e notícias com inteligência artificial." />
        <Script
          id="theme-initializer"
          strategy="beforeInteractive"
          dangerouslySetInnerHTML={{
            __html: `(function(){try{var t=localStorage.getItem('verifato-theme')||'auto';var d=t;if(t==='auto')d=matchMedia('(prefers-color-scheme:dark)').matches?'dark':'light';if(t==='pacman')d='night';document.documentElement.setAttribute('data-theme',d)}catch(e){}})()`,
          }}
        />
      </head>
      <body className="min-h-full flex flex-col">
        <DebugProvider>
          <MouseGlow pacmanMode={pacmanMode} enabled={showDots} isPlaying={isGamePlaying} onGameOver={handleGameOver} />
          <header className={`navbar px-4 sm:px-6 relative z-10 ${pacmanMode ? "bg-base-200" : ""}`}>
            <div className="flex-1 flex items-center gap-3">
              <span className="text-base sm:text-lg font-bold tracking-tight">
                Veri<span className="text-gradient">Fato</span>
              </span>
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
      </body>
    </html>
  );
}
