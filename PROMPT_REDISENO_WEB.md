# Prompt para rediseñar la web (CRM + simulador) de Rose Models Agent

> Copia y pega esto en Claude (o la herramienta de diseño). Es un rediseño **visual y de UX**: NO se
> inventan funciones de negocio nuevas ni se quitan las que hay; se eleva el diseño y se añade la capa de
> **llamadas**. Mantén TODOS los textos en español de España y los nombres de estado tal cual.

---

## CONTEXTO DEL PRODUCTO
Panel interno (una sola persona: Alex, el dueño de una agencia de modelos) para gestionar candidatas que
llegan por Instagram. Un bot de IA cualifica por DM y, ahora, un **bot de voz** las llama. La web tiene
hoy 4 secciones: **Evaluación**, **Chat de prueba**, **CRM** (Kanban) y **A/B de modelos**, más una barra
de estado. Es un tablero técnico/operativo, oscuro, tipo SaaS premium. Quiero subirla MUCHO de nivel:
que sea **bellísima, ambiciosa y llena de detalles**, sin perder nada de lo que ya hace y añadiendo la
información de las llamadas.

## OBJETIVO DEL REDISEÑO
1. Diseño de altísimo nivel (dribbble/linear/vercel-grade): jerarquía clara, profundidad, micro-detalles.
2. **Unificar CRM ↔ conversación**: al pulsar una candidata se abre una **vista/drawer de candidata** con
   todo (datos, conversación DM + llamada, trazabilidad, acciones), en vez de los `window.prompt` nativos
   de ahora (a sustituir por modales/inline elegantes).
3. **Añadir la capa de LLAMADAS** (nueva, ver sección dedicada).
4. Mostrar datos de la candidata que hoy se ocultan (objeciones, resumen, intereses, etc.).
5. Dashboard/resumen con métricas.

---

## IDENTIDAD VISUAL (punto de partida actual — elévala, no la rompas)
- **Tema oscuro** premium. Paleta actual: fondo `#0a0e13`, paneles `#131b24`/`#18222d`, texto `#e8eef4`,
  apagado `#8593a0`, líneas `#243240`. **Acento teal/turquesa** `#2dd4bf` (fuerte `#5eead4`, profundo
  `#0d9488`). Semánticos: peligro `#f87171`, aviso/ámbar `#fbbf24`, info/azul `#60a5fa`, éxito `#22c55e`.
- Tipografía **Inter** (mono para JSON). Radios grandes (14px), píldoras (999px), sombras suaves,
  **glow teal** en focos. Fondo con radial-gradients teal+azul fijos. Cabecera con blur (glassmorphism).
- Eleva con: profundidad por capas, glassmorphism sutil, micro-interacciones (hover/press/transiciones),
  data-viz limpia, iconografía coherente (estilo Lucide), estados de carga con skeletons, toasts en vez de
  alerts. Mantén la sensación oscura + acento teal (es la marca). Puedes proponer modo claro opcional.

---

## NAVEGACIÓN GENERAL
- **Cabecera sticky** con blur: título "Rose Models Agent" (con gradiente teal en el texto), subtítulo
  "Simulador local sin Instagram real.", y **barra de pestañas**.
- **Pestañas** (propuesta mejorada): **Resumen/Dashboard** (NUEVA), **CRM**, **Llamadas** (NUEVA),
  **Chat de prueba**, **Evaluación**, **A/B de modelos**. (Hoy solo existen Evaluación, Chat, CRM, A/B.)
- **Barra de estado** (abajo o en cabecera): `Persistencia: {modo} · IA: {modo} ({modelo})`. Diséñala
  como chips de estado con color (verde/ámbar) según salud.

---

## SECCIÓN: CRM (Kanban) — eje central
Encabezado: "CRM de candidatas" + subtítulo "Cada columna es una fase del embudo. Las que necesitan tu
decisión están en ⚠ Tu decisión.".

**Toolbar**: buscador (placeholder "Buscar por nombre o @usuario…") + **3 KPIs**: «**N** te esperan»
(ámbar), «**N** activas», «**N** total». Eleva los KPIs a tarjetas-métrica con icono y mini-tendencia.

