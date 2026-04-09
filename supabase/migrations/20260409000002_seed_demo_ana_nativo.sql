-- ============================================================
-- FIX: apply_plantilla_to_workspace ON CONFLICT includes orden
-- (SOENA migration 20260405000004 changed unique constraint)
-- ============================================================
CREATE OR REPLACE FUNCTION apply_plantilla_to_workspace(
  p_workspace_id UUID,
  p_linea_id     UUID
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $fn$
DECLARE
  v_etapa RECORD;
  v_bloque RECORD;
  v_orden INTEGER;
BEGIN
  FOR v_etapa IN
    SELECT id, stage FROM etapas_negocio WHERE linea_id = p_linea_id ORDER BY orden
  LOOP
    v_orden := 0;
    FOR v_bloque IN
      SELECT bd.id, bd.default_estado
      FROM bloque_definitions bd
      WHERE (
        (v_etapa.stage = 'venta'      AND bd.tipo IN ('equipo', 'cotizacion'))
        OR (v_etapa.stage = 'ejecucion' AND bd.tipo IN ('equipo', 'datos', 'checklist', 'cobros', 'resumen_financiero', 'ejecucion'))
        OR (v_etapa.stage = 'cobro'    AND bd.tipo IN ('cobros', 'resumen_financiero', 'ejecucion'))
      )
      ORDER BY bd.tipo
    LOOP
      INSERT INTO bloque_configs (etapa_id, workspace_id, bloque_definition_id, estado, orden, es_gate)
      VALUES (v_etapa.id, p_workspace_id, v_bloque.id, v_bloque.default_estado, v_orden, false)
      ON CONFLICT (etapa_id, workspace_id, bloque_definition_id, orden) DO NOTHING;
      v_orden := v_orden + 1;
    END LOOP;
  END LOOP;
END;
$fn$;

-- ============================================================
-- SEED: Demo workspace "Ana Morales Consulting"
-- Plantilla nativa "Soy profesional" con datos realistas
-- Idempotente: ON CONFLICT DO NOTHING donde aplica
-- ============================================================

DO $$
DECLARE
  -- Workspace y profile
  v_ws_id      UUID := 'a0000000-0000-0000-0000-000000000001';

  -- Linea y etapas
  v_linea_id   UUID;
  v_etapa1_id  UUID;  -- Por contactar (venta)
  v_etapa2_id  UUID;  -- Propuesta enviada (venta)
  v_etapa3_id  UUID;  -- En desarrollo (ejecucion)
  v_etapa4_id  UUID;  -- En revision (ejecucion)
  v_etapa5_id  UUID;  -- Por cobrar (cobro)

  -- Empresas
  v_emp1_id UUID := 'a0000000-0000-0000-0001-000000000001';  -- TechVerde
  v_emp2_id UUID := 'a0000000-0000-0000-0001-000000000002';  -- Cafe Origen
  v_emp3_id UUID := 'a0000000-0000-0000-0001-000000000003';  -- Inmobiliaria Lux
  v_emp4_id UUID := 'a0000000-0000-0000-0001-000000000004';  -- Estudio Creativo Sur

  -- Contactos
  v_con1_id UUID := 'a0000000-0000-0000-0002-000000000001';
  v_con2_id UUID := 'a0000000-0000-0000-0002-000000000002';
  v_con3_id UUID := 'a0000000-0000-0000-0002-000000000003';
  v_con4_id UUID := 'a0000000-0000-0000-0002-000000000004';

  -- Staff
  v_staff1_id UUID := 'a0000000-0000-0000-0003-000000000001';  -- Ana
  v_staff2_id UUID := 'a0000000-0000-0000-0003-000000000002';  -- Diego

  -- Negocios
  v_neg1_id UUID := 'a0000000-0000-0000-0004-000000000001';  -- TechVerde Estrategia Digital
  v_neg2_id UUID := 'a0000000-0000-0000-0004-000000000002';  -- Cafe Origen Branding
  v_neg3_id UUID := 'a0000000-0000-0000-0004-000000000003';  -- Lux Campana Q1
  v_neg4_id UUID := 'a0000000-0000-0000-0004-000000000004';  -- Estudio Social Media
  v_neg5_id UUID := 'a0000000-0000-0000-0004-000000000005';  -- TechVerde SEO 2026
  v_neg6_id UUID := 'a0000000-0000-0000-0004-000000000006';  -- Cafe Origen Fotos

BEGIN

  -- ════════════════════════════════════════════════════════════
  -- 1. WORKSPACE
  -- ════════════════════════════════════════════════════════════
  INSERT INTO workspaces (id, slug, name, created_at)
  VALUES (v_ws_id, 'ana-demo', 'Ana Morales Consulting', NOW())
  ON CONFLICT (slug) DO NOTHING;

  -- ════════════════════════════════════════════════════════════
  -- 2. FIND PLANTILLA "Soy profesional" + APPLY
  -- ════════════════════════════════════════════════════════════
  SELECT id INTO v_linea_id
  FROM lineas_negocio
  WHERE nombre = 'Soy profesional' AND tipo = 'plantilla'
  LIMIT 1;

  IF v_linea_id IS NULL THEN
    RAISE EXCEPTION 'Plantilla "Soy profesional" no encontrada. Ejecutar seed_templates primero.';
  END IF;

  -- Apply plantilla (creates bloque_configs for this workspace)
  PERFORM apply_plantilla_to_workspace(v_ws_id, v_linea_id);

  -- Lookup etapa IDs by orden
  SELECT id INTO v_etapa1_id FROM etapas_negocio WHERE linea_id = v_linea_id AND orden = 1;
  SELECT id INTO v_etapa2_id FROM etapas_negocio WHERE linea_id = v_linea_id AND orden = 2;
  SELECT id INTO v_etapa3_id FROM etapas_negocio WHERE linea_id = v_linea_id AND orden = 3;
  SELECT id INTO v_etapa4_id FROM etapas_negocio WHERE linea_id = v_linea_id AND orden = 4;
  SELECT id INTO v_etapa5_id FROM etapas_negocio WHERE linea_id = v_linea_id AND orden = 5;

  -- ════════════════════════════════════════════════════════════
  -- 3. EMPRESAS (4 clientes)
  -- ════════════════════════════════════════════════════════════
  INSERT INTO empresas (id, workspace_id, nombre, numero_documento, created_at) VALUES
    (v_emp1_id, v_ws_id, 'TechVerde SAS',          '900123456-1', NOW()),
    (v_emp2_id, v_ws_id, 'Café Origen',             '900234567-2', NOW()),
    (v_emp3_id, v_ws_id, 'Inmobiliaria Lux',        '900345678-3', NOW()),
    (v_emp4_id, v_ws_id, 'Estudio Creativo Sur',    '900456789-4', NOW())
  ON CONFLICT (id) DO NOTHING;

  -- ════════════════════════════════════════════════════════════
  -- 4. CONTACTOS (1 por empresa)
  --    Nota: contactos no tiene empresa_id en el schema.
  --    La relacion empresa-contacto es via negocio.
  -- ════════════════════════════════════════════════════════════
  INSERT INTO contactos (id, workspace_id, nombre, telefono, email, created_at) VALUES
    (v_con1_id, v_ws_id, 'Julián Torres',  '+573001234567', 'julian@techverde.co',        NOW()),
    (v_con2_id, v_ws_id, 'María López',    '+573002345678', 'maria@cafeorigen.co',         NOW()),
    (v_con3_id, v_ws_id, 'Roberto Díaz',   '+573003456789', 'roberto@inmobilux.co',        NOW()),
    (v_con4_id, v_ws_id, 'Camila Ruiz',    '+573004567890', 'camila@estudiocreativo.co',   NOW())
  ON CONFLICT (id) DO NOTHING;

  -- ════════════════════════════════════════════════════════════
  -- 5. STAFF (2 personas)
  -- ════════════════════════════════════════════════════════════
  INSERT INTO staff (id, workspace_id, full_name, tipo_vinculo, salary, es_principal, is_active, created_at) VALUES
    (v_staff1_id, v_ws_id, 'Ana Morales',   'freelance',    4000000, true,  true, NOW()),
    (v_staff2_id, v_ws_id, 'Diego Vargas',  'contratista',  2500000, false, true, NOW())
  ON CONFLICT (id) DO NOTHING;

  -- ════════════════════════════════════════════════════════════
  -- 6. FIXED EXPENSES (3 gastos fijos)
  --    Usa description (no name) segun schema fixed_expenses
  -- ════════════════════════════════════════════════════════════
  INSERT INTO fixed_expenses (id, workspace_id, description, monthly_amount, is_active, deducible, created_at) VALUES
    (gen_random_uuid(), v_ws_id, 'Internet Fibra',              150000, true, true, NOW()),
    (gen_random_uuid(), v_ws_id, 'Coworking',                   600000, true, true, NOW()),
    (gen_random_uuid(), v_ws_id, 'Software (Figma, Notion)',    250000, true, true, NOW());

  -- ════════════════════════════════════════════════════════════
  -- 7. CONFIG METAS (Ene-Abr 2026)
  -- ════════════════════════════════════════════════════════════
  INSERT INTO config_metas (id, workspace_id, mes, meta_ventas_mensual, meta_recaudo_mensual, created_at) VALUES
    (gen_random_uuid(), v_ws_id, '2026-01-01', 8000000, 6000000, NOW()),
    (gen_random_uuid(), v_ws_id, '2026-02-01', 8000000, 6000000, NOW()),
    (gen_random_uuid(), v_ws_id, '2026-03-01', 9000000, 7000000, NOW()),
    (gen_random_uuid(), v_ws_id, '2026-04-01', 9000000, 7000000, NOW())
  ON CONFLICT (workspace_id, mes) DO NOTHING;

  -- ════════════════════════════════════════════════════════════
  -- 8. SALDOS BANCO (4 snapshots mensuales)
  -- ════════════════════════════════════════════════════════════
  INSERT INTO saldos_banco (id, workspace_id, saldo_real, saldo_teorico, diferencia, fecha, registrado_via, created_at) VALUES
    (gen_random_uuid(), v_ws_id, 12500000, 12300000, 200000, '2026-01-31T18:00:00Z', 'app', '2026-01-31T18:00:00Z'),
    (gen_random_uuid(), v_ws_id, 14200000, 14100000, 100000, '2026-02-28T18:00:00Z', 'app', '2026-02-28T18:00:00Z'),
    (gen_random_uuid(), v_ws_id, 16800000, 16500000, 300000, '2026-03-31T18:00:00Z', 'app', '2026-03-31T18:00:00Z'),
    (gen_random_uuid(), v_ws_id, 18100000, 17900000, 200000, '2026-04-07T18:00:00Z', 'app', '2026-04-07T18:00:00Z');

  -- ════════════════════════════════════════════════════════════
  -- 9. NEGOCIOS (6 en distintas etapas)
  -- ════════════════════════════════════════════════════════════

  -- Neg 1: TechVerde - Estrategia Digital → Contacto (venta, etapa 1)
  INSERT INTO negocios (id, workspace_id, linea_id, empresa_id, contacto_id, nombre,
    precio_estimado, stage_actual, etapa_actual_id, estado, created_at)
  VALUES (v_neg1_id, v_ws_id, v_linea_id, v_emp1_id, v_con1_id,
    'Estrategia Digital',
    4500000, 'venta', v_etapa1_id, 'abierto', '2026-04-02T10:00:00Z')
  ON CONFLICT (id) DO NOTHING;

  -- Neg 2: Cafe Origen - Branding → Propuesta enviada (venta, etapa 2)
  INSERT INTO negocios (id, workspace_id, linea_id, empresa_id, contacto_id, nombre,
    precio_estimado, stage_actual, etapa_actual_id, estado, created_at)
  VALUES (v_neg2_id, v_ws_id, v_linea_id, v_emp2_id, v_con2_id,
    'Branding',
    3200000, 'venta', v_etapa2_id, 'abierto', '2026-03-28T09:00:00Z')
  ON CONFLICT (id) DO NOTHING;

  -- Neg 3: Inmobiliaria Lux - Campana Q1 → En desarrollo (ejecucion, etapa 3)
  INSERT INTO negocios (id, workspace_id, linea_id, empresa_id, contacto_id, nombre,
    precio_estimado, precio_aprobado, stage_actual, etapa_actual_id, estado, created_at)
  VALUES (v_neg3_id, v_ws_id, v_linea_id, v_emp3_id, v_con3_id,
    'Campaña Q1',
    6800000, 6800000, 'ejecucion', v_etapa3_id, 'abierto', '2026-02-05T11:00:00Z')
  ON CONFLICT (id) DO NOTHING;

  -- Neg 4: Estudio Creativo - Social Media → En desarrollo (ejecucion, etapa 3)
  INSERT INTO negocios (id, workspace_id, linea_id, empresa_id, contacto_id, nombre,
    precio_estimado, precio_aprobado, stage_actual, etapa_actual_id, estado, created_at)
  VALUES (v_neg4_id, v_ws_id, v_linea_id, v_emp4_id, v_con4_id,
    'Social Media',
    2400000, 2400000, 'ejecucion', v_etapa3_id, 'abierto', '2026-02-10T14:00:00Z')
  ON CONFLICT (id) DO NOTHING;

  -- Neg 5: TechVerde - SEO 2026 → Por cobrar (cobro, etapa 5)
  INSERT INTO negocios (id, workspace_id, linea_id, empresa_id, contacto_id, nombre,
    precio_estimado, precio_aprobado, stage_actual, etapa_actual_id, estado, created_at)
  VALUES (v_neg5_id, v_ws_id, v_linea_id, v_emp1_id, v_con1_id,
    'SEO 2026',
    5000000, 5000000, 'cobro', v_etapa5_id, 'abierto', '2026-01-10T08:00:00Z')
  ON CONFLICT (id) DO NOTHING;

  -- Neg 6: Cafe Origen - Fotos Producto → Completado (cerrado)
  INSERT INTO negocios (id, workspace_id, linea_id, empresa_id, contacto_id, nombre,
    precio_estimado, precio_aprobado, stage_actual, etapa_actual_id, estado, closed_at, created_at)
  VALUES (v_neg6_id, v_ws_id, v_linea_id, v_emp2_id, v_con2_id,
    'Fotos Producto',
    1800000, 1800000, 'cobro', v_etapa5_id, 'completado',
    '2026-02-15T17:00:00Z', '2026-01-05T09:00:00Z')
  ON CONFLICT (id) DO NOTHING;

  -- ════════════════════════════════════════════════════════════
  -- 10. GASTOS (25 registros, Ene-Abr 2026)
  --     Mix: directo (con negocio_id) y empresa (sin negocio_id)
  -- ════════════════════════════════════════════════════════════
  INSERT INTO gastos (id, workspace_id, fecha, monto, categoria, descripcion, negocio_id, tipo, estado_pago, canal_registro, created_at) VALUES
    -- ENERO (7)
    (gen_random_uuid(), v_ws_id, '2026-01-08', 350000, 'software',                  'Licencia Adobe Creative Suite',         NULL,      'empresa',   'pagado', 'app', '2026-01-08T10:00:00Z'),
    (gen_random_uuid(), v_ws_id, '2026-01-12', 250000, 'servicios_profesionales',   'Fotógrafo freelance sesión producto',   v_neg6_id, 'directo',   'pagado', 'app', '2026-01-12T14:00:00Z'),
    (gen_random_uuid(), v_ws_id, '2026-01-15', 180000, 'transporte',                'Uber reuniones clientes ene',           NULL,      'operativo', 'pagado', 'app', '2026-01-15T16:00:00Z'),
    (gen_random_uuid(), v_ws_id, '2026-01-18', 420000, 'servicios_profesionales',   'Retoque fotográfico lote 1',            v_neg6_id, 'directo',   'pagado', 'app', '2026-01-18T11:00:00Z'),
    (gen_random_uuid(), v_ws_id, '2026-01-22', 150000, 'alimentacion',              'Almuerzo equipo + cliente Lux',         v_neg3_id, 'directo',   'pagado', 'app', '2026-01-22T13:00:00Z'),
    (gen_random_uuid(), v_ws_id, '2026-01-25', 280000, 'software',                  'Semrush mensual',                       v_neg5_id, 'directo',   'pagado', 'app', '2026-01-25T09:00:00Z'),
    (gen_random_uuid(), v_ws_id, '2026-01-28', 320000, 'materiales',                'Impresión moodboards Lux',              v_neg3_id, 'directo',   'pagado', 'app', '2026-01-28T10:30:00Z'),

    -- FEBRERO (6)
    (gen_random_uuid(), v_ws_id, '2026-02-03', 450000, 'servicios_profesionales',   'Copywriter contenidos redes',           v_neg4_id, 'directo',   'pagado', 'app', '2026-02-03T09:00:00Z'),
    (gen_random_uuid(), v_ws_id, '2026-02-08', 190000, 'transporte',                'Uber reuniones feb',                    NULL,      'operativo', 'pagado', 'app', '2026-02-08T17:00:00Z'),
    (gen_random_uuid(), v_ws_id, '2026-02-12', 350000, 'software',                  'Licencia Adobe Creative feb',           NULL,      'empresa',   'pagado', 'app', '2026-02-12T10:00:00Z'),
    (gen_random_uuid(), v_ws_id, '2026-02-18', 680000, 'servicios_profesionales',   'Diseñador UI/UX landing Lux',           v_neg3_id, 'directo',   'pagado', 'app', '2026-02-18T11:00:00Z'),
    (gen_random_uuid(), v_ws_id, '2026-02-22', 220000, 'alimentacion',              'Cena cierre propuesta Café Origen',     v_neg2_id, 'directo',   'pagado', 'app', '2026-02-22T20:00:00Z'),
    (gen_random_uuid(), v_ws_id, '2026-02-26', 380000, 'materiales',                'Stock fotos premium Shutterstock',      v_neg4_id, 'directo',   'pagado', 'app', '2026-02-26T15:00:00Z'),

    -- MARZO (6)
    (gen_random_uuid(), v_ws_id, '2026-03-02', 350000, 'software',                  'Licencia Adobe Creative mar',           NULL,      'empresa',   'pagado', 'app', '2026-03-02T10:00:00Z'),
    (gen_random_uuid(), v_ws_id, '2026-03-06', 550000, 'servicios_profesionales',   'Analista datos campañas Lux',           v_neg3_id, 'directo',   'pagado', 'app', '2026-03-06T09:00:00Z'),
    (gen_random_uuid(), v_ws_id, '2026-03-10', 200000, 'transporte',                'Uber reuniones mar',                    NULL,      'operativo', 'pagado', 'app', '2026-03-10T18:00:00Z'),
    (gen_random_uuid(), v_ws_id, '2026-03-15', 480000, 'servicios_profesionales',   'Community manager Social Media',        v_neg4_id, 'directo',   'pagado', 'app', '2026-03-15T10:00:00Z'),
    (gen_random_uuid(), v_ws_id, '2026-03-20', 280000, 'software',                  'Semrush mensual mar',                   v_neg5_id, 'directo',   'pagado', 'app', '2026-03-20T09:00:00Z'),
    (gen_random_uuid(), v_ws_id, '2026-03-25', 170000, 'alimentacion',              'Almuerzo equipo + cliente TechVerde',   v_neg5_id, 'directo',   'pagado', 'app', '2026-03-25T13:00:00Z'),

    -- ABRIL (6)
    (gen_random_uuid(), v_ws_id, '2026-04-01', 350000, 'software',                  'Licencia Adobe Creative abr',           NULL,      'empresa',   'pagado', 'app', '2026-04-01T10:00:00Z'),
    (gen_random_uuid(), v_ws_id, '2026-04-03', 750000, 'servicios_profesionales',   'Fotógrafo sesión propuesta TechVerde',  v_neg1_id, 'directo',   'pendiente', 'app', '2026-04-03T14:00:00Z'),
    (gen_random_uuid(), v_ws_id, '2026-04-05', 210000, 'transporte',                'Uber reuniones abr',                    NULL,      'operativo', 'pagado', 'app', '2026-04-05T17:00:00Z'),
    (gen_random_uuid(), v_ws_id, '2026-04-06', 580000, 'servicios_profesionales',   'Video editor Estudio Creativo',         v_neg4_id, 'directo',   'pagado', 'app', '2026-04-06T11:00:00Z'),
    (gen_random_uuid(), v_ws_id, '2026-04-07', 300000, 'materiales',                'Papelería presentación branding',       v_neg2_id, 'directo',   'pendiente', 'app', '2026-04-07T09:00:00Z'),
    (gen_random_uuid(), v_ws_id, '2026-04-08', 280000, 'software',                  'Semrush mensual abr',                   v_neg5_id, 'directo',   'pagado', 'app', '2026-04-08T09:00:00Z');

  -- ════════════════════════════════════════════════════════════
  -- 11. COBROS (8 pagos recibidos)
  -- ════════════════════════════════════════════════════════════
  INSERT INTO cobros (id, workspace_id, negocio_id, monto, fecha, notas, tipo_cobro, canal_registro, created_at) VALUES
    -- Neg 6 (Fotos Producto) — pago completo ene
    (gen_random_uuid(), v_ws_id, v_neg6_id, 1800000, '2026-01-20', 'Pago total fotos producto',        'regular', 'app', '2026-01-20T15:00:00Z'),

    -- Neg 3 (Lux Campana Q1) — anticipo feb
    (gen_random_uuid(), v_ws_id, v_neg3_id, 3400000, '2026-02-10', 'Anticipo 50% campaña Q1',          'anticipo', 'app', '2026-02-10T11:00:00Z'),

    -- Neg 4 (Estudio Social Media) — mensualidad feb
    (gen_random_uuid(), v_ws_id, v_neg4_id, 2400000, '2026-02-15', 'Mensualidad Social Media feb',     'regular', 'app', '2026-02-15T16:00:00Z'),

    -- Neg 3 (Lux Campana Q1) — pago parcial mar
    (gen_random_uuid(), v_ws_id, v_neg3_id, 2000000, '2026-03-12', 'Segundo pago campaña Q1',          'regular', 'app', '2026-03-12T10:00:00Z'),

    -- Neg 4 (Estudio Social Media) — mensualidad mar
    (gen_random_uuid(), v_ws_id, v_neg4_id, 2400000, '2026-03-15', 'Mensualidad Social Media mar',     'regular', 'app', '2026-03-15T16:00:00Z'),

    -- Neg 3 (Lux Campana Q1) — saldo abr
    (gen_random_uuid(), v_ws_id, v_neg3_id, 1400000, '2026-04-05', 'Saldo final campaña Q1',           'regular', 'app', '2026-04-05T14:00:00Z'),

    -- Neg 4 (Estudio Social Media) — mensualidad abr
    (gen_random_uuid(), v_ws_id, v_neg4_id, 2400000, '2026-04-08', 'Mensualidad Social Media abr',     'regular', 'app', '2026-04-08T16:00:00Z'),

    -- Neg 5 (TechVerde SEO) — pago completo abr
    (gen_random_uuid(), v_ws_id, v_neg5_id, 5000000, '2026-04-07', 'Pago total proyecto SEO 2026',     'regular', 'app', '2026-04-07T10:00:00Z');

  -- ════════════════════════════════════════════════════════════
  -- 12. HORAS (40 registros distribuidos entre negocios en ejecucion)
  --     Staff: Ana (v_staff1_id), Diego (v_staff2_id)
  --     Todos APROBADO
  -- ════════════════════════════════════════════════════════════
  INSERT INTO horas (id, workspace_id, negocio_id, staff_id, fecha, horas, descripcion, estado_aprobacion, canal_registro, created_at) VALUES
    -- ── Neg 3: Lux Campana Q1 — Ana ~40h, Diego ~20h ──────────
    -- Ana — Neg 3
    (gen_random_uuid(), v_ws_id, v_neg3_id, v_staff1_id, '2026-02-06', 6, 'Estrategia de campaña y brief creativo',    'APROBADO', 'app', '2026-02-06T18:00:00Z'),
    (gen_random_uuid(), v_ws_id, v_neg3_id, v_staff1_id, '2026-02-10', 5, 'Diseño piezas gráficas fase 1',            'APROBADO', 'app', '2026-02-10T18:00:00Z'),
    (gen_random_uuid(), v_ws_id, v_neg3_id, v_staff1_id, '2026-02-14', 4, 'Revisión con cliente, ajustes copy',       'APROBADO', 'app', '2026-02-14T18:00:00Z'),
    (gen_random_uuid(), v_ws_id, v_neg3_id, v_staff1_id, '2026-02-20', 6, 'Diseño landing page Lux',                  'APROBADO', 'app', '2026-02-20T18:00:00Z'),
    (gen_random_uuid(), v_ws_id, v_neg3_id, v_staff1_id, '2026-02-27', 4, 'QA y correcciones landing',                'APROBADO', 'app', '2026-02-27T18:00:00Z'),
    (gen_random_uuid(), v_ws_id, v_neg3_id, v_staff1_id, '2026-03-04', 5, 'Setup campañas Meta Ads',                  'APROBADO', 'app', '2026-03-04T18:00:00Z'),
    (gen_random_uuid(), v_ws_id, v_neg3_id, v_staff1_id, '2026-03-12', 4, 'Optimización campañas semana 2',           'APROBADO', 'app', '2026-03-12T18:00:00Z'),
    (gen_random_uuid(), v_ws_id, v_neg3_id, v_staff1_id, '2026-03-20', 3, 'Reporte mensual y análisis KPIs',          'APROBADO', 'app', '2026-03-20T18:00:00Z'),
    (gen_random_uuid(), v_ws_id, v_neg3_id, v_staff1_id, '2026-03-28', 3, 'Ajustes fase 2 piezas',                    'APROBADO', 'app', '2026-03-28T18:00:00Z'),
    -- Diego — Neg 3
    (gen_random_uuid(), v_ws_id, v_neg3_id, v_staff2_id, '2026-02-07', 4, 'Maquetación email marketing',              'APROBADO', 'app', '2026-02-07T18:00:00Z'),
    (gen_random_uuid(), v_ws_id, v_neg3_id, v_staff2_id, '2026-02-13', 3, 'Programación landing responsive',          'APROBADO', 'app', '2026-02-13T18:00:00Z'),
    (gen_random_uuid(), v_ws_id, v_neg3_id, v_staff2_id, '2026-02-21', 4, 'Integración formularios contacto',         'APROBADO', 'app', '2026-02-21T18:00:00Z'),
    (gen_random_uuid(), v_ws_id, v_neg3_id, v_staff2_id, '2026-03-05', 3, 'Setup pixel y eventos conversión',         'APROBADO', 'app', '2026-03-05T18:00:00Z'),
    (gen_random_uuid(), v_ws_id, v_neg3_id, v_staff2_id, '2026-03-14', 3, 'Automatización email sequences',           'APROBADO', 'app', '2026-03-14T18:00:00Z'),
    (gen_random_uuid(), v_ws_id, v_neg3_id, v_staff2_id, '2026-03-26', 3, 'Mantenimiento y correcciones menores',     'APROBADO', 'app', '2026-03-26T18:00:00Z'),

    -- ── Neg 4: Estudio Social Media — Ana ~15h, Diego ~25h ────
    -- Ana — Neg 4
    (gen_random_uuid(), v_ws_id, v_neg4_id, v_staff1_id, '2026-02-12', 4, 'Estrategia redes y calendario editorial',  'APROBADO', 'app', '2026-02-12T18:00:00Z'),
    (gen_random_uuid(), v_ws_id, v_neg4_id, v_staff1_id, '2026-02-25', 3, 'Revisión grilla visual Instagram',         'APROBADO', 'app', '2026-02-25T18:00:00Z'),
    (gen_random_uuid(), v_ws_id, v_neg4_id, v_staff1_id, '2026-03-10', 4, 'Análisis métricas feb + plan mar',         'APROBADO', 'app', '2026-03-10T18:00:00Z'),
    (gen_random_uuid(), v_ws_id, v_neg4_id, v_staff1_id, '2026-03-25', 4, 'Revisión métricas mar + propuesta cambios','APROBADO', 'app', '2026-03-25T18:00:00Z'),
    -- Diego — Neg 4
    (gen_random_uuid(), v_ws_id, v_neg4_id, v_staff2_id, '2026-02-11', 5, 'Diseño templates stories + posts',         'APROBADO', 'app', '2026-02-11T18:00:00Z'),
    (gen_random_uuid(), v_ws_id, v_neg4_id, v_staff2_id, '2026-02-18', 4, 'Producción contenido semana 3',            'APROBADO', 'app', '2026-02-18T18:00:00Z'),
    (gen_random_uuid(), v_ws_id, v_neg4_id, v_staff2_id, '2026-02-26', 4, 'Edición reels + carruseles',               'APROBADO', 'app', '2026-02-26T18:00:00Z'),
    (gen_random_uuid(), v_ws_id, v_neg4_id, v_staff2_id, '2026-03-08', 4, 'Producción contenido mar semana 1',        'APROBADO', 'app', '2026-03-08T18:00:00Z'),
    (gen_random_uuid(), v_ws_id, v_neg4_id, v_staff2_id, '2026-03-17', 4, 'Edición reels mar + thumbnails',           'APROBADO', 'app', '2026-03-17T18:00:00Z'),
    (gen_random_uuid(), v_ws_id, v_neg4_id, v_staff2_id, '2026-03-27', 4, 'Producción contenido mar semana 4',        'APROBADO', 'app', '2026-03-27T18:00:00Z'),

    -- ── Neg 5: TechVerde SEO — Ana ~25h, Diego ~5h ──────────
    -- Ana — Neg 5
    (gen_random_uuid(), v_ws_id, v_neg5_id, v_staff1_id, '2026-01-14', 5, 'Auditoría SEO técnica sitio web',          'APROBADO', 'app', '2026-01-14T18:00:00Z'),
    (gen_random_uuid(), v_ws_id, v_neg5_id, v_staff1_id, '2026-01-22', 4, 'Research keywords y competencia',          'APROBADO', 'app', '2026-01-22T18:00:00Z'),
    (gen_random_uuid(), v_ws_id, v_neg5_id, v_staff1_id, '2026-02-04', 5, 'Estrategia de contenidos SEO',             'APROBADO', 'app', '2026-02-04T18:00:00Z'),
    (gen_random_uuid(), v_ws_id, v_neg5_id, v_staff1_id, '2026-02-17', 4, 'Optimización on-page 15 páginas',          'APROBADO', 'app', '2026-02-17T18:00:00Z'),
    (gen_random_uuid(), v_ws_id, v_neg5_id, v_staff1_id, '2026-03-03', 4, 'Link building y outreach',                 'APROBADO', 'app', '2026-03-03T18:00:00Z'),
    (gen_random_uuid(), v_ws_id, v_neg5_id, v_staff1_id, '2026-03-18', 3, 'Reporte trimestral SEO + recomendaciones', 'APROBADO', 'app', '2026-03-18T18:00:00Z'),
    -- Diego — Neg 5
    (gen_random_uuid(), v_ws_id, v_neg5_id, v_staff2_id, '2026-01-16', 3, 'Implementación Schema markup',             'APROBADO', 'app', '2026-01-16T18:00:00Z'),
    (gen_random_uuid(), v_ws_id, v_neg5_id, v_staff2_id, '2026-02-19', 2, 'Fix velocidad de carga y Core Web Vitals', 'APROBADO', 'app', '2026-02-19T18:00:00Z'),

    -- ── Neg 6: Cafe Origen Fotos — Ana ~10h, Diego ~5h ──────
    -- Ana — Neg 6
    (gen_random_uuid(), v_ws_id, v_neg6_id, v_staff1_id, '2026-01-06', 3, 'Planeación sesión y moodboard',            'APROBADO', 'app', '2026-01-06T18:00:00Z'),
    (gen_random_uuid(), v_ws_id, v_neg6_id, v_staff1_id, '2026-01-10', 4, 'Dirección sesión fotográfica',             'APROBADO', 'app', '2026-01-10T18:00:00Z'),
    (gen_random_uuid(), v_ws_id, v_neg6_id, v_staff1_id, '2026-01-17', 3, 'Selección y retoque final fotos',          'APROBADO', 'app', '2026-01-17T18:00:00Z'),
    -- Diego — Neg 6
    (gen_random_uuid(), v_ws_id, v_neg6_id, v_staff2_id, '2026-01-09', 3, 'Setup iluminación y equipo estudio',       'APROBADO', 'app', '2026-01-09T18:00:00Z'),
    (gen_random_uuid(), v_ws_id, v_neg6_id, v_staff2_id, '2026-01-13', 2, 'Edición lote y catalogación archivos',     'APROBADO', 'app', '2026-01-13T18:00:00Z');

  -- ════════════════════════════════════════════════════════════
  -- 13. FACTURAS (5 facturas vinculadas a negocios via proyectos)
  --     Nota: facturas requiere proyecto_id NOT NULL.
  --     Los negocios demo no tienen proyecto asociado.
  --     Omitimos facturas para evitar crear proyectos dummy.
  --     Los cobros directos a negocios ya registran los ingresos.
  -- ════════════════════════════════════════════════════════════
  -- (Facturas omitidas: la tabla facturas requiere proyecto_id NOT NULL,
  --  y los negocios de este workspace demo no tienen proyectos legacy asociados.
  --  Los cobros vinculados a negocios cubren el tracking financiero.)

  -- ════════════════════════════════════════════════════════════
  -- 14. NEGOCIO BLOQUES (instancias runtime)
  --     Crear negocio_bloques para cada negocio segun su etapa actual
  -- ════════════════════════════════════════════════════════════

  -- Para negocios en etapas de venta (neg1 etapa1, neg2 etapa2):
  -- bloque_configs de esas etapas tienen equipo + cotizacion
  INSERT INTO negocio_bloques (id, negocio_id, bloque_config_id, estado, data, created_at)
  SELECT gen_random_uuid(), v_neg1_id, bc.id, 'pendiente', '{}'::jsonb, NOW()
  FROM bloque_configs bc
  WHERE bc.etapa_id = v_etapa1_id AND bc.workspace_id = v_ws_id
  ON CONFLICT (negocio_id, bloque_config_id) DO NOTHING;

  INSERT INTO negocio_bloques (id, negocio_id, bloque_config_id, estado, data, created_at)
  SELECT gen_random_uuid(), v_neg2_id, bc.id, 'pendiente', '{}'::jsonb, NOW()
  FROM bloque_configs bc
  WHERE bc.etapa_id = v_etapa2_id AND bc.workspace_id = v_ws_id
  ON CONFLICT (negocio_id, bloque_config_id) DO NOTHING;

  -- Para negocios en ejecucion (neg3, neg4 — etapa 3):
  -- Mark some blocks as completo for negocios further along
  INSERT INTO negocio_bloques (id, negocio_id, bloque_config_id, estado, data, created_at)
  SELECT gen_random_uuid(), v_neg3_id, bc.id,
    CASE WHEN bd.tipo IN ('equipo', 'datos') THEN 'completo' ELSE 'pendiente' END,
    '{}'::jsonb, NOW()
  FROM bloque_configs bc
  JOIN bloque_definitions bd ON bd.id = bc.bloque_definition_id
  WHERE bc.etapa_id = v_etapa3_id AND bc.workspace_id = v_ws_id
  ON CONFLICT (negocio_id, bloque_config_id) DO NOTHING;

  INSERT INTO negocio_bloques (id, negocio_id, bloque_config_id, estado, data, created_at)
  SELECT gen_random_uuid(), v_neg4_id, bc.id,
    CASE WHEN bd.tipo = 'equipo' THEN 'completo' ELSE 'pendiente' END,
    '{}'::jsonb, NOW()
  FROM bloque_configs bc
  JOIN bloque_definitions bd ON bd.id = bc.bloque_definition_id
  WHERE bc.etapa_id = v_etapa3_id AND bc.workspace_id = v_ws_id
  ON CONFLICT (negocio_id, bloque_config_id) DO NOTHING;

  -- Para negocio en cobro (neg5 — etapa 5):
  INSERT INTO negocio_bloques (id, negocio_id, bloque_config_id, estado, data, created_at)
  SELECT gen_random_uuid(), v_neg5_id, bc.id,
    CASE WHEN bd.tipo = 'cobros' THEN 'pendiente' ELSE 'completo' END,
    '{}'::jsonb, NOW()
  FROM bloque_configs bc
  JOIN bloque_definitions bd ON bd.id = bc.bloque_definition_id
  WHERE bc.etapa_id = v_etapa5_id AND bc.workspace_id = v_ws_id
  ON CONFLICT (negocio_id, bloque_config_id) DO NOTHING;

  -- Para negocio completado (neg6 — etapa 5):
  INSERT INTO negocio_bloques (id, negocio_id, bloque_config_id, estado, data, created_at)
  SELECT gen_random_uuid(), v_neg6_id, bc.id, 'completo', '{}'::jsonb, NOW()
  FROM bloque_configs bc
  WHERE bc.etapa_id = v_etapa5_id AND bc.workspace_id = v_ws_id
  ON CONFLICT (negocio_id, bloque_config_id) DO NOTHING;

  RAISE NOTICE 'Demo workspace "Ana Morales Consulting" creado exitosamente (slug: ana-demo)';

END $$;
