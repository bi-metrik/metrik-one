-- ============================================================
-- Migration: Módulo Proyectos v2 — Spec 98C
-- ALTER tablas existentes + CREATE tablas nuevas + Vistas SQL
-- Date: 2026-02-21
-- ============================================================

-- ═══════════════════════════════════════════════════════════
-- §2. MODIFICACIONES A TABLAS EXISTENTES
-- ═══════════════════════════════════════════════════════════

-- §2.1 Agregar carpeta_url a oportunidades (D90)
ALTER TABLE oportunidades ADD COLUMN IF NOT EXISTS carpeta_url TEXT;

-- §2.2 Agregar campos a proyectos (§3.1 spec)
ALTER TABLE proyectos ADD COLUMN IF NOT EXISTS ganancia_estimada NUMERIC(15,2);
ALTER TABLE proyectos ADD COLUMN IF NOT EXISTS retenciones_estimadas NUMERIC(15,2);
ALTER TABLE proyectos ADD COLUMN IF NOT EXISTS horas_estimadas NUMERIC(10,2);
ALTER TABLE proyectos ADD COLUMN IF NOT EXISTS carpeta_url TEXT;
ALTER TABLE proyectos ADD COLUMN IF NOT EXISTS lecciones_aprendidas TEXT;
ALTER TABLE proyectos ADD COLUMN IF NOT EXISTS cierre_snapshot JSONB;
ALTER TABLE proyectos ADD COLUMN IF NOT EXISTS canal_creacion TEXT DEFAULT 'app';

-- §2.3 Agregar campos a gastos (D72, D78, D84)
ALTER TABLE gastos ADD COLUMN IF NOT EXISTS rubro_id UUID;
ALTER TABLE gastos ADD COLUMN IF NOT EXISTS gasto_fijo_ref_id UUID;
ALTER TABLE gastos ADD COLUMN IF NOT EXISTS external_ref TEXT;

-- §2.4 Agregar campos a staff para cálculo costo/hora
ALTER TABLE staff ADD COLUMN IF NOT EXISTS horas_disponibles_mes NUMERIC(5,1) DEFAULT 160;
ALTER TABLE staff ADD COLUMN IF NOT EXISTS es_principal BOOLEAN DEFAULT false;

-- ═══════════════════════════════════════════════════════════
-- §3. TABLAS NUEVAS (en orden FK)
-- ═══════════════════════════════════════════════════════════

-- §3.2 proyecto_rubros: líneas presupuestarias por proyecto
CREATE TABLE IF NOT EXISTS proyecto_rubros (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  proyecto_id UUID NOT NULL REFERENCES proyectos(id) ON DELETE CASCADE,
  nombre TEXT NOT NULL,
  presupuestado NUMERIC(15,2) NOT NULL,
  tipo TEXT DEFAULT 'general' CHECK (tipo IN (
    'horas', 'materiales', 'transporte', 'subcontratacion',
    'servicios_profesionales', 'general'
  )),
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_proyecto_rubros_proyecto ON proyecto_rubros(proyecto_id);

-- RLS via proyecto padre
ALTER TABLE proyecto_rubros ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'proyecto_rubros' AND policyname = 'proyecto_rubros_via_proyecto') THEN
    CREATE POLICY "proyecto_rubros_via_proyecto" ON proyecto_rubros FOR ALL USING (
      EXISTS (SELECT 1 FROM proyectos p WHERE p.id = proyecto_id AND p.workspace_id = current_user_workspace_id())
    );
  END IF;
END $$;

-- FK gastos → proyecto_rubros
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.table_constraints WHERE constraint_name = 'fk_gastos_rubro' AND table_name = 'gastos') THEN
    ALTER TABLE gastos ADD CONSTRAINT fk_gastos_rubro FOREIGN KEY (rubro_id) REFERENCES proyecto_rubros(id);
  END IF;
END $$;

-- §3.3 facturas: facturación fraccionada por proyecto
CREATE TABLE IF NOT EXISTS facturas (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id),
  proyecto_id UUID NOT NULL REFERENCES proyectos(id),
  numero_factura TEXT,
  monto NUMERIC(15,2) NOT NULL CHECK (monto > 0),
  fecha_emision DATE NOT NULL DEFAULT CURRENT_DATE,
  notas TEXT,
  external_ref TEXT,
  canal_registro TEXT DEFAULT 'app' CHECK (canal_registro IN ('app', 'whatsapp')),
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE facturas ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'facturas' AND policyname = 'facturas_ws') THEN
    CREATE POLICY "facturas_ws" ON facturas FOR ALL USING (workspace_id = current_user_workspace_id());
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS idx_facturas_proyecto ON facturas(proyecto_id);
CREATE INDEX IF NOT EXISTS idx_facturas_ws ON facturas(workspace_id);

