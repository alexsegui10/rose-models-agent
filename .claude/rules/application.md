---
paths:
  - "src/application/**/*"
---

# Reglas de la capa application

- Puede importar de `domain/` y `content/`. Prohibido importar de `app/` o de implementaciones
  concretas de `infrastructure/` (usa las interfaces de `repositories/types.ts`).
- El SDK de OpenAI solo se toca dentro del adaptador (`openaiProvider.ts`). El resto del código usa
  los contratos `ConversationUnderstandingProvider` / `ResponseDraftingProvider`.
- Toda operación con LLM necesita fallback determinista y metadatos de traza honestos
  (requestedProvider/actualProvider, usedFallback, motivo, tokens, coste). Nunca presentar una
  respuesta determinista como si viniera de OpenAI.
- La salida del modelo NUNCA muta estado directamente: se valida con Zod y la aplicación decide
  qué cambios aplicar (ver patrón en `conversationEngine.ts`).
- El pipeline del motor (16 pasos) mantiene su orden: idempotencia → debounce → comprensión →
  consistencia → conocimiento → plan → estilo → redacción → validación factual/estilo → control
  manual → persistencia → transiciones. Si insertas un paso, documenta dónde y por qué en ARCHITECTURE.md.
- Respuestas con datos no autorizados en el `ResponsePlan` deben fallar la validación factual:
  una reescritura segura como máximo y después fallback factual seguro.
- Cambios de comportamiento del motor requieren test en `tests/conversationEngine.test.ts` u
  `operationalSafety.test.ts` ANTES de implementar.
