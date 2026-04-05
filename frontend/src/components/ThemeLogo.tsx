import Image from "next/image";

interface ThemeLogoProps {
  type?: "logo" | "logotipo";
  className?: string;
  width?: number;
  height?: number;
}

export default function ThemeLogo({ type = "logo", className = "", width = 120, height = 40 }: ThemeLogoProps) {
  // Configured to match the available DaisyUI generated themes: light, dark, dim, night (pacman)
  const isLogo = type === "logo";

  const files = {
    light: isLogo ? "/logos/light/Logo2_Light.png" : "/logos/light/Logotipo2_Light.png",
    dark: isLogo ? "/logos/dark/Logo2_Dark.png" : "/logos/dark/Logotipo2_Dark.png",
    dim: isLogo ? "/logos/dim/Logo1_Dim.png" : "/logos/dim/Logotipo1_Dim.png",
    night: isLogo ? "/logos/retro/Logo2_Retro.png" : "/logos/retro/Logotipo1_Retro.png",
  };

  return (
    <div className={`relative flex items-center justify-center ${className}`}>
      {/* Light Theme */}
      <Image
        src={files.light}
        alt="Verifica"
        width={width}
        height={height}
        className="hidden in-data-[theme=light]:block object-contain w-full h-auto"
        priority
      />
      {/* Dark Theme */}
      <Image
        src={files.dark}
        alt="Verifica"
        width={width}
        height={height}
        className="hidden in-data-[theme=dark]:block object-contain w-full h-auto"
        priority
      />
      {/* Dim Theme */}
      <Image
        src={files.dim}
        alt="Verifica"
        width={width}
        height={height}
        className="hidden in-data-[theme=dim]:block object-contain w-full h-auto"
        priority
      />
      {/* Night Theme (Pac-Man) */}
      <Image
        src={files.night}
        alt="Verifica"
        width={width}
        height={height}
        className="hidden in-data-[theme=night]:block object-contain w-full h-auto"
        priority
      />
    </div>
  );
}
