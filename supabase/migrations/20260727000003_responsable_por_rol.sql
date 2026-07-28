-- Responsable por rol: exactamente un comercial y un operativo por negocio
--
-- PROBLEMA. El aviso de inactividad elegia destinatario por ROL GLOBAL del
-- workspace (`perfiles.find(p => p.role === rol)`), es decir: el primer
-- operator de la lista, el primer supervisor, el owner. Nunca miraba quien
-- lleva el negocio. Medido en SOENA: de 114 avisos pendientes, solo 5 (4%)
-- llegaron a alguien responsable de ese negocio. El 96% fue a gente ajena al
-- caso — incluido el owner de MeTRIK, que no opera el workspace.
--
-- MODELO NUEVO (decision de Mauricio, 2026-07-27). Un negocio tiene DOS
-- espacios de responsabilidad, no una lista abierta:
--   · comercial   — dueño mientras el negocio esta en venta
--   · operaciones — dueño mientras esta en ejecucion
-- Los supervisores NO se asignan como responsables: ya ven todo por rol.
-- Cuando la etapa es financiera (stage 'cobro'), el aviso va a AMBOS.
--
-- El esquema es generico; el routing nuevo se activa por workspace
-- (`config_extra.notificaciones.routing_por_responsable`). Ver la migracion
-- de datos de SOENA en proyectos/soena/ve/migrations/.

-- ── Rol del responsable ──────────────────────────────────────────────────────

alter table public.negocio_responsables
  add column if not exists rol text;

alter table public.negocio_responsables
  drop constraint if exists negocio_responsables_rol_check;

alter table public.negocio_responsables
  add constraint negocio_responsables_rol_check
  check (rol is null or rol in ('comercial', 'operaciones'));

-- Un solo responsable por rol y negocio. Indice PARCIAL: las filas con rol
-- NULL (workspaces que todavia no migraron) no se ven afectadas, asi que la
-- multi-asignacion legacy sigue siendo valida donde aun se use.
create unique index if not exists negocio_responsables_un_rol_por_negocio
  on public.negocio_responsables (negocio_id, rol)
  where rol is not null;

comment on column public.negocio_responsables.rol is
  'comercial | operaciones. Define a quien se le notifica segun el stage de la etapa. NULL = asignacion legacy sin rol (no participa del routing nuevo).';

-- ── Resolver el destinatario de un negocio segun el stage ───────────────────

-- Devuelve los profiles que deben enterarse de algo que pasa en un negocio,
-- segun en manos de quien esta la etapa:
--   venta     -> responsable comercial
--   ejecucion -> responsable operaciones
--   cobro     -> AMBOS (el dinero los toca a los dos)
-- Si el espacio que corresponde esta vacio, escala al SUPERVISOR de esa area
-- (quien puede asignar a alguien). Nunca cae al owner: el owner del workspace
-- puede ser MeTRIK, que no opera el dia a dia del cliente.
create or replace function public.destinatarios_negocio(p_negocio_id uuid)
returns table (profile_id uuid, via text)
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  v_stage text;
  v_ws uuid;
  v_areas text[];
  v_area text;
  v_encontrado boolean;
begin
  select stage_actual, workspace_id into v_stage, v_ws
  from negocios where id = p_negocio_id;

  if v_stage is null then return; end if;

  v_areas := case v_stage
    when 'venta'     then array['comercial']
    when 'ejecucion' then array['operaciones']
    when 'cobro'     then array['comercial', 'operaciones']
    else array[]::text[]
  end;

  foreach v_area in array v_areas loop
    v_encontrado := false;

    -- 1) El responsable del espacio que corresponde
    for profile_id in
      select s.profile_id
      from negocio_responsables nr
      join staff s on s.id = nr.staff_id
      where nr.negocio_id = p_negocio_id
        and nr.rol = v_area
        and s.profile_id is not null
    loop
      v_encontrado := true;
      via := 'responsable_' || v_area;
      return next;
    end loop;

    -- 2) Vacio -> el supervisor de esa area, que es quien puede asignar
    if not v_encontrado then
      for profile_id in
        select s.profile_id
        from staff s
        join staff_areas sa on sa.staff_id = s.id
        join profiles p on p.id = s.profile_id
        where s.workspace_id = v_ws
          and sa.area = v_area
          and p.role = 'supervisor'
          and s.profile_id is not null
      loop
        via := 'supervisor_' || v_area;
        return next;
      end loop;
    end if;
  end loop;
end;
$$;

revoke execute on function public.destinatarios_negocio(uuid) from anon;

comment on function public.destinatarios_negocio(uuid) is
  'Quien debe enterarse de un negocio segun el stage de su etapa. venta->comercial, ejecucion->operaciones, cobro->ambos. Sin responsable, escala al supervisor del area. NUNCA al owner.';

