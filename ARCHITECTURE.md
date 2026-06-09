# Arquitectura

## Vision general

El sistema es un nucleo conversacional local para Rose Models. La interfaz simula mensajes de Instagram y permite a Alex revisar candidatas, ver la memoria extraida y tomar decisiones humanas.

La IA no controla el flujo. El modelo, cuando se conecte, solo ayudara a entender mensajes, extraer datos, clasificar intenciones y redactar respuestas. Las reglas de negocio determinan estados, acciones permitidas y pausas.

## Arbol de carpetas

```text
src/
  app/
    api/
      candidates/
      simulator/
    globals.css
    layout.tsx
    page.tsx
  application/
    businessKnowledgeRetriever.ts
    conversationEngine.ts
    dataExtractor.ts
    dataConsistency.ts
    exampleRetriever.ts
    factualValidator.ts
    fineTuningExport.ts
    promptRegistry.ts
    responsePlanner.ts
    responseFeedback.ts
    humanReview.ts
    llmProvider.ts
    responseValidator.ts
    styleContextBuilder.ts
    styleEvaluator.ts
    turnContracts.ts
  content/
    business/
      agency-profile.ts
      call-policy.ts
      candidate-requirements.ts
      commercial-policy.ts
      content-responsibilities.ts
      contract-policy.ts
      escalation-policy.ts
      follow-up-policy.ts
      frequently-asked-questions.ts
      objection-handling.ts
      services-policy.ts
      index.ts
    golden/
      goldenConversationTests.ts
    prompts/
    examples/
      conversationExamples.ts
    style/
      alex-style-profile.ts
  domain/
    businessKnowledge.ts
    candidate.ts
    conversationExample.ts
    styleEvaluation.ts
    stateMachine.ts
  infrastructure/
    db/
      schema.ts
    integrations/
      futureProviders.ts
    repositories/
      inMemoryCandidateRepository.ts
      types.ts
  server/
    simulatorStore.ts
tests/
  conversationEngine.test.ts
```

## Modelo de datos inicial

### Candidate

Campos principales:

- `id`
- `instagramUsername`
- `displayName`
- `firstName`
- `age`
- `isAdultConfirmed`
- `country`
- `city`
- `phone`
- `deviceType`
- `deviceModel`
- `deviceEligibility`
- `commercialTier`
- `declaredProfileVisibility`
- `candidateClaimsFollowRequestAccepted`
- `humanVerifiedProfileAccess`
- `humanProfileReviewStatus`
- `humanFitDecision`
- `onboardingBlockers`
- `hasOnlyFans`
- `worksWithAnotherAgency`
- `experienceDescription`
- `currentMonthlyRevenue`
- `contentAvailability`
- `goals`
- `interestLevel`
- `objections`
- `notes`
- `conversationSummary`
- `currentState`
- `humanReviewStatus`
- `humanReviewReason`
- `automationPaused`
- `manualControlActive`
- `generationCancellationVersion`
- `createdAt`
- `updatedAt`
- `lastMessageAt`

Los datos son opcionales salvo identificadores, estado y fechas. La memoria se actualiza de forma incremental.

### ConversationMessage

Guarda cada mensaje con:

- `id`
- `candidateId`
- `role`
- `author`
- `content`
- `externalMessageId`
- `createdAt`
- `metadata`

Autores diferenciados:

- `CANDIDATE`
- `AI_AGENT`
- `ALEX`
- `TEAM_MEMBER`
- `SYSTEM`

### StateTransition

Registra cada cambio con:

- `id`
- `candidateId`
- `fromState`
- `toState`
- `trigger`
- `reason`
- `createdAt`

## Estados

Estados definidos:

- `NEW_LEAD`
- `WAITING_PROFILE_ACCESS`
- `PROFILE_READY_FOR_REVIEW`
- `QUALIFYING`
- `WAITING_HUMAN_REVIEW`
- `APPROVED`
- `REJECTED`
- `COLLECTING_CALL_DETAILS`
- `READY_TO_SCHEDULE`
- `CALL_SCHEDULED`
- `HUMAN_INTERVENTION_REQUIRED`
- `CLOSED`

## Transiciones iniciales

