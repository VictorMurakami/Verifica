import { describe, expect, it, vi } from "vitest";
import { clientKey, handleApi, MAX_BODY_BYTES, SITEVERIFY_URL, type AnalyzeEnv, type FetchLike } from "./analyze";
import { MESSAGES } from "./messages";

const SITE = "https://verifica.kaorabr.com";
const ORIGIN = "http://backend:8000";
const GOOD_BODY = JSON.stringify({ id: "req-1", content: "Uma notícia", turnstileToken: "tok" });

type Siteverify = { success: boolean; action?: string; hostname?: string; "error-codes"?: string[] };
const GOOD_SITEVERIFY: Siteverify = { success: true, action: "analyze", hostname: "verifica.kaorabr.com" };

function makeFetch(options: { siteverify?: Siteverify | Error; origin?: Response | Error } = {}) {
  return vi.fn<FetchLike>(async (input) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    if (url === SITEVERIFY_URL) {
      const result = options.siteverify ?? GOOD_SITEVERIFY;
      if (result instanceof Error) throw result;
      return Response.json(result);
    }
    const origin = options.origin ?? Response.json({ requestId: "req-1", reliabilityScore: 80 });
    if (origin instanceof Error) throw origin;
    return origin;
  });
}

function makeEnv(net: FetchLike, overrides: Partial<AnalyzeEnv> = {}): AnalyzeEnv {
  return {
    ORIGIN_URL: ORIGIN,
    ALLOWED_ORIGIN: SITE,
    TURNSTILE_HOSTNAME: "verifica.kaorabr.com",
    TURNSTILE_SECRET: "ts-secret",
    GATEWAY_KEY: "gateway-key",
    RATE_LIMITER: { limit: vi.fn(async () => ({ success: true })) },
    ORIGIN: { fetch: net },
    ...overrides,
  };
}

function makeRequest(
  options: { body?: string; method?: string; path?: string; headers?: Record<string, string>; omitLength?: boolean } = {},
): Request {
  const method = options.method ?? "POST";
  const body = options.body ?? GOOD_BODY;
  const headers = new Headers({
    "Content-Type": "application/json",
    Origin: SITE,
    "CF-Connecting-IP": "203.0.113.7",
    ...options.headers,
  });
  if (method === "POST" && !options.omitLength && !headers.has("Content-Length")) {
    headers.set("Content-Length", String(new TextEncoder().encode(body).byteLength));
  }
  return new Request(`${SITE}${options.path ?? "/api/analyze"}`, {
    method,
    headers,
    body: method === "POST" ? body : undefined,
  });
}

async function run(request: Request, options: Parameters<typeof makeFetch>[0] = {}, overrides: Partial<AnalyzeEnv> = {}) {
  const net = makeFetch(options);
  const env = makeEnv(net, overrides);
  return { response: await handleApi(request, env, net), net, env };
}

async function detail(response: Response): Promise<string> {
  return ((await response.json()) as { detail: string }).detail;
}

describe("clientKey", () => {
  it("returns IPv4 unchanged", () => {
    expect(clientKey("203.0.113.7")).toBe("203.0.113.7");
  });

  it("collapses expanded and :: forms into the same /64", () => {
    expect(clientKey("2001:db8:abcd:12::1")).toBe("2001:db8:abcd:12::/64");
    expect(clientKey("2001:db8:abcd:12:ffff:1:2:3")).toBe("2001:db8:abcd:12::/64");
  });

  it("expands :: at the start of the address", () => {
    expect(clientKey("2001:db8::1")).toBe("2001:db8:0:0::/64");
  });

  it("normalizes case and leading zeros", () => {
    expect(clientKey("2001:DB8:0:0001::5")).toBe("2001:db8:0:1::/64");
  });

  it("produces a different key for a different /64", () => {
    expect(clientKey("2001:db8:abcd:12::1")).not.toBe(clientKey("2001:db8:abcd:13::1"));
  });
});

