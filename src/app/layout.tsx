import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import { Bodoni_Moda, Jost } from "next/font/google";
import "./globals.css";

// Identidad del rediseño (jul-2026): Bodoni Moda (serif editorial) para títulos/números/cifras + Jost (sans)
// para el resto. Cargadas por next/font (self-hosted, sin <link> a Google Fonts en runtime). Exponen sus
// variables CSS (--font-bodoni / --font-jost) que globals.css usa en body y títulos.
const bodoni = Bodoni_Moda({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  style: ["normal", "italic"],
  variable: "--font-bodoni",
  display: "swap"
});
const jost = Jost({
  subsets: ["latin"],
  weight: ["300", "400", "500", "600"],
  variable: "--font-jost",
  display: "swap"
});

export const metadata: Metadata = {
  title: "Rose Models Agent",
  description: "CRM y bot de captación de Rose Models",
  applicationName: "Rose Models",
  // Manifiesto PWA (lo genera src/app/manifest.ts) -> instalable en el movil.
  manifest: "/manifest.webmanifest",
  // iOS: al "Añadir a pantalla de inicio" se abre a PANTALLA COMPLETA (sin barras de Safari), con este
  // titulo bajo el icono y la barra de estado translucida sobre el fondo oscuro de la app.
  appleWebApp: {
    capable: true,
    title: "Rose Models",
    statusBarStyle: "black-translucent"
  }
};

// El color de la barra/tema y el ajuste al notch (viewport-fit cover) para que se vea como una app nativa.
export const viewport: Viewport = {
  themeColor: "#150d12",
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover"
};

export default function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="es" className={`${bodoni.variable} ${jost.variable}`}>
      <body>{children}</body>
    </html>
  );
}
