-- =============================================================================
-- Un cobro no se borra: se ANULA. Y el pago que no entra por la pasarela lleva
-- soporte adjunto.
-- 2026-08-11
-- =============================================================================
--
-- Borrar plata deja un hueco que nadie puede auditar, y este es el modulo con el que
-- se concilia. La fila se conserva, marcada como anulada, con motivo, autor y fecha.
--
-- ⚠️ POR QUE AL ANULAR EL MONTO SE PONE EN CERO (y no basta con marcar `anulado_at`)
--
-- `cobros.monto` lo suman hoy 5 vistas, ~10 funciones SQL y ~40 sitios de TypeScript:
-- saldo del negocio, gates de saldo, cartera, P&L, MC, tableros de comisiones y varios
-- crons. Un cobro anulado que siguiera contando en UNO SOLO de esos sitios seria peor
-- que no poder anularlo, porque la pantalla diria "anulado" y el saldo seguiria
-- moviendose sin que nada lo delate.
--
-- Agregar `and anulado_at is null` a 55 sitios es un inventario que nadie puede declarar
-- cerrado. Este repo ya tiene escrito el gotcha exacto: la formula de saldo que un
-- handoff declaro "en tres sitios" estaba en cuatro, y el cuarto retuvo negocios que ya
-- habian pagado. Poner el monto en cero lo resuelve POR CONSTRUCCION: ningun sumador
-- puede contarlo, ni los que existen hoy ni los que se escriban manana.
--
-- El valor original NO se pierde: queda en `monto_anulado`. Para una fila anulada, la
-- verdad del dinero es esa columna; `monto` vale 0 a proposito.
--
-- Lo que SI hay que filtrar a mano es lo que cuenta por PRESENCIA y no por suma: el
-- control de duplicado de referencia, la idempotencia del registro y el conteo de
-- `count_negocios_por_conciliar`. Los dos primeros van en el codigo; el tercero, abajo.
--
-- Migracion ADITIVA: columnas nuevas nullable + una relajacion de CHECK. No toca datos.

alter table public.cobros
  add column if not exists anulado_at timestamptz,
  add column if not exists anulado_por uuid references public.profiles(id),
  add column if not exists anulacion_motivo text,
  add column if not exists monto_anulado numeric(15,2),
  add column if not exists soporte jsonb;

comment on column public.cobros.anulado_at is
  'Marca de anulacion. Una fila con este valor conserva su historia pero no mueve un peso: su `monto` quedo en 0.';
comment on column public.cobros.anulado_por is
  'profiles.id de quien anulo. Es profiles y no staff a proposito: iguala a `created_by` de esta misma tabla.';
comment on column public.cobros.monto_anulado is
  'Monto que tenia el cobro al anularlo. Para una fila anulada esta es la verdad del dinero.';
comment on column public.cobros.soporte is
  'Soporte del pago (comprobante/pantallazo): {url, drive_file_id, file_name, mime_type, storage_path, subido_por, subido_en}. Obligatorio en los pagos que no entran por la pasarela.';

-- El CHECK exigia `monto > 0` y un cobro anulado vale 0. Es una RELAJACION: nada de lo
-- existente la viola (medido contra produccion el 2026-08-11: 0 filas de 170 con
-- monto <= 0). Un monto negativo sigue prohibido.
alter table public.cobros drop constraint if exists cobros_monto_check;
alter table public.cobros add constraint cobros_monto_check check (monto >= 0);

comment on constraint cobros_monto_check on public.cobros is
  'monto >= 0. El cero es exclusivamente el estado de un cobro anulado (ver `monto_anulado`).';

-- Indice de la consulta caliente del panel y del control de duplicado: las referencias
-- VIGENTES de un workspace.
create index if not exists idx_cobros_ref_vigente
  on public.cobros (workspace_id, external_ref)
  where anulado_at is null;

-- =============================================================================
-- count_negocios_por_conciliar: el badge tampoco puede contar lo anulado
-- =============================================================================
--
-- Su bloque `cobrado` suma montos, asi que el cero ya lo resuelve. Pero `refs_no_split`
-- detecta duplicados por PRESENCIA de la referencia: sin este filtro, anular un pago mal
-- cargado dejaria el negocio marcado como duplicado para siempre — justo el caso de uso
-- que motiva la anulacion.
--
-- Se AMPLIA el filtro, no cambia la forma de lo que devuelve (sigue siendo integer), asi
-- que el consumidor ya desplegado (`src/app/(app)/layout.tsx`) no se entera.
--
-- ejecutable-por-cliente: la invoca el layout autenticado por RPC para pintar el badge de
-- Tesoreria; filtra por el workspace que recibe y no expone filas, solo un conteo.

