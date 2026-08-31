-- Le pone guarda de workspace a las diez funciones SECURITY DEFINER que SI se
-- invocan con la sesion del usuario. Continua 20260901000001, que cerro por
-- revocacion las nueve que solo usa la service role. Estas no se pueden revocar:
-- la app las llama en caliente y quitarles el permiso rompe la campana, la
-- conciliacion, el consecutivo de cuentas de cobro y el bloqueo de bloques.
--
-- El agujero es el mismo: son SECURITY DEFINER, corren como su dueno, no ven RLS,
-- y el `p_workspace_id` lo pone quien llama sin que nadie lo compare contra el
-- workspace de la sesion. Tres ademas escriben: `crear_notificacion` y
-- `crear_notificacion_equipo` insertan avisos con texto y deep link arbitrarios en
-- cualquier workspace, y `resolver_grupo_notificaciones` marca como atendidos los
-- pendientes de otro. `force_unlock_bloque` no comprobaba absolutamente nada: ni
-- workspace ni rol; el "solo owner/admin" vivia unicamente en la server action.
--
-- La guarda se activa SOLO cuando hay sesion. Sin `auth.uid()` (service role,
-- crons, Edge Functions, triggers de sistema) pasa de largo, que es exactamente
-- como corren hoy. `anon` no entra en la cuenta: no tiene execute sobre ninguna.
--
-- Por que comparar contra `profiles.workspace_id`: medido en produccion, los 43
-- perfiles tienen exactamente un workspace, no existe tabla de membresia, ningun
-- correo aparece en dos workspaces y ninguna policy RLS menciona `platform_admin`.
-- El "cambiar de workspace" que se temia no existe como camino de sesion: el
-- override `__dev_ws` solo corre en NODE_ENV=development y ademas cambia al cliente
-- de service role, donde la guarda no aplica.
--
-- Lo que esta guarda NO cierra, dicho para que no se lea como terminado: el
-- `p_profile_id` de los cuatro `bloque_locks` y el `p_resuelta_por` de las
-- notificaciones siguen siendo libres. La impersonacion QA ("Ver como", solo
-- platform_admin) manda el id del usuario mirado y no el de la sesion, con el
-- cliente del admin real: exigir `p_profile_id = auth.uid()` romperia esa funcion.
-- Queda abierto entonces que alguien tome un lock a nombre de un companero DE SU
-- MISMO workspace. Es otro piso, no el cruce entre inquilinos que se cierra aqui.

-- ── La guarda ─────────────────────────────────────────────────────────────────
create or replace function public.assert_workspace_del_usuario(p_workspace_id uuid)
returns void
language plpgsql
stable
security definer
set search_path to 'public', 'pg_temp'
as $fn$
begin
  -- Sin sesion no hay contra quien comparar. No es un hueco: llegar aqui sin
  -- `auth.uid()` exige ser service_role o postgres, que ya tienen todo.
  if auth.uid() is null then
    return;
  end if;

  if p_workspace_id is distinct from (select workspace_id from profiles where id = auth.uid()) then
    raise exception 'workspace ajeno: la sesion no pertenece al workspace pedido'
      using errcode = '42501';
  end if;
end;
$fn$;

revoke execute on function public.assert_workspace_del_usuario(uuid) from public, anon, authenticated;

-- ── Tres cuerpos largos: se envuelven, no se reescriben ───────────────────────
-- El cuerpo de estas tres es largo y con expresiones regulares. Volver a
-- escribirlo para colar una linea de guarda es la clase de cambio que corrompe un
-- backslash sin que nadie lo note hasta que un consecutivo sale mal. Se renombra
-- el cuerpo intacto, se le quita el permiso, y el nombre publico pasa a ser un
-- envoltorio que primero valida y despues delega.

alter function public.count_negocios_por_conciliar(uuid)
  rename to count_negocios_por_conciliar_sin_guarda;
revoke execute on function public.count_negocios_por_conciliar_sin_guarda(uuid)
  from public, anon, authenticated;

create function public.count_negocios_por_conciliar(p_workspace_id uuid)
returns integer
language plpgsql
stable
security definer
set search_path to 'public', 'pg_temp'
as $fn$
begin
  perform assert_workspace_del_usuario(p_workspace_id);
  return count_negocios_por_conciliar_sin_guarda(p_workspace_id);
end;
$fn$;
revoke execute on function public.count_negocios_por_conciliar(uuid) from public, anon;
grant execute on function public.count_negocios_por_conciliar(uuid) to authenticated, service_role;

