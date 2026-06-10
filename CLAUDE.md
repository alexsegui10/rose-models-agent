# rose-models-agent

Núcleo conversacional local para Rose Models (agencia de modelos). Simula mensajes de Instagram
para cualificar candidatas. La IA solo entiende mensajes, extrae datos y redacta respuestas; las
reglas de negocio (estados, acciones, pausas) son SIEMPRE deterministas y las decide código, no el modelo.
Alex (el dueño) toma las decisiones humanas desde la UI del simulador.

## Comandos

- `npm run dev` — servidor Next.js de desarrollo
- `npm run typecheck` — `tsc --noEmit` (debe pasar antes de dar nada por terminado)
- `npm test` — Vitest (`tests/**/*.test.ts`); 110+ tests, deben estar SIEMPRE en verde
- `npm run lint` — ESLint
- `npm run build` — build de producción

## Arquitectura (resumen — detalle en ARCHITECTURE.md)

Clean architecture estricta. La dirección de dependencias es: `app → application → domain`.

- `src/domain/` — entidades Zod (Candidate, ConversationMessage, StateTransition) y máquina de
  estados de 12 estados. Puro: sin I/O, sin imports de otras capas.
- `src/application/` — motor conversacional (`conversationEngine.ts`, pipeline de 16 pasos),
  proveedores LLM intercambiables (OpenAI o determinista) con fallback determinista obligatorio.
- `src/content/` — conocimiento de negocio versionado (entradas ACTIVE/DRAFT/DEPRECATED), perfil
  de estilo de Alex, ejemplos de conversación y golden tests. Contenido en español.
- `src/infrastructure/` — repositorios (in-memory en el MVP; schema Drizzle/Postgres definido pero
  sin conectar todavía) y contratos de integraciones futuras (sin implementar).
- `src/app/` — Next.js App Router. `page.tsx` es la UI del simulador; rutas API en `src/app/api/`.
- `src/server/simulatorStore.ts` — estado compartido del simulador para las rutas API.

Docs de referencia: `ARCHITECTURE.md`, `BUSINESS_KNOWLEDGE.md`, `PROJECT_PLAN.md`, `STYLE_SYSTEM.md`.

## Invariantes innegociables

1. La IA nunca controla el flujo: transiciones de estado, aprobaciones y porcentajes los decide
   código determinista, jamás la salida del modelo.
2. Edad < 18 → CLOSED. Edad dudosa → no se avanza a revisión humana.
3. El agente nunca menciona porcentajes de reparto de forma proactiva; solo responde la política
   activa (70/30) si la candidata pregunta la cifra exacta. Negociación → revisión humana.
4. Toda salida de `HUMAN_INTERVENTION_REQUIRED` requiere decisión humana explícita.
5. Nunca guardar contraseñas ni secretos en prompts, logs, ejemplos o conversaciones.
6. Toda llamada a OpenAI tiene fallback determinista, y los metadatos de traza nunca mienten
   sobre el proveedor/modelo real usado.
7. Las claves API viven en `.env.local` (gitignorado). NUNCA en `.env.example` ni en código.

## Forma de trabajar

- TDD siempre que sea razonable: test primero en `tests/`, luego implementación. Los golden tests
  de comportamiento van en `src/content/golden/` (evalúan comportamiento, no texto exacto).
- Antes de dar una tarea por terminada: `npm run typecheck` y `npm test` en verde (hay un hook
  Stop que lo verifica automáticamente).
- Convenciones: código e identificadores en inglés; contenido de negocio, docs y strings de cara
  a Alex en español. Prettier: `semi: true`, comillas dobles, sin trailing comma.
- Reglas específicas por capa en `.claude/rules/` (se cargan solas al tocar cada capa).
- No commitear ni pushear sin que Alex lo pida. Rama actual: `master`.
- Si cambias el modelo de datos de `Candidate`, revisa la normalización en
  `inMemoryCandidateRepository.ts` y el schema Drizzle para que no diverjan.
