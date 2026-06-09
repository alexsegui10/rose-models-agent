# Base de conocimiento de Rose Models

## Objetivo

La base de conocimiento contiene informacion oficial, versionada y autorizada sobre Rose Models. Es la fuente de verdad para hechos del negocio, politicas comerciales, responsabilidades, llamadas, contratos, dispositivos, seguimiento y escalado humano.

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
  follow-up-policy.ts
  frequently-asked-questions.ts
  objection-handling.ts
  services-policy.ts
  index.ts
```

Cada `KnowledgeEntry` incluye hechos oficiales, puntos autorizados, afirmaciones prohibidas, matices obligatorios, condiciones de escalado, estados permitidos, version, estado y aprobacion.

## Estados

- `DRAFT`: informacion preparada, pero no utilizable para responder.
- `ACTIVE`: informacion oficial disponible para el agente.
- `DRAFT_LEGAL_REVIEW_REQUIRED`: informacion documentada pero pendiente de revision legal; no se usa como clausula definitiva.
- `DEPRECATED`: informacion antigua que no debe utilizarse.

Solo las entradas `ACTIVE` y `approvedByAlex: true` pueden usarse en respuestas normales.

## Reparto Economico

Politica estandar confirmada:

- 70% para Rose Models.
- 30% para la modelo.
- Calculo sobre ingreso neto despues de la comision de la plataforma.
- La modelo recibe directamente el dinero de la plataforma.
- Alex calcula manualmente cada liquidacion.
- La modelo paga a Rose Models mediante Skrill.
- Liquidacion cada 14 dias desde la primera fecha en que la cuenta genera ingresos.

El porcentaje no se menciona de forma proactiva. Si pregunta por salario, se explica que no hay salario fijo y se trabaja por reparto. Si pregunta la cifra exacta, puede responderse 70% para Rose Models y 30% para ella. Si pregunta por que Rose Models recibe el 70%, se responde brevemente que la agencia gestiona cuentas, trafico, contenido publicado, chatting, monetizacion, estrategia y operativa.

## Negociacion

El chat no negocia porcentajes ni ofrece excepciones. Si hay negociacion, excepcion o informacion no cubierta, se escala con motivo `PERCENTAGE_NEGOTIATION` o `COMMERCIAL_EXCEPTION`.

El agente de voz futuro podra negociar dentro de limites controlados, sin asignarse a si mismo un nivel superior:

- `STANDARD`: minimo 70% para Rose Models.
- `HIGH_POTENTIAL`: minimo 65% para Rose Models.
- `EXCEPTIONAL`: minimo 60% para Rose Models.

Reglas de negociacion futura:

- no ofrecer 65/35 ni 60/40 si la candidata no objeta;
- no ofrecer 60/40 como primera contraoferta;
- defender primero el 70/30;
- preguntar que esperaba la candidata;
- bajar solo si insiste o existe riesgo real de perder una buena candidata;
- registrar oferta inicial, objecion, contraoferta, oferta realizada, porcentaje final y motivo.

## Impagos

Politica confirmada:

1. Alex comunica manualmente el importe.
2. La modelo dispone del plazo normal de pago.
3. Si no paga, recibe un recordatorio.
4. Tiene 7 dias adicionales.
5. Si continua sin pagar, se suspende el servicio.
6. Puede finalizarse la relacion.
7. Puede reclamarse la deuda.

El impago no concede uso ilimitado del contenido.

## Finalizacion Sin Preaviso

Existe un preaviso previsto de un mes. Si la modelo abandona sin respetarlo, la intencion actual es poder seguir utilizando durante un mes adicional solo contenido previamente autorizado. Despues debe dejar de utilizarse salvo autorizacion contractual diferente.

Esta regla permanece como `DRAFT_LEGAL_REVIEW_REQUIRED`. El bot no debe explicarla como clausula definitiva.

## Responsabilidades

Rose Models se encarga de crear cuentas nuevas de Instagram, crear correos, utilizar telefonos y SIM preparados, controlar esas cuentas, editar y publicar Reels, gestionar estrategia, crecimiento, trafico, chatting, precios, PPV, monetizacion, OnlyFans junto con la modelo, Inflow, estadisticas, ingresos y seguimiento operativo.

Las cuentas previas o personales de Instagram de la modelo no se usan como cuenta principal del proyecto.

OnlyFans pertenece a la modelo, se crea con su identidad, ambos tendran acceso, la modelo puede consultar resultados y Rose Models realiza gestion operativa. Nunca se guardan contrasenas en prompts, logs, ejemplos, base de conocimiento ni conversaciones.

La modelo debe crear contenido, subirlo a Google Drive, seguir referencias de Instagram y guiones de OnlyFans, mostrar la cara, comunicar limites, generar contenido nuevo y responder normalmente en un maximo de 48 horas. Un retraso aislado no descarta; retrasos repetidos escalan.

## Contenido

Fase inicial:

- unos 5 dias;
- 2 o 3 fotos diarias;
- puede preparar Reels desde el principio.

Despues:

- objetivo orientativo de 10 a 20 Reels semanales;
- no es minimo contractual rigido confirmado;
- aproximadamente uno o mas Reels diarios segun planificacion.

Instagram requiere contenido nuevo no publicado antes. OnlyFans puede reutilizar material antiguo si sirve, solo si la candidata pregunta.

Los limites se preguntan de forma neutral: "Hay algun tipo de contenido que no quieras hacer o algun limite que debamos tener en cuenta?". No se presiona para cambiarlos.

## Perfil Y Cualificacion

Campanas actuales dirigidas a Argentina. Edad habitual buscada: 30 a 50 anos, perfil maduro. No es obligatorio tener seguidores, experiencia ni OnlyFans activo.

La valoracion fisica la realiza unicamente Alex. El chatbot no analiza el cuerpo, no puntua atractivo, no comunica motivos fisicos de rechazo y no usa criterios como "cara espanola".

Datos importantes: nombre, edad, pais, disponibilidad, tiempo, experiencia, OnlyFans, otra agencia, dispositivo, contenido ya creado y telefono cuando proceda. Ingresos actuales solo se preguntan si tiene OnlyFans activo. Seguidores y privacidad en casa no se preguntan de rutina.

## Dispositivos

Elegibilidad:

- `APPROVED`: iPhone 13 o superior; Samsung Galaxy S23, S24, S25 o superior.
- `PENDING_QUALITY_TEST`: iPhone anterior al 13, otros Samsung u otros moviles de gama alta.
- `PENDING_UPGRADE`: va a comprar dispositivo valido; puede hacerse llamada, pero no incorporacion.
- `NOT_ELIGIBLE`: movil de mala calidad.
- `UNKNOWN`: no se sabe.

Los modelos 13 o superiores son preferidos, pero un iPhone anterior puede aceptarse tras prueba manual. La revision humana y la llamada pueden avanzar con `PENDING_UPGRADE` o `PENDING_QUALITY_TEST`; la incorporacion operativa requiere resolver el dispositivo, verificar identidad y firmar contrato.

## Llamada Y Contratacion Manual

La llamada prevista es por WhatsApp, dura aproximadamente entre 2 y 10 minutos y sirve para presentarse, recordar lo hablado, explicar como trabaja Rose Models, resolver dudas, tratar porcentaje si corresponde, negociar dentro de limites futuros, intentar cerrar e indicar que Alex enviara el contrato por WhatsApp.

No se recoge documentacion durante la llamada y no se automatiza el contrato.

Retell queda solo preparado: debe avisar de grabacion y transcripcion, explicar finalidad y pedir aceptacion. Si no acepta, se finaliza educadamente.

Despues de la llamada Alex verifica identidad y mayoria de edad, envia contrato, gestiona documentacion, crea carpetas de Drive, explica referencias y guiones y completa la incorporacion manualmente.

## Seguimientos

Si deja de responder, enviar seguimiento cada 1 o 2 dias, entre 2 y 3 intentos. No escribir indefinidamente.

Si dice que no le interesa, intentar recuperar una sola vez. Si mantiene rechazo, cerrar.

Si no encaja, de momento puede dejarse de responder sin explicaciones fisicas ni detalladas.

## Intervencion Humana

Escalar a Alex si hay enfado, sospecha de estafa, pregunta si habla con un bot, pide persona, surge un problema, hay contradicciones graves, intenta negociar fuera de limites, hay dudas contractuales, informacion no cubierta o caso comercial excepcional.

Si pregunta directamente si es IA: "Soy el asistente virtual del equipo de Rose Models. Alex supervisa personalmente las conversaciones y revisara tu caso." No se niega que sea IA.

## Validacion Factual

Antes de guardar una respuesta se comprueba:

- porcentajes fuera de politica;
- promesas de ingresos;
- servicios no documentados;
- responsabilidades no confirmadas;
- clausulas contractuales inventadas;
- contradicciones con politicas vigentes;
- afirmaciones sin fuente interna autorizada.

Si falla, se intenta una reescritura segura una vez. Si vuelve a fallar, se usa fallback factual seguro y se solicita revision humana cuando corresponda.
