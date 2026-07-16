import { describe, expect, it } from "vitest";
import { planCallUtterance } from "@/application/callRedaction";
import { validateCallUtterance } from "@/application/callRedactionValidator";
import { businessKnowledgeEntries } from "@/content/business";
import type { KnowledgeEntry } from "@/domain/businessKnowledge";

// Barrido de voz 16-jul (nº2): el conocimiento de negocio está redactado para el FUNNEL/texto y habla del
// bot en 3ª persona ("El chatbot recopila datos...") y de Alex como un tercero ("el resumen queda para
// Alex"). En la LLAMADA el bot ES Alex, así que eso suena a robot y delata la IA.
// DECISIÓN DE ALEX (16-jul): arreglarlo SOLO en la voz, en 1ª persona, SIN tocar el contenido compartido
// con el bot de texto ni sus políticas confirmadas (confirmedAlexPolicies sigue intacto).

const byId = (id: string): KnowledgeEntry => {
  const entry = businessKnowledgeEntries.find((e) => e.id === id);
  if (!entry) throw new Error(`No existe la entrada de conocimiento ${id}`);
  return entry;
};

const allText = (facts: string[] | undefined, fallback: string): string => `${(facts ?? []).join(" ")} ${fallback}`;

describe("nº2: en la LLAMADA el bot habla en 1ª persona, no como un chatbot (barrido voz 16-jul)", () => {
  it("GUARD de deriva: las frases del contenido que se reescriben siguen existiendo tal cual", () => {
    // Si Alex/alguien edita estas frases, la reescritura de voz dejaría de casar y la fuga volvería EN
    // SILENCIO. Este test hace que ese cambio falle RUIDOSAMENTE para volver a mapearlas.
    expect(byId("candidate-requirements-target-profile").mandatoryNuances).toContain(
      "El chatbot recopila datos y pasa el perfil a revision humana."
    );
    expect(byId("candidate-requirements-target-profile").approvedAnswerPoints).toContain(
      "La revision final del perfil la hace Alex."
    );
    expect(byId("call-post-summary").approvedAnswerPoints).toContain(
      "Despues de la llamada, el resumen queda para Alex y el proceso pasa a revision manual."
    );
    expect(byId("call-post-summary").mandatoryNuances).toContain(
      "Despues de la llamada el chatbot deja el proceso en manos de Alex."
    );
    expect(byId("escalation-immediate-human-intervention").approvedAnswerPoints).toContain(
      "Lo revisa Alex personalmente y te damos una respuesta con calma."
    );
    expect(byId("escalation-immediate-human-intervention").mandatoryNuances).toContain("Alex puede detener el bot.");
    expect(byId("content-production-volume").mandatoryNuances).toContain("Alex organiza los detalles despues de la llamada.");
  });

  // GUARD DEL PATRÓN (no solo de las entradas conocidas): NINGUNA entrada ACTIVE que la voz pueda recuperar
  // debe vocear el tell de bot/3ª persona, ni traer un matiz obligatorio que la propia red del validador
  // vete (eso garantizaría el fallback en ese turno — la trampa que cazó el revisor 16-jul).
  it("PATRÓN: ninguna entrada ACTIVE alcanzable en voz filtra 'el bot'/'chatbot'/'revisión humana' ni se auto-vetea", () => {
    const blocklisted = new Set(["call-details-after-review", "call-post-summary"]); // no se recuperan en llamada
    for (const entry of businessKnowledgeEntries) {
      if (entry.status !== "ACTIVE" || !entry.approvedByAlex || blocklisted.has(entry.id)) continue;
      const plan = planCallUtterance({ directive: { type: "ANSWER_FROM_KNOWLEDGE" }, knowledge: [entry] });
      const voiced = `${(plan.draftingBrief?.groundingFacts ?? []).join(" ")} ${plan.fallbackText}`.toLowerCase();
      expect(voiced, `entrada ${entry.id} vocea lenguaje de bot`).not.toMatch(
        /\b(?:el|un|del|al) chatbot\b|\bel bot\b|\brevision (?:humana|manual)\b|\brevisión (?:humana|manual)\b/
      );
      for (const nuance of plan.draftingBrief?.mandatoryNuances ?? []) {
        expect(validateCallUtterance(nuance).valid, `matiz de ${entry.id} vetado por la red: "${nuance}"`).toBe(true);
      }
    }
  });

  // La entrada de escalada es la que se recupera cuando ella SOSPECHA / se enfada / pregunta si habla con un
  // bot: es la que más delata si se vocea en 3ª persona. Además, sin mapearla, el matiz obligatorio "Alex
  // puede detener el bot" chocaba con la red del validador ("el bot") -> el prompt ordenaba decir algo que la
  // red vetaba y SIEMPRE caía al fallback (trampa que cazó el revisor).
  it("la entrada de ESCALADA (sospecha/enfado/'¿eres un bot?') va en 1ª persona y no se auto-vetea", () => {
    const entry = byId("escalation-immediate-human-intervention");
    const plan = planCallUtterance({ directive: { type: "ANSWER_FROM_KNOWLEDGE" }, knowledge: [entry] });
    const nuances = plan.draftingBrief?.mandatoryNuances ?? [];
    const all = `${allText(plan.draftingBrief?.groundingFacts, plan.fallbackText)} ${nuances.join(" ")}`.toLowerCase();
    expect(all).not.toContain("el bot");
    expect(all).not.toContain("revisa alex");
    expect(all).toMatch(/reviso yo|lo paro yo/);
    // El fallback (que NO se valida) también sale limpio, que era la fuga real.
    expect(plan.fallbackText.toLowerCase()).not.toContain("revisa alex");
    // Y ningún matiz obligatorio puede ser algo que la propia red veta (si no, fallback garantizado).
    for (const nuance of nuances) expect(validateCallUtterance(nuance).valid).toBe(true);
  });

  it("el perfil/revisión NO se vocea como 'el chatbot' ni 'revisión humana': va en 1ª persona", () => {
    const plan = planCallUtterance({
      directive: { type: "ANSWER_FROM_KNOWLEDGE" },
      knowledge: [byId("candidate-requirements-target-profile")]
    });
    const text = allText(plan.draftingBrief?.groundingFacts, plan.fallbackText);
    const nuances = (plan.draftingBrief?.mandatoryNuances ?? []).join(" ");
    expect(`${text} ${nuances}`.toLowerCase()).not.toContain("chatbot");
    expect(`${text} ${nuances}`.toLowerCase()).not.toContain("revision humana");
    expect(`${text} ${nuances}`.toLowerCase()).not.toContain("revisión humana");
    // Y sí dice quién revisa, en primera persona (sigue siendo Alex quien revisa: el significado no cambia).
    expect(`${text} ${nuances}`.toLowerCase()).toMatch(/reviso yo|la hago yo/);
  });

  // OJO (revisor 16-jul): hoy `call-post-summary` está en IN_CALL_KNOWLEDGE_BLOCKLIST (callTurnResponder),
  // así que en una llamada REAL no se recupera; aquí se inyecta a mano. El mapeo es defensa a futuro (si
  // algún día sale de la blocklist), no cobertura viva.
  it("el resumen posterior a la llamada NO habla de Alex en tercera persona", () => {
    const plan = planCallUtterance({
      directive: { type: "ANSWER_FROM_KNOWLEDGE" },
      knowledge: [byId("call-post-summary")]
    });
    const text = allText(plan.draftingBrief?.groundingFacts, plan.fallbackText);
    const nuances = (plan.draftingBrief?.mandatoryNuances ?? []).join(" ");
    const all = `${text} ${nuances}`.toLowerCase();
    expect(all).not.toContain("queda para alex");
    expect(all).not.toContain("en manos de alex");
    expect(all).not.toContain("revision manual");
    expect(all).not.toContain("chatbot");
    expect(all).toMatch(/me lo miro|me encargo yo/);
  });

  it("RED del validador: si el modelo lo inventa igual, se descarta (cae al fallback)", () => {
    expect(validateCallUtterance("Mira, el chatbot recoge tus datos y ya te digo.").valid).toBe(false);
    expect(validateCallUtterance("Eso pasa a revisión humana y te contamos.").valid).toBe(false);
    // Un turno normal en 1ª persona sigue siendo válido.
    expect(validateCallUtterance("Te voy preguntando lo básico y luego reviso yo tu perfil con calma.").valid).toBe(true);
  });
});
