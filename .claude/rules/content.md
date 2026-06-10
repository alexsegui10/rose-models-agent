---
paths:
  - "src/content/**/*"
---

# Reglas de la capa content (conocimiento de negocio, estilo, ejemplos)

- Todo el contenido de cara a candidatas/Alex va en español.
- Las `KnowledgeEntry` son versionadas y con estado: solo `ACTIVE` + aprobadas se usan en
  producción. Lo dudoso o legal-pendiente queda en `DRAFT` / `DRAFT_LEGAL_REVIEW_REQUIRED`.
- Nunca inventes políticas de negocio: si Alex no la ha confirmado, la entrada nace como `DRAFT`
  y la pregunta se escala a revisión humana.
- Política comercial: 70/30 (Rose Models/modelo) solo si preguntan la cifra; niveles 65%/60% solo
  para voz futura, jamás por chat. No cambiar porcentajes sin instrucción explícita de Alex.
- Ejemplos de conversación: anónimos, sin datos personales reales, validados con Zod, con
  `approval` y calidad. Los marcados `EVALUATION_ONLY` no se usan como contexto de generación.
- Los golden tests (`golden/`) evalúan comportamiento, datos, factualidad y transiciones — nunca
  coincidencia textual exacta.
- Nunca contraseñas, handles reales de Instagram ni teléfonos reales en ejemplos o prompts.