alter function public.generate_cuenta_cobro_numero(uuid, integer, integer)
  rename to generate_cuenta_cobro_numero_sin_guarda;
revoke execute on function public.generate_cuenta_cobro_numero_sin_guarda(uuid, integer, integer)
  from public, anon, authenticated;

create function public.generate_cuenta_cobro_numero(p_workspace_id uuid, p_anio integer, p_mes integer)
returns text
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $fn$
begin
  perform assert_workspace_del_usuario(p_workspace_id);
  return generate_cuenta_cobro_numero_sin_guarda(p_workspace_id, p_anio, p_mes);
end;
$fn$;
revoke execute on function public.generate_cuenta_cobro_numero(uuid, integer, integer) from public, anon;
grant execute on function public.generate_cuenta_cobro_numero(uuid, integer, integer) to authenticated, service_role;

alter function public.evaluate_stage_rules(uuid, uuid, text)
  rename to evaluate_stage_rules_sin_guarda;
revoke execute on function public.evaluate_stage_rules_sin_guarda(uuid, uuid, text)
  from public, anon, authenticated;

create function public.evaluate_stage_rules(p_entidad_id uuid, p_workspace_id uuid, p_entidad_tipo text)
returns uuid
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $fn$
begin
  perform assert_workspace_del_usuario(p_workspace_id);
  return evaluate_stage_rules_sin_guarda(p_entidad_id, p_workspace_id, p_entidad_tipo);
end;
$fn$;
revoke execute on function public.evaluate_stage_rules(uuid, uuid, text) from public, anon;
grant execute on function public.evaluate_stage_rules(uuid, uuid, text) to authenticated, service_role;

-- ── Siete cuerpos cortos: la guarda va adentro ────────────────────────────────

create or replace function public.crear_notificacion(
  p_workspace_id uuid, p_destinatario_id uuid, p_tipo text, p_contenido text,
  p_entidad_tipo text default null::text, p_entidad_id uuid default null::uuid,
  p_deep_link text default null::text, p_metadata jsonb default '{}'::jsonb,
  p_permitir_repetidas boolean default false)
returns uuid
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $fn$
declare v_id uuid;
begin
  perform assert_workspace_del_usuario(p_workspace_id);

  if not p_permitir_repetidas and exists (
    select 1 from notificaciones
    where destinatario_id = p_destinatario_id and tipo = p_tipo
      and entidad_id is not distinct from p_entidad_id and estado = 'pendiente'
  ) then return null; end if;

  insert into notificaciones (workspace_id, destinatario_id, tipo, contenido,
    entidad_tipo, entidad_id, deep_link, metadata, estado)
  values (p_workspace_id, p_destinatario_id, p_tipo, p_contenido,
    p_entidad_tipo, p_entidad_id, p_deep_link, p_metadata, 'pendiente')
  returning id into v_id;
  return v_id;
end; $fn$;

create or replace function public.crear_notificacion_equipo(
  p_workspace_id uuid, p_area text, p_tipo text, p_contenido text, p_grupo_clave text,
  p_entidad_tipo text default null::text, p_entidad_id uuid default null::uuid,
  p_deep_link text default null::text, p_metadata jsonb default '{}'::jsonb,
  p_excluir_profile_id uuid default null::uuid)
returns integer
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $fn$
declare v_n integer := 0;
begin
  perform assert_workspace_del_usuario(p_workspace_id);

  if exists (select 1 from notificaciones
    where workspace_id = p_workspace_id and grupo_clave = p_grupo_clave and estado='pendiente')
  then return 0; end if;

  insert into notificaciones (workspace_id,destinatario_id,tipo,estado,contenido,
    entidad_tipo,entidad_id,deep_link,metadata,grupo_clave)
  select p_workspace_id, s.profile_id, p_tipo, 'pendiente', p_contenido,
    p_entidad_tipo, p_entidad_id, p_deep_link, p_metadata, p_grupo_clave
  from staff s join staff_areas sa on sa.staff_id = s.id
  where s.workspace_id = p_workspace_id and sa.area = p_area
    and s.profile_id is not null
    and (p_excluir_profile_id is null or s.profile_id <> p_excluir_profile_id);

  get diagnostics v_n = row_count;
  return v_n;
end; $fn$;

create or replace function public.resolver_grupo_notificaciones(
  p_workspace_id uuid, p_grupo_clave text, p_resuelta_por uuid default null::uuid)
