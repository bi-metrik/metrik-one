-- Create storage bucket for gastos soporte images (receipts)
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'gastos-soportes',
  'gastos-soportes',
  true,
  5242880, -- 5MB
  ARRAY['image/jpeg', 'image/png', 'image/webp']
)
ON CONFLICT (id) DO NOTHING;

-- Allow authenticated users to upload to their workspace folder
CREATE POLICY "Users can upload gastos soportes"
ON storage.objects FOR INSERT TO authenticated
WITH CHECK (
  bucket_id = 'gastos-soportes'
  AND (storage.foldername(name))[1] = (
    SELECT workspace_id::text FROM profiles WHERE id = auth.uid()
  )
);

-- Allow anyone to read soportes (public bucket)
CREATE POLICY "Anyone can read gastos soportes"
ON storage.objects FOR SELECT TO public
USING (bucket_id = 'gastos-soportes');

-- Allow authenticated users to update/delete their workspace soportes
CREATE POLICY "Users can update gastos soportes"
ON storage.objects FOR UPDATE TO authenticated
USING (
  bucket_id = 'gastos-soportes'
  AND (storage.foldername(name))[1] = (
    SELECT workspace_id::text FROM profiles WHERE id = auth.uid()
  )
);

CREATE POLICY "Users can delete gastos soportes"
ON storage.objects FOR DELETE TO authenticated
USING (
  bucket_id = 'gastos-soportes'
  AND (storage.foldername(name))[1] = (
    SELECT workspace_id::text FROM profiles WHERE id = auth.uid()
  )
);
