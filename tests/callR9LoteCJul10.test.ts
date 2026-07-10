import { describe, it, expect } from "vitest";
import { respondToCall, type CallChatMessage } from "@/application/callTurnResponder";
import { LocalBusinessKnowledgeRetriever } from "@/application/businessKnowledgeRetriever";
import { businessKnowledgeEntries } from "@/content/business";
import { createCandidate, normalizeCandidate } from "@/domain/candidate";

// Lote C del sweep R9 (decisiones de Alex 10-jul): cuatro respuestas de negocio nuevas, aprobadas hoy.
// 1) OF abandonado -> sin problema, se retoma. 2) Edicion -> la agencia (material en crudo). 3) Oficina ->
// todo online. 4) Hijos/terceros en contenido -> NO ROTUNDO inmediato (solo ella; menores JAMAS).

const retriever = new LocalBusinessKnowledgeRetriever(businessKnowledgeEntries);
const candidate = normalizeCandidate({
  ...createCandidate({ instagramUsername: "call_ctx" }),
  currentState: "CALL_IN_PROGRESS"
});

async function covering(question: string) {
  return retriever.retrieve({ candidate, intent: "REQUESTS_INFORMATION", question, limit: 3, ignoreStateGating: true });
}

const OPENING = "Hola Lucia, soy Alex, de Rose Models. Te cuento como trabajamos, ¿vale?";

async function voiceAnswer(utterance: string) {
  const messages: CallChatMessage[] = [
    { role: "assistant", content: OPENING },
    { role: "user", content: utterance }
  ];
  return respondToCall({ messages, candidateName: "Lucia" });
}

describe("C1. OF abandonado -> cubierto y respondido ('se retoma, sin problema')", () => {
  it("retriever: 'tengo of pero abandonado, cuenta igual?' recupera la entrada nueva", async () => {
    const entries = await covering("tengo onlyfans pero abandonado hace meses, cuenta igual?");
    expect(entries.map((e) => e.id)).toContain("onlyfans-existing-or-abandoned");
  });

  it("voz e2e: responde (no defiere) y tranquiliza", async () => {
    const res = await voiceAnswer("tengo onlyfans pero lo tengo abandonado hace meses, cuenta igual?");
    expect(res.directiveType).toBe("ANSWER_FROM_KNOWLEDGE");
    expect(res.content.toLowerCase()).toMatch(/sin problema|retomamos|ventaja/);
  });
});

describe("C2. ¿Quien edita? -> la agencia (material en crudo)", () => {
  it("retriever: 'las fotos las edito yo o vosotros?' recupera la entrada de edicion", async () => {
    const entries = await covering("y las fotos las edito yo o vosotros?");
    expect(entries.map((e) => e.id)).toContain("content-editing-by-agency");
  });

  it("voz e2e: responde quien edita (no un volcado de calendario)", async () => {
    const res = await voiceAnswer("y las fotos las edito yo o vosotros?");
    expect(res.directiveType).toBe("ANSWER_FROM_KNOWLEDGE");
    expect(res.content.toLowerCase()).toMatch(/edicion|crudo|nos encargamos/);
  });
});

describe("C3. ¿Oficina fisica o todo online? -> 100% online", () => {
  it("retriever: la entrada de online LIDERA (no queda enterrada tras 'Soy Alex...')", async () => {
    const entries = await covering("y teneis oficina fisica o todo online?");
    expect(entries[0]?.id).toBe("agency-online-no-office");
  });

  it("voz e2e: responde 'todo online' (no defiere)", async () => {
    const res = await voiceAnswer("y teneis oficina fisica o es todo online?");
    expect(res.directiveType).toBe("ANSWER_FROM_KNOWLEDGE");
    expect(res.content.toLowerCase()).toContain("online");
  });
});

