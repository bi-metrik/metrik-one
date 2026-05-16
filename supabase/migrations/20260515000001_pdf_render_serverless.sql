-- ============================================================
-- 20260515000001_pdf_render_serverless
-- ============================================================
-- Spec: docs/specs/2026-05-15_pdf-render-weasyprint-serverless.md
--
-- Agrega campos en cotizaciones para parametrizar templates HTML
-- renderizados por el servicio metrik-pdf-render (WeasyPrint).
-- Agrega cotizacion_template_slug por workspace para escoger template.
-- Seedea WMC con template 'wmc'.
-- ============================================================

-- Campos faltantes en cotizaciones para parametrizar templates

ALTER TABLE cotizaciones
  ADD COLUMN IF NOT EXISTS lugar_entrega TEXT,
  ADD COLUMN IF NOT EXISTS tiempo_entrega TEXT,
  ADD COLUMN IF NOT EXISTS anticipo_pct NUMERIC(5,2),
  ADD COLUMN IF NOT EXISTS anticipo_terminos TEXT,
  ADD COLUMN IF NOT EXISTS saldo_terminos TEXT,
  ADD COLUMN IF NOT EXISTS observaciones_extra JSONB DEFAULT '[]'::jsonb NOT NULL;

COMMENT ON COLUMN cotizaciones.lugar_entrega IS 'Texto libre — ej: "OBRAS EN SANTA MARTA Y CUNDINAMARCA"';
COMMENT ON COLUMN cotizaciones.tiempo_entrega IS 'Texto libre — ej: "POR DEFINIR CON LA ORDEN DE COMPRA"';
COMMENT ON COLUMN cotizaciones.anticipo_pct IS 'Porcentaje de anticipo sobre el subtotal antes de IVA (ej: 35.00)';
COMMENT ON COLUMN cotizaciones.anticipo_terminos IS 'Texto descriptivo del anticipo — ej: "CONTRA ORDEN DE COMPRA"';
COMMENT ON COLUMN cotizaciones.saldo_terminos IS 'Texto descriptivo del saldo — ej: "EN EL CORTE DE OBRA POSTERIOR A LA ENTREGA"';
COMMENT ON COLUMN cotizaciones.observaciones_extra IS 'Lista JSONB de observaciones adicionales como strings HTML (renderizadas como <li>)';

-- Template slug por workspace (default 'metrik', WMC tiene 'wmc')

ALTER TABLE workspaces
  ADD COLUMN IF NOT EXISTS cotizacion_template_slug TEXT NOT NULL DEFAULT 'metrik';

COMMENT ON COLUMN workspaces.cotizacion_template_slug IS 'Slug del template HTML usado por metrik-pdf-render. Debe existir en metrik-pdf-render/templates/{slug}/cotizacion.html';

-- Seed para workspace WMC

UPDATE workspaces SET cotizacion_template_slug = 'wmc' WHERE slug = 'wmc-sm';
