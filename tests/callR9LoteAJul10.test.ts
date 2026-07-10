import { describe, it, expect } from "vitest";
import { classifyCallSignal } from "@/application/callSignalClassifier";
import { validateCallUtterance } from "@/application/callRedactionValidator";
import { respondToCall, type CallChatMessage } from "@/application/callTurnResponder";
import { LocalBusinessKnowledgeRetriever } from "@/application/businessKnowledgeRetriever";
import { businessKnowledgeEntries } from "@/content/business";
import { createCandidate, normalizeCandidate } from "@/domain/candidate";
import type { CallUnderstander, CallUnderstandRequest, CallUnderstoodIntent } from "@/application/callUnderstander";

// Lote A del sweep R9 (10-jul, "que este VIVO"): fixes SEGUROS de misroutes/bucles cazados por el
// workflow adversarial sobre llamadas largas simuladas. Sin tocar %/edad/cierre.

const sig = (utterance: string, extra: Parameters<typeof classifyCallSignal>[0] = { utterance }) =>
  classifyCallSignal({ ...extra, utterance });

describe("A1. Declaraciones de estado de OnlyFans -> entendidas (no 'no te pillo')", () => {
  for (const phrase of [
    "mira yo no tengo onlyfans eh",
    "bueno miento, si tengo pero abandonado hace meses",
    "tengo onlyfans pero lo tengo abandonado",
    "nunca tuve onlyfans",
    "si tengo of desde hace tres anos"
  ]) {
    it(`"${phrase}" -> follows-along (informacion, se asiente y sigue)`, () => {
      expect(sig(phrase)).toBe("follows-along");
    });
  }

  it("una PREGUNTA de OF sigue siendo pregunta ('necesito tener onlyfans ya?')", () => {
    expect(sig("necesito tener onlyfans ya?")).not.toBe("follows-along");
  });

  it("NEGATIVA o DUDA con el dato de OF NO se aplana como asentimiento (revisor R9)", () => {
    expect(sig("no tengo onlyfans y no pienso hacerme uno")).not.toBe("follows-along");
    expect(sig("tengo mis reservas con el onlyfans")).not.toBe("follows-along");
  });

  it("SEGURIDAD: menor con OF sigue cortando (underage gana)", () => {
    expect(sig("tengo 16 y tengo onlyfans")).toBe("underage");
  });
});

describe("A2. '¿como te llamabas?' y variantes -> asks-identity (no defer)", () => {
  for (const phrase of ["oye y tu como te llamabas?", "cual era tu nombre?", "me repites tu nombre?", "como era tu nombre"]) {
    it(`"${phrase}" -> asks-identity`, () => {
      expect(sig(phrase)).toBe("asks-identity");
    });
  }
});

describe("A3. Aviso de TIEMPO ('solo tengo una hora') -> seguir (no defer, no cerrar)", () => {
  for (const phrase of [
    "te aviso que solo tengo una hora eh que luego entro a trabajar",
    "solo tengo media hora",
    "tengo poco tiempo asi que rapido",
    "en un rato entro a trabajar te aviso"
  ]) {
    it(`"${phrase}" -> follows-along`, () => {
      expect(sig(phrase)).toBe("follows-along");
    });
  }

  it("'tengo prisa, hablamos luego' SIGUE siendo wants-to-end (reagendar)", () => {
    expect(sig("tengo prisa, hablamos luego")).toBe("wants-to-end");
  });

  it("aviso de tiempo + PREGUNTA real encadenada -> gana la pregunta (revisor R9)", () => {
    expect(sig("solo tengo media hora, cuanto se gana?")).toBe("asks-earnings");
  });

  it("'te aviso con tiempo' (aplazamiento) NO dispara TIME_NOTICE (el lookahead lo excluye)", () => {
    // OJO: "ya te aviso con tiempo" acabaria en follows-along igualmente por el "ya" inicial (regla
    // PREEXISTENTE de asentimiento, fuera de este lote). Se testea sin el "ya" para medir solo TIME_NOTICE.
    expect(sig("te aviso con tiempo si puedo, es que no se mi turno")).not.toBe("follows-along");
  });
});

