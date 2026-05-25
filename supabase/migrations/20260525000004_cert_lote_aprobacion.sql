-- Flujo de aprobacion: WMC crea borrador -> envia a aprobacion -> ingeniero publica.
alter table cert_lotes drop constraint if exists cert_lotes_estado_check;
alter table cert_lotes add constraint cert_lotes_estado_check
  check (estado in ('borrador', 'pendiente_aprobacion', 'publicado', 'revocado'));

alter table cert_lotes add column if not exists publicado_por uuid references profiles(id) on delete set null;
alter table cert_lotes add column if not exists publicado_at timestamptz;
alter table cert_lotes add column if not exists enviado_aprobacion_at timestamptz;
