---
name: llaves-nuevas-supabase-proyecto-ajeno
description: Qué se puede y qué no con una llave sb_secret_ de un proyecto Supabase de otra organización, y el HEAD con conteo que devuelve 204 sobre una tabla que no existe
metadata:
  type: reference
---

Medido el 2026-09-14 contra el proyecto de Trappvel (organización ajena, llave nueva
`sb_secret_...`, sin MCP porque el MCP apunta a la org de MeTRIK):

- **Sin DDL.** `/pg/query` y `/pg-meta/default/query` → 404; `/rest/v1/rpc/exec_sql` →
  PGRST202. Buckets sí (`storage.createBucket` con supabase-js). Tablas, RLS y grants: SQL
  escrito para quien tenga el panel. No inventar un pasamanos.
- ⚠️⚠️ **`select(..., { head: true, count: 'exact' })` sobre una tabla que NO existe
  devuelve status 204, `error: null` y `count: null`.** Un GET normal da PGRST205. Todo
  chequeo de salud o de existencia va con GET + `limit(1)`, o miente en verde.
- supabase-js 2.97 acepta la llave `sb_secret_` en `createClient` sin más (apikey +
  bearer), para Storage y PostgREST.
- **Storage rechaza claves con tildes**: `…/Asistencia médica.pdf` → `Invalid key`.
  Normalizar (NFD, sin diacríticos) antes de subir. Ver `src/lib/almacenamiento/referencia.ts`.
- **URL firmada de subida**: el navegador hace `PUT` plano, sin `apikey` → 200. La firmada
  de lectura vence de verdad: a los 8 s con `expiresIn: 5` → 400 `InvalidJWT`; la de 300 s
  medida a los 6 min → 400. El bucket privado responde 400 a la URL pública.
- `move` no pisa un destino existente: quitar (`remove`) primero; `remove` de algo que no
  existe no es error.

**How to apply:** la llave va solo como variable de entorno en el comando
(`WS_STORAGE_SECRET_X=... node script`), nunca a un archivo. Para verificar en vivo el
código real sin commitearlo: un `zz-*.test.ts` temporal en `src/` corrido con vitest
(resuelve `server-only` por alias) y borrado antes del commit.

Relacionado: [[almacenamiento-supabase-externo]], [[medicion-sin-mcp-supabase]].