-- ── La alerta de responsable faltante tampoco cae al owner ───────────────────
--
-- `detectar_responsable_faltante_area()` escalaba supervisor -> admin -> owner.
-- El ultimo salto le mandaba al owner de MeTRIK alertas operativas del cliente.
-- Ahora ese salto se omite cuando el workspace declara `nunca_owner`.
create or replace function public.omitir_owner_en_notificaciones(p_workspace_id uuid)
returns boolean
language sql
stable
security definer
set search_path to 'public', 'pg_temp'
as $$
  select coalesce(
    (select (config_extra -> 'notificaciones' ->> 'nunca_owner')::boolean
     from workspaces where id = p_workspace_id),
    false
  );
$$;

revoke execute on function public.omitir_owner_en_notificaciones(uuid) from anon;

-- La alerta de "etapa sin responsable" tiene que hablar el mismo idioma que el
-- modelo de dos espacios. Antes verificaba `staff_areas` del responsable y
-- exigia area 'financiera' en stage cobro; con dos slots (comercial /
-- operaciones) NINGUN negocio en cobro tendria responsable financiero -> habria
-- disparado una alerta falsa por cada negocio en esa etapa.
-- Ahora, en workspaces con routing por responsable: venta exige comercial,
-- ejecucion exige operaciones, y cobro exige AMBOS (es la etapa del dinero).
create or replace function public.detectar_responsable_faltante_area()
returns integer
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_count integer := 0;
  v_negocio record;
  v_area_duena text;
  v_destinatario uuid;
  v_existing uuid;
  v_por_rol boolean;
  v_falta boolean;
begin
  for v_negocio in
    select n.id, n.workspace_id, n.codigo, n.nombre, n.stage_actual
    from negocios n
    where n.stage_actual in ('venta','ejecucion','cobro')
      and coalesce(n.is_paused, false) = false
      and n.estado = 'abierto'
  loop
    v_area_duena := case v_negocio.stage_actual
      when 'venta' then 'comercial'
      when 'ejecucion' then 'operaciones'
      when 'cobro' then 'financiera'
    end;

    v_por_rol := coalesce(
      (select (config_extra -> 'notificaciones' ->> 'routing_por_responsable')::boolean
       from workspaces where id = v_negocio.workspace_id), false);

    if v_por_rol then
      -- Modelo de dos espacios: se evalua por `rol`, no por el area del staff.
      v_falta := case v_negocio.stage_actual
        when 'venta' then not exists (
          select 1 from negocio_responsables nr
          where nr.negocio_id = v_negocio.id and nr.rol = 'comercial')
        when 'ejecucion' then not exists (
          select 1 from negocio_responsables nr
          where nr.negocio_id = v_negocio.id and nr.rol = 'operaciones')
        when 'cobro' then not exists (
          select 1 from negocio_responsables nr
          where nr.negocio_id = v_negocio.id and nr.rol = 'comercial')
          or not exists (
          select 1 from negocio_responsables nr
          where nr.negocio_id = v_negocio.id and nr.rol = 'operaciones')
      end;
      if v_negocio.stage_actual = 'cobro' then
        v_area_duena := 'comercial y operaciones';
      end if;
    else
      v_falta := not exists (
        select 1 from negocio_responsables nr
        join staff_areas sa on sa.staff_id = nr.staff_id
        where nr.negocio_id = v_negocio.id and sa.area in (v_area_duena, 'direccion'));
    end if;

    if not v_falta then continue; end if;

    select id into v_existing from notificaciones
    where tipo = 'responsable_faltante_area' and entidad_tipo = 'negocio'
      and entidad_id = v_negocio.id and estado = 'pendiente'
    limit 1;
    if v_existing is not null then continue; end if;

    v_destinatario := null;

    select p.id into v_destinatario
    from staff s join profiles p on p.id = s.profile_id
    where s.workspace_id = v_negocio.workspace_id and p.role = 'supervisor'
      and exists (select 1 from staff_areas sa where sa.staff_id = s.id
                  and sa.area in (split_part(v_area_duena, ' ', 1), 'direccion'))
    order by s.created_at asc limit 1;

    if v_destinatario is null then
      select p.id into v_destinatario from profiles p
      where p.workspace_id = v_negocio.workspace_id and p.role = 'admin'
      order by p.created_at asc limit 1;
    end if;

    -- El owner solo si el workspace no pidio excluirlo.
    if v_destinatario is null
       and not omitir_owner_en_notificaciones(v_negocio.workspace_id) then
      select p.id into v_destinatario from profiles p
      where p.workspace_id = v_negocio.workspace_id and p.role = 'owner' limit 1;
    end if;

    if v_destinatario is null then continue; end if;

    insert into notificaciones (
      workspace_id, destinatario_id, tipo, estado, contenido,
      entidad_tipo, entidad_id, deep_link, metadata
    ) values (
      v_negocio.workspace_id, v_destinatario, 'responsable_faltante_area', 'pendiente',
      'Negocio ' || v_negocio.codigo || ' en ' || v_negocio.stage_actual ||
        ' sin responsable de ' || v_area_duena,
      'negocio', v_negocio.id, '/negocios/' || v_negocio.id::text,
      jsonb_build_object('area_faltante', v_area_duena, 'stage_actual', v_negocio.stage_actual,
                         'codigo', v_negocio.codigo)
    );
    v_count := v_count + 1;
  end loop;
  return v_count;
end;
$function$;
