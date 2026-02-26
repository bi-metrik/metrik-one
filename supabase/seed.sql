-- ============================================================
-- MéTRIK ONE — Seed Data: Estudio Creativo Lúmina
-- 14 meses de datos ficticios (ene 2025 – feb 2026)
-- Cubre 41 tablas (español + legacy inglés)
-- ============================================================

-- ════════════════════════════════════════════════════════════
-- §0. CONFIGURACIÓN — Desactivar RLS y triggers para seed
-- ════════════════════════════════════════════════════════════
SET session_replication_role = 'replica';

-- ════════════════════════════════════════════════════════════
-- §0.1 UUID CONSTANTS
-- ════════════════════════════════════════════════════════════
-- Prefijos legibles para debugging:
--   11111111 = workspace    55555555 = oportunidades
--   00000000 = auth user    66666666 = cotizaciones
--   22222222 = contactos    67676767 = items cotización
--   33333333 = empresas     68686868 = rubros cotización
--   44444444 = staff        77777777 = proyectos
--   44440000 = servicios    78787878 = proyecto_rubros
--                           88888888 = facturas
--                           99999999 = cobros
--                           aaaaaaaa = gastos
--                           bbbbbbbb = gastos_fijos_config
--                           bcbcbcbc = gastos_fijos_borradores
--                           cccccccc = config_metas
--                           dddddddd = saldos_banco
--                           eeeeeeee = horas
--   Legacy:
--     33330000 = clients     55550000 = opportunities
--     22220000 = contacts    77770000 = projects
--     22221111 = promoters   88880000 = invoices
--     ecececec = expense_cat  99990000 = payments
--     aaaa0000 = expenses     eeee0000 = time_entries

-- ════════════════════════════════════════════════════════════
-- §0.2 CLEANUP — Borrar datos anteriores del workspace demo
-- ════════════════════════════════════════════════════════════
DO $$
DECLARE
  ws_id UUID := '11111111-0000-0000-0000-000000000001';
  usr_id UUID := '00000000-0000-0000-0000-000000000001';
BEGIN
  -- Reverse FK order cleanup
  DELETE FROM streaks WHERE workspace_id = ws_id;
  DELETE FROM costos_referencia WHERE workspace_id = ws_id;
  DELETE FROM config_financiera WHERE workspace_id = ws_id;
  DELETE FROM saldos_banco WHERE workspace_id = ws_id;
  DELETE FROM config_metas WHERE workspace_id = ws_id;
  DELETE FROM cobros WHERE workspace_id = ws_id;
  DELETE FROM facturas WHERE workspace_id = ws_id;
  DELETE FROM gastos WHERE workspace_id = ws_id;
  DELETE FROM gastos_fijos_borradores WHERE workspace_id = ws_id;
  DELETE FROM gastos_fijos_config WHERE workspace_id = ws_id;
  DELETE FROM horas WHERE workspace_id = ws_id;
  DELETE FROM proyecto_notas WHERE workspace_id = ws_id;
  DELETE FROM proyecto_rubros WHERE proyecto_id IN (SELECT id FROM proyectos WHERE workspace_id = ws_id);
  DELETE FROM proyectos WHERE workspace_id = ws_id;
  DELETE FROM rubros WHERE item_id IN (
    SELECT i.id FROM items i JOIN cotizaciones c ON c.id = i.cotizacion_id WHERE c.workspace_id = ws_id
  );
  DELETE FROM items WHERE cotizacion_id IN (SELECT id FROM cotizaciones WHERE workspace_id = ws_id);
  DELETE FROM cotizaciones WHERE workspace_id = ws_id;
  DELETE FROM oportunidad_notas WHERE workspace_id = ws_id;
  DELETE FROM oportunidades WHERE workspace_id = ws_id;
  DELETE FROM empresas WHERE workspace_id = ws_id;
  DELETE FROM contactos WHERE workspace_id = ws_id;
  DELETE FROM servicios WHERE workspace_id = ws_id;
  DELETE FROM staff WHERE workspace_id = ws_id;
  DELETE FROM fiscal_profiles WHERE workspace_id = ws_id;
  DELETE FROM profiles WHERE workspace_id = ws_id;
  DELETE FROM workspaces WHERE id = ws_id;
  DELETE FROM auth.users WHERE id = usr_id;
END $$;

-- ════════════════════════════════════════════════════════════
-- §1. AUTH USER
-- ════════════════════════════════════════════════════════════
INSERT INTO auth.users (
  id, instance_id, aud, role, email, encrypted_password,
  email_confirmed_at, created_at, updated_at,
  raw_app_meta_data, raw_user_meta_data, is_super_admin
) VALUES (
  '00000000-0000-0000-0000-000000000001',
  '00000000-0000-0000-0000-000000000000',
  'authenticated', 'authenticated',
  'demo@metrik.com.co',
  crypt('demo1234', gen_salt('bf')),
  now(), '2025-01-01T00:00:00Z', now(),
  '{"provider":"email","providers":["email"]}',
  '{"full_name":"Lucía Vargas"}',
  false
);

-- ════════════════════════════════════════════════════════════
-- §2. WORKSPACE
-- ════════════════════════════════════════════════════════════
INSERT INTO workspaces (
  id, slug, name, subscription_status, subscription_started_at,
  trial_ends_at, profession, years_independent, onboarding_completed,
  logo_url, color_primario, color_secundario, equipo_declarado,
  created_at, updated_at
) VALUES (
  '11111111-0000-0000-0000-000000000001',
  'estudio-creativo-lumina',
  'Estudio Creativo Lúmina',
  'active_pro',
  '2025-01-01T00:00:00Z',
  '2025-01-15T00:00:00Z',
  'disenador', 4, true,
  NULL, '#7C3AED', '#1E1B4B', 3,
  '2025-01-01T00:00:00Z', now()
);

-- ════════════════════════════════════════════════════════════
-- §3. PROFILE
-- ════════════════════════════════════════════════════════════
INSERT INTO profiles (id, workspace_id, full_name, role, created_at) VALUES
  ('00000000-0000-0000-0000-000000000001', '11111111-0000-0000-0000-000000000001',
   'Lucía Vargas', 'owner', '2025-01-01T00:00:00Z');

-- ════════════════════════════════════════════════════════════
-- §4. FISCAL PROFILE (workspace-level)
-- ════════════════════════════════════════════════════════════
INSERT INTO fiscal_profiles (
  id, workspace_id, person_type, tax_regime, self_withholder,
  ica_rate, ica_city, is_complete, nit, razon_social,
  direccion_fiscal, email_facturacion, created_at
) VALUES (
  'ff000000-0000-0000-0000-000000000001',
  '11111111-0000-0000-0000-000000000001',
  'natural', 'responsable_iva', false,
  11.04, 'Medellín', true,
  '1037654321-2', 'Lucía Vargas Estudio Creativo',
  'Cra 43A #1-50 Of 1204, Medellín',
  'facturacion@lumina.co',
  '2025-01-01T00:00:00Z'
);

-- ════════════════════════════════════════════════════════════
-- §5. STAFF (3 personas)
-- ════════════════════════════════════════════════════════════
INSERT INTO staff (id, workspace_id, full_name, phone_whatsapp, position, is_active, salary, horas_disponibles_mes, es_principal, tipo_acceso, tipo_vinculo, created_at) VALUES
  ('44444444-0000-0000-0000-000000000001', '11111111-0000-0000-0000-000000000001',
   'Lucía Vargas', '3001234567', 'Directora Creativa',
   true, 6000000, 160, true, 'app', 'empleado', '2025-01-01T00:00:00Z'),
  ('44444444-0000-0000-0000-000000000002', '11111111-0000-0000-0000-000000000001',
   'Tomás Rendón', '3009876543', 'Diseñador Senior',
   true, 4000000, 160, false, 'ambos', 'contratista', '2025-01-15T00:00:00Z'),
  ('44444444-0000-0000-0000-000000000003', '11111111-0000-0000-0000-000000000001',
   'Isabella Montoya', '3005551234', 'Community Manager',
   true, 2500000, 120, false, 'whatsapp', 'freelance', '2025-03-01T00:00:00Z');

-- ════════════════════════════════════════════════════════════
-- §6. SERVICIOS (catálogo de 5)
-- ════════════════════════════════════════════════════════════
INSERT INTO servicios (id, workspace_id, nombre, precio_estandar, costo_estimado, activo, created_at) VALUES
  ('44440000-0000-0000-0000-000000000001', '11111111-0000-0000-0000-000000000001',
   'Identidad de Marca', 8000000, 3200000, true, '2025-01-01T00:00:00Z'),
  ('44440000-0000-0000-0000-000000000002', '11111111-0000-0000-0000-000000000001',
   'Diseño Web', 12000000, 5000000, true, '2025-01-01T00:00:00Z'),
  ('44440000-0000-0000-0000-000000000003', '11111111-0000-0000-0000-000000000001',
   'Gestión Redes Sociales (mes)', 3500000, 1800000, true, '2025-01-01T00:00:00Z'),
  ('44440000-0000-0000-0000-000000000004', '11111111-0000-0000-0000-000000000001',
   'Producción Fotográfica', 5000000, 2000000, true, '2025-01-01T00:00:00Z'),
  ('44440000-0000-0000-0000-000000000005', '11111111-0000-0000-0000-000000000001',
   'Producción Audiovisual', 15000000, 7500000, true, '2025-01-01T00:00:00Z');

-- ════════════════════════════════════════════════════════════
-- §7. CONTACTOS (10 personas)
-- ════════════════════════════════════════════════════════════
INSERT INTO contactos (id, workspace_id, nombre, telefono, email, fuente_adquisicion, fuente_detalle, fuente_promotor_id, fuente_referido_nombre, rol, comision_porcentaje, segmento, created_at) VALUES
  ('22222222-0000-0000-0000-000000000001', '11111111-0000-0000-0000-000000000001',
   'Carolina Mejía', '3101112233', 'carolina@technova.co', 'contacto_directo', 'Reunión networking Ruta N', NULL, NULL, 'decisor', 0, 'convertido', '2025-01-05T00:00:00Z'),
  ('22222222-0000-0000-0000-000000000002', '11111111-0000-0000-0000-000000000001',
   'Andrés Gutiérrez', '3114445566', 'andres@cafemontanero.com', 'referido', 'Referido por Carolina Mejía', NULL, 'Carolina Mejía', 'decisor', 0, 'convertido', '2025-01-20T00:00:00Z'),
  ('22222222-0000-0000-0000-000000000003', '11111111-0000-0000-0000-000000000001',
   'Valentina Ospina', '3127778899', 'valentina.ospina@gmail.com', 'red_social_organico', 'Contactó por Instagram', NULL, NULL, 'promotor', 12, 'convertido', '2025-02-10T00:00:00Z'),
  ('22222222-0000-0000-0000-000000000004', '11111111-0000-0000-0000-000000000001',
   'Felipe Ruiz', '3139990011', 'felipe@altiplano.com.co', 'alianza', 'Alianza con arquitecto asociado', NULL, NULL, 'influenciador', 0, 'convertido', '2025-03-15T00:00:00Z'),
  ('22222222-0000-0000-0000-000000000005', '11111111-0000-0000-0000-000000000001',
   'Mariana Torres', '3142223344', 'mariana@raicesfundacion.org', 'web_organico', 'Encontró portafolio en Google', NULL, NULL, 'decisor', 0, 'contactado', '2025-02-15T00:00:00Z'),
  ('22222222-0000-0000-0000-000000000006', '11111111-0000-0000-0000-000000000001',
   'Ricardo Londoño', '3155556677', 'ricardo@hotelrosario.co', 'evento', 'Feria de turismo Medellín 2025', NULL, NULL, 'operativo', 0, 'convertido', '2025-05-10T00:00:00Z'),
  ('22222222-0000-0000-0000-000000000007', '11111111-0000-0000-0000-000000000001',
   'Sofía Hernández', '3168889900', 'sofia@technova.co', 'pauta_digital', 'Pauta Instagram Stories', NULL, NULL, 'decisor', 0, 'convertido', '2025-07-20T00:00:00Z'),
  ('22222222-0000-0000-0000-000000000008', '11111111-0000-0000-0000-000000000001',
   'Diego Castaño', '3171112244', 'diego.castano@outlook.com', 'promotor', 'Promotor aliado desde 2024', NULL, NULL, 'promotor', 15, 'contactado', '2025-01-10T00:00:00Z'),
  ('22222222-0000-0000-0000-000000000009', '11111111-0000-0000-0000-000000000001',
   'Camila Restrepo', '3183334455', 'camila@elfogon.co', 'contacto_directo', 'Vecina del cowork', NULL, NULL, 'decisor', 0, 'sin_contactar', '2026-02-10T00:00:00Z'),
  ('22222222-0000-0000-0000-000000000010', '11111111-0000-0000-0000-000000000001',
   'Julián Bedoya', '3195556688', 'julian.bedoya@gmail.com', 'referido', 'Referido por Diego Castaño', '22222222-0000-0000-0000-000000000008', 'Diego Castaño', 'decisor', 0, 'contactado', '2026-01-15T00:00:00Z');

-- ════════════════════════════════════════════════════════════
-- §8. EMPRESAS (6)
-- ════════════════════════════════════════════════════════════
INSERT INTO empresas (id, workspace_id, nombre, sector, numero_documento, tipo_documento, tipo_persona, regimen_tributario, gran_contribuyente, agente_retenedor, contacto_id, contacto_nombre, contacto_email, created_at) VALUES
  ('33333333-0000-0000-0000-000000000001', '11111111-0000-0000-0000-000000000001',
   'TechNova SAS', 'Tecnología', '901234567-1', 'NIT', 'juridica', 'comun', false, true,
   '22222222-0000-0000-0000-000000000001', 'Carolina Mejía', 'carolina@technova.co', '2025-01-05T00:00:00Z'),
  ('33333333-0000-0000-0000-000000000002', '11111111-0000-0000-0000-000000000001',
   'Café Montañero', 'Agroindustria', '1098765432', 'CC', 'natural', 'simple', NULL, false,
   '22222222-0000-0000-0000-000000000002', 'Andrés Gutiérrez', 'andres@cafemontanero.com', '2025-01-20T00:00:00Z'),
  ('33333333-0000-0000-0000-000000000003', '11111111-0000-0000-0000-000000000001',
   'Constructora Altiplano SAS', 'Construcción', '900876543-2', 'NIT', 'juridica', 'comun', true, true,
   '22222222-0000-0000-0000-000000000004', 'Felipe Ruiz', 'felipe@altiplano.com.co', '2025-03-15T00:00:00Z'),
  ('33333333-0000-0000-0000-000000000004', '11111111-0000-0000-0000-000000000001',
   'Hotel Boutique Rosario', 'Hotelería', '901555888-3', 'NIT', 'juridica', 'comun', false, true,
   '22222222-0000-0000-0000-000000000006', 'Ricardo Londoño', 'ricardo@hotelrosario.co', '2025-05-10T00:00:00Z'),
  ('33333333-0000-0000-0000-000000000005', '11111111-0000-0000-0000-000000000001',
   'Fundación Raíces', 'ONGs', '900111222-4', 'NIT', 'juridica', 'no_responsable', false, false,
   '22222222-0000-0000-0000-000000000005', 'Mariana Torres', 'mariana@raicesfundacion.org', '2025-02-15T00:00:00Z'),
  ('33333333-0000-0000-0000-000000000006', '11111111-0000-0000-0000-000000000001',
   'Restaurante El Fogón', 'Gastronomía', '1045678901', 'CC', 'natural', 'simple', NULL, NULL,
   '22222222-0000-0000-0000-000000000009', 'Camila Restrepo', 'camila@elfogon.co', '2026-02-10T00:00:00Z');

-- ════════════════════════════════════════════════════════════
-- §12. OPORTUNIDADES (12 — todas las etapas del pipeline)
-- ════════════════════════════════════════════════════════════
INSERT INTO oportunidades (id, workspace_id, contacto_id, empresa_id, descripcion, etapa, probabilidad, valor_estimado, ultima_accion, ultima_accion_fecha, fecha_cierre_estimada, razon_perdida, carpeta_url, created_at) VALUES
  -- 1. TechNova Branding → GANADA (ene 2025)
  ('55555555-0000-0000-0000-000000000001', '11111111-0000-0000-0000-000000000001',
   '22222222-0000-0000-0000-000000000001', '33333333-0000-0000-0000-000000000001',
   'Branding corporativo completo', 'ganada', 100, 8000000,
   'Propuesta aceptada y anticipo recibido', '2025-01-25T00:00:00Z', '2025-02-15', NULL, NULL, '2025-01-10T00:00:00Z'),
  -- 2. Café Montañero Empaques → GANADA (feb 2025)
  ('55555555-0000-0000-0000-000000000002', '11111111-0000-0000-0000-000000000001',
   '22222222-0000-0000-0000-000000000002', '33333333-0000-0000-0000-000000000002',
   'Diseño de empaques línea premium', 'ganada', 100, 5500000,
   'Contrato firmado', '2025-02-20T00:00:00Z', '2025-03-15', NULL, NULL, '2025-02-05T00:00:00Z'),
  -- 3. Fundación Raíces Web → PERDIDA (feb 2025)
  ('55555555-0000-0000-0000-000000000003', '11111111-0000-0000-0000-000000000001',
   '22222222-0000-0000-0000-000000000005', '33333333-0000-0000-0000-000000000005',
   'Sitio web institucional', 'perdida', 0, 10000000,
   'Decidieron hacer internamente', '2025-03-10T00:00:00Z', '2025-04-01', 'Presupuesto insuficiente - decidieron hacer internamente', NULL, '2025-02-20T00:00:00Z'),
  -- 4. Constructora Altiplano Branding+Web → GANADA (may 2025)
  ('55555555-0000-0000-0000-000000000004', '11111111-0000-0000-0000-000000000001',
   '22222222-0000-0000-0000-000000000004', '33333333-0000-0000-0000-000000000003',
   'Branding + Landing page proyecto residencial', 'ganada', 100, 18000000,
   'Anticipo recibido, inicio de proyecto', '2025-05-10T00:00:00Z', '2025-06-15', NULL, NULL, '2025-04-15T00:00:00Z'),
  -- 5. Hotel Rosario Fotos → GANADA (jun 2025)
  ('55555555-0000-0000-0000-000000000005', '11111111-0000-0000-0000-000000000001',
   '22222222-0000-0000-0000-000000000006', '33333333-0000-0000-0000-000000000004',
   'Campaña fotográfica temporada alta', 'ganada', 100, 5000000,
   'Sesión fotográfica completada', '2025-06-15T00:00:00Z', '2025-07-01', NULL, NULL, '2025-05-20T00:00:00Z'),
  -- 6. TechNova App UI/UX → GANADA (sep 2025)
  ('55555555-0000-0000-0000-000000000006', '11111111-0000-0000-0000-000000000001',
   '22222222-0000-0000-0000-000000000007', '33333333-0000-0000-0000-000000000001',
   'Rediseño app móvil UI/UX', 'ganada', 100, 15000000,
   'Kick-off meeting realizado', '2025-09-05T00:00:00Z', '2025-12-15', NULL, NULL, '2025-08-01T00:00:00Z'),
  -- 7. Café Montañero Redes → GANADA (nov 2025)
  ('55555555-0000-0000-0000-000000000007', '11111111-0000-0000-0000-000000000001',
   '22222222-0000-0000-0000-000000000002', '33333333-0000-0000-0000-000000000002',
   'Gestión redes sociales 6 meses', 'ganada', 100, 21000000,
   'Contrato semestral firmado', '2025-11-01T00:00:00Z', '2025-11-15', NULL, NULL, '2025-10-10T00:00:00Z'),
  -- 8. Fundación Raíces Video → GANADA (dic 2025)
  ('55555555-0000-0000-0000-000000000008', '11111111-0000-0000-0000-000000000001',
   '22222222-0000-0000-0000-000000000005', '33333333-0000-0000-0000-000000000005',
   'Video institucional 3 minutos', 'ganada', 100, 12000000,
   'Brief aprobado, preproducción iniciada', '2025-12-05T00:00:00Z', '2026-02-28', NULL, NULL, '2025-11-15T00:00:00Z'),
  -- 9. Altiplano Señalética → PROPUESTA_ENVIADA (ene 2026)
  ('55555555-0000-0000-0000-000000000009', '11111111-0000-0000-0000-000000000001',
   '22222222-0000-0000-0000-000000000004', '33333333-0000-0000-0000-000000000003',
   'Señalética proyecto residencial Alturas del Poblado', 'propuesta_enviada', 60, 7500000,
   'Cotización enviada, esperando respuesta', '2026-01-28T00:00:00Z', '2026-03-01', NULL, NULL, '2026-01-20T00:00:00Z'),
  -- 10. Hotel Rosario Web → DISCOVERY_HECHA (feb 2026)
  ('55555555-0000-0000-0000-000000000010', '11111111-0000-0000-0000-000000000001',
   '22222222-0000-0000-0000-000000000006', '33333333-0000-0000-0000-000000000004',
   'Rediseño web + sistema de booking', 'discovery_hecha', 40, 14000000,
   'Discovery call completada, levantando requerimientos', '2026-02-12T00:00:00Z', '2026-04-15', NULL, NULL, '2026-02-05T00:00:00Z'),
  -- 11. El Fogón Identidad → CONTACTO_INICIAL (feb 2026)
  ('55555555-0000-0000-0000-000000000011', '11111111-0000-0000-0000-000000000001',
   '22222222-0000-0000-0000-000000000009', '33333333-0000-0000-0000-000000000006',
   'Identidad visual completa restaurante', 'contacto_inicial', 20, 8000000,
   'Primer contacto por WhatsApp', '2026-02-16T00:00:00Z', '2026-04-01', NULL, NULL, '2026-02-15T00:00:00Z'),
  -- 12. Lead nuevo — Julián Bedoya (sin empresa aún) → LEAD_NUEVO
  ('55555555-0000-0000-0000-000000000012', '11111111-0000-0000-0000-000000000001',
   '22222222-0000-0000-0000-000000000010', '33333333-0000-0000-0000-000000000006',
   'Consultoría marca personal', 'lead_nuevo', 10, 4000000,
   NULL, NULL, '2026-04-01', NULL, NULL, '2026-02-20T00:00:00Z');

