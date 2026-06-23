-- Badge "Conciliación" + etiqueta a Diana — F2 SOENA (cierre del panel)
--
-- Diana (financiera) necesita enterarse de que hay pagos por conciliar SIN revisar
-- negocio por negocio. Dos piezas:
--   1. Un contador en el item de nav "Conciliación" con el número de negocios
--      que están EN SU CANCHA (no todo el pipeline).
--   2. Que un comercial pueda etiquetar un negocio como "necesita conciliación de
--      Diana" (vía activity_log, tipo 'solicitud_conciliacion') y que eso sume al
--      contador / aparezca en el panel.
--
-- El contador se DERIVA por query (no hay tabla de notificaciones). "En la cancha de
-- Diana" = negocio abierto cuyo stage actual es 'cobro' (escalado a ella) y aún sin
-- el check de conciliación, UNION los etiquetados por un comercial. OJO: NO se cuenta
-- el pipeline temprano con saldo pendiente (diferencia > 0 fuera de Cobro) — eso es
-- "por cobrar" del comercial, no "por conciliar" de Diana. Si se contara, el badge
-- mostraría casi todos los negocios abiertos.
--
-- SECURITY DEFINER con search_path fijo (patrón de las RPC del workflow). El filtro
-- por workspace lo pone el caller (la layout pasa su propio workspace_id).

-- ── 0. Extender activity_log.tipo con los eventos de etiqueta de conciliación ──
-- La etiqueta "necesita conciliación" del comercial (solicitud_conciliacion) y su
-- limpieza por Diana (conciliacion_atendida) son eventos de activity_log. El CHECK
-- vigente (migration 20260406000005) solo admite comentario/cambio/sistema/
-- cambio_etapa/cambio_estado → se amplía con los 2 valores nuevos.
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
  -- Pieza 1: negocios en la cancha de Diana — abiertos, stage 'cobro' (escalados
  -- por el motor: saldo>0 o sobrepago caen a Cobro; los pagados exacto lo saltan),
  -- aún sin el check de conciliación.
  with en_cobro as (
    select n.id
    from public.negocios n
    left join public.negocio_conciliacion nc on nc.negocio_id = n.id
    where n.workspace_id = p_workspace_id
      and n.estado = 'abierto'
      and n.stage_actual = 'cobro'
      and coalesce(nc.conciliado, false) = false
  ),
  -- Pieza 2: negocios abiertos etiquetados por un comercial como "necesita
  -- conciliación" (activity_log tipo 'solicitud_conciliacion') sin una
  -- 'conciliacion_atendida' posterior (Diana puede limpiar la etiqueta).
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
    select id from en_cobro
    union
    select id from etiquetados
  ) u;
$$;

comment on function public.count_negocios_por_conciliar(uuid) is
  'Contador del badge "Conciliación" (F2). Negocios abiertos en stage cobro sin el '
  'check de Diana, UNION los etiquetados por un comercial (activity_log tipo '
  'solicitud_conciliacion sin conciliacion_atendida posterior). Derivado por query, '
  'sin tabla de notificaciones. NO incluye el pipeline temprano con saldo pendiente.';

grant execute on function public.count_negocios_por_conciliar(uuid) to authenticated;
