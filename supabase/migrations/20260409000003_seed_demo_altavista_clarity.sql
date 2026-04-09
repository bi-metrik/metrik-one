-- ============================================================
-- DEMO WORKSPACE: Constructora Altavista
-- Clarity implementation — ejecucion stage only
-- Línea custom "Obras Civiles" con 3 etapas en ejecucion
-- ============================================================

-- 0. Add stages_activos and linea_activa_id to workspaces (if not exist)
ALTER TABLE workspaces ADD COLUMN IF NOT EXISTS stages_activos JSONB DEFAULT '["venta","ejecucion","cobro"]'::jsonb;
ALTER TABLE workspaces ADD COLUMN IF NOT EXISTS linea_activa_id UUID REFERENCES lineas_negocio(id) ON DELETE SET NULL;

DO $$
DECLARE
  v_ws_id UUID := 'b0000000-0000-0000-0000-000000000001';
  -- Línea + etapas
  v_linea_id UUID := 'b0000000-0000-0000-0000-000000000100';
  v_etapa_planeacion UUID := 'b0000000-0000-0000-0000-000000000201';
  v_etapa_ejecucion  UUID := 'b0000000-0000-0000-0000-000000000202';
  v_etapa_entrega    UUID := 'b0000000-0000-0000-0000-000000000203';
  -- Empresas
  v_emp1_id UUID := 'b0000000-0000-0000-0001-000000000001';
  v_emp2_id UUID := 'b0000000-0000-0000-0001-000000000002';
  v_emp3_id UUID := 'b0000000-0000-0000-0001-000000000003';
  -- Contactos
  v_con1_id UUID := 'b0000000-0000-0000-0002-000000000001';
  v_con2_id UUID := 'b0000000-0000-0000-0002-000000000002';
  v_con3_id UUID := 'b0000000-0000-0000-0002-000000000003';
  -- Staff
  v_staff1_id UUID := 'b0000000-0000-0000-0003-000000000001';
  v_staff2_id UUID := 'b0000000-0000-0000-0003-000000000002';
  v_staff3_id UUID := 'b0000000-0000-0000-0003-000000000003';
  v_staff4_id UUID := 'b0000000-0000-0000-0003-000000000004';
  -- Negocios
  v_neg1_id UUID := 'b0000000-0000-0000-0004-000000000001';
  v_neg2_id UUID := 'b0000000-0000-0000-0004-000000000002';
  v_neg3_id UUID := 'b0000000-0000-0000-0004-000000000003';
  v_neg4_id UUID := 'b0000000-0000-0000-0004-000000000004';
  v_neg5_id UUID := 'b0000000-0000-0000-0004-000000000005';
  -- Bloque definition IDs (lookup)
  v_bd_equipo UUID;
  v_bd_cronograma UUID;
  v_bd_datos UUID;
  v_bd_ejecucion UUID;
  v_bd_resumen UUID;
  v_bd_documentos UUID;
  v_bd_checklist UUID;
  -- Bloque config IDs (deterministic for negocio_bloques)
  -- Planeacion: 3 configs
  v_bc_plan_equipo UUID := 'b0000000-0000-0000-0010-000000000001';
  v_bc_plan_crono  UUID := 'b0000000-0000-0000-0010-000000000002';
  v_bc_plan_datos  UUID := 'b0000000-0000-0000-0010-000000000003';
  -- Ejecucion: 2 configs
  v_bc_ejec_ejecucion UUID := 'b0000000-0000-0000-0010-000000000004';
  v_bc_ejec_resumen   UUID := 'b0000000-0000-0000-0010-000000000005';
  -- Entrega: 3 configs
  v_bc_ent_docs     UUID := 'b0000000-0000-0000-0010-000000000006';
  v_bc_ent_check    UUID := 'b0000000-0000-0000-0010-000000000007';
  v_bc_ent_resumen  UUID := 'b0000000-0000-0000-0010-000000000008';