-- ════════════════════════════════════════════════════════════
-- §13. OPORTUNIDAD NOTAS (~25 notas)
-- ════════════════════════════════════════════════════════════
INSERT INTO oportunidad_notas (id, workspace_id, oportunidad_id, contenido, canal_registro, created_at) VALUES
  -- Opp 1: TechNova Branding
  ('56560000-0000-0000-0000-000000000001', '11111111-0000-0000-0000-000000000001', '55555555-0000-0000-0000-000000000001', 'Primera reunión con Carolina. Necesitan renovar imagen corporativa completa. Tienen urgencia por lanzamiento Q2.', 'app', '2025-01-10T10:00:00Z'),
  ('56560000-0000-0000-0000-000000000002', '11111111-0000-0000-0000-000000000001', '55555555-0000-0000-0000-000000000001', 'Enviada propuesta detallada: logo + manual de marca + papelería + social media kit. $8M.', 'app', '2025-01-18T14:00:00Z'),
  ('56560000-0000-0000-0000-000000000003', '11111111-0000-0000-0000-000000000001', '55555555-0000-0000-0000-000000000001', 'Propuesta aceptada. Anticipo del 50% recibido. Arrancamos la semana entrante.', 'whatsapp', '2025-01-25T09:00:00Z'),
  -- Opp 2: Café Montañero
  ('56560000-0000-0000-0000-000000000004', '11111111-0000-0000-0000-000000000001', '55555555-0000-0000-0000-000000000002', 'Andrés quiere empaques premium para su nueva línea de café de especialidad. Tiene muestras de referencia.', 'app', '2025-02-05T11:00:00Z'),
  ('56560000-0000-0000-0000-000000000005', '11111111-0000-0000-0000-000000000001', '55555555-0000-0000-0000-000000000002', 'Cotización flash enviada: $5.5M por 4 diseños de empaque + guía de uso.', 'app', '2025-02-12T16:00:00Z'),
  -- Opp 3: Fundación Raíces Web (perdida)
  ('56560000-0000-0000-0000-000000000006', '11111111-0000-0000-0000-000000000001', '55555555-0000-0000-0000-000000000003', 'Mariana necesita sitio web institucional. Tienen contenido pero no presupuesto grande.', 'app', '2025-02-20T10:00:00Z'),
  ('56560000-0000-0000-0000-000000000007', '11111111-0000-0000-0000-000000000001', '55555555-0000-0000-0000-000000000003', 'Enviamos propuesta de $10M. Mariana dice que es más de lo que tienen. Intentaremos ajustar.', 'app', '2025-03-01T15:00:00Z'),
  ('56560000-0000-0000-0000-000000000008', '11111111-0000-0000-0000-000000000001', '55555555-0000-0000-0000-000000000003', 'Decidieron hacerlo internamente con un voluntario. Perdida por presupuesto.', 'whatsapp', '2025-03-10T08:00:00Z'),
  -- Opp 4: Altiplano Branding+Web
  ('56560000-0000-0000-0000-000000000009', '11111111-0000-0000-0000-000000000001', '55555555-0000-0000-0000-000000000004', 'Felipe conectó con Constructora Altiplano. Proyecto residencial nuevo, necesitan toda la imagen.', 'app', '2025-04-15T09:00:00Z'),
  ('56560000-0000-0000-0000-000000000010', '11111111-0000-0000-0000-000000000001', '55555555-0000-0000-0000-000000000004', 'Discovery completada. Branding completo + landing page para ventas del proyecto. Presupuesto $18M.', 'app', '2025-04-28T14:00:00Z'),
  ('56560000-0000-0000-0000-000000000011', '11111111-0000-0000-0000-000000000001', '55555555-0000-0000-0000-000000000004', 'Aceptada. Gran proyecto. Anticipo transferido hoy.', 'whatsapp', '2025-05-10T11:00:00Z'),
  -- Opp 5: Hotel Rosario
  ('56560000-0000-0000-0000-000000000012', '11111111-0000-0000-0000-000000000001', '55555555-0000-0000-0000-000000000005', 'Ricardo necesita fotos profesionales del hotel para temporada alta. 2 días de producción.', 'app', '2025-05-20T10:00:00Z'),
  ('56560000-0000-0000-0000-000000000013', '11111111-0000-0000-0000-000000000001', '55555555-0000-0000-0000-000000000005', 'Propuesta aceptada. Sesión agendada para junio.', 'app', '2025-06-01T09:00:00Z'),
  -- Opp 6: TechNova App
  ('56560000-0000-0000-0000-000000000014', '11111111-0000-0000-0000-000000000001', '55555555-0000-0000-0000-000000000006', 'Sofía de TechNova contacta para rediseño de su app. Quieren mejorar UX del onboarding.', 'app', '2025-08-01T14:00:00Z'),
  ('56560000-0000-0000-0000-000000000015', '11111111-0000-0000-0000-000000000001', '55555555-0000-0000-0000-000000000006', 'Propuesta detallada: research + wireframes + UI + guía de componentes. $15M en 4 meses.', 'app', '2025-08-20T11:00:00Z'),
  ('56560000-0000-0000-0000-000000000016', '11111111-0000-0000-0000-000000000001', '55555555-0000-0000-0000-000000000006', 'Aceptada. Arrancamos septiembre con fase de research.', 'whatsapp', '2025-09-05T08:00:00Z'),
  -- Opp 7: Café Montañero Redes
  ('56560000-0000-0000-0000-000000000017', '11111111-0000-0000-0000-000000000001', '55555555-0000-0000-0000-000000000007', 'Andrés quiere gestión de redes sociales. Instagram + TikTok. Contrato semestral.', 'app', '2025-10-10T10:00:00Z'),
  ('56560000-0000-0000-0000-000000000018', '11111111-0000-0000-0000-000000000001', '55555555-0000-0000-0000-000000000007', 'Firmado contrato semestral: $3.5M/mes × 6 meses = $21M total.', 'whatsapp', '2025-11-01T09:00:00Z'),
  -- Opp 8: Fundación Video
  ('56560000-0000-0000-0000-000000000019', '11111111-0000-0000-0000-000000000001', '55555555-0000-0000-0000-000000000008', 'Mariana regresa. Ahora necesitan video institucional. Consiguieron presupuesto de cooperación internacional.', 'app', '2025-11-15T11:00:00Z'),
  ('56560000-0000-0000-0000-000000000020', '11111111-0000-0000-0000-000000000001', '55555555-0000-0000-0000-000000000008', 'Propuesta de $12M aceptada. Incluye guión + producción + postproducción.', 'app', '2025-12-05T14:00:00Z'),
  -- Opp 9: Altiplano Señalética
  ('56560000-0000-0000-0000-000000000021', '11111111-0000-0000-0000-000000000001', '55555555-0000-0000-0000-000000000009', 'Felipe pregunta por señalética interior del proyecto Alturas del Poblado.', 'whatsapp', '2026-01-20T10:00:00Z'),
  ('56560000-0000-0000-0000-000000000022', '11111111-0000-0000-0000-000000000001', '55555555-0000-0000-0000-000000000009', 'Cotización enviada por $7.5M. Incluye diseño + supervisión de instalación.', 'app', '2026-01-28T15:00:00Z'),
  -- Opp 10: Hotel Rosario Web
  ('56560000-0000-0000-0000-000000000023', '11111111-0000-0000-0000-000000000001', '55555555-0000-0000-0000-000000000010', 'Ricardo quiere rediseñar la web del hotel con sistema de booking integrado.', 'app', '2026-02-05T10:00:00Z'),
  ('56560000-0000-0000-0000-000000000024', '11111111-0000-0000-0000-000000000001', '55555555-0000-0000-0000-000000000010', 'Discovery call realizada. Mapeamos flujo de reservas actual. Necesitan pasarela de pagos.', 'app', '2026-02-12T14:00:00Z'),
  -- Opp 11: El Fogón
  ('56560000-0000-0000-0000-000000000025', '11111111-0000-0000-0000-000000000001', '55555555-0000-0000-0000-000000000011', 'Camila escribió por WhatsApp preguntando por diseño de marca para su restaurante nuevo.', 'whatsapp', '2026-02-16T08:00:00Z');

-- ════════════════════════════════════════════════════════════
-- §16. COTIZACIONES (9 cotizaciones)
-- ════════════════════════════════════════════════════════════
INSERT INTO cotizaciones (id, workspace_id, oportunidad_id, consecutivo, modo, descripcion, valor_total, margen_porcentaje, costo_total, descuento_porcentaje, descuento_valor, estado, fecha_envio, fecha_validez, notas, condiciones_pago, created_at) VALUES
  -- Opp 1: TechNova Branding (detallada, aceptada)
  ('66666666-0000-0000-0000-000000000001', '11111111-0000-0000-0000-000000000001', '55555555-0000-0000-0000-000000000001',
   'COT-2025-0001', 'detallada', 'Branding corporativo completo TechNova', 8000000, 60.00, 3200000, 0, 0,
   'aceptada', '2025-01-18T14:00:00Z', '2025-02-18', 'Incluye manual de marca digital', '50% anticipo, 50% contra entrega', '2025-01-18T00:00:00Z'),
  -- Opp 2: Café Montañero Empaques (flash, aceptada)
  ('66666666-0000-0000-0000-000000000002', '11111111-0000-0000-0000-000000000001', '55555555-0000-0000-0000-000000000002',
   'COT-2025-0002', 'flash', 'Diseño de empaques línea premium', 5500000, 56.36, 2400000, 0, 0,
   'aceptada', '2025-02-12T16:00:00Z', '2025-03-12', NULL, '40% anticipo, 60% contra entrega', '2025-02-12T00:00:00Z'),
  -- Opp 3: Fundación Raíces Web (detallada, rechazada)
  ('66666666-0000-0000-0000-000000000003', '11111111-0000-0000-0000-000000000001', '55555555-0000-0000-0000-000000000003',
   'COT-2025-0003', 'detallada', 'Sitio web institucional Fundación Raíces', 10000000, 50.00, 5000000, 0, 0,
   'rechazada', '2025-03-01T15:00:00Z', '2025-04-01', 'Incluye hosting primer año', '30/30/40', '2025-03-01T00:00:00Z'),
  -- Opp 4: Altiplano Branding+Web (detallada, aceptada)
  ('66666666-0000-0000-0000-000000000004', '11111111-0000-0000-0000-000000000001', '55555555-0000-0000-0000-000000000004',
   'COT-2025-0004', 'detallada', 'Branding + Landing page Constructora Altiplano', 18000000, 58.33, 7500000, 0, 0,
   'aceptada', '2025-04-28T14:00:00Z', '2025-05-28', 'Proyecto integral: marca + digital', '40% anticipo, 30% avance, 30% entrega', '2025-04-28T00:00:00Z'),
  -- Opp 5: Hotel Rosario Fotos (flash, aceptada)
  ('66666666-0000-0000-0000-000000000005', '11111111-0000-0000-0000-000000000001', '55555555-0000-0000-0000-000000000005',
   'COT-2025-0005', 'flash', 'Campaña fotográfica Hotel Rosario', 5000000, 60.00, 2000000, 0, 0,
   'aceptada', '2025-06-01T09:00:00Z', '2025-07-01', NULL, '50% anticipo, 50% entrega de material', '2025-06-01T00:00:00Z'),
  -- Opp 6: TechNova App (detallada, aceptada)
  ('66666666-0000-0000-0000-000000000006', '11111111-0000-0000-0000-000000000001', '55555555-0000-0000-0000-000000000006',
   'COT-2025-0006', 'detallada', 'Rediseño app móvil TechNova UI/UX', 15000000, 55.33, 6700000, 0, 0,
   'aceptada', '2025-08-20T11:00:00Z', '2025-09-20', 'Incluye research, wireframes, UI kit', '30/30/40 en hitos', '2025-08-20T00:00:00Z'),
  -- Opp 7: Café Montañero Redes (flash, aceptada)
  ('66666666-0000-0000-0000-000000000007', '11111111-0000-0000-0000-000000000001', '55555555-0000-0000-0000-000000000007',
   'COT-2025-0007', 'flash', 'Gestión RRSS Café Montañero - 6 meses', 21000000, 48.57, 10800000, 0, 0,
   'aceptada', '2025-10-20T10:00:00Z', '2025-11-20', '$3.5M mensuales × 6', 'Mensual anticipado', '2025-10-20T00:00:00Z'),
  -- Opp 8: Fundación Video (detallada, aceptada)
  ('66666666-0000-0000-0000-000000000008', '11111111-0000-0000-0000-000000000001', '55555555-0000-0000-0000-000000000008',
   'COT-2025-0008', 'detallada', 'Video institucional Fundación Raíces', 12000000, 37.50, 7500000, 0, 0,
   'aceptada', '2025-11-28T14:00:00Z', '2025-12-28', 'Guión + 2 días producción + postproducción', '40% anticipo, 30% rodaje, 30% entrega', '2025-11-28T00:00:00Z'),
  -- Opp 9: Señalética (detallada, enviada — pendiente)
  ('66666666-0000-0000-0000-000000000009', '11111111-0000-0000-0000-000000000001', '55555555-0000-0000-0000-000000000009',
   'COT-2026-0001', 'detallada', 'Señalética Alturas del Poblado', 7500000, 53.33, 3500000, 0, 0,
   'enviada', '2026-01-28T15:00:00Z', '2026-02-28', 'Diseño + supervisión de instalación', '50% anticipo, 50% entrega', '2026-01-28T00:00:00Z');

-- ════════════════════════════════════════════════════════════
-- §17. ITEMS (líneas de cotización — solo para cotizaciones detalladas)
-- ════════════════════════════════════════════════════════════
INSERT INTO items (id, cotizacion_id, nombre, subtotal, orden, servicio_origen_id, created_at) VALUES
  -- COT-2025-0001: TechNova Branding (3 items)
  ('67676767-0000-0000-0000-000000000001', '66666666-0000-0000-0000-000000000001', 'Diseño de logotipo y variaciones', 3000000, 1, '44440000-0000-0000-0000-000000000001', '2025-01-18T00:00:00Z'),
  ('67676767-0000-0000-0000-000000000002', '66666666-0000-0000-0000-000000000001', 'Manual de identidad visual', 3500000, 2, NULL, '2025-01-18T00:00:00Z'),
  ('67676767-0000-0000-0000-000000000003', '66666666-0000-0000-0000-000000000001', 'Kit redes sociales + papelería', 1500000, 3, NULL, '2025-01-18T00:00:00Z'),
  -- COT-2025-0003: Fundación Web rechazada (2 items)
  ('67676767-0000-0000-0000-000000000004', '66666666-0000-0000-0000-000000000003', 'Diseño y desarrollo web', 7500000, 1, '44440000-0000-0000-0000-000000000002', '2025-03-01T00:00:00Z'),
  ('67676767-0000-0000-0000-000000000005', '66666666-0000-0000-0000-000000000003', 'Hosting y mantenimiento 1 año', 2500000, 2, NULL, '2025-03-01T00:00:00Z'),
  -- COT-2025-0004: Altiplano Branding+Web (4 items)
  ('67676767-0000-0000-0000-000000000006', '66666666-0000-0000-0000-000000000004', 'Identidad de marca', 5000000, 1, '44440000-0000-0000-0000-000000000001', '2025-04-28T00:00:00Z'),
  ('67676767-0000-0000-0000-000000000007', '66666666-0000-0000-0000-000000000004', 'Landing page proyecto residencial', 8000000, 2, '44440000-0000-0000-0000-000000000002', '2025-04-28T00:00:00Z'),
  ('67676767-0000-0000-0000-000000000008', '66666666-0000-0000-0000-000000000004', 'Render 3D fachada', 3000000, 3, NULL, '2025-04-28T00:00:00Z'),
  ('67676767-0000-0000-0000-000000000009', '66666666-0000-0000-0000-000000000004', 'Brochure digital interactivo', 2000000, 4, NULL, '2025-04-28T00:00:00Z'),
  -- COT-2025-0006: TechNova App (3 items)
  ('67676767-0000-0000-0000-000000000010', '66666666-0000-0000-0000-000000000006', 'Research y benchmark UX', 4000000, 1, NULL, '2025-08-20T00:00:00Z'),
  ('67676767-0000-0000-0000-000000000011', '66666666-0000-0000-0000-000000000006', 'Wireframes y prototipos', 5000000, 2, NULL, '2025-08-20T00:00:00Z'),
  ('67676767-0000-0000-0000-000000000012', '66666666-0000-0000-0000-000000000006', 'UI Kit y guía de componentes', 6000000, 3, NULL, '2025-08-20T00:00:00Z'),
  -- COT-2025-0008: Video Fundación (3 items)
  ('67676767-0000-0000-0000-000000000013', '66666666-0000-0000-0000-000000000008', 'Guión y storyboard', 2500000, 1, NULL, '2025-11-28T00:00:00Z'),
  ('67676767-0000-0000-0000-000000000014', '66666666-0000-0000-0000-000000000008', 'Producción (2 días de rodaje)', 5500000, 2, '44440000-0000-0000-0000-000000000005', '2025-11-28T00:00:00Z'),
  ('67676767-0000-0000-0000-000000000015', '66666666-0000-0000-0000-000000000008', 'Postproducción y entrega', 4000000, 3, NULL, '2025-11-28T00:00:00Z'),
  -- COT-2026-0001: Señalética (2 items)
  ('67676767-0000-0000-0000-000000000016', '66666666-0000-0000-0000-000000000009', 'Diseño señalética interior', 5000000, 1, NULL, '2026-01-28T00:00:00Z'),
  ('67676767-0000-0000-0000-000000000017', '66666666-0000-0000-0000-000000000009', 'Supervisión de instalación', 2500000, 2, NULL, '2026-01-28T00:00:00Z');

-- ════════════════════════════════════════════════════════════
-- §18. RUBROS (desglose costos por item — items con detalle)
-- ════════════════════════════════════════════════════════════
INSERT INTO rubros (id, item_id, tipo, descripcion, cantidad, unidad, valor_unitario, orden) VALUES
  -- Item 1: Logo TechNova
  ('68686868-0000-0000-0000-000000000001', '67676767-0000-0000-0000-000000000001', 'mo_propia', 'Concepto y diseño Lucía', 40, 'hora', 37500, 1),
  ('68686868-0000-0000-0000-000000000002', '67676767-0000-0000-0000-000000000001', 'mo_terceros', 'Ilustración Tomás', 20, 'hora', 25000, 2),
  ('68686868-0000-0000-0000-000000000003', '67676767-0000-0000-0000-000000000001', 'software', 'Licencias tipográficas', 1, 'und', 450000, 3),
  -- Item 2: Manual identidad TechNova
  ('68686868-0000-0000-0000-000000000004', '67676767-0000-0000-0000-000000000002', 'mo_propia', 'Maquetación manual', 30, 'hora', 37500, 1),
  ('68686868-0000-0000-0000-000000000005', '67676767-0000-0000-0000-000000000002', 'mo_terceros', 'Diseño aplicaciones', 25, 'hora', 25000, 2),
  ('68686868-0000-0000-0000-000000000006', '67676767-0000-0000-0000-000000000002', 'materiales', 'Mockups y print tests', 1, 'global', 250000, 3),
  -- Item 6: Identidad Altiplano
  ('68686868-0000-0000-0000-000000000007', '67676767-0000-0000-0000-000000000006', 'mo_propia', 'Dirección creativa', 50, 'hora', 37500, 1),
  ('68686868-0000-0000-0000-000000000008', '67676767-0000-0000-0000-000000000006', 'mo_terceros', 'Diseño gráfico', 30, 'hora', 25000, 2),
  -- Item 7: Landing Altiplano
  ('68686868-0000-0000-0000-000000000009', '67676767-0000-0000-0000-000000000007', 'mo_propia', 'Diseño UX/UI landing', 60, 'hora', 37500, 1),
  ('68686868-0000-0000-0000-000000000010', '67676767-0000-0000-0000-000000000007', 'mo_terceros', 'Desarrollo frontend', 80, 'hora', 25000, 2),
  ('68686868-0000-0000-0000-000000000011', '67676767-0000-0000-0000-000000000007', 'software', 'Hosting y dominio', 1, 'año', 500000, 3),
  -- Item 10: Research TechNova App
  ('68686868-0000-0000-0000-000000000012', '67676767-0000-0000-0000-000000000010', 'mo_propia', 'UX Research', 50, 'hora', 37500, 1),
  ('68686868-0000-0000-0000-000000000013', '67676767-0000-0000-0000-000000000010', 'software', 'Herramientas de testing', 1, 'und', 350000, 2),
  -- Item 14: Producción Video Fundación
  ('68686868-0000-0000-0000-000000000014', '67676767-0000-0000-0000-000000000014', 'mo_propia', 'Dirección de arte', 20, 'hora', 37500, 1),
  ('68686868-0000-0000-0000-000000000015', '67676767-0000-0000-0000-000000000014', 'mo_terceros', 'Camarógrafo + equipo', 2, 'día', 1500000, 2),
  ('68686868-0000-0000-0000-000000000016', '67676767-0000-0000-0000-000000000014', 'viaticos', 'Transporte y alimentación rodaje', 2, 'día', 250000, 3);

-- ════════════════════════════════════════════════════════════
-- §20. PROYECTOS (8 — 4 cerrados, 2 en ejecución, 1 pausado, 1 interno)
-- ════════════════════════════════════════════════════════════
INSERT INTO proyectos (id, workspace_id, oportunidad_id, cotizacion_id, empresa_id, contacto_id, nombre, tipo, estado, presupuesto_total, horas_estimadas, avance_porcentaje, ganancia_estimada, retenciones_estimadas, fecha_inicio, fecha_fin_estimada, fecha_cierre, notas_cierre, lecciones_aprendidas, cierre_snapshot, created_at) VALUES
  -- P1: TechNova Branding (cerrado, ene-mar 2025)
  ('77777777-0000-0000-0000-000000000001', '11111111-0000-0000-0000-000000000001',
   '55555555-0000-0000-0000-000000000001', '66666666-0000-0000-0000-000000000001',
   '33333333-0000-0000-0000-000000000001', '22222222-0000-0000-0000-000000000001',
   'TechNova Branding Corporativo', 'cliente', 'cerrado', 8000000, 90, 100,
   4800000, 320000, '2025-01-27', '2025-03-15', '2025-03-10',
   'Entregado a satisfacción. Cliente muy contento con el resultado.',
   'Los mockups ayudan mucho a vender la propuesta. Seguir haciéndolos.',
   '{"presupuesto_total": 8000000, "costo_acumulado": 2950000, "cobrado": 8000000, "horas_reales": 85}',
   '2025-01-27T00:00:00Z'),
  -- P2: Empaques Café Montañero (cerrado, feb-abr 2025)
  ('77777777-0000-0000-0000-000000000002', '11111111-0000-0000-0000-000000000001',
   '55555555-0000-0000-0000-000000000002', '66666666-0000-0000-0000-000000000002',
   '33333333-0000-0000-0000-000000000002', '22222222-0000-0000-0000-000000000002',
   'Empaques Café Montañero Premium', 'cliente', 'cerrado', 5500000, 60, 100,
   3100000, 0, '2025-02-22', '2025-04-15', '2025-04-10',
   'Diseños aprobados. Andrés muy satisfecho. Posible trabajo de redes sociales.',
   'Pedir muestras físicas antes de la producción final.',
   '{"presupuesto_total": 5500000, "costo_acumulado": 2200000, "cobrado": 5500000, "horas_reales": 55}',
   '2025-02-22T00:00:00Z'),
  -- P3: Altiplano Branding+Web (cerrado, may-ago 2025)
  ('77777777-0000-0000-0000-000000000003', '11111111-0000-0000-0000-000000000001',
   '55555555-0000-0000-0000-000000000004', '66666666-0000-0000-0000-000000000004',
   '33333333-0000-0000-0000-000000000003', '22222222-0000-0000-0000-000000000004',
   'Altiplano Branding + Landing', 'cliente', 'cerrado', 18000000, 200, 100,
   10500000, 720000, '2025-05-12', '2025-08-30', '2025-08-25',
   'Proyecto grande pero bien ejecutado. La constructora quedó encantada.',
   'Para proyectos grandes, hacer entregas parciales cada 2 semanas.',
   '{"presupuesto_total": 18000000, "costo_acumulado": 7100000, "cobrado": 18000000, "horas_reales": 195}',
   '2025-05-12T00:00:00Z'),
  -- P4: Hotel Rosario Fotos (cerrado, jun-jul 2025)
  ('77777777-0000-0000-0000-000000000004', '11111111-0000-0000-0000-000000000001',
   '55555555-0000-0000-0000-000000000005', '66666666-0000-0000-0000-000000000005',
   '33333333-0000-0000-0000-000000000004', '22222222-0000-0000-0000-000000000006',
   'Fotografía Hotel Rosario', 'cliente', 'cerrado', 5000000, 40, 100,
   3000000, 200000, '2025-06-05', '2025-07-15', '2025-07-12',
   'Sesión fotográfica completada. 120 fotos entregadas editadas.',
   'Llevar siempre equipo de respaldo para sesiones en exteriores.',
   '{"presupuesto_total": 5000000, "costo_acumulado": 1850000, "cobrado": 5000000, "horas_reales": 38}',
   '2025-06-05T00:00:00Z'),
  -- P5: TechNova App UI/UX (en ejecución, sep 2025-hoy)
  ('77777777-0000-0000-0000-000000000005', '11111111-0000-0000-0000-000000000001',
   '55555555-0000-0000-0000-000000000006', '66666666-0000-0000-0000-000000000006',
   '33333333-0000-0000-0000-000000000001', '22222222-0000-0000-0000-000000000007',
   'TechNova App Rediseño UI/UX', 'cliente', 'en_ejecucion', 15000000, 180, 65,
   8300000, 600000, '2025-09-08', '2026-01-30', NULL,
   NULL, NULL, NULL, '2025-09-08T00:00:00Z'),
  -- P6: Redes Café Montañero (en ejecución, nov 2025-hoy)
  ('77777777-0000-0000-0000-000000000006', '11111111-0000-0000-0000-000000000001',
   '55555555-0000-0000-0000-000000000007', '66666666-0000-0000-0000-000000000007',
   '33333333-0000-0000-0000-000000000002', '22222222-0000-0000-0000-000000000002',
   'Redes Sociales Café Montañero', 'cliente', 'en_ejecucion', 21000000, 480, 55,
   10200000, 0, '2025-11-01', '2026-04-30', NULL,
   NULL, NULL, NULL, '2025-11-01T00:00:00Z'),
  -- P7: Video Fundación Raíces (pausado, dic 2025)
  ('77777777-0000-0000-0000-000000000007', '11111111-0000-0000-0000-000000000001',
   '55555555-0000-0000-0000-000000000008', '66666666-0000-0000-0000-000000000008',
   '33333333-0000-0000-0000-000000000005', '22222222-0000-0000-0000-000000000005',
   'Video Institucional Fundación Raíces', 'cliente', 'pausado', 12000000, 80, 30,
   4500000, 0, '2025-12-10', '2026-03-15', NULL,
   NULL, NULL, NULL, '2025-12-10T00:00:00Z'),
  -- P8: Portafolio Lúmina (interno, en ejecución, ene 2026)
  ('77777777-0000-0000-0000-000000000008', '11111111-0000-0000-0000-000000000001',
   NULL, NULL, NULL, NULL,
   'Portafolio Lúmina 2026', 'interno', 'en_ejecucion', NULL, 40, 45,
   NULL, NULL, '2026-01-06', '2026-03-01', NULL,
   NULL, NULL, NULL, '2026-01-06T00:00:00Z');