describe("A4. '¿de que os encargais?' / '¿que hariais por mi?' -> pregunta CUBIERTA (servicios)", () => {
  const retriever = new LocalBusinessKnowledgeRetriever(businessKnowledgeEntries);
  const candidate = normalizeCandidate({
    ...createCandidate({ instagramUsername: "call_ctx" }),
    currentState: "CALL_IN_PROGRESS"
  });
  for (const question of [
    "y vosotros que hariais exactamente por mi?",
    "en concreto vosotros de que os encargais?",
    "ustedes de que se encargan?",
    "que haceis vosotros exactamente?"
  ]) {
    it(`"${question}" recupera conocimiento (no defer)`, async () => {
      const entries = await retriever.retrieve({
        candidate,
        intent: "REQUESTS_INFORMATION",
        question,
        limit: 3,
        ignoreStateGating: true
      });
      expect(entries.length, question).toBeGreaterThan(0);
    });
  }

  it("CONTROL: 'de que os encargais con el dinero' NO entra por servicios (guard de pagos)", async () => {
    const entries = await retriever.retrieve({
      candidate,
      intent: "REQUESTS_INFORMATION",
      question: "vosotros os encargais del dinero de los pagos?",
      limit: 3,
      ignoreStateGating: true
    });
    const ids = entries.map((entry) => entry.id);
    expect(ids).not.toContain("services-agency-management");
  });

  it("CONTROL: 'os encargais de los cobros / de cobrar' NO entra por servicios (revisor R9)", async () => {
    for (const question of ["os encargais de los cobros vosotros?", "os encargais vosotros de cobrar?"]) {
      const entries = await retriever.retrieve({
        candidate,
        intent: "REQUESTS_INFORMATION",
        question,
        limit: 3,
        ignoreStateGating: true
      });
      expect(
        entries.map((e) => e.id),
        question
      ).not.toContain("services-agency-management");
    }
  });

  it("CONTROL: 'os encargais ... demostrar estafa' NO entra por la regla NUEVA (guard demostrar)", async () => {
    // OJO: "que haceis..." a secas ya empujaba servicios por una regla PREEXISTENTE (linea ~141, fuera de
    // este lote). Aqui se mide que la regla NUEVA ("os encargais") respeta el guard de demostrar/pruebas.
    const entries = await retriever.retrieve({
      candidate,
      intent: "REQUESTS_INFORMATION",
      question: "de que os encargais para demostrar que no es una estafa?",
      limit: 3,
      ignoreStateGating: true
    });
    expect(entries[0]?.id).not.toBe("services-agency-management");
  });
});

describe("A5. Nunca dos 'no te pillo' IDENTICOS seguidos (varia la formulacion)", () => {
  class NoneUnderstander implements CallUnderstander {
    async understand(_r: CallUnderstandRequest): Promise<CallUnderstoodIntent | null> {
      return null; // el modelo tampoco lo entiende -> se queda unclear
    }
  }

  it("2o unclear consecutivo usa OTRA variante de ASK_REPEAT", async () => {
    const messages: CallChatMessage[] = [
      { role: "assistant", content: "Hola Lucia, soy Alex, de Rose Models. Te cuento como trabajamos, ¿vale?" },
      { role: "user", content: "zzz frase rarisima sin sentido klm" },
      { role: "assistant", content: "Perdona, no te he pillado bien con la línea. ¿Me lo puedes repetir?" },
      { role: "user", content: "otra frase rarisima sin sentido qqq" }
    ];
    const res = await respondToCall({ messages, candidateName: "Lucia", understander: new NoneUnderstander() });
    expect(res.directiveType).toBe("ASK_REPEAT");
    expect(res.content).not.toContain("no te he pillado bien");
  });
});

describe("A6. Un DEFER nunca empieza con 'Si/No' (contradiccion con la pregunta polar)", () => {
  for (const draft of [
    "No, tranquila, eso prefiero confirmartelo bien y te lo mando por WhatsApp.",
    "Si, claro; eso prefiero confirmartelo y te lo paso por WhatsApp, ¿te va?",
    "Sí, eso te lo confirmo por WhatsApp en cuanto colguemos."
  ]) {
    it(`"${draft.slice(0, 40)}..." -> INVALIDO con noPolarOpener`, () => {
      expect(validateCallUtterance(draft, undefined, { noPolarOpener: true }).valid).toBe(false);
    });
  }

  it("un defer sin particula polar sigue valido", () => {
    expect(
      validateCallUtterance("Mira, eso prefiero confirmartelo bien y te lo paso por WhatsApp al colgar, ¿vale?", undefined, {
        noPolarOpener: true
      }).valid
    ).toBe(true);
  });

  it("sin la opcion, un 'Si, claro' normal sigue valido (solo aplica a DEFER)", () => {
    expect(validateCallUtterance("Si, claro, te cuento ahora mismo como va.").valid).toBe(true);
  });
});
