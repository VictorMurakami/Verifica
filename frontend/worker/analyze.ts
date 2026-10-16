import { MESSAGES } from "./messages";

export interface RateLimiter {
  limit(options: { key: string }): Promise<{ success: boolean }>;
}

export type FetchLike = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

export interface OriginBinding {
  fetch: FetchLike;
}

export interface AnalyzeEnv {
  ORIGIN_URL: string;
  ALLOWED_ORIGIN: string;
  TURNSTILE_HOSTNAME: string;
  TURNSTILE_SECRET: string;
  GATEWAY_KEY: string;
  BLOCKED_ZONES: string;
  RATE_LIMITER: RateLimiter;
  ORIGIN?: OriginBinding;
  ACCESS_CLIENT_ID?: string;
  ACCESS_CLIENT_SECRET?: string;
}

export const MAX_BODY_BYTES = 32_768;
export const MAX_PAGE_BYTES = 1_048_576;
export const SITEVERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify";
const TURNSTILE_ACTION = "analyze";
const ORIGIN_TIMEOUT_MS = 90_000;
const SITEVERIFY_TIMEOUT_MS = 10_000;
const PAGE_FETCH_TIMEOUT_MS = 10_000;
const PAGE_MAX_REDIRECTS = 3;
const PAGE_USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";
const PAGE_ACCEPT = "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8";
const PAGE_ACCEPT_LANGUAGE = "pt-BR,pt;q=0.9,en;q=0.8";
const BLOCKED_HOSTNAME_SUFFIXES = [".local", ".localhost", ".internal", ".lan", ".home.arpa"];
const LAST_LABEL_PATTERN = /^[a-z]+$/;
const MAX_URL_LENGTH = 2048;
const CHARSET_ALLOWLIST = new Set([
  "utf-8",
  "utf8",
  "iso-8859-1",
  "latin1",
  "windows-1252",
  "cp1252",
  "iso-8859-15",
  "us-ascii",
  "ascii",
  "utf-16le",
  "utf-16be",
]);
const CONTENT_TRIM_PATTERN = /^[\s\x00-\x1f]+|[\s\x00-\x1f]+$/g;

type TurnstileVerdict = "ok" | "rejected" | "unavailable";
type ForwardPayload = { content: string; id?: string };
type PageFetchResult =
  | { ok: true; bytes: Uint8Array; finalUrl: URL; charset?: string }
  | { ok: false; status: number; message: string };