-- ════════════════════════════════════════════════════════════
-- §21. PROYECTO RUBROS (presupuesto por línea — proyectos cliente)
-- ════════════════════════════════════════════════════════════
INSERT INTO proyecto_rubros (id, proyecto_id, nombre, presupuestado, tipo, cantidad, unidad, valor_unitario, created_at) VALUES
  -- P1: TechNova Branding
  ('78787878-0000-0000-0000-000000000001', '77777777-0000-0000-0000-000000000001', 'Dirección creativa', 3000000, 'mo_propia', 80, 'hora', 37500, '2025-01-27T00:00:00Z'),
  ('78787878-0000-0000-0000-000000000002', '77777777-0000-0000-0000-000000000001', 'Diseño gráfico', 1250000, 'mo_terceros', 50, 'hora', 25000, '2025-01-27T00:00:00Z'),
  ('78787878-0000-0000-0000-000000000003', '77777777-0000-0000-0000-000000000001', 'Licencias y materiales', 700000, 'software', 1, 'global', 700000, '2025-01-27T00:00:00Z'),
  -- P2: Empaques Montañero
  ('78787878-0000-0000-0000-000000000004', '77777777-0000-0000-0000-000000000002', 'Diseño empaques', 2500000, 'mo_propia', 40, 'hora', 37500, '2025-02-22T00:00:00Z'),  ('78787878-0000-0000-0000-000000000005', '77777777-0000-0000-0000-000000000002', 'Ilustración', 625000, 'mo_terceros', 25, 'hora', 25000, '2025-02-22T00:00:00Z'),
  ('78787878-0000-0000-0000-000000000006', '77777777-0000-0000-0000-000000000002', 'Pruebas de impresión', 350000, 'materiales', 1, 'global', 350000, '2025-02-22T00:00:00Z'),
  -- P3: Altiplano Branding+Web
  ('78787878-0000-0000-0000-000000000007', '77777777-0000-0000-0000-000000000003', 'Dirección creativa', 4500000, 'mo_propia', 120, 'hora', 37500, '2025-05-12T00:00:00Z'),
  ('78787878-0000-0000-0000-000000000008', '77777777-0000-0000-0000-000000000003', 'Diseño y desarrollo', 3750000, 'mo_terceros', 150, 'hora', 25000, '2025-05-12T00:00:00Z'),
  ('78787878-0000-0000-0000-000000000009', '77777777-0000-0000-0000-000000000003', 'Render 3D', 1500000, 'servicios_prof', 1, 'und', 1500000, '2025-05-12T00:00:00Z'),
  ('78787878-0000-0000-0000-000000000010', '77777777-0000-0000-0000-000000000003', 'Software y hosting', 750000, 'software', 1, 'global', 750000, '2025-05-12T00:00:00Z'),
  -- P4: Fotos Hotel Rosario
  ('78787878-0000-0000-0000-000000000011', '77777777-0000-0000-0000-000000000004', 'Dirección y edición', 1500000, 'mo_propia', 40, 'hora', 37500, '2025-06-05T00:00:00Z'),
  ('78787878-0000-0000-0000-000000000012', '77777777-0000-0000-0000-000000000004', 'Alquiler equipo fotográfico', 800000, 'materiales', 2, 'día', 400000, '2025-06-05T00:00:00Z'),
  ('78787878-0000-0000-0000-000000000013', '77777777-0000-0000-0000-000000000004', 'Transporte', 350000, 'viaticos', 1, 'global', 350000, '2025-06-05T00:00:00Z'),
  -- P5: TechNova App
  ('78787878-0000-0000-0000-000000000014', '77777777-0000-0000-0000-000000000005', 'UX Research + Diseño', 6750000, 'mo_propia', 180, 'hora', 37500, '2025-09-08T00:00:00Z'),
  ('78787878-0000-0000-0000-000000000015', '77777777-0000-0000-0000-000000000005', 'Prototipado', 2500000, 'mo_terceros', 100, 'hora', 25000, '2025-09-08T00:00:00Z'),
  ('78787878-0000-0000-0000-000000000016', '77777777-0000-0000-0000-000000000005', 'Herramientas testing', 500000, 'software', 1, 'global', 500000, '2025-09-08T00:00:00Z'),
  -- P6: Redes Café Montañero
  ('78787878-0000-0000-0000-000000000017', '77777777-0000-0000-0000-000000000006', 'Gestión redes Isabella', 7500000, 'mo_propia', 120, 'hora', 20833, '2025-11-01T00:00:00Z'),
  ('78787878-0000-0000-0000-000000000018', '77777777-0000-0000-0000-000000000006', 'Diseño posts Tomás', 3750000, 'mo_terceros', 150, 'hora', 25000, '2025-11-01T00:00:00Z'),
  ('78787878-0000-0000-0000-000000000019', '77777777-0000-0000-0000-000000000006', 'Pauta publicitaria', 3000000, 'general', 6, 'mes', 500000, '2025-11-01T00:00:00Z'),
  -- P7: Video Fundación
  ('78787878-0000-0000-0000-000000000020', '77777777-0000-0000-0000-000000000007', 'Dirección de arte', 1875000, 'mo_propia', 50, 'hora', 37500, '2025-12-10T00:00:00Z'),
  ('78787878-0000-0000-0000-000000000021', '77777777-0000-0000-0000-000000000007', 'Producción audiovisual', 4500000, 'mo_terceros', 3, 'día', 1500000, '2025-12-10T00:00:00Z'),
  ('78787878-0000-0000-0000-000000000022', '77777777-0000-0000-0000-000000000007', 'Viáticos producción', 600000, 'viaticos', 3, 'día', 200000, '2025-12-10T00:00:00Z');

-- ════════════════════════════════════════════════════════════
-- §22. PROYECTO NOTAS
-- ════════════════════════════════════════════════════════════
INSERT INTO proyecto_notas (id, workspace_id, proyecto_id, contenido, canal_registro, created_at) VALUES
  (gen_random_uuid(), '11111111-0000-0000-0000-000000000001', '77777777-0000-0000-0000-000000000001', 'Kick-off con Carolina. Definimos 3 líneas conceptuales.', 'app', '2025-01-28T10:00:00Z'),
  (gen_random_uuid(), '11111111-0000-0000-0000-000000000001', '77777777-0000-0000-0000-000000000001', 'Primera ronda aprobada. Ajustes menores en paleta de color.', 'app', '2025-02-15T14:00:00Z'),
  (gen_random_uuid(), '11111111-0000-0000-0000-000000000001', '77777777-0000-0000-0000-000000000003', 'Entrega parcial: logo + paleta. Constructora aprueba.', 'app', '2025-06-15T09:00:00Z'),
  (gen_random_uuid(), '11111111-0000-0000-0000-000000000001', '77777777-0000-0000-0000-000000000003', 'Landing en desarrollo. Primer preview aprobado.', 'app', '2025-07-20T16:00:00Z'),
  (gen_random_uuid(), '11111111-0000-0000-0000-000000000001', '77777777-0000-0000-0000-000000000005', 'Research completado. 15 entrevistas realizadas.', 'app', '2025-10-15T11:00:00Z'),
  (gen_random_uuid(), '11111111-0000-0000-0000-000000000001', '77777777-0000-0000-0000-000000000005', 'Wireframes V1 enviados. Feedback positivo de Sofía.', 'app', '2025-11-20T14:00:00Z'),
  (gen_random_uuid(), '11111111-0000-0000-0000-000000000001', '77777777-0000-0000-0000-000000000005', 'UI primer módulo listo. Iterando sobre componentes.', 'app', '2026-01-10T10:00:00Z'),
  (gen_random_uuid(), '11111111-0000-0000-0000-000000000001', '77777777-0000-0000-0000-000000000006', 'Primer mes de gestión completado. Engagement +35%.', 'whatsapp', '2025-12-02T09:00:00Z'),
  (gen_random_uuid(), '11111111-0000-0000-0000-000000000001', '77777777-0000-0000-0000-000000000006', 'Andrés feliz con resultados. Pide más contenido de video.', 'app', '2026-01-15T15:00:00Z'),
  (gen_random_uuid(), '11111111-0000-0000-0000-000000000001', '77777777-0000-0000-0000-000000000007', 'Guión aprobado. Preproducción lista. PAUSADO por disponibilidad de la fundación para rodaje.', 'app', '2026-01-20T10:00:00Z');

