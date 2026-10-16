import { afterEach, describe, expect, it, vi } from "vitest";
import { analyzeContent } from "./api";
import { GENERIC_ERROR, NETWORK_ERROR, STATUS_MESSAGES } from "./errorMessages";

const REQUEST = {
  id: "req-1",
  inputType: "text" as const,
  content: "Uma notícia",
  timestamp: "2026-10-15T12:00:00.000Z",
};

const VALID_RESULT = {
  requestId: "req-1",
  reliabilityScore: 7,
  overallVerdict: "Confiável",
  flaggedExcerpts: [],
  analyzedText: "Uma notícia",
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("analyzeContent", () => {
  it("sends only id, content and token to the relative endpoint", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => Response.json(VALID_RESULT));
    vi.stubGlobal("fetch", fetchMock);
    await analyzeContent(REQUEST, "tok");
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/analyze");
    expect(init?.method).toBe("POST");
    expect(JSON.parse(String(init?.body))).toEqual({ id: "req-1", content: "Uma notícia", turnstileToken: "tok" });
  });

  it("rejects an out-of-shape 200 body with the generic message", async () => {
    vi.stubGlobal("fetch", vi.fn<typeof fetch>(async () => Response.json({})));
    await expect(analyzeContent(REQUEST, "tok")).rejects.toThrow(GENERIC_ERROR);
  });

  it("rejects a non-JSON 200 body with the generic message", async () => {
    vi.stubGlobal("fetch", vi.fn<typeof fetch>(async () => new Response("<html>", { status: 200 })));
    await expect(analyzeContent(REQUEST, "tok")).rejects.toThrow(GENERIC_ERROR);
  });

  it("uses detail from the error body", async () => {
    vi.stubGlobal("fetch", vi.fn<typeof fetch>(async () => Response.json({ detail: "Volte amanhã." }, { status: 429 })));
    await expect(analyzeContent(REQUEST, "tok")).rejects.toThrow("Volte amanhã.");
  });

  it("falls back to the status message when the body is not JSON", async () => {
    vi.stubGlobal("fetch", vi.fn<typeof fetch>(async () => new Response("<html>", { status: 502 })));
    await expect(analyzeContent(REQUEST, "tok")).rejects.toThrow(STATUS_MESSAGES[502]);
  });

  it("falls back to the generic message for unknown statuses", async () => {
    vi.stubGlobal("fetch", vi.fn<typeof fetch>(async () => new Response("", { status: 418 })));
    await expect(analyzeContent(REQUEST, "tok")).rejects.toThrow(GENERIC_ERROR);
  });

  it("maps network failures", async () => {
    vi.stubGlobal("fetch", vi.fn<typeof fetch>(async () => {
      throw new TypeError("Failed to fetch");
    }));
    await expect(analyzeContent(REQUEST, "tok")).rejects.toThrow(NETWORK_ERROR);
  });
});
