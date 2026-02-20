-- ============================================================
-- Migration: CRM v2 Rebuild from Spec
-- Creates: contactos, empresas, oportunidades, cotizaciones,
--          items, rubros, servicios, proyectos (new), gastos (new), horas
-- Date: 2026-02-20
-- Note: Uses workspace_id (maps to tenant_id in spec)
-- ============================================================

-- 1. contactos
CREATE TABLE IF NOT EXISTS contactos (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id),
  nombre TEXT NOT NULL,
  telefono TEXT,
  email TEXT,
  fuente_adquisicion TEXT CHECK (fuente_adquisicion IN (
    'promotor','referido','alianza','red_social_organico',
    'pauta_digital','contacto_directo','evento','web_organico'
  )),
  fuente_detalle TEXT,
  fuente_promotor_id UUID REFERENCES contactos(id),
  fuente_referido_nombre TEXT,
  rol TEXT CHECK (rol IN ('promotor','decisor','influenciador','operativo')),
  comision_porcentaje NUMERIC(5,2) DEFAULT 10,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE contactos ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'contactos' AND policyname = 'contactos_ws') THEN
    CREATE POLICY "contactos_ws" ON contactos FOR ALL USING (workspace_id = current_user_workspace_id());
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS idx_contactos_ws ON contactos(workspace_id);

-- 2. empresas
CREATE TABLE IF NOT EXISTS empresas (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id),
  nombre TEXT NOT NULL,
  sector TEXT,
  nit TEXT,
  tipo_persona TEXT CHECK (tipo_persona IN ('natural','juridica')),
  regimen_tributario TEXT CHECK (regimen_tributario IN ('comun','simple','no_responsable')),
  gran_contribuyente BOOLEAN,
  agente_retenedor BOOLEAN,
  contacto_nombre TEXT,
  contacto_email TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE empresas ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'empresas' AND policyname = 'empresas_ws') THEN
    CREATE POLICY "empresas_ws" ON empresas FOR ALL USING (workspace_id = current_user_workspace_id());
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS idx_empresas_ws ON empresas(workspace_id);

-- 3. oportunidades (7 etapas del spec)
CREATE TABLE IF NOT EXISTS oportunidades (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id),
  contacto_id UUID NOT NULL REFERENCES contactos(id),
  empresa_id UUID NOT NULL REFERENCES empresas(id),
  descripcion TEXT NOT NULL,
  etapa TEXT NOT NULL DEFAULT 'lead_nuevo' CHECK (etapa IN (
    'lead_nuevo','contacto_inicial','discovery_hecha',
    'propuesta_enviada','negociacion','ganada','perdida'
  )),
  probabilidad INTEGER NOT NULL DEFAULT 10,
  valor_estimado NUMERIC(15,2),
  ultima_accion TEXT,
  ultima_accion_fecha TIMESTAMPTZ,
  fecha_cierre_estimada DATE,
  razon_perdida TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE oportunidades ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'oportunidades' AND policyname = 'oportunidades_ws') THEN
    CREATE POLICY "oportunidades_ws" ON oportunidades FOR ALL USING (workspace_id = current_user_workspace_id());
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS idx_oportunidades_ws ON oportunidades(workspace_id);
CREATE INDEX IF NOT EXISTS idx_oportunidades_contacto ON oportunidades(contacto_id);
CREATE INDEX IF NOT EXISTS idx_oportunidades_empresa ON oportunidades(empresa_id);

-- 4. cotizaciones
CREATE TABLE IF NOT EXISTS cotizaciones (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id),
  oportunidad_id UUID NOT NULL REFERENCES oportunidades(id),
  consecutivo TEXT NOT NULL,
  modo TEXT NOT NULL CHECK (modo IN ('flash','detallada')),
  descripcion TEXT,
  valor_total NUMERIC(15,2) NOT NULL DEFAULT 0,
  margen_porcentaje NUMERIC(5,2),
  costo_total NUMERIC(15,2),
  estado TEXT NOT NULL DEFAULT 'borrador' CHECK (estado IN (
    'borrador','enviada','aceptada','rechazada','vencida'
  )),
  fecha_envio TIMESTAMPTZ,
  fecha_validez DATE,
  duplicada_de UUID REFERENCES cotizaciones(id),
  notas TEXT,
  condiciones_pago TEXT,
  email_enviado_a TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE cotizaciones ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'cotizaciones' AND policyname = 'cotizaciones_ws') THEN
    CREATE POLICY "cotizaciones_ws" ON cotizaciones FOR ALL USING (workspace_id = current_user_workspace_id());
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS idx_cotizaciones_ws ON cotizaciones(workspace_id);
CREATE INDEX IF NOT EXISTS idx_cotizaciones_oportunidad ON cotizaciones(oportunidad_id);