-- ════════════════════════════════════════════════════════════
-- §24. HORAS (time entries — tabla española)
-- ════════════════════════════════════════════════════════════
-- ~150 entradas realistas repartidas en 8 proyectos y 3 staff
-- Horas reales deben coincidir con cierre_snapshot de §20
-- Staff: Lucía=44..01 (37500/h), Tomás=44..02 (25000/h), Isabella=44..03 (20833/h)
INSERT INTO horas (id, workspace_id, proyecto_id, staff_id, fecha, horas, descripcion, canal_registro, created_at) VALUES
  -- ── P1: TechNova Branding (ene-mar 2025) — 85h total: 50 Lucía + 35 Tomás ──
  ('eeeeeeee-0000-0000-0000-000000000001', '11111111-0000-0000-0000-000000000001', '77777777-0000-0000-0000-000000000001', '44444444-0000-0000-0000-000000000001', '2025-01-28', 6, 'Kick-off y research de marca — análisis competencia TechNova', 'app', '2025-01-28T09:00:00Z'),
  ('eeeeeeee-0000-0000-0000-000000000002', '11111111-0000-0000-0000-000000000001', '77777777-0000-0000-0000-000000000001', '44444444-0000-0000-0000-000000000001', '2025-01-30', 5, 'Moodboard y dirección visual — 3 conceptos', 'app', '2025-01-30T10:00:00Z'),
  ('eeeeeeee-0000-0000-0000-000000000003', '11111111-0000-0000-0000-000000000001', '77777777-0000-0000-0000-000000000001', '44444444-0000-0000-0000-000000000002', '2025-01-31', 4, 'Bocetos logo opciones A, B, C', 'app', '2025-01-31T09:00:00Z'),
  ('eeeeeeee-0000-0000-0000-000000000004', '11111111-0000-0000-0000-000000000001', '77777777-0000-0000-0000-000000000001', '44444444-0000-0000-0000-000000000001', '2025-02-03', 6, 'Iteración concepto A — tipografía y paleta', 'app', '2025-02-03T09:00:00Z'),
  ('eeeeeeee-0000-0000-0000-000000000005', '11111111-0000-0000-0000-000000000001', '77777777-0000-0000-0000-000000000001', '44444444-0000-0000-0000-000000000002', '2025-02-04', 5, 'Vectorización logo y variantes monocromáticas', 'app', '2025-02-04T10:00:00Z'),
  ('eeeeeeee-0000-0000-0000-000000000006', '11111111-0000-0000-0000-000000000001', '77777777-0000-0000-0000-000000000001', '44444444-0000-0000-0000-000000000001', '2025-02-06', 5, 'Presentación primera ronda al cliente', 'app', '2025-02-06T14:00:00Z'),
  ('eeeeeeee-0000-0000-0000-000000000007', '11111111-0000-0000-0000-000000000001', '77777777-0000-0000-0000-000000000001', '44444444-0000-0000-0000-000000000002', '2025-02-10', 6, 'Ajustes paleta y aplicaciones papelería', 'app', '2025-02-10T09:00:00Z'),
  ('eeeeeeee-0000-0000-0000-000000000008', '11111111-0000-0000-0000-000000000001', '77777777-0000-0000-0000-000000000001', '44444444-0000-0000-0000-000000000001', '2025-02-12', 6, 'Manual de marca — sección fundamentos', 'app', '2025-02-12T09:00:00Z'),
  ('eeeeeeee-0000-0000-0000-000000000009', '11111111-0000-0000-0000-000000000001', '77777777-0000-0000-0000-000000000001', '44444444-0000-0000-0000-000000000002', '2025-02-14', 5, 'Mockups tarjetas, sobre y membrete', 'app', '2025-02-14T10:00:00Z'),
  ('eeeeeeee-0000-0000-0000-000000000010', '11111111-0000-0000-0000-000000000001', '77777777-0000-0000-0000-000000000001', '44444444-0000-0000-0000-000000000001', '2025-02-18', 4, 'Revisión feedback Carolina — ajustes menores', 'whatsapp', '2025-02-18T11:00:00Z'),
  ('eeeeeeee-0000-0000-0000-000000000011', '11111111-0000-0000-0000-000000000001', '77777777-0000-0000-0000-000000000001', '44444444-0000-0000-0000-000000000002', '2025-02-20', 5, 'Templates redes sociales — formatos IG y LinkedIn', 'app', '2025-02-20T09:00:00Z'),
  ('eeeeeeee-0000-0000-0000-000000000012', '11111111-0000-0000-0000-000000000001', '77777777-0000-0000-0000-000000000001', '44444444-0000-0000-0000-000000000001', '2025-02-24', 6, 'Manual de marca — sección aplicaciones digitales', 'app', '2025-02-24T09:00:00Z'),
  ('eeeeeeee-0000-0000-0000-000000000013', '11111111-0000-0000-0000-000000000001', '77777777-0000-0000-0000-000000000001', '44444444-0000-0000-0000-000000000002', '2025-02-26', 5, 'Íconos sistema y elementos UI marca', 'app', '2025-02-26T10:00:00Z'),
  ('eeeeeeee-0000-0000-0000-000000000014', '11111111-0000-0000-0000-000000000001', '77777777-0000-0000-0000-000000000001', '44444444-0000-0000-0000-000000000001', '2025-03-03', 5, 'Presentación final — empaquetado entregables', 'app', '2025-03-03T09:00:00Z'),
  ('eeeeeeee-0000-0000-0000-000000000015', '11111111-0000-0000-0000-000000000001', '77777777-0000-0000-0000-000000000001', '44444444-0000-0000-0000-000000000002', '2025-03-05', 5, 'Archivos finales: AI, PDF, PNG — organización carpeta', 'app', '2025-03-05T10:00:00Z'),
  ('eeeeeeee-0000-0000-0000-000000000016', '11111111-0000-0000-0000-000000000001', '77777777-0000-0000-0000-000000000001', '44444444-0000-0000-0000-000000000001', '2025-03-07', 7, 'Entrega final y capacitación uso de marca a Carolina', 'app', '2025-03-07T09:00:00Z'),

  -- ── P2: Empaques Café Montañero (feb-abr 2025) — 55h total: 30 Lucía + 25 Tomás ──
  ('eeeeeeee-0000-0000-0000-000000000017', '11111111-0000-0000-0000-000000000001', '77777777-0000-0000-0000-000000000002', '44444444-0000-0000-0000-000000000001', '2025-02-24', 5, 'Briefing Andrés — research empaques café premium', 'app', '2025-02-24T14:00:00Z'),
  ('eeeeeeee-0000-0000-0000-000000000018', '11111111-0000-0000-0000-000000000001', '77777777-0000-0000-0000-000000000002', '44444444-0000-0000-0000-000000000002', '2025-02-26', 4, 'Exploración estilos ilustración para empaques', 'app', '2025-02-26T14:00:00Z'),
  ('eeeeeeee-0000-0000-0000-000000000019', '11111111-0000-0000-0000-000000000001', '77777777-0000-0000-0000-000000000002', '44444444-0000-0000-0000-000000000001', '2025-03-03', 5, 'Concepto visual empaque bolsa 250g y 500g', 'app', '2025-03-03T14:00:00Z'),
  ('eeeeeeee-0000-0000-0000-000000000020', '11111111-0000-0000-0000-000000000001', '77777777-0000-0000-0000-000000000002', '44444444-0000-0000-0000-000000000002', '2025-03-05', 5, 'Ilustraciones montaña y planta de café', 'app', '2025-03-05T14:00:00Z'),
  ('eeeeeeee-0000-0000-0000-000000000021', '11111111-0000-0000-0000-000000000001', '77777777-0000-0000-0000-000000000002', '44444444-0000-0000-0000-000000000001', '2025-03-10', 4, 'Presentación primera propuesta a Andrés', 'whatsapp', '2025-03-10T10:00:00Z'),
  ('eeeeeeee-0000-0000-0000-000000000022', '11111111-0000-0000-0000-000000000001', '77777777-0000-0000-0000-000000000002', '44444444-0000-0000-0000-000000000002', '2025-03-12', 4, 'Ajustes tipografía y paleta etiqueta', 'app', '2025-03-12T09:00:00Z'),
  ('eeeeeeee-0000-0000-0000-000000000023', '11111111-0000-0000-0000-000000000001', '77777777-0000-0000-0000-000000000002', '44444444-0000-0000-0000-000000000001', '2025-03-17', 5, 'Diseño etiqueta adhesiva lata y caja regalo', 'app', '2025-03-17T09:00:00Z'),
  ('eeeeeeee-0000-0000-0000-000000000024', '11111111-0000-0000-0000-000000000001', '77777777-0000-0000-0000-000000000002', '44444444-0000-0000-0000-000000000002', '2025-03-19', 4, 'Artes finales empaque bolsa con troquel', 'app', '2025-03-19T10:00:00Z'),
  ('eeeeeeee-0000-0000-0000-000000000025', '11111111-0000-0000-0000-000000000001', '77777777-0000-0000-0000-000000000002', '44444444-0000-0000-0000-000000000001', '2025-03-24', 3, 'Supervisión prueba de impresión — ajustes color', 'app', '2025-03-24T11:00:00Z'),
  ('eeeeeeee-0000-0000-0000-000000000026', '11111111-0000-0000-0000-000000000001', '77777777-0000-0000-0000-000000000002', '44444444-0000-0000-0000-000000000002', '2025-03-26', 4, 'Correcciones post prueba impresión — separación CMYK', 'app', '2025-03-26T09:00:00Z'),
  ('eeeeeeee-0000-0000-0000-000000000027', '11111111-0000-0000-0000-000000000001', '77777777-0000-0000-0000-000000000002', '44444444-0000-0000-0000-000000000001', '2025-04-01', 4, 'Archivos finales producción + guía de impresión', 'app', '2025-04-01T09:00:00Z'),
  ('eeeeeeee-0000-0000-0000-000000000028', '11111111-0000-0000-0000-000000000001', '77777777-0000-0000-0000-000000000002', '44444444-0000-0000-0000-000000000002', '2025-04-03', 4, 'Mockups fotorealistas para presentación final', 'app', '2025-04-03T10:00:00Z'),
  ('eeeeeeee-0000-0000-0000-000000000029', '11111111-0000-0000-0000-000000000001', '77777777-0000-0000-0000-000000000002', '44444444-0000-0000-0000-000000000001', '2025-04-07', 4, 'Entrega final y aprobación Andrés', 'app', '2025-04-07T14:00:00Z'),

  -- ── P3: Altiplano Branding+Web (may-ago 2025) — 195h total: 80 Lucía + 115 Tomás ──
  ('eeeeeeee-0000-0000-0000-000000000030', '11111111-0000-0000-0000-000000000001', '77777777-0000-0000-0000-000000000003', '44444444-0000-0000-0000-000000000001', '2025-05-13', 6, 'Kick-off Altiplano — research constructoras y terreno', 'app', '2025-05-13T09:00:00Z'),
  ('eeeeeeee-0000-0000-0000-000000000031', '11111111-0000-0000-0000-000000000001', '77777777-0000-0000-0000-000000000003', '44444444-0000-0000-0000-000000000002', '2025-05-14', 7, 'Exploración visual — materialidad, montaña, piedra', 'app', '2025-05-14T09:00:00Z'),
  ('eeeeeeee-0000-0000-0000-000000000032', '11111111-0000-0000-0000-000000000001', '77777777-0000-0000-0000-000000000003', '44444444-0000-0000-0000-000000000001', '2025-05-16', 6, 'Dirección creativa — estrategia de marca territorial', 'app', '2025-05-16T10:00:00Z'),
  ('eeeeeeee-0000-0000-0000-000000000033', '11111111-0000-0000-0000-000000000001', '77777777-0000-0000-0000-000000000003', '44444444-0000-0000-0000-000000000002', '2025-05-19', 7, 'Diseño logo — 4 propuestas conceptuales', 'app', '2025-05-19T09:00:00Z'),
  ('eeeeeeee-0000-0000-0000-000000000034', '11111111-0000-0000-0000-000000000001', '77777777-0000-0000-0000-000000000003', '44444444-0000-0000-0000-000000000002', '2025-05-21', 7, 'Iteración logo seleccionado — variantes y sistema', 'app', '2025-05-21T09:00:00Z'),
  ('eeeeeeee-0000-0000-0000-000000000035', '11111111-0000-0000-0000-000000000001', '77777777-0000-0000-0000-000000000003', '44444444-0000-0000-0000-000000000001', '2025-05-23', 5, 'Paleta de color y tipografía — fundamentación', 'app', '2025-05-23T10:00:00Z'),
  ('eeeeeeee-0000-0000-0000-000000000036', '11111111-0000-0000-0000-000000000001', '77777777-0000-0000-0000-000000000003', '44444444-0000-0000-0000-000000000002', '2025-05-26', 6, 'Manual de marca — maquetación secciones iniciales', 'app', '2025-05-26T09:00:00Z'),
  ('eeeeeeee-0000-0000-0000-000000000037', '11111111-0000-0000-0000-000000000001', '77777777-0000-0000-0000-000000000003', '44444444-0000-0000-0000-000000000001', '2025-05-28', 5, 'Revisión entregable parcial logo — reunión constructora', 'app', '2025-05-28T14:00:00Z'),
  ('eeeeeeee-0000-0000-0000-000000000038', '11111111-0000-0000-0000-000000000001', '77777777-0000-0000-0000-000000000003', '44444444-0000-0000-0000-000000000002', '2025-06-02', 6, 'Wireframes landing — estructura y flujo de usuario', 'app', '2025-06-02T09:00:00Z'),
  ('eeeeeeee-0000-0000-0000-000000000039', '11111111-0000-0000-0000-000000000001', '77777777-0000-0000-0000-000000000003', '44444444-0000-0000-0000-000000000001', '2025-06-04', 6, 'Copy landing — textos institucionales y CTA', 'app', '2025-06-04T09:00:00Z'),
  ('eeeeeeee-0000-0000-0000-000000000040', '11111111-0000-0000-0000-000000000001', '77777777-0000-0000-0000-000000000003', '44444444-0000-0000-0000-000000000002', '2025-06-06', 7, 'UI design landing — hero section y galería', 'app', '2025-06-06T09:00:00Z'),
  ('eeeeeeee-0000-0000-0000-000000000041', '11111111-0000-0000-0000-000000000001', '77777777-0000-0000-0000-000000000003', '44444444-0000-0000-0000-000000000002', '2025-06-09', 5, 'Diseño secciones interiores — nosotros, proyectos', 'app', '2025-06-09T09:00:00Z'),
  ('eeeeeeee-0000-0000-0000-000000000042', '11111111-0000-0000-0000-000000000001', '77777777-0000-0000-0000-000000000003', '44444444-0000-0000-0000-000000000001', '2025-06-11', 6, 'Revisión diseño landing con cliente — feedback positivo', 'whatsapp', '2025-06-11T14:00:00Z'),
  ('eeeeeeee-0000-0000-0000-000000000043', '11111111-0000-0000-0000-000000000001', '77777777-0000-0000-0000-000000000003', '44444444-0000-0000-0000-000000000002', '2025-06-16', 6, 'Desarrollo front landing — HTML/CSS secciones', 'app', '2025-06-16T09:00:00Z'),
  ('eeeeeeee-0000-0000-0000-000000000044', '11111111-0000-0000-0000-000000000001', '77777777-0000-0000-0000-000000000003', '44444444-0000-0000-0000-000000000002', '2025-06-18', 6, 'Animaciones scroll y microinteracciones landing', 'app', '2025-06-18T09:00:00Z'),
  ('eeeeeeee-0000-0000-0000-000000000045', '11111111-0000-0000-0000-000000000001', '77777777-0000-0000-0000-000000000003', '44444444-0000-0000-0000-000000000001', '2025-06-20', 5, 'QA textos y responsive — ajustes mobile', 'app', '2025-06-20T10:00:00Z'),
  ('eeeeeeee-0000-0000-0000-000000000046', '11111111-0000-0000-0000-000000000001', '77777777-0000-0000-0000-000000000003', '44444444-0000-0000-0000-000000000002', '2025-06-23', 6, 'Integración formulario contacto y mapa', 'app', '2025-06-23T09:00:00Z'),
  ('eeeeeeee-0000-0000-0000-000000000047', '11111111-0000-0000-0000-000000000001', '77777777-0000-0000-0000-000000000003', '44444444-0000-0000-0000-000000000001', '2025-06-25', 5, 'Entrega parcial V2 — landing funcional en staging', 'app', '2025-06-25T14:00:00Z'),
  ('eeeeeeee-0000-0000-0000-000000000048', '11111111-0000-0000-0000-000000000001', '77777777-0000-0000-0000-000000000003', '44444444-0000-0000-0000-000000000002', '2025-07-01', 7, 'Render 3D integración — fachada proyecto residencial', 'app', '2025-07-01T09:00:00Z'),
  ('eeeeeeee-0000-0000-0000-000000000049', '11111111-0000-0000-0000-000000000001', '77777777-0000-0000-0000-000000000003', '44444444-0000-0000-0000-000000000002', '2025-07-03', 5, 'Galería proyectos — slider interactivo con lightbox', 'app', '2025-07-03T09:00:00Z'),
  ('eeeeeeee-0000-0000-0000-000000000050', '11111111-0000-0000-0000-000000000001', '77777777-0000-0000-0000-000000000003', '44444444-0000-0000-0000-000000000001', '2025-07-07', 6, 'Manual de marca — sección web y digital', 'app', '2025-07-07T09:00:00Z'),
  ('eeeeeeee-0000-0000-0000-000000000051', '11111111-0000-0000-0000-000000000001', '77777777-0000-0000-0000-000000000003', '44444444-0000-0000-0000-000000000002', '2025-07-09', 5, 'SEO on-page y meta tags — optimización', 'app', '2025-07-09T09:00:00Z'),
  ('eeeeeeee-0000-0000-0000-000000000052', '11111111-0000-0000-0000-000000000001', '77777777-0000-0000-0000-000000000003', '44444444-0000-0000-0000-000000000002', '2025-07-14', 6, 'Deploy producción y configuración hosting', 'app', '2025-07-14T09:00:00Z'),
  ('eeeeeeee-0000-0000-0000-000000000053', '11111111-0000-0000-0000-000000000001', '77777777-0000-0000-0000-000000000003', '44444444-0000-0000-0000-000000000001', '2025-07-16', 6, 'Testing cross-browser y correcciones responsive', 'app', '2025-07-16T10:00:00Z'),
  ('eeeeeeee-0000-0000-0000-000000000054', '11111111-0000-0000-0000-000000000001', '77777777-0000-0000-0000-000000000003', '44444444-0000-0000-0000-000000000002', '2025-07-21', 6, 'Aplicaciones marca — carpetas, casco, señalización', 'app', '2025-07-21T09:00:00Z'),
  ('eeeeeeee-0000-0000-0000-000000000055', '11111111-0000-0000-0000-000000000001', '77777777-0000-0000-0000-000000000003', '44444444-0000-0000-0000-000000000001', '2025-07-23', 6, 'Papelería corporativa — tarjetas, membrete, sobre', 'app', '2025-07-23T09:00:00Z'),
  ('eeeeeeee-0000-0000-0000-000000000056', '11111111-0000-0000-0000-000000000001', '77777777-0000-0000-0000-000000000003', '44444444-0000-0000-0000-000000000002', '2025-07-28', 6, 'Templates redes — posts, stories, portada LinkedIn', 'app', '2025-07-28T09:00:00Z'),
  ('eeeeeeee-0000-0000-0000-000000000057', '11111111-0000-0000-0000-000000000001', '77777777-0000-0000-0000-000000000003', '44444444-0000-0000-0000-000000000001', '2025-08-04', 6, 'Sesión fotos obra para landing — dirección', 'app', '2025-08-04T08:00:00Z'),
  ('eeeeeeee-0000-0000-0000-000000000058', '11111111-0000-0000-0000-000000000001', '77777777-0000-0000-0000-000000000003', '44444444-0000-0000-0000-000000000002', '2025-08-06', 5, 'Edición fotos y actualización galería landing', 'app', '2025-08-06T09:00:00Z'),
  ('eeeeeeee-0000-0000-0000-000000000059', '11111111-0000-0000-0000-000000000001', '77777777-0000-0000-0000-000000000003', '44444444-0000-0000-0000-000000000001', '2025-08-11', 6, 'Manual de marca final — revisión y empaquetado', 'app', '2025-08-11T09:00:00Z'),
  ('eeeeeeee-0000-0000-0000-000000000060', '11111111-0000-0000-0000-000000000001', '77777777-0000-0000-0000-000000000003', '44444444-0000-0000-0000-000000000002', '2025-08-13', 7, 'Entrega final archivos — organización Drive', 'app', '2025-08-13T09:00:00Z'),
  ('eeeeeeee-0000-0000-0000-000000000061', '11111111-0000-0000-0000-000000000001', '77777777-0000-0000-0000-000000000003', '44444444-0000-0000-0000-000000000001', '2025-08-18', 6, 'Presentación final constructora — capacitación equipo', 'app', '2025-08-18T14:00:00Z'),
  ('eeeeeeee-0000-0000-0000-000000000062', '11111111-0000-0000-0000-000000000001', '77777777-0000-0000-0000-000000000003', '44444444-0000-0000-0000-000000000002', '2025-08-20', 5, 'Últimos ajustes post-entrega y cierre proyecto', 'app', '2025-08-20T09:00:00Z'),

  -- ── P4: Fotos Hotel Rosario (jun-jul 2025) — 38h total: 38 Lucía ──
  ('eeeeeeee-0000-0000-0000-000000000063', '11111111-0000-0000-0000-000000000001', '77777777-0000-0000-0000-000000000004', '44444444-0000-0000-0000-000000000001', '2025-06-06', 4, 'Scouting hotel — recorrido locaciones y plan de tomas', 'app', '2025-06-06T08:00:00Z'),
  ('eeeeeeee-0000-0000-0000-000000000064', '11111111-0000-0000-0000-000000000001', '77777777-0000-0000-0000-000000000004', '44444444-0000-0000-0000-000000000001', '2025-06-09', 3, 'Preparación equipo y checklist producción', 'app', '2025-06-09T10:00:00Z'),
  ('eeeeeeee-0000-0000-0000-000000000065', '11111111-0000-0000-0000-000000000001', '77777777-0000-0000-0000-000000000004', '44444444-0000-0000-0000-000000000001', '2025-06-12', 8, 'Sesión fotográfica día 1 — habitaciones y lobby', 'app', '2025-06-12T07:00:00Z'),
  ('eeeeeeee-0000-0000-0000-000000000066', '11111111-0000-0000-0000-000000000001', '77777777-0000-0000-0000-000000000004', '44444444-0000-0000-0000-000000000001', '2025-06-13', 8, 'Sesión fotográfica día 2 — restaurante, spa, exteriores', 'app', '2025-06-13T07:00:00Z'),
  ('eeeeeeee-0000-0000-0000-000000000067', '11111111-0000-0000-0000-000000000001', '77777777-0000-0000-0000-000000000004', '44444444-0000-0000-0000-000000000001', '2025-06-16', 5, 'Selección y clasificación — curación 120 fotos de 800', 'app', '2025-06-16T09:00:00Z'),
  ('eeeeeeee-0000-0000-0000-000000000068', '11111111-0000-0000-0000-000000000001', '77777777-0000-0000-0000-000000000004', '44444444-0000-0000-0000-000000000001', '2025-06-19', 4, 'Retoque y edición lote 1 — habitaciones', 'app', '2025-06-19T09:00:00Z'),
  ('eeeeeeee-0000-0000-0000-000000000069', '11111111-0000-0000-0000-000000000001', '77777777-0000-0000-0000-000000000004', '44444444-0000-0000-0000-000000000001', '2025-06-23', 3, 'Retoque y edición lote 2 — áreas comunes', 'app', '2025-06-23T10:00:00Z'),
  ('eeeeeeee-0000-0000-0000-000000000070', '11111111-0000-0000-0000-000000000001', '77777777-0000-0000-0000-000000000004', '44444444-0000-0000-0000-000000000001', '2025-07-01', 3, 'Entrega galería y formatos web — alta y baja resolución', 'app', '2025-07-01T14:00:00Z'),

  -- ── P5: TechNova App UI/UX (sep 2025-feb 2026) — 120h so far: 70 Lucía + 50 Tomás ──
  ('eeeeeeee-0000-0000-0000-000000000071', '11111111-0000-0000-0000-000000000001', '77777777-0000-0000-0000-000000000005', '44444444-0000-0000-0000-000000000001', '2025-09-09', 6, 'Kick-off rediseño app — workshop con equipo TechNova', 'app', '2025-09-09T09:00:00Z'),
  ('eeeeeeee-0000-0000-0000-000000000072', '11111111-0000-0000-0000-000000000001', '77777777-0000-0000-0000-000000000005', '44444444-0000-0000-0000-000000000001', '2025-09-11', 6, 'Entrevistas usuarios — 5 sesiones de 45 min', 'app', '2025-09-11T10:00:00Z'),
  ('eeeeeeee-0000-0000-0000-000000000073', '11111111-0000-0000-0000-000000000001', '77777777-0000-0000-0000-000000000005', '44444444-0000-0000-0000-000000000002', '2025-09-15', 6, 'Audit UX app actual — mapeo problemas usabilidad', 'app', '2025-09-15T09:00:00Z'),
  ('eeeeeeee-0000-0000-0000-000000000074', '11111111-0000-0000-0000-000000000001', '77777777-0000-0000-0000-000000000005', '44444444-0000-0000-0000-000000000001', '2025-09-18', 6, 'User personas y journey maps — síntesis research', 'app', '2025-09-18T09:00:00Z'),
  ('eeeeeeee-0000-0000-0000-000000000075', '11111111-0000-0000-0000-000000000001', '77777777-0000-0000-0000-000000000005', '44444444-0000-0000-0000-000000000002', '2025-09-22', 5, 'Arquitectura información — flujos principales', 'app', '2025-09-22T09:00:00Z'),
  ('eeeeeeee-0000-0000-0000-000000000076', '11111111-0000-0000-0000-000000000001', '77777777-0000-0000-0000-000000000005', '44444444-0000-0000-0000-000000000001', '2025-09-25', 5, 'Presentación hallazgos research a Sofía', 'app', '2025-09-25T14:00:00Z'),
  ('eeeeeeee-0000-0000-0000-000000000077', '11111111-0000-0000-0000-000000000001', '77777777-0000-0000-0000-000000000005', '44444444-0000-0000-0000-000000000002', '2025-10-01', 6, 'Wireframes baja fidelidad — módulo dashboard', 'app', '2025-10-01T09:00:00Z'),
  ('eeeeeeee-0000-0000-0000-000000000078', '11111111-0000-0000-0000-000000000001', '77777777-0000-0000-0000-000000000005', '44444444-0000-0000-0000-000000000001', '2025-10-06', 5, 'Wireframes baja fidelidad — módulo reportes', 'app', '2025-10-06T09:00:00Z'),
  ('eeeeeeee-0000-0000-0000-000000000079', '11111111-0000-0000-0000-000000000001', '77777777-0000-0000-0000-000000000005', '44444444-0000-0000-0000-000000000002', '2025-10-09', 5, 'Wireframes baja fidelidad — módulo perfil y settings', 'app', '2025-10-09T10:00:00Z'),
  ('eeeeeeee-0000-0000-0000-000000000080', '11111111-0000-0000-0000-000000000001', '77777777-0000-0000-0000-000000000005', '44444444-0000-0000-0000-000000000001', '2025-10-14', 5, 'Design system — componentes base y tokens', 'app', '2025-10-14T09:00:00Z'),
  ('eeeeeeee-0000-0000-0000-000000000081', '11111111-0000-0000-0000-000000000001', '77777777-0000-0000-0000-000000000005', '44444444-0000-0000-0000-000000000002', '2025-10-20', 4, 'Prototipo interactivo navegación principal', 'app', '2025-10-20T09:00:00Z'),
  ('eeeeeeee-0000-0000-0000-000000000082', '11111111-0000-0000-0000-000000000001', '77777777-0000-0000-0000-000000000005', '44444444-0000-0000-0000-000000000001', '2025-10-23', 5, 'Testing prototipo con 3 usuarios — notas', 'whatsapp', '2025-10-23T10:00:00Z'),
  ('eeeeeeee-0000-0000-0000-000000000083', '11111111-0000-0000-0000-000000000001', '77777777-0000-0000-0000-000000000005', '44444444-0000-0000-0000-000000000002', '2025-11-03', 5, 'UI alta fidelidad — dashboard principal', 'app', '2025-11-03T09:00:00Z'),
  ('eeeeeeee-0000-0000-0000-000000000084', '11111111-0000-0000-0000-000000000001', '77777777-0000-0000-0000-000000000005', '44444444-0000-0000-0000-000000000001', '2025-11-10', 6, 'UI alta fidelidad — pantallas reportes', 'app', '2025-11-10T09:00:00Z'),
  ('eeeeeeee-0000-0000-0000-000000000085', '11111111-0000-0000-0000-000000000001', '77777777-0000-0000-0000-000000000005', '44444444-0000-0000-0000-000000000002', '2025-11-17', 4, 'Animaciones y transiciones — prototipos Figma', 'app', '2025-11-17T09:00:00Z'),
  ('eeeeeeee-0000-0000-0000-000000000086', '11111111-0000-0000-0000-000000000001', '77777777-0000-0000-0000-000000000005', '44444444-0000-0000-0000-000000000001', '2025-11-24', 5, 'Presentación V1 UI a Sofía — feedback integración', 'app', '2025-11-24T14:00:00Z'),
  ('eeeeeeee-0000-0000-0000-000000000087', '11111111-0000-0000-0000-000000000001', '77777777-0000-0000-0000-000000000005', '44444444-0000-0000-0000-000000000002', '2025-12-01', 5, 'Iteración UI — ajustes post feedback Sofía', 'app', '2025-12-01T09:00:00Z'),
  ('eeeeeeee-0000-0000-0000-000000000088', '11111111-0000-0000-0000-000000000001', '77777777-0000-0000-0000-000000000005', '44444444-0000-0000-0000-000000000001', '2025-12-08', 5, 'Design system — documentación componentes', 'app', '2025-12-08T09:00:00Z'),
  ('eeeeeeee-0000-0000-0000-000000000089', '11111111-0000-0000-0000-000000000001', '77777777-0000-0000-0000-000000000005', '44444444-0000-0000-0000-000000000002', '2025-12-15', 5, 'Handoff desarrollo — specs y assets exportados', 'app', '2025-12-15T09:00:00Z'),
  ('eeeeeeee-0000-0000-0000-000000000090', '11111111-0000-0000-0000-000000000001', '77777777-0000-0000-0000-000000000005', '44444444-0000-0000-0000-000000000001', '2026-01-12', 6, 'QA visual desarrollo — revisión implementación módulo 1', 'app', '2026-01-12T09:00:00Z'),
  ('eeeeeeee-0000-0000-0000-000000000091', '11111111-0000-0000-0000-000000000001', '77777777-0000-0000-0000-000000000005', '44444444-0000-0000-0000-000000000001', '2026-01-20', 5, 'Ajustes responsive — breakpoints tablet y mobile', 'app', '2026-01-20T09:00:00Z'),
  ('eeeeeeee-0000-0000-0000-000000000092', '11111111-0000-0000-0000-000000000001', '77777777-0000-0000-0000-000000000005', '44444444-0000-0000-0000-000000000002', '2026-01-27', 5, 'UI módulo notificaciones y estados vacíos', 'app', '2026-01-27T09:00:00Z'),
  ('eeeeeeee-0000-0000-0000-000000000093', '11111111-0000-0000-0000-000000000001', '77777777-0000-0000-0000-000000000005', '44444444-0000-0000-0000-000000000001', '2026-02-03', 5, 'Iteración dark mode — componentes principales', 'app', '2026-02-03T10:00:00Z'),

  -- ── P6: Redes Café Montañero (nov 2025-feb 2026) — 200h so far: 30 Lucía + 50 Tomás + 120 Isabella ──
  ('eeeeeeee-0000-0000-0000-000000000094', '11111111-0000-0000-0000-000000000001', '77777777-0000-0000-0000-000000000006', '44444444-0000-0000-0000-000000000001', '2025-11-03', 6, 'Estrategia redes — plan de contenido mensual nov', 'app', '2025-11-03T09:00:00Z'),
  ('eeeeeeee-0000-0000-0000-000000000095', '11111111-0000-0000-0000-000000000001', '77777777-0000-0000-0000-000000000006', '44444444-0000-0000-0000-000000000002', '2025-11-04', 4, 'Templates visuales IG — grid y stories Montañero', 'app', '2025-11-04T09:00:00Z'),
  ('eeeeeeee-0000-0000-0000-000000000096', '11111111-0000-0000-0000-000000000001', '77777777-0000-0000-0000-000000000006', '44444444-0000-0000-0000-000000000003', '2025-11-05', 5, 'Creación contenido semana 1 — 5 posts + 3 stories', 'app', '2025-11-05T09:00:00Z'),
  ('eeeeeeee-0000-0000-0000-000000000097', '11111111-0000-0000-0000-000000000001', '77777777-0000-0000-0000-000000000006', '44444444-0000-0000-0000-000000000003', '2025-11-07', 4, 'Programación y publicación contenido semana 1', 'app', '2025-11-07T10:00:00Z'),
  ('eeeeeeee-0000-0000-0000-000000000098', '11111111-0000-0000-0000-000000000001', '77777777-0000-0000-0000-000000000006', '44444444-0000-0000-0000-000000000002', '2025-11-10', 4, 'Diseño carrusel proceso tostado del café', 'app', '2025-11-10T09:00:00Z'),
  ('eeeeeeee-0000-0000-0000-000000000099', '11111111-0000-0000-0000-000000000001', '77777777-0000-0000-0000-000000000006', '44444444-0000-0000-0000-000000000003', '2025-11-12', 5, 'Gestión comunidad — respuestas DM y comentarios', 'app', '2025-11-12T09:00:00Z'),
  ('eeeeeeee-0000-0000-0000-000000000100', '11111111-0000-0000-0000-000000000001', '77777777-0000-0000-0000-000000000006', '44444444-0000-0000-0000-000000000003', '2025-11-14', 5, 'Creación contenido semana 2 — reels recetas café', 'app', '2025-11-14T09:00:00Z'),
  ('eeeeeeee-0000-0000-0000-000000000101', '11111111-0000-0000-0000-000000000001', '77777777-0000-0000-0000-000000000006', '44444444-0000-0000-0000-000000000002', '2025-11-17', 4, 'Diseño highlight covers y bio actualización', 'app', '2025-11-17T10:00:00Z'),
  ('eeeeeeee-0000-0000-0000-000000000102', '11111111-0000-0000-0000-000000000001', '77777777-0000-0000-0000-000000000006', '44444444-0000-0000-0000-000000000003', '2025-11-19', 5, 'Creación contenido semana 3 — behind the scenes', 'app', '2025-11-19T09:00:00Z'),
  ('eeeeeeee-0000-0000-0000-000000000103', '11111111-0000-0000-0000-000000000001', '77777777-0000-0000-0000-000000000006', '44444444-0000-0000-0000-000000000003', '2025-11-21', 4, 'Programación y monitoreo engagement semana 3', 'app', '2025-11-21T10:00:00Z'),
  ('eeeeeeee-0000-0000-0000-000000000104', '11111111-0000-0000-0000-000000000001', '77777777-0000-0000-0000-000000000006', '44444444-0000-0000-0000-000000000001', '2025-11-24', 5, 'Revisión métricas mes 1 — reporte engagement', 'whatsapp', '2025-11-24T14:00:00Z'),
  ('eeeeeeee-0000-0000-0000-000000000105', '11111111-0000-0000-0000-000000000001', '77777777-0000-0000-0000-000000000006', '44444444-0000-0000-0000-000000000003', '2025-11-26', 5, 'Contenido semana 4 — promo Black Friday café', 'app', '2025-11-26T09:00:00Z'),
  ('eeeeeeee-0000-0000-0000-000000000106', '11111111-0000-0000-0000-000000000001', '77777777-0000-0000-0000-000000000006', '44444444-0000-0000-0000-000000000002', '2025-11-28', 4, 'Diseño piezas campaña Black Friday Montañero', 'app', '2025-11-28T09:00:00Z'),
  ('eeeeeeee-0000-0000-0000-000000000107', '11111111-0000-0000-0000-000000000001', '77777777-0000-0000-0000-000000000006', '44444444-0000-0000-0000-000000000003', '2025-12-01', 5, 'Creación contenido semana 5 — Navidad y café', 'app', '2025-12-01T09:00:00Z'),
  ('eeeeeeee-0000-0000-0000-000000000108', '11111111-0000-0000-0000-000000000001', '77777777-0000-0000-0000-000000000006', '44444444-0000-0000-0000-000000000002', '2025-12-03', 4, 'Diseño campaña navideña — gift sets y promo', 'app', '2025-12-03T09:00:00Z'),
  ('eeeeeeee-0000-0000-0000-000000000109', '11111111-0000-0000-0000-000000000001', '77777777-0000-0000-0000-000000000006', '44444444-0000-0000-0000-000000000003', '2025-12-05', 5, 'Gestión comunidad — pico navideño DMs y comentarios', 'app', '2025-12-05T09:00:00Z'),
  ('eeeeeeee-0000-0000-0000-000000000110', '11111111-0000-0000-0000-000000000001', '77777777-0000-0000-0000-000000000006', '44444444-0000-0000-0000-000000000003', '2025-12-08', 5, 'Creación contenido semana 6 — orígenes del café', 'app', '2025-12-08T09:00:00Z'),
  ('eeeeeeee-0000-0000-0000-000000000111', '11111111-0000-0000-0000-000000000001', '77777777-0000-0000-0000-000000000006', '44444444-0000-0000-0000-000000000002', '2025-12-10', 4, 'Diseño carrusel — guía de preparación pour over', 'app', '2025-12-10T10:00:00Z'),
  ('eeeeeeee-0000-0000-0000-000000000112', '11111111-0000-0000-0000-000000000001', '77777777-0000-0000-0000-000000000006', '44444444-0000-0000-0000-000000000003', '2025-12-12', 5, 'Producción reel — visita finca cafetera', 'app', '2025-12-12T08:00:00Z'),
  ('eeeeeeee-0000-0000-0000-000000000113', '11111111-0000-0000-0000-000000000001', '77777777-0000-0000-0000-000000000006', '44444444-0000-0000-0000-000000000001', '2025-12-15', 5, 'Estrategia enero — plan contenido nuevo año', 'app', '2025-12-15T09:00:00Z'),
  ('eeeeeeee-0000-0000-0000-000000000114', '11111111-0000-0000-0000-000000000001', '77777777-0000-0000-0000-000000000006', '44444444-0000-0000-0000-000000000003', '2025-12-17', 5, 'Contenido semana 7 — resoluciones cafeteras 2026', 'app', '2025-12-17T09:00:00Z'),
  ('eeeeeeee-0000-0000-0000-000000000115', '11111111-0000-0000-0000-000000000001', '77777777-0000-0000-0000-000000000006', '44444444-0000-0000-0000-000000000002', '2025-12-19', 5, 'Diseño templates enero — nueva estética', 'app', '2025-12-19T09:00:00Z'),
  ('eeeeeeee-0000-0000-0000-000000000116', '11111111-0000-0000-0000-000000000001', '77777777-0000-0000-0000-000000000006', '44444444-0000-0000-0000-000000000003', '2025-12-22', 4, 'Programación contenido vacaciones — batch scheduling', 'app', '2025-12-22T10:00:00Z'),
  ('eeeeeeee-0000-0000-0000-000000000117', '11111111-0000-0000-0000-000000000001', '77777777-0000-0000-0000-000000000006', '44444444-0000-0000-0000-000000000003', '2026-01-06', 5, 'Contenido semana 9 — vuelta al trabajo + nuevos blends', 'app', '2026-01-06T09:00:00Z'),
  ('eeeeeeee-0000-0000-0000-000000000118', '11111111-0000-0000-0000-000000000001', '77777777-0000-0000-0000-000000000006', '44444444-0000-0000-0000-000000000002', '2026-01-08', 4, 'Diseño carrusel — 5 métodos de preparación', 'app', '2026-01-08T09:00:00Z'),
  ('eeeeeeee-0000-0000-0000-000000000119', '11111111-0000-0000-0000-000000000001', '77777777-0000-0000-0000-000000000006', '44444444-0000-0000-0000-000000000003', '2026-01-10', 5, 'Gestión comunidad y respuestas enero', 'app', '2026-01-10T09:00:00Z'),
  ('eeeeeeee-0000-0000-0000-000000000120', '11111111-0000-0000-0000-000000000001', '77777777-0000-0000-0000-000000000006', '44444444-0000-0000-0000-000000000001', '2026-01-13', 6, 'Revisión métricas Q4 — informe trimestral a Andrés', 'app', '2026-01-13T14:00:00Z'),
  ('eeeeeeee-0000-0000-0000-000000000121', '11111111-0000-0000-0000-000000000001', '77777777-0000-0000-0000-000000000006', '44444444-0000-0000-0000-000000000003', '2026-01-15', 6, 'Contenido semana 11 — lanzamiento blend edición limitada', 'app', '2026-01-15T09:00:00Z'),
  ('eeeeeeee-0000-0000-0000-000000000122', '11111111-0000-0000-0000-000000000001', '77777777-0000-0000-0000-000000000006', '44444444-0000-0000-0000-000000000002', '2026-01-17', 4, 'Diseño empaques digitales blend edición limitada', 'app', '2026-01-17T10:00:00Z'),
  ('eeeeeeee-0000-0000-0000-000000000123', '11111111-0000-0000-0000-000000000001', '77777777-0000-0000-0000-000000000006', '44444444-0000-0000-0000-000000000003', '2026-01-20', 6, 'Creación contenido semana 12 — colaboración baristas', 'app', '2026-01-20T09:00:00Z'),
  ('eeeeeeee-0000-0000-0000-000000000124', '11111111-0000-0000-0000-000000000001', '77777777-0000-0000-0000-000000000006', '44444444-0000-0000-0000-000000000003', '2026-01-22', 5, 'Edición y publicación reels semana 12', 'app', '2026-01-22T10:00:00Z'),
  ('eeeeeeee-0000-0000-0000-000000000125', '11111111-0000-0000-0000-000000000001', '77777777-0000-0000-0000-000000000006', '44444444-0000-0000-0000-000000000002', '2026-01-24', 4, 'Diseño infografía — cadena de valor café', 'app', '2026-01-24T09:00:00Z'),
  ('eeeeeeee-0000-0000-0000-000000000126', '11111111-0000-0000-0000-000000000001', '77777777-0000-0000-0000-000000000006', '44444444-0000-0000-0000-000000000003', '2026-01-27', 6, 'Contenido semana 13 — San Valentín café', 'app', '2026-01-27T09:00:00Z'),
  ('eeeeeeee-0000-0000-0000-000000000127', '11111111-0000-0000-0000-000000000001', '77777777-0000-0000-0000-000000000006', '44444444-0000-0000-0000-000000000002', '2026-01-29', 4, 'Diseño campaña San Valentín — piezas IG y FB', 'app', '2026-01-29T09:00:00Z'),
  ('eeeeeeee-0000-0000-0000-000000000128', '11111111-0000-0000-0000-000000000001', '77777777-0000-0000-0000-000000000006', '44444444-0000-0000-0000-000000000003', '2026-02-03', 6, 'Creación contenido semana 14 — latte art tutorial', 'app', '2026-02-03T09:00:00Z'),
  ('eeeeeeee-0000-0000-0000-000000000129', '11111111-0000-0000-0000-000000000001', '77777777-0000-0000-0000-000000000006', '44444444-0000-0000-0000-000000000001', '2026-02-05', 4, 'Revisión métricas enero — ajuste estrategia', 'whatsapp', '2026-02-05T15:00:00Z'),
  ('eeeeeeee-0000-0000-0000-000000000130', '11111111-0000-0000-0000-000000000001', '77777777-0000-0000-0000-000000000006', '44444444-0000-0000-0000-000000000003', '2026-02-07', 7, 'Contenido semana 15 — día del barista', 'app', '2026-02-07T09:00:00Z'),
  ('eeeeeeee-0000-0000-0000-000000000131', '11111111-0000-0000-0000-000000000001', '77777777-0000-0000-0000-000000000006', '44444444-0000-0000-0000-000000000002', '2026-02-10', 5, 'Diseño piezas febrero — énfasis video corto', 'app', '2026-02-10T09:00:00Z'),
  ('eeeeeeee-0000-0000-0000-000000000132', '11111111-0000-0000-0000-000000000001', '77777777-0000-0000-0000-000000000006', '44444444-0000-0000-0000-000000000003', '2026-02-12', 6, 'Gestión comunidad febrero — engagement +40%', 'app', '2026-02-12T09:00:00Z'),
  ('eeeeeeee-0000-0000-0000-000000000133', '11111111-0000-0000-0000-000000000001', '77777777-0000-0000-0000-000000000006', '44444444-0000-0000-0000-000000000001', '2026-02-17', 4, 'Estrategia marzo — planificación contenido trimestre', 'app', '2026-02-17T09:00:00Z'),
  ('eeeeeeee-0000-0000-0000-000000000134', '11111111-0000-0000-0000-000000000001', '77777777-0000-0000-0000-000000000006', '44444444-0000-0000-0000-000000000003', '2026-02-19', 6, 'Creación contenido semana 16 — nuevas recetas frías', 'app', '2026-02-19T09:00:00Z'),

  -- ── P7: Video Fundación (dic 2025-ene 2026) — 25h total: 25 Lucía ──
  ('eeeeeeee-0000-0000-0000-000000000135', '11111111-0000-0000-0000-000000000001', '77777777-0000-0000-0000-000000000007', '44444444-0000-0000-0000-000000000001', '2025-12-11', 5, 'Briefing fundación — objetivos video institucional', 'app', '2025-12-11T09:00:00Z'),
  ('eeeeeeee-0000-0000-0000-000000000136', '11111111-0000-0000-0000-000000000001', '77777777-0000-0000-0000-000000000007', '44444444-0000-0000-0000-000000000001', '2025-12-15', 4, 'Research — videos institucionales referencia', 'app', '2025-12-15T14:00:00Z'),
  ('eeeeeeee-0000-0000-0000-000000000137', '11111111-0000-0000-0000-000000000001', '77777777-0000-0000-0000-000000000007', '44444444-0000-0000-0000-000000000001', '2025-12-18', 5, 'Guión narrativo — estructura y mensaje clave', 'app', '2025-12-18T09:00:00Z'),
  ('eeeeeeee-0000-0000-0000-000000000138', '11111111-0000-0000-0000-000000000001', '77777777-0000-0000-0000-000000000007', '44444444-0000-0000-0000-000000000001', '2025-12-22', 4, 'Storyboard — planos y secuencias del video', 'app', '2025-12-22T10:00:00Z'),
  ('eeeeeeee-0000-0000-0000-000000000139', '11111111-0000-0000-0000-000000000001', '77777777-0000-0000-0000-000000000007', '44444444-0000-0000-0000-000000000001', '2026-01-08', 4, 'Plan de producción — locaciones y logística rodaje', 'app', '2026-01-08T14:00:00Z'),
  ('eeeeeeee-0000-0000-0000-000000000140', '11111111-0000-0000-0000-000000000001', '77777777-0000-0000-0000-000000000007', '44444444-0000-0000-0000-000000000001', '2026-01-15', 3, 'Presentación guión y storyboard a la fundación', 'whatsapp', '2026-01-15T11:00:00Z'),

  -- ── P8: Portafolio Lúmina (ene-feb 2026) — 20h total: 15 Lucía + 5 Tomás ──
  ('eeeeeeee-0000-0000-0000-000000000141', '11111111-0000-0000-0000-000000000001', '77777777-0000-0000-0000-000000000008', '44444444-0000-0000-0000-000000000001', '2026-01-07', 4, 'Definición estructura portafolio — secciones y casos', 'app', '2026-01-07T09:00:00Z'),
  ('eeeeeeee-0000-0000-0000-000000000142', '11111111-0000-0000-0000-000000000001', '77777777-0000-0000-0000-000000000008', '44444444-0000-0000-0000-000000000001', '2026-01-14', 3, 'Redacción caso TechNova — textos y datos', 'app', '2026-01-14T10:00:00Z'),
  ('eeeeeeee-0000-0000-0000-000000000143', '11111111-0000-0000-0000-000000000001', '77777777-0000-0000-0000-000000000008', '44444444-0000-0000-0000-000000000002', '2026-01-16', 3, 'Maquetación Figma — layout portafolio', 'app', '2026-01-16T09:00:00Z'),
  ('eeeeeeee-0000-0000-0000-000000000144', '11111111-0000-0000-0000-000000000001', '77777777-0000-0000-0000-000000000008', '44444444-0000-0000-0000-000000000001', '2026-01-21', 3, 'Redacción caso Altiplano — textos y mockups', 'app', '2026-01-21T10:00:00Z'),
  ('eeeeeeee-0000-0000-0000-000000000145', '11111111-0000-0000-0000-000000000001', '77777777-0000-0000-0000-000000000008', '44444444-0000-0000-0000-000000000001', '2026-01-28', 3, 'Selección fotografías para cada caso de estudio', 'app', '2026-01-28T09:00:00Z'),
  ('eeeeeeee-0000-0000-0000-000000000146', '11111111-0000-0000-0000-000000000001', '77777777-0000-0000-0000-000000000008', '44444444-0000-0000-0000-000000000002', '2026-02-04', 2, 'Exportación y optimización imágenes web', 'app', '2026-02-04T10:00:00Z'),
  ('eeeeeeee-0000-0000-0000-000000000147', '11111111-0000-0000-0000-000000000001', '77777777-0000-0000-0000-000000000008', '44444444-0000-0000-0000-000000000001', '2026-02-11', 2, 'Revisión final textos y diseño — ajustes menores', 'app', '2026-02-11T14:00:00Z');

