import { ImageResponse } from "next/og";

// Icono de la app (favicon + manifiesto PWA): monograma "R" rosa sobre el fondo oscuro de la marca.
// Lo genera Next.js con ImageResponse (sin ficheros PNG que mantener).
export const size = { width: 512, height: 512 };
export const contentType = "image/png";

export default function Icon() {
  return new ImageResponse(
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "radial-gradient(circle at 32% 26%, #2a1a24, #150d12 70%)"
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          width: 396,
          height: 396,
          borderRadius: "50%",
          border: "6px solid rgba(230,140,160,0.30)"
        }}
      >
        <div style={{ display: "flex", fontSize: 300, fontWeight: 700, color: "#e68ca0", lineHeight: 1, marginTop: -8 }}>R</div>
      </div>
    </div>,
    { ...size }
  );
}
