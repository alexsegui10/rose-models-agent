import { describe, it, expect } from "vitest";
import { sameOriginAllowed } from "@/application/sameOrigin";

// GUARDIA MISMO ORIGEN (jul-2026): tras quitar el candado global de contraseña, los endpoints de disparar
// llamada de pago y borrar candidata quedan solo tras esta guardia. Debe: aceptar la propia web, bloquear
// cross-site de navegador, y no romper peticiones sin Origin (no son el vector de abuso cross-site).

describe("sameOriginAllowed", () => {
  it("acepta cuando Origin y Host son el mismo dominio (la propia web)", () => {
    expect(sameOriginAllowed("https://rose.vercel.app", "rose.vercel.app")).toBe(true);
    expect(sameOriginAllowed("http://localhost:3000", "localhost:3000")).toBe(true);
  });

  it("bloquea cuando Origin es OTRO dominio (fetch cross-site de un tercero)", () => {
    expect(sameOriginAllowed("https://atacante.com", "rose.vercel.app")).toBe(false);
    expect(sameOriginAllowed("https://rose.vercel.app.evil.com", "rose.vercel.app")).toBe(false);
  });

  it("deja pasar cuando NO hay Origin (curl/no-navegador: no es el vector cross-site)", () => {
    expect(sameOriginAllowed(null, "rose.vercel.app")).toBe(true);
  });

  it("deniega si hay Origin pero no Host (no se puede comparar)", () => {
    expect(sameOriginAllowed("https://rose.vercel.app", null)).toBe(false);
  });

  it("deniega un Origin malformado", () => {
    expect(sameOriginAllowed("no-es-una-url", "rose.vercel.app")).toBe(false);
  });
});
