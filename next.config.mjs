/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {},
  // Cabeceras de seguridad HTTP para TODA la web (jul-2026). Especialmente relevante desde que se quitó el
  // candado de contraseña: el CRM sirve datos personales y grabaciones. Estas cabeceras no afectan a los
  // webhooks (Meta/ElevenLabs los llaman como maquina, sin navegador), solo endurecen el navegador:
  //  - nosniff: el navegador no "adivina" tipos MIME (evita ejecutar recursos como script por error).
  //  - frame-ancestors 'none' + DENY: nadie puede incrustar el CRM en un iframe (anti-clickjacking).
  //  - Referrer-Policy: no filtrar la URL del CRM (con IGSIDs) a terceros al salir.
  //  - Permissions-Policy: apagar APIs del navegador que el CRM no usa (camara/micro/geo).
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Content-Security-Policy", value: "frame-ancestors 'none'" },
          { key: "Referrer-Policy", value: "no-referrer" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" }
        ]
      }
    ];
  }
};

export default nextConfig;

