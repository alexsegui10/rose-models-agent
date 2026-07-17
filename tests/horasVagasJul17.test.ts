import { describe, expect, it } from "vitest";
import { parseProposedCallTime, argentinaLabelFromMs } from "@/application/callScheduling";
import { ConversationEngine } from "@/application/conversationEngine";
import { DeterministicUnderstandingProvider } from "@/application/dataExtractor";
import { createCandidate, normalizeCandidate, type Candidate } from "@/domain/candidate";
import { InMemoryCandidateRepository } from "@/infrastructure/repositories/inMemoryCandidateRepository";

// PRUEBA REAL DE ALEX (17-jul): dijo "ahora en 5 minutos", el bot contestó "te llamo en un rato"... y NO le
// llamó nunca. Causa: el parser solo entendía horas de RELOJ ("mañana a las 6"), así que sin hora no se
// agendaba nada y no había llamada que marcar. Y Alex avisó de lo importante:
//   "casi siempre dicen 'mañana después de comer' o 'al mediodía', no siempre dicen horas exactas"
// O sea: el caso MÁS COMÚN se perdía entero.
//
// DECISIÓN DE ALEX (17-jul) — franjas -> hora concreta, en hora de ELLA (argentina):
//   por la mañana 11:00 · al mediodía 13:00 · después de comer 15:00 · por la tarde 17:00 · por la noche 21:00
// Y "ahora / en 5 minutos" -> se agenda de verdad (a los ~5 min), no un "en un rato" que no llama nadie.

// Viernes 17-jul-2026, 09:00 UTC = 06:00 en Argentina (así "hoy" a cualquier franja sigue siendo futuro).
const NOW = new Date("2026-07-17T09:00:00Z");
const horaAr = (ms: number): string => argentinaLabelFromMs(ms);

