# Base de conocimiento de Rose Models

## Objetivo

La base de conocimiento contiene informacion oficial, versionada y autorizada sobre Rose Models. Es la fuente de verdad para hechos del negocio, politicas comerciales, responsabilidades, llamadas, contratos y escalado humano.

Los ejemplos conversacionales solo ensenan estilo y estrategia de respuesta. Nunca pueden modificar una politica oficial.

## Prioridad de fuentes

1. Politicas de seguridad y cumplimiento.
2. Politicas oficiales activas de Rose Models.
3. Estado, memoria y datos confirmados de la candidata.
4. Ejemplos aprobados de Alex.
5. Capacidad general del modelo para comprender y redactar.

Si un ejemplo contradice una politica activa, prevalece la politica activa.

## Estructura

```text
src/content/business/
  agency-profile.ts
  call-policy.ts
  candidate-requirements.ts
  commercial-policy.ts
  content-responsibilities.ts
  contract-policy.ts
  escalation-policy.ts
  frequently-asked-questions.ts
  objection-handling.ts
  services-policy.ts
  index.ts
```

Cada archivo exporta entradas `KnowledgeEntry` validadas mediante Zod. Una entrada incluye:

- hechos oficiales;
- puntos autorizados de respuesta;
- afirmaciones prohibidas;
- matices obligatorios;
- condiciones de escalado;
- estados donde puede utilizarse;
- version, estado y aprobacion.

## Estados de entradas

- `DRAFT`: informacion preparada, pero no utilizable para responder.
- `ACTIVE`: informacion oficial disponible para el agente.
- `DEPRECATED`: informacion antigua que no debe utilizarse.

Solo las entradas `ACTIVE` y `approvedByAlex: true` pueden usarse en respuestas normales.

## Politica comercial inicial

Datos confirmados:

- Rose Models no trabaja mediante salario fijo.
- Rose Models trabaja mediante reparto porcentual.
- El porcentaje no se menciona de forma proactiva.
- La agencia se encarga de estrategia, trafico, monetizacion, chatting y gestion acordada.
- Detalles comerciales y negociacion se tratan principalmente en llamada.
- El agente no puede negociar porcentajes por chat.
- Tener iPhone es requisito obligatorio antes de aprobacion final.

Datos pendientes:

- Se ha mencionado un reparto habitual 70/30, pero no esta confirmado quien recibe cada parte.
- Las responsabilidades operativas exactas de agencia y modelo quedan en `DRAFT` hasta confirmacion explicita de Alex.

## Negociacion

Si la candidata intenta negociar, el agente:

1. No ofrece otra cifra.
2. Reconoce la peticion de forma natural.
3. Indica que puede valorarse segun perfil y potencial.
4. Lo deriva a Alex o a llamada.
5. Crea revision humana con motivo `PERCENTAGE_NEGOTIATION`.

La IA solo puede comunicar condiciones personalizadas si existe una `NegotiationDecision` aprobada por una persona.

## iPhone

Se pregunta de forma natural durante la cualificacion:

```text
Por cierto, una cosa importante: ¿tienes iPhone?
```

Si tiene iPhone, se guarda `phoneDeviceType = "IPHONE"` y `hasRequiredIPhone = true`.

Si tiene Android u otro dispositivo, se guarda `hasRequiredIPhone = false`, no se avanza a aprobacion final y no se inventan excepciones.

Por eso `RevenueSharePolicy` mantiene `agencyPercentage` y `modelPercentage` como `null` hasta confirmacion explicita.

## Respuesta sin cobertura

Si una pregunta sobre Rose Models no tiene respuesta oficial activa:

- no inventar;
- no usar condiciones de otras agencias;
- no asumir;
- marcar revision humana;
- responder de forma natural indicando que se consultara.

## Validacion factual

Antes de guardar una respuesta se comprueba:

- porcentajes no autorizados;
- promesas de ingresos;
- servicios no documentados;
- responsabilidades no confirmadas;
- clausulas contractuales inventadas;
- contradicciones con politicas vigentes;
- afirmaciones sin fuente interna autorizada.

Si falla, se intenta una reescritura segura una vez. Si vuelve a fallar, se usa fallback y se solicita revision humana.

## Busqueda futura

La version actual usa recuperacion determinista local por categoria, etiquetas, intencion, estado y vigencia. Queda preparada una version semantica con embeddings, pero no se conecta todavia.
