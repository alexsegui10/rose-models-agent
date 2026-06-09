# Plan del proyecto

## Estado del repositorio

La carpeta del proyecto estaba vacia al comenzar esta fase. No habia codigo, configuracion, dependencias ni estructura previa que conservar.

En la comprobacion del 9 de junio de 2026 se instalaron y verificaron `node`, `npm` y `git` en este entorno. La fase ya permite instalacion de dependencias, lint, typecheck, tests y arranque local.

Versiones verificadas: Node.js `v24.16.0`, npm `11.13.0` y Git `2.54.0.windows.1`.

## Objetivo de la fase 1

Crear un MVP local del agente conversacional de Rose Models para simular conversaciones con candidatas sin integracion real con Instagram, voz, WhatsApp, contratos ni cobros.

El alcance inicial incluye:

- Backend local con rutas API de simulacion.
- Interfaz local de chat.
- Memoria por candidata.
- Maquina de estados explicita.
- Extraccion estructurada inicial.
- Reglas deterministas de seguridad.
- Panel basico de revision humana.
- Historial de mensajes y transiciones.
- Tests de los primeros estados.

## Decisiones iniciales

- **Next.js + TypeScript**: permite tener interfaz local y API routes en un solo proyecto.
- **Drizzle + PostgreSQL/Supabase**: Drizzle es ligero, tipado y permite evolucionar el esquema sin acoplar el dominio al cliente de base de datos. Supabase puede aportar Postgres y autenticacion mas adelante.
- **Zod**: valida entradas, memoria estructurada y salidas del proveedor LLM.
- **Proveedor LLM abstracto**: la aplicacion depende de una interfaz, no del SDK de OpenAI.
- **Adaptador OpenAI opcional**: `LLM_MODE=OPENAI` activa comprension y redaccion mediante OpenAI solo si existe `OPENAI_API_KEY`; si falta la clave, el sistema vuelve a modo determinista.
- **Modo de automatizacion por defecto**: `AUTOMATION_MODE=HUMAN_APPROVAL`. La IA propone borradores y Alex aprueba, edita, rechaza o toma control.
- **Fase `CONVERSATIONAL_QUALITY_EVALUATION`**: antes de persistencia o Instagram se comparan modelos, respuestas y calidad conversacional con evaluacion humana.
- **Repositorio en memoria para el simulador**: evita bloquear el MVP por infraestructura de base de datos. El esquema Drizzle queda definido para migrar a persistencia real.
- **Motor determinista inicial**: permite probar estados y reglas sin gastar llamadas de IA. El adaptador LLM se podra conectar despues.
- **Sistema de estilo por recuperacion dinamica**: se guardan ejemplos aprobados, se recuperan solo los mas relevantes y se evalua la respuesta antes de mostrarla.
- **Base de conocimiento oficial separada**: las condiciones comerciales y politicas de Rose Models viven en entradas versionadas, no en ejemplos de estilo.
- **Politica comercial confirmada**: 70% Rose Models y 30% modelo, calculado sobre neto tras comision de plataforma; la liquidacion se calcula manualmente cada 14 dias y se paga a Rose Models por Skrill. El porcentaje solo se menciona si la candidata lo pregunta explicitamente; negociaciones y excepciones requieren revision humana.
- **Elegibilidad de dispositivo**: iPhone 13+ y Galaxy S23+ aprobados; iPhone anterior al 13, otros Samsung y otros gama alta requieren prueba manual; compra futura permite llamada pero no incorporacion; movil malo bloquea.
- **Politicas operativas confirmadas**: responsabilidades de Rose Models/modelo, contenido inicial y recurrente, impagos, seguimiento, llamada por WhatsApp, transparencia sobre IA y contratacion manual.
- **Sin fine-tuning en esta fase**: primero se necesita una biblioteca de respuestas aprobadas por Alex y golden tests estables.

## Arquitectura por capas

- `src/domain`: entidades, enums, eventos y maquina de estados.
- `src/application`: motor conversacional, extraccion, validacion de respuestas y puertos.
- `src/content`: perfil de estilo, ejemplos y casos golden.
- `src/content/business`: conocimiento oficial y politicas versionadas.
- `src/content/golden`: casos golden de comportamiento, datos, factualidad, seguridad, memoria y transiciones.
- `src/infrastructure`: esquema de base de datos, repositorios e interfaces futuras.
- `src/server`: estado compartido del simulador local.
- `src/app`: interfaz Next.js y rutas API.
- `tests`: pruebas unitarias e integracion ligera del motor.

## Fases incrementales

### Incremento 1

- Crear documentacion base.
- Crear estructura del proyecto.
- Definir `Candidate`, mensajes, transiciones y revision humana.
- Definir maquina de estados.
- Crear motor conversacional minimo.
- Crear simulador local.
- Cubrir `NEW_LEAD`, `WAITING_PROFILE_ACCESS`, `QUALIFYING` y `WAITING_HUMAN_REVIEW`.