-- ════════════════════════════════════════════════════════════
-- §26. GASTOS_FIJOS_CONFIG — 6 gastos fijos recurrentes
-- ════════════════════════════════════════════════════════════
INSERT INTO gastos_fijos_config (id, workspace_id, nombre, categoria, monto_referencia, activo, created_at) VALUES
  ('bbbbbbbb-0000-0000-0000-000000000001', '11111111-0000-0000-0000-000000000001', 'Arriendo oficina cowork', 'arriendo', 2800000, true, '2025-01-01T00:00:00Z'),
  ('bbbbbbbb-0000-0000-0000-000000000002', '11111111-0000-0000-0000-000000000001', 'Internet fibra óptica', 'software', 180000, true, '2025-01-01T00:00:00Z'),
  ('bbbbbbbb-0000-0000-0000-000000000003', '11111111-0000-0000-0000-000000000001', 'Adobe Creative Cloud', 'software', 350000, true, '2025-01-01T00:00:00Z'),
  ('bbbbbbbb-0000-0000-0000-000000000004', '11111111-0000-0000-0000-000000000001', 'Transporte mensual', 'transporte', 400000, true, '2025-01-01T00:00:00Z'),
  ('bbbbbbbb-0000-0000-0000-000000000005', '11111111-0000-0000-0000-000000000001', 'Contador honorarios', 'servicios_profesionales', 800000, true, '2025-01-01T00:00:00Z'),
  ('bbbbbbbb-0000-0000-0000-000000000006', '11111111-0000-0000-0000-000000000001', 'Pauta redes propias', 'marketing', 500000, true, '2025-01-01T00:00:00Z');

-- ════════════════════════════════════════════════════════════
-- §29. GASTOS — A) Gastos fijos (81 entries)
-- ════════════════════════════════════════════════════════════
-- gasto_fijo_ref_id se linkea a borradores via UPDATE al final de §27
INSERT INTO gastos (id, workspace_id, fecha, monto, categoria, tipo, descripcion, proyecto_id, empresa_id, rubro_id, soporte_url, soporte_pendiente, deducible, gasto_fijo_ref_id, external_ref, canal_registro, created_at) VALUES
  -- 2025-01
  ('aaaaaaaa-f000-0000-0000-000000000001', '11111111-0000-0000-0000-000000000001', '2025-01-01', 2800000, 'arriendo', 'fijo', 'Arriendo oficina cowork — 2025-01', NULL, NULL, NULL, NULL, false, true, NULL, NULL, 'app', '2025-01-01T08:00:00Z'),
  ('aaaaaaaa-f000-0000-0000-000000000002', '11111111-0000-0000-0000-000000000001', '2025-01-05', 180000, 'software', 'fijo', 'Internet fibra óptica — 2025-01', NULL, NULL, NULL, NULL, false, true, NULL, NULL, 'app', '2025-01-05T08:00:00Z'),
  ('aaaaaaaa-f000-0000-0000-000000000003', '11111111-0000-0000-0000-000000000001', '2025-01-15', 350000, 'software', 'fijo', 'Adobe Creative Cloud — 2025-01', NULL, NULL, NULL, NULL, false, true, NULL, NULL, 'app', '2025-01-15T08:00:00Z'),
  ('aaaaaaaa-f000-0000-0000-000000000004', '11111111-0000-0000-0000-000000000001', '2025-01-25', 400000, 'transporte', 'fijo', 'Transporte mensual — 2025-01', NULL, NULL, NULL, NULL, false, false, NULL, NULL, 'app', '2025-01-25T08:00:00Z'),
  ('aaaaaaaa-f000-0000-0000-000000000005', '11111111-0000-0000-0000-000000000001', '2025-01-10', 800000, 'servicios_profesionales', 'fijo', 'Contador honorarios — 2025-01', NULL, NULL, NULL, NULL, false, true, NULL, NULL, 'app', '2025-01-10T08:00:00Z'),
  ('aaaaaaaa-f000-0000-0000-000000000006', '11111111-0000-0000-0000-000000000001', '2025-01-20', 500000, 'marketing', 'fijo', 'Pauta redes propias — 2025-01', NULL, NULL, NULL, NULL, false, true, NULL, NULL, 'app', '2025-01-20T08:00:00Z'),
  -- 2025-02
  ('aaaaaaaa-f000-0000-0000-000000000007', '11111111-0000-0000-0000-000000000001', '2025-02-01', 2800000, 'arriendo', 'fijo', 'Arriendo oficina cowork — 2025-02', NULL, NULL, NULL, NULL, false, true, NULL, NULL, 'app', '2025-02-01T08:00:00Z'),
  ('aaaaaaaa-f000-0000-0000-000000000008', '11111111-0000-0000-0000-000000000001', '2025-02-05', 180000, 'software', 'fijo', 'Internet fibra óptica — 2025-02', NULL, NULL, NULL, NULL, false, true, NULL, NULL, 'app', '2025-02-05T08:00:00Z'),
  ('aaaaaaaa-f000-0000-0000-000000000009', '11111111-0000-0000-0000-000000000001', '2025-02-15', 350000, 'software', 'fijo', 'Adobe Creative Cloud — 2025-02', NULL, NULL, NULL, NULL, false, true, NULL, NULL, 'app', '2025-02-15T08:00:00Z'),
  ('aaaaaaaa-f000-0000-0000-000000000010', '11111111-0000-0000-0000-000000000001', '2025-02-25', 400000, 'transporte', 'fijo', 'Transporte mensual — 2025-02', NULL, NULL, NULL, NULL, false, false, NULL, NULL, 'app', '2025-02-25T08:00:00Z'),
  ('aaaaaaaa-f000-0000-0000-000000000011', '11111111-0000-0000-0000-000000000001', '2025-02-10', 800000, 'servicios_profesionales', 'fijo', 'Contador honorarios — 2025-02', NULL, NULL, NULL, NULL, false, true, NULL, NULL, 'app', '2025-02-10T08:00:00Z'),
  ('aaaaaaaa-f000-0000-0000-000000000012', '11111111-0000-0000-0000-000000000001', '2025-02-20', 500000, 'marketing', 'fijo', 'Pauta redes propias — 2025-02', NULL, NULL, NULL, NULL, false, true, NULL, NULL, 'app', '2025-02-20T08:00:00Z'),
  -- 2025-03
  ('aaaaaaaa-f000-0000-0000-000000000013', '11111111-0000-0000-0000-000000000001', '2025-03-01', 2800000, 'arriendo', 'fijo', 'Arriendo oficina cowork — 2025-03', NULL, NULL, NULL, NULL, false, true, NULL, NULL, 'app', '2025-03-01T08:00:00Z'),
  ('aaaaaaaa-f000-0000-0000-000000000014', '11111111-0000-0000-0000-000000000001', '2025-03-05', 180000, 'software', 'fijo', 'Internet fibra óptica — 2025-03', NULL, NULL, NULL, NULL, false, true, NULL, NULL, 'app', '2025-03-05T08:00:00Z'),
  ('aaaaaaaa-f000-0000-0000-000000000015', '11111111-0000-0000-0000-000000000001', '2025-03-15', 350000, 'software', 'fijo', 'Adobe Creative Cloud — 2025-03', NULL, NULL, NULL, NULL, false, true, NULL, NULL, 'app', '2025-03-15T08:00:00Z'),
  ('aaaaaaaa-f000-0000-0000-000000000016', '11111111-0000-0000-0000-000000000001', '2025-03-25', 400000, 'transporte', 'fijo', 'Transporte mensual — 2025-03', NULL, NULL, NULL, NULL, false, false, NULL, NULL, 'app', '2025-03-25T08:00:00Z'),
  ('aaaaaaaa-f000-0000-0000-000000000017', '11111111-0000-0000-0000-000000000001', '2025-03-10', 800000, 'servicios_profesionales', 'fijo', 'Contador honorarios — 2025-03', NULL, NULL, NULL, NULL, false, true, NULL, NULL, 'app', '2025-03-10T08:00:00Z'),
  ('aaaaaaaa-f000-0000-0000-000000000018', '11111111-0000-0000-0000-000000000001', '2025-03-20', 500000, 'marketing', 'fijo', 'Pauta redes propias — 2025-03', NULL, NULL, NULL, NULL, false, true, NULL, NULL, 'app', '2025-03-20T08:00:00Z'),
  -- 2025-04
  ('aaaaaaaa-f000-0000-0000-000000000019', '11111111-0000-0000-0000-000000000001', '2025-04-01', 2800000, 'arriendo', 'fijo', 'Arriendo oficina cowork — 2025-04', NULL, NULL, NULL, NULL, false, true, NULL, NULL, 'app', '2025-04-01T08:00:00Z'),
  ('aaaaaaaa-f000-0000-0000-000000000020', '11111111-0000-0000-0000-000000000001', '2025-04-05', 180000, 'software', 'fijo', 'Internet fibra óptica — 2025-04', NULL, NULL, NULL, NULL, false, true, NULL, NULL, 'app', '2025-04-05T08:00:00Z'),
  ('aaaaaaaa-f000-0000-0000-000000000021', '11111111-0000-0000-0000-000000000001', '2025-04-15', 350000, 'software', 'fijo', 'Adobe Creative Cloud — 2025-04', NULL, NULL, NULL, NULL, false, true, NULL, NULL, 'app', '2025-04-15T08:00:00Z'),
  ('aaaaaaaa-f000-0000-0000-000000000022', '11111111-0000-0000-0000-000000000001', '2025-04-25', 400000, 'transporte', 'fijo', 'Transporte mensual — 2025-04', NULL, NULL, NULL, NULL, false, false, NULL, NULL, 'app', '2025-04-25T08:00:00Z'),
  ('aaaaaaaa-f000-0000-0000-000000000023', '11111111-0000-0000-0000-000000000001', '2025-04-10', 800000, 'servicios_profesionales', 'fijo', 'Contador honorarios — 2025-04', NULL, NULL, NULL, NULL, false, true, NULL, NULL, 'app', '2025-04-10T08:00:00Z'),
  ('aaaaaaaa-f000-0000-0000-000000000024', '11111111-0000-0000-0000-000000000001', '2025-04-20', 500000, 'marketing', 'fijo', 'Pauta redes propias — 2025-04', NULL, NULL, NULL, NULL, false, true, NULL, NULL, 'app', '2025-04-20T08:00:00Z'),
  -- 2025-05
  ('aaaaaaaa-f000-0000-0000-000000000025', '11111111-0000-0000-0000-000000000001', '2025-05-01', 2800000, 'arriendo', 'fijo', 'Arriendo oficina cowork — 2025-05', NULL, NULL, NULL, NULL, false, true, NULL, NULL, 'app', '2025-05-01T08:00:00Z'),
  ('aaaaaaaa-f000-0000-0000-000000000026', '11111111-0000-0000-0000-000000000001', '2025-05-05', 180000, 'software', 'fijo', 'Internet fibra óptica — 2025-05', NULL, NULL, NULL, NULL, false, true, NULL, NULL, 'app', '2025-05-05T08:00:00Z'),
  ('aaaaaaaa-f000-0000-0000-000000000027', '11111111-0000-0000-0000-000000000001', '2025-05-15', 350000, 'software', 'fijo', 'Adobe Creative Cloud — 2025-05', NULL, NULL, NULL, NULL, false, true, NULL, NULL, 'app', '2025-05-15T08:00:00Z'),
  ('aaaaaaaa-f000-0000-0000-000000000028', '11111111-0000-0000-0000-000000000001', '2025-05-25', 400000, 'transporte', 'fijo', 'Transporte mensual — 2025-05', NULL, NULL, NULL, NULL, false, false, NULL, NULL, 'app', '2025-05-25T08:00:00Z'),
  ('aaaaaaaa-f000-0000-0000-000000000029', '11111111-0000-0000-0000-000000000001', '2025-05-10', 800000, 'servicios_profesionales', 'fijo', 'Contador honorarios — 2025-05', NULL, NULL, NULL, NULL, false, true, NULL, NULL, 'app', '2025-05-10T08:00:00Z'),
  ('aaaaaaaa-f000-0000-0000-000000000030', '11111111-0000-0000-0000-000000000001', '2025-05-20', 500000, 'marketing', 'fijo', 'Pauta redes propias — 2025-05', NULL, NULL, NULL, NULL, false, true, NULL, NULL, 'app', '2025-05-20T08:00:00Z'),
  -- 2025-06
  ('aaaaaaaa-f000-0000-0000-000000000031', '11111111-0000-0000-0000-000000000001', '2025-06-01', 2800000, 'arriendo', 'fijo', 'Arriendo oficina cowork — 2025-06', NULL, NULL, NULL, NULL, false, true, NULL, NULL, 'app', '2025-06-01T08:00:00Z'),
  ('aaaaaaaa-f000-0000-0000-000000000032', '11111111-0000-0000-0000-000000000001', '2025-06-05', 180000, 'software', 'fijo', 'Internet fibra óptica — 2025-06', NULL, NULL, NULL, NULL, false, true, NULL, NULL, 'app', '2025-06-05T08:00:00Z'),
  ('aaaaaaaa-f000-0000-0000-000000000033', '11111111-0000-0000-0000-000000000001', '2025-06-15', 350000, 'software', 'fijo', 'Adobe Creative Cloud — 2025-06', NULL, NULL, NULL, NULL, false, true, NULL, NULL, 'app', '2025-06-15T08:00:00Z'),
  ('aaaaaaaa-f000-0000-0000-000000000034', '11111111-0000-0000-0000-000000000001', '2025-06-25', 400000, 'transporte', 'fijo', 'Transporte mensual — 2025-06', NULL, NULL, NULL, NULL, false, false, NULL, NULL, 'app', '2025-06-25T08:00:00Z'),
  ('aaaaaaaa-f000-0000-0000-000000000035', '11111111-0000-0000-0000-000000000001', '2025-06-10', 800000, 'servicios_profesionales', 'fijo', 'Contador honorarios — 2025-06', NULL, NULL, NULL, NULL, false, true, NULL, NULL, 'app', '2025-06-10T08:00:00Z'),
  ('aaaaaaaa-f000-0000-0000-000000000036', '11111111-0000-0000-0000-000000000001', '2025-06-20', 500000, 'marketing', 'fijo', 'Pauta redes propias — 2025-06', NULL, NULL, NULL, NULL, false, true, NULL, NULL, 'app', '2025-06-20T08:00:00Z'),
  -- 2025-07
  ('aaaaaaaa-f000-0000-0000-000000000037', '11111111-0000-0000-0000-000000000001', '2025-07-01', 2800000, 'arriendo', 'fijo', 'Arriendo oficina cowork — 2025-07', NULL, NULL, NULL, NULL, false, true, NULL, NULL, 'app', '2025-07-01T08:00:00Z'),
  ('aaaaaaaa-f000-0000-0000-000000000038', '11111111-0000-0000-0000-000000000001', '2025-07-05', 180000, 'software', 'fijo', 'Internet fibra óptica — 2025-07', NULL, NULL, NULL, NULL, false, true, NULL, NULL, 'app', '2025-07-05T08:00:00Z'),
  ('aaaaaaaa-f000-0000-0000-000000000039', '11111111-0000-0000-0000-000000000001', '2025-07-15', 350000, 'software', 'fijo', 'Adobe Creative Cloud — 2025-07', NULL, NULL, NULL, NULL, false, true, NULL, NULL, 'app', '2025-07-15T08:00:00Z'),
  ('aaaaaaaa-f000-0000-0000-000000000040', '11111111-0000-0000-0000-000000000001', '2025-07-25', 400000, 'transporte', 'fijo', 'Transporte mensual — 2025-07', NULL, NULL, NULL, NULL, false, false, NULL, NULL, 'app', '2025-07-25T08:00:00Z'),
  ('aaaaaaaa-f000-0000-0000-000000000041', '11111111-0000-0000-0000-000000000001', '2025-07-10', 800000, 'servicios_profesionales', 'fijo', 'Contador honorarios — 2025-07', NULL, NULL, NULL, NULL, false, true, NULL, NULL, 'app', '2025-07-10T08:00:00Z'),
  ('aaaaaaaa-f000-0000-0000-000000000042', '11111111-0000-0000-0000-000000000001', '2025-07-20', 500000, 'marketing', 'fijo', 'Pauta redes propias — 2025-07', NULL, NULL, NULL, NULL, false, true, NULL, NULL, 'app', '2025-07-20T08:00:00Z'),
  -- 2025-08
  ('aaaaaaaa-f000-0000-0000-000000000043', '11111111-0000-0000-0000-000000000001', '2025-08-01', 2800000, 'arriendo', 'fijo', 'Arriendo oficina cowork — 2025-08', NULL, NULL, NULL, NULL, false, true, NULL, NULL, 'app', '2025-08-01T08:00:00Z'),
  ('aaaaaaaa-f000-0000-0000-000000000044', '11111111-0000-0000-0000-000000000001', '2025-08-05', 180000, 'software', 'fijo', 'Internet fibra óptica — 2025-08', NULL, NULL, NULL, NULL, false, true, NULL, NULL, 'app', '2025-08-05T08:00:00Z'),
  ('aaaaaaaa-f000-0000-0000-000000000045', '11111111-0000-0000-0000-000000000001', '2025-08-15', 350000, 'software', 'fijo', 'Adobe Creative Cloud — 2025-08', NULL, NULL, NULL, NULL, false, true, NULL, NULL, 'app', '2025-08-15T08:00:00Z'),
  ('aaaaaaaa-f000-0000-0000-000000000046', '11111111-0000-0000-0000-000000000001', '2025-08-25', 400000, 'transporte', 'fijo', 'Transporte mensual — 2025-08', NULL, NULL, NULL, NULL, false, false, NULL, NULL, 'app', '2025-08-25T08:00:00Z'),
  ('aaaaaaaa-f000-0000-0000-000000000047', '11111111-0000-0000-0000-000000000001', '2025-08-10', 800000, 'servicios_profesionales', 'fijo', 'Contador honorarios — 2025-08', NULL, NULL, NULL, NULL, false, true, NULL, NULL, 'app', '2025-08-10T08:00:00Z'),
  ('aaaaaaaa-f000-0000-0000-000000000048', '11111111-0000-0000-0000-000000000001', '2025-08-20', 500000, 'marketing', 'fijo', 'Pauta redes propias — 2025-08', NULL, NULL, NULL, NULL, false, true, NULL, NULL, 'app', '2025-08-20T08:00:00Z'),
  -- 2025-09
  ('aaaaaaaa-f000-0000-0000-000000000049', '11111111-0000-0000-0000-000000000001', '2025-09-01', 2800000, 'arriendo', 'fijo', 'Arriendo oficina cowork — 2025-09', NULL, NULL, NULL, NULL, false, true, NULL, NULL, 'app', '2025-09-01T08:00:00Z'),
  ('aaaaaaaa-f000-0000-0000-000000000050', '11111111-0000-0000-0000-000000000001', '2025-09-05', 180000, 'software', 'fijo', 'Internet fibra óptica — 2025-09', NULL, NULL, NULL, NULL, false, true, NULL, NULL, 'app', '2025-09-05T08:00:00Z'),
  ('aaaaaaaa-f000-0000-0000-000000000051', '11111111-0000-0000-0000-000000000001', '2025-09-15', 350000, 'software', 'fijo', 'Adobe Creative Cloud — 2025-09', NULL, NULL, NULL, NULL, false, true, NULL, NULL, 'app', '2025-09-15T08:00:00Z'),
  ('aaaaaaaa-f000-0000-0000-000000000052', '11111111-0000-0000-0000-000000000001', '2025-09-25', 400000, 'transporte', 'fijo', 'Transporte mensual — 2025-09', NULL, NULL, NULL, NULL, false, false, NULL, NULL, 'app', '2025-09-25T08:00:00Z'),
  ('aaaaaaaa-f000-0000-0000-000000000053', '11111111-0000-0000-0000-000000000001', '2025-09-10', 800000, 'servicios_profesionales', 'fijo', 'Contador honorarios — 2025-09', NULL, NULL, NULL, NULL, false, true, NULL, NULL, 'app', '2025-09-10T08:00:00Z'),
  ('aaaaaaaa-f000-0000-0000-000000000054', '11111111-0000-0000-0000-000000000001', '2025-09-20', 500000, 'marketing', 'fijo', 'Pauta redes propias — 2025-09', NULL, NULL, NULL, NULL, false, true, NULL, NULL, 'app', '2025-09-20T08:00:00Z'),
  -- 2025-10
  ('aaaaaaaa-f000-0000-0000-000000000055', '11111111-0000-0000-0000-000000000001', '2025-10-01', 2800000, 'arriendo', 'fijo', 'Arriendo oficina cowork — 2025-10', NULL, NULL, NULL, NULL, false, true, NULL, NULL, 'app', '2025-10-01T08:00:00Z'),
  ('aaaaaaaa-f000-0000-0000-000000000056', '11111111-0000-0000-0000-000000000001', '2025-10-05', 180000, 'software', 'fijo', 'Internet fibra óptica — 2025-10', NULL, NULL, NULL, NULL, false, true, NULL, NULL, 'app', '2025-10-05T08:00:00Z'),
  ('aaaaaaaa-f000-0000-0000-000000000057', '11111111-0000-0000-0000-000000000001', '2025-10-15', 350000, 'software', 'fijo', 'Adobe Creative Cloud — 2025-10', NULL, NULL, NULL, NULL, false, true, NULL, NULL, 'app', '2025-10-15T08:00:00Z'),
  ('aaaaaaaa-f000-0000-0000-000000000058', '11111111-0000-0000-0000-000000000001', '2025-10-25', 400000, 'transporte', 'fijo', 'Transporte mensual — 2025-10', NULL, NULL, NULL, NULL, false, false, NULL, NULL, 'app', '2025-10-25T08:00:00Z'),
  ('aaaaaaaa-f000-0000-0000-000000000059', '11111111-0000-0000-0000-000000000001', '2025-10-10', 800000, 'servicios_profesionales', 'fijo', 'Contador honorarios — 2025-10', NULL, NULL, NULL, NULL, false, true, NULL, NULL, 'app', '2025-10-10T08:00:00Z'),
  ('aaaaaaaa-f000-0000-0000-000000000060', '11111111-0000-0000-0000-000000000001', '2025-10-20', 500000, 'marketing', 'fijo', 'Pauta redes propias — 2025-10', NULL, NULL, NULL, NULL, false, true, NULL, NULL, 'app', '2025-10-20T08:00:00Z'),
  -- 2025-11
  ('aaaaaaaa-f000-0000-0000-000000000061', '11111111-0000-0000-0000-000000000001', '2025-11-01', 2800000, 'arriendo', 'fijo', 'Arriendo oficina cowork — 2025-11', NULL, NULL, NULL, NULL, false, true, NULL, NULL, 'app', '2025-11-01T08:00:00Z'),
  ('aaaaaaaa-f000-0000-0000-000000000062', '11111111-0000-0000-0000-000000000001', '2025-11-05', 180000, 'software', 'fijo', 'Internet fibra óptica — 2025-11', NULL, NULL, NULL, NULL, false, true, NULL, NULL, 'app', '2025-11-05T08:00:00Z'),
  ('aaaaaaaa-f000-0000-0000-000000000063', '11111111-0000-0000-0000-000000000001', '2025-11-15', 350000, 'software', 'fijo', 'Adobe Creative Cloud — 2025-11', NULL, NULL, NULL, NULL, false, true, NULL, NULL, 'app', '2025-11-15T08:00:00Z'),
  ('aaaaaaaa-f000-0000-0000-000000000064', '11111111-0000-0000-0000-000000000001', '2025-11-25', 400000, 'transporte', 'fijo', 'Transporte mensual — 2025-11', NULL, NULL, NULL, NULL, false, false, NULL, NULL, 'app', '2025-11-25T08:00:00Z'),
  ('aaaaaaaa-f000-0000-0000-000000000065', '11111111-0000-0000-0000-000000000001', '2025-11-10', 800000, 'servicios_profesionales', 'fijo', 'Contador honorarios — 2025-11', NULL, NULL, NULL, NULL, false, true, NULL, NULL, 'app', '2025-11-10T08:00:00Z'),
  ('aaaaaaaa-f000-0000-0000-000000000066', '11111111-0000-0000-0000-000000000001', '2025-11-20', 500000, 'marketing', 'fijo', 'Pauta redes propias — 2025-11', NULL, NULL, NULL, NULL, false, true, NULL, NULL, 'app', '2025-11-20T08:00:00Z'),
  -- 2025-12
  ('aaaaaaaa-f000-0000-0000-000000000067', '11111111-0000-0000-0000-000000000001', '2025-12-01', 2800000, 'arriendo', 'fijo', 'Arriendo oficina cowork — 2025-12', NULL, NULL, NULL, NULL, false, true, NULL, NULL, 'app', '2025-12-01T08:00:00Z'),
  ('aaaaaaaa-f000-0000-0000-000000000068', '11111111-0000-0000-0000-000000000001', '2025-12-05', 180000, 'software', 'fijo', 'Internet fibra óptica — 2025-12', NULL, NULL, NULL, NULL, false, true, NULL, NULL, 'app', '2025-12-05T08:00:00Z'),
  ('aaaaaaaa-f000-0000-0000-000000000069', '11111111-0000-0000-0000-000000000001', '2025-12-15', 350000, 'software', 'fijo', 'Adobe Creative Cloud — 2025-12', NULL, NULL, NULL, NULL, false, true, NULL, NULL, 'app', '2025-12-15T08:00:00Z'),
  ('aaaaaaaa-f000-0000-0000-000000000070', '11111111-0000-0000-0000-000000000001', '2025-12-25', 400000, 'transporte', 'fijo', 'Transporte mensual — 2025-12', NULL, NULL, NULL, NULL, false, false, NULL, NULL, 'app', '2025-12-25T08:00:00Z'),
  ('aaaaaaaa-f000-0000-0000-000000000071', '11111111-0000-0000-0000-000000000001', '2025-12-10', 800000, 'servicios_profesionales', 'fijo', 'Contador honorarios — 2025-12', NULL, NULL, NULL, NULL, false, true, NULL, NULL, 'app', '2025-12-10T08:00:00Z'),
  ('aaaaaaaa-f000-0000-0000-000000000072', '11111111-0000-0000-0000-000000000001', '2025-12-20', 500000, 'marketing', 'fijo', 'Pauta redes propias — 2025-12', NULL, NULL, NULL, NULL, false, true, NULL, NULL, 'app', '2025-12-20T08:00:00Z'),
  -- 2026-01
  ('aaaaaaaa-f000-0000-0000-000000000073', '11111111-0000-0000-0000-000000000001', '2026-01-01', 2800000, 'arriendo', 'fijo', 'Arriendo oficina cowork — 2026-01', NULL, NULL, NULL, NULL, false, true, NULL, NULL, 'app', '2026-01-01T08:00:00Z'),
  ('aaaaaaaa-f000-0000-0000-000000000074', '11111111-0000-0000-0000-000000000001', '2026-01-05', 180000, 'software', 'fijo', 'Internet fibra óptica — 2026-01', NULL, NULL, NULL, NULL, false, true, NULL, NULL, 'app', '2026-01-05T08:00:00Z'),
  ('aaaaaaaa-f000-0000-0000-000000000075', '11111111-0000-0000-0000-000000000001', '2026-01-15', 350000, 'software', 'fijo', 'Adobe Creative Cloud — 2026-01', NULL, NULL, NULL, NULL, false, true, NULL, NULL, 'app', '2026-01-15T08:00:00Z'),
  ('aaaaaaaa-f000-0000-0000-000000000076', '11111111-0000-0000-0000-000000000001', '2026-01-25', 400000, 'transporte', 'fijo', 'Transporte mensual — 2026-01', NULL, NULL, NULL, NULL, false, false, NULL, NULL, 'app', '2026-01-25T08:00:00Z'),
  ('aaaaaaaa-f000-0000-0000-000000000077', '11111111-0000-0000-0000-000000000001', '2026-01-10', 800000, 'servicios_profesionales', 'fijo', 'Contador honorarios — 2026-01', NULL, NULL, NULL, NULL, false, true, NULL, NULL, 'app', '2026-01-10T08:00:00Z'),
  ('aaaaaaaa-f000-0000-0000-000000000078', '11111111-0000-0000-0000-000000000001', '2026-01-20', 500000, 'marketing', 'fijo', 'Pauta redes propias — 2026-01', NULL, NULL, NULL, NULL, false, true, NULL, NULL, 'app', '2026-01-20T08:00:00Z'),
  -- 2026-02 (solo 3 confirmados: arriendo, internet, adobe)
  ('aaaaaaaa-f000-0000-0000-000000000079', '11111111-0000-0000-0000-000000000001', '2026-02-01', 2800000, 'arriendo', 'fijo', 'Arriendo oficina cowork — 2026-02', NULL, NULL, NULL, NULL, false, true, NULL, NULL, 'app', '2026-02-01T08:00:00Z'),
  ('aaaaaaaa-f000-0000-0000-000000000080', '11111111-0000-0000-0000-000000000001', '2026-02-05', 180000, 'software', 'fijo', 'Internet fibra óptica — 2026-02', NULL, NULL, NULL, NULL, false, true, NULL, NULL, 'app', '2026-02-05T08:00:00Z'),
  ('aaaaaaaa-f000-0000-0000-000000000081', '11111111-0000-0000-0000-000000000001', '2026-02-15', 350000, 'software', 'fijo', 'Adobe Creative Cloud — 2026-02', NULL, NULL, NULL, NULL, false, true, NULL, NULL, 'app', '2026-02-15T08:00:00Z');

