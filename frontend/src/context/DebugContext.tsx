"use client";

import { createContext, useContext, useState, useCallback, ReactNode } from "react";
import { useKonamiCode } from "@/hooks/useKonamiCode";

interface DebugContextValue {
  debugMode: boolean;
  setDebugMode: (v: boolean | ((prev: boolean) => boolean)) => void;
}

const DebugContext = createContext<DebugContextValue>({
  debugMode: false,
  setDebugMode: () => {},
});

export function DebugProvider({ children }: { children: ReactNode }) {
  const [debugMode, setDebugMode] = useState(false);

  useKonamiCode(useCallback(() => setDebugMode((d) => !d), []));

  return (
    <DebugContext.Provider value={{ debugMode, setDebugMode }}>
      {children}
    </DebugContext.Provider>
  );
}

export function useDebug() {
  return useContext(DebugContext);
}