returns integer
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $fn$
declare v_n integer := 0;
begin
  perform assert_workspace_del_usuario(p_workspace_id);

  update notificaciones
  set estado='completada', resuelta_por = coalesce(p_resuelta_por, resuelta_por), updated_at = now()
  where workspace_id = p_workspace_id and grupo_clave = p_grupo_clave and estado='pendiente';
  get diagnostics v_n = row_count;
  return v_n;
end; $fn$;

create or replace function public.claim_bloque_lock(
  p_bloque_instancia_id uuid, p_profile_id uuid, p_workspace_id uuid, p_ttl_minutes integer default 5)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $fn$
DECLARE
  v_existing RECORD;
  v_bloque_workspace UUID;
  v_holder_name TEXT;
BEGIN
  -- La comprobacion de abajo ya cotejaba el bloque contra `p_workspace_id`, pero
  -- `p_workspace_id` lo elegia quien llamaba: bastaba mandar el workspace real del
  -- bloque ajeno para que cuadrara. Esta linea es la que ata el parametro a la sesion.
  PERFORM assert_workspace_del_usuario(p_workspace_id);

  SELECT n.workspace_id INTO v_bloque_workspace
  FROM negocio_bloques nb
  JOIN negocios n ON n.id = nb.negocio_id
  WHERE nb.id = p_bloque_instancia_id;

  IF v_bloque_workspace IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_found');
  END IF;
  IF v_bloque_workspace <> p_workspace_id THEN
    RETURN jsonb_build_object('ok', false, 'error', 'forbidden');
  END IF;

  DELETE FROM bloque_locks
  WHERE bloque_instancia_id = p_bloque_instancia_id AND expires_at < NOW();

  SELECT * INTO v_existing
  FROM bloque_locks
  WHERE bloque_instancia_id = p_bloque_instancia_id;

  IF FOUND THEN
    IF v_existing.locked_by = p_profile_id THEN
      UPDATE bloque_locks
      SET expires_at = NOW() + (p_ttl_minutes || ' minutes')::interval
      WHERE bloque_instancia_id = p_bloque_instancia_id
      RETURNING locked_by, locked_at, expires_at INTO v_existing;
      RETURN jsonb_build_object('ok', true,
        'lock', jsonb_build_object(
          'locked_by', v_existing.locked_by,
          'locked_at', v_existing.locked_at,
          'expires_at', v_existing.expires_at));
    END IF;

    SELECT full_name INTO v_holder_name FROM profiles WHERE id = v_existing.locked_by;
    RETURN jsonb_build_object('ok', false, 'error', 'busy',
      'held_by', jsonb_build_object('id', v_existing.locked_by, 'name', COALESCE(v_holder_name, 'Otro usuario')),
      'locked_at', v_existing.locked_at,
      'expires_at', v_existing.expires_at);
  END IF;

  INSERT INTO bloque_locks (bloque_instancia_id, locked_by, locked_at, expires_at, workspace_id)
  VALUES (p_bloque_instancia_id, p_profile_id, NOW(),
          NOW() + (p_ttl_minutes || ' minutes')::interval, p_workspace_id);

  RETURN jsonb_build_object('ok', true,
    'lock', jsonb_build_object(
      'locked_by', p_profile_id,
      'locked_at', NOW(),
      'expires_at', NOW() + (p_ttl_minutes || ' minutes')::interval));
END;
$fn$;

