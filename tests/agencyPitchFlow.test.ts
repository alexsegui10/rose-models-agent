import { describe, expect, it } from "vitest";
import { ConversationEngine } from "@/application/conversationEngine";
import { DeterministicUnderstandingProvider } from "@/application/dataExtractor";
import { InMemoryCandidateRepository } from "@/infrastructure/repositories/inMemoryCandidateRepository";

// Decision de Alex (14-jun): si la candidata NO ha trabajado con agencias, no sabe en que consiste,
// asi que el bot le explica como trabajamos PROACTIVAMENTE (sin que pregunte "como trabajais").

function createEngine() {
  const repository = new InMemoryCandidateRepository();
  const engine = new ConversationEngine({
    repository,
    understandingProvider: new DeterministicUnderstandingProvider()
  });
  return { engine, repository };
}

describe("agency pitch is delivered proactively when the candidate has no agency experience", () => {
  it("asks for the movil first and only then explains how the agency works (orden nuevo: edad -> movil -> OF -> pitch)", async () => {
    const { engine } = createEngine();
    const username = "no_agency_pitch";
    const opener = await engine.handleIncomingMessage({
      instagramUsername: username,
      profileVisibility: "PUBLIC",
      message: "Hola, me interesa"
    });
    const id = opener.candidate.id;
    await engine.handleIncomingMessage({ candidateId: id, instagramUsername: username, message: "me llamo ana" });
    await engine.handleIncomingMessage({ candidateId: id, instagramUsername: username, message: "tengo 25" });
    // Orden nuevo (Alex 19-jun): el movil se pregunta ANTES que OF. La candidata responde lo de OF
    // (es inexperta: nunca ha tenido OF) MIENTRAS el movil sigue pendiente, asi que el guion esencial
    // todavia NO esta completo (falta el movil) y el pitch NO debe salir aun.
    const afterOnlyFans = await engine.handleIncomingMessage({
      candidateId: id,
      instagramUsername: username,
      message: "no, nunca he tenido of"
    });

    expect(afterOnlyFans.candidate.hasOnlyFans).toBe(false);
    // El pitch va DESPUES del movil: aqui el bot todavia esta pidiendo el movil, sin explicar nada.
    expect(afterOnlyFans.response.toLowerCase()).toContain("movil");
    expect(afterOnlyFans.response.toLowerCase()).not.toMatch(/chatters|cuentas de instagram/);

    // Al dar el movil se COMPLETA el guion esencial: AHORA si llega el pitch operativo (cuentas de
    // Instagram + chatters) y se cierra invitando a preguntar.
    const result = await engine.handleIncomingMessage({
      candidateId: id,
      instagramUsername: username,
      message: "tengo un iphone 13"
    });
    expect(result.candidate.deviceEligibility).not.toBe("UNKNOWN");
    expect(result.response.toLowerCase()).toMatch(/chatters|cuentas de instagram/);
    // Arranque suavizado (Alex 14-jul); la coletilla "cualquier duda me preguntas" se MANTIENE (Alex 14-jul).
    expect(result.response.toLowerCase()).toContain("de forma breve");
    expect(result.response.toLowerCase()).toContain("cualquier duda me preguntas");

    // Anti-bucle: seguir hablando NO vuelve a soltar el pitch; ahora ademas cierra con "lo comento con mi
    // socio" (mensaje siguiente al pitch) y a partir de ahi pausa.
    const again = await engine.handleIncomingMessage({
      candidateId: id,
      instagramUsername: username,
      message: "vale, entendido"
    });
    expect(again.response.toLowerCase()).not.toMatch(/chatters|cuentas de instagram/);
    expect(again.response.toLowerCase()).toContain("mi socio");
  });

  it("tras el pitch, si pregunta una duda la responde Y cierra con 'lo comento con mi socio' en el mismo mensaje, luego pausa (Alex 14-jul)", async () => {
    const { engine } = createEngine();
    const username = "pitch_socio";
    const opener = await engine.handleIncomingMessage({
      instagramUsername: username,
      profileVisibility: "PUBLIC",
      message: "hola"
    });
    const id = opener.candidate.id;
    await engine.handleIncomingMessage({ candidateId: id, instagramUsername: username, message: "me llamo sofia" });
    await engine.handleIncomingMessage({ candidateId: id, instagramUsername: username, message: "tengo 35" });
    await engine.handleIncomingMessage({ candidateId: id, instagramUsername: username, message: "no tengo of" });
    const pitch = await engine.handleIncomingMessage({
      candidateId: id,
      instagramUsername: username,
      message: "iphone 13 pro max"
    });
    // El pitch entra en revision pero NO lleva el cierre del socio (va en el mensaje siguiente).
    expect(pitch.candidate.currentState).toBe("WAITING_HUMAN_REVIEW");
    expect(pitch.response.toLowerCase()).toMatch(/chatters|cuentas de instagram/);
    expect(pitch.response.toLowerCase()).not.toContain("mi socio");

    // Pregunta la cifra JUSTO despues del pitch: responde el 70/30 Y cierra con el socio en el MISMO mensaje.
    const asked = await engine.handleIncomingMessage({
      candidateId: id,
      instagramUsername: username,
      message: "y cuanto os quedais vosotros?"
    });
    expect(asked.response).toMatch(/70%/);
    expect(asked.response.toLowerCase()).toContain("mi socio");

    // A partir de ahi, pausa total (en visto) hasta el Encaja.
    const paused = await engine.handleIncomingMessage({
      candidateId: id,
      instagramUsername: username,
      message: "vale"
    });
    expect(paused.response.trim()).toBe("");
  });

  // REGRESION (Alex 15-jul, caso "Laura"): si la candidata COMPLETA el guion en el MISMO turno en que hace
  // una pregunta cubierta de proceso ("¿la cuenta la abro yo o vosotros?"), esa respuesta pisaba el pitch
  // proactivo y se PERDIA (saltaba directo a "lo comento con mi socio"). Orden pedido por Alex: primero se
  // responde su pregunta, al turno siguiente sale el pitch, y despues el socio. Nunca se salta el pitch.
  it("completa + pregunta cubierta en el mismo turno: responde primero, LUEGO el pitch, LUEGO el socio (no se salta el pitch)", async () => {
    const { engine } = createEngine();
    const username = "laura_pitch_skip";
    const opener = await engine.handleIncomingMessage({
      instagramUsername: username,
      profileVisibility: "PUBLIC",
      message: "hola"
    });
    const id = opener.candidate.id;
    await engine.handleIncomingMessage({ candidateId: id, instagramUsername: username, message: "me llamo laura" });
    await engine.handleIncomingMessage({ candidateId: id, instagramUsername: username, message: "tengo 29" });
    // Da el movil (aun sin OF -> guion incompleto, sin pitch todavia).
    await engine.handleIncomingMessage({ candidateId: id, instagramUsername: username, message: "tengo un iphone 14" });

    // Turno de COMPLETAR (da el OF) + pregunta cubierta a la vez: se le RESPONDE la pregunta y se queda en
    // QUALIFYING (la revision se difiere un turno para no perder el pitch). NADA de pitch ni de socio aqui.
    const answered = await engine.handleIncomingMessage({
      candidateId: id,
      instagramUsername: username,
      message: "no tengo of. oye una cosa, la cuenta la abro yo o la abris vosotros?"
    });
    expect(answered.candidate.hasOnlyFans).toBe(false);
    expect(answered.candidate.currentState).toBe("QUALIFYING");
    expect(answered.response.toLowerCase()).not.toMatch(/chatters|cuentas de instagram/);
    expect(answered.response.toLowerCase()).not.toContain("mi socio");

    // Turno siguiente SIN pregunta nueva: AHORA si sale el pitch (no se lo saltó) y entra en revision.
    const pitch = await engine.handleIncomingMessage({
      candidateId: id,
      instagramUsername: username,
      message: "ah vale, gracias"
    });
    expect(pitch.response.toLowerCase()).toMatch(/chatters|cuentas de instagram/);
    expect(pitch.response.toLowerCase()).toContain("de forma breve");
    expect(pitch.candidate.currentState).toBe("WAITING_HUMAN_REVIEW");
    expect(pitch.response.toLowerCase()).not.toContain("mi socio");

    // Y despues del pitch, el cierre con el socio.
    const socio = await engine.handleIncomingMessage({
      candidateId: id,
      instagramUsername: username,
      message: "perfecto"
    });
    expect(socio.response.toLowerCase()).toContain("mi socio");
  });
});
