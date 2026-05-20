# Spec tecnica — Modelo roles · areas · stages en MeTRIK ONE

**Fecha:** 2026-05-20
**Owner tecnico:** Max
**Fuentes canonicas:**
- `cerebro/conceptos/modelo-roles-areas-stages.md`
- `cerebro/reglas/permisos-negocios.md`
- `cerebro/decisiones/2026-05-20_modelo-roles-areas-stages.md`

## Resumen

Implementacion en 7 fases del modelo unificado rol × area × stage que reemplaza el sistema anterior de tiers planos por rol. Soporta multi-responsable por negocio, area transversal `direccion`, lock pesimista en bloques y cascada de asignacion automatica al cambiar de stage.

## Fase 1 — Migraciones BD (cerrada 2026-05-20)

9 migraciones aplicadas en `feat/roles-areas-stages-fase-1` commit `63db780`. Crearon:
- `staff_areas` (N:M staff × area)
- `negocio_responsables` (N:M negocio × staff)
- `workspace_default_responsables` (1:1 por area)
- `bloque_locks` (lock pesimista)
- `negocios.stage_actual`, `cierre_motivo`, `is_paused`, `paused_at`, `paused_by`, `paused_reason`
- `etapas_negocio.stage` + trigger `sync_negocio_stage_from_etapa` (BEFORE UPDATE OF etapa_actual_id)

## Fase 2 — Funcion central + cascadas + locks server (cerrada 2026-05-20)

### Migraciones aplicadas

| Migracion | Contenido |
|-----------|-----------|
| `20260520000010_legacy_staff_area_mapping.sql` | Amplia CHECK `staff_areas.area` a `('comercial','operaciones','financiera','direccion')`. Backfill: `admin_finanzas` (1 staff) → `financiera`; `direccion` (4 staff) → staff_areas. **NO** bulk-assign de los 12 staff NULL (D1 cerrada). |
| `20260520000011_cascada_asignacion_responsable.sql` | Funcion `asignar_responsable_area_entrante()` + trigger `trg_asignar_responsable_area_entrante` (AFTER UPDATE OF stage_actual). Funcion `sync_negocio_responsable_id()` + 2 triggers (AFTER INSERT/DELETE en negocio_responsables) que mantiene `negocios.responsable_id` denormalizado al primer registro por `assigned_at ASC`. |
| `20260520000012_lock_functions.sql` | Funciones SQL `claim_bloque_lock`, `release_bloque_lock`, `heartbeat_bloque_lock`, `force_unlock_bloque`, `cleanup_expired_bloque_locks`. Cron pg_cron cada 1 min para cleanup. |
| `20260520000013_alerta_responsable_faltante.sql` | Amplia CHECK `notificaciones.tipo` agregando `responsable_faltante_area`. Funcion `detectar_responsable_faltante_area()` + cron diario 13:00 UTC. Cascada destinatario: supervisor del area (via staff_areas, incluye direccion) → admin del WS → owner. |

### Cascada de asignacion automatica

Cuando `negocios.stage_actual` transiciona a un stage operativo (`venta`/`ejecucion`/`cobro`), el trigger asigna responsable del area entrante si **no existe ya** un responsable con esa area (o `direccion`) en `negocio_responsables`. Cascada:

1. `workspace_default_responsables[area_nueva]`
2. **Operator UNICO** del area (o `direccion`) → si hay 2+, salta al siguiente paso
3. **Supervisor UNICO** del area (o `direccion`) → si hay 2+, salta
4. **Admin UNICO** del WS → si hay 2+, salta
5. Owner del WS

Si ningun paso da candidato unico, el negocio queda sin responsable del area entrante. El cron diario `detectar_responsable_faltante_area` lo detecta y notifica.

`assigned_by = NULL` marca asignaciones automaticas (SYSTEM).

### Sync denormalizado `negocios.responsable_id`

Se mantiene como columna "responsable principal" para consumidores legacy. Trigger `sync_negocio_responsable_id` se dispara tras INSERT/DELETE en `negocio_responsables` y actualiza `responsable_id` al primer registro por `assigned_at ASC`. La columna queda **DEPRECATED**, eliminacion programada en Fase 6.

### Lock pesimista server-side

| Funcion SQL | Server action TS | Comportamiento |
|-------------|------------------|----------------|
| `claim_bloque_lock(bloque_id, profile_id, workspace_id, ttl_min=5)` | `claimBloqueLock(bloqueInstanciaId)` | INSERT lock con TTL. Si lock vencido existe, lo borra inline y reintenta. Si lock vigente ajeno → `{ok:false, error:'busy', held_by, expires_at}`. Si lock propio → renueva (heartbeat implicito). Valida workspace pertenencia. |
| `release_bloque_lock(bloque_id, profile_id)` | `releaseBloqueLock(bloqueInstanciaId)` | DELETE solo si dueno. Si no existe → `{ok:true, note:'no_lock'}`. Si ajeno → `{ok:false, error:'not_owner'}`. |
| `heartbeat_bloque_lock(bloque_id, profile_id, ttl_min=5)` | `heartbeatBloqueLock(bloqueInstanciaId)` | UPDATE expires_at si dueno. |
| `force_unlock_bloque(bloque_id, forced_by)` | `forceUnlockBloque(bloqueInstanciaId)` | DELETE sin validar dueno. Server action valida rol `owner`/`admin` antes de llamar. Inserta `activity_log` (tipo `sistema`, contenido `Edicion de bloque forzada por owner/admin`). |
| `cleanup_expired_bloque_locks()` | — | Cron `* * * * *` via pg_cron. DELETE locks con `expires_at < NOW()`. |

