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
