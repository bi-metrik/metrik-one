-- ============================================================
-- El resolver y los detectores dejan de contradecirse
--
-- ## EL DEFECTO
--
-- A las 12:45 UTC corre `resolver_notificaciones_obsoletas()` y cierra los avisos que
-- ya no aplican. A las 13:00 corren los detectores y los vuelven a crear. Cada par usa
-- una definicion DISTINTA de "ya no aplica", y esa diferencia es un bucle diario:
-- se cierra, se recrea, se cierra, se recrea, y nadie lo ve porque cada aviso suelto
-- se ve legitimo.
--
-- Medido en produccion (yfjqscvvxetobiidnepa) el 2026-09-01, ventana de 30 dias:
--
--   `responsable_faltante_area`   988 avisos / 191 negocios
--   `inactividad_oportunidad`   2.011 avisos / 343 negocios (5,9 c/u, tope 17)
--   `inactividad_proyecto`        658 avisos / 213 negocios
--
-- De los 75 negocios con 5 o mas avisos de responsable, **74 YA TIENEN responsable**.
-- Uno recibio 30 avisos en 30 dias: uno diario, todos los dias del mes.
-- De los 175 negocios con 5 o mas avisos de inactividad, 137 tienen actividad
-- registrada y solo 39 tienen un comentario.
--
-- Una sola persona (la comercial de SOENA) recibio **2.361 avisos en 30 dias**, mas de
-- 100 por dia habil. El efecto medible de ese volumen es que no se leen: hay 641
-- `inactividad_oportunidad` pendientes sin despachar, la mas vieja del 2026-03-24.
--
-- ### Las dos discrepancias, exactas
--
-- (1) RESPONSABLE. El resolver cierra si existe CUALQUIER fila en
--     `negocio_responsables`. El detector exige un responsable con el ROL que pide el
--     stage: `comercial` en venta, `operaciones` en ejecucion, LOS DOS en cobro. Un
--     negocio en cobro con comercial y sin operaciones cumple la condicion del resolver
--     y falla la del detector, asi que se cierra a las 12:45 y renace a las 13:00.
--
-- (2) INACTIVIDAD. El resolver cierra si hay CUALQUIER fila en `activity_log` posterior
--     al aviso. Los crons solo cuentan como actividad `activity_log` de tipo
--     `comentario` (mas cotizaciones / horas / gastos y `negocios.updated_at`). En 120
--     dias hay 2.568 filas `cambio` y 1.572 `cambio_etapa` contra 190 `comentario`:
--     trabajar el negocio cierra el aviso y NO reinicia el reloj del cron.
--
-- ## POR QUE AHORA EMPEORA SOLO
--
-- La migracion 20260901000010 amplio el CHECK de `activity_log.tipo` de 7 a 15 valores,
-- asi que tipos que antes rebotaban en silencio (`propuesta_aprobada` y los siete
-- restantes) ahora SI se escriben. Mas filas en `activity_log` es mas material para que
-- el resolver cierre avisos que el cron vuelve a crear. Sin esta correccion el bucle
-- crece con el arreglo de al lado.
--
-- ## LA CORRECCION
--
-- No se parcha cada lado por separado. Se deja **UNA sola definicion de cada regla** y
-- los dos lados la llaman. Mientras existan dos copias de la misma regla vuelven a
-- separarse, que es exactamente lo que paso aca y lo que el CHECK de `activity_log`
-- acaba de ensenar en la migracion anterior.
--
--   `debe_alertar_responsable_faltante(negocio)` -> la usa el detector para crear y el
--                                                   resolver para cerrar.
--   `ultima_actividad_negocio(negocio)`          -> la usan los dos crons y el resolver.
--
-- ## QUE SE ESPERA EN LA PRIMERA CORRIDA
--
-- Medido en produccion antes de aplicar, replicando las reglas nuevas como consulta de
-- solo lectura sobre los pendientes de hoy:
--
--   `responsable_faltante_area`: 107 pendientes. La regla VIEJA cerraria 34, y el
--   detector recrearia 20 de ellos manana (son los que tienen algun responsable pero no
--   el del rol que el stage exige). La regla NUEVA cierra 14 y deja 93 abiertos. Cierra
--   MENOS a proposito: esos 20 dejan de cerrarse y recrearse, y quedan como UN aviso
--   parado, que es lo que son. El dedup del detector (`v_existing`) impide el duplicado.
--
--   `inactividad_*`: 678 pendientes. La regla VIEJA cierra 14, la NUEVA cierra 92.
--   Acá cierra MAS, por el otro lado de la misma incoherencia: si `updated_at`, una
--   cotizacion, unas horas o un gasto se movieron despues del aviso, el cron ya
--   consideraba activo al negocio y no iba a repetir, pero el aviso seguia pendiente
--   para siempre porque el resolver no miraba esas senales.
--
-- Los 93 que quedan abiertos son deuda operativa real, no ruido: son negocios a los que
-- de verdad les falta el responsable que su stage exige. Vaciarlos es trabajo del equipo,
-- no de esta migracion.
--
-- ## QUE NO CAMBIA
--
-- Los umbrales (3 dias en venta, 2 en ejecucion) y el reloj en dias corridos siguen
-- igual: son un problema distinto, medido y escrito en
-- `proyectos/soena/ve/2026-09-01_notificaciones-diagnostico-y-sla.md`. Esta migracion
-- no toca ninguna fila de datos, solo redefine funciones.
-- ============================================================


