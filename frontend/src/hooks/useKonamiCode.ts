"use client";

import { useEffect, useRef } from "react";

const KONAMI = [
  "ArrowUp", "ArrowUp", "ArrowDown", "ArrowDown",
  "ArrowLeft", "ArrowRight", "ArrowLeft", "ArrowRight",
  "b", "a",
];

export function useKonamiCode(callback: () => void) {
  const index = useRef(0);

  useEffect(() => {
    function handler(e: KeyboardEvent) {
      if (e.key.toLowerCase() === KONAMI[index.current].toLowerCase()) {
        index.current++;
        if (index.current === KONAMI.length) {
          index.current = 0;
          callback();
        }
      } else if (e.key.toLowerCase() === KONAMI[0].toLowerCase()) {
        // If it breaks the sequence but starts a new one (e.g. 3rd Up arrow)
        index.current = 1;
      } else {
        index.current = 0;
      }
    }
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [callback]);
}
