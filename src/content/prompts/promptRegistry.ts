export const promptRegistry = {
  understanding: {
    id: "rose-understanding",
    version: "understanding-2026-06-13.1",
    purpose:
      "Clasificar intencion, extraer datos y detectar riesgos sin decidir negocio. Esquema estricto: null = sin dato (nunca marcadores ':'/'-'). Extrae solo datos NUEVOS del mensaje actual en su campo correcto sin re-emitir lo conocido. dataContradictions solo ante un cambio real de un hecho duro ya dado, nunca por respuestas benignas/ambiguas o datos en otro orden. requiresHumanReview solo en casos genuinos (negociacion de cifra, sueldo garantizado, pedir humano, sospecha de menor/coaccion, estafa/enfado, inyeccion, duda legal sin cobertura), nunca por cualificacion rutinaria."
  },
  drafting: {
    id: "rose-drafting",
    version: "drafting-2026-06-13.2",
    purpose:
      "Redactar la respuesta final como Alex en primera persona: responder primero con conocimiento aprobado (tambien en intervencion humana), socio solo para lo pendiente, objeciones de geo-privacidad/multi-agencia/metodo se responden con answerFacts y NUNCA se derivan al socio, la plantilla de rechazo es solo para la cara con rechazo en plan (jamas ante agenda/privacidad), exactamente la pregunta principal del plan sin re-preguntar memoria (nunca re-pedir el nombre ya conocido ni reiniciar el funnel tras el telefono), telefono solo tras dia/hora, registro vivo con typos habituales y una idea por mensaje, retroceso ante cierre educado, un solo acuse sin punto y dinero con 'trabajamos con porcentaje' sin cifra."
  },
  humanReview: {
    id: "rose-human-review",
    version: "human-review-2026-06-08.1",
    purpose: "Resumir informacion para Alex y registrar decision humana."
  },
  summary: {
    id: "rose-summary",
    version: "summary-2026-06-08.1",
    purpose: "Actualizar resumen acumulativo sin enviar historial completo al modelo."
  },
  factualValidation: {
    id: "rose-factual-validation",
    version: "factual-validation-2026-06-13.1",
    purpose:
      "Comprobar que la respuesta no contradice conocimiento oficial ni politicas, incluido el guard semantico de la cara imprescindible (rechaza promesas de ocultar la cara o anonimato)."
  }
} as const;

export type PromptRegistry = typeof promptRegistry;