export function errorResponse(status: number, detail: string, extraHeaders: Record<string, string> = {}): Response {
  return new Response(JSON.stringify({ detail }), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
      ...extraHeaders,
    },
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isTimeout(error: unknown): boolean {
  return typeof error === "object" && error !== null && (error as { name?: unknown }).name === "TimeoutError";
}

const ID_PATTERN = /^[A-Za-z0-9-]{1,64}$/;

export function clientKey(ip: string): string {
  if (!ip.includes(":") || ip.includes(".")) return ip;
  const parts = ip.split("::");
  let groups: string[];
  if (parts.length === 2) {
    const head = parts[0] ? parts[0].split(":") : [];
    const tail = parts[1] ? parts[1].split(":") : [];
    const missing = 8 - head.length - tail.length;
    groups = [...head, ...Array(missing).fill("0"), ...tail];
  } else {
    groups = ip.split(":");
  }
  const prefix = groups.slice(0, 4).map((group) => parseInt(group, 16).toString(16));
  return `${prefix.join(":")}::/64`;
}

export function parseBlockedZones(raw: string | undefined): string[] {
  return (raw ?? "")
    .split(",")
    .map((zone) => zone.trim().toLowerCase())
    .filter((zone) => zone.length > 0);
}

export function validateTarget(url: URL, turnstileHostname: string, blockedZones: string[]): boolean {
  if (url.protocol !== "http:" && url.protocol !== "https:") return false;
  if (url.username !== "" || url.password !== "") return false;
  if (url.port !== "" && url.port !== "80" && url.port !== "443") return false;
  const hostname = url.hostname.toLowerCase();
  if (!hostname.includes(".")) return false;
  const labels = hostname.split(".");
  const lastLabel = labels[labels.length - 1];
  if (!LAST_LABEL_PATTERN.test(lastLabel)) return false;
  if (BLOCKED_HOSTNAME_SUFFIXES.some((suffix) => hostname.endsWith(suffix))) return false;
  if (hostname === turnstileHostname.toLowerCase()) return false;
  if (blockedZones.some((zone) => hostname === zone || hostname.endsWith(`.${zone}`))) return false;
  return true;
}

function parseContentType(contentType: string): { baseType: string; charset?: string } {
  const [mime, ...params] = contentType.split(";");
  const baseType = mime.trim().toLowerCase();
  for (const param of params) {
    const [key, value] = param.split("=");
    if (key?.trim().toLowerCase() === "charset" && value) {
      return { baseType, charset: value.trim().replace(/^"|"$/g, "").toLowerCase() };
    }
  }
  return { baseType };
}

export async function fetchPage(
  url: URL,
  fetchImpl: FetchLike,
  turnstileHostname: string,
  blockedZones: string[],
): Promise<PageFetchResult> {
  const signal = AbortSignal.timeout(PAGE_FETCH_TIMEOUT_MS);
  let currentUrl = url;
  let redirects = 0;

  while (true) {
    if (currentUrl.href.length > MAX_URL_LENGTH) {
      return { ok: false, status: 400, message: MESSAGES.urlBlocked };
    }
    let response: Response;
    try {
      response = await fetchImpl(currentUrl.href, {
        redirect: "manual",
        signal,
        headers: {
          "User-Agent": PAGE_USER_AGENT,
          Accept: PAGE_ACCEPT,
          "Accept-Language": PAGE_ACCEPT_LANGUAGE,
        },
      });
    } catch (error) {
      if (isTimeout(error)) return { ok: false, status: 504, message: MESSAGES.pageTimeout };
      return { ok: false, status: 502, message: MESSAGES.pageConnection };
    }

    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("Location");
      if (!location) return { ok: false, status: 400, message: MESSAGES.pageUnavailable };
      if (redirects >= PAGE_MAX_REDIRECTS) return { ok: false, status: 400, message: MESSAGES.pageTooManyRedirects };
      let nextUrl: URL;
      try {
        nextUrl = new URL(location, currentUrl.href);
      } catch {
        return { ok: false, status: 400, message: MESSAGES.pageUnavailable };
      }
      if (!validateTarget(nextUrl, turnstileHostname, blockedZones)) {
        return { ok: false, status: 400, message: MESSAGES.urlBlocked };
      }
      currentUrl = nextUrl;
      redirects += 1;
      continue;
    }

    if (response.status === 401 || response.status === 403) {
      return { ok: false, status: 400, message: MESSAGES.pageForbidden };
    }
    if (response.status === 404) return { ok: false, status: 400, message: MESSAGES.pageNotFound };
    if (response.status === 429) return { ok: false, status: 502, message: MESSAGES.pageRateLimited };
    if (response.status >= 500) return { ok: false, status: 502, message: MESSAGES.pageServerError };
    if (response.status >= 400) return { ok: false, status: 400, message: MESSAGES.pageUnavailable };

    const { baseType, charset } = parseContentType(response.headers.get("Content-Type") ?? "");
    if (baseType !== "text/html" && baseType !== "application/xhtml+xml") {
      return { ok: false, status: 400, message: MESSAGES.pageNotHtml };
    }

    if (!response.body) return { ok: false, status: 400, message: MESSAGES.pageUnavailable };
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let total = 0;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        total += value.byteLength;
        if (total > MAX_PAGE_BYTES) {
          await reader.cancel();
          return { ok: false, status: 400, message: MESSAGES.pageTooLarge };
        }
        chunks.push(value);
      }
    } catch (error) {
      if (isTimeout(error)) return { ok: false, status: 504, message: MESSAGES.pageTimeout };
      return { ok: false, status: 502, message: MESSAGES.pageConnection };
    }

    const bytes = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return { ok: true, bytes, finalUrl: currentUrl, charset };
  }
}

