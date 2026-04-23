-- AFI Fase B: auditoria de generacion + buckets Storage para templates y output

CREATE TABLE IF NOT EXISTS public.generaciones_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  negocio_id UUID NOT NULL REFERENCES public.negocios(id) ON DELETE CASCADE,
  ejecutada_at TIMESTAMPTZ DEFAULT NOW(),
  productos_contratados JSONB,
  rut_extraction JSONB,
  logo_storage_path TEXT,
  oficial_data JSONB,
  docs_generados JSONB,           -- [{codigo, filename, drive_file_id, drive_url, size}]
  drive_folder_url TEXT,
  status TEXT DEFAULT 'pending',  -- pending | success | partial | failed
  error_message TEXT,
  duration_ms INT,
  version_motor TEXT DEFAULT 'v1',
  version_templates TEXT DEFAULT 'v1'
);

CREATE INDEX IF NOT EXISTS idx_gen_log_negocio ON public.generaciones_log(negocio_id);
CREATE INDEX IF NOT EXISTS idx_gen_log_status  ON public.generaciones_log(status);

ALTER TABLE public.generaciones_log ENABLE ROW LEVEL SECURITY;
-- Acceso server-only via service role (patron admin).

-- Bucket templates (privado, solo service role)
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('afi-templates', 'afi-templates', false, 10485760,
  ARRAY['application/vnd.openxmlformats-officedocument.wordprocessingml.document'])
ON CONFLICT (id) DO NOTHING;

-- Bucket generated (privado, signed URLs para consulta)
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('afi-generated', 'afi-generated', false, 10485760,
  ARRAY['application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        'application/pdf', 'application/zip'])
ON CONFLICT (id) DO NOTHING;