**Tablero horizontal con columnas** (cada una con color de tono, contador y borde izquierdo de 4px):
1. **Nuevas** (gris) — estados NEW_LEAD, WAITING_PROFILE_ACCESS
2. **Cualificando** (teal) — QUALIFYING
3. **⚠ Tu decisión** (ámbar) — PROFILE_READY_FOR_REVIEW, WAITING_HUMAN_REVIEW, HUMAN_INTERVENTION_REQUIRED
4. **Agenda** (azul) — APPROVED, COLLECTING_CALL_DETAILS, READY_TO_SCHEDULE, CALL_SCHEDULED
5. **Llamadas** (NUEVA, morado/teal) — CALL_IN_PROGRESS, CALL_COMPLETED, CALL_NO_ANSWER *(hoy estos
   estados existen pero NO aparecen en ningún sitio: hay que darles columna)*
6. **Cerradas** (gris atenuado) — REJECTED, CLOSED

**Etiquetas de estado (pill) en español, EXACTAS**: Nueva, Esperando solicitud, Revisar perfil,
Cualificando, Tu decisión, Intervención, Aprobada, Agendando, Lista para llamada, Llamada agendada,
Rechazada, Cerrada. **Añade labels nuevas**: "Llamando…" (CALL_IN_PROGRESS), "Llamada hecha"
(CALL_COMPLETED), "No contestó" (CALL_NO_ANSWER).

**Anatomía de cada tarjeta de candidata** (rediséñala preciosa, con todo esto):
- **Avatar**: foto real de Instagram (con fallback a la inicial del nombre si la foto caduca). Anillo de
  color por tono.
- **Identidad**: nombre (firstName) o `@usuario` o "Candidata nueva"; `@usuario` como enlace a Instagram
  con icono ↗ (abre en pestaña nueva). Verificada → badge ✓ azul (dato `isVerified`, hoy NO se muestra).