Server actions en `src/lib/actions/bloque-locks.ts`. Todas envuelven la RPC con `(supabase as any).rpc(...)` hasta proxima regeneracion de `database.ts`.

### Funcion central `canEditBloque`

`src/lib/permissions/can-edit.ts` exporta funciones puras (sin IO):

- `canEditBloque(user, bloque, negocioResponsables)` — owner/admin true; read_only/contador false; cerrado solo owner/admin; supervisor por area; operator por area + ser responsable
- `canEditHeader(user)` — owner/admin true; `comercial` en areas efectivas (direccion expande)
- `canViewNegocio(user, negocioResponsables)` — operator solo si responsable; contador false
- `canWriteActivityLog(user, negocioResponsables)` — = canViewNegocio
- `getAreasEfectivas(user)` — Set que expande `direccion` a las 3 areas operativas
- `STAGE_TO_AREA` — `venta→comercial`, `ejecucion→operaciones`, `cobro→financiera`, `cerrado→null`

**Tests:** `src/lib/permissions/can-edit.test.mjs` con `node:test`. 33 casos:
- STAGE_TO_AREA mapping
- getAreasEfectivas: direccion expande / sin direccion no / combinada
- canEditBloque: owner/admin × 4 stages; read_only/contador × 4 stages
- canEditBloque: cerrado bloquea supervisor / operator responsable
- canEditBloque: supervisor por area; multiple areas; direccion transversal
- canEditBloque: operator con/sin area, con/sin responsable, con direccion
- canEditHeader: 7 casos
- canViewNegocio: 4 casos
- canWriteActivityLog: 2 casos

Ejecutar: `npx tsx --test src/lib/permissions/can-edit.test.mjs`

### Refactor lectura responsables

`src/app/(app)/negocios/negocio-v2-actions.ts` → `getNegociosV2`:
- Si `role === 'operator'` y existe `staffId`, query previa a `negocio_responsables` filtrada por `staff_id` produce lista de `negocio_id` permitidos.
- Si la lista esta vacia, retorna `[]`. Si tiene items, agrega `.in('id', negocioIdsPermitidos)` al query principal.
- Otros roles (owner/admin/supervisor/read_only) ven todos los negocios del WS.

La UI sigue consumiendo `responsable_id` scalar para mostrar "responsable principal" — el trigger `sync_negocio_responsable_id` lo mantiene actualizado.

### Notificaciones nuevas

Tipo `responsable_faltante_area` agregado al CHECK de `notificaciones.tipo`. Metadata payload:
```jsonb
{
  "codigo": "S1 26 3",
  "stage_actual": "venta",
  "area_faltante": "comercial"
}
```
Cascada destinatario en `detectar_responsable_faltante_area()`:
1. supervisor con `staff_areas.area IN (area_duena, 'direccion')`
2. admin con profile (fallback a `profiles.role='admin'`)
3. owner del WS
Idempotente: skip si ya existe notif `pendiente` del mismo tipo + `entidad_id`.

## Fases pendientes

| Fase | Owner | Scope |
|------|-------|-------|
| 3 | Max + Noor | UI `/mi-negocio/equipo` multi-area + selector responsable + lista de negocios cerrados (`stage_actual='cerrado'`). |
| 4 | Max + Noor | Bloque cierre adelantado + modal cierre + flujo perdido/cancelado + reapertura. |
| 5 | Max + Noor | Lock UI: banner "Editando: [nombre]", heartbeat cada 60s, boton "Forzar edicion" para owner/admin, desplegable trazabilidad etapas anteriores. |
| 6 | Max | Cleanup data legacy: DROP `negocios.responsable_id`, DROP `staff.area` y `profiles.area`. |
| 7 | Max + Yuto | Notificaciones cascada (in-app + email + WhatsApp): cancelado, reapertura, responsable_faltante via WA. |

## Verificacion live

- Cascada: UPDATE de `dd016948...` (`A1 26 3`) `venta → ejecucion` → asigno owner (no habia operator/supervisor/admin). Rollback inmediato.
- Stage `cerrado` no dispara cascada (verificado).
- Sync `responsable_id`: INSERT en `negocio_responsables` actualiza la columna scalar (verificado).
- `detectar_responsable_faltante_area`: 5 notificaciones creadas en muestra de 35 negocios activos cross-workspace. Cascada destinatario funcionando (supervisor → admin → owner).

## Comandos utiles

```bash
# Aplicar todas las migraciones de Fase 2
for f in supabase/migrations/2026052000001{0,1,2,3}_*.sql; do
  SUPABASE_ACCESS_TOKEN=$TOKEN node scripts/_mgmt.mjs "@$f"
done

# Correr tests de can-edit
npx tsx --test src/lib/permissions/can-edit.test.mjs

# Verificar tsc limpio
npx tsc --noEmit
```