-- ════════════════════════════════════════════════════════════
-- §29. GASTOS — B) Gastos directos de proyecto (24 entries)
-- ════════════════════════════════════════════════════════════
INSERT INTO gastos (id, workspace_id, fecha, monto, categoria, tipo, descripcion, proyecto_id, empresa_id, rubro_id, soporte_url, soporte_pendiente, deducible, gasto_fijo_ref_id, external_ref, canal_registro, created_at) VALUES
  -- P1: TechNova Branding (77777777-...-001) — rubros: 003=licencias
  ('aaaaaaaa-d000-0000-0000-000000000001', '11111111-0000-0000-0000-000000000001', '2025-02-10', 450000, 'software', 'directo', 'Licencias tipográficas familia Satoshi + Clash', '77777777-0000-0000-0000-000000000001', '33333333-0000-0000-0000-000000000001', '78787878-0000-0000-0000-000000000003', NULL, false, true, NULL, NULL, 'app', '2025-02-10T10:00:00Z'),
  ('aaaaaaaa-d000-0000-0000-000000000002', '11111111-0000-0000-0000-000000000001', '2025-03-18', 250000, 'materiales', 'directo', 'Mockups impresos presentación manual de marca', '77777777-0000-0000-0000-000000000001', '33333333-0000-0000-0000-000000000001', NULL, NULL, false, true, NULL, NULL, 'app', '2025-03-18T14:00:00Z'),
  -- P2: Empaques Montañero (77777777-...-002) — rubros: 006=pruebas impresión
  ('aaaaaaaa-d000-0000-0000-000000000003', '11111111-0000-0000-0000-000000000001', '2025-03-22', 350000, 'materiales', 'directo', 'Pruebas de impresión empaques — primera ronda', '77777777-0000-0000-0000-000000000002', '33333333-0000-0000-0000-000000000002', '78787878-0000-0000-0000-000000000006', NULL, false, true, NULL, NULL, 'app', '2025-03-22T11:00:00Z'),
  ('aaaaaaaa-d000-0000-0000-000000000004', '11111111-0000-0000-0000-000000000001', '2025-03-05', 80000, 'materiales', 'directo', 'Muestras café para sesión fotográfica empaques', '77777777-0000-0000-0000-000000000002', '33333333-0000-0000-0000-000000000002', NULL, NULL, false, false, NULL, NULL, 'app', '2025-03-05T09:00:00Z'),
  -- P3: Altiplano Branding+Web (77777777-...-003) — rubros: 009=render3D, 010=software/hosting
  ('aaaaaaaa-d000-0000-0000-000000000005', '11111111-0000-0000-0000-000000000001', '2025-06-20', 1500000, 'servicios_profesionales', 'directo', 'Render 3D fachada residencial — proveedor externo', '77777777-0000-0000-0000-000000000003', '33333333-0000-0000-0000-000000000003', '78787878-0000-0000-0000-000000000009', NULL, false, true, NULL, NULL, 'app', '2025-06-20T10:00:00Z'),
  ('aaaaaaaa-d000-0000-0000-000000000006', '11111111-0000-0000-0000-000000000001', '2025-07-05', 250000, 'software', 'directo', 'Hosting anual plan empresarial', '77777777-0000-0000-0000-000000000003', '33333333-0000-0000-0000-000000000003', '78787878-0000-0000-0000-000000000010', NULL, false, true, NULL, NULL, 'app', '2025-07-05T09:00:00Z'),
  ('aaaaaaaa-d000-0000-0000-000000000007', '11111111-0000-0000-0000-000000000001', '2025-05-20', 150000, 'software', 'directo', 'Dominio altiplano.co — 2 años', '77777777-0000-0000-0000-000000000003', '33333333-0000-0000-0000-000000000003', '78787878-0000-0000-0000-000000000010', NULL, false, true, NULL, NULL, 'app', '2025-05-20T09:00:00Z'),
  ('aaaaaaaa-d000-0000-0000-000000000008', '11111111-0000-0000-0000-000000000001', '2025-08-10', 300000, 'materiales', 'directo', 'Impresión brochure corporativo 500 unidades', '77777777-0000-0000-0000-000000000003', '33333333-0000-0000-0000-000000000003', NULL, NULL, false, true, NULL, NULL, 'app', '2025-08-10T11:00:00Z'),
  -- P4: Hotel Rosario Photos (77777777-...-004) — rubros: 012=alquiler equipo, 013=transporte
  ('aaaaaaaa-d000-0000-0000-000000000009', '11111111-0000-0000-0000-000000000001', '2025-06-11', 800000, 'materiales', 'directo', 'Alquiler equipo fotográfico Canon R5 + lentes', '77777777-0000-0000-0000-000000000004', '33333333-0000-0000-0000-000000000004', '78787878-0000-0000-0000-000000000012', NULL, false, true, NULL, NULL, 'app', '2025-06-11T08:00:00Z'),
  ('aaaaaaaa-d000-0000-0000-000000000010', '11111111-0000-0000-0000-000000000001', '2025-06-12', 200000, 'transporte', 'directo', 'Transporte equipo + asistente ida y vuelta hotel', '77777777-0000-0000-0000-000000000004', '33333333-0000-0000-0000-000000000004', '78787878-0000-0000-0000-000000000013', NULL, false, false, NULL, NULL, 'app', '2025-06-12T07:00:00Z'),
  ('aaaaaaaa-d000-0000-0000-000000000011', '11111111-0000-0000-0000-000000000001', '2025-06-13', 150000, 'alimentacion', 'directo', 'Alimentación equipo durante sesión fotográfica', '77777777-0000-0000-0000-000000000004', '33333333-0000-0000-0000-000000000004', NULL, NULL, false, false, NULL, NULL, 'app', '2025-06-13T12:00:00Z'),
  -- P5: TechNova App (77777777-...-005) — rubros: 016=herramientas testing
  ('aaaaaaaa-d000-0000-0000-000000000012', '11111111-0000-0000-0000-000000000001', '2025-09-15', 350000, 'software', 'directo', 'Licencia Figma equipo — plan profesional anual', '77777777-0000-0000-0000-000000000005', '33333333-0000-0000-0000-000000000001', NULL, NULL, false, true, NULL, NULL, 'app', '2025-09-15T10:00:00Z'),
  ('aaaaaaaa-d000-0000-0000-000000000013', '11111111-0000-0000-0000-000000000001', '2025-10-20', 180000, 'software', 'directo', 'Testing tools — Maze + Hotjar mensual', '77777777-0000-0000-0000-000000000005', '33333333-0000-0000-0000-000000000001', '78787878-0000-0000-0000-000000000016', NULL, false, true, NULL, NULL, 'app', '2025-10-20T10:00:00Z'),
  ('aaaaaaaa-d000-0000-0000-000000000014', '11111111-0000-0000-0000-000000000001', '2025-11-05', 120000, 'transporte', 'directo', 'Viáticos reunión presencial con equipo dev TechNova', '77777777-0000-0000-0000-000000000005', '33333333-0000-0000-0000-000000000001', NULL, NULL, false, false, NULL, NULL, 'app', '2025-11-05T14:00:00Z'),
  -- P6: Redes Montañero (77777777-...-006) — rubros: 019=pauta publicitaria
  ('aaaaaaaa-d000-0000-0000-000000000015', '11111111-0000-0000-0000-000000000001', '2025-11-15', 500000, 'marketing', 'directo', 'Pauta Instagram noviembre — Café Montañero', '77777777-0000-0000-0000-000000000006', '33333333-0000-0000-0000-000000000002', '78787878-0000-0000-0000-000000000019', NULL, false, true, NULL, NULL, 'app', '2025-11-15T09:00:00Z'),
  ('aaaaaaaa-d000-0000-0000-000000000016', '11111111-0000-0000-0000-000000000001', '2025-12-15', 500000, 'marketing', 'directo', 'Pauta Instagram diciembre — Café Montañero', '77777777-0000-0000-0000-000000000006', '33333333-0000-0000-0000-000000000002', '78787878-0000-0000-0000-000000000019', NULL, false, true, NULL, NULL, 'app', '2025-12-15T09:00:00Z'),
  ('aaaaaaaa-d000-0000-0000-000000000017', '11111111-0000-0000-0000-000000000001', '2026-01-15', 500000, 'marketing', 'directo', 'Pauta Instagram enero — Café Montañero', '77777777-0000-0000-0000-000000000006', '33333333-0000-0000-0000-000000000002', '78787878-0000-0000-0000-000000000019', NULL, false, true, NULL, NULL, 'app', '2026-01-15T09:00:00Z'),
  ('aaaaaaaa-d000-0000-0000-000000000018', '11111111-0000-0000-0000-000000000001', '2026-02-15', 500000, 'marketing', 'directo', 'Pauta Instagram febrero — Café Montañero', '77777777-0000-0000-0000-000000000006', '33333333-0000-0000-0000-000000000002', '78787878-0000-0000-0000-000000000019', NULL, false, true, NULL, NULL, 'app', '2026-02-15T09:00:00Z'),
  ('aaaaaaaa-d000-0000-0000-000000000019', '11111111-0000-0000-0000-000000000001', '2025-11-20', 120000, 'software', 'directo', 'Stock photos paquete 50 — Shutterstock', '77777777-0000-0000-0000-000000000006', '33333333-0000-0000-0000-000000000002', NULL, NULL, false, true, NULL, NULL, 'app', '2025-11-20T10:00:00Z'),
  ('aaaaaaaa-d000-0000-0000-000000000020', '11111111-0000-0000-0000-000000000001', '2025-12-03', 80000, 'materiales', 'directo', 'Props sesión fotográfica navideña café', '77777777-0000-0000-0000-000000000006', '33333333-0000-0000-0000-000000000002', NULL, NULL, false, false, NULL, NULL, 'app', '2025-12-03T11:00:00Z'),
  -- P7: Video Fundación (77777777-...-007) — rubros: 021=producción audiovisual, 022=viáticos
  ('aaaaaaaa-d000-0000-0000-000000000021', '11111111-0000-0000-0000-000000000001', '2026-01-22', 1000000, 'materiales', 'directo', 'Alquiler equipo video — cámara, luces, audio', '77777777-0000-0000-0000-000000000007', '33333333-0000-0000-0000-000000000006', '78787878-0000-0000-0000-000000000021', NULL, false, true, NULL, NULL, 'app', '2026-01-22T08:00:00Z'),
  ('aaaaaaaa-d000-0000-0000-000000000022', '11111111-0000-0000-0000-000000000001', '2026-01-23', 150000, 'alimentacion', 'directo', 'Catering día de rodaje fundación', '77777777-0000-0000-0000-000000000007', '33333333-0000-0000-0000-000000000006', '78787878-0000-0000-0000-000000000022', NULL, false, false, NULL, NULL, 'app', '2026-01-23T12:00:00Z'),
  -- P8: Portafolio Lúmina (77777777-...-008) — sin rubros específicos
  ('aaaaaaaa-d000-0000-0000-000000000023', '11111111-0000-0000-0000-000000000001', '2026-01-10', 120000, 'software', 'directo', 'Hosting portafolio — Vercel Pro anual', '77777777-0000-0000-0000-000000000008', NULL, NULL, NULL, false, true, NULL, NULL, 'app', '2026-01-10T09:00:00Z'),
  ('aaaaaaaa-d000-0000-0000-000000000024', '11111111-0000-0000-0000-000000000001', '2026-01-10', 80000, 'software', 'directo', 'Dominio lumina.studio — registro 1 año', '77777777-0000-0000-0000-000000000008', NULL, NULL, NULL, false, true, NULL, NULL, 'app', '2026-01-10T09:30:00Z');

-- ════════════════════════════════════════════════════════════
-- §29. GASTOS — C) Gastos operativos (15 entries)
-- ════════════════════════════════════════════════════════════
INSERT INTO gastos (id, workspace_id, fecha, monto, categoria, tipo, descripcion, proyecto_id, empresa_id, rubro_id, soporte_url, soporte_pendiente, deducible, gasto_fijo_ref_id, external_ref, canal_registro, created_at) VALUES
  ('aaaaaaaa-0000-0000-0000-000000000001', '11111111-0000-0000-0000-000000000001', '2025-01-15', 85000, 'otros', 'operativo', 'Papelería oficina — resmas, post-its, marcadores', NULL, NULL, NULL, NULL, false, true, NULL, NULL, 'app', '2025-01-15T10:00:00Z'),
  ('aaaaaaaa-0000-0000-0000-000000000002', '11111111-0000-0000-0000-000000000001', '2025-02-12', 120000, 'alimentacion', 'operativo', 'Café y snacks oficina mes febrero', NULL, NULL, NULL, NULL, false, false, NULL, NULL, 'app', '2025-02-12T11:00:00Z'),
  ('aaaaaaaa-0000-0000-0000-000000000003', '11111111-0000-0000-0000-000000000001', '2025-03-08', 150000, 'servicios_profesionales', 'operativo', 'Servicio limpieza profunda oficina', NULL, NULL, NULL, NULL, false, true, NULL, NULL, 'app', '2025-03-08T09:00:00Z'),
  ('aaaaaaaa-0000-0000-0000-000000000004', '11111111-0000-0000-0000-000000000001', '2025-04-18', 65000, 'transporte', 'operativo', 'Uber/taxi reuniones varias abril', NULL, NULL, NULL, NULL, false, false, NULL, NULL, 'whatsapp', '2025-04-18T16:00:00Z'),
  ('aaaaaaaa-0000-0000-0000-000000000005', '11111111-0000-0000-0000-000000000001', '2025-05-22', 95000, 'otros', 'operativo', 'Reparación impresora oficina', NULL, NULL, NULL, NULL, false, true, NULL, NULL, 'app', '2025-05-22T14:00:00Z'),
  ('aaaaaaaa-0000-0000-0000-000000000006', '11111111-0000-0000-0000-000000000001', '2025-06-10', 180000, 'capacitacion', 'operativo', 'Taller tipografía experimental — inscripción', NULL, NULL, NULL, NULL, false, true, NULL, NULL, 'app', '2025-06-10T09:00:00Z'),
  ('aaaaaaaa-0000-0000-0000-000000000007', '11111111-0000-0000-0000-000000000001', '2025-07-14', 45000, 'alimentacion', 'operativo', 'Almuerzo equipo celebración cierre proyecto', NULL, NULL, NULL, NULL, false, false, NULL, NULL, 'app', '2025-07-14T13:00:00Z'),
  ('aaaaaaaa-0000-0000-0000-000000000008', '11111111-0000-0000-0000-000000000001', '2025-08-05', 75000, 'otros', 'operativo', 'Papelería y materiales presentaciones Q3', NULL, NULL, NULL, NULL, false, true, NULL, NULL, 'app', '2025-08-05T10:00:00Z'),
  ('aaaaaaaa-0000-0000-0000-000000000009', '11111111-0000-0000-0000-000000000001', '2025-09-20', 55000, 'transporte', 'operativo', 'Taxi reunión bancaria urgente', NULL, NULL, NULL, NULL, false, false, NULL, NULL, 'whatsapp', '2025-09-20T08:00:00Z'),
  ('aaaaaaaa-0000-0000-0000-000000000010', '11111111-0000-0000-0000-000000000001', '2025-10-12', 250000, 'capacitacion', 'operativo', 'Curso online Framer avanzado — equipo diseño', NULL, NULL, NULL, NULL, false, true, NULL, NULL, 'app', '2025-10-12T09:00:00Z'),
  ('aaaaaaaa-0000-0000-0000-000000000011', '11111111-0000-0000-0000-000000000001', '2025-11-08', 110000, 'alimentacion', 'operativo', 'Café y snacks oficina mes noviembre', NULL, NULL, NULL, NULL, false, false, NULL, NULL, 'app', '2025-11-08T11:00:00Z'),
  ('aaaaaaaa-0000-0000-0000-000000000012', '11111111-0000-0000-0000-000000000001', '2025-12-15', 320000, 'otros', 'operativo', 'Regalos navideños clientes — detalle corporativo', NULL, NULL, NULL, NULL, false, false, NULL, NULL, 'app', '2025-12-15T14:00:00Z'),
  ('aaaaaaaa-0000-0000-0000-000000000013', '11111111-0000-0000-0000-000000000001', '2025-12-22', 85000, 'alimentacion', 'operativo', 'Cena fin de año equipo Lúmina', NULL, NULL, NULL, NULL, false, false, NULL, NULL, 'app', '2025-12-22T20:00:00Z'),
  ('aaaaaaaa-0000-0000-0000-000000000014', '11111111-0000-0000-0000-000000000001', '2026-01-20', 70000, 'otros', 'operativo', 'Papelería inicio de año — agendas y planners', NULL, NULL, NULL, NULL, false, true, NULL, NULL, 'app', '2026-01-20T10:00:00Z'),
  ('aaaaaaaa-0000-0000-0000-000000000015', '11111111-0000-0000-0000-000000000001', '2026-02-08', 90000, 'transporte', 'operativo', 'Uber reuniones febrero — varios trayectos', NULL, NULL, NULL, NULL, false, false, NULL, NULL, 'whatsapp', '2026-02-08T17:00:00Z');

