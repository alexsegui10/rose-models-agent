import { describe, expect, it } from "vitest";
import { classifyCallSignal } from "@/application/callSignalClassifier";
import { decideCallDirective, initialCallDirectorState, type CallDirectorState } from "@/application/callDirector";
import { planCallUtterance } from "@/application/callRedaction";
import { validateCallUtterance } from "@/application/callRedactionValidator";
import { callAgendaStage } from "@/application/callAgenda";
import { respondToCall } from "@/application/callTurnResponder";
import type { CallDraftRequest } from "@/application/callDrafter";
import { ConversationEngine } from "@/application/conversationEngine";
import { DeterministicUnderstandingProvider } from "@/application/dataExtractor";
import { createCandidate, normalizeCandidate, type Candidate } from "@/domain/candidate";
import { InMemoryCandidateRepository } from "@/infrastructure/repositories/inMemoryCandidateRepository";

// PRIMERA LLAMADA REAL (17-jul, Alex haciendo de "Laura"): el circuito sonó a los 5 minutos, pero la
// conversación tuvo errores graves que Alex listó uno a uno. Cada test de aquí es uno de esos errores.

const sig = (utterance: string, opts: { moneyContext?: boolean; isCoveredQuestion?: boolean } = {}) =>
  classifyCallSignal({ utterance, ...opts });

