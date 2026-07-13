import type { Metadata } from "next";
import type { ReactNode } from "react";
import { Bodoni_Moda, Jost } from "next/font/google";
import "./globals.css";

// Identidad del rediseño (jul-2026): Bodoni Moda (serif editorial) para títulos/números/cifras + Jost (sans)
// para el resto. Cargadas por next/font (self-hosted, sin <link> a Google Fonts en runtime). Exponen sus
// variables CSS (--font-bodoni / --font-jost) que globals.css usa en body y títulos.
const bodoni = Bodoni_Moda({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700", "800"],
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
  description: "Simulador local del agente conversacional de Rose Models"
};

export default function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="es" className={`${bodoni.variable} ${jost.variable}`}>
      <body>{children}</body>
    </html>
  );
}
