import path from "node:path";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "export",
  images: { unoptimized: true },
  // Dois lockfiles (raiz e frontend): fixa a raiz para o build não subir de diretório.
  turbopack: { root: path.resolve(__dirname) },
};

export default nextConfig;
