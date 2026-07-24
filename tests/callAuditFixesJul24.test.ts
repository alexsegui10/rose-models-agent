import { describe, expect, it } from "vitest";
import { validateCallUtterance } from "@/application/callRedactionValidator";
import { classifyCallSignal } from "@/application/callSignalClassifier";
import { decideCallDirective, initialCallDirectorState } from "@/application/callDirector";
import { respondToCall, type CallChatMessage } from "@/application/callTurnResponder";
import type { CallUnderstander } from "@/application/callUnderstander";

// Auditoría post-deploy 24-jul: B1 (BLOQUEANTE) + R1/R2/R3/R4, con las sondas EXACTAS del auditor como tests.

const MONEY_OPTS = { allowAuthorizedShare: true, authorizedShareFigures: [30, 70] as const };

describe("B1: el turno de dinero solo admite la oferta VIGENTE (jamás conceder de palabra)", () => {
  const SONDAS_AUDITOR = [
    "Bueno, mira, hacemos un 65/35 y cerramos, ¿te parece?",
    "Va, lo dejamos en 65 para nosotros y 35 para ti, ¿trato?",
    "Mira, te hago la última: 60 para la agencia y 40 para ti.",
    "Puedo dejarlo en sesenta y cinco por ciento para nosotros y treinta y cinco para ti.",
    "Venga, te quedas con el 35 en vez del 30 y lo firmamos ya."
  ];
  for (const t of SONDAS_AUDITOR) {
    it(`inválida (concesión no decidida): "${t.slice(0, 50)}..."`, () => {
      expect(validateCallUtterance(t, undefined, MONEY_OPTS).valid).toBe(false);
    });
  }
  it("la oferta vigente (30/70, dígitos o letra) SIGUE pasando", () => {
    expect(validateCallUtterance("El reparto es un 30% para ti y un 70% para la agencia.", undefined, MONEY_OPTS).valid).toBe(true);
    expect(
      validateCallUtterance("Ese setenta no me lo quedo yo: paga las cuentas y al equipo; tú pones el contenido.", undefined, MONEY_OPTS).valid
    ).toBe(true);
  });
  it("en el escalón 35/65 (CONCEDE dicho por código) las cifras válidas son las suyas", () => {
    const opts = { allowAuthorizedShare: true, authorizedShareFigures: [35, 65] as const };
    expect(validateCallUtterance("Lo dejamos en un 35% para ti y un 65% para nosotros.", undefined, opts).valid).toBe(true);
    expect(validateCallUtterance("Sigue siendo un 30% para ti y un 70% para la agencia.", undefined, opts).valid).toBe(false);
  });
});

describe("R1: concesión blanda parafraseada también cae", () => {
  for (const t of [
    "seguro que encontramos un punto medio que te encaje",
    "eso se puede negociar más adelante",
    "hay margen para hablarlo",
    "más adelante lo revisamos y te dejo mejor porcentaje"
  ]) {
    it(`inválida: "${t}"`, () => {
      expect(validateCallUtterance(t, undefined, { allowAuthorizedShare: true }).valid).toBe(false);
    });
  }
});

describe("R2: pedir MÁS INFO/DETALLE/CONTENIDO no es regateo (no regala escalón)", () => {
  for (const u of [
    "porfa algo más de info del contrato",
    "porfa algo más de detalle de cómo cobro",
    "puedo mandar aunque sea un poquito más de fotos",
    "aunque sea un toque más de contenido te mando"
  ]) {
    it(`NO es queja del reparto: "${u}"`, () => {
      expect(classifyCallSignal({ utterance: u, moneyContext: true })).not.toBe("complains-about-share");
    });
  }
});

describe("R3: el rescate IA de distrust/acknowledge vuelve a estar VIVO", () => {
  const opened: CallChatMessage[] = [
    { role: "system", content: "p" },
    { role: "assistant", content: "Hola, soy Alex de Rose Models, ¿te pillo bien?" }
  ];
  const UNKNOWN_Q = "oye y eso del rollo ese que dicen por ahí qué onda";
  it("asks-unknown + IA entiende DESCONFIANZA -> REASSURE (ya no muere en defer)", async () => {
    const understander: CallUnderstander = { understand: async () => "distrust" };
    const res = await respondToCall({ messages: [...opened, { role: "user", content: UNKNOWN_Q }], understander });
    expect(res.directiveType).toBe("REASSURE");
  });
});

describe("R4: señal refinada por IA SIN memoria no muta la racha de calma", () => {
  const base = { ...initialCallDirectorState(), disclosureGiven: true };
  it("distrust refinado sin memoria: REASSURE sin incrementar calmStreak", () => {
    const d = decideCallDirective({ state: base, signal: "distrust", refinedWithoutMemory: true });
    expect(d.directive.type).toBe("REASSURE");
    expect(d.nextState.calmStreak).toBe(0); // no muta: el replay sin memoria no lo reproduciría
  });
  it("con memoria (flag false) sí muta y el tope de calma funciona", () => {
    const d = decideCallDirective({ state: base, signal: "distrust" });
    expect(d.nextState.calmStreak).toBe(1);
  });
});