export async function verifyTurnstile(
  token: string,
  ip: string,
  env: AnalyzeEnv,
  fetchImpl: FetchLike,
): Promise<TurnstileVerdict> {
  const form = new FormData();
  form.append("secret", env.TURNSTILE_SECRET);
  form.append("response", token);
  form.append("remoteip", ip);

  let response: Response;
  try {
    response = await fetchImpl(SITEVERIFY_URL, {
      method: "POST",
      body: form,
      signal: AbortSignal.timeout(SITEVERIFY_TIMEOUT_MS),
    });
  } catch (error) {
    console.error("turnstile siteverify inacessível", error);
    return "unavailable";
  }
  if (!response.ok) {
    console.error("turnstile siteverify status", response.status);
    return "unavailable";
  }

  let data: unknown;
  try {
    data = await response.json();
  } catch {
    console.error("turnstile siteverify sem JSON");
    return "unavailable";
  }
  if (!isRecord(data)) return "unavailable";
  if (data.success === true && data.action === TURNSTILE_ACTION && data.hostname === env.TURNSTILE_HOSTNAME) {
    return "ok";
  }
  const codes = Array.isArray(data["error-codes"]) ? data["error-codes"] : [];
  if (codes.includes("internal-error")) {
    console.error("turnstile internal-error");
    return "unavailable";
  }
  return "rejected";
}

export async function handleApi(request: Request, env: AnalyzeEnv, fetchImpl: FetchLike): Promise<Response> {
  const { pathname } = new URL(request.url);
  if (pathname !== "/api/analyze") return errorResponse(404, MESSAGES.notFound);
  if (request.method !== "POST") return errorResponse(405, MESSAGES.methodNotAllowed, { Allow: "POST" });

  const declared = request.headers.get("Content-Length");
  if (declared === null) return errorResponse(411, MESSAGES.lengthRequired);
  const declaredBytes = Number(declared);
  if (!Number.isInteger(declaredBytes) || declaredBytes < 0) return errorResponse(400, MESSAGES.badRequest);
  if (declaredBytes > MAX_BODY_BYTES) return errorResponse(413, MESSAGES.tooLarge);

  if (request.headers.get("Origin") !== env.ALLOWED_ORIGIN) return errorResponse(403, MESSAGES.forbiddenOrigin);

  const ip = request.headers.get("CF-Connecting-IP");
  if (!ip) return errorResponse(403, MESSAGES.forbiddenOrigin);
  const key = clientKey(ip);
  const { success } = await env.RATE_LIMITER.limit({ key });
  if (!success) return errorResponse(429, MESSAGES.rateLimited, { "Retry-After": "60" });

  const raw = await request.text();
  if (new TextEncoder().encode(raw).byteLength > MAX_BODY_BYTES) return errorResponse(413, MESSAGES.tooLarge);

  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return errorResponse(400, MESSAGES.badRequest);
  }
  if (
    !isRecord(body) ||
    typeof body.content !== "string" ||
    typeof body.turnstileToken !== "string" ||
    body.turnstileToken === ""
  ) {
    return errorResponse(400, MESSAGES.badRequest);
  }

  const verdict = await verifyTurnstile(body.turnstileToken, ip, env, fetchImpl);
  if (verdict === "unavailable") return errorResponse(503, MESSAGES.turnstileUnavailable, { "Retry-After": "30" });
  if (verdict === "rejected") return errorResponse(403, MESSAGES.turnstileRejected);

  const trimmedContent = body.content.replace(CONTENT_TRIM_PATTERN, "");
  let pageUrl: URL | null = null;
  try {
    const candidate = new URL(trimmedContent);
    if (candidate.protocol === "http:" || candidate.protocol === "https:") pageUrl = candidate;
  } catch {
    pageUrl = null;
  }
  if (pageUrl) {
    return handlePageAnalysis(pageUrl, body.id, key, env, fetchImpl);
  }

  const payload: ForwardPayload = { content: body.content };
  if (typeof body.id === "string" && ID_PATTERN.test(body.id)) payload.id = body.id;
  return forwardToOrigin("/api/analyze", JSON.stringify(payload), key, env, fetchImpl, {
    "Content-Type": "application/json",
  });
}

