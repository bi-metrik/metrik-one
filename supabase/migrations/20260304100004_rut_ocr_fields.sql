-- ============================================================
-- Migration: RUT OCR fields + storage bucket
-- Spec: [98B] §2.2, D69-D77, D89
-- Date: 2026-03-04
-- ============================================================

-- ── Identidad (extraida del RUT) ────────────────────────────
ALTER TABLE empresas ADD COLUMN IF NOT EXISTS razon_social TEXT;
ALTER TABLE empresas ADD COLUMN IF NOT EXISTS direccion_fiscal TEXT;
ALTER TABLE empresas ADD COLUMN IF NOT EXISTS municipio TEXT;
ALTER TABLE empresas ADD COLUMN IF NOT EXISTS departamento TEXT;
ALTER TABLE empresas ADD COLUMN IF NOT EXISTS telefono TEXT;
ALTER TABLE empresas ADD COLUMN IF NOT EXISTS email_fiscal TEXT;

-- ── Fiscal expandido (extraido del RUT) ─────────────────────
ALTER TABLE empresas ADD COLUMN IF NOT EXISTS responsable_iva BOOLEAN;
ALTER TABLE empresas ADD COLUMN IF NOT EXISTS actividad_ciiu TEXT;
ALTER TABLE empresas ADD COLUMN IF NOT EXISTS actividad_secundaria TEXT;
ALTER TABLE empresas ADD COLUMN IF NOT EXISTS fecha_inicio_actividades DATE;

-- ── Metadata RUT OCR ────────────────────────────────────────
ALTER TABLE empresas ADD COLUMN IF NOT EXISTS rut_documento_url TEXT;
ALTER TABLE empresas ADD COLUMN IF NOT EXISTS rut_fecha_carga TIMESTAMPTZ;
ALTER TABLE empresas ADD COLUMN IF NOT EXISTS rut_confianza_ocr REAL CHECK (rut_confianza_ocr >= 0 AND rut_confianza_ocr <= 1);
ALTER TABLE empresas ADD COLUMN IF NOT EXISTS rut_verificado BOOLEAN DEFAULT false;

-- ── Comments ────────────────────────────────────────────────
COMMENT ON COLUMN empresas.razon_social IS 'Razon social extraida del RUT (casilla 5)';
COMMENT ON COLUMN empresas.direccion_fiscal IS 'Direccion fiscal del RUT (casilla 38-42)';
COMMENT ON COLUMN empresas.municipio IS 'Municipio fiscal del RUT (casilla 44)';
COMMENT ON COLUMN empresas.departamento IS 'Departamento fiscal del RUT';
COMMENT ON COLUMN empresas.telefono IS 'Telefono fiscal del RUT (casilla 46)';
COMMENT ON COLUMN empresas.email_fiscal IS 'Email fiscal del RUT (casilla 48)';
COMMENT ON COLUMN empresas.responsable_iva IS 'Es responsable de IVA segun RUT (casilla 53)';
COMMENT ON COLUMN empresas.actividad_ciiu IS 'Actividad economica CIIU principal del RUT (casilla 46)';
COMMENT ON COLUMN empresas.actividad_secundaria IS 'Actividad economica CIIU secundaria del RUT';
COMMENT ON COLUMN empresas.fecha_inicio_actividades IS 'Fecha inicio actividades del RUT (casilla 25)';
COMMENT ON COLUMN empresas.rut_documento_url IS 'URL del documento RUT en Storage';
COMMENT ON COLUMN empresas.rut_fecha_carga IS 'Timestamp de la ultima carga de RUT';
COMMENT ON COLUMN empresas.rut_confianza_ocr IS 'Confianza general del OCR (0-1), promedio de campos extraidos';
COMMENT ON COLUMN empresas.rut_verificado IS 'Si el usuario confirmo los datos del RUT (D76)';

-- ── Storage bucket: rut-documents (privado) ─────────────────
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'rut-documents',
  'rut-documents',
  false,
  10485760, -- 10MB
  ARRAY['application/pdf', 'image/jpeg', 'image/png', 'image/webp']
)
ON CONFLICT (id) DO NOTHING;

-- RLS: workspace members can manage their own RUT files
-- Pattern: gastos_soportes_storage.sql — uses profiles.workspace_id
CREATE POLICY "workspace_rut_upload"
  ON storage.objects FOR INSERT
  TO authenticated
  WITH CHECK (
    bucket_id = 'rut-documents'
    AND (storage.foldername(name))[1] = (
      SELECT workspace_id::text FROM profiles WHERE id = auth.uid()
    )
  );

CREATE POLICY "workspace_rut_select"
  ON storage.objects FOR SELECT
  TO authenticated
  USING (
    bucket_id = 'rut-documents'
    AND (storage.foldername(name))[1] = (
      SELECT workspace_id::text FROM profiles WHERE id = auth.uid()
    )
  );

CREATE POLICY "workspace_rut_update"
  ON storage.objects FOR UPDATE
  TO authenticated
  USING (
    bucket_id = 'rut-documents'
    AND (storage.foldername(name))[1] = (
      SELECT workspace_id::text FROM profiles WHERE id = auth.uid()
    )
  );

CREATE POLICY "workspace_rut_delete"
  ON storage.objects FOR DELETE
  TO authenticated
  USING (
    bucket_id = 'rut-documents'
    AND (storage.foldername(name))[1] = (
      SELECT workspace_id::text FROM profiles WHERE id = auth.uid()
    )
  );