### Incremento 2

- Ampliar sistema de estilo con ejemplos reales anonimizados.
- Ampliar base de conocimiento con politicas confirmadas por Alex.
- Completar contratos operativos de idempotencia, debounce, bloqueo por candidata, control de concurrencia y cancelacion.
- Persistencia real con Postgres/Supabase.
- Migraciones Drizzle.
- Autenticacion basica para Alex.
- Mejor panel de revision humana y feedback.
- Resumen acumulativo de conversaciones.

### Incremento 3

- Adaptador OpenAI real con salida estructurada.
- Generacion en dos pasos: comprension y redaccion con contexto de estilo.
- Timeout, reintentos acotados, tratamiento de JSON invalido y fallback determinista.
- Evaluacion de tono mas robusta y feedback humano con puntuacion de estilo.
- Logs persistentes y auditoria.

### Incremento 4

- Evaluacion conversacional real con sesiones A/B locales.
- Importador ampliado de conversaciones anonimizadas completas.
- Metricas de proveedor: modelo solicitado/real, fallback, latencia, tokens y coste estimado.
- Pruebas con preguntas nuevas no literales para validar conocimiento y escalado.
- Incorporar decisiones confirmadas por Alex sobre reparto, dispositivos, contenido, llamadas, impagos y seguimiento.

### Incremento 5

- Integracion Instagram por adaptador.
- Notificaciones internas.
- Calendario para llamadas.

## Riesgos

- El LLM podria sugerir acciones no permitidas. Mitigacion: reglas de negocio deterministas y maquina de estados.
- La candidata puede dar datos en cualquier orden. Mitigacion: extraccion estructurada y memoria acumulativa.
- Preguntas sensibles o economicas pueden exigir intervencion humana. Mitigacion: clasificacion de intencion y pausa automatica.
- Persistencia en memoria no sirve para produccion. Mitigacion: esquema Drizzle definido desde el inicio.
- Ejemplos reales pueden contener datos personales. Mitigacion: anonimizar y validar antes de convertirlos en ejemplos.
- Un ejemplo bueno en una fase puede ser malo en otra. Mitigacion: recuperacion por estado, intencion, tags, calidad y aprobacion.
- Los ejemplos pueden contradecir politicas oficiales. Mitigacion: prioridad de fuentes y validacion factual.
- La politica 70/30 ya esta confirmada, pero no debe mencionarse de forma proactiva. Mitigacion: `RevenueSharePolicy.discloseOnlyWhenExplicitlyAsked`.
- El porcentaje no debe aparecer de forma proactiva. Mitigacion: `RevenueSharePolicy.discloseOnlyWhenExplicitlyAsked`.
- La candidata puede intentar negociar condiciones. Mitigacion: motivo `PERCENTAGE_NEGOTIATION` y decision humana obligatoria antes de comunicar excepciones.
- El dispositivo puede faltar, requerir prueba o compra futura. Mitigacion: `DeviceEligibility` permite revision/llamada con pendientes, pero `onboardingBlockers` bloquea incorporacion final sin `APPROVED`, identidad y contrato.
- Las clausulas sobre uso de contenido tras finalizacion requieren revision legal. Mitigacion: mantenerlas en `DRAFT_LEGAL_REVIEW_REQUIRED` y no usarlas como respuesta definitiva.
- Una candidata puede mandar varios mensajes seguidos. Mitigacion: politica de debounce y procesamiento por turno agrupado.
- Mensajes duplicados o carreras de concurrencia pueden crear respuestas duplicadas. Mitigacion: `externalMessageId`, version de cancelacion, bloqueo por candidata y control manual antes de enviar.

## Comandos previstos

Cuando Node.js este instalado:

```bash
npm install
npm audit
npm run lint
npm run typecheck
npm run test
npm run dev
```

## Variables de entorno

```bash
LLM_MODE=DETERMINISTIC # DETERMINISTIC u OPENAI
OPENAI_API_KEY=
OPENAI_UNDERSTANDING_MODEL=gpt-5.4-mini # tambien compatible con gpt-4.1-mini
OPENAI_WRITING_MODEL=gpt-5.4-mini # tambien compatible con gpt-4.1-mini
OPENAI_REVIEW_MODEL=gpt-5.4-mini # tambien compatible con gpt-4.1-mini
OPENAI_TIMEOUT_MS=12000
OPENAI_MAX_RETRIES=1
AUTOMATION_MODE=HUMAN_APPROVAL # DRAFT_ONLY, HUMAN_APPROVAL o AUTOMATIC
```

Si `LLM_MODE=OPENAI` pero falta `OPENAI_API_KEY`, el simulador usa el proveedor determinista.