-- Constraint: max 1 enviada por oportunidad (D48)
CREATE UNIQUE INDEX IF NOT EXISTS idx_una_enviada_por_oportunidad
ON cotizaciones (oportunidad_id) WHERE estado = 'enviada';

-- 5. items (line items de cotizacion)
CREATE TABLE IF NOT EXISTS items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  cotizacion_id UUID NOT NULL REFERENCES cotizaciones(id) ON DELETE CASCADE,
  nombre TEXT NOT NULL,
  subtotal NUMERIC(15,2) DEFAULT 0,
  orden INTEGER NOT NULL DEFAULT 0,
  servicio_origen_id UUID,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- items inherit RLS via cotizacion join, but add policy for safety
ALTER TABLE items ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'items' AND policyname = 'items_via_cotizacion') THEN
    CREATE POLICY "items_via_cotizacion" ON items FOR ALL USING (
      EXISTS (SELECT 1 FROM cotizaciones c WHERE c.id = cotizacion_id AND c.workspace_id = current_user_workspace_id())
    );
  END IF;
END $$;

-- 6. rubros (desglose de costos por item)
CREATE TABLE IF NOT EXISTS rubros (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  item_id UUID NOT NULL REFERENCES items(id) ON DELETE CASCADE,
  tipo TEXT NOT NULL CHECK (tipo IN (
    'mo_propia','mo_terceros','materiales','viaticos','software','servicios_prof'
  )),
  descripcion TEXT,
  cantidad NUMERIC(10,2) NOT NULL DEFAULT 1,
  unidad TEXT NOT NULL DEFAULT 'und',
  valor_unitario NUMERIC(15,2) NOT NULL DEFAULT 0,
  valor_total NUMERIC(15,2) GENERATED ALWAYS AS (cantidad * valor_unitario) STORED,
  orden INTEGER NOT NULL DEFAULT 0
);

ALTER TABLE rubros ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'rubros' AND policyname = 'rubros_via_item') THEN
    CREATE POLICY "rubros_via_item" ON rubros FOR ALL USING (
      EXISTS (
        SELECT 1 FROM items i
        JOIN cotizaciones c ON c.id = i.cotizacion_id
        WHERE i.id = item_id AND c.workspace_id = current_user_workspace_id()
      )
    );
  END IF;
END $$;

-- 7. servicios (catalogo de plantillas)
CREATE TABLE IF NOT EXISTS servicios (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id),
  nombre TEXT NOT NULL,
  precio_estandar NUMERIC(15,2),
  rubros_template JSONB DEFAULT '[]'::jsonb,
  activo BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE servicios ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'servicios' AND policyname = 'servicios_ws') THEN
    CREATE POLICY "servicios_ws" ON servicios FOR ALL USING (workspace_id = current_user_workspace_id());
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS idx_servicios_ws ON servicios(workspace_id);

-- 8. proyectos (nuevo modelo desde spec)
-- Note: tabla 'projects' ya existe, esta es la nueva 'proyectos'
CREATE TABLE IF NOT EXISTS proyectos (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id),
  oportunidad_id UUID REFERENCES oportunidades(id),
  cotizacion_id UUID REFERENCES cotizaciones(id),
  empresa_id UUID REFERENCES empresas(id),
  contacto_id UUID REFERENCES contactos(id),
  nombre TEXT NOT NULL,
  estado TEXT NOT NULL DEFAULT 'en_ejecucion' CHECK (estado IN (
    'en_ejecucion','pausado','cerrado'
  )),
  presupuesto_total NUMERIC(15,2) DEFAULT 0,
  avance_porcentaje INTEGER DEFAULT 0 CHECK (avance_porcentaje BETWEEN 0 AND 100),
  fecha_inicio DATE DEFAULT CURRENT_DATE,
  fecha_fin_estimada DATE,
  fecha_cierre DATE,
  notas_cierre TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE proyectos ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'proyectos' AND policyname = 'proyectos_ws') THEN
    CREATE POLICY "proyectos_ws" ON proyectos FOR ALL USING (workspace_id = current_user_workspace_id());
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS idx_proyectos_ws ON proyectos(workspace_id);