describe("handleApi", () => {
  it("returns 404 for other api routes", async () => {
    const { response } = await run(makeRequest({ path: "/api/other" }));
    expect(response.status).toBe(404);
    expect(await detail(response)).toBe(MESSAGES.notFound);
  });

  it("returns 405 for non-POST", async () => {
    const { response } = await run(makeRequest({ method: "GET" }));
    expect(response.status).toBe(405);
    expect(response.headers.get("Allow")).toBe("POST");
  });

  it("requires Content-Length", async () => {
    const { response } = await run(makeRequest({ omitLength: true }));
    expect(response.status).toBe(411);
  });

  it("rejects declared bodies over the limit", async () => {
    const { response } = await run(makeRequest({ headers: { "Content-Length": String(MAX_BODY_BYTES + 1) } }));
    expect(response.status).toBe(413);
  });

  it("rejects real bodies over the limit even when the header lies", async () => {
    const fake = {
      url: `${SITE}/api/analyze`,
      method: "POST",
      headers: new Headers({ "Content-Length": "10", Origin: SITE, "CF-Connecting-IP": "203.0.113.7" }),
      text: async () => "a".repeat(MAX_BODY_BYTES + 1),
    } as unknown as Request;
    const { response } = await run(fake);
    expect(response.status).toBe(413);
  });

  it("rejects foreign origins", async () => {
    const { response } = await run(makeRequest({ headers: { Origin: "https://evil.example" } }));
    expect(response.status).toBe(403);
    expect(await detail(response)).toBe(MESSAGES.forbiddenOrigin);
  });

  it("rate limits by client IP before touching Turnstile", async () => {
    const limiter = { limit: vi.fn(async () => ({ success: false })) };
    const { response, net } = await run(makeRequest(), {}, { RATE_LIMITER: limiter });
    expect(response.status).toBe(429);
    expect(response.headers.get("Retry-After")).toBe("60");
    expect(limiter.limit).toHaveBeenCalledWith({ key: "203.0.113.7" });
    expect(net).not.toHaveBeenCalled();
  });

  it("rate limits and forwards IPv6 clients by their /64, keeping the full IP for siteverify", async () => {
    const net = makeFetch();
    const originFetch = makeFetch();
    const limiter = { limit: vi.fn(async () => ({ success: true })) };
    const response = await handleApi(
      makeRequest({ headers: { "CF-Connecting-IP": "2001:db8:abcd:12::99" } }),
      makeEnv(net, { ORIGIN: { fetch: originFetch }, RATE_LIMITER: limiter }),
      net,
    );
    expect(response.status).toBe(200);
    expect(limiter.limit).toHaveBeenCalledWith({ key: "2001:db8:abcd:12::/64" });

    const [, originInit] = originFetch.mock.calls[0];
    const originHeaders = new Headers(originInit?.headers);
    expect(originHeaders.get("X-Verifica-Client-Ip")).toBe("2001:db8:abcd:12::/64");

    const [, siteverifyInit] = net.mock.calls[0];
    expect((siteverifyInit?.body as FormData).get("remoteip")).toBe("2001:db8:abcd:12::99");
  });

  it.each([
    ["invalid JSON", "{nope"],
    ["missing token", JSON.stringify({ content: "x" })],
    ["empty token", JSON.stringify({ content: "x", turnstileToken: "" })],
    ["non-string content", JSON.stringify({ content: 1, turnstileToken: "tok" })],
  ])("returns 400 for %s", async (_label, body) => {
    const { response } = await run(makeRequest({ body }));
    expect(response.status).toBe(400);
  });

  it.each([
    ["failed challenge", { success: false }],
    ["wrong action", { ...GOOD_SITEVERIFY, action: "login" }],
    ["wrong hostname", { ...GOOD_SITEVERIFY, hostname: "evil.example" }],
  ])("returns 403 for %s", async (_label, siteverify) => {
    const { response, net } = await run(makeRequest(), { siteverify });
    expect(response.status).toBe(403);
    expect(await detail(response)).toBe(MESSAGES.turnstileRejected);
    expect(net).toHaveBeenCalledTimes(1);
  });

  it("fails closed with 503 when siteverify is unreachable", async () => {
    const { response } = await run(makeRequest(), { siteverify: new Error("down") });
    expect(response.status).toBe(503);
    expect(await detail(response)).toBe(MESSAGES.turnstileUnavailable);
  });

  it("treats Turnstile internal-error as unavailable", async () => {
    const { response } = await run(makeRequest(), { siteverify: { success: false, "error-codes": ["internal-error"] } });
    expect(response.status).toBe(503);
  });

  it("forwards only content and id through the VPC binding", async () => {
    const net = makeFetch();
    const originFetch = makeFetch();
    const response = await handleApi(makeRequest(), makeEnv(net, { ORIGIN: { fetch: originFetch } }), net);
    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(response.headers.get("Content-Type")).toBe("application/json; charset=utf-8");
    expect(await response.json()).toEqual({ requestId: "req-1", reliabilityScore: 80 });
    expect(net).toHaveBeenCalledTimes(1);

    const [url, init] = originFetch.mock.calls[0];
    expect(url).toBe(`${ORIGIN}/api/analyze`);
    const headers = new Headers(init?.headers);
    expect(headers.get("X-Verifica-Gateway-Key")).toBe("gateway-key");
    expect(headers.get("X-Verifica-Client-Ip")).toBe("203.0.113.7");
    expect(headers.has("CF-Access-Client-Id")).toBe(false);
    expect(init?.redirect).toBe("manual");
    expect(JSON.parse(String(init?.body))).toEqual({ content: "Uma notícia", id: "req-1" });
  });

  it.each([
    ["contains a newline", "req\n1"],
    ["is too long", "a".repeat(65)],
  ])("omits id from the forwarded body when it %s", async (_label, id) => {
    const net = makeFetch();
    const originFetch = makeFetch();
    const response = await handleApi(
      makeRequest({ body: JSON.stringify({ id, content: "Uma notícia", turnstileToken: "tok" }) }),
      makeEnv(net, { ORIGIN: { fetch: originFetch } }),
      net,
    );
    expect(response.status).toBe(200);
    const [, init] = originFetch.mock.calls[0];
    expect(JSON.parse(String(init?.body))).toEqual({ content: "Uma notícia" });
  });

  it("normalizes the forwarded Content-Type regardless of the origin's exact header", async () => {
    const origin = new Response(JSON.stringify({ requestId: "req-1" }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
    const { response } = await run(makeRequest(), { origin });
    expect(response.headers.get("Content-Type")).toBe("application/json; charset=utf-8");
  });

  it("falls back to fetch with Access headers when there is no VPC binding", async () => {
    const { response, net } = await run(makeRequest(), {}, {
      ORIGIN: undefined,
      ORIGIN_URL: "https://verifica-origin.kaorabr.com",
      ACCESS_CLIENT_ID: "access-id",
      ACCESS_CLIENT_SECRET: "access-secret",
    });
    expect(response.status).toBe(200);
    const [url, init] = net.mock.calls[1];
    expect(url).toBe("https://verifica-origin.kaorabr.com/api/analyze");
    const headers = new Headers(init?.headers);
    expect(headers.get("CF-Access-Client-Id")).toBe("access-id");
    expect(headers.get("CF-Access-Client-Secret")).toBe("access-secret");
  });

  it("fails closed with 502 when there is no VPC binding and no Access credentials", async () => {
    const { response, net } = await run(makeRequest(), {}, {
      ORIGIN: undefined,
      ORIGIN_URL: "https://verifica-origin.kaorabr.com",
    });
    expect(response.status).toBe(502);
    expect(await detail(response)).toBe(MESSAGES.originUnavailable);
    expect(net).toHaveBeenCalledTimes(1);
  });

  it("fails closed with 502 when the fallback origin is not https, even with credentials", async () => {
    const { response, net } = await run(makeRequest(), {}, {
      ORIGIN: undefined,
      ORIGIN_URL: "http://verifica-origin.kaorabr.com",
      ACCESS_CLIENT_ID: "access-id",
      ACCESS_CLIENT_SECRET: "access-secret",
    });
    expect(response.status).toBe(502);
    expect(net).toHaveBeenCalledTimes(1);
  });

  it("passes origin errors and Retry-After through", async () => {
    const origin = Response.json({ detail: "Volte amanhã." }, { status: 429, headers: { "Retry-After": "3600" } });
    const { response } = await run(makeRequest(), { origin });
    expect(response.status).toBe(429);
    expect(response.headers.get("Retry-After")).toBe("3600");
    expect(await detail(response)).toBe("Volte amanhã.");
  });

  it("origin 401 becomes 502", async () => {
    const origin = Response.json({ detail: "Acesso não autorizado." }, { status: 401 });
    const { response } = await run(makeRequest(), { origin });
    expect(response.status).toBe(502);
    expect(await detail(response)).toBe(MESSAGES.originUnavailable);
  });

  it("non-JSON origin response becomes 502", async () => {
    const origin = new Response("<html>Bad gateway</html>", { status: 502, headers: { "Content-Type": "text/html" } });
    const { response } = await run(makeRequest(), { origin });
    expect(response.status).toBe(502);
    expect(response.headers.get("Content-Type")).toContain("application/json");
    expect(await detail(response)).toBe(MESSAGES.originUnavailable);
  });

  it("origin redirect becomes 502", async () => {
    const origin = new Response("<html>login</html>", {
      status: 302,
      headers: { Location: "https://kaorabr.cloudflareaccess.com/login", "Content-Type": "text/html" },
    });
    const { response } = await run(makeRequest(), { origin });
    expect(response.status).toBe(502);
  });

  it("origin timeout becomes 504", async () => {
    const { response } = await run(makeRequest(), { origin: new DOMException("timeout", "TimeoutError") });
    expect(response.status).toBe(504);
    expect(await detail(response)).toBe(MESSAGES.originTimeout);
  });

  it("unreachable origin becomes 502", async () => {
    const { response } = await run(makeRequest(), { origin: new TypeError("fetch failed") });
    expect(response.status).toBe(502);
  });
});