-- ── 1. Que cuenta como gestionar un negocio ────────────────────────────────
--
-- LISTA BLANCA A PROPOSITO, no lista negra. Un tipo nuevo que nadie clasifique NO
-- cuenta como actividad, o sea que el aviso sale igual. El error de una lista blanca
-- es un aviso de mas, que se ve; el de una lista negra es un aviso que nunca sale,
-- que no se ve. Entre los dos, se prefiere el ruidoso.
--
-- QUEDAN FUERA, y por que:
--   `drive_health_failed`, `drive_folder_skipped`, `drive_folder_failed`
--       Los escribe el cron de Drive, todos los dias, sobre el mismo negocio roto.
--       Contarlos silenciaria para siempre justo al negocio que peor esta.
--   `cambio_sistema`
--       Escritura de maquina. Que el sistema se toque a si mismo no es gestion.
--   `platform_admin_enter`, `platform_admin_exit`
--       Auditoria de que alguien de MeTRIK entro al workspace. No es trabajo sobre
--       el negocio del cliente.
--
-- ⚠️ Esta es la UNICA copia de la definicion. Si aparece una segunda en el codigo de
-- un cron, vuelve el bucle que esta migracion cierra.

create or replace function public.ultima_actividad_negocio(p_negocio_id uuid)
returns timestamptz
language sql
stable
security definer
set search_path to 'public'
as $$
  select greatest(
    n.created_at,
    n.updated_at,
    (select max(a.created_at) from activity_log a
      where a.entidad_tipo = 'negocio'
        and a.entidad_id = n.id
        and a.tipo in (
          'comentario', 'cambio', 'cambio_etapa', 'cambio_estado', 'sistema',
          'propuesta_aprobada', 'stage_auto_transition',
          'solicitud_conciliacion', 'conciliacion_atendida'
        )),
    (select max(c.created_at) from cotizaciones c where c.negocio_id = n.id),
    (select max(h.created_at) from horas h        where h.negocio_id = n.id),
    (select max(g.created_at) from gastos g       where g.negocio_id = n.id)
  )
  from negocios n
  where n.id = p_negocio_id;
$$;

comment on function public.ultima_actividad_negocio(uuid) is
  'Ultima vez que alguien gestiono el negocio. Fuente unica: la usan los crons de '
  'inactividad para decidir si avisan y resolver_notificaciones_obsoletas para cerrar '
  'el aviso. Si las dos definiciones se separan, el aviso se cierra a las 12:45 y se '
  'vuelve a crear a las 13:00, todos los dias.';

revoke execute on function public.ultima_actividad_negocio(uuid) from public, anon, authenticated;
grant execute on function public.ultima_actividad_negocio(uuid) to service_role;


