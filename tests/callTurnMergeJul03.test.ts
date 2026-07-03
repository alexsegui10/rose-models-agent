import { describe, expect, it } from "vitest";
import { respondToCall, type CallChatMessage } from "@/application/callTurnResponder";

// FUSIÓN de turnos consecutivos (3-jul, llamada real: el bot "se saltó el guion"): con la candidata
// hablando por encima (interrupciones que no cortaban), ElevenLabs mandaba varios turnos suyos seguidos y
// el replay saltaba etapas del guion, vocalizando solo la última. Ahora los turnos sin respuesta del bot
// entre medias se funden en uno: el guion no salta.

describe("no se salta el guion cuando la candidata suelta varios turnos seguidos", () => {
  it("apertura + 'Sí' + 'Ya' seguidos -> la 1ª etapa (cómo trabaja la agencia), NO se salta a 'tu parte'", async () => {
    const messages: CallChatMessage[] = [
      { role: "system", content: "p" },
      { role: "assistant", content: "Hola Ana, soy Alex... ¿te pillo bien?" },
      { role: "user", content: "Sí" },
      { role: "user", content: "Ya" }
    ];
    const res = await respondToCall({ messages });
    expect(res.directiveType).toBe("COVER_STAGE");
    const text = res.content.toLowerCase();
    // La primera etapa habla de la forma de trabajar / cuentas de Instagram; NO de "tu parte".
    expect(text.includes("forma de trabajar") || text.includes("cuentas de instagram")).toBe(true);
  });

  it("con respuesta del bot ENTRE medias, cada 'vale' sí avanza (comportamiento normal intacto)", async () => {
    const messages: CallChatMessage[] = [
      { role: "system", content: "p" },
      { role: "assistant", content: "apertura..." },
      { role: "user", content: "vale" },
      { role: "assistant", content: "Vale, primero te cuento cómo trabajamos: cuentas de Instagram españolas..." },
      { role: "user", content: "vale" }
    ];
    const res = await respondToCall({ messages });
    // Ya cubrió la 1ª etapa (el bot habló), así que ahora avanza a la 2ª ("tu parte").
    expect(res.directiveType).toBe("COVER_STAGE");
    expect(res.content.toLowerCase()).toContain("tu parte");
  });

  it("SEGURIDAD intacta: 'tengo' + '16' en dos turnos seguidos se funde y sigue cortando por menor", async () => {
    const messages: CallChatMessage[] = [
      { role: "system", content: "p" },
      { role: "assistant", content: "apertura..." },
      { role: "user", content: "es que tengo" },
      { role: "user", content: "16 años" }
    ];
    const res = await respondToCall({ messages });
    expect(res.directiveType).toBe("CLOSE_UNDERAGE");
    expect(res.content.toLowerCase()).toContain("mayores de edad");
  });

  it("la candidata HABLA PRIMERO ('Sí' al descolgar) -> el guion NO se salta la 1ª etapa", async () => {
    // Caso REAL de la llamada de Alex: descolgó diciendo "Sí", el bot abrió, ella dijo "Ya", y el bot
    // saltó a la etapa 2. La apertura fue la respuesta a su "Sí", no una etapa.
    const messages: CallChatMessage[] = [
      { role: "system", content: "p" },
      { role: "user", content: "Sí" },
      { role: "assistant", content: "Hola Ana, soy Alex... ¿te pillo bien?" },
      { role: "user", content: "Ya" }
    ];
    const res = await respondToCall({ messages });
    expect(res.directiveType).toBe("COVER_STAGE");
    const text = res.content.toLowerCase();
    expect(text.includes("forma de trabajar") || text.includes("cuentas de instagram")).toBe(true);
    expect(text).not.toContain("tu parte");
  });

  it("SEGURIDAD: 'tengo 16' AL DESCOLGAR (antes de la apertura) sigue cortando por menor", async () => {
    const messages: CallChatMessage[] = [
      { role: "system", content: "p" },
      { role: "user", content: "hola tengo 16 años" },
      { role: "assistant", content: "Hola, soy Alex..." },
      { role: "user", content: "vale" }
    ];
    const res = await respondToCall({ messages });
    expect(res.directiveType).toBe("CLOSE_UNDERAGE");
    expect(res.content.toLowerCase()).toContain("mayores de edad");
  });

  it("SEGURIDAD (inv. 4): 'quiero hablar con una persona' AL DESCOLGAR -> handoff pegajoso, no el pitch", async () => {
    const messages: CallChatMessage[] = [
      { role: "system", content: "p" },
      { role: "user", content: "quiero hablar con una persona real" },
      { role: "assistant", content: "..." },
      { role: "user", content: "vale" }
    ];
    const res = await respondToCall({ messages });
    expect(res.directiveType).toBe("HANDOFF_TO_ALEX");
    // El handoff ocurrió en su PRIMER turno (replay); este turno vivo recibe la variante de repetición.
    expect(res.content.toLowerCase()).toMatch(/socio|le he avisado|contacto contigo/);
  });

  it("SEGURIDAD (inv. 4): hostilidad AL DESCOLGAR -> handoff, no la apertura del pitch", async () => {
    const messages: CallChatMessage[] = [
      { role: "system", content: "p" },
      { role: "user", content: "sois unos estafadores de mierda" },
      { role: "assistant", content: "..." },
      { role: "user", content: "que quieres" }
    ];
    const res = await respondToCall({ messages });
    expect(res.directiveType).toBe("HANDOFF_TO_ALEX");
  });

  it("el gate de MENOR no se toca: hostilidad DESPUÉS del corte por menor sigue repitiendo el corte", async () => {
    const messages: CallChatMessage[] = [
      { role: "system", content: "p" },
      { role: "assistant", content: "apertura..." },
      { role: "user", content: "tengo 16" },
      { role: "assistant", content: "solo mayores de edad..." },
      { role: "user", content: "sois unos bordes de mierda" }
    ];
    const res = await respondToCall({ messages });
    expect(res.directiveType).toBe("CLOSE_UNDERAGE");
    expect(res.content.toLowerCase()).not.toContain("socio");
  });

  it("una pregunta partida en dos turnos se responde entera ('¿qué significa' + 'se liquida?')", async () => {
    const messages: CallChatMessage[] = [
      { role: "system", content: "p" },
      { role: "assistant", content: "apertura..." },
      { role: "user", content: "vale" },
      {
        role: "assistant",
        content: "El reparto es 30% para ti y 70% para la agencia; cobras cada 14 días, se liquida quincenal."
      },
      { role: "user", content: "¿qué significa" },
      { role: "user", content: "se liquida?" }
    ];
    const res = await respondToCall({ messages });
    expect(res.directiveType).toBe("CLARIFY_LAST_UTTERANCE");
    expect(res.content.toLowerCase()).not.toContain("socio");
  });
});
