import { describe, expect, it } from "vitest";
import { ConversationEngine } from "@/application/conversationEngine";
import { DeterministicUnderstandingProvider } from "@/application/dataExtractor";
import { InMemoryCandidateRepository } from "@/infrastructure/repositories/inMemoryCandidateRepository";

// Regresión (auditoría E2E 15-jul): a una candidata con móvil NO válido, tras explicarle una vez que con ese
// móvil no se puede, el bot repetía el rechazo en bucle ante acuses monosilábicos ("dale", "ok") — hasta 5
// veces la misma plantilla, alternando corta/larga cuando el aviso salía de la ventana de 8. Debe avisar UNA
// vez y luego quedarse en visto ante acuses (sin nada que responder), como la pausa del socio.

function createEngine() {
  const repository = new InMemoryCandidateRepository();
  const engine = new ConversationEngine({
    repository,
    understandingProvider: new DeterministicUnderstandingProvider()
  });
  return { engine, repository };
}

const DEVICE_TEMPLATE =
  /con ese movil no podemos|lamentablemente|cambiarte el movil|movil mejor lo retomamos|calidad de (?:las )?fotos|movil lo tendriamos que valorar/i;

describe("no repetir el rechazo del móvil en bucle (auditoría 15-jul)", () => {
  it("tras avisar del móvil una vez, los acuses quedan en visto (no re-emite el rechazo)", async () => {
    const { engine } = createEngine();
    const username = "device_loop";
    const opener = await engine.handleIncomingMessage({
      instagramUsername: username,
      profileVisibility: "PUBLIC",
      message: "hola"
    });
    const id = opener.candidate.id;
    await engine.handleIncomingMessage({ candidateId: id, instagramUsername: username, message: "me llamo carla" });
    await engine.handleIncomingMessage({ candidateId: id, instagramUsername: username, message: "tengo 41" });
    const device = await engine.handleIncomingMessage({
      candidateId: id,
      instagramUsername: username,
      message: "tengo un samsung galaxy a10 viejo"
    });
    // Debe reconocer que el móvil no sirve (rechazo la 1a vez).
    expect(device.candidate.deviceEligibility).toBe("NOT_ELIGIBLE");
    expect(device.response.toLowerCase()).toMatch(DEVICE_TEMPLATE);

    // Acuses monosilábicos: tras el aviso, NINGUNO re-emite el rechazo y quedan en VISTO (respuesta vacía).
    for (const msg of ["dale", "ok", "aja", "bueno", "si", "dale", "ok", "aja", "si", "bueno"]) {
      const r = await engine.handleIncomingMessage({ candidateId: id, instagramUsername: username, message: msg });
      expect(r.response.toLowerCase(), `acuse "${msg}" re-emitió el rechazo del móvil`).not.toMatch(DEVICE_TEMPLATE);
      expect(r.response.trim(), `acuse "${msg}" no quedó en visto`).toBe("");
    }
  });
});