```text
NEW_LEAD -> WAITING_PROFILE_ACCESS
NEW_LEAD -> PROFILE_READY_FOR_REVIEW
NEW_LEAD -> QUALIFYING
NEW_LEAD -> HUMAN_INTERVENTION_REQUIRED
NEW_LEAD -> CLOSED

WAITING_PROFILE_ACCESS -> PROFILE_READY_FOR_REVIEW
WAITING_PROFILE_ACCESS -> QUALIFYING
WAITING_PROFILE_ACCESS -> HUMAN_INTERVENTION_REQUIRED
WAITING_PROFILE_ACCESS -> CLOSED

PROFILE_READY_FOR_REVIEW -> QUALIFYING
PROFILE_READY_FOR_REVIEW -> WAITING_HUMAN_REVIEW
PROFILE_READY_FOR_REVIEW -> HUMAN_INTERVENTION_REQUIRED
PROFILE_READY_FOR_REVIEW -> CLOSED

QUALIFYING -> PROFILE_READY_FOR_REVIEW
QUALIFYING -> WAITING_HUMAN_REVIEW
QUALIFYING -> HUMAN_INTERVENTION_REQUIRED
QUALIFYING -> CLOSED

WAITING_HUMAN_REVIEW -> APPROVED
WAITING_HUMAN_REVIEW -> REJECTED
WAITING_HUMAN_REVIEW -> QUALIFYING
WAITING_HUMAN_REVIEW -> HUMAN_INTERVENTION_REQUIRED
WAITING_HUMAN_REVIEW -> CLOSED

APPROVED -> COLLECTING_CALL_DETAILS
APPROVED -> READY_TO_SCHEDULE
APPROVED -> HUMAN_INTERVENTION_REQUIRED
APPROVED -> CLOSED

REJECTED -> CLOSED
REJECTED -> HUMAN_INTERVENTION_REQUIRED

COLLECTING_CALL_DETAILS -> READY_TO_SCHEDULE
COLLECTING_CALL_DETAILS -> CALL_SCHEDULED
COLLECTING_CALL_DETAILS -> HUMAN_INTERVENTION_REQUIRED
COLLECTING_CALL_DETAILS -> CLOSED

READY_TO_SCHEDULE -> CALL_SCHEDULED
READY_TO_SCHEDULE -> COLLECTING_CALL_DETAILS
READY_TO_SCHEDULE -> HUMAN_INTERVENTION_REQUIRED
READY_TO_SCHEDULE -> CLOSED

CALL_SCHEDULED -> COLLECTING_CALL_DETAILS
CALL_SCHEDULED -> READY_TO_SCHEDULE
CALL_SCHEDULED -> HUMAN_INTERVENTION_REQUIRED
CALL_SCHEDULED -> CLOSED

HUMAN_INTERVENTION_REQUIRED -> WAITING_PROFILE_ACCESS
HUMAN_INTERVENTION_REQUIRED -> PROFILE_READY_FOR_REVIEW
HUMAN_INTERVENTION_REQUIRED -> QUALIFYING
HUMAN_INTERVENTION_REQUIRED -> WAITING_HUMAN_REVIEW
HUMAN_INTERVENTION_REQUIRED -> APPROVED
HUMAN_INTERVENTION_REQUIRED -> REJECTED
HUMAN_INTERVENTION_REQUIRED -> COLLECTING_CALL_DETAILS
HUMAN_INTERVENTION_REQUIRED -> READY_TO_SCHEDULE
HUMAN_INTERVENTION_REQUIRED -> CALL_SCHEDULED
HUMAN_INTERVENTION_REQUIRED -> CLOSED
```

Las transiciones se validan en `stateMachine.ts` y siempre generan historial.
Las salidas de `HUMAN_INTERVENTION_REQUIRED` solo se permiten por decision humana explicita.

## Motor conversacional

Para cada mensaje entrante:

1. Carga o crea candidata.
2. Comprueba idempotencia por `externalMessageId`.
3. Agrupa mensajes consecutivos con politica de debounce.
4. Guarda mensaje entrante y aumenta `generationCancellationVersion` para cancelar generaciones anteriores.
5. Clasifica intencion y extrae datos estructurados.
6. Aplica restricciones criticas y detecta contradicciones.
7. Recupera conocimiento oficial relevante.
8. Crea un `ResponsePlan` con hechos autorizados, claims permitidos, matices obligatorios y claims prohibidos.
9. Planifica transiciones sin persistirlas todavia.
10. Recupera ejemplos de estilo relevantes.
11. Construye contexto de estilo separado de los mensajes reales.
12. Genera respuesta breve usando solo hechos autorizados. En `LLM_MODE=OPENAI`, la redaccion la realiza el adaptador OpenAI; en modo determinista, la redaccion es local.
13. Valida factualidad y estilo. Si falla factualidad, se intenta una reescritura segura una sola vez y, si vuelve a fallar, se usa fallback factual seguro.
14. Comprueba que la automatizacion sigue activa y que no hay control manual.
15. Guarda mensaje del agente.
16. Aplica transiciones planificadas y registra metadatos de versiones.