-- ════════════════════════════════════════════════════════════
-- §27. GASTOS_FIJOS_BORRADORES — 84 borradores mensuales
-- 14 meses × 6 configs. Feb 2026: configs 4-6 pendientes
-- ════════════════════════════════════════════════════════════
INSERT INTO gastos_fijos_borradores (id, workspace_id, gasto_fijo_config_id, periodo, nombre, categoria, monto_esperado, confirmado, gasto_id, fecha_confirmacion, created_at) VALUES
  -- 2025-01
  ('bcbcbcbc-0000-0000-0000-000000000001', '11111111-0000-0000-0000-000000000001', 'bbbbbbbb-0000-0000-0000-000000000001', '2025-01', 'Arriendo oficina cowork', 'arriendo', 2800000, true, 'aaaaaaaa-f000-0000-0000-000000000001', '2025-01-01T12:00:00Z', '2025-01-01T00:00:00Z'),
  ('bcbcbcbc-0000-0000-0000-000000000002', '11111111-0000-0000-0000-000000000001', 'bbbbbbbb-0000-0000-0000-000000000002', '2025-01', 'Internet fibra óptica', 'software', 180000, true, 'aaaaaaaa-f000-0000-0000-000000000002', '2025-01-05T12:00:00Z', '2025-01-01T00:00:00Z'),
  ('bcbcbcbc-0000-0000-0000-000000000003', '11111111-0000-0000-0000-000000000001', 'bbbbbbbb-0000-0000-0000-000000000003', '2025-01', 'Adobe Creative Cloud', 'software', 350000, true, 'aaaaaaaa-f000-0000-0000-000000000003', '2025-01-15T12:00:00Z', '2025-01-01T00:00:00Z'),
  ('bcbcbcbc-0000-0000-0000-000000000004', '11111111-0000-0000-0000-000000000001', 'bbbbbbbb-0000-0000-0000-000000000004', '2025-01', 'Transporte mensual', 'transporte', 400000, true, 'aaaaaaaa-f000-0000-0000-000000000004', '2025-01-25T12:00:00Z', '2025-01-01T00:00:00Z'),
  ('bcbcbcbc-0000-0000-0000-000000000005', '11111111-0000-0000-0000-000000000001', 'bbbbbbbb-0000-0000-0000-000000000005', '2025-01', 'Contador honorarios', 'servicios_profesionales', 800000, true, 'aaaaaaaa-f000-0000-0000-000000000005', '2025-01-10T12:00:00Z', '2025-01-01T00:00:00Z'),
  ('bcbcbcbc-0000-0000-0000-000000000006', '11111111-0000-0000-0000-000000000001', 'bbbbbbbb-0000-0000-0000-000000000006', '2025-01', 'Pauta redes propias', 'marketing', 500000, true, 'aaaaaaaa-f000-0000-0000-000000000006', '2025-01-20T12:00:00Z', '2025-01-01T00:00:00Z'),
  -- 2025-02
  ('bcbcbcbc-0000-0000-0000-000000000007', '11111111-0000-0000-0000-000000000001', 'bbbbbbbb-0000-0000-0000-000000000001', '2025-02', 'Arriendo oficina cowork', 'arriendo', 2800000, true, 'aaaaaaaa-f000-0000-0000-000000000007', '2025-02-01T12:00:00Z', '2025-02-01T00:00:00Z'),
  ('bcbcbcbc-0000-0000-0000-000000000008', '11111111-0000-0000-0000-000000000001', 'bbbbbbbb-0000-0000-0000-000000000002', '2025-02', 'Internet fibra óptica', 'software', 180000, true, 'aaaaaaaa-f000-0000-0000-000000000008', '2025-02-05T12:00:00Z', '2025-02-01T00:00:00Z'),
  ('bcbcbcbc-0000-0000-0000-000000000009', '11111111-0000-0000-0000-000000000001', 'bbbbbbbb-0000-0000-0000-000000000003', '2025-02', 'Adobe Creative Cloud', 'software', 350000, true, 'aaaaaaaa-f000-0000-0000-000000000009', '2025-02-15T12:00:00Z', '2025-02-01T00:00:00Z'),
  ('bcbcbcbc-0000-0000-0000-000000000010', '11111111-0000-0000-0000-000000000001', 'bbbbbbbb-0000-0000-0000-000000000004', '2025-02', 'Transporte mensual', 'transporte', 400000, true, 'aaaaaaaa-f000-0000-0000-000000000010', '2025-02-25T12:00:00Z', '2025-02-01T00:00:00Z'),
  ('bcbcbcbc-0000-0000-0000-000000000011', '11111111-0000-0000-0000-000000000001', 'bbbbbbbb-0000-0000-0000-000000000005', '2025-02', 'Contador honorarios', 'servicios_profesionales', 800000, true, 'aaaaaaaa-f000-0000-0000-000000000011', '2025-02-10T12:00:00Z', '2025-02-01T00:00:00Z'),
  ('bcbcbcbc-0000-0000-0000-000000000012', '11111111-0000-0000-0000-000000000001', 'bbbbbbbb-0000-0000-0000-000000000006', '2025-02', 'Pauta redes propias', 'marketing', 500000, true, 'aaaaaaaa-f000-0000-0000-000000000012', '2025-02-20T12:00:00Z', '2025-02-01T00:00:00Z'),
  -- 2025-03
  ('bcbcbcbc-0000-0000-0000-000000000013', '11111111-0000-0000-0000-000000000001', 'bbbbbbbb-0000-0000-0000-000000000001', '2025-03', 'Arriendo oficina cowork', 'arriendo', 2800000, true, 'aaaaaaaa-f000-0000-0000-000000000013', '2025-03-01T12:00:00Z', '2025-03-01T00:00:00Z'),
  ('bcbcbcbc-0000-0000-0000-000000000014', '11111111-0000-0000-0000-000000000001', 'bbbbbbbb-0000-0000-0000-000000000002', '2025-03', 'Internet fibra óptica', 'software', 180000, true, 'aaaaaaaa-f000-0000-0000-000000000014', '2025-03-05T12:00:00Z', '2025-03-01T00:00:00Z'),
  ('bcbcbcbc-0000-0000-0000-000000000015', '11111111-0000-0000-0000-000000000001', 'bbbbbbbb-0000-0000-0000-000000000003', '2025-03', 'Adobe Creative Cloud', 'software', 350000, true, 'aaaaaaaa-f000-0000-0000-000000000015', '2025-03-15T12:00:00Z', '2025-03-01T00:00:00Z'),
  ('bcbcbcbc-0000-0000-0000-000000000016', '11111111-0000-0000-0000-000000000001', 'bbbbbbbb-0000-0000-0000-000000000004', '2025-03', 'Transporte mensual', 'transporte', 400000, true, 'aaaaaaaa-f000-0000-0000-000000000016', '2025-03-25T12:00:00Z', '2025-03-01T00:00:00Z'),
  ('bcbcbcbc-0000-0000-0000-000000000017', '11111111-0000-0000-0000-000000000001', 'bbbbbbbb-0000-0000-0000-000000000005', '2025-03', 'Contador honorarios', 'servicios_profesionales', 800000, true, 'aaaaaaaa-f000-0000-0000-000000000017', '2025-03-10T12:00:00Z', '2025-03-01T00:00:00Z'),
  ('bcbcbcbc-0000-0000-0000-000000000018', '11111111-0000-0000-0000-000000000001', 'bbbbbbbb-0000-0000-0000-000000000006', '2025-03', 'Pauta redes propias', 'marketing', 500000, true, 'aaaaaaaa-f000-0000-0000-000000000018', '2025-03-20T12:00:00Z', '2025-03-01T00:00:00Z'),
  -- 2025-04
  ('bcbcbcbc-0000-0000-0000-000000000019', '11111111-0000-0000-0000-000000000001', 'bbbbbbbb-0000-0000-0000-000000000001', '2025-04', 'Arriendo oficina cowork', 'arriendo', 2800000, true, 'aaaaaaaa-f000-0000-0000-000000000019', '2025-04-01T12:00:00Z', '2025-04-01T00:00:00Z'),
  ('bcbcbcbc-0000-0000-0000-000000000020', '11111111-0000-0000-0000-000000000001', 'bbbbbbbb-0000-0000-0000-000000000002', '2025-04', 'Internet fibra óptica', 'software', 180000, true, 'aaaaaaaa-f000-0000-0000-000000000020', '2025-04-05T12:00:00Z', '2025-04-01T00:00:00Z'),
  ('bcbcbcbc-0000-0000-0000-000000000021', '11111111-0000-0000-0000-000000000001', 'bbbbbbbb-0000-0000-0000-000000000003', '2025-04', 'Adobe Creative Cloud', 'software', 350000, true, 'aaaaaaaa-f000-0000-0000-000000000021', '2025-04-15T12:00:00Z', '2025-04-01T00:00:00Z'),
  ('bcbcbcbc-0000-0000-0000-000000000022', '11111111-0000-0000-0000-000000000001', 'bbbbbbbb-0000-0000-0000-000000000004', '2025-04', 'Transporte mensual', 'transporte', 400000, true, 'aaaaaaaa-f000-0000-0000-000000000022', '2025-04-25T12:00:00Z', '2025-04-01T00:00:00Z'),
  ('bcbcbcbc-0000-0000-0000-000000000023', '11111111-0000-0000-0000-000000000001', 'bbbbbbbb-0000-0000-0000-000000000005', '2025-04', 'Contador honorarios', 'servicios_profesionales', 800000, true, 'aaaaaaaa-f000-0000-0000-000000000023', '2025-04-10T12:00:00Z', '2025-04-01T00:00:00Z'),
  ('bcbcbcbc-0000-0000-0000-000000000024', '11111111-0000-0000-0000-000000000001', 'bbbbbbbb-0000-0000-0000-000000000006', '2025-04', 'Pauta redes propias', 'marketing', 500000, true, 'aaaaaaaa-f000-0000-0000-000000000024', '2025-04-20T12:00:00Z', '2025-04-01T00:00:00Z'),
  -- 2025-05
  ('bcbcbcbc-0000-0000-0000-000000000025', '11111111-0000-0000-0000-000000000001', 'bbbbbbbb-0000-0000-0000-000000000001', '2025-05', 'Arriendo oficina cowork', 'arriendo', 2800000, true, 'aaaaaaaa-f000-0000-0000-000000000025', '2025-05-01T12:00:00Z', '2025-05-01T00:00:00Z'),
  ('bcbcbcbc-0000-0000-0000-000000000026', '11111111-0000-0000-0000-000000000001', 'bbbbbbbb-0000-0000-0000-000000000002', '2025-05', 'Internet fibra óptica', 'software', 180000, true, 'aaaaaaaa-f000-0000-0000-000000000026', '2025-05-05T12:00:00Z', '2025-05-01T00:00:00Z'),
  ('bcbcbcbc-0000-0000-0000-000000000027', '11111111-0000-0000-0000-000000000001', 'bbbbbbbb-0000-0000-0000-000000000003', '2025-05', 'Adobe Creative Cloud', 'software', 350000, true, 'aaaaaaaa-f000-0000-0000-000000000027', '2025-05-15T12:00:00Z', '2025-05-01T00:00:00Z'),
  ('bcbcbcbc-0000-0000-0000-000000000028', '11111111-0000-0000-0000-000000000001', 'bbbbbbbb-0000-0000-0000-000000000004', '2025-05', 'Transporte mensual', 'transporte', 400000, true, 'aaaaaaaa-f000-0000-0000-000000000028', '2025-05-25T12:00:00Z', '2025-05-01T00:00:00Z'),
  ('bcbcbcbc-0000-0000-0000-000000000029', '11111111-0000-0000-0000-000000000001', 'bbbbbbbb-0000-0000-0000-000000000005', '2025-05', 'Contador honorarios', 'servicios_profesionales', 800000, true, 'aaaaaaaa-f000-0000-0000-000000000029', '2025-05-10T12:00:00Z', '2025-05-01T00:00:00Z'),
  ('bcbcbcbc-0000-0000-0000-000000000030', '11111111-0000-0000-0000-000000000001', 'bbbbbbbb-0000-0000-0000-000000000006', '2025-05', 'Pauta redes propias', 'marketing', 500000, true, 'aaaaaaaa-f000-0000-0000-000000000030', '2025-05-20T12:00:00Z', '2025-05-01T00:00:00Z'),
  -- 2025-06
  ('bcbcbcbc-0000-0000-0000-000000000031', '11111111-0000-0000-0000-000000000001', 'bbbbbbbb-0000-0000-0000-000000000001', '2025-06', 'Arriendo oficina cowork', 'arriendo', 2800000, true, 'aaaaaaaa-f000-0000-0000-000000000031', '2025-06-01T12:00:00Z', '2025-06-01T00:00:00Z'),
  ('bcbcbcbc-0000-0000-0000-000000000032', '11111111-0000-0000-0000-000000000001', 'bbbbbbbb-0000-0000-0000-000000000002', '2025-06', 'Internet fibra óptica', 'software', 180000, true, 'aaaaaaaa-f000-0000-0000-000000000032', '2025-06-05T12:00:00Z', '2025-06-01T00:00:00Z'),
  ('bcbcbcbc-0000-0000-0000-000000000033', '11111111-0000-0000-0000-000000000001', 'bbbbbbbb-0000-0000-0000-000000000003', '2025-06', 'Adobe Creative Cloud', 'software', 350000, true, 'aaaaaaaa-f000-0000-0000-000000000033', '2025-06-15T12:00:00Z', '2025-06-01T00:00:00Z'),
  ('bcbcbcbc-0000-0000-0000-000000000034', '11111111-0000-0000-0000-000000000001', 'bbbbbbbb-0000-0000-0000-000000000004', '2025-06', 'Transporte mensual', 'transporte', 400000, true, 'aaaaaaaa-f000-0000-0000-000000000034', '2025-06-25T12:00:00Z', '2025-06-01T00:00:00Z'),
  ('bcbcbcbc-0000-0000-0000-000000000035', '11111111-0000-0000-0000-000000000001', 'bbbbbbbb-0000-0000-0000-000000000005', '2025-06', 'Contador honorarios', 'servicios_profesionales', 800000, true, 'aaaaaaaa-f000-0000-0000-000000000035', '2025-06-10T12:00:00Z', '2025-06-01T00:00:00Z'),
  ('bcbcbcbc-0000-0000-0000-000000000036', '11111111-0000-0000-0000-000000000001', 'bbbbbbbb-0000-0000-0000-000000000006', '2025-06', 'Pauta redes propias', 'marketing', 500000, true, 'aaaaaaaa-f000-0000-0000-000000000036', '2025-06-20T12:00:00Z', '2025-06-01T00:00:00Z'),
  -- 2025-07
  ('bcbcbcbc-0000-0000-0000-000000000037', '11111111-0000-0000-0000-000000000001', 'bbbbbbbb-0000-0000-0000-000000000001', '2025-07', 'Arriendo oficina cowork', 'arriendo', 2800000, true, 'aaaaaaaa-f000-0000-0000-000000000037', '2025-07-01T12:00:00Z', '2025-07-01T00:00:00Z'),
  ('bcbcbcbc-0000-0000-0000-000000000038', '11111111-0000-0000-0000-000000000001', 'bbbbbbbb-0000-0000-0000-000000000002', '2025-07', 'Internet fibra óptica', 'software', 180000, true, 'aaaaaaaa-f000-0000-0000-000000000038', '2025-07-05T12:00:00Z', '2025-07-01T00:00:00Z'),
  ('bcbcbcbc-0000-0000-0000-000000000039', '11111111-0000-0000-0000-000000000001', 'bbbbbbbb-0000-0000-0000-000000000003', '2025-07', 'Adobe Creative Cloud', 'software', 350000, true, 'aaaaaaaa-f000-0000-0000-000000000039', '2025-07-15T12:00:00Z', '2025-07-01T00:00:00Z'),
  ('bcbcbcbc-0000-0000-0000-000000000040', '11111111-0000-0000-0000-000000000001', 'bbbbbbbb-0000-0000-0000-000000000004', '2025-07', 'Transporte mensual', 'transporte', 400000, true, 'aaaaaaaa-f000-0000-0000-000000000040', '2025-07-25T12:00:00Z', '2025-07-01T00:00:00Z'),
  ('bcbcbcbc-0000-0000-0000-000000000041', '11111111-0000-0000-0000-000000000001', 'bbbbbbbb-0000-0000-0000-000000000005', '2025-07', 'Contador honorarios', 'servicios_profesionales', 800000, true, 'aaaaaaaa-f000-0000-0000-000000000041', '2025-07-10T12:00:00Z', '2025-07-01T00:00:00Z'),
  ('bcbcbcbc-0000-0000-0000-000000000042', '11111111-0000-0000-0000-000000000001', 'bbbbbbbb-0000-0000-0000-000000000006', '2025-07', 'Pauta redes propias', 'marketing', 500000, true, 'aaaaaaaa-f000-0000-0000-000000000042', '2025-07-20T12:00:00Z', '2025-07-01T00:00:00Z'),
  -- 2025-08
  ('bcbcbcbc-0000-0000-0000-000000000043', '11111111-0000-0000-0000-000000000001', 'bbbbbbbb-0000-0000-0000-000000000001', '2025-08', 'Arriendo oficina cowork', 'arriendo', 2800000, true, 'aaaaaaaa-f000-0000-0000-000000000043', '2025-08-01T12:00:00Z', '2025-08-01T00:00:00Z'),
  ('bcbcbcbc-0000-0000-0000-000000000044', '11111111-0000-0000-0000-000000000001', 'bbbbbbbb-0000-0000-0000-000000000002', '2025-08', 'Internet fibra óptica', 'software', 180000, true, 'aaaaaaaa-f000-0000-0000-000000000044', '2025-08-05T12:00:00Z', '2025-08-01T00:00:00Z'),
  ('bcbcbcbc-0000-0000-0000-000000000045', '11111111-0000-0000-0000-000000000001', 'bbbbbbbb-0000-0000-0000-000000000003', '2025-08', 'Adobe Creative Cloud', 'software', 350000, true, 'aaaaaaaa-f000-0000-0000-000000000045', '2025-08-15T12:00:00Z', '2025-08-01T00:00:00Z'),
  ('bcbcbcbc-0000-0000-0000-000000000046', '11111111-0000-0000-0000-000000000001', 'bbbbbbbb-0000-0000-0000-000000000004', '2025-08', 'Transporte mensual', 'transporte', 400000, true, 'aaaaaaaa-f000-0000-0000-000000000046', '2025-08-25T12:00:00Z', '2025-08-01T00:00:00Z'),
  ('bcbcbcbc-0000-0000-0000-000000000047', '11111111-0000-0000-0000-000000000001', 'bbbbbbbb-0000-0000-0000-000000000005', '2025-08', 'Contador honorarios', 'servicios_profesionales', 800000, true, 'aaaaaaaa-f000-0000-0000-000000000047', '2025-08-10T12:00:00Z', '2025-08-01T00:00:00Z'),
  ('bcbcbcbc-0000-0000-0000-000000000048', '11111111-0000-0000-0000-000000000001', 'bbbbbbbb-0000-0000-0000-000000000006', '2025-08', 'Pauta redes propias', 'marketing', 500000, true, 'aaaaaaaa-f000-0000-0000-000000000048', '2025-08-20T12:00:00Z', '2025-08-01T00:00:00Z'),
  -- 2025-09
  ('bcbcbcbc-0000-0000-0000-000000000049', '11111111-0000-0000-0000-000000000001', 'bbbbbbbb-0000-0000-0000-000000000001', '2025-09', 'Arriendo oficina cowork', 'arriendo', 2800000, true, 'aaaaaaaa-f000-0000-0000-000000000049', '2025-09-01T12:00:00Z', '2025-09-01T00:00:00Z'),
  ('bcbcbcbc-0000-0000-0000-000000000050', '11111111-0000-0000-0000-000000000001', 'bbbbbbbb-0000-0000-0000-000000000002', '2025-09', 'Internet fibra óptica', 'software', 180000, true, 'aaaaaaaa-f000-0000-0000-000000000050', '2025-09-05T12:00:00Z', '2025-09-01T00:00:00Z'),
  ('bcbcbcbc-0000-0000-0000-000000000051', '11111111-0000-0000-0000-000000000001', 'bbbbbbbb-0000-0000-0000-000000000003', '2025-09', 'Adobe Creative Cloud', 'software', 350000, true, 'aaaaaaaa-f000-0000-0000-000000000051', '2025-09-15T12:00:00Z', '2025-09-01T00:00:00Z'),
  ('bcbcbcbc-0000-0000-0000-000000000052', '11111111-0000-0000-0000-000000000001', 'bbbbbbbb-0000-0000-0000-000000000004', '2025-09', 'Transporte mensual', 'transporte', 400000, true, 'aaaaaaaa-f000-0000-0000-000000000052', '2025-09-25T12:00:00Z', '2025-09-01T00:00:00Z'),
  ('bcbcbcbc-0000-0000-0000-000000000053', '11111111-0000-0000-0000-000000000001', 'bbbbbbbb-0000-0000-0000-000000000005', '2025-09', 'Contador honorarios', 'servicios_profesionales', 800000, true, 'aaaaaaaa-f000-0000-0000-000000000053', '2025-09-10T12:00:00Z', '2025-09-01T00:00:00Z'),
  ('bcbcbcbc-0000-0000-0000-000000000054', '11111111-0000-0000-0000-000000000001', 'bbbbbbbb-0000-0000-0000-000000000006', '2025-09', 'Pauta redes propias', 'marketing', 500000, true, 'aaaaaaaa-f000-0000-0000-000000000054', '2025-09-20T12:00:00Z', '2025-09-01T00:00:00Z'),
  -- 2025-10
  ('bcbcbcbc-0000-0000-0000-000000000055', '11111111-0000-0000-0000-000000000001', 'bbbbbbbb-0000-0000-0000-000000000001', '2025-10', 'Arriendo oficina cowork', 'arriendo', 2800000, true, 'aaaaaaaa-f000-0000-0000-000000000055', '2025-10-01T12:00:00Z', '2025-10-01T00:00:00Z'),
  ('bcbcbcbc-0000-0000-0000-000000000056', '11111111-0000-0000-0000-000000000001', 'bbbbbbbb-0000-0000-0000-000000000002', '2025-10', 'Internet fibra óptica', 'software', 180000, true, 'aaaaaaaa-f000-0000-0000-000000000056', '2025-10-05T12:00:00Z', '2025-10-01T00:00:00Z'),
  ('bcbcbcbc-0000-0000-0000-000000000057', '11111111-0000-0000-0000-000000000001', 'bbbbbbbb-0000-0000-0000-000000000003', '2025-10', 'Adobe Creative Cloud', 'software', 350000, true, 'aaaaaaaa-f000-0000-0000-000000000057', '2025-10-15T12:00:00Z', '2025-10-01T00:00:00Z'),
  ('bcbcbcbc-0000-0000-0000-000000000058', '11111111-0000-0000-0000-000000000001', 'bbbbbbbb-0000-0000-0000-000000000004', '2025-10', 'Transporte mensual', 'transporte', 400000, true, 'aaaaaaaa-f000-0000-0000-000000000058', '2025-10-25T12:00:00Z', '2025-10-01T00:00:00Z'),
  ('bcbcbcbc-0000-0000-0000-000000000059', '11111111-0000-0000-0000-000000000001', 'bbbbbbbb-0000-0000-0000-000000000005', '2025-10', 'Contador honorarios', 'servicios_profesionales', 800000, true, 'aaaaaaaa-f000-0000-0000-000000000059', '2025-10-10T12:00:00Z', '2025-10-01T00:00:00Z'),
  ('bcbcbcbc-0000-0000-0000-000000000060', '11111111-0000-0000-0000-000000000001', 'bbbbbbbb-0000-0000-0000-000000000006', '2025-10', 'Pauta redes propias', 'marketing', 500000, true, 'aaaaaaaa-f000-0000-0000-000000000060', '2025-10-20T12:00:00Z', '2025-10-01T00:00:00Z'),
  -- 2025-11
  ('bcbcbcbc-0000-0000-0000-000000000061', '11111111-0000-0000-0000-000000000001', 'bbbbbbbb-0000-0000-0000-000000000001', '2025-11', 'Arriendo oficina cowork', 'arriendo', 2800000, true, 'aaaaaaaa-f000-0000-0000-000000000061', '2025-11-01T12:00:00Z', '2025-11-01T00:00:00Z'),
  ('bcbcbcbc-0000-0000-0000-000000000062', '11111111-0000-0000-0000-000000000001', 'bbbbbbbb-0000-0000-0000-000000000002', '2025-11', 'Internet fibra óptica', 'software', 180000, true, 'aaaaaaaa-f000-0000-0000-000000000062', '2025-11-05T12:00:00Z', '2025-11-01T00:00:00Z'),
  ('bcbcbcbc-0000-0000-0000-000000000063', '11111111-0000-0000-0000-000000000001', 'bbbbbbbb-0000-0000-0000-000000000003', '2025-11', 'Adobe Creative Cloud', 'software', 350000, true, 'aaaaaaaa-f000-0000-0000-000000000063', '2025-11-15T12:00:00Z', '2025-11-01T00:00:00Z'),
  ('bcbcbcbc-0000-0000-0000-000000000064', '11111111-0000-0000-0000-000000000001', 'bbbbbbbb-0000-0000-0000-000000000004', '2025-11', 'Transporte mensual', 'transporte', 400000, true, 'aaaaaaaa-f000-0000-0000-000000000064', '2025-11-25T12:00:00Z', '2025-11-01T00:00:00Z'),
  ('bcbcbcbc-0000-0000-0000-000000000065', '11111111-0000-0000-0000-000000000001', 'bbbbbbbb-0000-0000-0000-000000000005', '2025-11', 'Contador honorarios', 'servicios_profesionales', 800000, true, 'aaaaaaaa-f000-0000-0000-000000000065', '2025-11-10T12:00:00Z', '2025-11-01T00:00:00Z'),
  ('bcbcbcbc-0000-0000-0000-000000000066', '11111111-0000-0000-0000-000000000001', 'bbbbbbbb-0000-0000-0000-000000000006', '2025-11', 'Pauta redes propias', 'marketing', 500000, true, 'aaaaaaaa-f000-0000-0000-000000000066', '2025-11-20T12:00:00Z', '2025-11-01T00:00:00Z'),
  -- 2025-12
  ('bcbcbcbc-0000-0000-0000-000000000067', '11111111-0000-0000-0000-000000000001', 'bbbbbbbb-0000-0000-0000-000000000001', '2025-12', 'Arriendo oficina cowork', 'arriendo', 2800000, true, 'aaaaaaaa-f000-0000-0000-000000000067', '2025-12-01T12:00:00Z', '2025-12-01T00:00:00Z'),
  ('bcbcbcbc-0000-0000-0000-000000000068', '11111111-0000-0000-0000-000000000001', 'bbbbbbbb-0000-0000-0000-000000000002', '2025-12', 'Internet fibra óptica', 'software', 180000, true, 'aaaaaaaa-f000-0000-0000-000000000068', '2025-12-05T12:00:00Z', '2025-12-01T00:00:00Z'),
  ('bcbcbcbc-0000-0000-0000-000000000069', '11111111-0000-0000-0000-000000000001', 'bbbbbbbb-0000-0000-0000-000000000003', '2025-12', 'Adobe Creative Cloud', 'software', 350000, true, 'aaaaaaaa-f000-0000-0000-000000000069', '2025-12-15T12:00:00Z', '2025-12-01T00:00:00Z'),
  ('bcbcbcbc-0000-0000-0000-000000000070', '11111111-0000-0000-0000-000000000001', 'bbbbbbbb-0000-0000-0000-000000000004', '2025-12', 'Transporte mensual', 'transporte', 400000, true, 'aaaaaaaa-f000-0000-0000-000000000070', '2025-12-25T12:00:00Z', '2025-12-01T00:00:00Z'),
  ('bcbcbcbc-0000-0000-0000-000000000071', '11111111-0000-0000-0000-000000000001', 'bbbbbbbb-0000-0000-0000-000000000005', '2025-12', 'Contador honorarios', 'servicios_profesionales', 800000, true, 'aaaaaaaa-f000-0000-0000-000000000071', '2025-12-10T12:00:00Z', '2025-12-01T00:00:00Z'),
  ('bcbcbcbc-0000-0000-0000-000000000072', '11111111-0000-0000-0000-000000000001', 'bbbbbbbb-0000-0000-0000-000000000006', '2025-12', 'Pauta redes propias', 'marketing', 500000, true, 'aaaaaaaa-f000-0000-0000-000000000072', '2025-12-20T12:00:00Z', '2025-12-01T00:00:00Z'),
  -- 2026-01
  ('bcbcbcbc-0000-0000-0000-000000000073', '11111111-0000-0000-0000-000000000001', 'bbbbbbbb-0000-0000-0000-000000000001', '2026-01', 'Arriendo oficina cowork', 'arriendo', 2800000, true, 'aaaaaaaa-f000-0000-0000-000000000073', '2026-01-01T12:00:00Z', '2026-01-01T00:00:00Z'),
  ('bcbcbcbc-0000-0000-0000-000000000074', '11111111-0000-0000-0000-000000000001', 'bbbbbbbb-0000-0000-0000-000000000002', '2026-01', 'Internet fibra óptica', 'software', 180000, true, 'aaaaaaaa-f000-0000-0000-000000000074', '2026-01-05T12:00:00Z', '2026-01-01T00:00:00Z'),
  ('bcbcbcbc-0000-0000-0000-000000000075', '11111111-0000-0000-0000-000000000001', 'bbbbbbbb-0000-0000-0000-000000000003', '2026-01', 'Adobe Creative Cloud', 'software', 350000, true, 'aaaaaaaa-f000-0000-0000-000000000075', '2026-01-15T12:00:00Z', '2026-01-01T00:00:00Z'),
  ('bcbcbcbc-0000-0000-0000-000000000076', '11111111-0000-0000-0000-000000000001', 'bbbbbbbb-0000-0000-0000-000000000004', '2026-01', 'Transporte mensual', 'transporte', 400000, true, 'aaaaaaaa-f000-0000-0000-000000000076', '2026-01-25T12:00:00Z', '2026-01-01T00:00:00Z'),
  ('bcbcbcbc-0000-0000-0000-000000000077', '11111111-0000-0000-0000-000000000001', 'bbbbbbbb-0000-0000-0000-000000000005', '2026-01', 'Contador honorarios', 'servicios_profesionales', 800000, true, 'aaaaaaaa-f000-0000-0000-000000000077', '2026-01-10T12:00:00Z', '2026-01-01T00:00:00Z'),
  ('bcbcbcbc-0000-0000-0000-000000000078', '11111111-0000-0000-0000-000000000001', 'bbbbbbbb-0000-0000-0000-000000000006', '2026-01', 'Pauta redes propias', 'marketing', 500000, true, 'aaaaaaaa-f000-0000-0000-000000000078', '2026-01-20T12:00:00Z', '2026-01-01T00:00:00Z'),
  -- 2026-02
  ('bcbcbcbc-0000-0000-0000-000000000079', '11111111-0000-0000-0000-000000000001', 'bbbbbbbb-0000-0000-0000-000000000001', '2026-02', 'Arriendo oficina cowork', 'arriendo', 2800000, true, 'aaaaaaaa-f000-0000-0000-000000000079', '2026-02-01T12:00:00Z', '2026-02-01T00:00:00Z'),
  ('bcbcbcbc-0000-0000-0000-000000000080', '11111111-0000-0000-0000-000000000001', 'bbbbbbbb-0000-0000-0000-000000000002', '2026-02', 'Internet fibra óptica', 'software', 180000, true, 'aaaaaaaa-f000-0000-0000-000000000080', '2026-02-05T12:00:00Z', '2026-02-01T00:00:00Z'),
  ('bcbcbcbc-0000-0000-0000-000000000081', '11111111-0000-0000-0000-000000000001', 'bbbbbbbb-0000-0000-0000-000000000003', '2026-02', 'Adobe Creative Cloud', 'software', 350000, true, 'aaaaaaaa-f000-0000-0000-000000000081', '2026-02-15T12:00:00Z', '2026-02-01T00:00:00Z'),
  ('bcbcbcbc-0000-0000-0000-000000000082', '11111111-0000-0000-0000-000000000001', 'bbbbbbbb-0000-0000-0000-000000000004', '2026-02', 'Transporte mensual', 'transporte', 400000, false, NULL, NULL, '2026-02-01T00:00:00Z'),
  ('bcbcbcbc-0000-0000-0000-000000000083', '11111111-0000-0000-0000-000000000001', 'bbbbbbbb-0000-0000-0000-000000000005', '2026-02', 'Contador honorarios', 'servicios_profesionales', 800000, false, NULL, NULL, '2026-02-01T00:00:00Z'),
  ('bcbcbcbc-0000-0000-0000-000000000084', '11111111-0000-0000-0000-000000000001', 'bbbbbbbb-0000-0000-0000-000000000006', '2026-02', 'Pauta redes propias', 'marketing', 500000, false, NULL, NULL, '2026-02-01T00:00:00Z');