create or replace function public.release_bloque_lock(p_bloque_instancia_id uuid, p_profile_id uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $fn$
DECLARE v_owner UUID; v_ws UUID;
BEGIN
  SELECT locked_by, workspace_id INTO v_owner, v_ws
  FROM bloque_locks WHERE bloque_instancia_id = p_bloque_instancia_id;
  IF v_owner IS NULL THEN RETURN jsonb_build_object('ok', true, 'note', 'no_lock'); END IF;

  -- Esta funcion no recibe workspace: se lee del lock. Va despues del `no_lock`
  -- para que un id inexistente siga respondiendo igual que hoy.
  PERFORM assert_workspace_del_usuario(v_ws);

  IF v_owner <> p_profile_id THEN RETURN jsonb_build_object('ok', false, 'error', 'not_owner'); END IF;
  DELETE FROM bloque_locks WHERE bloque_instancia_id = p_bloque_instancia_id;
  RETURN jsonb_build_object('ok', true);
END;
$fn$;

create or replace function public.heartbeat_bloque_lock(
  p_bloque_instancia_id uuid, p_profile_id uuid, p_ttl_minutes integer default 5)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $fn$
DECLARE v_owner UUID; v_ws UUID; v_new_expires TIMESTAMPTZ;
BEGIN
  SELECT locked_by, workspace_id INTO v_owner, v_ws
  FROM bloque_locks WHERE bloque_instancia_id = p_bloque_instancia_id;
  IF v_owner IS NULL THEN RETURN jsonb_build_object('ok', false, 'error', 'no_lock'); END IF;

  PERFORM assert_workspace_del_usuario(v_ws);

  IF v_owner <> p_profile_id THEN RETURN jsonb_build_object('ok', false, 'error', 'not_owner'); END IF;
  v_new_expires := NOW() + (p_ttl_minutes || ' minutes')::interval;
  UPDATE bloque_locks SET expires_at = v_new_expires WHERE bloque_instancia_id = p_bloque_instancia_id;
  RETURN jsonb_build_object('ok', true, 'expires_at', v_new_expires);
END;
$fn$;

create or replace function public.force_unlock_bloque(p_bloque_instancia_id uuid, p_forced_by uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $fn$
DECLARE v_lock RECORD; v_negocio_id UUID;
BEGIN
  SELECT * INTO v_lock FROM bloque_locks WHERE bloque_instancia_id = p_bloque_instancia_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'error', 'not_found'); END IF;

  PERFORM assert_workspace_del_usuario(v_lock.workspace_id);

  -- El "solo owner/admin" vivia unicamente en la server action: por RPC directo
  -- cualquiera del workspace soltaba el bloque de un companero y firmaba el
  -- activity_log a nombre de quien quisiera. `platform_admin` entra porque es
  -- quien usa "Ver como", donde el rol que manda la app es el del usuario mirado.
  IF auth.uid() IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM profiles
    WHERE id = auth.uid()
      AND (role IN ('owner', 'admin') OR platform_admin = true)
  ) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'forbidden');
  END IF;

  SELECT negocio_id INTO v_negocio_id FROM negocio_bloques WHERE id = p_bloque_instancia_id;
  DELETE FROM bloque_locks WHERE bloque_instancia_id = p_bloque_instancia_id;
  IF v_negocio_id IS NOT NULL THEN
    INSERT INTO activity_log (workspace_id, entidad_tipo, entidad_id, tipo, autor_id, contenido)
    VALUES (v_lock.workspace_id, 'negocio', v_negocio_id, 'sistema', p_forced_by,
      'Edicion de bloque forzada por owner/admin');
  END IF;
  RETURN jsonb_build_object('ok', true);
END;
$fn$;

-- ── Permisos, dichos y no heredados ───────────────────────────────────────────
-- `create or replace` conserva el ACL que la funcion ya tenia, asi que estas siete
-- seguirian correctas por herencia. Se declaran igual: el estado que vale es el que
-- la migracion afirma, no el que arrastra. Es el mismo ACL que tienen hoy en
-- produccion (authenticated y service_role ejecutan, PUBLIC y anon no).
revoke execute on function public.crear_notificacion(uuid, uuid, text, text, text, uuid, text, jsonb, boolean) from public, anon;
grant  execute on function public.crear_notificacion(uuid, uuid, text, text, text, uuid, text, jsonb, boolean) to authenticated, service_role;

revoke execute on function public.crear_notificacion_equipo(uuid, text, text, text, text, text, uuid, text, jsonb, uuid) from public, anon;
grant  execute on function public.crear_notificacion_equipo(uuid, text, text, text, text, text, uuid, text, jsonb, uuid) to authenticated, service_role;

revoke execute on function public.resolver_grupo_notificaciones(uuid, text, uuid) from public, anon;
grant  execute on function public.resolver_grupo_notificaciones(uuid, text, uuid) to authenticated, service_role;

revoke execute on function public.claim_bloque_lock(uuid, uuid, uuid, integer) from public, anon;
grant  execute on function public.claim_bloque_lock(uuid, uuid, uuid, integer) to authenticated, service_role;

revoke execute on function public.release_bloque_lock(uuid, uuid) from public, anon;
grant  execute on function public.release_bloque_lock(uuid, uuid) to authenticated, service_role;

revoke execute on function public.heartbeat_bloque_lock(uuid, uuid, integer) from public, anon;
grant  execute on function public.heartbeat_bloque_lock(uuid, uuid, integer) to authenticated, service_role;

revoke execute on function public.force_unlock_bloque(uuid, uuid) from public, anon;
grant  execute on function public.force_unlock_bloque(uuid, uuid) to authenticated, service_role;
