-- ============================================================
-- FASE 2 — Roles · Areas · Stages: funciones de lock + cron cleanup
-- ============================================================
-- Funciones server-side para lock pesimista sobre bloques:
--   - claim_bloque_lock     : intenta tomar lock (5 min TTL)
--   - release_bloque_lock   : libera lock propio
--   - heartbeat_bloque_lock : renueva expires_at del lock propio
--   - force_unlock_bloque   : owner/admin libera lock ajeno
--
-- Cron de limpieza cada 1 min (pg_cron) elimina locks expirados.
-- Server actions en src/lib/actions/bloque-locks.ts envuelven estas
-- funciones desde Next.js.
-- ============================================================

-- ── claim_bloque_lock ────────────────────────────────────────
-- Retorna JSONB:
--   { ok: true,  lock: {locked_by, locked_at, expires_at} }                 -> exito
--   { ok: false, error: 'busy', held_by: {id, name}, expires_at: ... }     -> ya hay lock vigente de otro
--   { ok: false, error: 'not_found' }                                       -> bloque no existe
--   { ok: false, error: 'forbidden' }                                       -> bloque no es del workspace del caller
-- ============================================================
CREATE OR REPLACE FUNCTION claim_bloque_lock(
  p_bloque_instancia_id UUID,
  p_profile_id UUID,
  p_workspace_id UUID,
  p_ttl_minutes INT DEFAULT 5
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_existing RECORD;
  v_bloque_workspace UUID;
  v_holder_name TEXT;
BEGIN
  -- Validar que el bloque existe y es del workspace del caller
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

  -- Limpieza inline del lock si esta expirado
  DELETE FROM bloque_locks
  WHERE bloque_instancia_id = p_bloque_instancia_id
    AND expires_at < NOW();

  -- Ver si hay lock vigente
  SELECT * INTO v_existing
  FROM bloque_locks
  WHERE bloque_instancia_id = p_bloque_instancia_id;

  IF FOUND THEN
    -- Si el lock es del mismo usuario, renovar (heartbeat implicito en claim)
    IF v_existing.locked_by = p_profile_id THEN
      UPDATE bloque_locks
      SET expires_at = NOW() + (p_ttl_minutes || ' minutes')::interval
      WHERE bloque_instancia_id = p_bloque_instancia_id
      RETURNING locked_by, locked_at, expires_at INTO v_existing;

      RETURN jsonb_build_object(
        'ok', true,
        'lock', jsonb_build_object(
          'locked_by', v_existing.locked_by,
          'locked_at', v_existing.locked_at,
          'expires_at', v_existing.expires_at
        )
      );
    END IF;

    -- Lock ajeno vigente
    SELECT full_name INTO v_holder_name
    FROM profiles
    WHERE id = v_existing.locked_by;

    RETURN jsonb_build_object(
      'ok', false,
      'error', 'busy',
      'held_by', jsonb_build_object('id', v_existing.locked_by, 'name', COALESCE(v_holder_name, 'Otro usuario')),
      'locked_at', v_existing.locked_at,
      'expires_at', v_existing.expires_at
    );
  END IF;

  -- No hay lock, crear
  INSERT INTO bloque_locks (bloque_instancia_id, locked_by, locked_at, expires_at, workspace_id)
  VALUES (
    p_bloque_instancia_id,
    p_profile_id,
    NOW(),
    NOW() + (p_ttl_minutes || ' minutes')::interval,
    p_workspace_id
  );

  RETURN jsonb_build_object(
    'ok', true,
    'lock', jsonb_build_object(
      'locked_by', p_profile_id,
      'locked_at', NOW(),
      'expires_at', NOW() + (p_ttl_minutes || ' minutes')::interval
    )
  );
END;
$$;

-- ── release_bloque_lock ──────────────────────────────────────
-- Borra el lock si y solo si pertenece al caller.
-- Retorna JSONB { ok: true/false, error?: 'not_owner' | 'not_found' }
-- ============================================================
CREATE OR REPLACE FUNCTION release_bloque_lock(
  p_bloque_instancia_id UUID,
  p_profile_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_owner UUID;
BEGIN
  SELECT locked_by INTO v_owner
  FROM bloque_locks
  WHERE bloque_instancia_id = p_bloque_instancia_id;

  IF v_owner IS NULL THEN
    RETURN jsonb_build_object('ok', true, 'note', 'no_lock');
  END IF;

  IF v_owner <> p_profile_id THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_owner');
  END IF;

  DELETE FROM bloque_locks WHERE bloque_instancia_id = p_bloque_instancia_id;
  RETURN jsonb_build_object('ok', true);
END;
$$;

-- ── heartbeat_bloque_lock ────────────────────────────────────
-- Renueva expires_at del lock si pertenece al caller.
-- Retorna JSONB { ok: true, expires_at } / { ok: false, error: ... }
-- ============================================================
CREATE OR REPLACE FUNCTION heartbeat_bloque_lock(
  p_bloque_instancia_id UUID,
  p_profile_id UUID,
  p_ttl_minutes INT DEFAULT 5
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_owner UUID;
  v_new_expires TIMESTAMPTZ;
BEGIN
  SELECT locked_by INTO v_owner
  FROM bloque_locks
  WHERE bloque_instancia_id = p_bloque_instancia_id;

  IF v_owner IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'no_lock');
  END IF;

  IF v_owner <> p_profile_id THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_owner');
  END IF;

  v_new_expires := NOW() + (p_ttl_minutes || ' minutes')::interval;

  UPDATE bloque_locks
  SET expires_at = v_new_expires
  WHERE bloque_instancia_id = p_bloque_instancia_id;

  RETURN jsonb_build_object('ok', true, 'expires_at', v_new_expires);
END;
$$;

-- ── force_unlock_bloque ──────────────────────────────────────
-- Borra el lock sin validar dueno (validacion de rol owner/admin
-- vive en el server action). Inserta activity_log entry para
-- trazabilidad.
-- Retorna JSONB { ok: true } / { ok: false, error: 'not_found' }
-- ============================================================
CREATE OR REPLACE FUNCTION force_unlock_bloque(
  p_bloque_instancia_id UUID,
  p_forced_by UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_lock RECORD;
  v_negocio_id UUID;
BEGIN
  SELECT * INTO v_lock
  FROM bloque_locks
  WHERE bloque_instancia_id = p_bloque_instancia_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_found');
  END IF;

  -- Recuperar negocio_id para audit log
  SELECT negocio_id INTO v_negocio_id
  FROM negocio_bloques
  WHERE id = p_bloque_instancia_id;

  DELETE FROM bloque_locks WHERE bloque_instancia_id = p_bloque_instancia_id;

  -- Activity log (tipo=sistema sobre entidad negocio)
  IF v_negocio_id IS NOT NULL THEN
    INSERT INTO activity_log (
      workspace_id, entidad_tipo, entidad_id, tipo, autor_id, contenido
    )
    VALUES (
      v_lock.workspace_id,
      'negocio',
      v_negocio_id,
      'sistema',
      p_forced_by,
      'Edicion de bloque forzada por owner/admin'
    );
  END IF;

  RETURN jsonb_build_object('ok', true);
END;
$$;

-- ── cleanup_expired_bloque_locks ─────────────────────────────
-- Cron job cada 1 min: elimina locks expirados.
-- ============================================================
CREATE OR REPLACE FUNCTION cleanup_expired_bloque_locks()
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_deleted INTEGER;
BEGIN
  DELETE FROM bloque_locks
  WHERE expires_at < NOW();

  GET DIAGNOSTICS v_deleted = ROW_COUNT;
  RETURN v_deleted;
END;
$$;

-- Registrar cron de limpieza (idempotente)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    -- Eliminar job si ya existe
    PERFORM cron.unschedule(jobid)
    FROM cron.job
    WHERE jobname = 'cleanup_expired_bloque_locks';

    -- Programar cada 1 minuto
    PERFORM cron.schedule(
      'cleanup_expired_bloque_locks',
      '* * * * *',
      $cron$SELECT cleanup_expired_bloque_locks();$cron$
    );
  END IF;
END $$;

COMMENT ON FUNCTION claim_bloque_lock IS 'Lock pesimista: intenta tomar lock con TTL. Modelo roles-areas-stages Fase 2.';
COMMENT ON FUNCTION release_bloque_lock IS 'Libera lock propio. Modelo roles-areas-stages Fase 2.';
COMMENT ON FUNCTION heartbeat_bloque_lock IS 'Renueva expires_at del lock propio. Modelo roles-areas-stages Fase 2.';
COMMENT ON FUNCTION force_unlock_bloque IS 'Desbloqueo forzado (validar rol en server action). Loggea en activity_log.';
COMMENT ON FUNCTION cleanup_expired_bloque_locks IS 'Cron job cada 1 min. Limpia locks expirados.';