async function handlePageAnalysis(
  url: URL,
  id: unknown,
  key: string,
  env: AnalyzeEnv,
  fetchImpl: FetchLike,
): Promise<Response> {
  const blockedZones = parseBlockedZones(env.BLOCKED_ZONES);
  if (!validateTarget(url, env.TURNSTILE_HOSTNAME, blockedZones)) return errorResponse(400, MESSAGES.urlBlocked);

  const result = await fetchPage(url, fetchImpl, env.TURNSTILE_HOSTNAME, blockedZones);
  if (!result.ok) return errorResponse(result.status, result.message);

  const headers: Record<string, string> = {
    "Content-Type": "application/octet-stream",
    "X-Verifica-Source-Url": url.href,
    "X-Verifica-Page-Url": result.finalUrl.href,
  };
  if (result.charset && CHARSET_ALLOWLIST.has(result.charset)) headers["X-Verifica-Page-Charset"] = result.charset;
  if (typeof id === "string" && ID_PATTERN.test(id)) headers["X-Verifica-Request-Id"] = id;

  return forwardToOrigin("/api/analyze-page", result.bytes, key, env, fetchImpl, headers);
}

async function forwardToOrigin(
  path: string,
  body: BodyInit,
  key: string,
  env: AnalyzeEnv,
  fetchImpl: FetchLike,
  extraHeaders: Record<string, string> = {},
): Promise<Response> {
  const binding = env.ORIGIN;
  let send: FetchLike;
  if (binding) {
    send = (input, init) => binding.fetch(input, init);
  } else if (env.ORIGIN_URL.startsWith("https://") && env.ACCESS_CLIENT_ID && env.ACCESS_CLIENT_SECRET) {
    send = fetchImpl;
  } else {
    console.error("fallback sem https/Access");
    return errorResponse(502, MESSAGES.originUnavailable);
  }
  const headers: Record<string, string> = {
    ...extraHeaders,
    "X-Verifica-Gateway-Key": env.GATEWAY_KEY,
    "X-Verifica-Client-Ip": key,
  };
  if (env.ACCESS_CLIENT_ID && env.ACCESS_CLIENT_SECRET) {
    headers["CF-Access-Client-Id"] = env.ACCESS_CLIENT_ID;
    headers["CF-Access-Client-Secret"] = env.ACCESS_CLIENT_SECRET;
  }

  let origin: Response;
  try {
    origin = await send(`${env.ORIGIN_URL}${path}`, {
      method: "POST",
      headers,
      body,
      redirect: "manual",
      signal: AbortSignal.timeout(ORIGIN_TIMEOUT_MS),
    });
  } catch (error) {
    if (isTimeout(error)) return errorResponse(504, MESSAGES.originTimeout);
    console.error("origem inacessível", error);
    return errorResponse(502, MESSAGES.originUnavailable);
  }

  const contentType = origin.headers.get("Content-Type") ?? "";
  // 401 = deriva de GATEWAY_KEY; não-JSON = erro do túnel/Access. Nunca repassar ao navegador.
  if (origin.status === 401 || !contentType.includes("application/json")) {
    console.error("origem recusou o gateway ou respondeu sem JSON", origin.status);
    return errorResponse(502, MESSAGES.originUnavailable);
  }

  const responseHeaders = new Headers({
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
  });
  const retryAfter = origin.headers.get("Retry-After");
  if (retryAfter) responseHeaders.set("Retry-After", retryAfter);
  return new Response(origin.body, { status: origin.status, headers: responseHeaders });
}
