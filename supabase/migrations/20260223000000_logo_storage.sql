-- Create storage bucket for workspace logos
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'workspace-logos',
  'workspace-logos',
  true,
  2097152, -- 2MB
  ARRAY['image/png', 'image/svg+xml', 'image/jpeg', 'image/webp']
)
ON CONFLICT (id) DO NOTHING;

-- Allow authenticated users to upload to their workspace folder
CREATE POLICY "Users can upload workspace logos"
ON storage.objects FOR INSERT TO authenticated
WITH CHECK (
  bucket_id = 'workspace-logos'
  AND (storage.foldername(name))[1] = (
    SELECT workspace_id::text FROM profiles WHERE id = auth.uid()
  )
);

-- Allow anyone to read logos (public bucket)
CREATE POLICY "Anyone can read workspace logos"
ON storage.objects FOR SELECT TO public
USING (bucket_id = 'workspace-logos');

-- Allow authenticated users to update/delete their workspace logos
CREATE POLICY "Users can update workspace logos"
ON storage.objects FOR UPDATE TO authenticated
USING (
  bucket_id = 'workspace-logos'
  AND (storage.foldername(name))[1] = (
    SELECT workspace_id::text FROM profiles WHERE id = auth.uid()
  )
);

CREATE POLICY "Users can delete workspace logos"
ON storage.objects FOR DELETE TO authenticated
USING (
  bucket_id = 'workspace-logos'
  AND (storage.foldername(name))[1] = (
    SELECT workspace_id::text FROM profiles WHERE id = auth.uid()
  )
);
