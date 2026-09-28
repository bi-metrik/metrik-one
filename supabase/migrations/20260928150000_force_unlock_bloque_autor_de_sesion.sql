-- Desbloqueo forzado de un bloque: el autor del registro sale de la sesion, no del
-- parametro (sigue a #944, #946 y #947, que cerraron DELETE, UPDATE e INSERT de
-- activity_log por RLS).
--
-- Hueco: `force_unlock_bloque` es SECURITY DEFINER (corre como el dueno de
-- activity_log, sin RLS) e insertaba la entrada con `autor_id = p_forced_by`, un
-- uuid que pone quien llama y que nadie validaba. Una owner/admin del workspace (o
-- un platform_admin) podia, por RPC directo, soltar un bloque y dejar en la
-- Actividad que lo hizo OTRA persona; incluso un staff de otro workspace, porque la
-- FK autor_id -> staff(id) solo exige que exista.
--
-- Llamadores (src/, supabase/functions/, funciones SQL, 2026-09-28): UNO,
-- `forceUnlockBloque` de src/lib/actions/bloque-locks.ts, con cliente de SESION, y
-- ninguna pantalla lo importa hoy. Pasaba `p_forced_by: userId`, que es un
-- `profiles.id` y no un `staff.id`: con la FK a staff ese INSERT fallaba y el
-- desbloqueo entero se revertia. Este mismo PR le hace pasar `staffId` (el de
-- getWorkspace, que en "Ver como" es el del impersonado). Ningun llamador con
-- service_role.
--
-- Arreglo, con la misma firma (uuid, uuid) para no dejar overloads:
--   - Con sesion: `p_forced_by` solo se acepta si pasa
--     `activity_log_autor_coherente(ws, p_forced_by, 'sistema')` (#947): es el staff
--     propio de quien llama en el workspace del bloque, o quien llama es
--     platform_admin y es un staff de ESE workspace ("Ver como"). Si no, se ignora y
--     el autor es el staff propio de quien llama en ese workspace (null si no tiene,
--     p. ej. platform_admin sin staff ahi: lo mismo que registrarActividad).
--   - Sin sesion (service_role / postgres; hoy nadie): `p_forced_by` solo si es un
--     staff del workspace del bloque; si no, null. service_role ya escribe
--     activity_log directo, asi que no se le quita nada: solo se impide que por
--     descuido firme con un staff de otro inquilino.
--   - search_path fijo con pg_temp; EXECUTE revocado a public/anon (como antes).
--
-- Todo lo demas queda igual que 20260901000002: not_found sin lock, guarda de
-- workspace (assert_workspace_del_usuario), forbidden si quien llama no es
-- owner/admin/platform_admin, borra el lock y registra
-- (negocio, 'sistema', 'Edicion de bloque forzada por owner/admin').
--
-- Depende de `activity_log_autor_coherente` (20260928140000, aplicada).

create or replace function public.force_unlock_bloque(p_bloque_instancia_id uuid, p_forced_by uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $fn$
DECLARE v_lock RECORD; v_negocio_id UUID; v_autor UUID;
BEGIN
  SELECT * INTO v_lock FROM bloque_locks WHERE bloque_instancia_id = p_bloque_instancia_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'error', 'not_found'); END IF;

  PERFORM assert_workspace_del_usuario(v_lock.workspace_id);

  IF auth.uid() IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM profiles
    WHERE id = auth.uid()
      AND (role IN ('owner', 'admin') OR platform_admin = true)
  ) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'forbidden');
  END IF;

  -- El autor lo decide la sesion; p_forced_by es solo una sugerencia que se valida.
  IF auth.uid() IS NULL THEN
    SELECT s.id INTO v_autor FROM staff s
    WHERE s.id = p_forced_by AND s.workspace_id = v_lock.workspace_id;
  ELSIF p_forced_by IS NOT NULL
    AND activity_log_autor_coherente(v_lock.workspace_id, p_forced_by, 'sistema') THEN
    v_autor := p_forced_by;
  ELSE
    SELECT s.id INTO v_autor FROM staff s
    WHERE s.profile_id = auth.uid() AND s.workspace_id = v_lock.workspace_id;
  END IF;

  SELECT negocio_id INTO v_negocio_id FROM negocio_bloques WHERE id = p_bloque_instancia_id;
  DELETE FROM bloque_locks WHERE bloque_instancia_id = p_bloque_instancia_id;
  IF v_negocio_id IS NOT NULL THEN
    INSERT INTO activity_log (workspace_id, entidad_tipo, entidad_id, tipo, autor_id, contenido)
    VALUES (v_lock.workspace_id, 'negocio', v_negocio_id, 'sistema', v_autor,
      'Edicion de bloque forzada por owner/admin');
  END IF;
  RETURN jsonb_build_object('ok', true);
END;
$fn$;

revoke execute on function public.force_unlock_bloque(uuid, uuid) from public, anon;
grant  execute on function public.force_unlock_bloque(uuid, uuid) to authenticated, service_role;

comment on function public.force_unlock_bloque(uuid, uuid) is
  'Desbloqueo forzado (owner/admin/platform_admin del workspace del bloque). Registra en activity_log con el autor de la sesion; p_forced_by solo vale si activity_log_autor_coherente lo acepta ("Ver como").';
