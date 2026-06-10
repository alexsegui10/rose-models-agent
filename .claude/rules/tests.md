---
paths:
  - "tests/**/*"
  - "vitest.config.ts"
---

# Reglas de tests

- Framework: Vitest (`tests/**/*.test.ts`, entorno node, alias `@` → `src/`).
- Los tests corren SIEMPRE en modo determinista: nunca llamar a OpenAI real ni depender de
  `OPENAI_API_KEY`. Si un test necesita un proveedor, inyectar uno fake por las interfaces.
- Tests de comportamiento, no de implementación: dado un mensaje entrante → estado resultante,
  datos extraídos, escalado a humano, respuesta dentro del plan factual.
- Seguridad SIEMPRE testeada: menores → CLOSED, porcentajes no proactivos, prompt injection →
  intervención humana, control manual bloquea envío. No borrar ni debilitar estos tests.
- Cada bug que se arregle deja un test de regresión que falle sin el fix.
- No usar `test.skip`/`test.only` en commits; si un test queda pendiente, TODO con fecha y motivo.