- **Indicador de bot**: punto verde "Activo" / gris "Pausado".
- **Pill de estado** (label español).
- **Badges**: motivo de escalada ("⚠ Revisar perfil / Negocia porcentaje / Pide excepción comercial /
  Duda de contrato / Dato contradictorio / Revisión humana"); "✓ Te sigue"; "🔒 Privada" o "🌐 Pública".
  **Nuevos**: nivel comercial (STANDARD/HIGH_POTENTIAL/EXCEPTIONAL → "Estándar/Alto potencial/Excepcional"),
  nivel de interés (bajo/medio/alto), bloqueos de onboarding.
- **Meta-tags** (chips): "{edad} años", "OF: sí/no", modelo de dispositivo, país/ciudad, "{n} seg" o
  "{x.x}k seg" de seguidores, 📱 si hay teléfono.
- **Acciones (botones compactos), según estado** — TODAS deben existir:
  - WAITING_PROFILE_ACCESS → **"Ya le mandé la solicitud"** (teal).
  - PROFILE_READY_FOR_REVIEW → **"Encaja"** (teal) / **"No encaja"** (rojo).
  - WAITING_HUMAN_REVIEW / HUMAN_INTERVENTION_REQUIRED → **"Aprobar"** (teal) / **"Rechazar"** (rojo).
  - COLLECTING_CALL_DETAILS / READY_TO_SCHEDULE → **"Confirmar llamada"** (teal; pide hora).
  - Siempre → **"Responder"** (envía un DM manual).
  - Si no cerrada → **"Pausar"/"Reanudar"** bot.
  - Si no en revisión → **"OK perfil"** / **"Rechazar"** (rojo).
- **Pie**: "Último mensaje hace N min/h/d".
- **Estado vacío de columna**: placeholder elegante (no un guion).
- **Click en la tarjeta** → abre la **vista de candidata** (drawer lateral o página), ver más abajo.

---

## SECCIÓN NUEVA: LLAMADAS (bot de voz)
Es la gran novedad. Diséñala completa:
- **Lista/tablero de llamadas**: por candidata con llamada agendada/en curso/hecha/no contestada.
- **Para cada llamada**: hora agendada (`scheduledCallSlot`, p. ej. "el lunes a las 18h"), estado
  (agendada/llamando/hecha/no contestó), duración, resultado, y **motivo de handoff** si la pasó a Alex
  ("pidió persona", "agresión/sospecha", "rechazó el reparto al mínimo", "audio ininteligible").
- **Transcripción de la llamada** (turno a turno, estilo chat: bot vs candidata) cuando exista.
- **Negociación del reparto**: a qué % se llegó (70 / 65 / 60) si hubo negociación.
- **Resumen post-llamada** y botón **"Enviar contrato"** (el siguiente paso tras la llamada).
- **Métricas de llamadas** (tarjetas-KPI + gráfica): llamadas hechas, % contestadas, % completadas, % no
  contesta, duración media, conversión a contrato, handoffs.
- Acciones: **"Reagendar"**, **"Reintentar"**, **"Enviar contrato"**, **"Pasar a mí" (handoff)**.

---

## VISTA DE CANDIDATA (unificada — sustituye los window.prompt)
Drawer lateral o página al pulsar una tarjeta. Pestañas internas o secciones:
- **Cabecera**: avatar grande, nombre, @usuario (enlace IG ↗), estado, badges (privacidad, te-sigue,
  verificada, tier, interés), foto/seguidores.
- **Ficha de datos** (todo lo del modelo, en grid bonito): estado, usuario, edad, mayoría confirmada,
  ciudad, país, teléfono, tipo y modelo de dispositivo, elegibilidad de dispositivo, nivel comercial,
  visibilidad declarada, solicitud aceptada, acceso verificado, revisión de perfil humano, decisión
  humana, bloqueos de onboarding, OnlyFans sí/no, ingresos mensuales actuales, otra agencia sí/no,
  experiencia (texto), disponibilidad de contenido, objetivos, nivel de interés, **objeciones** (lista de
  chips), **nº de veces que dudó de la cara**, **resumen de la conversación**, notas (lista).
- **Conversación**: el hilo del DM (mensajes candidata/agente/alex/sistema) Y la transcripción de la
  llamada, unificados o en dos pestañas. Burbujas: candidata a la derecha (teal), agente a la izquierda
  (oscuro); diferencia visual para "alex" (humano) y "system".
- **Composer de respuesta manual** elegante (no `window.prompt`): textarea + "Enviar a Instagram".
- **Acciones** contextuales (las mismas que en la tarjeta, según estado) como botonera limpia.
- **Panel de trazabilidad** (ver siguiente sección), plegable.

---

## SECCIÓN: CHAT DE PRUEBA (simulador del bot de DM)
3 columnas (hoy): lista de candidatas · chat · "Revisión de Alex".
- **Izquierda**: lista de candidatas (`@usuario` + estado).
- **Centro**: header "Chat de prueba", **mensajes** (burbujas por rol; el agente se trocea en varias
  burbujas tipo "ráfaga"), estado vacío "Envía un mensaje como candidata para iniciar la conversación.";
  **composer**: input "instagram_username", select de visibilidad ("Público/Privado/Desconocido"), botón
  **"Candidata nueva"**, textarea del mensaje, botón **"Enviar mensaje"** (→ "Enviando…"), error en rojo.
- **Derecha — "Revisión de Alex"**: pill de estado, **tabla de datos extraídos** (label→valor), tabla de
  **transiciones de estado** ({trigger}: {fromState} → {toState}), y el panel técnico (abajo).

## SECCIÓN: TRAZABILIDAD (panel técnico — honestidad del modelo)
Diséñalo como panel de observabilidad bonito (hoy es texto/JSON). Campos:
- **Evaluación de estilo**: score como % + razones (o "Sin alertas de estilo").
- **Validación factual**: "Correcta"/"Revisar" (rojo si revisar) + razones.
- **Plan de respuesta**: objetivo + si requiere revisión humana + JSON del plan (objective,
  knowledgeEntryIds, versiones, requiresHumanReview, humanReviewReason, uncoveredQuestion).
- **Automatización**: modo + estado de entrega.
- **Traza del proveedor LLM** (clave, "trazas honestas"): proveedor solicitado vs real, modelo solicitado
  vs real, **fallback sí/no + motivo**, duración (ms), reintentos, tokens (in/out), coste estimado ($).
  Diséñalo como tarjeta de "request inspector" con badges (verde si proveedor real = solicitado; ámbar si
  hubo fallback).
- **Versiones**: perfil de estilo, retriever, prompt.
- **Comprensión del modelo** (JSON), **Conocimiento usado** (categoría + título + versión), **Ejemplos
  recuperados** (categoría + título + tags).
- **Feedback de Alex**: textarea "Respuesta editada", input motivo, select de **puntuación de estilo**
  (1 «nunca lo diría» … 5 «exactamente como lo diría»), botones **"Aprobar" / "Editar y aprobar" /
  "Rechazar" / "Tomar control"**, confirmación "✓ Guardado: {estado}".

## SECCIÓN: EVALUACIÓN (conversaciones importadas)
- Lista de conversaciones (id, categoría, nº mensajes), seleccionable.
- Input "Modelo de redacción" + botón **"Reproducir conversación"**.
- Resultados por turno: mensaje de la candidata, respuesta generada + estado resultante + traza, respuesta
  original, textarea de edición, **checkboxes de issues** (error factual, error de estado, repetición,
  demasiado formal, demasiado largo, pregunta innecesaria, no respondió la pregunta real), select de
  puntuación de estilo, botones Aprobar/Editar y aprobar/Rechazar. Resumen de la sesión (% aprobadas/
  editadas/rechazadas, estilo medio, errores, coste).
- `<details>` "Importar más conversaciones (JSON)" con textarea + botón "Importar conversaciones".

## SECCIÓN: A/B DE MODELOS
- Textarea de mensajes (uno por línea), inputs modelo A y modelo B, checkbox **"Ocultar modelos al
  evaluar"**, botón **"Ejecutar A/B"**. Resultados A/B (respuesta + traza), select ganador (A/B/Empate/
  Ninguna), puntuación de estilo, nota de Alex, botón **"Guardar decisión"**.