El contrato `ConversationUnderstandingProvider` permite usar comprension determinista u OpenAI. El contrato `ResponseDraftingProvider` permite redaccion determinista u OpenAI.

## Sistema de estilo

El estilo vive en una capa propia para que el agente no se limite a contestar correctamente, sino que lo haga con una voz cercana a Alex.

Componentes:

- `StyleProfile`: perfil versionado con identidad, tono, forma de escribir, expresiones prohibidas y comportamientos deseados.
- `ConversationExample`: conversaciones ficticias o anonimizadas, validadas con Zod.
- `ExampleRetriever`: recuperador local que puntua ejemplos por estado, intencion, etiquetas, calidad y aprobacion.
- `StyleContextBuilder`: construye el contexto del modelo con delimitadores claros.
- `ResponseStyleEvaluator`: evalua si una respuesta es natural, breve, espanola y compatible con el perfil.
- `ConversationFeedback`: feedback de Alex sobre respuestas generadas.
- `ApprovedResponse`: respuesta aprobada o editada que puede convertirse en ejemplo futuro.
- `GoldenConversationTest`: evaluaciones independientes que no se usan como contexto de generacion.

La recuperacion inicial devuelve entre 3 y 6 ejemplos y evita ejemplos no aprobados, duplicados o marcados como `EVALUATION_ONLY`.

## Base de conocimiento

La base de conocimiento separa lo que Rose Models sabe y permite decir de la forma en que Alex lo redacta.

Componentes:

- `KnowledgeEntry`: entrada oficial versionada.
- `RevenueSharePolicy`: politica comercial con porcentajes explicitos o pendientes.
- `BusinessKnowledgeRetriever`: recuperacion local de politicas y FAQ.
- `ResponsePlan`: plan factual de respuesta que limita al redactor.
- `FactualResponseValidator`: validacion de porcentajes, promesas, servicios y contratos inventados.

Prioridad de fuentes:

1. Seguridad y cumplimiento.
2. Politicas oficiales activas.
3. Estado y memoria de la candidata.
4. Ejemplos aprobados.
5. Capacidad general del modelo.

Solo se usan entradas `ACTIVE` y aprobadas por Alex para responder. Entradas `DRAFT` o `DEPRECATED` quedan fuera de produccion.

`KnowledgeEntry` incluye hechos, puntos autorizados, afirmaciones prohibidas, matices obligatorios, condiciones de escalado y estados donde puede utilizarse.

## Politica Comercial

`RevenueSharePolicy` controla la comunicacion del reparto:

- el agente no menciona porcentaje de forma proactiva;
- puede explicar que no hay salario fijo y que se trabaja por reparto si la candidata pregunta;
- puede comunicar el reparto confirmado 70% Rose Models / 30% modelo si la candidata pregunta la cifra exacta;
- el calculo es sobre neto tras comision de plataforma;
- la plataforma paga a la modelo, Alex calcula liquidacion manual y la modelo paga a Rose Models por Skrill cada 14 dias desde el primer ingreso;
- no negocia por chat;
- una pregunta informativa general sobre porcentaje se responde si existe politica activa;
- cualquier negociacion, excepcion o informacion no cubierta crea revision humana con motivo especifico;
- una condicion personalizada solo puede comunicarse si existe `NegotiationDecision` humana aprobada.

## Dispositivos

`Candidate` guarda una sola fuente de verdad para dispositivo: `deviceType`, `deviceModel` y `deviceEligibility`.

Elegibilidad:

- `APPROVED`: iPhone 13 o superior; Samsung Galaxy S23, S24, S25 o superior.
- `PENDING_QUALITY_TEST`: iPhone anterior al 13, otros Samsung y otros moviles de gama alta.
- `PENDING_UPGRADE`: comprara dispositivo valido; puede hacerse llamada, no incorporacion.
- `NOT_ELIGIBLE`: movil de mala calidad.
- `UNKNOWN`: falta dato.

La revision humana y la llamada pueden avanzar con `PENDING_QUALITY_TEST` o `PENDING_UPGRADE`. La incorporacion operativa requiere resolver `onboardingBlockers` y tener dispositivo aprobado.

## Readiness De Cualificacion

`qualificationPolicy.ts` calcula:

- `readyForHumanReview`;
- `readyForCall`;
- `readyForOnboarding`;
- `missingRequiredFields`;
- `blockingReasons`.
- `onboardingBlockers`.

No se avanza a `WAITING_HUMAN_REVIEW` si falta mayoria de edad, perfil controlado, pais, situacion OF/agencia, disponibilidad, dato de dispositivo o si hay contradicciones graves.

`PENDING_UPGRADE` y `PENDING_QUALITY_TEST` no bloquean revision humana ni llamada, pero generan bloqueos de onboarding:

- `DEVICE_UPGRADE_REQUIRED`;
- `DEVICE_QUALITY_TEST_REQUIRED`;
- `IDENTITY_VERIFICATION_REQUIRED`;
- `CONTRACT_REQUIRED`.

## Contratos operativos

`turnContracts.ts` documenta contratos para:

- idempotencia por `externalMessageId`;
- agrupamiento de mensajes consecutivos mediante debounce;
- cola o bloqueo por candidata;
- control de concurrencia;
- cancelacion de generacion al recibir mensajes nuevos;
- comprobacion de control manual antes de enviar;
- prevencion de respuestas y transiciones duplicadas.

La implementacion local ya cubre idempotencia, debounce, version de cancelacion, control manual antes de enviar y prevencion basica de duplicados.

## Politicas Operativas Confirmadas

Las decisiones confirmadas por Alex se representan como entradas `KnowledgeEntry` y reglas puras en `policyRules.ts`:

- negociacion por niveles: `STANDARD` 70%, `HIGH_POTENTIAL` 65%, `EXCEPTIONAL` 60%, solo para voz futura y nunca por chat;
- impagos: recordatorio, 7 dias adicionales, suspension, posible finalizacion y reclamacion, sin derechos ilimitados de contenido;
- comunicacion: respuesta esperada en 48 horas, retraso aislado no descarta, retrasos repetidos escalan;
- contenido: calentamiento de 5 dias, 2-3 fotos diarias, objetivo orientativo 10-20 Reels semanales no contractual;
- cuenta y acceso: Instagram nuevo controlado por Rose Models, OnlyFans pertenece a la modelo, nunca guardar contrasenas en prompts/logs/ejemplos/conversaciones;
- llamada: WhatsApp, 2-10 minutos, sin recoger documentacion ni automatizar contrato;
- Retell: politica documentada de aviso y consentimiento, sin implementacion todavia;
- seguimiento: 2-3 intentos cada 1-2 dias, no insistencia indefinida.

Las clausulas de uso de contenido tras finalizacion sin preaviso quedan en `DRAFT_LEGAL_REVIEW_REQUIRED`.

## Prompts

`promptRegistry.ts` versiona prompts separados para:

- comprension;
- redaccion;
- revision humana;
- resumen;
- validacion factual.

## Generacion en dos pasos

### Paso 1: comprension

El proveedor de comprension devuelve intencion, datos extraidos, confianza, riesgos y posibles necesidades de revision humana.

### Paso 2: redaccion

La redaccion recibe el objetivo inmediato, el perfil de estilo y los ejemplos recuperados. No puede modificar estado, datos ni decisiones de negocio.

En `LLM_MODE=OPENAI`, el redactor OpenAI devuelve la respuesta y metadatos de traza validados. En `LLM_MODE=DETERMINISTIC` o si OpenAI falla, se usa redaccion local determinista. Nunca se presenta una respuesta determinista como si viniera de OpenAI: los metadatos guardan proveedor solicitado, proveedor real, modelo solicitado, modelo real, fallback, motivo, duracion, reintentos, tokens y coste estimado.

## Feedback y aprendizaje

Alex puede marcar una respuesta como:

- `APPROVED`
- `EDITED`
- `REJECTED`

Si se edita, se guarda respuesta original, respuesta corregida, motivo, estado, contexto, fecha, version del perfil, version del prompt y modelo. Las respuestas corregidas no pasan automaticamente a produccion.

## Golden tests

Los casos golden viven en `src/content/golden`, separados de estilo y de ejemplos de contexto. Evalua comportamiento, datos, factualidad, seguridad, memoria y transiciones, no coincidencia textual exacta.

## Exportacion futura para fine-tuning

`fineTuningExport.ts` prepara una salida futura a partir de ejemplos aprobados. Anonimiza datos personales, excluye menores y separa entrenamiento, validacion y evaluacion. No se conecta todavia a ninguna API.

## Reglas de seguridad iniciales