-- 9. gastos (nuevo modelo desde spec)
CREATE TABLE IF NOT EXISTS gastos (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id),
  fecha DATE NOT NULL DEFAULT CURRENT_DATE,
  monto NUMERIC(15,2) NOT NULL,
  categoria TEXT NOT NULL CHECK (categoria IN (
    'materiales','transporte','alimentacion','servicios_profesionales',
    'software','arriendo','marketing','capacitacion','otros'
  )),
  descripcion TEXT,
  proyecto_id UUID REFERENCES proyectos(id),
  empresa_id UUID REFERENCES empresas(id),
  soporte_url TEXT,
  deducible BOOLEAN DEFAULT true,
  canal_registro TEXT DEFAULT 'app' CHECK (canal_registro IN ('app','whatsapp')),
  created_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE gastos ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'gastos' AND policyname = 'gastos_ws') THEN
    CREATE POLICY "gastos_ws" ON gastos FOR ALL USING (workspace_id = current_user_workspace_id());
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS idx_gastos_ws ON gastos(workspace_id);
CREATE INDEX IF NOT EXISTS idx_gastos_proyecto ON gastos(proyecto_id);

-- 10. horas (registro de tiempo)
CREATE TABLE IF NOT EXISTS horas (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id),
  proyecto_id UUID NOT NULL REFERENCES proyectos(id),
  fecha DATE NOT NULL DEFAULT CURRENT_DATE,
  horas NUMERIC(5,2) NOT NULL,
  descripcion TEXT,
  canal_registro TEXT DEFAULT 'app' CHECK (canal_registro IN ('app','whatsapp')),
  created_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE horas ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'horas' AND policyname = 'horas_ws') THEN
    CREATE POLICY "horas_ws" ON horas FOR ALL USING (workspace_id = current_user_workspace_id());
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS idx_horas_ws ON horas(workspace_id);
CREATE INDEX IF NOT EXISTS idx_horas_proyecto ON horas(proyecto_id);

-- ============================================================
-- FUNCIONES Y TRIGGERS
-- ============================================================

-- Consecutivo cotizacion con reset anual (D51, D57)
CREATE OR REPLACE FUNCTION get_next_cotizacion_consecutivo(p_workspace_id UUID)
RETURNS TEXT AS $$
DECLARE
  v_year TEXT := EXTRACT(YEAR FROM CURRENT_DATE)::TEXT;
  v_next INTEGER;
BEGIN
  SELECT COALESCE(MAX(
    CAST(SPLIT_PART(consecutivo, '-', 3) AS INTEGER)
  ), 0) + 1
  INTO v_next
  FROM cotizaciones
  WHERE workspace_id = p_workspace_id
    AND consecutivo LIKE 'COT-' || v_year || '-%';

  RETURN 'COT-' || v_year || '-' || LPAD(v_next::TEXT, 4, '0');
END;
$$ LANGUAGE plpgsql;

-- Hard gate fiscal check (D5)
CREATE OR REPLACE FUNCTION check_perfil_fiscal_completo(p_empresa_id UUID)
RETURNS BOOLEAN AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1 FROM empresas
    WHERE id = p_empresa_id
      AND nit IS NOT NULL
      AND tipo_persona IS NOT NULL
      AND regimen_tributario IS NOT NULL
      AND gran_contribuyente IS NOT NULL
      AND agente_retenedor IS NOT NULL
  );
END;
$$ LANGUAGE plpgsql;

-- Trigger: auto-update probabilidad al cambiar etapa
CREATE OR REPLACE FUNCTION update_probabilidad()
RETURNS TRIGGER AS $$
BEGIN
  NEW.probabilidad := CASE NEW.etapa
    WHEN 'lead_nuevo' THEN 10
    WHEN 'contacto_inicial' THEN 20
    WHEN 'discovery_hecha' THEN 40
    WHEN 'propuesta_enviada' THEN 60
    WHEN 'negociacion' THEN 80
    WHEN 'ganada' THEN 100
    WHEN 'perdida' THEN 0
  END;
  NEW.updated_at := now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_oportunidad_etapa ON oportunidades;
CREATE TRIGGER trg_oportunidad_etapa
BEFORE UPDATE OF etapa ON oportunidades
FOR EACH ROW EXECUTE FUNCTION update_probabilidad();

-- Trigger: auto-update item subtotal cuando cambian rubros
CREATE OR REPLACE FUNCTION update_item_subtotal()
RETURNS TRIGGER AS $$
BEGIN
  UPDATE items SET subtotal = (
    SELECT COALESCE(SUM(cantidad * valor_unitario), 0)
    FROM rubros WHERE item_id = COALESCE(NEW.item_id, OLD.item_id)
  ) WHERE id = COALESCE(NEW.item_id, OLD.item_id);
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_rubro_change ON rubros;
CREATE TRIGGER trg_rubro_change
AFTER INSERT OR UPDATE OR DELETE ON rubros
FOR EACH ROW EXECUTE FUNCTION update_item_subtotal();