describe("llamada real 17-jul: los errores que cazó Alex", () => {
  it("'que te follen' es AGRESIÓN, no una pregunta que consultar con el socio", () => {
    expect(sig("Vale, perfecto. Que te follen.")).toBe("hostile-or-suspicious");
    expect(sig("que os follen")).toBe("hostile-or-suspicious");
    expect(sig("jódete")).toBe("hostile-or-suspicious");
    expect(sig("andate a la mierda")).toBe("hostile-or-suspicious");
  });

  it("pedir SALARIO se reconoce (y no se confunde con otra cosa)", () => {
    expect(
      sig("Pues me parece mal, o sea, y pago por salario y a mí me gustaría pago por salario.", { moneyContext: true })
    ).toBe("asks-salary");
    expect(sig("yo prefiero un sueldo fijo", { moneyContext: true })).toBe("asks-salary");
    expect(sig("no hay mensualidad o algo?", { moneyContext: true })).toBe("asks-salary");
  });

  it("'me parece mal' a secas en negociación SÍ es queja del reparto (sigue la escalera)", () => {
    expect(sig("pues me parece mal", { moneyContext: true })).toBe("complains-about-share");
    expect(sig("me parece fatal el reparto ese", { moneyContext: true })).toBe("complains-about-share");
  });

  it("pero 'me parece mal' sobre OTRA cosa NO regala un escalón de la escalera (revisor 17-jul)", () => {
    // Estos concedían el 65/35 sin queja del dinero (y el de la cara además se tragaba la objeción de cara).
    expect(sig("me parece mal tener que enseñar la cara", { moneyContext: true })).not.toBe("complains-about-share");
    expect(sig("me parece fatal lo de los 5 dias de fotos", { moneyContext: true })).not.toBe("complains-about-share");
    expect(sig("me parece mal que grabeis la llamada", { moneyContext: true })).not.toBe("complains-about-share");
    // Y una ACEPTACIÓN con doble negación jamás es queja.
    expect(sig("para nada me parece mal", { moneyContext: true })).not.toBe("complains-about-share");
  });

  it("si en la MISMA frase se despide o declina, el salario no roba el cierre (revisor 17-jul)", () => {
    expect(sig("te dejo, sin sueldo fijo no me sirve, chau", { moneyContext: true })).not.toBe("asks-salary");
    expect(sig("no me interesa, prefiero mi sueldo fijo de camarera", { moneyContext: true })).not.toBe("asks-salary");
    expect(sig("me lo tengo que pensar, lo del sueldo no me convence", { moneyContext: true })).not.toBe("asks-salary");
  });

  it("salario en plena negociación -> explica el no-salario SIN cerrar y SIN mover la escalera", () => {
    const state: CallDirectorState = {
      ...initialCallDirectorState(),
      disclosureGiven: true,
      coveredStages: ["HOW_AGENCY_WORKS", "HER_RESPONSIBILITIES", "CONTENT_AND_FACE", "MONEY"],
      shareDefended: true
    };
    const salary = decideCallDirective({ state, signal: "asks-salary" });
    expect(salary.directive.type).toBe("GIVE_NO_SALARY");
    expect(salary.nextState.closed).toBe(false);
    expect(salary.nextState.revenueShareStep).toBe(0); // la escalera NO se mueve por pedir salario
    // Y si DESPUÉS insiste con el %, la negociación sigue con normalidad (concede el siguiente escalón).
    const complain = decideCallDirective({ state: salary.nextState, signal: "complains-about-share" });
    expect(complain.directive.type).toBe("CONCEDE_SHARE");
  });

  it("el texto del no-salario es determinista, sin cifras, y pasa el validador de voz", () => {
    for (const repetitionIndex of [0, 1]) {
      const plan = planCallUtterance({ directive: { type: "GIVE_NO_SALARY" }, repetitionIndex });
      expect(plan.deterministicText).toBeTruthy();
      // Sin porcentajes ni cantidades de dinero ("cada 14 días" es la cadencia de cobro, legítima).
      expect(plan.deterministicText!).not.toMatch(/%|por\s?ciento|\d+\s*(?:euros?|pavos?|mil)\b/i);
      expect(validateCallUtterance(plan.deterministicText!).valid).toBe(true);
    }
    // Las dos variantes son distintas (anti-loro si insiste).
    const a = planCallUtterance({ directive: { type: "GIVE_NO_SALARY" }, repetitionIndex: 0 }).deterministicText;
    const b = planCallUtterance({ directive: { type: "GIVE_NO_SALARY" }, repetitionIndex: 1 }).deterministicText;
    expect(a).not.toBe(b);
  });

  it("la CARA tras el cierre se responde (reconducir), no se ignora repitiendo el cierre", () => {
    const state: CallDirectorState = {
      ...initialCallDirectorState(),
      disclosureGiven: true,
      coveredStages: ["HOW_AGENCY_WORKS", "HER_RESPONSIBILITIES", "CONTENT_AND_FACE", "MONEY", "CLOSE"],
      closed: true,
      closeDirective: "CLOSE_WITH_CONTRACT"
    };
    for (const signal of ["face-refusal", "face-doubt"] as const) {
      const r = decideCallDirective({ state, signal });
      expect(r.directive.type, signal).toBe("RECONDUCT_FACE");
      expect(r.nextState.closed).toBe(true); // sigue cerrada: solo se responde, no se reabre nada
    }
    // Y el salario tras el cierre también se contesta (no se defiere ni se repite el cierre).
    expect(decideCallDirective({ state, signal: "asks-salary" }).directive.type).toBe("GIVE_NO_SALARY");
  });

  it("los objetivos de la agenda ya no nombran límites ni cara (el modelo los leía y los sacaba)", () => {
    // Ceguera a la negación: "los límites NO se mencionan" en el prompt = mencionarlos. Van en comentarios.
    expect(callAgendaStage("HER_RESPONSIBILITIES").objective.toLowerCase()).not.toContain("límite");
    expect(callAgendaStage("HER_RESPONSIBILITIES").objective.toLowerCase()).not.toContain("limite");
    expect(callAgendaStage("CONTENT_AND_FACE").objective.toLowerCase()).not.toContain("cara");
  });

  it("LÍMITES fuera de la llamada: ni la aclaración de Drive recibe la ficha de límites", async () => {
    // La llamada real: "¿qué es Drive?" -> el buscador servía content-boundaries-neutral-question y el bot
    // soltaba "¿hay algún límite de contenido íntimo...?" sin venir a cuento. Alex: fuera de la llamada.
    const capturedBriefs: CallDraftRequest["brief"][] = [];
    const captureDrafter = {
      draft: async (request: CallDraftRequest) => {
        capturedBriefs.push(request.brief);
        return null; // fuerza el fallback: solo queremos ver QUÉ conocimiento le llega al redactor
      }
    };
    const result = await respondToCall({
      messages: [
        {
          role: "assistant",
          content:
            "Y ahora tu parte: tú crearías el contenido y nos lo mandarías a la carpeta de Drive que te pasamos, ¿hasta ahí bien?"
        },
        { role: "user", content: "A ver, las carpetas. ¿Las carpetas de Drive? ¿Eso qué, qué es Drive?" }
      ],
      candidateName: "Laura",
      recorded: false,
      drafter: captureDrafter
    });
    const served = [
      ...capturedBriefs.flatMap((brief) => [...brief.groundingFacts, ...brief.mandatoryNuances]),
      result.content
    ].join(" ");
    expect(served.toLowerCase()).not.toContain("limite");
    expect(served.toLowerCase()).not.toContain("límite");
  });
});