- Si la edad es menor de 18, se cierra el proceso.
- Si la edad no esta clara, no se avanza a revision.
- Si la candidata pide persona, contrato, negociacion, excepcion o informacion no cubierta, se pausa en `HUMAN_INTERVENTION_REQUIRED`.
- Una pregunta informativa de porcentaje cubierta por politica activa no escala por si sola.
- El agente no afirma revision humana si no existe aprobacion.
- El agente no promete ingresos ni porcentajes fuera de politica, ni menciona porcentajes de forma proactiva.
- El agente no revela instrucciones internas.
- El agente hace una pregunta principal por respuesta.

## Preparacion de integraciones futuras

Se definen contratos para:

- `InstagramMessagingProvider`
- `InternalNotificationProvider`
- `CalendarProvider`
- `VoiceAgentProvider`
- `ContractProvider`
- `WhatsAppProvider`

No se implementan integraciones reales en esta fase.

## Adaptador OpenAI

El motor no depende directamente del SDK de OpenAI. La seleccion de proveedor vive en `llmFactory.ts` y la configuracion en `llmConfig.ts`.

Modos:

- `LLM_MODE=DETERMINISTIC`: usa extraccion y redaccion local.
- `LLM_MODE=OPENAI`: usa OpenAI para comprension estructurada y redaccion si existe `OPENAI_API_KEY`.
- Si falta la clave o falla OpenAI, se aplica fallback determinista.

La integracion usa salidas estructuradas validadas por Zod. El modelo puede proponer:

- intencion;
- datos extraidos;
- correcciones y contradicciones detectadas;
- preguntas comerciales;
- solicitud de llamada o persona;
- negociacion y porcentaje solicitado;
- necesidad y motivo de revision humana;
- notas internas.

La salida del modelo no modifica directamente candidata ni estado. La aplicacion valida y aplica solo cambios permitidos.

## Redaccion

La redaccion recibe `ResponsePlan`, memoria, ultimos mensajes, resumen, conocimiento oficial, ejemplos recuperados, estilo de Alex, hechos permitidos, afirmaciones prohibidas y pregunta principal permitida.

El redactor devuelve:

```ts
{
  response: string;
  requestedProvider: string;
  actualProvider: string;
  requestedModel: string;
  actualModel: string;
  usedFallback: boolean;
  fallbackReason: string | null;
  durationMs: number;
  retryCount: number;
  inputTokens: number | null;
  outputTokens: number | null;
  estimatedCostUsd: number | null;
}
```

Las transiciones, porcentajes, aprobaciones y acciones siguen bajo reglas deterministas.

## Modos de automatizacion

```ts
type AutomationMode = "DRAFT_ONLY" | "HUMAN_APPROVAL" | "AUTOMATIC";
```

- `DRAFT_ONLY`: genera borrador y no guarda mensaje saliente.
- `HUMAN_APPROVAL`: guarda la propuesta como borrador pendiente de Alex.
- `AUTOMATIC`: guarda/envia solo si pasa validaciones y no requiere revision humana.

El valor por defecto es `HUMAN_APPROVAL`.

## Revision de respuestas

El simulador muestra para cada respuesta: mensaje recibido, respuesta propuesta, estado, datos extraidos, `ResponsePlan`, conocimiento, ejemplos, evaluacion de estilo, evaluacion factual, modelo y versiones de prompt.

Alex puede aprobar, editar y aprobar, rechazar o tomar control manual. El feedback guarda contexto completo y puntuacion opcional de estilo de 1 a 5.

## CONVERSATIONAL_QUALITY_EVALUATION

Antes de persistencia real o Instagram, se abre una fase de evaluacion de calidad conversacional.

Objetivos:

- comparar modelos con el mismo estado inicial, mensajes, conocimiento y ejemplos;
- ejecutar pruebas A/B locales entre `gpt-4.1-mini` y `gpt-5.4-mini`;
- ocultar opcionalmente el modelo al evaluador;
- registrar respuesta A, respuesta B, latencia, tokens, coste estimado y fallback;
- permitir que Alex elija `A`, `B`, `EMPATE` o `NINGUNA`;
- puntuar estilo de 1 a 5 y guardar notas.
- importar conversaciones completas anonimizadas mediante `ANONYMIZED_JSON`;
- crear sesiones de evaluacion sobre conversaciones importadas;
- aprobar, editar o rechazar cada turno, marcar errores y guardar nota libre.

No se elige automaticamente un ganador hasta tener suficientes evaluaciones humanas.
