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
  it("apertura: determinista, declara IA, y fallback = mismo texto", () => {
    const plan = planCallUtterance({ directive: { type: "GIVE_DISCLOSURE" }, candidateName: "Lucía" });
    expect(plan.deterministicText?.toLowerCase()).toContain("automatizado");
    expect(plan.deterministicText).toContain("Lucía");
    expect(plan.fallbackText).toBe(plan.deterministicText);
  });

  it("deferir / handoff / cierre son deterministas y dicen lo correcto", () => {
    expect(planCallUtterance({ directive: { type: "DEFER_TO_PARTNER" } }).deterministicText).toContain("socio");
    expect(planCallUtterance({ directive: { type: "HANDOFF_TO_ALEX" } }).deterministicText).toContain("Alex");
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

  it("cubrir MONEY: referencia Instagram y el fallback lleva la cifra 70/30", () => {
    const directive: CallDirective = { type: "COVER_STAGE", stageId: "MONEY", shareOffer: offer(70, false) };
    const plan = planCallUtterance({ directive });
    expect(plan.draftingBrief?.referenceInstagram).toBe(true);
    expect(plan.fallbackText).toContain("Instagram");
    expect(plan.fallbackText).toContain("70");
    expect(plan.fallbackText).toContain("30");
  });

  it("cubrir etapa con conocimiento: el brief y el fallback se apoyan en los puntos aprobados", () => {
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
    expect(plan.draftingBrief?.groundingFacts).toContain("Nosotros llevamos toda la gestión y la monetización.");
    expect(plan.draftingBrief?.prohibitedClaims).toContain("No prometemos ingresos concretos.");
    expect(plan.draftingBrief?.mandatoryNuances).toContain("El volumen de contenido es orientativo, no contractual.");
    expect(plan.fallbackText).toContain("gestión");
  });

  it("cubrir etapa de guion sin conocimiento (RAPPORT): fallback con pegamento conversacional", () => {
    const plan = planCallUtterance({ directive: { type: "COVER_STAGE", stageId: "RAPPORT" } });
    expect(plan.fallbackText.length).toBeGreaterThan(0);
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
    expect(close.deterministicText?.toLowerCase()).toMatch(/perfecto|entiendo/);
    const handoff = planCallUtterance({ directive: { type: "HANDOFF_TO_ALEX", handoffReason: "asked-for-human" } });
    expect(handoff.deterministicText?.toLowerCase()).toContain("te entiendo");
    const money = planCallUtterance({ directive: { type: "COVER_STAGE", stageId: "MONEY", shareOffer: offer(70, false) } });
    expect(money.fallbackText).toContain("70%");
    expect(money.fallbackText.toLowerCase()).not.toContain("salario");
  });

  it("invariante 6: TODA directiva produce un fallback no vacío (el bot nunca se queda mudo)", () => {
    const directives: CallDirective[] = [
      { type: "GIVE_DISCLOSURE" },
      { type: "COVER_STAGE", stageId: "FRAME" },
      { type: "COVER_STAGE", stageId: "MONEY", shareOffer: offer(70, false) },
      { type: "ANSWER_FROM_KNOWLEDGE" },
      { type: "DEFER_TO_PARTNER" },
      { type: "CONCEDE_SHARE", shareOffer: offer(65, false) },
      { type: "REASSURE" },
      { type: "HANDOFF_TO_ALEX", handoffReason: "asked-for-human" },
      { type: "CLOSE_WITH_CONTRACT" }
    ];
    for (const directive of directives) {
      const plan = planCallUtterance({ directive });
      expect(plan.fallbackText.trim().length, `directiva ${directive.type} sin fallback`).toBeGreaterThan(0);
    }
  });
});
