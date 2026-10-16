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
  RATE_LIMITER: RateLimiter;
  ORIGIN?: OriginBinding;
  ACCESS_CLIENT_ID?: string;
  ACCESS_CLIENT_SECRET?: string;
}

export const MAX_BODY_BYTES = 32_768;
export const SITEVERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify";
const TURNSTILE_ACTION = "analyze";
const ORIGIN_TIMEOUT_MS = 90_000;
const SITEVERIFY_TIMEOUT_MS = 10_000;

type TurnstileVerdict = "ok" | "rejected" | "unavailable";
type ForwardPayload = { content: string; id?: string };

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

  const payload: ForwardPayload = { content: body.content };
  if (typeof body.id === "string" && ID_PATTERN.test(body.id)) payload.id = body.id;
  return forwardToOrigin(payload, key, env, fetchImpl);
}

async function forwardToOrigin(
  payload: ForwardPayload,
  key: string,
  env: AnalyzeEnv,
  fetchImpl: FetchLike,
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
    "Content-Type": "application/json",
    "X-Verifica-Gateway-Key": env.GATEWAY_KEY,
    "X-Verifica-Client-Ip": key,
  };
  if (env.ACCESS_CLIENT_ID && env.ACCESS_CLIENT_SECRET) {
    headers["CF-Access-Client-Id"] = env.ACCESS_CLIENT_ID;
    headers["CF-Access-Client-Secret"] = env.ACCESS_CLIENT_SECRET;
  }

  let origin: Response;
  try {
    origin = await send(`${env.ORIGIN_URL}/api/analyze`, {
      method: "POST",
      headers,
      body: JSON.stringify(payload),
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
