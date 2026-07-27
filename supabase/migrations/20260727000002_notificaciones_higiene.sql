-- Higiene del sistema de notificaciones
--
-- Tres problemas independientes, todos detectados auditando datos de prod:
--
-- 1) TIPOS RECHAZADOS EN SILENCIO. Tres flujos operativos insertaban un `tipo`
--    que el CHECK constraint no permite ('cambio_estado', 'negocio_reactivado'),
--    asi que el INSERT fallaba SIEMPRE. Ninguno capturaba el error. Evidencia:
--    en SOENA hubo 5 cancelaciones/reaperturas y existen 0 notificaciones de
--    esos tipos en toda la tabla. Se agregan tipos SEMANTICOS (no el generico
--    'cambio_estado', que era copy-paste del enum de activity_log).
--
-- 2) EL DEDUP MATABA MENCIONES. crear_notificacion() descarta si ya existe una
--    pendiente con igual (destinatario, tipo, entidad). Correcto para
--    "te asignaron responsable"; para menciones significa que si alguien te
--    menciona dos veces en el mismo negocio y no despachaste la primera, la
--    segunda se pierde y nunca te enteras del comentario.
--
-- 3) CERO AUTO-RESOLUCION. Las notificaciones de proceso solo se cerraban a
--    mano. Quedaban pendientes aunque el negocio ya hubiera avanzado o cerrado
--    -> el backlog solo crecia (541 pendientes al momento de esta migracion).

-- ── 1. Tipos que faltaban en el CHECK ────────────────────────────────────────

alter table public.notificaciones drop constraint if exists notificaciones_tipo_check;

alter table public.notificaciones add constraint notificaciones_tipo_check check (
  tipo = any (array[
    'inactividad_oportunidad', 'handoff', 'asignacion_responsable',
    'asignacion_colaborador', 'mencion', 'streak_roto', 'inactividad_proyecto',
    'proyecto_entregado', 'proyecto_cerrado', 'cobro_vencido', 'cobro_proximo',
    'plan_terminado', 'cuenta_cobro_pendiente_aprobacion', 'cuenta_cobro_enviada',
    'cuenta_cobro_envio_fallo', 'responsable_faltante_area',
    -- nuevos: los 3 flujos que fallaban mudos
    'negocio_cancelado',    -- cierre-adelantado.ts
    'negocio_reabierto',    -- reapertura.ts
    'negocio_reactivado'    -- cron pausa-sla (fin de pausa programada)
  ])
);

-- ── 2. Dedup opcional (para no suprimir menciones legitimas) ─────────────────

create or replace function public.crear_notificacion(
  p_workspace_id uuid,
  p_destinatario_id uuid,
  p_tipo text,
  p_contenido text,
  p_entidad_tipo text default null,
  p_entidad_id uuid default null,
  p_deep_link text default null,
  p_metadata jsonb default '{}'::jsonb,
  -- true = cada hecho merece su propio aviso aunque haya uno pendiente igual.
  -- Default false conserva el comportamiento historico de todos los callers.
  p_permitir_repetidas boolean default false
)
returns uuid
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  v_id uuid;
begin
  if not p_permitir_repetidas and exists (
    select 1 from notificaciones
    where destinatario_id = p_destinatario_id
      and tipo = p_tipo
      and entidad_id is not distinct from p_entidad_id
      and estado = 'pendiente'
  ) then
    return null;
  end if;

  insert into notificaciones (
    workspace_id, destinatario_id, tipo, contenido,
    entidad_tipo, entidad_id, deep_link, metadata, estado
  ) values (
    p_workspace_id, p_destinatario_id, p_tipo, p_contenido,
    p_entidad_tipo, p_entidad_id, p_deep_link, p_metadata, 'pendiente'
  )
  returning id into v_id;

  return v_id;
end;
$$;

-- fn_notif_mencion: cada mencion es un hecho distinto -> no deduplicar.
-- Se re-declara completa (misma logica del original + el flag) porque
-- CREATE OR REPLACE no permite cambiar la firma de la llamada interna.
create or replace function public.fn_notif_mencion()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  v_autor_profile_id uuid;
  v_mencionado_profile_id uuid;
  v_autor_nombre text;
  v_entidad_nombre text;
  v_deep_link text;
