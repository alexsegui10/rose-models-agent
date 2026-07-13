import type { MetadataRoute } from "next";

/**
 * Manifiesto PWA: hace la web INSTALABLE como app (icono en la pantalla de inicio + pantalla completa).
 * Next.js lo sirve en /manifest.webmanifest y lo enlaza solo. Los iconos los generan src/app/icon.tsx y
 * src/app/apple-icon.tsx (la "R" rosa sobre el fondo oscuro de la marca), sin ficheros PNG que mantener.
 * Colores = paleta de la maqueta (fondo #150D12). No toca nada del bot ni del backend.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Rose Models Agent",
    short_name: "Rose Models",
    description: "CRM y bot de captación de Rose Models",
    start_url: "/",
    display: "standalone",
    orientation: "portrait",
    background_color: "#150d12",
    theme_color: "#150d12",
    icons: [
      { src: "/icon", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/apple-icon", sizes: "180x180", type: "image/png", purpose: "any" }
    ]
  };
}
