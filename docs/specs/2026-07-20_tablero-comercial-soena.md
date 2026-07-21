# Tablero comercial SOENA — seguimiento por vendedor

Fecha: 2026-07-20 · Owner codigo: Max · Estado: en QA

## Contexto

SOENA necesita ver el desempeno comercial por vendedor. Su pipeline vive en
`negocios` (Clarity), NO en `ventas_hechos` (0 registros SOENA; ese modelo es de
manufactura/Siesa). Por eso NO se reutilizan las RPCs de Rentabilidad Comercial
(`get_rentabilidad_comercial`, `get_vendedores_resumen`, `get_vendedor_perfil`),
que van sobre `ventas_hechos`. Camino elegido: RPCs nuevas sobre
`negocios + responsable_id`.

## RPCs (producto generico, opt-in)

Migracion de producto: `supabase/migrations/20260720000001_comercial_negocios_rpcs.sql`.
Ambas `SECURITY DEFINER`, `search_path=public`, revocadas a `anon`, con grant a
`authenticated`.

### `get_comercial_resumen_soena(p_workspace_id uuid) -> jsonb`
Una fila por responsable (incluye bucket sin responsable). Barrera de pertenencia:
solo devuelve datos si `p_workspace_id = current_user_workspace_id()`. Por fila:
conteos por stage (venta/ejecucion/cobro/cerrados), negocios totales y abiertos,
valor aprobado (`precio_aprobado`), honorario recaudado y tarifa recaudada
(pasante) por separado. Orden por honorario recaudado desc.

### `get_comercial_perfil_soena(p_responsable_id uuid) -> jsonb`
Detalle de un vendedor. `p_responsable_id NULL` = bucket sin responsable
(`responsable_id IS NOT DISTINCT FROM p_responsable_id`). Scope al workspace del
llamante via `current_user_workspace_id()`. Devuelve KPIs, conversion por stage
(cuantos negocios y valor en cada uno) y el detalle de negocios con
etapa/valor/recaudo desglosado.

## Decision de metrica: honorario vs tarifa (Mauricio, 2026-07-20)

El headline por vendedor es el **honorario recaudado = ingreso real**. La **tarifa
UPME (pasante)** es plata de terceros (SOENA solo la recauda y la desembolsa a la
UPME); se muestra en una linea secundaria separada, etiquetada "terceros", y jamas
se suma al desempeno comercial.

La definicion se reconcilia con `v_pyl_mes` (migracion 20260708000011) para NO
divergir del EBITDA:

    honorario_recaudado = SUM(cobros.monto) WHERE fecha IS NOT NULL
                                              AND tipo_cobro IS DISTINCT FROM 'pasante'
    tarifa_recaudada    = SUM(cobros.monto) WHERE fecha IS NOT NULL
                                              AND tipo_cobro = 'pasante'

`IS DISTINCT FROM` es null-safe: cobros legacy con tipo NULL cuentan como
honorario, igual que en el P&L.

### Caveat conocido (NO es bug de estas RPCs)

El "Grupo 3" de SOENA aun no esta reclasificado a `tipo_cobro='pasante'`. Hoy no
hay ningun cobro `pasante` en SOENA -> la linea de tarifa sale en 0 y el honorario
recaudado arrastra algo de tarifa. El numero se **auto-corrige** cuando se aplique
esa reclasificacion pendiente. No se debe "arreglar" en estas RPCs.

## Bucket sin responsable

32 de 82 negocios SOENA no tienen `responsable_id` (al 2026-07-20). NO se
higienizan: aparecen agrupados bajo el bucket "(sin responsable)" (id NULL),
visible tanto en la lista del equipo como con su propio perfil, para que no
desaparezcan. Los datos de `responsable_id` tienen algo de ruido (ej. un negocio
con responsable de operaciones); las RPCs son tolerantes y no lo limpian.

## UI

Rutas nuevas en el App Router, gateadas por `modules.comercial_negocios`:

- `/equipo` — nueva rama en `equipo/page.tsx`: si el workspace tiene
  `comercial_negocios` y el rol gestiona equipo, renderiza `ComercialClient`
  (tarjetas por responsable con conteos por stage + valor aprobado + honorario
  recaudado + tarifa aparte, mas la tarjeta "Sin responsable"). Calca el patron
  de la rama `rentabilidad_comercial`.
