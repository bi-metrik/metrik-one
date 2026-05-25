-- Databook por producto (bucket privado; descarga con contrasena = numero de contrato)
alter table cert_productos add column if not exists databook_path text;
alter table cert_productos add column if not exists databook_nombre text;

-- Lote: ubicacion (obra, visible) + numero de contrato (contrasena del databook)
alter table cert_lotes add column if not exists ubicacion text;
alter table cert_lotes add column if not exists numero_contrato text;

-- Bucket PRIVADO para databooks. Lectura solo via signed URL (service role).
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('cert-databooks', 'cert-databooks', false, 52428800, array['application/pdf'])
on conflict (id) do nothing;

drop policy if exists "Users upload cert databooks" on storage.objects;
create policy "Users upload cert databooks" on storage.objects for insert to authenticated
with check (bucket_id = 'cert-databooks' and (storage.foldername(name))[1] = (select workspace_id::text from profiles where id = auth.uid()));

drop policy if exists "Users delete cert databooks" on storage.objects;
create policy "Users delete cert databooks" on storage.objects for delete to authenticated
using (bucket_id = 'cert-databooks' and (storage.foldername(name))[1] = (select workspace_id::text from profiles where id = auth.uid()));
