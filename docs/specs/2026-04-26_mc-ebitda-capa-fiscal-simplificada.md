# Spec — MC + EBITDA + Capa Fiscal Simplificada

**Fecha:** 2026-04-26 | **Owner ejecucion:** Max | **Estado:** spec, NO ejecutar
**Contexto fuente:** sesion 2026-04-23, taxonomia `[[taxonomia-costos-one-v1]]`, decision MC norte 2026-04-23.
**Migracion:** un solo viaje, sin data critica (workspaces metrik, AFI vacios u onboarding).

---

## 1. MC + EBITDA como metricas norte

**Objetivo:** MC auditable por negocio (no estimado por blend 40/60/100 historico).

- **Tablas:** `gastos.clasificacion_costo` (ver §2) + `horas` (ya tiene `negocio_id` desde `20260408000002`) + `gastos.negocio_id` (ya existe).
- **Vista nueva:** `v_mc_negocio` — `SELECT negocio_id, SUM(precio_total - costos_variables) AS mc, ...` agrupando por negocio.
- **Vista nueva:** `v_pyl_mes` — ingresos cobrados, costos variables (clasificacion=variable), MC = ingresos − variables, fijos (clasificacion=fijo + `gastos_fijos_config`), EBITDA = MC − fijos. Excluye `no_operativo`.
- **Endpoints / acciones:** `numeros/actions-v2.ts` — reescribir `getNumerosKPIs` para leer `v_pyl_mes` y `v_mc_negocio`. Eliminar bloque `margenContribucion` blend (lineas ~524-541) + columnas `margen_contribucion_estimado/calculado/fuente/n_proyectos_margen` en `workspaces`.
- **UI:** `numeros/numeros-v2-client.tsx` — KPI principal MC% y EBITDA del mes; `drill-down-sheet.tsx` muestra MC por negocio top-N. Renombrar copy "Margen efectivo" → "Margen de contribucion". Eliminar tag "Estimado/Mixto/Calculado" del badge fuente.
- **Permisos:** sin cambio. Owner/admin/read_only ven Numeros.
- **Tests:** snapshot KPIs `numeros/__tests__` con seed 3 negocios + gastos clasificados + fijos config.
- **Riesgo:** workspaces existentes con `negocios.precio_total` faltante o `gastos.negocio_id IS NULL` en gastos historicos pueden mostrar MC inflado. Mitigar con backfill de la §2.
- **Dependencia:** §2 (clasificacion) debe existir antes.

## 2. Taxonomia `clasificacion_costo` (variable / fijo / no_operativo)

- **Migracion nueva:** `20260426000001_clasificacion_costo.sql`
  - `ALTER TABLE gastos ADD COLUMN clasificacion_costo TEXT NOT NULL DEFAULT 'variable' CHECK (clasificacion_costo IN ('variable','fijo','no_operativo'));`
  - Tabla mapeo: `categoria_clasificacion_default(categoria TEXT PK, clasificacion_default TEXT)` seed con: comision/materiales/transporte/viaticos→`variable`; mano_de_obra→`variable` (imputable a negocio); servicios_profesionales/software/impuestos_seguros→`fijo`; impuestos sobre renta/intereses→`no_operativo`. Seed editable post-migration.
  - Trigger `gasto_clasificacion_default`: en `BEFORE INSERT`, si `clasificacion_costo` no provisto → lookup `categoria_clasificacion_default` → fallback `variable` (defensa MC).
  - Backfill: `UPDATE gastos SET clasificacion_costo = CASE WHEN negocio_id IS NOT NULL THEN 'variable' ELSE COALESCE((SELECT clasificacion_default FROM categoria_clasificacion_default WHERE categoria = gastos.categoria), 'variable') END;`
  - Migracion eliminacion: `gastos_fijos_config` se mantiene (fijos recurrentes mensuales fuera de `gastos`).
- **UI:**
  - `nuevo/gasto/nuevo-gasto-form.tsx` — toggle de 3 opciones bajo categoria, prefilled. Copy: *"Este gasto desaparece si no hay ventas?"* Si=variable / No=fijo / No aplica=no_operativo. Ayuda inline.
  - `movimientos/movimientos-client.tsx` — columna nueva "Clasificacion" + filtro.
  - **Comision comercial**: form de gasto con `categoria=comision` requiere `negocio_id` (validacion server side). Salario base sigue en `gastos_fijos_config` (sin cambio).
