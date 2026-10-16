import { describe, expect, it } from "vitest";
import { detectInputType } from "./inputType";

describe("detectInputType", () => {
  it.each(["https://g1.globo.com/x", "http://a.b"])("detects %s as url", (value) => {
    expect(detectInputType(value)).toBe("url");
  });

  it.each([
    "URGENTE: Governo anuncia…",
    "mailto:a@b.c",
    "javascript:alert(1)",
    "ftp://x.y",
    "texto comum",
  ])("detects %s as text", (value) => {
    expect(detectInputType(value)).toBe("text");
  });
});
