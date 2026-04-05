-- Módulos financieros del perfil de proyecto, configurables por workspace via Clarity
-- Valores: flujo_caja, costos_ejecutados, detalle_ejecucion, cotizacion_readonly
-- Por defecto todos false — MéTRIK los activa via /configure-clarity segun el proceso de cada cliente
ALTER TABLE workspaces ADD COLUMN IF NOT EXISTS proyecto_modules JSONB
  NOT NULL DEFAULT '{"flujo_caja":false,"costos_ejecutados":false,"detalle_ejecucion":false,"cotizacion_readonly":false}'::jsonb;
