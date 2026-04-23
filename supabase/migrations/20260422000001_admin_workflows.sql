-- Admin Workflows: biblioteca consolidada de flujos de procesos (Clarity + internos).
-- Solo accesible desde el workspace metrik (ADMIN_WORKSPACE_ID).
-- Publica el skill /workflow via endpoint POST /api/admin/workflows/sync con Bearer secret.

-- ─── Tabla ──────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.admin_workflows (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  cliente_slug        TEXT NOT NULL,
  cliente_nombre      TEXT,
  proyecto_slug       TEXT NOT NULL,
  nombre_flujo        TEXT NOT NULL,
  version             INT  NOT NULL DEFAULT 1,
  linea_negocio       TEXT NOT NULL,                  -- '20' | '21' | '22' | '23' | 'interno'
  tipo_proceso        TEXT,                           -- implementacion-documental | ventas-consultivas | ...
  fase_cubierta       TEXT[],                         -- [venta, ejecucion, cobro, postventa]
  fase_detallada      TEXT,
  estado              TEXT DEFAULT 'en_construccion', -- en_construccion | listo_revision | vigente | archivado
  tags                TEXT[] DEFAULT ARRAY[]::TEXT[],
  autor_proceso       TEXT,
  autor_tecnico       TEXT,
  owner_calidad       TEXT,
  basado_en           TEXT,
  total_fases         INT,
  total_etapas        INT,
  total_bloques       INT,
  tiene_condicionales BOOLEAN DEFAULT FALSE,
  html_storage_path   TEXT NOT NULL,
  pdf_storage_path    TEXT,
  metadata            JSONB DEFAULT '{}'::JSONB,      -- frontmatter completo + extras
  fecha_actualizacion DATE,
  created_at          TIMESTAMPTZ DEFAULT NOW(),
  updated_at          TIMESTAMPTZ DEFAULT NOW(),
  CONSTRAINT admin_workflows_unique UNIQUE (cliente_slug, proyecto_slug, linea_negocio, nombre_flujo, version)
);

CREATE INDEX IF NOT EXISTS idx_admin_workflows_cliente    ON public.admin_workflows(cliente_slug);
CREATE INDEX IF NOT EXISTS idx_admin_workflows_linea      ON public.admin_workflows(linea_negocio);
CREATE INDEX IF NOT EXISTS idx_admin_workflows_estado     ON public.admin_workflows(estado);
CREATE INDEX IF NOT EXISTS idx_admin_workflows_tags_gin   ON public.admin_workflows USING GIN(tags);

COMMENT ON TABLE  public.admin_workflows IS 'Biblioteca de workflows publicados por el skill /workflow. Visible solo desde workspace metrik.';
COMMENT ON COLUMN public.admin_workflows.linea_negocio IS '[20] Clarity | [21] ONE | [22] Analytics | [23] Projects | interno';
COMMENT ON COLUMN public.admin_workflows.metadata IS 'Frontmatter HTML parseado + extras del sync';

-- Trigger updated_at
CREATE OR REPLACE FUNCTION public.admin_workflows_set_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_admin_workflows_updated_at ON public.admin_workflows;
CREATE TRIGGER trg_admin_workflows_updated_at
  BEFORE UPDATE ON public.admin_workflows
  FOR EACH ROW EXECUTE FUNCTION public.admin_workflows_set_updated_at();

-- ─── RLS ─────────────────────────────────────────────────────────────────────
-- Por defecto nadie puede leer/escribir desde el cliente. Todo acceso va por
-- server actions con service role (patron admin existente — mibolsillo).
ALTER TABLE public.admin_workflows ENABLE ROW LEVEL SECURITY;

-- Policy deny-by-default: no policies = nadie puede hacer nada desde cliente.
-- Server usa service role que bypass RLS.

-- ─── Storage bucket ──────────────────────────────────────────────────────────
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'workflows',
  'workflows',
  false,                                        -- privado, signed URLs
  10485760,                                     -- 10MB cap (HTML + PDF pesados)
  ARRAY['text/html', 'application/pdf']
)
ON CONFLICT (id) DO NOTHING;

-- No policies sobre storage.objects del bucket workflows — solo service role accede.
-- Signed URLs generadas desde server actions con service role.
