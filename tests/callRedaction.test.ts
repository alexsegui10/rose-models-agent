import { describe, expect, it } from "vitest";
import type { KnowledgeEntry } from "@/domain/businessKnowledge";
import { planCallUtterance } from "@/application/callRedaction";
import type { CallDirective } from "@/application/callDirector";

function entry(partial: Partial<KnowledgeEntry>): KnowledgeEntry {
  return {
    id: "test-entry",
    category: "SERVICES",
    title: "Test",
    facts: [],
    approvedAnswerPoints: [],
    prohibitedClaims: [],
    mandatoryNuances: [],
    escalationConditions: [],
    allowedStates: [],
    tags: [],
    requiresHumanReview: false,
    version: "1",
    status: "ACTIVE",
    approvedByAlex: true,
    updatedAt: "2026-06-17",
    ...partial
  };
}

const offer = (modelShare: number, isFloor: boolean) => ({
  modelShare,
  agencyShare: 100 - modelShare,
  step: 0 as const,
  isFloor
});

describe("planificador de redacción de la llamada", () => {
  it("apertura: determinista, saluda como Alex, y fallback = mismo texto", () => {
    const plan = planCallUtterance({ directive: { type: "GIVE_DISCLOSURE" }, candidateName: "Lucía" });
    expect(plan.deterministicText?.toLowerCase()).toContain("rose models");
    expect(plan.deterministicText).toContain("Lucía");
    expect(plan.fallbackText).toBe(plan.deterministicText);
  });

  // jul-2026: DEFER pasa a redacción natural (brief + fallback determinista) para que el "eso te lo
  // confirmo" se adapte a LO QUE preguntó (deferir "¿cuántos años tienes?" a "mi socio" quedaba absurdo).
  // La DECISIÓN de deferir sigue siendo del director; sin redactor, habla el texto fijo de siempre.
  it("deferir: brief natural (no responder, no inventar) con fallback determinista del socio", () => {
    const plan = planCallUtterance({ directive: { type: "DEFER_TO_PARTNER" }, utterance: "¿y los impuestos?" });
    expect(plan.deterministicText).toBeUndefined();
    expect(plan.fallbackText).toContain("socio");
    expect(plan.draftingBrief?.instruction.toLowerCase()).toContain("no respondas");
    expect(plan.draftingBrief?.candidateUtterance).toBe("¿y los impuestos?");
  });

  it("cierre con contrato es determinista; handoff lo redacta el modelo con fallback que remite al socio", () => {
    const handoff = planCallUtterance({ directive: { type: "HANDOFF_TO_ALEX" } });
    expect(handoff.draftingBrief).toBeDefined(); // handoff ahora se redacta (adapta el tono al motivo)
    expect(handoff.fallbackText).toContain("mi socio"); // el fallback sigue remitiendo al socio
    expect(planCallUtterance({ directive: { type: "CLOSE_WITH_CONTRACT" } }).deterministicText).toContain("contrato");
  });

  it("conceder reparto: usa la cifra exacta de la oferta (determinista)", () => {
    const mid = planCallUtterance({ directive: { type: "CONCEDE_SHARE", shareOffer: offer(65, false) } });
    expect(mid.deterministicText).toContain("65");
    expect(mid.deterministicText).toContain("35");

    const floor = planCallUtterance({ directive: { type: "CONCEDE_SHARE", shareOffer: offer(60, true) } });
    expect(floor.deterministicText).toContain("60");
    expect(floor.deterministicText?.toLowerCase()).toContain("no podemos bajar");
  });

  it("conceder sin oferta (no debería pasar): defiere en vez de inventar cifra", () => {
    const plan = planCallUtterance({ directive: { type: "CONCEDE_SHARE" } });
    expect(plan.deterministicText).toContain("socio");
  });

  it("cubrir MONEY: NO referencia Instagram (se presenta fresco), lleva la cifra 70/30 e invita a responder", () => {
    const directive: CallDirective = { type: "COVER_STAGE", stageId: "MONEY", shareOffer: offer(70, false) };
    const plan = planCallUtterance({ directive });
    // Fix Alex jun-2026: el % no se da por dicho en el DM; se presenta fresco.
    expect(plan.draftingBrief?.referenceInstagram).toBe(false);
    expect(plan.fallbackText).not.toContain("Instagram");
    expect(plan.fallbackText).toContain("70");
    expect(plan.fallbackText).toContain("30");
    expect(plan.fallbackText.trim().endsWith("?")).toBe(true);
  });

  it("cubrir etapa con conocimiento: el brief lleva los puntos aprobados (para el LLM); el fallback es el guion propio", () => {
    const knowledge = [
      entry({
        id: "services-agency-management",
        approvedAnswerPoints: ["Nosotros llevamos toda la gestión y la monetización."],
        prohibitedClaims: ["No prometemos ingresos concretos."],
        mandatoryNuances: ["El volumen de contenido es orientativo, no contractual."]
      })
    ];
    const plan = planCallUtterance({
      directive: { type: "COVER_STAGE", stageId: "HOW_AGENCY_WORKS" },
      knowledge
    });
    // El brief (para el LLM) se apoya en los hechos aprobados + restricciones.
    expect(plan.draftingBrief?.groundingFacts).toContain("Nosotros llevamos toda la gestión y la monetización.");
    expect(plan.draftingBrief?.prohibitedClaims).toContain("No prometemos ingresos concretos.");
    expect(plan.draftingBrief?.mandatoryNuances).toContain("El volumen de contenido es orientativo, no contractual.");
    // El fallback determinista es el guion propio de la llamada (la voz de Alex), conversacional.
    expect(plan.fallbackText.toLowerCase()).toContain("cuentas de instagram españolas");
    expect(plan.fallbackText.trim().endsWith("?")).toBe(true);
  });

  it("cubrir una etapa devuelve el guion propio de la llamada (no vacío) + brief presente", () => {
    const plan = planCallUtterance({ directive: { type: "COVER_STAGE", stageId: "HER_RESPONSIBILITIES" } });
    expect(plan.fallbackText.toLowerCase()).toContain("tu parte");
    expect(plan.draftingBrief).toBeDefined();
  });

  it("responder del conocimiento: instrucción de responder + fallback con el punto", () => {
    const knowledge = [entry({ approvedAnswerPoints: ["El primer pago suele llegar en pocas semanas."] })];
    const plan = planCallUtterance({ directive: { type: "ANSWER_FROM_KNOWLEDGE" }, knowledge });
    expect(plan.draftingBrief?.instruction.toLowerCase()).toContain("responde");
    expect(plan.fallbackText).toContain("primer pago");
  });

  it("responder sin conocimiento: defiere (no improvisa)", () => {
    const plan = planCallUtterance({ directive: { type: "ANSWER_FROM_KNOWLEDGE" } });
    expect(plan.fallbackText).toContain("socio");
  });

  it("tranquilizar: fallback de empatía + brief presente", () => {
    const plan = planCallUtterance({ directive: { type: "REASSURE" } });
    expect(plan.fallbackText.toLowerCase()).toContain("dudas");
    expect(plan.draftingBrief).toBeDefined();
  });

  it("regresión auditoría: cifras con '%', acuse de recibo cálido, MONEY sin punto contradictorio", () => {
    const concede = planCallUtterance({ directive: { type: "CONCEDE_SHARE", shareOffer: offer(65, false) } });
    expect(concede.deterministicText).toContain("65%");
    const close = planCallUtterance({ directive: { type: "CLOSE_WITH_CONTRACT" } });
    expect(close.deterministicText?.toLowerCase()).toContain("contrato");
    const handoff = planCallUtterance({ directive: { type: "HANDOFF_TO_ALEX", handoffReason: "asked-for-human" } });
    expect(handoff.fallbackText.toLowerCase()).toContain("te entiendo"); // el fallback determinista sigue igual
    const money = planCallUtterance({ directive: { type: "COVER_STAGE", stageId: "MONEY", shareOffer: offer(70, false) } });
    expect(money.fallbackText).toContain("70%");
    expect(money.fallbackText.toLowerCase()).not.toContain("salario");
  });

  it("invariante 6: TODA directiva produce un fallback no vacío (el bot nunca se queda mudo)", () => {
    const directives: CallDirective[] = [
      { type: "GIVE_DISCLOSURE" },
      { type: "COVER_STAGE", stageId: "HOW_AGENCY_WORKS" },
      { type: "COVER_STAGE", stageId: "MONEY", shareOffer: offer(70, false) },
      { type: "ANSWER_FROM_KNOWLEDGE" },
      { type: "DEFER_TO_PARTNER" },
      { type: "CONCEDE_SHARE", shareOffer: offer(65, false) },
      { type: "REASSURE" },
      { type: "DEFEND_SHARE" },
      { type: "ASK_REPEAT" },
      { type: "HANDOFF_TO_ALEX", handoffReason: "asked-for-human" },
      { type: "CLOSE_WITH_CONTRACT" },
      { type: "CLOSE_SOFT" }
    ];
    for (const directive of directives) {
      const plan = planCallUtterance({ directive });
      expect(plan.fallbackText.trim().length, `directiva ${directive.type} sin fallback`).toBeGreaterThan(0);
    }
  });

  it("nuevas directivas (auditoría): textos correctos", () => {
    expect(planCallUtterance({ directive: { type: "CLOSE_SOFT" } }).deterministicText?.toLowerCase()).toContain("te animas");
    expect(planCallUtterance({ directive: { type: "ASK_REPEAT" } }).deterministicText?.toLowerCase()).toContain("repetir");
    const defend = planCallUtterance({ directive: { type: "DEFEND_SHARE" } });
    // FASE 3 (23-jul): DEFEND lo redacta luna (brief con los argumentos de Alex); el FALLBACK determinista
    // conserva las protecciones históricas: nombra el 70/setenta de la agencia y JAMÁS "para ti" (inversión).
    expect(defend.draftingBrief).toBeDefined();
    expect(defend.draftingBrief?.prohibitedClaims.join(" ").toLowerCase()).toContain("otra cifra");
    expect(defend.fallbackText.toLowerCase()).toMatch(/70|setenta/);
    expect(defend.fallbackText.toLowerCase()).not.toContain("para ti");
  });

  it("el contexto de la candidata personaliza (nombre en la apertura) y llega al brief para el LLM", () => {
    const context = { candidateName: "Marta", concerns: ["desconfianza"], dmSummary: "habló del reparto por Instagram" };
    const disclosure = planCallUtterance({ directive: { type: "GIVE_DISCLOSURE" }, context });
    expect(disclosure.deterministicText).toContain("Marta");
    const cover = planCallUtterance({ directive: { type: "COVER_STAGE", stageId: "HOW_AGENCY_WORKS" }, context });
    expect(cover.draftingBrief?.context?.candidateName).toBe("Marta");
    expect(cover.draftingBrief?.context?.concerns).toContain("desconfianza");
  });
});