describe("Encaja TEMPRANO (texto): sin 'Buenas noticias' ni socio; al acabar, directo a la llamada", () => {
  function engineWith(state: string, fit?: string) {
    const repository = new InMemoryCandidateRepository();
    const engine = new ConversationEngine({
      repository,
      understandingProvider: new DeterministicUnderstandingProvider(),
      automationMode: "AUTOMATIC"
    });
    const candidate = normalizeCandidate({
      ...createCandidate({ instagramUsername: "encaja_pronto", profileVisibility: "PUBLIC" }),
      firstName: "Laura",
      age: 42,
      isAdultConfirmed: true,
      deviceEligibility: "APPROVED",
      deviceModel: "iPhone 13",
      currentState: state,
      ...(fit ? { humanFitDecision: fit } : {})
    } as unknown as Candidate);
    return { repository, engine, candidate };
  }

  it("aprobar el MÓVIL con el pre-OK dado, aún en QUALIFYING: NO sale el 'Buenas noticias' prematuro", async () => {
    // CANDADO (no regresión: el revisor verificó que los llamadores actuales de resumeAfterApprovals no
    // alcanzan este caso — el gate es defensivo). Fija el comportamiento que pidió Alex 17-jul: el proactivo
    // "Buenas noticias, hemos revisado tu perfil..." SOLO puede salir si de verdad aterrizó en
    // COLLECTING_CALL_DETAILS; a mitad de preguntas jamás (nunca se le dijo lo del socio y quedaría absurdo).
    const { repository, engine, candidate } = engineWith("QUALIFYING", "APPROVED");
    const seeded = await repository.saveCandidate({ ...candidate, deviceEligibility: "PENDING_QUALITY_TEST" });
    const decision = await engine.applyDeviceQualityDecision({ candidateId: seeded.id, approved: true });
    expect(decision.proposedMessage).toBeNull();
    expect(decision.candidate.currentState).toBe("QUALIFYING");
    // Y al COMPLETAR la cualificación: pitch -> propone la llamada directamente (PRE-OK), sin socio.
    await engine.handleIncomingMessage({
      candidateId: seeded.id,
      instagramUsername: "encaja_pronto",
      message: "nunca he tenido only"
    });
    const after = await engine.handleIncomingMessage({
      candidateId: seeded.id,
      instagramUsername: "encaja_pronto",
      message: "dale, todo claro"
    });
    expect(after.candidate.currentState).toBe("COLLECTING_CALL_DETAILS");
    expect(after.response.toLowerCase()).toContain("llamada");
    expect(after.response.toLowerCase()).not.toContain("mi socio");
    expect(after.response.toLowerCase()).not.toContain("buenas noticias");
  });

  it("REGRESIÓN: Encaja desde REVISIÓN (el caso normal) SÍ envía 'Buenas noticias' y avanza", async () => {
    const { repository, engine, candidate } = engineWith("WAITING_HUMAN_REVIEW");
    const seeded = await repository.saveCandidate(candidate);
    const decision = await engine.markProfileOk({ candidateId: seeded.id });
    expect(decision.proposedMessage).toContain("Buenas noticias");
    expect(decision.candidate.currentState).toBe("COLLECTING_CALL_DETAILS");
  });
});