## SECCIÓN NUEVA: RESUMEN / DASHBOARD
Vista de bienvenida con métricas del embudo: nº por fase, conversión entre fases, candidatas que "te
esperan", llamadas de hoy/agendadas, alertas (intervención humana), actividad reciente. Tarjetas-KPI +
gráficas limpias + lista de "pendientes de tu decisión".

---

## COMPONENTES Y PATRONES A INCLUIR
- Modales y toasts (sustituir `window.prompt`/`window.confirm`/alerts).
- Confirmaciones para acciones destructivas (rechazar): "¿Rechazar a @usuario? El bot dejará de
  responderle.".
- Estados: vacío (ilustración + CTA), carga (skeletons), error (banner rojo). Hoy el vacío del CRM dice
  "Aún no hay candidatas. Prueba el núcleo conversacional en el chat de prueba." + botón "Ir al chat".
- Responsive (hoy colapsa a 1 columna en móvil): diseña móvil + escritorio.
- Accesibilidad: contraste AA, foco visible (glow teal), navegación por teclado, aria-labels.
- Micro-interacciones: hover eleva tarjeta, transiciones suaves, animación al cambiar de columna/estado.

## RESTRICCIONES (importante, para que no metas cosas sin sentido)
- Es un rediseño VISUAL/UX: **no inventes funciones de negocio nuevas** ni cifras; respeta los estados,
  labels y textos en español exactos de arriba.
- Mantén la **trazabilidad honesta del modelo** (proveedor/modelo real, fallback) — es un requisito.
- No muestres datos sensibles que no toquen (p. ej., el teléfono solo donde tenga sentido; nunca claves).
- Es un panel de UNA persona (Alex): prioriza densidad de información útil + rapidez de decisión, con
  belleza. No es una landing pública.

## ENTREGABLE QUE QUIERO
Diseño completo (idealmente con las pantallas: Dashboard, CRM Kanban, Vista de candidata, Llamadas, Chat
de prueba con trazabilidad, Evaluación, A/B), en tema oscuro teal premium, con todos los botones, badges y
datos de arriba, mobile + desktop, y un sistema de componentes coherente.
