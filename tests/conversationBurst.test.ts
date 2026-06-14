import { describe, expect, it } from "vitest";
import { splitIntoMessageBurst } from "@/domain/conversationBurst";

// Decision de Alex (14-jun): el bot manda varios mensajes pero SIN patron fijo — 1, 2 o 3 segun la
// respuesta, natural. La rafaga se reparte por los beats (lineas en blanco) del contenido.

describe("splitIntoMessageBurst", () => {
  it("una pregunta suelta es un solo mensaje", () => {
    expect(splitIntoMessageBurst("Que edad tienes?")).toEqual(["Que edad tienes?"]);
  });

  it("'Te entiendo' + pregunta son dos mensajes", () => {
    expect(splitIntoMessageBurst("Te entiendo\n\nHas trabajado alguna vez con otras agencias?")).toEqual([
      "Te entiendo",
      "Has trabajado alguna vez con otras agencias?"
    ]);
  });

  it("el opener de tres beats son tres mensajes", () => {
    const opener =
      "Hola, buenas tardes soy Alex de Rose Models.\n\nHemos visto tu perfil y creemos que encajas.\n\nSi te parece bien te hago unas preguntas.";
    expect(splitIntoMessageBurst(opener)).toHaveLength(3);
  });

  it("ignora lineas en blanco extra y espacios, sin devolver vacios", () => {
    expect(splitIntoMessageBurst("Perfecto\n\n\n  \n\nQue movil tienes?")).toEqual(["Perfecto", "Que movil tienes?"]);
  });

  it("una sola linea con salto simple no se parte (es un mismo beat)", () => {
    expect(splitIntoMessageBurst("Vale pues\nY que movil tienes?")).toEqual(["Vale pues\nY que movil tienes?"]);
  });
});
