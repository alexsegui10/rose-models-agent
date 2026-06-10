---
paths:
  - "src/app/**/*"
---

# Reglas de la capa app (UI + rutas API)

- Las rutas API (`src/app/api/`) son finas: parsean/validan input con Zod, llaman a `application/`
  vía `simulatorStore`, devuelven JSON. Sin lógica de negocio en las rutas.
- Errores: devolver códigos HTTP correctos y mensajes útiles para la UI; nunca filtrar stack
  traces ni datos sensibles (claves, prompts internos).
- `page.tsx` es grande y monolítico (deuda conocida). Al tocarlo: no añadir más estado global
  innecesario; extraer componentes/helpers cuando el cambio lo permita (p. ej. a
  `src/application/candidatePanelRows.ts` ya se extrajo lógica de presentación).
- La UI muestra trazabilidad completa de cada respuesta (plan, conocimiento, ejemplos,
  evaluaciones, proveedor/modelo real, fallback): si añades campos al pipeline, exponlos también aquí.
- Texto de la UI en español.