-- §3.4 cobros: pagos por factura
CREATE TABLE IF NOT EXISTS cobros (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id),
  factura_id UUID NOT NULL REFERENCES facturas(id),
  proyecto_id UUID NOT NULL REFERENCES proyectos(id),
  monto NUMERIC(15,2) NOT NULL CHECK (monto > 0),
  fecha DATE NOT NULL DEFAULT CURRENT_DATE,
  notas TEXT,
  external_ref TEXT,
  canal_registro TEXT DEFAULT 'app' CHECK (canal_registro IN ('app', 'whatsapp')),
  created_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE cobros ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'cobros' AND policyname = 'cobros_ws') THEN
    CREATE POLICY "cobros_ws" ON cobros FOR ALL USING (workspace_id = current_user_workspace_id());
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS idx_cobros_factura ON cobros(factura_id);
CREATE INDEX IF NOT EXISTS idx_cobros_proyecto ON cobros(proyecto_id);

-- §3.6 gastos_fijos_config: gastos fijos recurrentes
CREATE TABLE IF NOT EXISTS gastos_fijos_config (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id),
  nombre TEXT NOT NULL,
  categoria TEXT NOT NULL CHECK (categoria IN (
    'materiales', 'transporte', 'alimentacion', 'servicios_profesionales',
    'software', 'arriendo', 'marketing', 'capacitacion', 'otros'
  )),
  monto_referencia NUMERIC(15,2) NOT NULL CHECK (monto_referencia > 0),
  activo BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE gastos_fijos_config ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'gastos_fijos_config' AND policyname = 'gastos_fijos_config_ws') THEN
    CREATE POLICY "gastos_fijos_config_ws" ON gastos_fijos_config FOR ALL USING (workspace_id = current_user_workspace_id());
  END IF;
END $$;

-- §3.7 gastos_fijos_borradores: borradores mensuales pre-generados
CREATE TABLE IF NOT EXISTS gastos_fijos_borradores (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id),
  gasto_fijo_config_id UUID NOT NULL REFERENCES gastos_fijos_config(id),
  periodo TEXT NOT NULL,
  nombre TEXT NOT NULL,
  categoria TEXT NOT NULL,
  monto_esperado NUMERIC(15,2) NOT NULL,
  confirmado BOOLEAN DEFAULT false,
  gasto_id UUID REFERENCES gastos(id),
  fecha_confirmacion TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(gasto_fijo_config_id, periodo)
);

ALTER TABLE gastos_fijos_borradores ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'gastos_fijos_borradores' AND policyname = 'gastos_fijos_borradores_ws') THEN
    CREATE POLICY "gastos_fijos_borradores_ws" ON gastos_fijos_borradores FOR ALL USING (workspace_id = current_user_workspace_id());
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS idx_borradores_pendientes ON gastos_fijos_borradores(workspace_id, periodo, confirmado)
  WHERE confirmado = false;

-- FK gastos → borradores
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.table_constraints WHERE constraint_name = 'fk_gastos_borrador' AND table_name = 'gastos') THEN
    ALTER TABLE gastos ADD CONSTRAINT fk_gastos_borrador FOREIGN KEY (gasto_fijo_ref_id) REFERENCES gastos_fijos_borradores(id);
  END IF;
END $$;

-- §3.8 costos_referencia: promedios históricos
CREATE TABLE IF NOT EXISTS costos_referencia (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id),
  tipo_servicio TEXT,
  horas_promedio NUMERIC(10,2),
  costo_promedio NUMERIC(15,2),
  margen_promedio NUMERIC(5,2),
  proyectos_base INTEGER DEFAULT 0,
  updated_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(workspace_id, tipo_servicio)
);

ALTER TABLE costos_referencia ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'costos_referencia' AND policyname = 'costos_referencia_ws') THEN
    CREATE POLICY "costos_referencia_ws" ON costos_referencia FOR ALL USING (workspace_id = current_user_workspace_id());
  END IF;
