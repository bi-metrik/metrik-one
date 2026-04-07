-- ============================================================
-- Fix: Bloque "datos" fantasma en etapa 3 (Documentación)
--
-- El bloque datos en orden=2 fue creado como 'visible' sin campos
-- (config_extra='{}'). La migración 005 lo marcó como es_gate=true
-- por error (quería marcar el futuro bloque "Validación UPME").
-- Resultado: gate invisible que nunca puede completarse.
--
-- También arregla 3 negocio_bloques de "Documentos de radicación"
-- que tienen 4/4 docs subidos pero estado='pendiente'.
-- ============================================================

DO $$
DECLARE
  v_ghost_config_id UUID := 'cc3545d5-99e2-4c67-aa44-9234c5dd979d';
  v_docs_config_id  UUID := 'e046784e-ea9d-48eb-b58c-19c3fe4de03f';
  v_count INT;
BEGIN

  -- ── 1. Quitar gate del bloque datos fantasma ───────────────────────────────
  UPDATE bloque_configs
  SET es_gate = false
  WHERE id = v_ghost_config_id
    AND es_gate = true;

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RAISE NOTICE 'Ghost gate desactivado: % filas', v_count;

  -- ── 2. Marcar como completo todos los negocio_bloques del fantasma ────────
  -- (son bloques sin campos — no hay nada que completar)
  UPDATE negocio_bloques
  SET estado = 'completo',
      completado_at = NOW(),
      updated_at = NOW()
  WHERE bloque_config_id = v_ghost_config_id
    AND estado = 'pendiente';

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RAISE NOTICE 'Bloques fantasma marcados completo: % filas', v_count;

  -- ── 3. Marcar completo los docs radicación con 4/4 docs subidos ───────────
  UPDATE negocio_bloques
  SET estado = 'completo',
      completado_at = NOW(),
      updated_at = NOW()
  WHERE bloque_config_id = v_docs_config_id
    AND estado = 'pendiente'
    AND data->'docs' IS NOT NULL
    AND jsonb_typeof(data->'docs') = 'object'
    AND (SELECT count(*) FROM jsonb_object_keys(data->'docs')) >= 4;

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RAISE NOTICE 'Docs radicación con 4/4 marcados completo: % filas', v_count;

END $$;