BEGIN

  -- ══════════════════════════════════════════════════════════
  -- 1. WORKSPACE
  -- ══════════════════════════════════════════════════════════
  INSERT INTO workspaces (id, slug, name, stages_activos, created_at)
  VALUES (v_ws_id, 'altavista-demo', 'Constructora Altavista', '["ejecucion"]'::jsonb, NOW())
  ON CONFLICT (slug) DO NOTHING;

  -- ══════════════════════════════════════════════════════════
  -- 2. LINEA CLARITY + 3 ETAPAS (all in ejecucion stage)
  -- ══════════════════════════════════════════════════════════
  INSERT INTO lineas_negocio (id, workspace_id, nombre, descripcion, tipo)
  VALUES (v_linea_id, v_ws_id, 'Obras Civiles', 'Gestión de obras civiles — seguimiento de ejecución, costos y entregables', 'clarity')
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO etapas_negocio (id, linea_id, stage, nombre, orden) VALUES
    (v_etapa_planeacion, v_linea_id, 'ejecucion', 'Planeacion', 1),
    (v_etapa_ejecucion,  v_linea_id, 'ejecucion', 'Ejecucion',  2),
    (v_etapa_entrega,    v_linea_id, 'ejecucion', 'Entrega',     3)
  ON CONFLICT (id) DO NOTHING;

  -- Set linea_activa
  UPDATE workspaces SET linea_activa_id = v_linea_id WHERE id = v_ws_id;

  -- ══════════════════════════════════════════════════════════
  -- 3. LOOKUP BLOQUE DEFINITIONS
  -- ══════════════════════════════════════════════════════════
  SELECT id INTO v_bd_equipo      FROM bloque_definitions WHERE tipo = 'equipo';
  SELECT id INTO v_bd_cronograma  FROM bloque_definitions WHERE tipo = 'cronograma';
  SELECT id INTO v_bd_datos       FROM bloque_definitions WHERE tipo = 'datos';
  SELECT id INTO v_bd_ejecucion   FROM bloque_definitions WHERE tipo = 'ejecucion';
  SELECT id INTO v_bd_resumen     FROM bloque_definitions WHERE tipo = 'resumen_financiero';
  SELECT id INTO v_bd_documentos  FROM bloque_definitions WHERE tipo = 'documentos';
  SELECT id INTO v_bd_checklist   FROM bloque_definitions WHERE tipo = 'checklist';

  -- ══════════════════════════════════════════════════════════
  -- 4. BLOQUE CONFIGS PER ETAPA
  -- ══════════════════════════════════════════════════════════

  -- ── Etapa: Planeacion ──────────────────────────────────────
  INSERT INTO bloque_configs (id, etapa_id, workspace_id, bloque_definition_id, nombre, estado, orden, es_gate, config_extra) VALUES
    (v_bc_plan_equipo, v_etapa_planeacion, v_ws_id, v_bd_equipo, 'Equipo de obra', 'editable', 0, true, '{}'::jsonb),
    (v_bc_plan_crono,  v_etapa_planeacion, v_ws_id, v_bd_cronograma, 'Cronograma', 'editable', 1, false, '{}'::jsonb),
    (v_bc_plan_datos,  v_etapa_planeacion, v_ws_id, v_bd_datos, 'Datos de la obra', 'editable', 2, false,
      jsonb_build_object(
        'fields', jsonb_build_array(
          jsonb_build_object('slug', 'fecha_inicio',  'label', 'Fecha inicio',           'tipo', 'date', 'required', true),
          jsonb_build_object('slug', 'fecha_entrega', 'label', 'Fecha entrega estimada', 'tipo', 'date', 'required', true),
          jsonb_build_object('slug', 'ubicacion',     'label', 'Ubicación obra',         'tipo', 'text', 'required', false)
        )
      )
    )
  ON CONFLICT (id) DO NOTHING;

  -- ── Etapa: Ejecucion ──────────────────────────────────────
  INSERT INTO bloque_configs (id, etapa_id, workspace_id, bloque_definition_id, nombre, estado, orden, es_gate, config_extra) VALUES
    (v_bc_ejec_ejecucion, v_etapa_ejecucion, v_ws_id, v_bd_ejecucion, 'Ejecución', 'visible', 0, false, '{}'::jsonb),
    (v_bc_ejec_resumen,   v_etapa_ejecucion, v_ws_id, v_bd_resumen,   'Resumen financiero', 'visible', 1, false, '{}'::jsonb)
  ON CONFLICT (id) DO NOTHING;

  -- ── Etapa: Entrega ─────────────────────────────────────────
  INSERT INTO bloque_configs (id, etapa_id, workspace_id, bloque_definition_id, nombre, estado, orden, es_gate, config_extra) VALUES
    (v_bc_ent_docs, v_etapa_entrega, v_ws_id, v_bd_documentos, 'Documentos de entrega', 'editable', 0, true,
      jsonb_build_object(
        'documentos', jsonb_build_array(
          jsonb_build_object('slug', 'acta_entrega',        'label', 'Acta de entrega',       'required', true),
          jsonb_build_object('slug', 'registro_fotografico','label', 'Registro fotográfico',  'required', true),
          jsonb_build_object('slug', 'planos_asbuilt',      'label', 'Planos as-built',       'required', false)
        )
      )
    ),
    (v_bc_ent_check, v_etapa_entrega, v_ws_id, v_bd_checklist, 'Checklist de entrega', 'editable', 1, true,
      jsonb_build_object(
        'items', jsonb_build_array(
          jsonb_build_object('label', 'Inspección final completada',          'required', true),
          jsonb_build_object('label', 'Documentación entregada al cliente',   'required', true),
          jsonb_build_object('label', 'Garantías firmadas',                   'required', true),
          jsonb_build_object('label', 'Limpieza de obra',                     'required', false)
        )
      )
    ),
    (v_bc_ent_resumen, v_etapa_entrega, v_ws_id, v_bd_resumen, 'Resumen financiero', 'visible', 2, false, '{}'::jsonb)
  ON CONFLICT (id) DO NOTHING;

  -- ══════════════════════════════════════════════════════════
  -- 5. EMPRESAS (3 clients)
  -- ══════════════════════════════════════════════════════════
  INSERT INTO empresas (id, workspace_id, nombre, numero_documento, created_at) VALUES
    (v_emp1_id, v_ws_id, 'Conjunto Res. El Roble',   '900567890-1', NOW()),
    (v_emp2_id, v_ws_id, 'Centro Comercial Norte',   '900678901-2', NOW()),
    (v_emp3_id, v_ws_id, 'Edificio Mirador',         '900789012-3', NOW())
  ON CONFLICT (id) DO NOTHING;

  -- ══════════════════════════════════════════════════════════
  -- 6. CONTACTOS (3)
  -- ══════════════════════════════════════════════════════════
  INSERT INTO contactos (id, workspace_id, nombre, telefono, email, created_at) VALUES
    (v_con1_id, v_ws_id, 'Andrés Mejía',      '+573105551234', 'andres@elroble.co',    NOW()),
    (v_con2_id, v_ws_id, 'Patricia Herrera',   '+573105552345', 'patricia@ccnorte.co',  NOW()),
    (v_con3_id, v_ws_id, 'Fernando Castro',    '+573105553456', 'fernando@mirador.co',  NOW())
  ON CONFLICT (id) DO NOTHING;

  -- ══════════════════════════════════════════════════════════
  -- 7. STAFF (4)
  -- ══════════════════════════════════════════════════════════
  INSERT INTO staff (id, workspace_id, full_name, tipo_vinculo, salary, es_principal, is_active, created_at) VALUES
    (v_staff1_id, v_ws_id, 'Carlos Reyes',    'empleado',    6000000, true,  true, NOW()),
    (v_staff2_id, v_ws_id, 'Laura Gómez',     'empleado',    4500000, false, true, NOW()),
    (v_staff3_id, v_ws_id, 'Ing. Martínez',   'contratista', 5000000, false, true, NOW()),
    (v_staff4_id, v_ws_id, 'Arq. Vega',       'contratista', 4000000, false, true, NOW())
  ON CONFLICT (id) DO NOTHING;

  -- ══════════════════════════════════════════════════════════
  -- 8. GASTOS FIJOS (5)
  -- ══════════════════════════════════════════════════════════
  INSERT INTO gastos_fijos_config (id, workspace_id, nombre, categoria, monto_referencia, activo, created_at) VALUES
    (gen_random_uuid(), v_ws_id, 'Oficina y bodega',          'arriendo',                2000000, true, NOW()),
    (gen_random_uuid(), v_ws_id, 'Seguros',                   'otros',                    800000, true, NOW()),
    (gen_random_uuid(), v_ws_id, 'Software (AutoCAD, BIM)',   'software',                 400000, true, NOW()),
    (gen_random_uuid(), v_ws_id, 'Transporte',                'transporte',              1200000, true, NOW()),
    (gen_random_uuid(), v_ws_id, 'Contador',                  'servicios_profesionales', 1000000, true, NOW());

  -- ══════════════════════════════════════════════════════════
  -- 9. CONFIG METAS (4 months)
  -- ══════════════════════════════════════════════════════════
  INSERT INTO config_metas (id, workspace_id, mes, meta_ventas_mensual, meta_recaudo_mensual, created_at) VALUES
    (gen_random_uuid(), v_ws_id, '2026-01-01', 50000000, 40000000, NOW()),
    (gen_random_uuid(), v_ws_id, '2026-02-01', 50000000, 40000000, NOW()),
    (gen_random_uuid(), v_ws_id, '2026-03-01', 55000000, 45000000, NOW()),
    (gen_random_uuid(), v_ws_id, '2026-04-01', 55000000, 45000000, NOW())
  ON CONFLICT (workspace_id, mes) DO NOTHING;

  -- ══════════════════════════════════════════════════════════
  -- 10. SALDOS BANCO (4 monthly snapshots)
  -- ══════════════════════════════════════════════════════════
  INSERT INTO saldos_banco (id, workspace_id, saldo_real, saldo_teorico, diferencia, fecha, registrado_via, created_at) VALUES
    (gen_random_uuid(), v_ws_id, 45000000, 44500000,  500000, '2026-01-31T18:00:00Z', 'app', '2026-01-31T18:00:00Z'),
    (gen_random_uuid(), v_ws_id, 58000000, 57200000,  800000, '2026-02-28T18:00:00Z', 'app', '2026-02-28T18:00:00Z'),
    (gen_random_uuid(), v_ws_id, 72000000, 71500000,  500000, '2026-03-31T18:00:00Z', 'app', '2026-03-31T18:00:00Z'),
    (gen_random_uuid(), v_ws_id, 80000000, 79200000,  800000, '2026-04-07T18:00:00Z', 'app', '2026-04-07T18:00:00Z');

  -- ══════════════════════════════════════════════════════════
  -- 11. NEGOCIOS (5 — all in ejecucion stage)
  -- ══════════════════════════════════════════════════════════
  INSERT INTO negocios (id, workspace_id, linea_id, empresa_id, contacto_id, nombre, codigo, precio_aprobado, stage_actual, etapa_actual_id, estado, created_at) VALUES
    (v_neg1_id, v_ws_id, v_linea_id, v_emp1_id, v_con1_id, 'Remodelación lobby',         'ROB-01', 85000000,  'ejecucion', v_etapa_planeacion, 'activo', '2026-02-01T10:00:00Z'),
    (v_neg2_id, v_ws_id, v_linea_id, v_emp1_id, v_con1_id, 'Parqueadero cubierto',       'ROB-02', 120000000, 'ejecucion', v_etapa_ejecucion,  'activo', '2026-01-15T10:00:00Z'),
    (v_neg3_id, v_ws_id, v_linea_id, v_emp2_id, v_con2_id, 'Ampliación zona comidas',    'CCN-01', 95000000,  'ejecucion', v_etapa_ejecucion,  'activo', '2026-01-20T10:00:00Z'),
    (v_neg4_id, v_ws_id, v_linea_id, v_emp3_id, v_con3_id, 'Terraza piso 12',            'MIR-01', 68000000,  'ejecucion', v_etapa_ejecucion,  'activo', '2026-02-10T10:00:00Z'),
    (v_neg5_id, v_ws_id, v_linea_id, v_emp2_id, v_con2_id, 'Fachada sur',                'CCN-02', 45000000,  'ejecucion', v_etapa_entrega,    'activo', '2025-11-01T10:00:00Z')
  ON CONFLICT (id) DO NOTHING;

  -- ══════════════════════════════════════════════════════════
  -- 12. NEGOCIO BLOQUES (instances per negocio per etapa)
  -- ══════════════════════════════════════════════════════════

  -- Negocio 1 (etapa: Planeacion) — bloques de Planeacion: pendiente
  INSERT INTO negocio_bloques (id, negocio_id, bloque_config_id, estado, data) VALUES
    ('b0000000-0000-0000-0020-000000000001', v_neg1_id, v_bc_plan_equipo, 'pendiente', '{}'::jsonb),
    ('b0000000-0000-0000-0020-000000000002', v_neg1_id, v_bc_plan_crono,  'pendiente', '{}'::jsonb),
    ('b0000000-0000-0000-0020-000000000003', v_neg1_id, v_bc_plan_datos,  'pendiente',
      jsonb_build_object('fecha_inicio', '2026-03-15', 'ubicacion', 'Cra 7 #45-12, Bogotá')
    )
  ON CONFLICT (id) DO NOTHING;

  -- Negocio 2 (etapa: Ejecucion) — Planeacion (completo) + Ejecucion (pendiente)
  INSERT INTO negocio_bloques (id, negocio_id, bloque_config_id, estado, data) VALUES
    ('b0000000-0000-0000-0020-000000000010', v_neg2_id, v_bc_plan_equipo, 'completo', '{}'::jsonb),
    ('b0000000-0000-0000-0020-000000000011', v_neg2_id, v_bc_plan_crono,  'completo', '{}'::jsonb),
    ('b0000000-0000-0000-0020-000000000012', v_neg2_id, v_bc_plan_datos,  'completo',
      jsonb_build_object('fecha_inicio', '2026-01-20', 'fecha_entrega', '2026-06-30', 'ubicacion', 'Cll 100 #15-20, Bogotá')
    ),
    ('b0000000-0000-0000-0020-000000000013', v_neg2_id, v_bc_ejec_ejecucion, 'pendiente', '{}'::jsonb),
    ('b0000000-0000-0000-0020-000000000014', v_neg2_id, v_bc_ejec_resumen,   'pendiente', '{}'::jsonb)
  ON CONFLICT (id) DO NOTHING;

  -- Negocio 3 (etapa: Ejecucion) — same structure as neg2
  INSERT INTO negocio_bloques (id, negocio_id, bloque_config_id, estado, data) VALUES
    ('b0000000-0000-0000-0020-000000000020', v_neg3_id, v_bc_plan_equipo, 'completo', '{}'::jsonb),
    ('b0000000-0000-0000-0020-000000000021', v_neg3_id, v_bc_plan_crono,  'completo', '{}'::jsonb),
    ('b0000000-0000-0000-0020-000000000022', v_neg3_id, v_bc_plan_datos,  'completo',
      jsonb_build_object('fecha_inicio', '2026-02-01', 'fecha_entrega', '2026-07-15', 'ubicacion', 'Av. 68 #22-10, Bogotá')
    ),
    ('b0000000-0000-0000-0020-000000000023', v_neg3_id, v_bc_ejec_ejecucion, 'pendiente', '{}'::jsonb),
    ('b0000000-0000-0000-0020-000000000024', v_neg3_id, v_bc_ejec_resumen,   'pendiente', '{}'::jsonb)
  ON CONFLICT (id) DO NOTHING;

  -- Negocio 4 (etapa: Ejecucion) — same structure
  INSERT INTO negocio_bloques (id, negocio_id, bloque_config_id, estado, data) VALUES
    ('b0000000-0000-0000-0020-000000000030', v_neg4_id, v_bc_plan_equipo, 'completo', '{}'::jsonb),
    ('b0000000-0000-0000-0020-000000000031', v_neg4_id, v_bc_plan_crono,  'completo', '{}'::jsonb),
    ('b0000000-0000-0000-0020-000000000032', v_neg4_id, v_bc_plan_datos,  'completo',
      jsonb_build_object('fecha_inicio', '2026-02-15', 'fecha_entrega', '2026-05-30', 'ubicacion', 'Cra 11 #93-60, piso 12, Bogotá')
    ),
    ('b0000000-0000-0000-0020-000000000033', v_neg4_id, v_bc_ejec_ejecucion, 'pendiente', '{}'::jsonb),
    ('b0000000-0000-0000-0020-000000000034', v_neg4_id, v_bc_ejec_resumen,   'pendiente', '{}'::jsonb)
  ON CONFLICT (id) DO NOTHING;

  -- Negocio 5 (etapa: Entrega) — Planeacion (completo) + Ejecucion (completo) + Entrega (pendiente)
  INSERT INTO negocio_bloques (id, negocio_id, bloque_config_id, estado, data) VALUES
    ('b0000000-0000-0000-0020-000000000040', v_neg5_id, v_bc_plan_equipo, 'completo', '{}'::jsonb),
    ('b0000000-0000-0000-0020-000000000041', v_neg5_id, v_bc_plan_crono,  'completo', '{}'::jsonb),
    ('b0000000-0000-0000-0020-000000000042', v_neg5_id, v_bc_plan_datos,  'completo',
      jsonb_build_object('fecha_inicio', '2025-11-15', 'fecha_entrega', '2026-03-30', 'ubicacion', 'Av. 68 #22-10, fachada sur, Bogotá')
    ),
    ('b0000000-0000-0000-0020-000000000043', v_neg5_id, v_bc_ejec_ejecucion, 'completo', '{}'::jsonb),
    ('b0000000-0000-0000-0020-000000000044', v_neg5_id, v_bc_ejec_resumen,   'completo', '{}'::jsonb),
    ('b0000000-0000-0000-0020-000000000045', v_neg5_id, v_bc_ent_docs,    'pendiente', '{}'::jsonb),
    ('b0000000-0000-0000-0020-000000000046', v_neg5_id, v_bc_ent_check,   'pendiente', '{}'::jsonb),
    ('b0000000-0000-0000-0020-000000000047', v_neg5_id, v_bc_ent_resumen, 'pendiente', '{}'::jsonb)
  ON CONFLICT (id) DO NOTHING;

  -- ══════════════════════════════════════════════════════════
  -- 13. GASTOS (35 records, Jan-Apr 2026)
  -- Distributed across negocios 2-5 + empresa-level
  -- ══════════════════════════════════════════════════════════
  INSERT INTO gastos (id, workspace_id, fecha, monto, categoria, tipo, descripcion, negocio_id, estado_causacion, canal_registro, created_at) VALUES
    -- Negocio 2: Parqueadero cubierto (7 gastos)
    ('b0000000-0000-0000-00a0-000000000001', v_ws_id, '2026-01-22', 4500000, 'materiales',              'directo', 'Concreto premezclado — cimentación',       v_neg2_id, 'APROBADO', 'app', '2026-01-22T09:00:00Z'),
    ('b0000000-0000-0000-00a0-000000000002', v_ws_id, '2026-02-05', 3200000, 'materiales',              'directo', 'Acero estructural columnas',               v_neg2_id, 'APROBADO', 'app', '2026-02-05T10:00:00Z'),
    ('b0000000-0000-0000-00a0-000000000003', v_ws_id, '2026-02-18', 2800000, 'servicios_profesionales', 'directo', 'Topografía y replanteo',                   v_neg2_id, 'APROBADO', 'app', '2026-02-18T11:00:00Z'),
    ('b0000000-0000-0000-00a0-000000000004', v_ws_id, '2026-03-01', 1500000, 'transporte',              'directo', 'Alquiler volqueta 5 viajes',               v_neg2_id, 'APROBADO', 'app', '2026-03-01T08:00:00Z'),
    ('b0000000-0000-0000-00a0-000000000005', v_ws_id, '2026-03-15', 5200000, 'materiales',              'directo', 'Cubierta metálica — estructura',           v_neg2_id, 'APROBADO', 'app', '2026-03-15T14:00:00Z'),
    ('b0000000-0000-0000-00a0-000000000006', v_ws_id, '2026-03-28', 1800000, 'servicios_profesionales', 'directo', 'Ensayos de resistencia concreto',          v_neg2_id, 'APROBADO', 'app', '2026-03-28T09:00:00Z'),
    ('b0000000-0000-0000-00a0-000000000007', v_ws_id, '2026-04-05', 3500000, 'materiales',              'directo', 'Instalaciones eléctricas iluminación',     v_neg2_id, 'APROBADO', 'app', '2026-04-05T10:00:00Z'),

    -- Negocio 3: Ampliación zona comidas (8 gastos)
    ('b0000000-0000-0000-00a0-000000000008', v_ws_id, '2026-01-25', 3800000, 'materiales',              'directo', 'Demolición y retiro de escombros',         v_neg3_id, 'APROBADO', 'app', '2026-01-25T09:00:00Z'),
    ('b0000000-0000-0000-00a0-000000000009', v_ws_id, '2026-02-08', 2500000, 'materiales',              'directo', 'Bloques y mortero para muros nuevos',      v_neg3_id, 'APROBADO', 'app', '2026-02-08T10:00:00Z'),
    ('b0000000-0000-0000-00a0-000000000010', v_ws_id, '2026-02-20', 1800000, 'servicios_profesionales', 'directo', 'Diseño de redes hidrosanitarias',          v_neg3_id, 'APROBADO', 'app', '2026-02-20T11:00:00Z'),
    ('b0000000-0000-0000-00a0-000000000011', v_ws_id, '2026-03-05', 4200000, 'materiales',              'directo', 'Piso porcelanato zona comidas',            v_neg3_id, 'APROBADO', 'app', '2026-03-05T14:00:00Z'),
    ('b0000000-0000-0000-00a0-000000000012', v_ws_id, '2026-03-18', 950000,  'transporte',              'directo', 'Transporte materiales desde Soacha',       v_neg3_id, 'APROBADO', 'app', '2026-03-18T08:00:00Z'),
    ('b0000000-0000-0000-00a0-000000000013', v_ws_id, '2026-03-30', 2200000, 'servicios_profesionales', 'directo', 'Instalación sistema de extracción cocinas', v_neg3_id, 'APROBADO', 'app', '2026-03-30T09:00:00Z'),
    ('b0000000-0000-0000-00a0-000000000014', v_ws_id, '2026-04-02', 1600000, 'materiales',              'directo', 'Pintura y acabados zona comidas',          v_neg3_id, 'APROBADO', 'app', '2026-04-02T10:00:00Z'),
    ('b0000000-0000-0000-00a0-000000000015', v_ws_id, '2026-04-07', 800000,  'transporte',              'directo', 'Transporte final equipos',                 v_neg3_id, 'APROBADO', 'app', '2026-04-07T11:00:00Z'),

    -- Negocio 4: Terraza piso 12 (7 gastos)
    ('b0000000-0000-0000-00a0-000000000016', v_ws_id, '2026-02-15', 2200000, 'materiales',              'directo', 'Impermeabilización terraza',               v_neg4_id, 'APROBADO', 'app', '2026-02-15T09:00:00Z'),
    ('b0000000-0000-0000-00a0-000000000017', v_ws_id, '2026-02-28', 3100000, 'materiales',              'directo', 'Deck madera sintética para piso',          v_neg4_id, 'APROBADO', 'app', '2026-02-28T10:00:00Z'),
    ('b0000000-0000-0000-00a0-000000000018', v_ws_id, '2026-03-10', 1500000, 'servicios_profesionales', 'directo', 'Diseño paisajístico',                      v_neg4_id, 'APROBADO', 'app', '2026-03-10T11:00:00Z'),
    ('b0000000-0000-0000-00a0-000000000019', v_ws_id, '2026-03-22', 1800000, 'materiales',              'directo', 'Materas y jardinería',                     v_neg4_id, 'APROBADO', 'app', '2026-03-22T14:00:00Z'),
    ('b0000000-0000-0000-00a0-000000000020', v_ws_id, '2026-04-01', 2400000, 'materiales',              'directo', 'Pérgola metálica',                         v_neg4_id, 'APROBADO', 'app', '2026-04-01T09:00:00Z'),
    ('b0000000-0000-0000-00a0-000000000021', v_ws_id, '2026-04-04', 700000,  'transporte',              'directo', 'Transporte materiales piso 12',            v_neg4_id, 'APROBADO', 'app', '2026-04-04T08:00:00Z'),
    ('b0000000-0000-0000-00a0-000000000022', v_ws_id, '2026-04-08', 900000,  'servicios_profesionales', 'directo', 'Instalación iluminación terraza',          v_neg4_id, 'APROBADO', 'app', '2026-04-08T10:00:00Z'),

    -- Negocio 5: Fachada sur (6 gastos — proyecto casi terminado)
    ('b0000000-0000-0000-00a0-000000000023', v_ws_id, '2025-11-15', 5500000, 'materiales',              'directo', 'Andamios y equipo de altura',              v_neg5_id, 'APROBADO', 'app', '2025-11-15T09:00:00Z'),
    ('b0000000-0000-0000-00a0-000000000024', v_ws_id, '2025-12-10', 3800000, 'materiales',              'directo', 'Pintura fachada anti-humedad',             v_neg5_id, 'APROBADO', 'app', '2025-12-10T10:00:00Z'),
    ('b0000000-0000-0000-00a0-000000000025', v_ws_id, '2026-01-08', 2200000, 'servicios_profesionales', 'directo', 'Mano de obra especializada altura',        v_neg5_id, 'APROBADO', 'app', '2026-01-08T11:00:00Z'),
    ('b0000000-0000-0000-00a0-000000000026', v_ws_id, '2026-01-25', 1500000, 'materiales',              'directo', 'Sellante y acabado final',                 v_neg5_id, 'APROBADO', 'app', '2026-01-25T14:00:00Z'),
    ('b0000000-0000-0000-00a0-000000000027', v_ws_id, '2026-02-10', 800000,  'transporte',              'directo', 'Retiro andamios y limpieza',               v_neg5_id, 'APROBADO', 'app', '2026-02-10T09:00:00Z'),
    ('b0000000-0000-0000-00a0-000000000028', v_ws_id, '2026-02-20', 600000,  'transporte',              'directo', 'Retiro escombros fachada',                 v_neg5_id, 'APROBADO', 'app', '2026-02-20T10:00:00Z'),

    -- Empresa-level (7 gastos — sin negocio)
    ('b0000000-0000-0000-00a0-000000000029', v_ws_id, '2026-01-05', 2000000, 'arriendo',    'fijo',      'Arriendo oficina y bodega — enero',  NULL, 'APROBADO', 'app', '2026-01-05T08:00:00Z'),
    ('b0000000-0000-0000-00a0-000000000030', v_ws_id, '2026-01-10',  800000, 'otros',       'fijo',      'Seguros — enero',                    NULL, 'APROBADO', 'app', '2026-01-10T08:00:00Z'),
    ('b0000000-0000-0000-00a0-000000000031', v_ws_id, '2026-02-05', 2000000, 'arriendo',    'fijo',      'Arriendo oficina y bodega — febrero', NULL, 'APROBADO', 'app', '2026-02-05T08:00:00Z'),
    ('b0000000-0000-0000-00a0-000000000032', v_ws_id, '2026-02-10',  400000, 'software',    'fijo',      'AutoCAD + BIM — febrero',             NULL, 'APROBADO', 'app', '2026-02-10T08:00:00Z'),
    ('b0000000-0000-0000-00a0-000000000033', v_ws_id, '2026-03-05', 2000000, 'arriendo',    'fijo',      'Arriendo oficina y bodega — marzo',   NULL, 'APROBADO', 'app', '2026-03-05T08:00:00Z'),
    ('b0000000-0000-0000-00a0-000000000034', v_ws_id, '2026-03-10', 1200000, 'transporte',  'operativo', 'Transporte general equipo — marzo',   NULL, 'APROBADO', 'app', '2026-03-10T08:00:00Z'),
    ('b0000000-0000-0000-00a0-000000000035', v_ws_id, '2026-04-05', 2000000, 'arriendo',    'fijo',      'Arriendo oficina y bodega — abril',   NULL, 'APROBADO', 'app', '2026-04-05T08:00:00Z')
  ON CONFLICT (id) DO NOTHING;

  -- ══════════════════════════════════════════════════════════
  -- 14. HORAS (60 records, Jan-Apr 2026)
  -- Distributed across 4 staff, negocios 2-5
  -- All APROBADO
  -- ══════════════════════════════════════════════════════════
  INSERT INTO horas (id, workspace_id, negocio_id, staff_id, fecha, horas, descripcion, estado_aprobacion, canal_registro, created_at) VALUES
    -- ── Negocio 2: Parqueadero cubierto (100h total) ──────────
    -- Carlos 30h
    ('b0000000-0000-0000-00e0-000000000001', v_ws_id, v_neg2_id, v_staff1_id, '2026-01-20', 8,  'Supervisión cimentación',              'APROBADO', 'app', '2026-01-20T17:00:00Z'),
    ('b0000000-0000-0000-00e0-000000000002', v_ws_id, v_neg2_id, v_staff1_id, '2026-02-03', 6,  'Reunión técnica estructura',            'APROBADO', 'app', '2026-02-03T17:00:00Z'),
    ('b0000000-0000-0000-00e0-000000000003', v_ws_id, v_neg2_id, v_staff1_id, '2026-02-17', 8,  'Supervisión vaciado columnas',          'APROBADO', 'app', '2026-02-17T17:00:00Z'),
    ('b0000000-0000-0000-00e0-000000000004', v_ws_id, v_neg2_id, v_staff1_id, '2026-03-14', 8,  'Revisión cubierta metálica',            'APROBADO', 'app', '2026-03-14T17:00:00Z'),
    -- Laura 20h
    ('b0000000-0000-0000-00e0-000000000005', v_ws_id, v_neg2_id, v_staff2_id, '2026-01-22', 5,  'Coordinación proveedores',              'APROBADO', 'app', '2026-01-22T17:00:00Z'),
    ('b0000000-0000-0000-00e0-000000000006', v_ws_id, v_neg2_id, v_staff2_id, '2026-02-10', 5,  'Seguimiento presupuesto',               'APROBADO', 'app', '2026-02-10T17:00:00Z'),
    ('b0000000-0000-0000-00e0-000000000007', v_ws_id, v_neg2_id, v_staff2_id, '2026-03-05', 5,  'Control calidad materiales',            'APROBADO', 'app', '2026-03-05T17:00:00Z'),
    ('b0000000-0000-0000-00e0-000000000008', v_ws_id, v_neg2_id, v_staff2_id, '2026-03-25', 5,  'Informe avance mensual',                'APROBADO', 'app', '2026-03-25T17:00:00Z'),
    -- Martínez 30h
    ('b0000000-0000-0000-00e0-000000000009', v_ws_id, v_neg2_id, v_staff3_id, '2026-01-21', 8,  'Cálculo estructural cimentación',       'APROBADO', 'app', '2026-01-21T17:00:00Z'),
    ('b0000000-0000-0000-00e0-000000000010', v_ws_id, v_neg2_id, v_staff3_id, '2026-02-06', 7,  'Diseño columnas y vigas',               'APROBADO', 'app', '2026-02-06T17:00:00Z'),
    ('b0000000-0000-0000-00e0-000000000011', v_ws_id, v_neg2_id, v_staff3_id, '2026-03-02', 8,  'Supervisión armado estructura',         'APROBADO', 'app', '2026-03-02T17:00:00Z'),
    ('b0000000-0000-0000-00e0-000000000012', v_ws_id, v_neg2_id, v_staff3_id, '2026-03-20', 7,  'Verificación resistencia',              'APROBADO', 'app', '2026-03-20T17:00:00Z'),
    -- Vega 20h
    ('b0000000-0000-0000-00e0-000000000013', v_ws_id, v_neg2_id, v_staff4_id, '2026-01-25', 5,  'Diseño arquitectónico cubierta',        'APROBADO', 'app', '2026-01-25T17:00:00Z'),
    ('b0000000-0000-0000-00e0-000000000014', v_ws_id, v_neg2_id, v_staff4_id, '2026-02-15', 5,  'Planos detalle acabados',               'APROBADO', 'app', '2026-02-15T17:00:00Z'),
    ('b0000000-0000-0000-00e0-000000000015', v_ws_id, v_neg2_id, v_staff4_id, '2026-03-10', 6,  'Revisión acabados finales',             'APROBADO', 'app', '2026-03-10T17:00:00Z'),
    ('b0000000-0000-0000-00e0-000000000016', v_ws_id, v_neg2_id, v_staff4_id, '2026-04-03', 4,  'Ajustes planos as-built',               'APROBADO', 'app', '2026-04-03T17:00:00Z'),

    -- ── Negocio 3: Ampliación zona comidas (80h total) ────────
    -- Carlos 20h
    ('b0000000-0000-0000-00e0-000000000017', v_ws_id, v_neg3_id, v_staff1_id, '2026-01-28', 5,  'Supervisión demolición',                'APROBADO', 'app', '2026-01-28T17:00:00Z'),
    ('b0000000-0000-0000-00e0-000000000018', v_ws_id, v_neg3_id, v_staff1_id, '2026-02-12', 5,  'Reunión con administración CC',         'APROBADO', 'app', '2026-02-12T17:00:00Z'),
    ('b0000000-0000-0000-00e0-000000000019', v_ws_id, v_neg3_id, v_staff1_id, '2026-03-08', 5,  'Supervisión piso porcelanato',          'APROBADO', 'app', '2026-03-08T17:00:00Z'),
    ('b0000000-0000-0000-00e0-000000000020', v_ws_id, v_neg3_id, v_staff1_id, '2026-04-01', 5,  'Supervisión acabados finales',          'APROBADO', 'app', '2026-04-01T17:00:00Z'),
    -- Laura 25h
    ('b0000000-0000-0000-00e0-000000000021', v_ws_id, v_neg3_id, v_staff2_id, '2026-01-30', 5,  'Coordinación logística demolición',     'APROBADO', 'app', '2026-01-30T17:00:00Z'),
    ('b0000000-0000-0000-00e0-000000000022', v_ws_id, v_neg3_id, v_staff2_id, '2026-02-14', 5,  'Gestión permisos CC Norte',             'APROBADO', 'app', '2026-02-14T17:00:00Z'),
    ('b0000000-0000-0000-00e0-000000000023', v_ws_id, v_neg3_id, v_staff2_id, '2026-03-01', 5,  'Control presupuesto zona comidas',      'APROBADO', 'app', '2026-03-01T17:00:00Z'),
    ('b0000000-0000-0000-00e0-000000000024', v_ws_id, v_neg3_id, v_staff2_id, '2026-03-20', 5,  'Informe avance zona comidas',           'APROBADO', 'app', '2026-03-20T17:00:00Z'),
    ('b0000000-0000-0000-00e0-000000000025', v_ws_id, v_neg3_id, v_staff2_id, '2026-04-05', 5,  'Coordinación entrega equipos',          'APROBADO', 'app', '2026-04-05T17:00:00Z'),
    -- Martínez 25h
    ('b0000000-0000-0000-00e0-000000000026', v_ws_id, v_neg3_id, v_staff3_id, '2026-02-01', 6,  'Cálculo refuerzo estructural',          'APROBADO', 'app', '2026-02-01T17:00:00Z'),
    ('b0000000-0000-0000-00e0-000000000027', v_ws_id, v_neg3_id, v_staff3_id, '2026-02-22', 7,  'Supervisión red hidrosanitaria',        'APROBADO', 'app', '2026-02-22T17:00:00Z'),
    ('b0000000-0000-0000-00e0-000000000028', v_ws_id, v_neg3_id, v_staff3_id, '2026-03-12', 6,  'Verificación instalación piso',         'APROBADO', 'app', '2026-03-12T17:00:00Z'),
    ('b0000000-0000-0000-00e0-000000000029', v_ws_id, v_neg3_id, v_staff3_id, '2026-03-28', 6,  'Supervisión sistema extracción',        'APROBADO', 'app', '2026-03-28T17:00:00Z'),
    -- Vega 10h
    ('b0000000-0000-0000-00e0-000000000030', v_ws_id, v_neg3_id, v_staff4_id, '2026-02-05', 5,  'Diseño layout zona comidas',            'APROBADO', 'app', '2026-02-05T17:00:00Z'),
    ('b0000000-0000-0000-00e0-000000000031', v_ws_id, v_neg3_id, v_staff4_id, '2026-03-15', 5,  'Planos acabados y cielo raso',          'APROBADO', 'app', '2026-03-15T17:00:00Z'),

    -- ── Negocio 4: Terraza piso 12 (60h total) ───────────────
    -- Carlos 15h
    ('b0000000-0000-0000-00e0-000000000032', v_ws_id, v_neg4_id, v_staff1_id, '2026-02-18', 5,  'Supervisión impermeabilización',        'APROBADO', 'app', '2026-02-18T17:00:00Z'),
    ('b0000000-0000-0000-00e0-000000000033', v_ws_id, v_neg4_id, v_staff1_id, '2026-03-05', 5,  'Revisión deck instalado',               'APROBADO', 'app', '2026-03-05T17:00:00Z'),
    ('b0000000-0000-0000-00e0-000000000034', v_ws_id, v_neg4_id, v_staff1_id, '2026-03-25', 5,  'Supervisión pérgola',                   'APROBADO', 'app', '2026-03-25T17:00:00Z'),
    -- Laura 10h
    ('b0000000-0000-0000-00e0-000000000035', v_ws_id, v_neg4_id, v_staff2_id, '2026-02-20', 5,  'Coordinación proveedores terraza',      'APROBADO', 'app', '2026-02-20T17:00:00Z'),
    ('b0000000-0000-0000-00e0-000000000036', v_ws_id, v_neg4_id, v_staff2_id, '2026-03-15', 5,  'Control presupuesto terraza',           'APROBADO', 'app', '2026-03-15T17:00:00Z'),
    -- Martínez 20h
    ('b0000000-0000-0000-00e0-000000000037', v_ws_id, v_neg4_id, v_staff3_id, '2026-02-22', 5,  'Revisión estructural terraza',          'APROBADO', 'app', '2026-02-22T17:00:00Z'),
    ('b0000000-0000-0000-00e0-000000000038', v_ws_id, v_neg4_id, v_staff3_id, '2026-03-08', 5,  'Cálculo carga pérgola',                 'APROBADO', 'app', '2026-03-08T17:00:00Z'),
    ('b0000000-0000-0000-00e0-000000000039', v_ws_id, v_neg4_id, v_staff3_id, '2026-03-22', 5,  'Supervisión instalación pérgola',       'APROBADO', 'app', '2026-03-22T17:00:00Z'),
    ('b0000000-0000-0000-00e0-000000000040', v_ws_id, v_neg4_id, v_staff3_id, '2026-04-02', 5,  'Verificación cargas finales',           'APROBADO', 'app', '2026-04-02T17:00:00Z'),
    -- Vega 15h
    ('b0000000-0000-0000-00e0-000000000041', v_ws_id, v_neg4_id, v_staff4_id, '2026-02-25', 5,  'Diseño paisajístico terraza',           'APROBADO', 'app', '2026-02-25T17:00:00Z'),
    ('b0000000-0000-0000-00e0-000000000042', v_ws_id, v_neg4_id, v_staff4_id, '2026-03-12', 5,  'Selección vegetación y materas',        'APROBADO', 'app', '2026-03-12T17:00:00Z'),
    ('b0000000-0000-0000-00e0-000000000043', v_ws_id, v_neg4_id, v_staff4_id, '2026-04-05', 5,  'Planos finales terraza',                'APROBADO', 'app', '2026-04-05T17:00:00Z'),

    -- ── Negocio 5: Fachada sur (40h total) ────────────────────
    -- Carlos 10h
    ('b0000000-0000-0000-00e0-000000000044', v_ws_id, v_neg5_id, v_staff1_id, '2025-11-20', 5,  'Supervisión montaje andamios',          'APROBADO', 'app', '2025-11-20T17:00:00Z'),
    ('b0000000-0000-0000-00e0-000000000045', v_ws_id, v_neg5_id, v_staff1_id, '2025-12-15', 5,  'Revisión avance pintura',               'APROBADO', 'app', '2025-12-15T17:00:00Z'),
    -- Laura 10h
    ('b0000000-0000-0000-00e0-000000000046', v_ws_id, v_neg5_id, v_staff2_id, '2025-11-25', 5,  'Coordinación acceso fachada',           'APROBADO', 'app', '2025-11-25T17:00:00Z'),
    ('b0000000-0000-0000-00e0-000000000047', v_ws_id, v_neg5_id, v_staff2_id, '2026-01-10', 5,  'Control presupuesto fachada',           'APROBADO', 'app', '2026-01-10T17:00:00Z'),
    -- Martínez 10h
    ('b0000000-0000-0000-00e0-000000000048', v_ws_id, v_neg5_id, v_staff3_id, '2025-12-01', 5,  'Inspección estructura fachada',         'APROBADO', 'app', '2025-12-01T17:00:00Z'),
    ('b0000000-0000-0000-00e0-000000000049', v_ws_id, v_neg5_id, v_staff3_id, '2026-01-15', 5,  'Verificación sellante aplicado',        'APROBADO', 'app', '2026-01-15T17:00:00Z'),
    -- Vega 10h
    ('b0000000-0000-0000-00e0-000000000050', v_ws_id, v_neg5_id, v_staff4_id, '2025-11-28', 4,  'Diseño patrón pintura fachada',         'APROBADO', 'app', '2025-11-28T17:00:00Z'),
    ('b0000000-0000-0000-00e0-000000000051', v_ws_id, v_neg5_id, v_staff4_id, '2025-12-20', 6,  'Supervisión acabados fachada',          'APROBADO', 'app', '2025-12-20T17:00:00Z')
  ON CONFLICT (id) DO NOTHING;

  -- ══════════════════════════════════════════════════════════
  -- 15. COBROS (6 records)
  -- ══════════════════════════════════════════════════════════
  INSERT INTO cobros (id, workspace_id, negocio_id, monto, fecha, notas, tipo_cobro, estado_causacion, canal_registro, created_at) VALUES
    -- Negocio 2: Anticipo $36M (ene) + parcial $40M (mar)
    ('b0000000-0000-0000-0099-000000000001', v_ws_id, v_neg2_id, 36000000, '2026-01-18', 'Anticipo 30% parqueadero cubierto',    'anticipo', 'APROBADO', 'app', '2026-01-18T10:00:00Z'),
    ('b0000000-0000-0000-0099-000000000002', v_ws_id, v_neg2_id, 40000000, '2026-03-20', 'Segundo pago parqueadero cubierto',    'regular',  'APROBADO', 'app', '2026-03-20T10:00:00Z'),
    -- Negocio 3: Anticipo $28.5M (feb) + parcial $30M (abr)
    ('b0000000-0000-0000-0099-000000000003', v_ws_id, v_neg3_id, 28500000, '2026-02-05', 'Anticipo 30% ampliación zona comidas', 'anticipo', 'APROBADO', 'app', '2026-02-05T10:00:00Z'),
    ('b0000000-0000-0000-0099-000000000004', v_ws_id, v_neg3_id, 30000000, '2026-04-03', 'Segundo pago zona comidas',            'regular',  'APROBADO', 'app', '2026-04-03T10:00:00Z'),
    -- Negocio 4: Anticipo $20.4M (feb)
    ('b0000000-0000-0000-0099-000000000005', v_ws_id, v_neg4_id, 20400000, '2026-02-12', 'Anticipo 30% terraza piso 12',         'anticipo', 'APROBADO', 'app', '2026-02-12T10:00:00Z'),
    -- Negocio 5: Total $45M (mar)
    ('b0000000-0000-0000-0099-000000000006', v_ws_id, v_neg5_id, 45000000, '2026-03-05', 'Pago total fachada sur — obra entregada', 'regular', 'APROBADO', 'app', '2026-03-05T10:00:00Z')
  ON CONFLICT (id) DO NOTHING;

END $$;