create or replace function public.count_negocios_por_conciliar(p_workspace_id uuid)
 returns integer
 language sql
 stable security definer
 set search_path to 'public'
as $function$
  with
  cobrado as (
    select c.negocio_id, sum(c.monto) as total
    from public.cobros c
    where c.workspace_id = p_workspace_id
      and c.anulado_at is null
      and coalesce(c.tipo_cobro, '') <> 'devolucion_pendiente'
    group by c.negocio_id
  ),
  tarifa_confirmada as (
    select nb.negocio_id,
           max((nb.data ->> 'tarifa_upme_confirmada')::numeric) as tarifa
    from public.negocio_bloques nb
    join public.bloque_configs bc on bc.id = nb.bloque_config_id
    join public.negocios n on n.id = nb.negocio_id
    where n.workspace_id = p_workspace_id
      and bc.config_extra -> 'tarifa_confirmacion' ->> 'enabled' = 'true'
      and nb.data ->> 'tarifa_confirmada' = 'true'
      and nb.data ->> 'tarifa_upme_confirmada' ~ '^[0-9]+(\.[0-9]+)?$'
      and (nb.data ->> 'tarifa_upme_confirmada')::numeric > 0
    group by nb.negocio_id
  ),
  sin_certificacion as (
    select distinct nb.negocio_id
    from public.negocio_bloques nb
    join public.bloque_configs bc on bc.id = nb.bloque_config_id
    join public.negocios n on n.id = nb.negocio_id
    where n.workspace_id = p_workspace_id
      and bc.slug = 'certificacion_upme'
      and nb.data -> 'requiere_certificacion_upme' = 'false'::jsonb
  ),
  valor_a_recaudar as (
    -- CON IVA a proposito: es la plata que entra a la cuenta, contra la que se
    -- comparan los pagos. La tarifa UPME no lleva IVA (se recauda y se gira).
    select n.id as negocio_id,
           vv.valor_total
             + case when sc.negocio_id is not null then 0 else coalesce(t.tarifa, 0) end as valor
    from public.negocios n
    join public.v_negocio_valor vv on vv.negocio_id = n.id
    left join tarifa_confirmada t on t.negocio_id = n.id
    left join sin_certificacion sc on sc.negocio_id = n.id
    where n.workspace_id = p_workspace_id
  ),
  sobrepagos as (
    select n.id
    from public.negocios n
    join cobrado cb on cb.negocio_id = n.id
    join valor_a_recaudar vr on vr.negocio_id = n.id
    left join public.negocio_conciliacion nc on nc.negocio_id = n.id
    where n.workspace_id = p_workspace_id
      and n.estado = 'abierto'
      and cb.total - vr.valor > 1000
      and coalesce(nc.conciliado, false) = false
  ),
  refs_no_split as (
    select c.external_ref, c.negocio_id
    from public.cobros c
    join public.negocios n on n.id = c.negocio_id
    where c.workspace_id = p_workspace_id
      and c.external_ref is not null
      and c.anulado_at is null
      and (c.split_json ->> 'split_id') is null
      and n.estado = 'abierto'
  ),
  duplicados as (
    select distinct r.negocio_id as id
    from refs_no_split r
    where r.external_ref in (
      select external_ref
      from refs_no_split
      group by external_ref
      having count(distinct negocio_id) > 1
    )
  ),
  etiquetados as (
    select distinct al.entidad_id as id
    from public.activity_log al
    where al.workspace_id = p_workspace_id
      and al.entidad_tipo = 'negocio'
      and al.tipo = 'solicitud_conciliacion'
      and exists (
        select 1 from public.negocios n3
        where n3.id = al.entidad_id
          and n3.workspace_id = p_workspace_id
          and n3.estado = 'abierto'
      )
      and not exists (
        select 1 from public.activity_log al2
        where al2.workspace_id = p_workspace_id
          and al2.entidad_tipo = 'negocio'
          and al2.entidad_id = al.entidad_id
          and al2.tipo = 'conciliacion_atendida'
          and al2.created_at > al.created_at
      )
  )
  select count(*)::integer
  from (
    select id from sobrepagos
    union
    select id from duplicados
    union
    select id from etiquetados
  ) u;
$function$;

revoke execute on function public.count_negocios_por_conciliar(uuid) from public, anon;
grant execute on function public.count_negocios_por_conciliar(uuid) to authenticated;
