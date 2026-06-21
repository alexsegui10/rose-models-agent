import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

/**
 * Candado de contraseña (Basic Auth) para TODA la web — protege el CRM, los datos de candidatas y, sobre
 * todo, el disparador de llamada (acción con coste). Es OPT-IN: si no hay `SITE_PASSWORD` en el entorno,
 * no protege nada (no cambia el comportamiento). Cuando se pone, el navegador pide usuario/contraseña una
 * vez. NO protege los endpoints llamados por MÁQUINAS (ElevenLabs/Meta), que tienen su propia auth bearer.
 */

// Endpoints de máquina (no navegador): tienen su propio bearer y deben quedar fuera del Basic Auth.
const MACHINE_PATHS = ["/api/call/llm", "/api/call/end", "/api/instagram/webhook", "/api/whatsapp/webhook"];

export function middleware(request: NextRequest): NextResponse {
  const password = process.env.SITE_PASSWORD;
  if (!password) {
    return NextResponse.next(); // opt-in: sin SITE_PASSWORD configurado, la web queda abierta como hasta ahora
  }

  const { pathname } = request.nextUrl;
  if (MACHINE_PATHS.some((path) => pathname.startsWith(path))) {
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