-- ── 2. La misma pregunta, para una tanda ───────────────────────────────────
--
-- POR QUE EN LOTE: los crons recorren cientos de negocios y hasta hoy hacian dos o
-- tres consultas por cada uno (343 negocios = ~700 viajes por corrida). Una sola
-- llamada devuelve todo y de paso obliga a que el cron NO tenga su propia copia de
-- la definicion, que es el punto de esta migracion.

create or replace function public.negocios_ultima_actividad(p_ids uuid[])
returns table (negocio_id uuid, ultima_actividad timestamptz)
language sql
stable
security definer
set search_path to 'public'
as $$
  select n.id, ultima_actividad_negocio(n.id)
  from negocios n
  where n.id = any(p_ids);
$$;

comment on function public.negocios_ultima_actividad(uuid[]) is
  'ultima_actividad_negocio para varios negocios en una sola llamada. La usan los crons '
  'de inactividad; no hay version en TypeScript de esta regla a proposito.';

revoke execute on function public.negocios_ultima_actividad(uuid[]) from public, anon, authenticated;
grant execute on function public.negocios_ultima_actividad(uuid[]) to service_role;


-- ── 3. Cuando falta el responsable que el stage exige ──────────────────────
--
-- Devuelve true solo si el aviso DEBE existir. Por eso incluye tambien las condiciones
-- de elegibilidad (abierto, sin pausa, en uno de los tres stages con area duena): asi
-- el resolver puede cerrar con `not debe_alertar_...` un aviso de un negocio que se
-- cerro o se pauso, sin repetir esas condiciones por su cuenta.

create or replace function public.debe_alertar_responsable_faltante(p_negocio_id uuid)
returns boolean
language plpgsql
stable
security definer
set search_path to 'public'
as $$
declare
  v_stage text;
  v_ws uuid;
  v_abierto boolean;
  v_pausado boolean;
  v_por_rol boolean;
  v_area text;
begin
  select n.stage_actual, n.workspace_id, n.estado = 'abierto', coalesce(n.is_paused, false)
    into v_stage, v_ws, v_abierto, v_pausado
  from negocios n where n.id = p_negocio_id;

  if v_stage is null
     or not coalesce(v_abierto, false)
     or v_pausado
     or v_stage not in ('venta', 'ejecucion', 'cobro') then
    return false;
  end if;

  v_por_rol := coalesce(
    (select (config_extra -> 'notificaciones' ->> 'routing_por_responsable')::boolean
     from workspaces where id = v_ws), false);

  if v_por_rol then
    -- Modelo de dos espacios: se evalua por `rol`, no por el area del staff.
    -- En cobro hacen falta LOS DOS; que exista uno no cierra el aviso.
    return case v_stage
      when 'venta' then not exists (
        select 1 from negocio_responsables nr
        where nr.negocio_id = p_negocio_id and nr.rol = 'comercial')
      when 'ejecucion' then not exists (
        select 1 from negocio_responsables nr
        where nr.negocio_id = p_negocio_id and nr.rol = 'operaciones')
      when 'cobro' then not exists (
        select 1 from negocio_responsables nr
        where nr.negocio_id = p_negocio_id and nr.rol = 'comercial')
        or not exists (
        select 1 from negocio_responsables nr
        where nr.negocio_id = p_negocio_id and nr.rol = 'operaciones')
    end;
  end if;

  -- Comportamiento historico: por area del staff, no por rol del negocio.
  v_area := case v_stage
    when 'venta' then 'comercial'
    when 'ejecucion' then 'operaciones'
    when 'cobro' then 'financiera'
  end;

  return not exists (
    select 1 from negocio_responsables nr
    join staff_areas sa on sa.staff_id = nr.staff_id
    where nr.negocio_id = p_negocio_id and sa.area in (v_area, 'direccion'));
end;
$$;

comment on function public.debe_alertar_responsable_faltante(uuid) is
  'true si al negocio le falta el responsable que su stage exige y el aviso debe existir. '
  'Fuente unica: la usan detectar_responsable_faltante_area para crear y '
  'resolver_notificaciones_obsoletas para cerrar. Incluye la elegibilidad (abierto, sin '
  'pausa, stage con area duena) para que el resolver no tenga que repetirla.';

revoke execute on function public.debe_alertar_responsable_faltante(uuid) from public, anon;
grant execute on function public.debe_alertar_responsable_faltante(uuid) to service_role;


