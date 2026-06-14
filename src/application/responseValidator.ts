import type { Candidate } from "@/domain/candidate";

// La validacion de porcentajes (rechazar cifras fuera de la politica 70/30) vive en factualValidator,
// que conoce la excepcion 70/30. Aqui solo se filtran promesas/datos sensibles que nunca son validos.
const forbiddenPatterns = [
  /ingresos garantizados/i,
  /ganancias garantizadas/i,
  /maquina de estados/i,
  /máquina de estados/i,
  /prompt/i,
  /instrucciones internas/i
];

export interface ResponseValidationResult {
  valid: boolean;
  reasons: string[];
}

export function validateAgentResponse(response: string, candidate: Candidate): ResponseValidationResult {
  const reasons: string[] = [];

  if (response.length > 520) {
    reasons.push("La respuesta es demasiado larga.");
  }

  for (const pattern of forbiddenPatterns) {
    if (pattern.test(response)) {
      reasons.push("La respuesta contiene informacion prohibida o sensible.");
    }
  }

  if (candidate.humanProfileReviewStatus === "NOT_REVIEWED" && /hemos revisado tu perfil/i.test(response)) {
    reasons.push("La respuesta afirma revision de perfil sin confirmacion.");
  }

  const questionCount = (response.match(/\?/g) ?? []).length;
  if (questionCount > 2) {
    reasons.push("La respuesta contiene demasiadas preguntas.");
  }

  return {
    valid: reasons.length === 0,
    reasons
  };
}

// Registro de Alex (no atencion al cliente): corto, informal, derivando honestamente al socio.
// El "Gracias por escribirme. Lo reviso un momento y te contesto con calma." anterior rompia el
// registro y no contestaba nada (taxonomia nº7 iteracion 2, r5 T3).
export function safeFallbackResponse(): string {
  return "Vale, dejame que lo hable con mi socio y te digo.";
}
