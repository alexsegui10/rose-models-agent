import { describe, expect, it } from "vitest";
import { decideCallDirective, initialCallDirectorState } from "@/application/callDirector";

// Decisión de Alex 20-jul: tras un CIERRE POR RECHAZO DE LA CARA, si ella sigue insistiendo, el bot se
// mantiene FIRME (repite el cierre una vez y luego silencio), NO reconduce (sonaba incoherente: "¿seguimos?"
// después de "no podríamos seguir"). Tras OTRO cierre (contrato/soft) sí reconduce la duda de la cara.

const closedWith = (closeDirective: "CLOSE_FACE_REJECTED" | "CLOSE_WITH_CONTRACT") => ({
  ...initialCallDirectorState(),
  disclosureGiven: true,
  closed: true,
  closeDirective,
  terminalRepeats: 0
});

describe("cierre por rechazo de la cara: FIRME, no reconduce (Alex 20-jul)", () => {
  it("tras CLOSE_FACE_REJECTED, insistir con la cara repite el cierre firme UNA vez y luego silencio", () => {
    const d1 = decideCallDirective({ state: closedWith("CLOSE_FACE_REJECTED"), signal: "face-doubt" });
    expect(d1.directive.type).toBe("CLOSE_FACE_REJECTED"); // firme, NO RECONDUCT_FACE
    expect(d1.nextState.terminalRepeats).toBe(1);
    const d2 = decideCallDirective({ state: d1.nextState, signal: "face-refusal" });
    expect(d2.directive.type).toBe("STAY_SILENT"); // ya se repitió una vez -> silencio
  });

  it("CONTROL: tras un cierre CON CONTRATO, una duda de la cara SÍ se reconduce (sin cambio)", () => {
    const d = decideCallDirective({ state: closedWith("CLOSE_WITH_CONTRACT"), signal: "face-doubt" });
    expect(d.directive.type).toBe("RECONDUCT_FACE");
  });
});
