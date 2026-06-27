import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

/**
 * Candado de contraseña (Basic Auth) para TODA la web — protege el CRM, los datos de candidatas y, sobre
 * todo, el disparador de llamada (acción con coste). En PRODUCCIÓN es OBLIGATORIO: si falta `SITE_PASSWORD`,
 * las rutas de navegador devuelven 503 (fail-closed) en vez de quedar abiertas. En desarrollo local, sin
 * `SITE_PASSWORD`, la web sigue abierta (sin fricción). Cuando se pone, el navegador pide usuario/contraseña
 * una vez. NO protege los endpoints llamados por MÁQUINAS (ElevenLabs/Meta), que tienen su propia auth bearer.
 */

// Endpoints de máquina (no navegador): tienen su propio bearer y deben quedar fuera del Basic Auth.
const MACHINE_PATHS = [
  "/api/call/llm",
  "/api/call/end",
  "/api/call/dispatch",
  "/api/instagram/webhook",
  "/api/instagram/flush",
  "/api/instagram/detect-privacy",
  "/api/whatsapp/webhook"
];

export function middleware(request: NextRequest): NextResponse {
  const { pathname } = request.nextUrl;
  // Endpoints de MÁQUINA (webhook de Meta, ElevenLabs, cron): tienen su propia auth bearer y NUNCA pasan por
  // el Basic Auth. Van PRIMERO para que un fallo de configuración del candado (abajo) jamás los tumbe.
  if (MACHINE_PATHS.some((path) => pathname.startsWith(path))) {
    return NextResponse.next();
  }

  const password = process.env.SITE_PASSWORD;
  if (!password) {
    // FAIL-CLOSED en producción: un deploy sin SITE_PASSWORD NO debe dejar el CRM abierto a internet (PII de
    // candidatas, descarga de grabaciones, disparo de llamadas con coste, aprobaciones saltándose la revisión
    // humana). Devolvemos 503 para las rutas de navegador. En local (dev) la web sigue abierta (sin fricción).
    if (process.env.NODE_ENV === "production") {
      return new NextResponse("Configuración incompleta del servidor: falta SITE_PASSWORD.", { status: 503 });
    }
    return NextResponse.next();
  }

  const header = request.headers.get("authorization") ?? "";
  if (header.startsWith("Basic ")) {
    try {
      const decoded = atob(header.slice(6)); // "usuario:contraseña"
      const provided = decoded.slice(decoded.indexOf(":") + 1);
      if (provided === password) {
        return NextResponse.next();
      }
    } catch {
      /* cae al 401 */
    }
  }

  return new NextResponse("Autenticación requerida.", {
    status: 401,
    headers: { "WWW-Authenticate": 'Basic realm="Rose Models", charset="UTF-8"' }
  });
}

export const config = {
  // Aplica a todo MENOS a los assets estáticos (rendimiento + no romper imágenes/CSS).
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"]
};