- `/equipo/comercial/[staff_id]` — perfil del vendedor (`ComercialPerfilClient`):
  KPIs, conversion por stage y detalle de negocios. `staff_id = 'sin-responsable'`
  resuelve el bucket (la action pasa `NULL` a la RPC).

Archivos: `comercial-types.ts`, `comercial-actions.ts`, `comercial-client.tsx`,
`comercial/[staff_id]/page.tsx`, `comercial/[staff_id]/comercial-perfil-client.tsx`.

## Activacion SOENA

`modules.comercial_negocios=true` para el workspace SOENA
(`7dea141d-d4da-483d-a78d-b14ef35500c5`). Aplicado a prod 2026-07-20; registro en
`proyectos/soena/ve/migrations/20260720_comercial_negocios_flag.sql`. Opt-in: no
afecta otros workspaces.

---

# Iteracion 2 (2026-07-21) — paridad total con el Sheet "INDICADORES DE VENTA" + metas

Objetivo: reemplazar el dashboard de Google Sheets de Daniela. Todo en vivo desde
`negocios + cobros + propuestas`, cero tecleo manual.

## Las 6 definiciones (fijadas leyendo el esquema, no inventadas)

### 1. Que es "una venta" y su fecha
Una venta = una **propuesta economica APROBADA**: bloque `bloque_definitions.tipo =
'propuesta_economica'` con `data.aprobado_at IS NOT NULL`. Su FECHA es
`data.aprobado_at` (el equivalente ONE de la "fecha de cierre" del Sheet: es el
evento con timestamp confiable que fija el ingreso).
- **Canonica por negocio:** un negocio tiene varias versiones/bloques de propuesta
  (vi hasta 3 filas identicas por negocio). Se toma UNA por negocio con
  `DISTINCT ON (negocio_id) ... ORDER BY aprobado_at DESC` para NO inflar el conteo x3.
- Datos SOENA al 2026-07-21: 23 negocios con propuesta aprobada (16 con honorario > 0),
  21 de ellas en julio 2026. Planes 1 (50/50) y 2 (unico) presentes.

### 2. Primer vs segundo pago
En SOENA los cobros NO usan `numero_cuota` ni `plan_cobro_id` (ambos NULL hoy en los
32 cobros). El discriminador real es `tipo_cobro`:
- **Primer pago** = `tipo_cobro IN ('anticipo','pago')` (anticipo = 50% del plan 50/50;
  pago = pago unico del plan 2, deja el negocio saldado). 28 anticipos + 4 pagos hoy.
- **Segundo pago** = `tipo_cobro = 'saldo'` (saldo del 50/50). Hoy no existe ninguno;
  la columna aparecera cuando se registre el primer saldo. Se modela ya.
- La tarifa UPME (`tipo_cobro='pasante'`) queda SIEMPRE fuera de todo total comercial
  (plata de terceros).

### 3. IVA
La propuesta guarda el honorario **CON IVA** en `data.aprobado_honorario` y el IVA en
`data.iva_pct` **guardado como fraccion** (ej. `0.19`; se normaliza `>1 -> /100` por si
algun registro trae `19`; default `0.19`). Base con IVA = `precio_base_con_iva` = 850.000
(servicio $714.286 sin IVA + 19%).
- `honorario_sin_iva = honorario_con_iva / (1 + iva_frac)`.
- **Headline = honorario SIN IVA** (ingreso limpio). "con IVA" es columna secundaria de
  paridad con el Sheet. La tarifa UPME nunca entra a totales de desempeno.

### 4. Caso completo / tasa
No hay `completado_at` confiable de cierre financiero. Caso completo = **negocio saldado**:
`honorario_recaudado >= honorario_sin_iva - 1` (tolerancia 1 peso). Tasa = casos completos
/ num ventas del mes.

### 5. Tasa de cancelacion
`negocios.estado = 'perdido'` sobre el universo del mes (ventas del mes + perdidos del mes,
por `updated_at`). En el flujo VE, perder marca `estado='perdido'` (1 negocio hoy);
`tipo_cierre`/`cierre_motivo` aun NO se pueblan, asi que `estado` es la senal fiable.

