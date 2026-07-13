import { ImageResponse } from "next/og";

// Icono de iOS (apple-touch-icon 180x180): el que aparece en la pantalla de inicio del iPhone al
// "Añadir a pantalla de inicio". Misma "R" rosa sobre el fondo oscuro de la marca.
export const size = { width: 180, height: 180 };
export const contentType = "image/png";

export default function AppleIcon() {
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
          width: 140,
          height: 140,
          borderRadius: "50%",
          border: "3px solid rgba(230,140,160,0.30)"
        }}
      >
        <div style={{ display: "flex", fontSize: 106, fontWeight: 700, color: "#e68ca0", lineHeight: 1, marginTop: -3 }}>R</div>
      </div>
    </div>,
    { ...size }
  );
}
