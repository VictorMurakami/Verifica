import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono, Press_Start_2P } from "next/font/google";
import Script from "next/script";
import AppShell from "@/components/AppShell";
import { OG_LOCALE, SITE_DESCRIPTION, SITE_NAME, SITE_TITLE, SITE_URL, THEME_COLORS } from "@/lib/site";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

const pressStart2P = Press_Start_2P({
  variable: "--font-retro",
  weight: "400",
  subsets: ["latin"],
});

const google = process.env.GOOGLE_SITE_VERIFICATION;
const bing = process.env.BING_SITE_VERIFICATION;

export const metadata: Metadata = {
  metadataBase: SITE_URL,
  title: { default: SITE_TITLE, template: "%s · Verifica" },
  description: SITE_DESCRIPTION,
  applicationName: SITE_NAME,
  openGraph: {
    type: "website",
    siteName: SITE_NAME,
    title: SITE_TITLE,
    description: SITE_DESCRIPTION,
    url: "/",
    locale: OG_LOCALE,
  },
  twitter: { card: "summary_large_image", title: SITE_TITLE, description: SITE_DESCRIPTION },
  verification: {
    ...(google && { google }),
    ...(bing && { other: { "msvalidate.01": bing } }),
  },
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: THEME_COLORS.light },
    { media: "(prefers-color-scheme: dark)", color: THEME_COLORS.dark },
  ],
};

const webApplication = {
  "@context": "https://schema.org",
  "@type": "WebApplication",
  name: SITE_NAME,
  url: SITE_URL.href,
  description: SITE_DESCRIPTION,
  inLanguage: "pt-BR",
  applicationCategory: "UtilitiesApplication",
  operatingSystem: "Any",
  isAccessibleForFree: true,
  offers: { "@type": "Offer", price: "0", priceCurrency: "BRL" },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="pt-BR"
      data-theme="dark"
      suppressHydrationWarning
      className={`${geistSans.variable} ${geistMono.variable} ${pressStart2P.variable} h-full antialiased`}
    >
      <head>
        <Script
          id="theme-initializer"
          strategy="beforeInteractive"
          dangerouslySetInnerHTML={{
            __html: `(function(){try{var t=localStorage.getItem('verifica-theme')||'auto';var d=t;if(t==='auto')d=matchMedia('(prefers-color-scheme:dark)').matches?'dark':'light';if(t==='pacman')d='night';document.documentElement.setAttribute('data-theme',d)}catch(e){}})()`,
          }}
        />
        <script
          type="application/ld+json"
          // Escaped so a "<" in the copy can never close the script element.
          dangerouslySetInnerHTML={{ __html: JSON.stringify(webApplication).replace(/</g, "\\u003c") }}
        />
      </head>
      <body className="min-h-full flex flex-col">
        <AppShell retroFontClass={pressStart2P.variable}>{children}</AppShell>
      </body>
    </html>
  );
}
