# Sistema de estilo conversacional

## Objetivo

El sistema de estilo ayuda a que el agente responda como Alex podria escribir en Rose Models: breve, natural, cercano y en espanol de Espana. No sustituye a la maquina de estados ni a las reglas de negocio.

La version inicial usa prompting estructurado, recuperacion dinamica de ejemplos y evaluacion determinista. No usa fine-tuning ni embeddings.

## Componentes

- `alexStyleProfile`: reglas versionadas de identidad, tono, forma de escribir, expresiones prohibidas y comportamientos deseados.
- `ConversationExample`: ejemplo estructurado y validado con Zod.
- `ExampleRetriever`: recupera entre 3 y 6 ejemplos relevantes segun estado, intencion, etiquetas y calidad.
- `StyleContextBuilder`: construye el contexto que se pasara al generador de respuesta.
- `ResponseStyleEvaluator`: evalua si una respuesta encaja con el estilo esperado.
- `ConversationFeedback`: registra si Alex aprueba, edita o rechaza una respuesta.
- `ApprovedResponse`: permite convertir una respuesta corregida y revisada en ejemplo futuro.
- `GoldenConversationTest`: conjunto separado de evaluacion que no se usa como contexto de generacion.

## Como anadir conversaciones

1. Preparar la conversacion en `data/conversation-examples/<categoria>/` si viene de una fuente real o de revision.
2. Convertirla en ejemplo activo en `src/content/examples/conversationExamples.ts` cuando este lista para validarse con Zod.
3. Usar contenido ficticio o anonimizado.
4. Elegir una categoria y etiquetas claras.
5. Marcar `sourceType` segun el origen:
   - `RAW_REAL`: conversacion real sin revisar.
   - `CORRECTED`: conversacion corregida.
   - `ALEX_APPROVED`: ejemplo aprobado para contexto.
   - `EVALUATION_ONLY`: caso reservado para evaluacion.
6. No activar `approvedByAlex` salvo revision explicita.

## Como revisarlas

Alex puede valorar respuestas desde el simulador con:

- `APPROVED`: la respuesta suena bien y puede guardarse como referencia.
- `EDITED`: Alex corrige el texto; se guarda la respuesta original y la corregida.
- `REJECTED`: no debe usarse como ejemplo.

Las ediciones no entran automaticamente en produccion. Deben convertirse en ejemplos aprobados despues de revisarlas.

## Como ejecutar evaluaciones

Cuando Node.js este disponible:

```bash
npm run test
```

Los golden tests no comparan texto exacto. Comprueban propiedades: estado esperado, datos extraidos, factualidad, seguridad, longitud, ausencia de expresiones prohibidas y respuesta al mensaje concreto. Viven en `src/content/golden`, no en la carpeta de estilo.

## Versionado

Cada respuesta puede registrar:

- version del perfil de estilo;
- version del prompt/contexto;
- version de reglas;
- version del recuperador;
- modelo utilizado;
- ejemplos recuperados.

Esto permite explicar por que una respuesta funciono o fallo.

## Fine-tuning

No se implementa todavia porque el MVP necesita aprender primero que respuestas aprueba Alex. El fine-tuning tendria sentido cuando existan suficientes ejemplos aprobados, corregidos y consistentes.

La base incluye un exportador preparado para:

- excluir datos personales;
- anonimizar nombres, usuarios y telefonos;
- excluir menores;
- excluir ejemplos no aprobados;
- separar entrenamiento, validacion y evaluacion;
- evitar que una misma conversacion aparezca en varios conjuntos.
