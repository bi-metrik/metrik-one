-- Conciliación v2 — rediseño del panel de conciliación (genérico, opt-in `modules.conciliacion`)
--
-- Cambios de modelo de datos respecto a F2 (20260622000003/4):
--
--   1. `cobros.fuente` (text, nullable) — formaliza la FUENTE del pago como campo de
--      primer nivel. Hasta hoy la fuente de un pago externo vivía en `notas` (texto
--      libre). Ahora: 'epayco' | 'davivienda' | <texto libre de "Otra">. Nullable y
--      retrocompat: cobros existentes quedan con fuente NULL (se infieren por
--      tipo_cobro/external_ref en lectura cuando hace falta). Otros workspaces sin el
--      panel no cambian de comportamiento.
--
--   2. `cobros.tipo_cobro` += 'devolucion_pendiente'. El remanente de una referencia
--      con sobrepago que se marca "por devolver al cliente" se registra como un cobro
--      con monto NEGATIVO y `tipo_cobro='devolucion_pendiente'` + `split_json.por_devolver=true`.
--      Al ser negativo, descuenta del "cobrado" del negocio de origen → su diferencia
--      vuelve a 0 y el saldo de la referencia (suma de porciones con signo) llega a 0
--      sin tener que destruir/editar el cobro original. Sin impacto contable todavía
--      (solo trazable): las vistas de MC/EBITDA NO se tocan; este tipo se EXCLUYE del
--      cobrado financiero, ver nota más abajo.
--
--   3. `count_negocios_por_conciliar` redefinido. "Por conciliar" ahora = SOLO
--      sobrepagos sin conciliar + duplicados sin resolver. El saldo faltante (pago <
--      valor) dejó de ser de Diana: es gestión comercial (pestaña Saldos). Esto saca
--      del badge el `stage='cobro'` con saldo pendiente que antes lo inflaba.
--
-- Retrocompatible: agrega 1 columna nullable + amplía 1 CHECK + redefine 1 función.
-- Nada existente se reescribe.

-- ── 1. cobros.fuente ─────────────────────────────────────────────────────────────
alter table public.cobros
  add column if not exists fuente text;

comment on column public.cobros.fuente is
  'Fuente del pago (panel de conciliación v2). epayco | davivienda | <texto libre>. '
  'Nullable + retrocompat: cobros previos quedan NULL y se infieren por tipo/external_ref.';

-- ── 2. tipo_cobro += devolucion_pendiente ────────────────────────────────────────
alter table public.cobros drop constraint if exists cobros_tipo_cobro_check;
alter table public.cobros add constraint cobros_tipo_cobro_check
  check (tipo_cobro = any (array[
    'regular'::text,
    'anticipo'::text,
    'saldo'::text,
    'pago'::text,
    'programado'::text,
    'externo'::text,
    'devolucion_pendiente'::text
  ]));

-- ── 3. Redefinir count_negocios_por_conciliar ───────────────────────────────────
--
-- Nuevo alcance de "por conciliar" (cancha de Diana):
--   A. Sobrepagos sin conciliar: negocio abierto con cobrado > precio (diferencia < 0)
--      y aún sin el check de negocio_conciliacion.
--   B. Duplicados sin resolver: una referencia (external_ref NO-split) que aparece en
--      >1 negocio abierto. Cada negocio implicado cuenta.
--   C. Etiquetados por un comercial (solicitud_conciliacion sin atención posterior).
--
-- Ya NO cuenta el saldo faltante (diferencia > 0) — eso es "por cobrar" del comercial
-- (pestaña Saldos). El cobrado financiero EXCLUYE devoluciones pendientes (no son
-- cobro real) sumando solo montos de cobros que no sean devolucion_pendiente; pero
-- para el saldo de la referencia el monto negativo sí cuenta — eso se resuelve en el
-- panel, no aquí.
create or replace function public.count_negocios_por_conciliar(p_workspace_id uuid)
returns integer
language sql
stable
security definer
set search_path = public
as $$
  with
  -- cobrado financiero por negocio (excluye devoluciones pendientes, que son monto
  -- negativo de trazabilidad, no cobro real)
  cobrado as (
    select c.negocio_id, sum(c.monto) as total
    from public.cobros c
    where c.workspace_id = p_workspace_id
      and coalesce(c.tipo_cobro, '') <> 'devolucion_pendiente'
    group by c.negocio_id
  ),
  -- A. Sobrepagos sin conciliar
  sobrepagos as (
    select n.id
    from public.negocios n
    join cobrado cb on cb.negocio_id = n.id
    left join public.negocio_conciliacion nc on nc.negocio_id = n.id
    where n.workspace_id = p_workspace_id
      and n.estado = 'abierto'
      and cb.total > coalesce(n.precio_aprobado, n.precio_estimado, 0) + 1
      and coalesce(nc.conciliado, false) = false
  ),
  -- B. Duplicados sin resolver: external_ref (NO-split) en >1 negocio abierto.
  refs_no_split as (
    select c.external_ref, c.negocio_id
    from public.cobros c
    join public.negocios n on n.id = c.negocio_id
    where c.workspace_id = p_workspace_id
      and c.external_ref is not null
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
  -- C. Etiquetados por un comercial sin atención posterior
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
$$;

comment on function public.count_negocios_por_conciliar(uuid) is
  'Badge "Conciliación" v2. Cancha de Diana = sobrepagos sin conciliar UNION duplicados '
  'sin resolver UNION etiquetados por comercial. Ya NO cuenta el saldo faltante (eso es '
  'gestión comercial, pestaña Saldos). El cobrado excluye devolucion_pendiente.';

grant execute on function public.count_negocios_por_conciliar(uuid) to authenticated;

-- ── 4. Índice para resolver duplicados rápido (external_ref por workspace) ─────────
create index if not exists idx_cobros_ws_external_ref
  on public.cobros (workspace_id, external_ref)
  where external_ref is not null;