describe("horas VAGAS: se agendan con la hora que decidió Alex (prueba real 17-jul)", () => {
  it("las franjas del día se traducen a la hora concreta de Alex (hora argentina)", () => {
    const casos: Array<[string, string]> = [
      ["mañana por la mañana", "11:00"],
      ["mañana al mediodía", "13:00"],
      ["mañana después de comer", "15:00"],
      ["mañana por la tarde", "17:00"],
      ["mañana por la noche", "21:00"]
    ];
    for (const [frase, hora] of casos) {
      const slot = parseProposedCallTime(frase, NOW, "AR", { resolveDaySlot: true });
      expect(slot, frase).not.toBeNull();
      expect(horaAr(slot!.startMsUtc), frase).toContain(hora);
      expect(horaAr(slot!.startMsUtc), frase).toContain("sabado"); // "mañana" desde el viernes
    }
  });

  it("también sin decir el día ('esta tarde') y con día de la semana ('el lunes después de comer')", () => {
    const estaTarde = parseProposedCallTime("esta tarde", NOW, "AR", { resolveDaySlot: true });
    expect(estaTarde).not.toBeNull();
    expect(horaAr(estaTarde!.startMsUtc)).toContain("17:00");
    expect(horaAr(estaTarde!.startMsUtc)).toContain("viernes"); // hoy

    const lunes = parseProposedCallTime("el lunes después de comer", NOW, "AR", { resolveDaySlot: true });
    expect(lunes).not.toBeNull();
    expect(horaAr(lunes!.startMsUtc)).toContain("15:00");
    expect(horaAr(lunes!.startMsUtc)).toContain("lunes");
  });

  it("'ahora / en 5 minutos / en media hora' SE AGENDAN de verdad (antes no llamaba nadie)", () => {
    const cinco = parseProposedCallTime("ahora en 5 minutos", NOW, "AR");
    expect(cinco).not.toBeNull();
    expect(cinco!.startMsUtc - NOW.getTime()).toBe(5 * 60_000);

    const media = parseProposedCallTime("en media hora", NOW, "AR");
    expect(media).not.toBeNull();
    expect(media!.startMsUtc - NOW.getTime()).toBe(30 * 60_000);

    const ahora = parseProposedCallTime("ahora mismo", NOW, "AR");
    expect(ahora).not.toBeNull();
    expect(ahora!.startMsUtc).toBeGreaterThan(NOW.getTime());
  });

  it("una hora EXACTA sigue mandando sobre la franja ('mañana a las 8 de la mañana' NO son las 11)", () => {
    const exacta = parseProposedCallTime("mañana a las 8 de la mañana", NOW, "AR", { resolveDaySlot: true });
    expect(exacta).not.toBeNull();
    expect(horaAr(exacta!.startMsUtc)).toContain("08:00");
  });

  // El flujo COMPLETO que quiere Alex (17-jul): se mantiene su decisión del 23-jun (el bot insiste UNA vez en
  // la hora exacta), pero si ella INSISTE con la franja ya no se le deja a él para llamar a mano: se traduce a
  // la hora concreta y se AGENDA, para que el marcador la llame de verdad.
  it("si INSISTE con la franja, se AGENDA sola a la hora de Alex (ya no se queda esperando a que llame él)", async () => {
    const repository = new InMemoryCandidateRepository();
    const engine = new ConversationEngine({
      repository,
      understandingProvider: new DeterministicUnderstandingProvider(),
      automationMode: "AUTOMATIC"
    });
    const seeded = await repository.saveCandidate(
      normalizeCandidate({
        ...createCandidate({ instagramUsername: "franja_insiste", profileVisibility: "PUBLIC" }),
        firstName: "Ana",
        age: 34,
        isAdultConfirmed: true,
        deviceEligibility: "APPROVED",
        phone: "+54 9 11 5555 0134",
        currentState: "COLLECTING_CALL_DETAILS",
        humanFitDecision: "APPROVED",
        callTimePreference: "mañana por la tarde"
      } as unknown as Candidate)
    );
    // 1º turno: el bot insiste por la hora exacta (decisión de Alex 23-jun, intacta).
    const first = await engine.handleIncomingMessage({
      candidateId: seeded.id,
      instagramUsername: "franja_insiste",
      message: "mañana por la tarde"
    });
    expect(first.response.toLowerCase()).toContain("hora");
    expect(first.candidate.currentState).toBe("COLLECTING_CALL_DETAILS");

    // 2º turno: ella INSISTE con la franja Y el día -> se acepta, se traduce y se AGENDA (antes: se quedaba
    // esperando a que Alex llamara a mano).
    const second = await engine.handleIncomingMessage({
      candidateId: seeded.id,
      instagramUsername: "franja_insiste",
      message: "mañana por la tarde mejor"
    });
    expect(second.candidate.currentState).toBe("CALL_SCHEDULED");
    expect(second.candidate.scheduledCallStartMs).toBeTruthy();
    // Y se le confirma SU hora concreta, para que pueda corregir si no le va.
    expect(second.response.toLowerCase()).toMatch(/te llamo/);
  });

  // LA CONVERSACIÓN EXACTA DE ALEX (3ª prueba, "Laura"): ella dice "ahora en 5 minutos", el bot le pide el
  // teléfono, ella lo pasa... y NO se agendaba nada ("Te llamamos lo antes posible" -> lo llamaba él a mano).
  // Causa: el "asap" se DESCARTABA a propósito (`!inboundIsAsap`), así que al llegar el teléfono la hora ya
  // no estaba. Queja literal: "dice que la agenda pero sigue sin agendarla y no llama a los 5 minutos".
  it("la hora en un turno y el teléfono en otro SÍ se combinan: 'ahora en 5 minutos' + teléfono -> AGENDADA", async () => {
    const repository = new InMemoryCandidateRepository();
    const engine = new ConversationEngine({
      repository,
      understandingProvider: new DeterministicUnderstandingProvider(),
      automationMode: "AUTOMATIC"
    });
    const seeded = await repository.saveCandidate(
      normalizeCandidate({
        ...createCandidate({ instagramUsername: "laura_5min", profileVisibility: "PUBLIC" }),
        firstName: "Laura",
        age: 42,
        isAdultConfirmed: true,
        deviceEligibility: "APPROVED",
        deviceModel: "iPhone 13",
        hasOnlyFans: false,
        currentState: "COLLECTING_CALL_DETAILS",
        humanFitDecision: "APPROVED"
      } as unknown as Candidate)
    );
    // 1º turno: dice la hora pero aún no hay teléfono -> se PERSISTE la hora (antes se tiraba).
    const withTime = await engine.handleIncomingMessage({
      candidateId: seeded.id,
      instagramUsername: "laura_5min",
      message: "ahora en 5 minutos"
    });
    expect(withTime.candidate.callTimePreference).toBe("ahora en 5 minutos");

    // 2º turno: pasa el teléfono -> se combina con la hora persistida y se AGENDA de verdad.
    const withPhone = await engine.handleIncomingMessage({
      candidateId: seeded.id,
      instagramUsername: "laura_5min",
      message: "si es +54 9 11 5555 0134"
    });
    expect(withPhone.candidate.currentState).toBe("CALL_SCHEDULED");
    expect(withPhone.candidate.scheduledCallStartMs).toBeTruthy();
    const enMinutos = Math.round((withPhone.candidate.scheduledCallStartMs! - Date.now()) / 60_000);
    expect(enMinutos).toBeLessThanOrEqual(6);
    // Y se le repite SU fraseo, no "el viernes a las 08:49" ni "en un rato" (Alex: "5 minutos no es un rato").
    expect(withPhone.response.toLowerCase()).toContain("en 5 minutos");
    expect(withPhone.response.toLowerCase()).not.toContain("en un rato");
    expect(withPhone.response.toLowerCase()).not.toContain("lo antes posible");
  });

  // LÍMITE CONSCIENTE (riesgo del revisor 17-jul): al aceptar solo se mira el ÚLTIMO texto de hora que dijo.
  // Si ese no lleva día ("por la tarde cuando sea"), asumir HOY podría llamarla el día equivocado (ella había
  // dicho "mañana"), así que NO se agenda: se mantiene el comportamiento de junio y la llama Alex a mano.
  it("si al insistir NO dice el día, no se adivina: se acepta y queda para que la llame Alex", async () => {
    const repository = new InMemoryCandidateRepository();
    const engine = new ConversationEngine({
      repository,
      understandingProvider: new DeterministicUnderstandingProvider(),
      automationMode: "AUTOMATIC"
    });
    const seeded = await repository.saveCandidate(
      normalizeCandidate({
        ...createCandidate({ instagramUsername: "franja_sin_dia", profileVisibility: "PUBLIC" }),
        firstName: "Ana",
        age: 34,
        isAdultConfirmed: true,
        deviceEligibility: "APPROVED",
        phone: "+54 9 11 5555 0134",
        currentState: "COLLECTING_CALL_DETAILS",
        humanFitDecision: "APPROVED",
        callTimePreference: "mañana por la tarde"
      } as unknown as Candidate)
    );
    await engine.handleIncomingMessage({
      candidateId: seeded.id,
      instagramUsername: "franja_sin_dia",
      message: "mañana por la tarde"
    });
    const second = await engine.handleIncomingMessage({
      candidateId: seeded.id,
      instagramUsername: "franja_sin_dia",
      message: "por la tarde cuando sea"
    });
    expect(second.candidate.currentState).toBe("READY_TO_SCHEDULE");
    expect(second.response.toLowerCase()).not.toContain("mi socio");
  });

  // BLOQUEANTE que cazó el revisor (17-jul): un "ahora" DESCRIPTIVO agendaba una llamada REAL en 5 minutos.
  // El bot habría llamado por teléfono a candidatas que no pidieron ninguna llamada.
  it("un 'ahora' descriptivo NO agenda nada (no llamamos a quien no lo ha pedido)", () => {
    const noPropuesta = [
      "ahora trabajo de camarera pero me interesa",
      "ahora te paso el numero",
      "ahora mismo no se, me lo pienso",
      "ahora estoy con los nenes",
      "es que ahora ando liada con el trabajo"
    ];
    for (const frase of noPropuesta) {
      expect(parseProposedCallTime(frase, NOW, "AR"), frase).toBeNull();
    }
  });

  it("pero 'ahora' SÍ cuenta cuando ES la propuesta", () => {
    for (const frase of ["ahora mismo", "ahora puedo", "llamame ahora", "ahora si quieres", "ahora en 5 minutos"]) {
      expect(parseProposedCallTime(frase, NOW, "AR"), frase).not.toBeNull();
    }
  });

  it("'hoy en media hora' se agenda: la duración gana al guard de día si ES la propuesta (revisor 17-jul)", () => {
    const media = parseProposedCallTime("hoy en media hora", NOW, "AR");
    expect(media).not.toBeNull();
    expect(media!.startMsUtc - NOW.getTime()).toBe(30 * 60_000);
    expect(parseProposedCallTime("hoy en 5 minutos", NOW, "AR")).not.toBeNull();
  });

  // BLOQUEANTE del revisor (17-jul): una duración que es de OTRA cosa agendaba una llamada REAL. El bot habría
  // llamado a una candidata EN CLASE. Es la misma familia que el "ahora" descriptivo, por la rama de duración.
  it("una duración que NO es la propuesta no agenda nada (no la llamamos en mitad de su clase)", () => {
    const noPropuesta = [
      "tengo clase en una hora",
      "estoy en una reunion, en media hora te escribo",
      "mi jefe llega en 5 minutos",
      "el bus sale en 20 minutos",
      "entro a trabajar en una hora",
      "salgo del trabajo en una hora",
      "te contesto en una hora",
      "ok, lo hablo con mi novio y en 10 minutos te digo"
    ];
    for (const frase of noPropuesta) {
      expect(parseProposedCallTime(frase, NOW, "AR"), frase).toBeNull();
    }
  });

  it("pero la duración SÍ cuenta cuando ES la propuesta", () => {
    for (const frase of [
      "en 5 minutos",
      "ahora en 5 minutos",
      "en media hora",
      "dale en 5 minutos",
      "en 5 minutos me va bien",
      "llamame en 10 minutos",
      "en un cuarto de hora",
      // Fraseos comunísimos en IG que la 1ª versión perdía (nota del revisor 17-jul): interrogación, emojis
      // y coletillas de aceptación. Se perdían leads que se podían automatizar.
      "en media hora?",
      "en 5 minutos :)",
      "en 10 minutos 😊",
      "pues en 10 minutos si te va bien",
      "en media hora si te viene bien",
      "en una hora si podes",
      "en 10 minutos estoy libre",
      "me podes llamar en media hora",
      "en 20 minutos okey"
    ]) {
      expect(parseProposedCallTime(frase, NOW, "AR"), frase).not.toBeNull();
    }
  });

  it("si dice un DÍA o una FRANJA, manda eso — el 'ahora' es contexto, no la cita", () => {
    // "ahora estoy en el laburo, mañana por la tarde" NO puede agendarse en 5 minutos: ella dijo MAÑANA.
    expect(parseProposedCallTime("es que ahora estoy en el laburo, mañana por la tarde", NOW, "AR")).toBeNull();
    const conFranja = parseProposedCallTime("es que ahora estoy en el laburo, mañana por la tarde", NOW, "AR", {
      resolveDaySlot: true
    });
    expect(conFranja).not.toBeNull();
    expect(horaAr(conFranja!.startMsUtc)).toContain("17:00");
    expect(horaAr(conFranja!.startMsUtc)).toContain("sabado"); // mañana, no "en 5 minutos"
  });

  it("'mañana a la mañana' (argentino) es MAÑANA a las 11, no pasado", () => {
    const slot = parseProposedCallTime("mañana a la mañana", NOW, "AR", { resolveDaySlot: true });
    expect(slot).not.toBeNull();
    expect(horaAr(slot!.startMsUtc)).toContain("11:00");
    expect(horaAr(slot!.startMsUtc)).toContain("sabado"); // mañana desde el viernes
  });

  it("una NEGACIÓN sigue sin agendar nada ('ahora no puedo', 'mañana por la tarde no')", () => {
    expect(parseProposedCallTime("ahora no puedo", NOW, "AR")).toBeNull();
    expect(parseProposedCallTime("mañana por la tarde no me va bien", NOW, "AR", { resolveDaySlot: true })).toBeNull();
    expect(parseProposedCallTime("cuando puedas", NOW, "AR")).toBeNull();
  });
});