- **Permisos:** owner/admin/operator/contador pueden override clasificacion. read_only no edita.
- **Seeds:** `seed_demo_*` actualizar para incluir clasificacion explicita.
- **Tests:** unit del trigger default + e2e creacion de gasto con override.
- **Riesgos:** zona gris empresarios → defensa por sesgo a `variable` (decision Carmen). Si trigger falla (categoria nueva sin map), default `variable` evita ocultar costos.
- **Dependencia:** ninguna (es base de §1).
- **Gate:** taxonomia §3 del borrador `[[taxonomia-costos-one-v1]]` debe quedar firmada por Carmen+Santiago (regla comision) antes de exponer MC.

## 3. Simplificacion capa fiscal

**Migracion nueva:** `20260426000002_simplificar_fiscal.sql`

ELIMINAR (gastos + cobros):
- Columnas: `estado_causacion`, `aprobado_por`, `fecha_aprobacion`, `causado_por`, `fecha_causacion`, `cuenta_contable`, `centro_costo`, `notas_causacion`, `retencion_aplicada`, `rechazo_motivo`, `enviado_alegra`, `alegra_id`, `fecha_envio_alegra`, `retenciones` (jsonb), `tercero_razon_social`.
- Tabla `causaciones_log` → `DROP TABLE` (sin retencion de auditoria; no hay data critica).
- Indices: `idx_*_estado_causacion`, `idx_*_causacion_bandeja`.

MANTENER / AGREGAR:
- `gastos.deducible BOOLEAN` (ya existe via `20260328000000_deducible_default_false`) — sin cambio.
- `gastos.soporte_url TEXT` — ya existe.
- `gastos.tercero_nit TEXT` — se queda (util para reportes contador).
- **Nuevo:** `gastos.retencion NUMERIC(15,2)` (un campo numerico simple, no JSONB) — patron DIMPRO. Idem `cobros.retencion`.
- **Nuevo:** `gastos.revisado BOOLEAN DEFAULT false` + `gastos.revisado_at TIMESTAMPTZ` + `gastos.revisado_por UUID REFERENCES auth.users(id)` (ver §4). Idem cobros.

Acciones a borrar:
- `causacion/actions.ts` → renombrar a `revision/actions.ts` (ver §4) y eliminar `aprobarCausacion`, `causarCausacion`, `rechazarCausacion`, logica PUC/CC/retenciones jsonb. Mantener solo `marcarRevisado(id, tabla)` y `desmarcarRevisado`.
- `numeros/actions-v2.ts` referencias a `estado_causacion`, `CATEGORIAS_DEDUCIBLES` con `soporte_url` — verificar y simplificar (D141/D142 sigue valido por `deducible` flag).

UI eliminada:
- `causacion/causacion-client.tsx` formulario PUC/CC/retenciones JSONB → reemplazar por panel revision (§4).
- `config/wizard-felipe.tsx` referencias a estado_causacion — auditar.

Permisos:
- `roles.ts` — `canCausar`, `canApproveCausacion` → renombrar a `canMarcarRevisado` (todos roles excepto read_only). `contador` rol mantiene acceso pero solo-vista a Movimientos + boton marcar revisado.

Tests:
- `numeros/__tests__` — quitar fixtures con `estado_causacion`.
- nuevo: `revision/__tests__` para flag binario.

Riesgo tecnico:
- `database.ts` types regenerar con `npx supabase gen types` post-migracion + re-aplicar 40 aliases.
- Lint/build pasara solo despues de eliminar todas las referencias `estado_causacion` (29 archivos detectados — auditar lista en analisis).
- DROP de columnas en orden: primero borrar indices, luego columnas, luego tabla `causaciones_log`.

Gate: aprobacion explicita Mauricio para DROP TABLE `causaciones_log` (no recuperable).

## 4. Renaming "Causacion" → "Revision"

- Ruta: `(app)/causacion/` → `(app)/revision/`. Update sidebar (`app-shell.tsx`), middleware no requiere cambio.
- Acciones: `causacion/actions.ts` → `revision/actions.ts`. Funcion clave: `marcarRevisado(id, tabla)` toggle flag `revisado` + timestamp + user.
- Permisos `roles.ts`: `canMarcarRevisado` (owner/admin/operator/contador). Page guard.
- UI: panel "Bandeja de revision" — lista gastos+cobros ordenados por `revisado=false` primero. Botton unico "Marcar revisado". Sin formulario fiscal.
- Copy: empresario lee "Marcar revisado", contador lee "Bandeja de revision pendiente".
- Tests: actualizar paths.

