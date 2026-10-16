import { describe, expect, it } from "vitest";
import robots from "./robots";
import sitemap from "./sitemap";
import manifest from "./manifest";
import { SITE_DESCRIPTION, SITE_NAME, SITE_TITLE, SITE_URL, THEME_COLORS } from "@/lib/site";

describe("robots", () => {
  it("allows everything and points to an absolute sitemap and host", () => {
    const result = robots();
    expect(result.rules).toEqual({ userAgent: "*", allow: "/" });
    expect(result.sitemap).toBe(new URL("/sitemap.xml", SITE_URL).href);
    expect(result.host).toBe(SITE_URL.origin);
  });
});

describe("sitemap", () => {
  it("lists the home page and the privacy page with absolute URLs", () => {
    const result = sitemap();
    const home = result.find((entry) => entry.url === SITE_URL.href);
    const privacy = result.find((entry) => entry.url === new URL("/privacy", SITE_URL).href);

    expect(home).toMatchObject({ changeFrequency: "monthly", priority: 1 });
    expect(privacy).toMatchObject({ changeFrequency: "yearly", priority: 0.3 });
    expect(result.every((entry) => entry.url.startsWith("https://"))).toBe(true);
  });
});

describe("manifest", () => {
  it("describes the app, its colors and its icons", () => {
    const result = manifest();
    expect(result.name).toBe(SITE_TITLE);
    expect(result.short_name).toBe(SITE_NAME);
    expect(result.description).toBe(SITE_DESCRIPTION);
    expect(result.start_url).toBe("/");
    expect(result.display).toBe("standalone");
    expect(result.lang).toBe("pt-BR");
    expect(result.background_color).toBe(THEME_COLORS.dark);
    expect(result.theme_color).toBe(THEME_COLORS.dark);
    expect(result.icons).toEqual([
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
      { src: "/icons/maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ]);
  });
});