### 6. Tasa de recaudo
`honorario_recaudado (sin IVA) / honorario_esperado (sin IVA)` de negocios con propuesta
aprobada, MISMO universo en numerador y denominador.
- **CAVEAT reconciliacion con el Sheet (70.1%):** con los datos parciales de hoy la cifra
  NO reconcilia y puede pasar de 100% (medido 172% en una corrida) porque el honorario
  recaudado aun **arrastra tarifa UPME** por el Grupo 3 sin reclasificar a `pasante`, y
  porque hay cobros de negocios sin propuesta aprobada. Se auto-corrige con la
  reclasificacion pendiente. NO se fuerza el numero; se documenta la divergencia.

## Mapeo metrica Sheet -> ONE

| Sheet (Daniela) | ONE (RPC) |
|---|---|
| Vendedores hardcodeados (Bruce, Tejada, Ibanez, Jativa) | `responsable_id` REAL + bucket "(sin responsable)". Jenny Cepeda (14 negocios) SI aparece. **Ventaja mantenida.** |
| Numero de ventas | `num_ventas` = propuestas aprobadas del mes |
| Valor del negocio (con/sin IVA) | `valor_con_iva` / `valor_sin_iva` |
| Primer / segundo pago (con/sin IVA) | `primer_pago` / `segundo_pago` (recaudo real) |
| Casos completos + tasa | `casos_completos` / `tasa_casos_completos` |
| % participacion de ventas | `participacion_pct` |
| Ticket promedio | `ticket_promedio` = valor_sin_iva / num_ventas |
| Mejor dia + ventas de ese dia | `mejor_dia` / `mejor_dia_ventas` |
| Promedio diario / ingreso promedio/dia | `promedio_ventas_dia` / `ingreso_promedio_dia` |
| Cumplimiento de metas | `cumplimiento_num` / `cumplimiento_valor` vs `metas_comerciales` |
| Tasa de cancelacion | `tasa_cancelacion` |
| Ventas proyectadas (run-rate) | `ventas_proyectadas` (proyeccion por dias transcurridos) |
| Series historicas dic/2025 -> hoy | `get_comercial_serie_mensual_soena` |
| Tasa de recaudo global | `serie.tasa_recaudo_global` |

## RPCs nuevas (producto generico, opt-in)

Migracion `supabase/migrations/20260721000002_comercial_serie_kpis_rpcs.sql`.
- `get_comercial_kpis_mes_soena(p_workspace_id, p_anio, p_mes)` -> KPIs del mes + tabla
  por vendedor del mes (incluye bucket sin responsable + metas por vendedor).
- `get_comercial_serie_mensual_soena(p_workspace_id, p_meses)` -> serie de los ultimos N
  meses (ventas, valor con/sin IVA, recaudo, primer/segundo pago) + tasa de recaudo global.
- Ambas SECURITY DEFINER + check de pertenencia (`current_user_workspace_id`), revocadas
  a PUBLIC/anon, grant solo a authenticated. Idempotentes, rollback comentado.

## Tabla nueva: metas_comerciales

Migracion `supabase/migrations/20260721000001_metas_comerciales.sql`.
`(workspace_id, staff_id NULLABLE, anio, mes, meta_num_ventas, meta_valor, created_by)`.
- `staff_id NULL` = **meta global del equipo**; `staff_id != NULL` = meta por vendedor.
- Indice unico `(workspace_id, staff_id, anio, mes)` con **NULLS NOT DISTINCT** (la fila
  global no se duplica).
- RLS por workspace + grant a authenticated. **Editable por owner/admin/supervisor**
  (gate en la server action `guardarMetaComercial`, misma puerta que conciliacion).
- Cumplimiento = real / meta, en vivo.

## UI (calca patrones ONE, sin inventar diseno)

`/equipo` (branch `modules.comercial_negocios`), `ComercialClient` reescrito:
- Selector de mes (< Mes >) con re-consulta via `useTransition`.
- Panel de KPIs mensuales (8 tiles).
- Tabla por vendedor del mes con fila TOTAL (espeja el Sheet).
- Series historicas: 4 charts Recharts (ventas/mes linea; valor/mes barra; recaudo/mes
  barra; primer vs segundo pago apilado).
- Embudo por etapa + honorario-vs-tarifa (tarjetas del resumen historico, iteracion 1).
- Boton "Metas del mes" (solo owner/admin/supervisor) -> `MetasModal` (global + por vendedor).
- Perfil `/equipo/comercial/[staff_id]` sin cambios (iteracion 1).

Archivos nuevos: `metas-modal.tsx`. Extendidos: `comercial-types.ts`, `comercial-actions.ts`,
`comercial-client.tsx`, `page.tsx`.
