import { Geist, Geist_Mono, Press_Start_2P } from "next/font/google";
import Script from "next/script";
import AppShell from "@/components/AppShell";
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
        <title>Verifica - Detector Inteligente de Fake News</title>
        <meta name="description" content="Verifique a confiabilidade de textos e notícias com inteligência artificial." />
        <Script
          id="theme-initializer"
          strategy="beforeInteractive"
          dangerouslySetInnerHTML={{
            __html: `(function(){try{var t=localStorage.getItem('verifica-theme')||'auto';var d=t;if(t==='auto')d=matchMedia('(prefers-color-scheme:dark)').matches?'dark':'light';if(t==='pacman')d='night';document.documentElement.setAttribute('data-theme',d)}catch(e){}})()`,
          }}
        />
      </head>
      <body className="min-h-full flex flex-col">
        <AppShell retroFontClass={pressStart2P.variable}>{children}</AppShell>
      </body>
    </html>
  );
}