## 5. Export limpio CSV/Excel para contador

- Endpoint nuevo: `revision/export-actions.ts` — `exportarMovimientosMes(workspaceId, year, month, formato: 'csv'|'xlsx')`.
- Columnas CSV: fecha, tipo (gasto/cobro), categoria, clasificacion_costo, monto, deducible, retencion, tercero_nit, soporte_url, revisado, negocio_codigo, notas.
- Excel: dos hojas (gastos/cobros) + tercer hoja resumen totales mes.
- Soportes: si `soporte_url` apunta a Supabase Storage, bundle ZIP con CSV + carpeta `/soportes/{id}.{ext}`. Util signed URLs valid 24h o copia local.
- Lib: usar `papaparse` (ya esta) para CSV, `xlsx` (agregar dep) para Excel, `jszip` (agregar dep) para ZIP.
- Permisos: `canExportRevision` (owner/admin/contador/read_only). Operator no exporta.
- UI: boton "Descargar mes" en `/revision` con selector mes/ano + formato.
- Test: snapshot CSV con seed conocido.
- Riesgo: descarga grande con muchos soportes → streaming response, no buffer en memoria.

## 6. Disclaimer fiscal en UI

- Componente nuevo: `components/fiscal-disclaimer.tsx` — banner inline sutil, copy: *"ONE no es software contable ni reemplaza al contador. Consulta a tu profesional para causaciones, retenciones y declaraciones."*
- Renderizar en: `/revision`, `/movimientos` (top), `/nuevo/gasto` (cerca toggle deducible+retencion), `/numeros` drill-down impuestos.
- Sin permisos, sin gate. Solo visual.
- Test: render unit.
- Gate de contenido: copy final aprobado por Emilio (legal) — ver gates abajo.

## 7. Migracion total un solo viaje

- Orden de migraciones (todas con prefix `20260426`):
  1. `000001_clasificacion_costo.sql` (§2)
  2. `000002_simplificar_fiscal.sql` (§3)
  3. `000003_revisado_flag.sql` (parte §3 + §4 — separar para rollback selectivo)
  4. `000004_v_mc_negocio_v_pyl_mes.sql` (§1)
- Workspaces afectados: metrik, afi, soena, demo (ana, altavista). Soena es el unico con data real → `gastos.negocio_id` ya poblado, backfill `clasificacion_costo='variable'` automatico.
- Ejecutar `npx supabase db push` y luego `gen types`. Re-aplicar 40 aliases en `database.ts`.
- Sin feature flag — corte limpio.

---

## Plan de ejecucion sugerido (orden logico, sin fechas)

1. **Validacion previa** (gates): taxonomia firmada Carmen+Santiago; copy disclaimer aprobado Emilio; aprobacion Mauricio para DROP `causaciones_log`.
2. **Capa datos**: migraciones 000001 → 000002 → 000003 → 000004 en una rama. `npx supabase db reset` local + `gen types`.
3. **Backend acciones**: refactor `numeros/actions-v2.ts`; crear `revision/actions.ts`; eliminar referencias `estado_causacion` en 29 archivos detectados; agregar `export-actions.ts`.
4. **Roles**: `roles.ts` reflejar `canMarcarRevisado` y `canExportRevision`; remover `canCausar`/`canApproveCausacion`.
5. **UI rename**: mover `/causacion` → `/revision`; sidebar; middleware paths; copy.
6. **UI nueva**: nuevo-gasto-form con toggle clasificacion; `<FiscalDisclaimer />` en 4 ubicaciones; campo retencion simple.
7. **Numeros**: KPI MC + EBITDA + drill-down MC por negocio.
8. **Export**: CSV/XLSX + ZIP con soportes.
9. **Seeds**: actualizar 4 archivos seed con `clasificacion_costo` explicito.
10. **Tests**: snapshots numeros, unit revision, unit export, render disclaimer.
11. **Lint+build**: cero errores. Verificar 28 react-hooks pendientes no se contaminan.
12. **QA workspace**: smoke en metrik, afi, soena (especial: soena con data real).
13. **Deploy**: push main → Vercel auto-deploy.

## Wiki-links

- `[[taxonomia-costos-one-v1]]` — Carmen, fuente §2
- `[[2026-04-23_mc-ebitda-norte]]` — decision (gate Kaori capturar)
- `[[agentes-no-estimar-tiempo]]` — restriccion reportes
- `[[code-ownership]]` — Max owner unico de ejecucion
