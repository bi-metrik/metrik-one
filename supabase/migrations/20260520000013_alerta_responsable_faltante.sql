-- ============================================================
-- FASE 2 — Roles · Areas · Stages: alerta etapa sin responsable
-- ============================================================
-- Detecta negocios cuyo stage_actual es operativo (venta/ejecucion/cobro)
-- y NO tienen ningun responsable del area duena del stage (ni area
-- transversal 'direccion').
--
-- Cuando detecta: inserta notificacion in-app en cascada al primer
-- destinatario disponible:
--   1. supervisor del area (o direccion)
--   2. si no hay, admins del workspace
--   3. si no, owner del workspace
--
-- Idempotencia: no duplica si ya existe notificacion `pendiente` del
-- mismo tipo para el mismo negocio.
--
-- Cron: diario 13:00 UTC (mismas horas que crones N1/N7).
-- ============================================================

-- ── 1. Ampliar CHECK notificaciones.tipo ─────────────────────
ALTER TABLE notificaciones
  DROP CONSTRAINT IF EXISTS notificaciones_tipo_check;

ALTER TABLE notificaciones
  ADD CONSTRAINT notificaciones_tipo_check
  CHECK (tipo IN (
    'inactividad_oportunidad',
    'handoff',
    'asignacion_responsable',
    'asignacion_colaborador',
    'mencion',
    'streak_roto',
    'inactividad_proyecto',
    'proyecto_entregado',
    'proyecto_cerrado',
    'cobro_vencido',
    'cobro_proximo',
    'plan_terminado',
    'cuenta_cobro_pendiente_aprobacion',
    'cuenta_cobro_enviada',
    'cuenta_cobro_envio_fallo',
    'responsable_faltante_area'
  ));

-- ── 2. Funcion detectar_responsable_faltante_area ────────────
-- Recorre negocios activos sin responsable del area duena y notifica
-- en cascada. Retorna numero de notificaciones creadas.
-- ============================================================
CREATE OR REPLACE FUNCTION detectar_responsable_faltante_area()
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count INTEGER := 0;
  v_negocio RECORD;
  v_area_duena TEXT;
  v_destinatario UUID;
  v_existing UUID;
BEGIN
  FOR v_negocio IN
    SELECT n.id, n.workspace_id, n.codigo, n.nombre, n.stage_actual,
           COALESCE(n.is_paused, false) AS paused
    FROM negocios n
    WHERE n.stage_actual IN ('venta','ejecucion','cobro')
      AND COALESCE(n.is_paused, false) = false
  LOOP
    v_area_duena := CASE v_negocio.stage_actual
      WHEN 'venta' THEN 'comercial'
      WHEN 'ejecucion' THEN 'operaciones'
      WHEN 'cobro' THEN 'financiera'
    END;

    -- Skip si ya tiene responsable del area (incluyendo direccion)
    IF EXISTS (
      SELECT 1
      FROM negocio_responsables nr
      JOIN staff_areas sa ON sa.staff_id = nr.staff_id
      WHERE nr.negocio_id = v_negocio.id
        AND sa.area IN (v_area_duena, 'direccion')
    ) THEN
      CONTINUE;
    END IF;

    -- Idempotencia: skip si ya existe notif pendiente del mismo tipo
    SELECT id INTO v_existing
    FROM notificaciones
    WHERE tipo = 'responsable_faltante_area'
      AND entidad_tipo = 'negocio'
      AND entidad_id = v_negocio.id
      AND estado = 'pendiente'
    LIMIT 1;

    IF v_existing IS NOT NULL THEN
      CONTINUE;
    END IF;

    -- Cascada destinatario: supervisor del area (o direccion) → admin → owner
    -- Buscar profile_id via staff (staff esta linkado a profiles por user_id)
    v_destinatario := NULL;

    -- staff.profile_id linkea a profiles.id (donde vive el role canonico)
    SELECT p.id INTO v_destinatario
    FROM staff s
    JOIN profiles p ON p.id = s.profile_id
    WHERE s.workspace_id = v_negocio.workspace_id
      AND p.role = 'supervisor'
      AND EXISTS (
        SELECT 1 FROM staff_areas sa
        WHERE sa.staff_id = s.id
          AND sa.area IN (v_area_duena, 'direccion')
      )
    ORDER BY s.created_at ASC
    LIMIT 1;

    IF v_destinatario IS NULL THEN
      SELECT p.id INTO v_destinatario
      FROM profiles p
      WHERE p.workspace_id = v_negocio.workspace_id
        AND p.role = 'admin'
      ORDER BY p.created_at ASC
      LIMIT 1;
    END IF;

    IF v_destinatario IS NULL THEN
      SELECT p.id INTO v_destinatario
      FROM profiles p
      WHERE p.workspace_id = v_negocio.workspace_id
        AND p.role = 'owner'
      LIMIT 1;
    END IF;

    -- Si no hay nadie en el WS, skip (caso anomalo, deberia haber owner)
    IF v_destinatario IS NULL THEN
      CONTINUE;
    END IF;

    INSERT INTO notificaciones (
      workspace_id, destinatario_id, tipo, estado,
      contenido, entidad_tipo, entidad_id, deep_link, metadata
    ) VALUES (
      v_negocio.workspace_id,
      v_destinatario,
      'responsable_faltante_area',
      'pendiente',
      'Negocio ' || v_negocio.codigo || ' en stage ' || v_negocio.stage_actual ||
        ' sin responsable de area ' || v_area_duena,
      'negocio',
      v_negocio.id,
      '/negocios/' || v_negocio.id::text,
      jsonb_build_object(
        'area_faltante', v_area_duena,
        'stage_actual', v_negocio.stage_actual,
        'codigo', v_negocio.codigo
      )
    );

    v_count := v_count + 1;
  END LOOP;

  RETURN v_count;
END;
$$;

COMMENT ON FUNCTION detectar_responsable_faltante_area() IS
  'Cron diario: detecta negocios activos sin responsable del area duena del stage '
  'y notifica en cascada (supervisor -> admin -> owner). '
  'Modelo roles-areas-stages Fase 2.';

-- ── 3. Programar cron diario 13:00 UTC ───────────────────────
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    PERFORM cron.unschedule(jobid)
    FROM cron.job
    WHERE jobname = 'detectar_responsable_faltante_area_diario';

    PERFORM cron.schedule(
      'detectar_responsable_faltante_area_diario',
      '0 13 * * *',
      $cron$SELECT detectar_responsable_faltante_area();$cron$
    );
  END IF;
END $$;