-- Link gastos fijos → borradores (gasto_fijo_ref_id)
-- Gastos 001-081 map 1:1 to borradores 001-078 + 079-081
UPDATE gastos g SET gasto_fijo_ref_id = b.id
FROM gastos_fijos_borradores b
WHERE b.gasto_id = g.id
  AND g.tipo = 'fijo';

-- ════════════════════════════════════════════════════════════
-- §31. FACTURAS (16 facturas across projects)
-- ════════════════════════════════════════════════════════════
INSERT INTO facturas (id, workspace_id, proyecto_id, numero_factura, monto, fecha_emision, notas, canal_registro, created_at) VALUES
  -- P1: TechNova Branding ($8M — cerrado, fully invoiced)
  ('88888888-0000-0000-0000-000000000001', '11111111-0000-0000-0000-000000000001', '77777777-0000-0000-0000-000000000001', 'FE-001', 4000000, '2025-01-27', 'Anticipo branding corporativo 50%', 'app', '2025-01-27T10:00:00Z'),
  ('88888888-0000-0000-0000-000000000002', '11111111-0000-0000-0000-000000000001', '77777777-0000-0000-0000-000000000001', 'FE-002', 4000000, '2025-03-10', 'Saldo final branding corporativo', 'app', '2025-03-10T10:00:00Z'),
  -- P2: Empaques Café Montañero ($5.5M — cerrado, fully invoiced)
  ('88888888-0000-0000-0000-000000000003', '11111111-0000-0000-0000-000000000001', '77777777-0000-0000-0000-000000000002', 'FE-003', 2200000, '2025-02-22', 'Anticipo diseño empaques 40%', 'app', '2025-02-22T10:00:00Z'),
  ('88888888-0000-0000-0000-000000000004', '11111111-0000-0000-0000-000000000001', '77777777-0000-0000-0000-000000000002', 'FE-004', 3300000, '2025-04-10', 'Saldo final empaques premium', 'app', '2025-04-10T10:00:00Z'),
  -- P3: Altiplano Branding+Web ($18M — cerrado, fully invoiced)
  ('88888888-0000-0000-0000-000000000005', '11111111-0000-0000-0000-000000000001', '77777777-0000-0000-0000-000000000003', 'FE-005', 7200000, '2025-05-12', 'Anticipo branding + landing 40%', 'app', '2025-05-12T10:00:00Z'),
  ('88888888-0000-0000-0000-000000000006', '11111111-0000-0000-0000-000000000001', '77777777-0000-0000-0000-000000000003', 'FE-006', 5400000, '2025-07-01', 'Avance 70% — entrega branding', 'app', '2025-07-01T10:00:00Z'),
  ('88888888-0000-0000-0000-000000000007', '11111111-0000-0000-0000-000000000001', '77777777-0000-0000-0000-000000000003', 'FE-007', 5400000, '2025-08-25', 'Saldo final — entrega landing', 'app', '2025-08-25T10:00:00Z'),
  -- P4: Hotel Rosario Fotos ($5M — cerrado, fully invoiced)
  ('88888888-0000-0000-0000-000000000008', '11111111-0000-0000-0000-000000000001', '77777777-0000-0000-0000-000000000004', 'FE-008', 2500000, '2025-06-05', 'Anticipo sesión fotográfica 50%', 'app', '2025-06-05T10:00:00Z'),
  ('88888888-0000-0000-0000-000000000009', '11111111-0000-0000-0000-000000000001', '77777777-0000-0000-0000-000000000004', 'FE-009', 2500000, '2025-07-12', 'Saldo final fotografía hotel', 'app', '2025-07-12T10:00:00Z'),
  -- P5: TechNova App UI/UX ($15M, 65% — en_ejecucion, $9M facturado)
  ('88888888-0000-0000-0000-000000000010', '11111111-0000-0000-0000-000000000001', '77777777-0000-0000-0000-000000000005', 'FE-010', 4500000, '2025-09-08', 'Anticipo rediseño UI/UX fase 1', 'app', '2025-09-08T10:00:00Z'),
  ('88888888-0000-0000-0000-000000000011', '11111111-0000-0000-0000-000000000001', '77777777-0000-0000-0000-000000000005', 'FE-011', 4500000, '2025-11-15', 'Avance fase 2 — wireframes aprobados', 'app', '2025-11-15T10:00:00Z'),
  -- P6: Redes Café Montañero ($21M, 55% — en_ejecucion, $14M facturado)
  ('88888888-0000-0000-0000-000000000012', '11111111-0000-0000-0000-000000000001', '77777777-0000-0000-0000-000000000006', 'FE-012', 3500000, '2025-11-01', 'Mes 1 — gestión redes noviembre', 'app', '2025-11-01T10:00:00Z'),
  ('88888888-0000-0000-0000-000000000013', '11111111-0000-0000-0000-000000000001', '77777777-0000-0000-0000-000000000006', 'FE-013', 3500000, '2025-12-01', 'Mes 2 — gestión redes diciembre', 'app', '2025-12-01T10:00:00Z'),
  ('88888888-0000-0000-0000-000000000014', '11111111-0000-0000-0000-000000000001', '77777777-0000-0000-0000-000000000006', 'FE-014', 3500000, '2026-01-01', 'Mes 3 — gestión redes enero', 'app', '2026-01-01T10:00:00Z'),
  ('88888888-0000-0000-0000-000000000015', '11111111-0000-0000-0000-000000000001', '77777777-0000-0000-0000-000000000006', 'FE-015', 3500000, '2026-02-01', 'Mes 4 — gestión redes febrero', 'app', '2026-02-01T10:00:00Z'),
  -- P7: Video Fundación Raíces ($12M, 30% — pausado, $4.8M anticipo)
  ('88888888-0000-0000-0000-000000000016', '11111111-0000-0000-0000-000000000001', '77777777-0000-0000-0000-000000000007', 'FE-016', 4800000, '2025-12-10', 'Anticipo video institucional 40%', 'app', '2025-12-10T10:00:00Z');

-- ════════════════════════════════════════════════════════════
-- §32. COBROS (16 pagos recibidos)
-- ════════════════════════════════════════════════════════════
INSERT INTO cobros (id, workspace_id, factura_id, proyecto_id, monto, fecha, notas, canal_registro, created_at) VALUES
  -- P1: TechNova Branding — fully paid
  ('99999999-0000-0000-0000-000000000001', '11111111-0000-0000-0000-000000000001', '88888888-0000-0000-0000-000000000001', '77777777-0000-0000-0000-000000000001', 4000000, '2025-02-05', 'Pago anticipo branding TechNova', 'app', '2025-02-05T10:00:00Z'),
  ('99999999-0000-0000-0000-000000000002', '11111111-0000-0000-0000-000000000001', '88888888-0000-0000-0000-000000000002', '77777777-0000-0000-0000-000000000001', 4000000, '2025-03-15', 'Pago saldo final branding TechNova', 'app', '2025-03-15T10:00:00Z'),
  -- P2: Empaques Café Montañero — fully paid
  ('99999999-0000-0000-0000-000000000003', '11111111-0000-0000-0000-000000000001', '88888888-0000-0000-0000-000000000003', '77777777-0000-0000-0000-000000000002', 2200000, '2025-03-01', 'Pago anticipo empaques Montañero', 'app', '2025-03-01T10:00:00Z'),
  ('99999999-0000-0000-0000-000000000004', '11111111-0000-0000-0000-000000000001', '88888888-0000-0000-0000-000000000004', '77777777-0000-0000-0000-000000000002', 3300000, '2025-04-15', 'Pago saldo final empaques', 'app', '2025-04-15T10:00:00Z'),
  -- P3: Altiplano — fully paid
  ('99999999-0000-0000-0000-000000000005', '11111111-0000-0000-0000-000000000001', '88888888-0000-0000-0000-000000000005', '77777777-0000-0000-0000-000000000003', 7200000, '2025-05-20', 'Pago anticipo Altiplano branding', 'app', '2025-05-20T10:00:00Z'),
  ('99999999-0000-0000-0000-000000000006', '11111111-0000-0000-0000-000000000001', '88888888-0000-0000-0000-000000000006', '77777777-0000-0000-0000-000000000003', 5400000, '2025-07-10', 'Pago avance 70% Altiplano', 'app', '2025-07-10T10:00:00Z'),
  ('99999999-0000-0000-0000-000000000007', '11111111-0000-0000-0000-000000000001', '88888888-0000-0000-0000-000000000007', '77777777-0000-0000-0000-000000000003', 5400000, '2025-09-01', 'Pago saldo final Altiplano landing', 'app', '2025-09-01T10:00:00Z'),
  -- P4: Hotel Rosario — fully paid
  ('99999999-0000-0000-0000-000000000008', '11111111-0000-0000-0000-000000000001', '88888888-0000-0000-0000-000000000008', '77777777-0000-0000-0000-000000000004', 2500000, '2025-06-10', 'Pago anticipo fotografía hotel', 'app', '2025-06-10T10:00:00Z'),
  ('99999999-0000-0000-0000-000000000009', '11111111-0000-0000-0000-000000000001', '88888888-0000-0000-0000-000000000009', '77777777-0000-0000-0000-000000000004', 2500000, '2025-07-18', 'Pago saldo final fotografía hotel', 'app', '2025-07-18T10:00:00Z'),
  -- P5: TechNova App — partial (both invoices paid)
  ('99999999-0000-0000-0000-000000000010', '11111111-0000-0000-0000-000000000001', '88888888-0000-0000-0000-000000000010', '77777777-0000-0000-0000-000000000005', 4500000, '2025-09-20', 'Pago anticipo UI/UX fase 1', 'app', '2025-09-20T10:00:00Z'),
  ('99999999-0000-0000-0000-000000000011', '11111111-0000-0000-0000-000000000001', '88888888-0000-0000-0000-000000000011', '77777777-0000-0000-0000-000000000005', 4500000, '2025-12-01', 'Pago avance fase 2 UI/UX', 'app', '2025-12-01T10:00:00Z'),
  -- P6: Redes Café Montañero — partial (FE-015 partially paid)
  ('99999999-0000-0000-0000-000000000012', '11111111-0000-0000-0000-000000000001', '88888888-0000-0000-0000-000000000012', '77777777-0000-0000-0000-000000000006', 3500000, '2025-11-10', 'Pago mes 1 redes noviembre', 'app', '2025-11-10T10:00:00Z'),
  ('99999999-0000-0000-0000-000000000013', '11111111-0000-0000-0000-000000000001', '88888888-0000-0000-0000-000000000013', '77777777-0000-0000-0000-000000000006', 3500000, '2025-12-10', 'Pago mes 2 redes diciembre', 'app', '2025-12-10T10:00:00Z'),
  ('99999999-0000-0000-0000-000000000014', '11111111-0000-0000-0000-000000000001', '88888888-0000-0000-0000-000000000014', '77777777-0000-0000-0000-000000000006', 3500000, '2026-01-10', 'Pago mes 3 redes enero', 'app', '2026-01-10T10:00:00Z'),
  ('99999999-0000-0000-0000-000000000015', '11111111-0000-0000-0000-000000000001', '88888888-0000-0000-0000-000000000015', '77777777-0000-0000-0000-000000000006', 2000000, '2026-02-15', 'Pago parcial mes 4 redes — pendiente $1.5M', 'app', '2026-02-15T10:00:00Z'),
  -- P7: Video Fundación Raíces — anticipo paid
  ('99999999-0000-0000-0000-000000000016', '11111111-0000-0000-0000-000000000001', '88888888-0000-0000-0000-000000000016', '77777777-0000-0000-0000-000000000007', 4800000, '2025-12-20', 'Pago anticipo video institucional', 'app', '2025-12-20T10:00:00Z');

-- ════════════════════════════════════════════════════════════
-- §35. CONFIG_METAS (14 months of sales/collection targets)
-- ════════════════════════════════════════════════════════════
INSERT INTO config_metas (id, workspace_id, mes, meta_ventas_mensual, meta_recaudo_mensual, created_at) VALUES
  ('cccccccc-0000-0000-0000-000000000001', '11111111-0000-0000-0000-000000000001', '2025-01-01', 10000000, 8000000, '2025-01-01T00:00:00Z'),
  ('cccccccc-0000-0000-0000-000000000002', '11111111-0000-0000-0000-000000000001', '2025-02-01', 10000000, 8000000, '2025-02-01T00:00:00Z'),
  ('cccccccc-0000-0000-0000-000000000003', '11111111-0000-0000-0000-000000000001', '2025-03-01', 11000000, 9000000, '2025-03-01T00:00:00Z'),
  ('cccccccc-0000-0000-0000-000000000004', '11111111-0000-0000-0000-000000000001', '2025-04-01', 12000000, 10000000, '2025-04-01T00:00:00Z'),
  ('cccccccc-0000-0000-0000-000000000005', '11111111-0000-0000-0000-000000000001', '2025-05-01', 13000000, 11000000, '2025-05-01T00:00:00Z'),
  ('cccccccc-0000-0000-0000-000000000006', '11111111-0000-0000-0000-000000000001', '2025-06-01', 15000000, 12000000, '2025-06-01T00:00:00Z'),
  ('cccccccc-0000-0000-0000-000000000007', '11111111-0000-0000-0000-000000000001', '2025-07-01', 14000000, 11000000, '2025-07-01T00:00:00Z'),
  ('cccccccc-0000-0000-0000-000000000008', '11111111-0000-0000-0000-000000000001', '2025-08-01', 14000000, 12000000, '2025-08-01T00:00:00Z'),
  ('cccccccc-0000-0000-0000-000000000009', '11111111-0000-0000-0000-000000000001', '2025-09-01', 16000000, 13000000, '2025-09-01T00:00:00Z'),
  ('cccccccc-0000-0000-0000-000000000010', '11111111-0000-0000-0000-000000000001', '2025-10-01', 18000000, 14000000, '2025-10-01T00:00:00Z'),
  ('cccccccc-0000-0000-0000-000000000011', '11111111-0000-0000-0000-000000000001', '2025-11-01', 20000000, 16000000, '2025-11-01T00:00:00Z'),
  ('cccccccc-0000-0000-0000-000000000012', '11111111-0000-0000-0000-000000000001', '2025-12-01', 18000000, 15000000, '2025-12-01T00:00:00Z'),
  ('cccccccc-0000-0000-0000-000000000013', '11111111-0000-0000-0000-000000000001', '2026-01-01', 20000000, 17000000, '2026-01-01T00:00:00Z'),
  ('cccccccc-0000-0000-0000-000000000014', '11111111-0000-0000-0000-000000000001', '2026-02-01', 22000000, 18000000, '2026-02-01T00:00:00Z');

-- ════════════════════════════════════════════════════════════
-- §36. SALDOS_BANCO (14 monthly bank balance snapshots)
-- ════════════════════════════════════════════════════════════
INSERT INTO saldos_banco (id, workspace_id, saldo_real, saldo_teorico, diferencia, fecha, registrado_via, nota, created_at) VALUES
  ('dddddddd-0000-0000-0000-000000000001', '11111111-0000-0000-0000-000000000001', 5200000, 5350000, -150000, '2025-01-31T18:00:00Z', 'app', 'Conciliación ene', '2025-01-31T18:00:00Z'),
  ('dddddddd-0000-0000-0000-000000000002', '11111111-0000-0000-0000-000000000001', 7800000, 7950000, -150000, '2025-02-28T18:00:00Z', 'app', 'Conciliación feb', '2025-02-28T18:00:00Z'),
  ('dddddddd-0000-0000-0000-000000000003', '11111111-0000-0000-0000-000000000001', 11500000, 11300000, 200000, '2025-03-31T18:00:00Z', 'app', 'Conciliación mar', '2025-03-31T18:00:00Z'),
  ('dddddddd-0000-0000-0000-000000000004', '11111111-0000-0000-0000-000000000001', 14200000, 14000000, 200000, '2025-04-30T18:00:00Z', 'app', 'Conciliación abr', '2025-04-30T18:00:00Z'),
  ('dddddddd-0000-0000-0000-000000000005', '11111111-0000-0000-0000-000000000001', 20100000, 20350000, -250000, '2025-05-31T18:00:00Z', 'whatsapp', 'Conciliación may', '2025-05-31T18:00:00Z'),
  ('dddddddd-0000-0000-0000-000000000006', '11111111-0000-0000-0000-000000000001', 22500000, 22300000, 200000, '2025-06-30T18:00:00Z', 'app', 'Conciliación jun', '2025-06-30T18:00:00Z'),
  ('dddddddd-0000-0000-0000-000000000007', '11111111-0000-0000-0000-000000000001', 27300000, 27100000, 200000, '2025-07-31T18:00:00Z', 'app', 'Conciliación jul', '2025-07-31T18:00:00Z'),
  ('dddddddd-0000-0000-0000-000000000008', '11111111-0000-0000-0000-000000000001', 26800000, 27000000, -200000, '2025-08-31T18:00:00Z', 'app', 'Conciliación ago', '2025-08-31T18:00:00Z'),
  ('dddddddd-0000-0000-0000-000000000009', '11111111-0000-0000-0000-000000000001', 30500000, 30200000, 300000, '2025-09-30T18:00:00Z', 'app', 'Conciliación sep', '2025-09-30T18:00:00Z'),
  ('dddddddd-0000-0000-0000-000000000010', '11111111-0000-0000-0000-000000000001', 29800000, 29950000, -150000, '2025-10-31T18:00:00Z', 'whatsapp', 'Conciliación oct', '2025-10-31T18:00:00Z'),
  ('dddddddd-0000-0000-0000-000000000011', '11111111-0000-0000-0000-000000000001', 35200000, 35000000, 200000, '2025-11-30T18:00:00Z', 'app', 'Conciliación nov', '2025-11-30T18:00:00Z'),
  ('dddddddd-0000-0000-0000-000000000012', '11111111-0000-0000-0000-000000000001', 42100000, 42350000, -250000, '2025-12-31T18:00:00Z', 'app', 'Conciliación dic', '2025-12-31T18:00:00Z'),
  ('dddddddd-0000-0000-0000-000000000013', '11111111-0000-0000-0000-000000000001', 44500000, 44300000, 200000, '2026-01-31T18:00:00Z', 'app', 'Conciliación ene', '2026-01-31T18:00:00Z'),
  ('dddddddd-0000-0000-0000-000000000014', '11111111-0000-0000-0000-000000000001', 43800000, 44100000, -300000, '2026-02-25T18:00:00Z', 'app', 'Parcial feb', '2026-02-25T18:00:00Z');

-- ════════════════════════════════════════════════════════════
-- §39. CONFIG_FINANCIERA
-- ════════════════════════════════════════════════════════════
INSERT INTO config_financiera (id, workspace_id, margen_contribucion_estimado, margen_contribucion_calculado, margen_fuente, n_proyectos_margen, created_at) VALUES
  ('cf000000-0000-0000-0000-000000000001', '11111111-0000-0000-0000-000000000001', 0.95, 0.62, 'calculado', 4, '2025-01-01T00:00:00Z');

-- ════════════════════════════════════════════════════════════
-- §40. COSTOS_REFERENCIA (3 service type averages)
-- ════════════════════════════════════════════════════════════
INSERT INTO costos_referencia (id, workspace_id, tipo_servicio, horas_promedio, costo_promedio, margen_promedio, proyectos_base, updated_at) VALUES
  ('c0000000-0000-0000-0000-000000000001', '11111111-0000-0000-0000-000000000001', 'Branding', 85.00, 3200000, 60.00, 2, '2026-02-25T00:00:00Z'),
  ('c0000000-0000-0000-0000-000000000002', '11111111-0000-0000-0000-000000000001', 'Diseño Web', 195.00, 7100000, 61.00, 1, '2026-02-25T00:00:00Z'),
  ('c0000000-0000-0000-0000-000000000003', '11111111-0000-0000-0000-000000000001', 'Fotografía', 38.00, 1850000, 63.00, 1, '2026-02-25T00:00:00Z');

-- ════════════════════════════════════════════════════════════
-- §41. STREAKS
-- ════════════════════════════════════════════════════════════
INSERT INTO streaks (id, workspace_id, tipo, semanas_actuales, semanas_record, ultima_actualizacion, streak_inicio, created_at) VALUES
  ('50000000-0000-0000-0000-000000000001', '11111111-0000-0000-0000-000000000001', 'conciliacion', 8, 12, '2026-02-23T18:00:00Z', '2025-12-29', '2025-12-29T00:00:00Z');

-- ════════════════════════════════════════════════════════════
-- §FINAL. Re-enable triggers and RLS
-- ════════════════════════════════════════════════════════════
SET session_replication_role = 'origin';
