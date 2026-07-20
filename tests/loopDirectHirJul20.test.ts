import { describe, expect, it } from "vitest";
import { ConversationEngine } from "@/application/conversationEngine";
import { DeterministicUnderstandingProvider } from "@/application/dataExtractor";
import { LocalBusinessKnowledgeRetriever } from "@/application/businessKnowledgeRetriever";
import { LocalExampleRetriever } from "@/application/exampleRetriever";
import { InMemoryCandidateRepository } from "@/infrastructure/repositories/inMemoryCandidateRepository";

// /loop iteracion 2 (barrido, caso Rocio "inspectora de AFIP"): entra en HIR DIRECTO por desconfianza (sin
// pasar por el pitch/socio), pide una y otra vez "el nombre legal / la web / el cuit" (datos que el bot no
// tiene) y el bot rotaba fichas ajenas (transparencia, edicion) y hasta soltaba un "Perfecto" pelado a una
// exigencia de datos. La red de seguridad antes solo contaba respuestas TRAS un ancla de socio (que aqui no
// existe) -> substantiveAnswers=0 y nunca disparaba. Ahora cuenta desde el principio en HIR-directo y escala
// limpio ("lo hablo con mi socio") en vez de rotar fichas o responder "Perfecto".

function mk() {
  const repository = new InMemoryCandidateRepository();
  const engine = new ConversationEngine({
    repository,
    understandingProvider: new DeterministicUnderstandingProvider(),
    businessKnowledgeRetriever: new LocalBusinessKnowledgeRetriever(),
    exampleRetriever: new LocalExampleRetriever(),
    automationMode: "AUTOMATIC"
  });
  return { engine };
}

const DEMANDS = [
  "hola quien sos vos? como se que no me van a estafar",
  "esto es legal? pasame la web y el nombre legal de la empresa",
  "y por que te voy a creer, cualquier chanta escribe diciendo que es agencia",
  "el nombre legal de la empresa cual es, tienen cuit, estan inscriptos?",
  "de ustedes no me das nada concreto, pasame el nombre legal y la web",
  "seguis sin pasarme el nombre legal ni la web, dale",
  "pasame algo que pueda googlear: la web, el nombre real, lo que sea"
];

describe("HIR directo (desconfianza): exigencias repetidas de datos que no hay -> holding limpio, no rotacion", () => {
  it("las exigencias repetidas de 'nombre legal/web' NO reciben fichas ajenas ni un 'Perfecto' pelado", async () => {
    const { engine } = mk();
    const u = "rocio_" + Math.random().toString().slice(2, 6);
    const responses: string[] = [];
    let first = true;
    for (const m of DEMANDS) {
      const r = await engine.handleIncomingTurn(
        first
          ? { instagramUsername: u, profileVisibility: "PUBLIC", messages: [{ content: m }] }
          : { instagramUsername: u, messages: [{ content: m }] }
      );
      first = false;
      responses.push(r.response);
    }
    // De la mitad en adelante (ya insistiendo con datos que no hay), NINGUNA respuesta debe:
    const later = responses.slice(3);
    for (const resp of later) {
      // (a) ser un "Perfecto" pelado (el bug real del barrido)
      expect(resp.trim()).not.toBe("Perfecto");
      // (b) soltar fichas operativas ajenas a lo que pide (edicion, "en crudo", seguidores/pinterest, lanzamiento)
      expect(resp.toLowerCase()).not.toMatch(
        /en crudo|de la edicion|pinterest|5\.?000|20\.?000 seguidores|lanzamiento suele ser/
      );
    }
    // Y al menos una de las ultimas debe ser un holding limpio (deriva al socio) o visto.
    const anyHolding = later.some((r) => r.trim() === "" || /socio|te digo|lo veo|revis/i.test(r));
    expect(anyHolding, `respuestas: ${JSON.stringify(later)}`).toBe(true);
  });
});
