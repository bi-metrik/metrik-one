---
name: almacenamiento-supabase-externo
description: PR #716 sin mergear — archivos de negocios de trappvel en su propio Supabase; la config de ONE puede ir ANTES del merge, archivos_one sigue sin crear, y con la marca puesta Drive queda cerrado para ese workspace por cualquier vía
metadata:
  type: project
---

PR #716 (2026-09-14, checks verdes, **sin mergear**: toca datos de producción). Para
`trappvel`, los archivos de negocios van al proyecto Supabase propio de Trappvel
(`yodndfclcbcgyqsoauwa`, bucket privado `one-documentos`) en vez de Drive. Config en
`config_extra.storage_provider = supabase_externo` + `storage_supabase_url`; la llave solo
en la variable `WS_STORAGE_SECRET_TRAPPVEL`.

**Estado que no se deduce del código:**
- Bucket `one-documentos`: **creado** por la API de Storage. Tabla `archivos_one`: **NO
  creada** — la llave `sb_secret_` no da ninguna vía de SQL. SQL en
  `proyectos/trappvel/clarity/migrations/2026-09-14_almacenamiento-archivos-one.sql`.
- Config de ONE: **sin aplicar**, en `..._one-config-storage-provider-PENDIENTE.sql`.
- Variable de Vercel: **sin crear** (la crea Mauricio).

**Why:** pasaportes y vouchers de pasajeros en el Drive de MeTRIK = dato personal de
terceros en infraestructura propia. Decisión de Mauricio, fila 2026-09-14 de
`proyectos/trappvel/clarity/decisions.md`.

**How to apply:**
- ⚠️ El UPDATE de config **puede ir antes del merge**: preview y producción comparten la
  base y el código de `main` no lee `storage_provider`, así que producción sigue en Drive
  hasta mergear y el QA se hace en el preview. Orden: variable (preview+prod) → redeploy
  preview → tabla en Trappvel → UPDATE → QA → merge.
- ⚠️ Con la marca puesta, `google-drive.ts` se niega a emitir token para ese workspace:
  cualquier flujo sin convertir **falla** (a propósito). Reprocesar documentos viejos que
  viven en Drive (los 3 negocios de prueba) va a fallar.
- Mientras falte `archivos_one`, las subidas funcionan pero el cron
  `almacenamiento-externo` marca el workspace fallido a diario en su timeline. No es bug.
- Drive NO se re-cableó por el adaptador: cada flujo tiene rama `externo / Drive` y el
  camino Drive quedó intacto (criterio de comportamiento idéntico en SOENA).
- Hallazgos abiertos, fuera de alcance: soportes de gasto (FAB) siguen en el bucket
  público `gastos-soportes` de ONE; `subirImagenClipboard` sigue en `ve-documentos`
  público; un `avisar_al_cliente` con `{link}` saldría `sbext://`; ningún `documento` de la
  línea tiene `campos_extraccion` (no hay extracción IA que ejercitar en Trappvel).

Relacionado: [[llaves-nuevas-supabase-proyecto-ajeno]], [[trappvel-reglas-reunion-15]],
[[worktree-git-bloqueado]].