END $$;

-- §3.9 proyecto_notas: notas de proyecto
CREATE TABLE IF NOT EXISTS proyecto_notas (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id),
  proyecto_id UUID NOT NULL REFERENCES proyectos(id),
  contenido TEXT NOT NULL,
  canal_registro TEXT DEFAULT 'app' CHECK (canal_registro IN ('app', 'whatsapp')),
  created_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE proyecto_notas ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'proyecto_notas' AND policyname = 'proyecto_notas_ws') THEN
    CREATE POLICY "proyecto_notas_ws" ON proyecto_notas FOR ALL USING (workspace_id = current_user_workspace_id());
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS idx_proyecto_notas_proyecto ON proyecto_notas(proyecto_id);

-- ═══════════════════════════════════════════════════════════
-- §4. VISTAS SQL
-- ═══════════════════════════════════════════════════════════

-- §4.1 Resumen financiero por proyecto (D76)
CREATE OR REPLACE VIEW v_proyecto_financiero AS
SELECT
  p.id AS proyecto_id,
  p.workspace_id,
  p.nombre,
  p.estado,
  p.presupuesto_total,
  p.horas_estimadas,
  p.avance_porcentaje,
  p.ganancia_estimada,
  p.retenciones_estimadas,
  p.carpeta_url,
  p.fecha_inicio,
  p.fecha_fin_estimada,
  p.fecha_cierre,
  p.oportunidad_id,
  p.cotizacion_id,
  p.canal_creacion,
  p.created_at,
  p.updated_at,

  -- Empresa y contacto
  e.nombre AS empresa_nombre,
  ct.nombre AS contacto_nombre,

  -- Horas reales
  COALESCE(h.total_horas, 0) AS horas_reales,

  -- Costo por horas (horas × costo_hora del personal principal)
  COALESCE(h.total_horas, 0) * COALESCE(per.costo_hora_calc, 0) AS costo_horas,

  -- Gastos directos
  COALESCE(g.total_gastos, 0) AS gastos_directos,

  -- Costo acumulado total
  (COALESCE(h.total_horas, 0) * COALESCE(per.costo_hora_calc, 0)) + COALESCE(g.total_gastos, 0) AS costo_acumulado,

  -- Presupuesto consumido %
  CASE WHEN p.presupuesto_total > 0 THEN
    ROUND((((COALESCE(h.total_horas, 0) * COALESCE(per.costo_hora_calc, 0)) + COALESCE(g.total_gastos, 0)) / p.presupuesto_total) * 100, 1)
  ELSE 0 END AS presupuesto_consumido_pct,

  -- Facturado
  COALESCE(f.total_facturado, 0) AS facturado,
  COALESCE(f.num_facturas, 0)::INTEGER AS num_facturas,

  -- Cobrado
  COALESCE(c.total_cobrado, 0) AS cobrado,

  -- Cartera = facturado - cobrado
  COALESCE(f.total_facturado, 0) - COALESCE(c.total_cobrado, 0) AS cartera,

  -- Por facturar = presupuesto - facturado
  p.presupuesto_total - COALESCE(f.total_facturado, 0) AS por_facturar,

  -- Ganancia real en tiempo real
  COALESCE(c.total_cobrado, 0)
    - ((COALESCE(h.total_horas, 0) * COALESCE(per.costo_hora_calc, 0)) + COALESCE(g.total_gastos, 0))
    AS ganancia_real

FROM proyectos p

LEFT JOIN empresas e ON e.id = p.empresa_id
LEFT JOIN contactos ct ON ct.id = p.contacto_id

-- Personal principal para costo_hora (MVP: 1 persona por workspace)
LEFT JOIN LATERAL (
  SELECT (s.salary / NULLIF(s.horas_disponibles_mes, 0)) AS costo_hora_calc
  FROM staff s
  WHERE s.workspace_id = p.workspace_id AND s.es_principal = true AND s.is_active = true
  LIMIT 1
) per ON true

-- Total horas
LEFT JOIN LATERAL (
  SELECT SUM(hr.horas) AS total_horas
  FROM horas hr
  WHERE hr.proyecto_id = p.id
) h ON true

-- Total gastos directos
LEFT JOIN LATERAL (
  SELECT SUM(gs.monto) AS total_gastos
  FROM gastos gs
  WHERE gs.proyecto_id = p.id
) g ON true

