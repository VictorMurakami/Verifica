import { ImageResponse } from "next/og";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { SITE_TAGLINE, SITE_URL } from "@/lib/site";

// The image renderer reads neither woff2 nor variable fonts, so static Geist
// weights live in the repository. They are read on first render, not on import:
// the images are prerendered, and the deployed Worker has no filesystem.
const fontDirectory = join(process.cwd(), "src/assets/fonts");
const loadFonts = () =>
  Promise.all(
    ([400, 500] as const).map(async (weight) => ({
      name: "Geist",
      data: await readFile(join(fontDirectory, `geist-latin-${weight}-normal.ttf`)),
      weight,
      style: "normal" as const,
    })),
  );
let fonts: ReturnType<typeof loadFonts> | undefined;

const logoPath = join(process.cwd(), "public/logos/share/Logotipo1_Dark.png");
const loadLogoDataUri = async () => {
  const buffer = await readFile(logoPath);
  return `data:image/png;base64,${buffer.toString("base64")}`;
};
let logoDataUri: ReturnType<typeof loadLogoDataUri> | undefined;

const LOGO_WIDTH = 560;
const LOGO_HEIGHT = Math.round((LOGO_WIDTH * 143) / 939);

/** Link preview for WhatsApp, LinkedIn, Slack and X. */
export async function renderShareImage(size: { width: number; height: number }) {
  const [logo, loadedFonts] = await Promise.all([
    (logoDataUri ??= loadLogoDataUri()),
    (fonts ??= loadFonts()),
  ]);
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          position: "relative",
          background: "linear-gradient(135deg, #1d232a 0%, #15191e 100%)",
          fontFamily: "Geist",
        }}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={logo} width={LOGO_WIDTH} height={LOGO_HEIGHT} alt="" style={{ display: "flex" }} />
        <div style={{ display: "flex", marginTop: 32, fontSize: 40, fontWeight: 500, color: "#a6adba" }}>
          {SITE_TAGLINE}
        </div>
        <div
          style={{
            display: "flex",
            position: "absolute",
            bottom: 32,
            left: 0,
            right: 0,
            justifyContent: "center",
            fontSize: 24,
            color: "rgba(166,173,186,0.8)",
          }}
        >
          {SITE_URL.host}
        </div>
      </div>
    ),
    { ...size, fonts: loadedFonts },
  );
}
