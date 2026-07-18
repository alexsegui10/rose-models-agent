import { describe, expect, it } from "vitest";
import { classifyCallSignal } from "@/application/callSignalClassifier";
import { LocalBusinessKnowledgeRetriever } from "@/application/businessKnowledgeRetriever";
import { createCandidate, normalizeCandidate, type Candidate } from "@/domain/candidate";

// RONDA 3 (18-jul). SPEC DE ALEX: el "te lo confirmo por WhatsApp" SOLO vale cuando (a) el bot NO lo sabe y
// (b) es importante — y JAMÁS para algo que el propio bot sacó o que la agenda responde. El barrido completo
// (13 personas) cazó 24 defers y varios eran de cosas que el bot SÍ sabe. Estos tests fijan cada caso real.

const sig = (utterance: string, opts: { lastBotUtterance?: string; isCoveredQuestion?: boolean } = {}) =>
  classifyCallSignal({ utterance, ...opts });

describe("peticiones de SEGUIR no son 'no lo sé' (spec de Alex: defer solo cuando no se sabe)", () => {
  it("'contame / qué sería / cómo arrancamos / qué me pedirían' -> asks-more (la agenda responde avanzando)", () => {
    expect(sig("Sí, dale, contame pero cortito porque estos dos me están volviendo loca, qué sería?")).toBe("asks-more");
    expect(sig("Sí, sí, dale de una, contame, re quiero saber cómo arrancamos.")).toBe("asks-more");
    expect(sig("Y... ponele, pero no sé qué me pedirían hacer, che.")).toBe("asks-more");
  });

  it("pero 'contame' con un tema que tiene ruta PROPIA no se la roba", () => {
    expect(sig("contame otra vez la cifra del reparto")).toBe("asks-share-figure");
    // La cara la sigue tratando su flujo (aquí basta con que NO sea el asks-more del avance a otra etapa).
    expect(sig("contame lo de la cara, que me da cosa")).not.toBe("asks-more");
  });

  it("las variantes nuevas TAMPOCO roban rutas propias (revisor Ronda 3)", () => {
    // "¿cómo empezamos?" + petición de cifra en la MISMA frase: gana la cifra (jamás se evade).
    expect(sig("como empezamos? igual antes decime cuanto se llevan ustedes")).toBe("asks-share-figure");
    expect(sig("¿el porcentaje qué sería?")).toBe("asks-share-figure");
    expect(sig("¿qué sería el reparto?")).toBe("asks-share-figure");
    // Impuestos: sigue yendo a Alex (decisión 16-jul), no al avance de agenda.
    expect(sig("eso de los impuestos, ¿qué sería?", { isCoveredQuestion: true })).toBe("asks-unknown");
    // Y "cuéntame el porcentaje" (peninsular) tampoco se lo come la continuación.
    expect(sig("cuéntame el porcentaje")).toBe("asks-share-figure");
  });

  it("una FECHA no dispara el reparto: 'me toca el 30 de julio, ¿no?' (revisor Ronda 3)", () => {
    expect(sig("la llamada me toca el 30 de julio, no?")).not.toBe("asks-share-figure");
  });
});

describe("eco-confirmación de lo que el bot ACABA de decir -> se confirma, no se defiere (caso real del barrido)", () => {
  const lastBot =
    "Y al pasar esos treinta días empezamos a monetizar en OnlyFans con nuestro equipo de chatters, que lo lleva las veinticuatro horas — tú no tienes que escribirte con nadie.";

  it("'sí, ahí entendí... ustedes arman todo y yo no hablo con nadie, no?' -> asks-clarification", () => {
    expect(sig("Sí, sí, ahí entendí... ustedes arman todo y yo no hablo con nadie, no?", { lastBotUtterance: lastBot })).toBe(
      "asks-clarification"
    );
  });

  it("'o sea yo no tendría que escribirme con nadie, verdad?' -> asks-clarification", () => {
    expect(sig("o sea yo no tendría que escribirme con nadie, verdad?", { lastBotUtterance: lastBot })).toBe(
      "asks-clarification"
    );
  });

  it("una coletilla '¿no?' SIN relación con lo último dicho NO se convierte en aclaración", () => {
    expect(sig("mañana tengo el cumple de mi vieja, no?", { lastBotUtterance: lastBot })).not.toBe("asks-clarification");
  });
});

describe("confirmar la CIFRA no se defiere: el bot la sabe (caso real del barrido)", () => {
  it("'o sea de lo que paguen me queda el 30, ¿no?' -> asks-share-figure (re-dice la cifra vigente)", () => {
    expect(sig("Ah, o sea ustedes llevan gente y de lo que paguen me queda el 30, ¿no?")).toBe("asks-share-figure");
    expect(sig("para mi el 30, verdad?")).toBe("asks-share-figure");
    // Pedir OTRA cifra no es confirmar: sigue siendo queja/negociación (la cazan las quejas antes).
    expect(sig("y si me queda el 50, no?", { isCoveredQuestion: false })).not.toBe("asks-share-figure");
  });
});

describe("'no tengo OnlyFans, ¿eso cómo sería?' tiene respuesta aprobada (no WhatsApp)", () => {
  it("el buscador surfacea la ficha de crear la cuenta", async () => {
    const retriever = new LocalBusinessKnowledgeRetriever();
    const candidate = normalizeCandidate({
      ...createCandidate({ instagramUsername: "r3" }),
      currentState: "APPROVED",
      humanFitDecision: "APPROVED"
    } as unknown as Candidate);
    const entries = await retriever.retrieve({
      candidate,
      intent: "REQUESTS_INFORMATION",
      question: "Sí, contame eso también, porque yo no tengo OnlyFans, ¿eso cómo sería?",
      ignoreStateGating: true
    });
    expect(entries.some((entry) => entry.tags.includes("of-account") || entry.id.includes("of-account"))).toBe(true);
  });

  it("una 'cuenta de banco' NO dispara la ficha de la cuenta de OF (guard preexistente intacto)", async () => {
    const retriever = new LocalBusinessKnowledgeRetriever();
    const candidate = normalizeCandidate({
      ...createCandidate({ instagramUsername: "r3b" }),
      currentState: "APPROVED"
    } as unknown as Candidate);
    const entries = await retriever.retrieve({
      candidate,
      intent: "REQUESTS_INFORMATION",
      question: "no tengo cuenta de banco todavía, ¿eso cómo sería?",
      ignoreStateGating: true
    });
    expect(entries.some((entry) => entry.tags.includes("of-account"))).toBe(false);
  });
});
