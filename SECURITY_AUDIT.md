# Auditoria de dependencias

Revision: 9 de junio de 2026.

## Resultado inicial

`npm audit` detecto 11 vulnerabilidades:

| Paquete | Tipo | Severidad | Ambito | Version corregida | Riesgo de actualizacion |
| --- | --- | --- | --- | --- | --- |
| `drizzle-orm` | directa | high | produccion futura | `0.45.2` | medio: cambio mayor de ORM |
| `vitest` | directa | critical | desarrollo | `4.1.8` | medio: cambio mayor de runner |
| `vite` | transitiva de `vitest` | moderate | desarrollo | via `vitest@4.1.8` | medio |
| `vite-node` | transitiva de `vitest` | moderate | desarrollo | via `vitest@4.1.8` | medio |
| `@vitest/mocker` | transitiva de `vitest` | moderate | desarrollo | via `vitest@4.1.8` | medio |
| `drizzle-kit` | directa | moderate | desarrollo | sin ruta segura por audit | medio/alto |
| `@esbuild-kit/core-utils` | transitiva de `drizzle-kit` | moderate | desarrollo | sin ruta segura por audit | medio |
| `@esbuild-kit/esm-loader` | transitiva de `drizzle-kit` | moderate | desarrollo | sin ruta segura por audit | medio |
| `esbuild` | transitiva | moderate | desarrollo | `0.25.12` por override | bajo/medio |
| `next` | directa | moderate | produccion | audit sugiere downgrade inseguro | alto si se acepta sugerencia |
| `postcss` | transitiva de `next` | moderate | produccion | `8.5.15` por override | bajo/medio |

## Cambios aplicados

- `drizzle-orm` actualizado a `0.45.2`.
- `vitest` actualizado a `4.1.8`.
- `drizzle-kit` actualizado a `0.31.10`.
- `openai` agregado en `6.42.0`.
- Overrides controlados:
  - `postcss@8.5.15`.
  - `esbuild@0.25.12`.

## Resultado final

`npm audit` queda en 0 vulnerabilidades.

No se uso `npm audit fix --force`.
