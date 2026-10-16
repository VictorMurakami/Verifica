"use client";

import { useCallback, useEffect, useRef } from "react";
import { TURNSTILE_FAILED, TURNSTILE_UNAVAILABLE } from "@/services/errorMessages";

const SCRIPT_SRC = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
const TOKEN_TIMEOUT_MS = 15_000;
const ACTION = "analyze";

interface TurnstileRenderOptions {
  sitekey: string;
  action: string;
  execution: "execute";
  appearance: "execute";
  callback: (token: string) => void;
  "error-callback": () => boolean;
  "expired-callback": () => void;
}

interface TurnstileApi {
  render(container: HTMLElement, options: TurnstileRenderOptions): string | undefined;
  execute(widgetId: string): void;
  reset(widgetId: string): void;
  remove(widgetId: string): void;
}

declare global {
  interface Window {
    turnstile?: TurnstileApi;
  }
}

type Pending = { resolve: (token: string) => void; reject: (error: Error) => void };

let scriptPromise: Promise<TurnstileApi> | null = null;

function loadTurnstile(): Promise<TurnstileApi> {
  if (window.turnstile) return Promise.resolve(window.turnstile);
  if (!scriptPromise) {
    scriptPromise = new Promise<TurnstileApi>((resolve, reject) => {
      const script = document.createElement("script");
      script.src = SCRIPT_SRC;
      script.async = true;
      script.onload = () => (window.turnstile ? resolve(window.turnstile) : reject(new Error(TURNSTILE_UNAVAILABLE)));
      script.onerror = () => {
        scriptPromise = null;
        script.remove();
        reject(new Error(TURNSTILE_UNAVAILABLE));
      };
      document.head.appendChild(script);
    });
  }
  return scriptPromise;
}

export function useTurnstile(siteKey: string | undefined) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const widgetIdRef = useRef<string | null>(null);
  const pendingRef = useRef<Pending | null>(null);

  useEffect(() => {
    return () => {
      if (widgetIdRef.current && window.turnstile) window.turnstile.remove(widgetIdRef.current);
      widgetIdRef.current = null;
    };
  }, []);

  const ensureWidget = useCallback(async (): Promise<{ api: TurnstileApi; id: string }> => {
    if (!siteKey) throw new Error(TURNSTILE_UNAVAILABLE);
    const api = await loadTurnstile();
    if (widgetIdRef.current) return { api, id: widgetIdRef.current };
    const container = containerRef.current;
    if (!container) throw new Error(TURNSTILE_UNAVAILABLE);
    const id = api.render(container, {
      sitekey: siteKey,
      action: ACTION,
      execution: "execute",
      appearance: "execute",
      callback: (token) => {
        pendingRef.current?.resolve(token);
        pendingRef.current = null;
      },
      "error-callback": () => {
        pendingRef.current?.reject(new Error(TURNSTILE_FAILED));
        pendingRef.current = null;
        return true;
      },
      "expired-callback": () => {},
    });
    if (!id) throw new Error(TURNSTILE_UNAVAILABLE);
    widgetIdRef.current = id;
    return { api, id };
  }, [siteKey]);

  const getToken = useCallback(async (): Promise<string> => {
    const { api, id } = await ensureWidget();
    return new Promise<string>((resolve, reject) => {
      const timer = window.setTimeout(() => {
        pendingRef.current = null;
        reject(new Error(TURNSTILE_FAILED));
      }, TOKEN_TIMEOUT_MS);
      pendingRef.current = {
        resolve: (token) => {
          window.clearTimeout(timer);
          resolve(token);
        },
        reject: (error) => {
          window.clearTimeout(timer);
          reject(error);
        },
      };
      // Token é de uso único: reset antes de cada execução.
      api.reset(id);
      api.execute(id);
    });
  }, [ensureWidget]);

  return { containerRef, getToken };
}
