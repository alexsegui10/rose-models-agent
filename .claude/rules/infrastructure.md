---
paths:
  - "src/infrastructure/**/*"
  - "src/server/**/*"
---

# Reglas de infrastructure / server

- Implementa interfaces definidas en `repositories/types.ts`; sin lógica de negocio aquí.
- El MVP usa `inMemoryCandidateRepository`. La normalización-al-leer que hace (campos legacy,
  `onboardingBlockers`) es deuda consciente: cuando se conecte Postgres, esa lógica debe migrar a
  migraciones/schema, no duplicarse.
- El schema Drizzle (`db/schema.ts`) debe mantenerse en sincronía con los schemas Zod de
  `src/domain/`. Si cambias uno, revisa el otro en el mismo cambio.
- `integrations/futureProviders.ts` son SOLO contratos (Instagram, WhatsApp, calendario, voz,
  contratos): no implementar integraciones reales sin que Alex lo pida explícitamente.
- `simulatorStore.ts` es estado de proceso compartido entre rutas API: cuidado con la concurrencia;
  los contratos de turno (idempotencia, debounce, cancelación) viven en `turnContracts.ts`.
