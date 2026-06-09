export const promptRegistry = {
  understanding: {
    id: "rose-understanding",
    version: "understanding-2026-06-08.1",
    purpose: "Clasificar intencion, extraer datos y detectar riesgos sin decidir negocio."
  },
  drafting: {
    id: "rose-drafting",
    version: "drafting-2026-06-08.1",
    purpose: "Redactar la respuesta final usando ResponsePlan, estilo y ejemplos recuperados."
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
    version: "factual-validation-2026-06-08.1",
    purpose: "Comprobar que la respuesta no contradice conocimiento oficial ni politicas."
  }
} as const;

export type PromptRegistry = typeof promptRegistry;

