-- =====================================================
-- Módulo de Notificaciones — Sprint N1-N8b
-- D163: Notificación = tarea pendiente, no log
-- D164: Estado tripartito pendiente|completada|descartada
-- D165: Deep link con CTA
-- D169: NUNCA autor = destinatario
-- D172: etapa_historial
-- D173: fecha_entrega_estimada
-- D176: estado 'entregado' en proyectos
-- =====================================================

-- ── 1. Tabla notificaciones ──────────────────────────

CREATE TABLE IF NOT EXISTS notificaciones (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  destinatario_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  tipo TEXT NOT NULL CHECK (tipo IN (
    'inactividad_oportunidad',
    'handoff',
    'asignacion_responsable',
    'asignacion_colaborador',
    'mencion',
    'streak_roto',
    'inactividad_proyecto',
    'proyecto_entregado',
    'proyecto_cerrado'
  )),
  estado TEXT NOT NULL DEFAULT 'pendiente' CHECK (estado IN ('pendiente', 'completada', 'descartada')),
  contenido TEXT NOT NULL,
  entidad_tipo TEXT CHECK (entidad_tipo IN ('oportunidad', 'proyecto', 'cotizacion')),
  entidad_id UUID,
  deep_link TEXT,
  metadata JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_notificaciones_destinatario ON notificaciones(destinatario_id, estado);
CREATE INDEX IF NOT EXISTS idx_notificaciones_workspace ON notificaciones(workspace_id);
CREATE INDEX IF NOT EXISTS idx_notificaciones_created ON notificaciones(created_at DESC);
-- Para deduplicación en crons
CREATE INDEX IF NOT EXISTS idx_notificaciones_dedup ON notificaciones(entidad_id, tipo, destinatario_id, estado)
  WHERE estado = 'pendiente';

ALTER TABLE notificaciones ENABLE ROW LEVEL SECURITY;

-- Solo el destinatario puede ver y actualizar sus notificaciones
CREATE POLICY "notificaciones_select" ON notificaciones
  FOR SELECT USING (destinatario_id = auth.uid());

CREATE POLICY "notificaciones_update" ON notificaciones
  FOR UPDATE USING (destinatario_id = auth.uid());

-- Service role puede insertar (triggers, crons, edge functions)
CREATE POLICY "notificaciones_insert_service" ON notificaciones
  FOR INSERT WITH CHECK (true);

-- ── 2. Tabla etapa_historial (D172) ─────────────────

CREATE TABLE IF NOT EXISTS etapa_historial (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  oportunidad_id UUID NOT NULL REFERENCES oportunidades(id) ON DELETE CASCADE,
  etapa_anterior TEXT,
  etapa_nueva TEXT NOT NULL,
  cambiado_por UUID REFERENCES profiles(id),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_etapa_historial_oportunidad
  ON etapa_historial(oportunidad_id, created_at DESC);

ALTER TABLE etapa_historial ENABLE ROW LEVEL SECURITY;

CREATE POLICY "etapa_historial_workspace" ON etapa_historial
  FOR ALL USING (workspace_id = current_user_workspace_id());

-- ── 3. Campo fecha_entrega_estimada en proyectos (D173) ──

ALTER TABLE proyectos ADD COLUMN IF NOT EXISTS fecha_entrega_estimada DATE;

-- ── 4. Estado 'entregado' en proyectos (D176) ────────

-- Eliminar constraint existente si lo hay (para poder agregar 'entregado')
ALTER TABLE proyectos DROP CONSTRAINT IF EXISTS proyectos_estado_check;

-- Agregar nuevo constraint con 'entregado'
ALTER TABLE proyectos ADD CONSTRAINT proyectos_estado_check
  CHECK (estado IN ('en_ejecucion', 'pausado', 'completado', 'rework', 'cancelado', 'cerrado', 'entregado'));

-- ── 5. Función helper: notificar (evita duplicados) ──

CREATE OR REPLACE FUNCTION crear_notificacion(
  p_workspace_id UUID,
  p_destinatario_id UUID,
  p_tipo TEXT,
  p_contenido TEXT,
  p_entidad_tipo TEXT DEFAULT NULL,
  p_entidad_id UUID DEFAULT NULL,
  p_deep_link TEXT DEFAULT NULL,
  p_metadata JSONB DEFAULT '{}'
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  -- D169: nunca autor = destinatario se maneja en los triggers que llaman esta función
  -- Deduplicación: no insertar si ya existe notificación pendiente del mismo tipo/entidad/destinatario
  IF p_entidad_id IS NOT NULL THEN
    IF EXISTS (
      SELECT 1 FROM notificaciones
      WHERE destinatario_id = p_destinatario_id
        AND tipo = p_tipo
        AND entidad_id = p_entidad_id
        AND estado = 'pendiente'
    ) THEN
      RETURN;
    END IF;
  END IF;

  INSERT INTO notificaciones (
    workspace_id, destinatario_id, tipo, estado,
    contenido, entidad_tipo, entidad_id, deep_link, metadata
  ) VALUES (
    p_workspace_id, p_destinatario_id, p_tipo, 'pendiente',
    p_contenido, p_entidad_tipo, p_entidad_id, p_deep_link, p_metadata
  );
END;
$$;

-- ── 6. Función helper: resolver rol en workspace ─────

CREATE OR REPLACE FUNCTION get_profile_by_role(
  p_workspace_id UUID,
  p_role TEXT
) RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_profile_id UUID;
BEGIN
  SELECT id INTO v_profile_id
  FROM profiles
  WHERE workspace_id = p_workspace_id
    AND role = p_role
  LIMIT 1;
  RETURN v_profile_id;
END;
$$;

-- ── 7. Trigger: registrar etapa_historial automáticamente ──

CREATE OR REPLACE FUNCTION fn_registrar_etapa_historial()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  IF NEW.etapa IS DISTINCT FROM OLD.etapa THEN
    INSERT INTO etapa_historial (
      workspace_id, oportunidad_id, etapa_anterior, etapa_nueva, cambiado_por
    ) VALUES (
      NEW.workspace_id, NEW.id, OLD.etapa, NEW.etapa, auth.uid()
    );
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_etapa_historial ON oportunidades;
CREATE TRIGGER trg_etapa_historial
  AFTER UPDATE OF etapa ON oportunidades
  FOR EACH ROW
  EXECUTE FUNCTION fn_registrar_etapa_historial();

-- ── 8. Trigger N3: asignacion_responsable ───────────

CREATE OR REPLACE FUNCTION fn_notif_asignacion_responsable()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_autor_profile_id UUID;
  v_asignado_profile_id UUID;
  v_entidad_tipo TEXT;
  v_nombre TEXT;
  v_deep_link TEXT;
BEGIN
  -- Solo si responsable_id cambió y tiene valor
  IF NEW.responsable_id IS NULL OR NEW.responsable_id = OLD.responsable_id THEN
    RETURN NEW;
  END IF;

  -- Determinar tipo de entidad y nombre
  IF TG_TABLE_NAME = 'oportunidades' THEN
    v_entidad_tipo := 'oportunidad';
    v_nombre := NEW.descripcion;
    v_deep_link := '/pipeline/' || NEW.id;
  ELSE
    v_entidad_tipo := 'proyecto';
    v_nombre := NEW.nombre;
    v_deep_link := '/proyectos/' || NEW.id;
  END IF;

  -- Resolver profile del asignado desde staff
  SELECT profile_id INTO v_asignado_profile_id
  FROM staff WHERE id = NEW.responsable_id LIMIT 1;

  IF v_asignado_profile_id IS NULL THEN
    RETURN NEW;
  END IF;

  -- Resolver profile del autor (quien hizo el cambio)
  v_autor_profile_id := auth.uid();

  -- D169: no notificar si el autor es el mismo asignado
  IF v_autor_profile_id = v_asignado_profile_id THEN
    RETURN NEW;
  END IF;

  PERFORM crear_notificacion(
    NEW.workspace_id,
    v_asignado_profile_id,
    'asignacion_responsable',
    'Te asignaron como responsable de "' || COALESCE(v_nombre, 'Sin nombre') || '"',
    v_entidad_tipo,
    NEW.id,
    v_deep_link,
    jsonb_build_object('entidad_nombre', COALESCE(v_nombre, ''))
  );

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_notif_responsable_oportunidad ON oportunidades;
CREATE TRIGGER trg_notif_responsable_oportunidad
  AFTER UPDATE OF responsable_id ON oportunidades
  FOR EACH ROW
  EXECUTE FUNCTION fn_notif_asignacion_responsable();

DROP TRIGGER IF EXISTS trg_notif_responsable_proyecto ON proyectos;
CREATE TRIGGER trg_notif_responsable_proyecto
  AFTER UPDATE OF responsable_id ON proyectos
  FOR EACH ROW
  EXECUTE FUNCTION fn_notif_asignacion_responsable();

-- ── 9. Trigger N4: asignacion_colaborador ───────────

CREATE OR REPLACE FUNCTION fn_notif_colaborador()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_autor_profile_id UUID;
  v_colab_staff_id UUID;
  v_colab_profile_id UUID;
  v_entidad_tipo TEXT;
  v_nombre TEXT;
  v_deep_link TEXT;
  v_colabs_nuevos UUID[];
  v_colab_id UUID;
BEGIN
  -- Solo si colaboradores cambió
  IF NEW.colaboradores IS NOT DISTINCT FROM OLD.colaboradores THEN
    RETURN NEW;
  END IF;

  -- Encontrar colaboradores que se agregaron (están en NEW pero no en OLD)
  v_colabs_nuevos := ARRAY(
    SELECT unnest(COALESCE(NEW.colaboradores::UUID[], ARRAY[]::UUID[]))
    EXCEPT
    SELECT unnest(COALESCE(OLD.colaboradores::UUID[], ARRAY[]::UUID[]))
  );

  IF array_length(v_colabs_nuevos, 1) IS NULL THEN
    RETURN NEW;
  END IF;

  IF TG_TABLE_NAME = 'oportunidades' THEN
    v_entidad_tipo := 'oportunidad';
    v_nombre := NEW.descripcion;
    v_deep_link := '/pipeline/' || NEW.id;
  ELSE
    v_entidad_tipo := 'proyecto';
    v_nombre := NEW.nombre;
    v_deep_link := '/proyectos/' || NEW.id;
  END IF;

  v_autor_profile_id := auth.uid();

  FOREACH v_colab_id IN ARRAY v_colabs_nuevos
  LOOP
    SELECT profile_id INTO v_colab_profile_id
    FROM staff WHERE id = v_colab_id LIMIT 1;

    IF v_colab_profile_id IS NULL THEN
      CONTINUE;
    END IF;

    -- D169: no notificar al autor
    IF v_autor_profile_id = v_colab_profile_id THEN
      CONTINUE;
    END IF;

    PERFORM crear_notificacion(
      NEW.workspace_id,
      v_colab_profile_id,
      'asignacion_colaborador',
      'Te agregaron como colaborador en "' || COALESCE(v_nombre, 'Sin nombre') || '"',
      v_entidad_tipo,
      NEW.id,
      v_deep_link,
      jsonb_build_object('entidad_nombre', COALESCE(v_nombre, ''))
    );
  END LOOP;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_notif_colaborador_oportunidad ON oportunidades;
CREATE TRIGGER trg_notif_colaborador_oportunidad
  AFTER UPDATE OF colaboradores ON oportunidades
  FOR EACH ROW
  EXECUTE FUNCTION fn_notif_colaborador();

DROP TRIGGER IF EXISTS trg_notif_colaborador_proyecto ON proyectos;
CREATE TRIGGER trg_notif_colaborador_proyecto
  AFTER UPDATE OF colaboradores ON proyectos
  FOR EACH ROW
  EXECUTE FUNCTION fn_notif_colaborador();

-- ── 10. Trigger N5: mención @ en activity_log ───────

CREATE OR REPLACE FUNCTION fn_notif_mencion()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_autor_profile_id UUID;
  v_mencionado_profile_id UUID;
  v_autor_nombre TEXT;
  v_entidad_nombre TEXT;
  v_deep_link TEXT;
BEGIN
  -- Solo menciones con mencion_id
  IF NEW.mencion_id IS NULL THEN
    RETURN NEW;
  END IF;

  -- Resolver profile del mencionado (staff → profile)
  SELECT profile_id INTO v_mencionado_profile_id
  FROM staff WHERE id = NEW.mencion_id LIMIT 1;

  IF v_mencionado_profile_id IS NULL THEN
    RETURN NEW;
  END IF;

  -- Resolver autor profile
  SELECT profile_id INTO v_autor_profile_id
  FROM staff WHERE id = NEW.autor_id LIMIT 1;

  -- D169: no notificar si autor = mencionado
  IF v_autor_profile_id = v_mencionado_profile_id THEN
    RETURN NEW;
  END IF;

  -- Nombre del autor
  SELECT full_name INTO v_autor_nombre
  FROM staff WHERE id = NEW.autor_id LIMIT 1;

  -- Nombre de la entidad
  IF NEW.entidad_tipo = 'oportunidad' THEN
    SELECT descripcion INTO v_entidad_nombre FROM oportunidades WHERE id = NEW.entidad_id;
    v_deep_link := '/pipeline/' || NEW.entidad_id;
  ELSIF NEW.entidad_tipo = 'proyecto' THEN
    SELECT nombre INTO v_entidad_nombre FROM proyectos WHERE id = NEW.entidad_id;
    v_deep_link := '/proyectos/' || NEW.entidad_id;
  ELSE
    v_entidad_nombre := NULL;
    v_deep_link := NULL;
  END IF;

  PERFORM crear_notificacion(
    NEW.workspace_id,
    v_mencionado_profile_id,
    'mencion',
    COALESCE(v_autor_nombre, 'Alguien') || ' te mencionó en "' || COALESCE(v_entidad_nombre, 'un registro') || '"',
    NEW.entidad_tipo,
    NEW.entidad_id,
    v_deep_link,
    jsonb_build_object(
      'autor_nombre', COALESCE(v_autor_nombre, ''),
      'entidad_nombre', COALESCE(v_entidad_nombre, ''),
      'activity_log_id', NEW.id
    )
  );

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_notif_mencion ON activity_log;
CREATE TRIGGER trg_notif_mencion
  AFTER INSERT ON activity_log
  FOR EACH ROW
  WHEN (NEW.mencion_id IS NOT NULL AND NEW.tipo = 'comentario')
  EXECUTE FUNCTION fn_notif_mencion();

-- ── 11. Trigger N2: handoff oportunidad ganada ───────

CREATE OR REPLACE FUNCTION fn_notif_handoff()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_proyecto RECORD;
  v_responsable_profile_id UUID;
  v_supervisor_profile_id UUID;
  v_owner_profile_id UUID;
  v_destinatario_id UUID;
  v_contenido TEXT;
BEGIN
  -- Solo cuando etapa cambia a 'ganada'
  IF NEW.etapa <> 'ganada' OR OLD.etapa = 'ganada' THEN
    RETURN NEW;
  END IF;

  -- Buscar el proyecto creado para esta oportunidad
  SELECT * INTO v_proyecto
  FROM proyectos
  WHERE oportunidad_id = NEW.id
  ORDER BY created_at DESC
  LIMIT 1;

  IF v_proyecto IS NULL THEN
    RETURN NEW;
  END IF;

  -- Roles de fallback
  v_supervisor_profile_id := get_profile_by_role(NEW.workspace_id, 'admin');
  v_owner_profile_id := get_profile_by_role(NEW.workspace_id, 'owner');

  IF v_proyecto.responsable_id IS NOT NULL THEN
    -- Resolver profile del responsable
    SELECT profile_id INTO v_responsable_profile_id
    FROM staff WHERE id = v_proyecto.responsable_id LIMIT 1;

    IF v_responsable_profile_id IS NOT NULL THEN
      v_destinatario_id := v_responsable_profile_id;
      v_contenido := 'Nuevo proyecto asignado a ti: "' || v_proyecto.nombre || '"';
    END IF;
  END IF;

  IF v_destinatario_id IS NULL THEN
    -- Sin responsable: notificar supervisor o owner
    v_destinatario_id := COALESCE(v_supervisor_profile_id, v_owner_profile_id);
    IF v_destinatario_id IS NOT NULL THEN
      v_contenido := 'Proyecto "' || v_proyecto.nombre || '" creado sin responsable — asigna a alguien';
    END IF;
  END IF;

  IF v_destinatario_id IS NULL THEN
    RETURN NEW;
  END IF;

  PERFORM crear_notificacion(
    NEW.workspace_id,
    v_destinatario_id,
    'handoff',
    v_contenido,
    'proyecto',
    v_proyecto.id,
    '/proyectos/' || v_proyecto.id,
    jsonb_build_object(
      'oportunidad_id', NEW.id,
      'proyecto_nombre', v_proyecto.nombre
    )
  );

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_notif_handoff ON oportunidades;
CREATE TRIGGER trg_notif_handoff
  AFTER UPDATE OF etapa ON oportunidades
  FOR EACH ROW
  EXECUTE FUNCTION fn_notif_handoff();

-- ── 12. Trigger N8a: proyecto entregado ─────────────

CREATE OR REPLACE FUNCTION fn_notif_proyecto_entregado()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_owner_profile_id UUID;
  v_admin_profile_id UUID;
  v_cartera NUMERIC;
  v_contenido TEXT;
BEGIN
  IF NEW.estado <> 'entregado' OR OLD.estado = 'entregado' THEN
    RETURN NEW;
  END IF;

  -- Calcular cartera pendiente
  SELECT
    COALESCE(SUM(f.monto), 0) - COALESCE(SUM(c.monto), 0)
  INTO v_cartera
  FROM facturas f
  LEFT JOIN cobros c ON c.factura_id = f.id
  WHERE f.proyecto_id = NEW.id;

  v_cartera := COALESCE(v_cartera, 0);

  IF v_cartera > 0 THEN
    v_contenido := 'Proyecto "' || NEW.nombre || '" entregado — pendiente por cobrar: $' ||
      TO_CHAR(v_cartera, 'FM999,999,999');
  ELSE
    v_contenido := 'Proyecto "' || NEW.nombre || '" entregado — recaudo completo';
  END IF;

  -- Notificar a owner y admin
  v_owner_profile_id := get_profile_by_role(NEW.workspace_id, 'owner');
  v_admin_profile_id := get_profile_by_role(NEW.workspace_id, 'admin');

  IF v_owner_profile_id IS NOT NULL THEN
    PERFORM crear_notificacion(
      NEW.workspace_id, v_owner_profile_id, 'proyecto_entregado', v_contenido,
      'proyecto', NEW.id, '/proyectos/' || NEW.id,
      jsonb_build_object('cartera', v_cartera)
    );
  END IF;

  IF v_admin_profile_id IS NOT NULL AND v_admin_profile_id <> COALESCE(v_owner_profile_id, gen_random_uuid()) THEN
    PERFORM crear_notificacion(
      NEW.workspace_id, v_admin_profile_id, 'proyecto_entregado', v_contenido,
      'proyecto', NEW.id, '/proyectos/' || NEW.id,
      jsonb_build_object('cartera', v_cartera)
    );
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_notif_proyecto_entregado ON proyectos;
CREATE TRIGGER trg_notif_proyecto_entregado
  AFTER UPDATE OF estado ON proyectos
  FOR EACH ROW
  EXECUTE FUNCTION fn_notif_proyecto_entregado();

-- ── 13. Trigger N8b: proyecto cerrado automático cuando cartera == 0 ──

CREATE OR REPLACE FUNCTION fn_auto_cerrar_proyecto_entregado()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_proyecto RECORD;
  v_cartera NUMERIC;
  v_owner_profile_id UUID;
  v_responsable_profile_id UUID;
BEGIN
  -- Trigger en cobros: verificar si el proyecto asociado está 'entregado' y cartera = 0
  IF NEW.proyecto_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT * INTO v_proyecto FROM proyectos WHERE id = NEW.proyecto_id;

  IF v_proyecto IS NULL OR v_proyecto.estado <> 'entregado' THEN
    RETURN NEW;
  END IF;

  -- Calcular cartera total
  SELECT
    COALESCE(SUM(f.monto), 0) - COALESCE(SUM(c.monto), 0)
  INTO v_cartera
  FROM facturas f
  LEFT JOIN cobros c ON c.factura_id = f.id
  WHERE f.proyecto_id = NEW.proyecto_id;

  v_cartera := COALESCE(v_cartera, 0);

  IF v_cartera > 0 THEN
    RETURN NEW; -- todavía hay cartera pendiente
  END IF;

  -- Cerrar proyecto automáticamente
  UPDATE proyectos
  SET estado = 'cerrado',
      fecha_cierre = CURRENT_DATE,
      updated_at = NOW()
  WHERE id = NEW.proyecto_id;

  -- N8b: notificar cierre
  v_owner_profile_id := get_profile_by_role(v_proyecto.workspace_id, 'owner');

  IF v_owner_profile_id IS NOT NULL THEN
    PERFORM crear_notificacion(
      v_proyecto.workspace_id, v_owner_profile_id, 'proyecto_cerrado',
      'Proyecto "' || v_proyecto.nombre || '" cerrado — recaudo 100% completo',
      'proyecto', v_proyecto.id, '/proyectos/' || v_proyecto.id,
      jsonb_build_object('auto_cerrado', true)
    );
  END IF;

  -- También notificar al responsable si existe
  IF v_proyecto.responsable_id IS NOT NULL THEN
    SELECT profile_id INTO v_responsable_profile_id
    FROM staff WHERE id = v_proyecto.responsable_id LIMIT 1;

    IF v_responsable_profile_id IS NOT NULL
      AND v_responsable_profile_id <> COALESCE(v_owner_profile_id, gen_random_uuid())
    THEN
      PERFORM crear_notificacion(
        v_proyecto.workspace_id, v_responsable_profile_id, 'proyecto_cerrado',
        'Proyecto "' || v_proyecto.nombre || '" cerrado — recaudo 100% completo',
        'proyecto', v_proyecto.id, '/proyectos/' || v_proyecto.id,
        jsonb_build_object('auto_cerrado', true)
      );
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_auto_cerrar_proyecto ON cobros;
CREATE TRIGGER trg_auto_cerrar_proyecto
  AFTER INSERT OR UPDATE ON cobros
  FOR EACH ROW
  EXECUTE FUNCTION fn_auto_cerrar_proyecto_entregado();

-- ── 14. D170: Avance calculado en v_proyecto_financiero ──
-- Fórmula adaptativa: 40% horas, 30% presupuesto, 30% facturación
-- Si falta una variable, redistribuir proporcionalmente

DROP VIEW IF EXISTS v_proyecto_financiero;
CREATE VIEW v_proyecto_financiero AS
SELECT
  p.id AS proyecto_id,
  p.workspace_id,
  p.codigo,
  p.nombre,
  p.estado,
  p.tipo,
  p.presupuesto_total,
  p.horas_estimadas,
  p.avance_porcentaje,
  p.ganancia_estimada,
  p.retenciones_estimadas,
  p.carpeta_url,
  p.fecha_inicio,
  p.fecha_fin_estimada,
  p.fecha_entrega_estimada,
  p.fecha_cierre,
  p.oportunidad_id,
  p.cotizacion_id,
  p.canal_creacion,
  p.created_at,
  p.updated_at,
  e.nombre AS empresa_nombre,
  ct.nombre AS contacto_nombre,
  COALESCE(h.total_horas, 0) AS horas_reales,
  COALESCE(h.costo_horas, 0) AS costo_horas,
  COALESCE(g.total_gastos, 0) AS gastos_directos,
  COALESCE(h.costo_horas, 0) + COALESCE(g.total_gastos, 0) AS costo_acumulado,
  CASE WHEN p.presupuesto_total > 0 THEN
    ROUND(((COALESCE(h.costo_horas, 0) + COALESCE(g.total_gastos, 0)) / p.presupuesto_total) * 100, 1)
  ELSE 0 END AS presupuesto_consumido_pct,
  COALESCE(f.total_facturado, 0) AS facturado,
  COALESCE(f.num_facturas, 0)::INTEGER AS num_facturas,
  COALESCE(c.total_cobrado, 0) AS cobrado,
  COALESCE(c.num_cobros, 0)::INTEGER AS num_cobros,
  COALESCE(c.total_cobrado, 0)
    - (COALESCE(h.costo_horas, 0) + COALESCE(g.total_gastos, 0))
  AS ganancia_actual,
  -- D170: Avance calculado adaptativo (40% horas, 30% presupuesto, 30% facturación)
  CASE
    WHEN p.estado IN ('cerrado', 'entregado') THEN
      CASE WHEN p.estado = 'cerrado' THEN 100.0 ELSE
        -- entregado: usar avance calculado
        LEAST(100.0, GREATEST(0.0,
          CASE
            -- Todas las variables disponibles
            WHEN p.horas_estimadas > 0 AND p.presupuesto_total > 0 AND f.total_facturado > 0 THEN
              ROUND(
                (LEAST(COALESCE(h.total_horas, 0) / p.horas_estimadas, 1.0) * 40.0) +
                (LEAST(COALESCE(h.costo_horas, 0) + COALESCE(g.total_gastos, 0), p.presupuesto_total) / p.presupuesto_total * 30.0) +
                (LEAST(COALESCE(c.total_cobrado, 0), COALESCE(f.total_facturado, 0)) / f.total_facturado * 30.0),
                1
              )
            -- Sin horas estimadas: redistribuir (50% presupuesto, 50% facturación)
            WHEN p.horas_estimadas IS NULL OR p.horas_estimadas = 0 THEN
              CASE
                WHEN p.presupuesto_total > 0 AND f.total_facturado > 0 THEN
                  ROUND(
                    (LEAST(COALESCE(h.costo_horas, 0) + COALESCE(g.total_gastos, 0), p.presupuesto_total) / p.presupuesto_total * 50.0) +
                    (LEAST(COALESCE(c.total_cobrado, 0), COALESCE(f.total_facturado, 0)) / f.total_facturado * 50.0),
                    1
                  )
                WHEN p.presupuesto_total > 0 THEN
                  ROUND(
                    LEAST((COALESCE(h.costo_horas, 0) + COALESCE(g.total_gastos, 0)) / p.presupuesto_total, 1.0) * 100.0,
                    1
                  )
                ELSE 0.0
              END
            -- Sin facturación: redistribuir (57% horas, 43% presupuesto)
            WHEN f.total_facturado IS NULL OR f.total_facturado = 0 THEN
              CASE
                WHEN p.horas_estimadas > 0 AND p.presupuesto_total > 0 THEN
                  ROUND(
                    (LEAST(COALESCE(h.total_horas, 0) / p.horas_estimadas, 1.0) * 57.14) +
                    (LEAST(COALESCE(h.costo_horas, 0) + COALESCE(g.total_gastos, 0), p.presupuesto_total) / p.presupuesto_total * 42.86),
                    1
                  )
                WHEN p.horas_estimadas > 0 THEN
                  ROUND(LEAST(COALESCE(h.total_horas, 0) / p.horas_estimadas, 1.0) * 100.0, 1)
                ELSE 0.0
              END
            -- Sin presupuesto: redistribuir (57% horas, 43% facturación)
            WHEN p.presupuesto_total IS NULL OR p.presupuesto_total = 0 THEN
              CASE
                WHEN p.horas_estimadas > 0 AND f.total_facturado > 0 THEN
                  ROUND(
                    (LEAST(COALESCE(h.total_horas, 0) / p.horas_estimadas, 1.0) * 57.14) +
                    (LEAST(COALESCE(c.total_cobrado, 0), COALESCE(f.total_facturado, 0)) / f.total_facturado * 42.86),
                    1
                  )
                WHEN p.horas_estimadas > 0 THEN
                  ROUND(LEAST(COALESCE(h.total_horas, 0) / p.horas_estimadas, 1.0) * 100.0, 1)
                ELSE 0.0
              END
            ELSE 0.0
          END
        ))
      END
    ELSE
      -- En ejecución: cálculo normal
      LEAST(100.0, GREATEST(0.0,
        CASE
          WHEN p.horas_estimadas > 0 AND p.presupuesto_total > 0 AND COALESCE(f.total_facturado, 0) > 0 THEN
            ROUND(
              (LEAST(COALESCE(h.total_horas, 0) / p.horas_estimadas, 1.0) * 40.0) +
              (LEAST(COALESCE(h.costo_horas, 0) + COALESCE(g.total_gastos, 0), p.presupuesto_total) / p.presupuesto_total * 30.0) +
              (LEAST(COALESCE(c.total_cobrado, 0), COALESCE(f.total_facturado, 0)) / COALESCE(f.total_facturado, 1) * 30.0),
              1
            )
          WHEN (p.horas_estimadas IS NULL OR p.horas_estimadas = 0) AND p.presupuesto_total > 0 AND COALESCE(f.total_facturado, 0) > 0 THEN
            ROUND(
              (LEAST(COALESCE(h.costo_horas, 0) + COALESCE(g.total_gastos, 0), p.presupuesto_total) / p.presupuesto_total * 50.0) +
              (LEAST(COALESCE(c.total_cobrado, 0), COALESCE(f.total_facturado, 0)) / COALESCE(f.total_facturado, 1) * 50.0),
              1
            )
          WHEN (p.horas_estimadas IS NULL OR p.horas_estimadas = 0) AND p.presupuesto_total > 0 THEN
            ROUND(
              LEAST((COALESCE(h.costo_horas, 0) + COALESCE(g.total_gastos, 0)) / p.presupuesto_total, 1.0) * 100.0,
              1
            )
          WHEN p.horas_estimadas > 0 AND p.presupuesto_total > 0 THEN
            ROUND(
              (LEAST(COALESCE(h.total_horas, 0) / p.horas_estimadas, 1.0) * 57.14) +
              (LEAST(COALESCE(h.costo_horas, 0) + COALESCE(g.total_gastos, 0), p.presupuesto_total) / p.presupuesto_total * 42.86),
              1
            )
          WHEN p.horas_estimadas > 0 THEN
            ROUND(LEAST(COALESCE(h.total_horas, 0) / p.horas_estimadas, 1.0) * 100.0, 1)
          ELSE 0.0
        END
      ))
  END AS avance_calculado
FROM proyectos p
LEFT JOIN empresas e ON e.id = p.empresa_id
LEFT JOIN contactos ct ON ct.id = p.contacto_id
LEFT JOIN LATERAL (
  SELECT
    SUM(hr.horas) AS total_horas,
    SUM(hr.horas * COALESCE(s.salary / NULLIF(s.horas_disponibles_mes, 0), 0)) AS costo_horas
  FROM horas hr
  LEFT JOIN staff s ON s.id = hr.staff_id
  WHERE hr.proyecto_id = p.id
) h ON true
LEFT JOIN LATERAL (
  SELECT SUM(gs.monto) AS total_gastos
  FROM gastos gs
  WHERE gs.proyecto_id = p.id
    AND gs.estado_causacion = 'APROBADO'
) g ON true
LEFT JOIN LATERAL (
  SELECT SUM(fa.monto) AS total_facturado, COUNT(*) AS num_facturas
  FROM facturas fa
  WHERE fa.proyecto_id = p.id
) f ON true
LEFT JOIN LATERAL (
  SELECT SUM(cb.monto) AS total_cobrado, COUNT(*) AS num_cobros
  FROM cobros cb
  WHERE cb.proyecto_id = p.id
) c ON true;

ALTER VIEW public.v_proyecto_financiero SET (security_invoker = true);
