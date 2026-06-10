---
paths:
  - "src/domain/**/*"
---

# Reglas de la capa domain

- Capa PURA: prohibido importar de `application/`, `infrastructure/`, `app/`, `server/` o `content/`.
  Solo Zod y otros módulos de `domain/`.
- Sin I/O, sin `process.env`, sin `fetch`, sin fechas implícitas (`new Date()` solo donde ya existe el patrón).
- Toda entidad nueva se define como schema Zod + tipo inferido (`z.infer`), siguiendo `candidate.ts`.
- Las transiciones de estado SOLO se definen/validan en `stateMachine.ts`. No dupliques el grafo de
  transiciones en ningún otro sitio. Toda transición nueva necesita test en `tests/stateMachine.test.ts`.
- Si añades campos a `Candidate`: deben ser opcionales o tener default (hay datos legacy que se
  normalizan al leer), y hay que actualizar la normalización del repositorio y el schema Drizzle.
- Las salidas de `HUMAN_INTERVENTION_REQUIRED` solo por decisión humana explícita — no añadas
  triggers automáticos que salgan de ese estado.
