-- Badge "Conciliación" + etiqueta a Diana — F2 SOENA (cierre del panel)
--
-- Diana (financiera) necesita enterarse de que hay pagos por conciliar SIN revisar
-- negocio por negocio. Dos piezas:
--   1. Un contador en el item de nav "Conciliación" con el número de negocios
--      "por conciliar".
--   2. Que un comercial pueda etiquetar un negocio como "necesita conciliación de
--      Diana" (vía activity_log, tipo 'solicitud_conciliacion') y que eso sume al
--      contador / aparezca en el panel.
--
-- El contador se DERIVA por query (no hay tabla de notificaciones). Esta función
-- lo computa set-based en UN solo round trip (sin N+1): replica la definición del
-- panel ("por conciliar" = negocio abierto con precio cuya diferencia ≠ 0 O sin el
-- check de Diana) y le suma los negocios con etiqueta pendiente de un comercial.
--
-- SECURITY DEFINER con search_path fijo (patrón de las RPC del workflow). El filtro
-- por workspace lo pone el caller (la layout pasa su propio workspace_id, derivado
-- de la sesión). Retrocompatible: agrega una función nueva + 2 valores al CHECK de
-- activity_log.tipo.

-- ── 0. Extender activity_log.tipo con los eventos de etiqueta de conciliación ──
--
-- La etiqueta "necesita conciliación" del comercial (solicitud_conciliacion) y su
-- limpieza por Diana (conciliacion_atendida) son eventos de activity_log. El CHECK
-- vigente (migration 20260406000005) solo admite comentario/cambio/sistema/
-- cambio_etapa/cambio_estado → hay que ampliarlo o el INSERT falla. Se preserva el
-- set existente y se suman los 2 valores nuevos.
alter table public.activity_log drop constraint if exists activity_log_tipo_check;
alter table public.activity_log add constraint activity_log_tipo_check
  check (tipo in (
    'comentario', 'cambio', 'sistema', 'cambio_etapa', 'cambio_estado',
    'solicitud_conciliacion', 'conciliacion_atendida'
  ));

create or replace function public.count_negocios_por_conciliar(p_workspace_id uuid)
returns integer
language sql
stable
security definer
set search_path = public
as $$
  with abiertos as (
    -- Negocios abiertos con precio > 0 (los que el panel considera)
    select
      n.id,
      coalesce(n.precio_aprobado, n.precio_estimado, 0) as precio
    from public.negocios n
    where n.workspace_id = p_workspace_id
      and n.estado = 'abierto'
      and coalesce(n.precio_aprobado, n.precio_estimado, 0) > 0
  ),
  cobrado as (
    select c.negocio_id, coalesce(sum(c.monto), 0) as total
    from public.cobros c
    where c.workspace_id = p_workspace_id
    group by c.negocio_id
  ),
  -- Pieza 1: "por conciliar" según el panel (diferencia ≠ 0 O sin check de Diana)
  por_conciliar as (
    select a.id
    from abiertos a
    left join cobrado cb on cb.negocio_id = a.id
    left join public.negocio_conciliacion nc on nc.negocio_id = a.id
    where abs(a.precio - coalesce(cb.total, 0)) > 1
       or coalesce(nc.conciliado, false) = false
  ),
  -- Pieza 2: negocios etiquetados por un comercial como "necesita conciliación".
  -- La etiqueta es una entrada de activity_log tipo 'solicitud_conciliacion' del
  -- negocio; cuenta solo si NO hay una posterior tipo 'conciliacion_atendida'
  -- (Diana puede limpiar la etiqueta). MVP: reusa activity_log, sin tabla nueva.
  etiquetados as (
    select distinct al.entidad_id as id
    from public.activity_log al
    where al.workspace_id = p_workspace_id
      and al.entidad_tipo = 'negocio'
      and al.tipo = 'solicitud_conciliacion'
      and al.entidad_id in (select id from abiertos)
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
    select id from por_conciliar
    union
    select id from etiquetados
  ) u;
$$;

comment on function public.count_negocios_por_conciliar(uuid) is
  'Contador del badge "Conciliación" (F2). Negocios abiertos con precio cuya '
  'diferencia ≠ 0 o sin check de Diana, UNION los etiquetados por un comercial '
  '(activity_log tipo solicitud_conciliacion sin conciliacion_atendida posterior). '
  'Derivado por query, sin tabla de notificaciones.';

grant execute on function public.count_negocios_por_conciliar(uuid) to authenticated;
