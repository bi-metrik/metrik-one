---
name: almacenamiento-supabase-externo
description: PR #716 sin mergear — archivos de negocios de trappvel en su propio Supabase + repositorio dentro de ONE; config YA aplicada en prod, el SQL de corte de Drive va DESPUÉS del merge, archivos_one sin crear (Isa)
metadata:
  type: project
---

PR #716 (2026-09-14, **sin mergear**: toca datos de producción). Para `trappvel`, los
archivos de negocios van al Supabase propio de Trappvel (`yodndfclcbcgyqsoauwa`, bucket
privado `one-documentos`) en vez de Drive. Config en
`config_extra.storage_provider = supabase_externo` + `storage_supabase_url`; la llave solo
en la variable `WS_STORAGE_SECRET_TRAPPVEL`. Ampliado el mismo día: la carpeta de Drive se
reemplaza por el repositorio `/negocios/<id>/archivos` (lista Storage, no `archivos_one`).

**Estado que no se deduce del código (al 2026-09-14):**
- Config de ONE: **APLICADA** en producción el 2026-09-14 (Mik, con autorización de
  Mauricio). Archivo renombrado a `proyectos/trappvel/clarity/migrations/2026-09-14_one-config-storage-provider.sql`.
- Variable de Vercel `WS_STORAGE_SECRET_TRAPPVEL`: **creada** por Mik (production+preview, sensitive).
- Bucket `one-documentos`: creado. Tabla `archivos_one`: **NO creada**, la corre Isa
  (`..._almacenamiento-archivos-one.sql`).
- SQL de corte de Drive **escrito y SIN aplicar**:
  `proyectos/trappvel/clarity/migrations/2026-09-14_one-corte-drive-trappvel.sql`
  (drive_folder_id null + carpeta_url null en M1 26 1, E1 26 1, M1 26 2 con la URL vieja
  en `metadata.carpeta_drive_anterior`; guardas DO + reversa comentada).
- `listarNegocio` solo probado con doble de bucket: nunca contra el Storage real (la llave
  no estuvo disponible en la sesión).

**Why:** pasaportes y vouchers de pasajeros en el Drive de MeTRIK = dato personal de
terceros en infraestructura propia. Decisión de Mauricio, fila 2026-09-14 de
`proyectos/trappvel/clarity/decisions.md`.

**How to apply:**
- ⚠️⚠️ Orden: **merge → SQL de corte → QA en producción**. El corte NO va antes: con el
  `main` viejo y `drive_folder_id` null, las subidas caen al bucket público `ve-documentos`.
- ⚠️ `carpeta_url` queda **null**, no apuntando a la ruta interna: ~20 consumidores la
  parsean como URL de Drive, y tras una reversa una ruta interna caería al bucket público.
- ⚠️ Con la marca puesta, `google-drive.ts` se niega a emitir token para ese workspace:
  cualquier flujo sin convertir **falla** (a propósito). Reprocesar documentos viejos en
  Drive (los 3 negocios de prueba) va a fallar.
- Mientras falte `archivos_one`, el cron `almacenamiento-externo` marca el workspace
  fallido a diario en su timeline. No es bug.
- `subirImagenClipboard` ya rechaza workspaces externos (antes caía a `ve-documentos`).
- ⚠️ Riesgos vigentes si se prenden módulos en trappvel: FAB registrar pago y pagos
  externos (`conciliacion` / `fab_registrar_pago`) siguen escribiendo soportes al bucket
  público `ve-documentos`; soportes de gasto van a `gastos-soportes` público; un
  `avisar_al_cliente` con `{link}` saldría `sbext://`.

Relacionado: [[llaves-nuevas-supabase-proyecto-ajeno]], [[trappvel-reglas-reunion-15]],
[[worktree-git-bloqueado]].
