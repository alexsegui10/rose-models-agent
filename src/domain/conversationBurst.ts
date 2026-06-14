// Reparte una respuesta del agente en la RAFAGA de mensajes que enviaria Alex de verdad: cada "beat"
// (bloque separado por una linea en blanco) es un mensaje aparte. El numero de mensajes varia SOLO
// segun el contenido — 1 para una pregunta suelta, 2 para "Te entiendo" + pregunta, 3 para el opener o
// el pitch — asi que es natural y sin patron fijo (peticion de Alex: nunca un patron, ni siempre muchos
// mensajes). Helper puro y compartido: lo usa el simulador para pintar burbujas y, en el futuro, el
// envio real a Instagram para mandar varios DMs.
export function splitIntoMessageBurst(response: string): string[] {
  const chunks = response
    .split(/\n{2,}/)
    .map((chunk) => chunk.trim())
    .filter((chunk) => chunk.length > 0);
  // Si no hay beats (respuesta de una sola pieza), es un unico mensaje; nunca devolvemos vacio.
  return chunks.length > 0 ? chunks : [response.trim()].filter((chunk) => chunk.length > 0);
}