describe("C4. ¿Mis hijos salen en algo? -> NO ROTUNDO inmediato (jamas se defiere)", () => {
  it("retriever: 'mis nenes no salen en nada no?' recupera la entrada solo-ella", async () => {
    const entries = await covering("vale y mis nenes no salen en nada no?");
    expect(entries.map((e) => e.id)).toContain("content-only-her-no-minors");
  });

  it("voz e2e: NO rotundo al momento ('apareces solo tu... jamas')", async () => {
    const res = await voiceAnswer("vale y mis nenes no salen en nada no?");
    expect(res.directiveType).toBe("ANSWER_FROM_KNOWLEDGE");
    expect(res.content.toLowerCase()).toMatch(/jamas|solo tu/);
    // Y NUNCA un defer ("te lo confirmo por WhatsApp") para esto.
    expect(res.content.toLowerCase()).not.toContain("whatsapp");
  });

  it("variantes: pareja/familia tambien cubiertas", async () => {
    for (const q of ["mi pareja sale en los videos?", "aparece alguien mas o solo salgo yo?"]) {
      const entries = await covering(q);
      expect(
        entries.map((e) => e.id),
        q
      ).toContain("content-only-her-no-minors");
    }
  });

  it("BLOQUEANTE revisor: con la palabra 'fotos' el NO rotundo LIDERA (no el calendario)", async () => {
    for (const q of ["mis hijos salen en las fotos?", "mis nenes no aparecen en las fotos verdad?"]) {
      const entries = await covering(q);
      expect(entries[0]?.id, q).toBe("content-only-her-no-minors");
      const res = await voiceAnswer(q);
      expect(res.content.toLowerCase(), q).toMatch(/jamas|solo tu/);
    }
  });

  it("CONTROL: 'cuantas fotos al dia?' sigue siendo el calendario de produccion", async () => {
    const entries = await covering("cuantas fotos al dia tengo que hacer?");
    expect(entries[0]?.id).toBe("content-production-volume");
  });

  it("NOTAS revisor: retoques esteticos / IG parado / objecion de pareja NO se cuelan en las entradas nuevas", async () => {
    const lips = await covering("me he retocado los labios, os importa?");
    expect(lips[0]?.id).not.toBe("content-editing-by-agency");
    const ig = await covering("mi instagram lo tengo parado hace tiempo");
    expect(ig[0]?.id).not.toBe("onlyfans-existing-or-abandoned");
    const partner = await covering("mi novio no quiere que salga en videos");
    expect(partner[0]?.id).not.toBe("content-only-her-no-minors");
  });

  it("RIESGO revisor: 'quien hace la edicion?' (sustantivo) tambien cubierto", async () => {
    const entries = await covering("quien hace la edicion?");
    expect(entries[0]?.id).toBe("content-editing-by-agency");
  });

  it("INVERSION verbo-sujeto (2a ronda revisor): '¿salen mis hijos...?' tambien lidera el NO rotundo", async () => {
    for (const q of [
      "en las fotos salen mis hijos?",
      "saldran mis hijos en las fotos?",
      "van a salir mis nenes en los reels?",
      "en los videos aparecen mis hijos o no?",
      "no saldran mis hijas en ninguna foto verdad?",
      "che y en los reels sale mi nena tambien?"
    ]) {
      const entries = await covering(q);
      expect(entries[0]?.id, q).toBe("content-only-her-no-minors");
      const res = await voiceAnswer(q);
      expect(res.content.toLowerCase(), q).toMatch(/jamas|solo tu/);
    }
  });

  it("objecion de pareja con CLITICO ('no me deja que salga') tampoco se cuela en only-her", async () => {
    const entries = await covering("mi marido no me deja que salga en videos");
    expect(entries[0]?.id).not.toBe("content-only-her-no-minors");
  });

  it("madre con pregunta LEGITIMA de calendario: 'tengo dos hijos, cuantas fotos al dia?' -> calendario", async () => {
    const entries = await covering("tengo dos hijos, cuantas fotos al dia tendria que hacer?");
    expect(entries[0]?.id).toBe("content-production-volume");
  });
});