begin
  if new.mencion_id is null then
    return new;
  end if;

  select profile_id into v_mencionado_profile_id
  from staff where id = new.mencion_id limit 1;

  if v_mencionado_profile_id is null then
    return new;
  end if;

  select profile_id into v_autor_profile_id
  from staff where id = new.autor_id limit 1;

  -- D169: no notificar si autor = mencionado
  if v_autor_profile_id = v_mencionado_profile_id then
    return new;
  end if;

  select full_name into v_autor_nombre
  from staff where id = new.autor_id limit 1;

  if new.entidad_tipo = 'oportunidad' then
    select descripcion into v_entidad_nombre from oportunidades where id = new.entidad_id;
    v_deep_link := '/negocios/' || new.entidad_id;  -- /pipeline fue eliminada del producto
  elsif new.entidad_tipo = 'proyecto' then
    select nombre into v_entidad_nombre from proyectos where id = new.entidad_id;
    v_deep_link := '/negocios/' || new.entidad_id;  -- /proyectos fue eliminada del producto
  elsif new.entidad_tipo = 'negocio' then
    select nombre into v_entidad_nombre from negocios where id = new.entidad_id;
    v_deep_link := '/negocios/' || new.entidad_id;
  else
    v_entidad_nombre := null;
    v_deep_link := null;
  end if;

  perform crear_notificacion(
    new.workspace_id,
    v_mencionado_profile_id,
    'mencion',
    coalesce(v_autor_nombre, 'Alguien') || ' te mencionó en "' || coalesce(v_entidad_nombre, 'un registro') || '"',
    new.entidad_tipo,
    new.entidad_id,
    v_deep_link,
    jsonb_build_object(
      'autor_nombre', coalesce(v_autor_nombre, ''),
      'entidad_nombre', coalesce(v_entidad_nombre, ''),
      'activity_log_id', new.id
    ),
    true  -- permitir repetidas: dos menciones distintas son dos avisos distintos
  );

  return new;
end;
$$;

-- ── 3. Auto-resolucion de notificaciones que ya no aplican ───────────────────

create or replace function public.resolver_notificaciones_obsoletas()
returns table (motivo text, resueltas integer)
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  v_n integer;
begin
  -- (a) El negocio ya se cerro: nada que perseguir sobre el.
  --     Las menciones NO se tocan: siguen siendo un mensaje de un humano a otro.
  with cerrados as (
    update notificaciones n set estado = 'completada', updated_at = now()
    from negocios neg
    where neg.id = n.entidad_id
      and n.entidad_tipo = 'negocio'
      and n.estado = 'pendiente'
      and n.tipo in ('inactividad_oportunidad', 'inactividad_proyecto', 'responsable_faltante_area')
      and neg.estado <> 'abierto'
    returning n.id
  ) select count(*) into v_n from cerrados;
  motivo := 'negocio_cerrado'; resueltas := v_n; return next;

  -- (b) Ya hay responsable asignado -> la alerta de responsable faltante murio.
  with con_responsable as (
    update notificaciones n set estado = 'completada', updated_at = now()
    where n.estado = 'pendiente'
      and n.tipo = 'responsable_faltante_area'
      and n.entidad_tipo = 'negocio'
      and exists (
        select 1 from negocio_responsables nr where nr.negocio_id = n.entidad_id
      )
    returning n.id
  ) select count(*) into v_n from con_responsable;
  motivo := 'responsable_asignado'; resueltas := v_n; return next;

  -- (c) Hubo actividad DESPUES del aviso -> "lleva N dias sin actividad" ya no
  --     es cierto. Es exactamente la condicion que origino la notificacion.
  with reactivados as (
    update notificaciones n set estado = 'completada', updated_at = now()
    where n.estado = 'pendiente'
      and n.tipo in ('inactividad_oportunidad', 'inactividad_proyecto')
      and n.entidad_tipo = 'negocio'
      and exists (
        select 1 from activity_log al
        where al.entidad_id = n.entidad_id
          and al.created_at > n.created_at
      )
    returning n.id
  ) select count(*) into v_n from reactivados;
  motivo := 'hubo_actividad'; resueltas := v_n; return next;
end;
$$;

revoke execute on function public.resolver_notificaciones_obsoletas() from anon, authenticated;

-- Corre 15 min antes que los crons de inactividad (13:00 UTC) para que la
-- limpieza pase primero y el conteo del dia refleje solo lo que sigue vivo.
select cron.schedule(
  'resolver-notificaciones-obsoletas',
  '45 12 * * *',
  $cron$select public.resolver_notificaciones_obsoletas();$cron$
);