-- ── 4. El detector pasa a preguntarle a la funcion ─────────────────────────
--
-- Cambia UNA cosa: donde antes calculaba `v_falta` con su propia copia de la regla,
-- ahora llama a `debe_alertar_responsable_faltante`. El resto (a quien se le avisa,
-- el texto, el escalamiento supervisor -> admin -> owner) queda igual.

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
begin
  for v_negocio in
    select n.id, n.workspace_id, n.codigo, n.nombre, n.stage_actual
    from negocios n
    where n.stage_actual in ('venta','ejecucion','cobro')
      and coalesce(n.is_paused, false) = false
      and n.estado = 'abierto'
  loop
    -- La regla vive en un solo lado. Este `continue` y el `update` del resolver son
    -- ahora la misma condicion negada, que es lo que impide que se contradigan.
    if not debe_alertar_responsable_faltante(v_negocio.id) then continue; end if;

    -- El area solo se usa para el texto y para elegir destinatario.
    v_area_duena := case v_negocio.stage_actual
      when 'venta' then 'comercial'
      when 'ejecucion' then 'operaciones'
      when 'cobro' then 'financiera'
    end;
    if v_negocio.stage_actual = 'cobro'
       and coalesce((select (config_extra -> 'notificaciones' ->> 'routing_por_responsable')::boolean
                     from workspaces where id = v_negocio.workspace_id), false) then
      v_area_duena := 'comercial y operaciones';
    end if;

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

revoke execute on function public.detectar_responsable_faltante_area() from public, anon;
grant execute on function public.detectar_responsable_faltante_area() to authenticated, service_role;


-- ── 5. El resolver cierra con la misma regla con la que se creo ────────────

create or replace function public.resolver_notificaciones_obsoletas()
returns table (motivo text, resueltas integer)
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  v_n integer;
begin
  -- (a) El negocio ya se cerro: nada que perseguir sobre el. Para
  --     `responsable_faltante_area` esto ya lo cubre (b), pero cuesta poco y cierra
  --     tambien los dos tipos de inactividad.
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

  -- (b) ANTES: cerraba si existia cualquier responsable. El detector exige el del rol
  --     del stage, asi que 74 de 75 negocios en bucle ya tenian responsable y volvian
  --     a recibir el aviso al dia siguiente. AHORA los dos preguntan lo mismo.
  with sin_motivo as (
    update notificaciones n set estado = 'completada', updated_at = now()
    where n.estado = 'pendiente'
      and n.tipo = 'responsable_faltante_area'
      and n.entidad_tipo = 'negocio'
      and not debe_alertar_responsable_faltante(n.entidad_id)
    returning n.id
  ) select count(*) into v_n from sin_motivo;
  motivo := 'responsable_asignado'; resueltas := v_n; return next;

  -- (c) ANTES: cerraba con cualquier fila de `activity_log`, mientras el cron solo
  --     contaba `comentario`. Editar un bloque cerraba el aviso sin reiniciar el reloj,
  --     y el aviso volvia. AHORA las dos leen `ultima_actividad_negocio`, asi que el
  --     aviso solo se cierra cuando pasa algo que TAMBIEN reinicia la cuenta del cron.
  with reactivados as (
    update notificaciones n set estado = 'completada', updated_at = now()
    where n.estado = 'pendiente'
      and n.tipo in ('inactividad_oportunidad', 'inactividad_proyecto')
      and n.entidad_tipo = 'negocio'
      and ultima_actividad_negocio(n.entidad_id) > n.created_at
    returning n.id
  ) select count(*) into v_n from reactivados;
  motivo := 'hubo_actividad'; resueltas := v_n; return next;
end;
$$;

comment on function public.resolver_notificaciones_obsoletas() is
  'Cierra avisos que ya no aplican, usando las MISMAS funciones que los detectores usan '
  'para crearlos (debe_alertar_responsable_faltante, ultima_actividad_negocio). Antes '
  'cada lado tenia su copia de la regla y la diferencia era un bucle diario.';

revoke execute on function public.resolver_notificaciones_obsoletas() from anon, authenticated;
grant execute on function public.resolver_notificaciones_obsoletas() to service_role;