-- Total facturado
LEFT JOIN LATERAL (
  SELECT SUM(fa.monto) AS total_facturado, COUNT(*) AS num_facturas
  FROM facturas fa
  WHERE fa.proyecto_id = p.id
) f ON true

-- Total cobrado
LEFT JOIN LATERAL (
  SELECT SUM(co.monto) AS total_cobrado
  FROM cobros co
  WHERE co.proyecto_id = p.id
) c ON true;

-- §4.2 Presupuesto vs Real por rubro (D79)
CREATE OR REPLACE VIEW v_proyecto_rubros_comparativo AS
SELECT
  pr.id AS rubro_id,
  pr.proyecto_id,
  pr.nombre AS rubro_nombre,
  pr.tipo AS rubro_tipo,
  pr.presupuestado,
  COALESCE(SUM(g.monto), 0) AS gastado_real,
  pr.presupuestado - COALESCE(SUM(g.monto), 0) AS diferencia,
  CASE WHEN pr.presupuestado > 0 THEN
    ROUND((COALESCE(SUM(g.monto), 0) / pr.presupuestado) * 100, 1)
  ELSE 0 END AS consumido_pct
FROM proyecto_rubros pr
LEFT JOIN gastos g ON g.rubro_id = pr.id
GROUP BY pr.id, pr.proyecto_id, pr.nombre, pr.tipo, pr.presupuestado;

-- §4.3 Estado de cada factura con saldo (D75)
CREATE OR REPLACE VIEW v_facturas_estado AS
SELECT
  f.id AS factura_id,
  f.workspace_id,
  f.proyecto_id,
  f.numero_factura,
  f.monto,
  f.fecha_emision,
  f.notas,
  COALESCE(SUM(c.monto), 0) AS cobrado,
  f.monto - COALESCE(SUM(c.monto), 0) AS saldo_pendiente,
  CASE
    WHEN f.monto - COALESCE(SUM(c.monto), 0) <= 0 THEN 'pagada'
    WHEN COALESCE(SUM(c.monto), 0) > 0 THEN 'parcial'
    ELSE 'pendiente'
  END AS estado_pago,
  CURRENT_DATE - f.fecha_emision AS dias_antiguedad,
  f.created_at
FROM facturas f
LEFT JOIN cobros c ON c.factura_id = f.id
GROUP BY f.id, f.workspace_id, f.proyecto_id, f.numero_factura, f.monto, f.fecha_emision, f.notas, f.created_at;

-- §4.4 Cartera por antigüedad
CREATE OR REPLACE VIEW v_cartera_antiguedad AS
SELECT
  sub.workspace_id,
  SUM(CASE WHEN sub.dias <= 30 THEN sub.saldo ELSE 0 END) AS rango_0_30,
  SUM(CASE WHEN sub.dias > 30 AND sub.dias <= 60 THEN sub.saldo ELSE 0 END) AS rango_31_60,
  SUM(CASE WHEN sub.dias > 60 AND sub.dias <= 90 THEN sub.saldo ELSE 0 END) AS rango_61_90,
  SUM(CASE WHEN sub.dias > 90 THEN sub.saldo ELSE 0 END) AS rango_90_plus,
  SUM(sub.saldo) AS total_cartera
FROM (
  SELECT
    f.workspace_id,
    f.monto - COALESCE(SUM(c.monto), 0) AS saldo,
    CURRENT_DATE - f.fecha_emision AS dias
  FROM facturas f
  LEFT JOIN cobros c ON c.factura_id = f.id
  GROUP BY f.id, f.workspace_id, f.monto, f.fecha_emision
  HAVING f.monto - COALESCE(SUM(c.monto), 0) > 0
) sub
GROUP BY sub.workspace_id;

-- §4.5 Gastos fijos borradores del mes actual
CREATE OR REPLACE VIEW v_gastos_fijos_mes_actual AS
SELECT
  b.id AS borrador_id,
  b.workspace_id,
  b.nombre,
  b.categoria,
  b.monto_esperado,
  b.confirmado,
  b.fecha_confirmacion,
  g.monto AS monto_real,
  g.fecha AS fecha_pago_real
FROM gastos_fijos_borradores b
LEFT JOIN gastos g ON g.id = b.gasto_id
WHERE b.periodo = TO_CHAR(NOW(), 'YYYY-MM');
