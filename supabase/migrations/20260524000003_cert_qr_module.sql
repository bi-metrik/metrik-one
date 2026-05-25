-- Modulo "Certificaciones de producto con QR"
-- =============================================================================
-- Modulo reutilizable activable por workspace (flag modules.cert_qr).
-- Granularidad por LOTE de fabricacion: un QR por lote -> pagina publica de
-- certificacion (Res. 4272/2021 u otra norma). Primer adopter: workspace wmc-sm
-- (barandas telescopicas de seguridad de WMC Soluciones Metalicas).
--
-- Lectura publica (visitante anonimo que escanea el QR): NO via RLS. La pagina
-- publica usa service-role y filtra explicitamente estado='publicado' + el flag
-- del workspace. RLS de estas tablas solo cubre el panel autenticado.

-- =============================================================================
-- TABLA cert_productos — catalogo de SKU por workspace (specs estables)
-- =============================================================================
create table if not exists cert_productos (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  sku text not null,
  nombre text,
  serie text,
  producto_tipo text,
  rango_min_mm int,
  rango_max_mm int,
  altura_mm int,
  -- Norma de certificacion
  norma text not null default 'Resolución 4272/2021',
  carga_n numeric,
  carga_lb int,
  criterio text,
  factor_seguridad numeric,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, sku)
);

create index if not exists idx_cert_productos_workspace
  on cert_productos(workspace_id);

-- =============================================================================
-- TABLA cert_lotes — un QR por fila (id uuid = lo que codifica el QR)
-- =============================================================================
create table if not exists cert_lotes (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  cert_producto_id uuid references cert_productos(id) on delete set null,
  negocio_id uuid references negocios(id) on delete set null,
  numero_lote text not null,
  sku text not null,
  -- Opcion de material seleccionada en ese lote (Serie L: 'A'/'C'; Serie C: null)
  opcion_material text check (opcion_material is null or opcion_material in ('A', 'C')),
  material_perfil text,
  material_calibre text,
  material_norma text default 'ASTM A500 Gr.C / A36',
  -- Solo se puebla si la opcion exige orientacion (opcion A rectangular)
  orientacion_instalacion text,
  -- Resultado estructural certificado
  cumple boolean not null default true,
  ratio_critico numeric,
  ratio_descripcion text,
  -- Ciclo de vida: el publico SOLO ve 'publicado'
  estado text not null default 'borrador' check (estado in ('borrador', 'publicado', 'revocado')),
  certificado_por text default 'MéTRIK',
  certificado_para text,
  fecha_certificacion date,
  -- Caducidad: la certificacion vence (default 1 año). Pasado el vencimiento,
  -- WMC vende la recertificacion y MéTRIK la certifica (ingreso recurrente).
  vigencia_meses int not null default 12,
  fecha_vencimiento date generated always as (
    (fecha_certificacion + make_interval(months => vigencia_meses))::date
  ) stored,
  created_at timestamptz not null default now(),
  created_by uuid references profiles(id) on delete set null,
  updated_at timestamptz not null default now(),
  unique (workspace_id, numero_lote)
);

create index if not exists idx_cert_lotes_workspace_estado
  on cert_lotes(workspace_id, estado, created_at desc);

create index if not exists idx_cert_lotes_workspace_sku
  on cert_lotes(workspace_id, sku);

create index if not exists idx_cert_lotes_negocio
  on cert_lotes(workspace_id, negocio_id)
  where negocio_id is not null;

-- Para que el panel liste lotes proximos a vencer / vencidos (gancho de recertificacion)
create index if not exists idx_cert_lotes_vencimiento
  on cert_lotes(workspace_id, fecha_vencimiento)
  where estado = 'publicado';

-- =============================================================================
-- TABLA cert_documentos — PDFs descargables por lote
-- =============================================================================
create table if not exists cert_documentos (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  cert_lote_id uuid not null references cert_lotes(id) on delete cascade,
  tipo text not null check (tipo in ('memoria_calculo', 'ficha_tecnica', 'databook', 'anexo_tecnico', 'otro')),
  nombre text,
  storage_path text not null,
  public_url text,
  mime_type text default 'application/pdf',
  created_at timestamptz not null default now()
);

create index if not exists idx_cert_documentos_lote
  on cert_documentos(cert_lote_id);

-- =============================================================================
-- TABLA cert_recertificaciones — historial de (re)certificaciones por lote
-- =============================================================================
-- Cada evento de certificacion/recertificacion de un lote. Es el rastro del
-- ingreso recurrente: WMC vende la recertificacion, MéTRIK la emite. La fila
-- vigente de cert_lotes refleja la ultima; aqui queda la trazabilidad completa.
create table if not exists cert_recertificaciones (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  cert_lote_id uuid not null references cert_lotes(id) on delete cascade,
  fecha_certificacion date not null,
  fecha_vencimiento date not null,
  ratio_critico numeric,
  certificado_por text default 'MéTRIK',
  notas text,
  created_at timestamptz not null default now(),
  created_by uuid references profiles(id) on delete set null
);

create index if not exists idx_cert_recert_lote
  on cert_recertificaciones(cert_lote_id, fecha_certificacion desc);

-- =============================================================================
-- RLS — solo panel autenticado. El publico lee via service-role.
-- =============================================================================
alter table cert_productos enable row level security;
alter table cert_lotes enable row level security;
alter table cert_documentos enable row level security;
alter table cert_recertificaciones enable row level security;

-- cert_productos
drop policy if exists cert_productos_select on cert_productos;
create policy cert_productos_select on cert_productos
  for select using (workspace_id = current_user_workspace_id());
drop policy if exists cert_productos_insert on cert_productos;
create policy cert_productos_insert on cert_productos
  for insert with check (workspace_id = current_user_workspace_id());
drop policy if exists cert_productos_update on cert_productos;
create policy cert_productos_update on cert_productos
  for update using (workspace_id = current_user_workspace_id());
drop policy if exists cert_productos_delete on cert_productos;
create policy cert_productos_delete on cert_productos
  for delete using (workspace_id = current_user_workspace_id());

-- cert_lotes
drop policy if exists cert_lotes_select on cert_lotes;
create policy cert_lotes_select on cert_lotes
  for select using (workspace_id = current_user_workspace_id());
drop policy if exists cert_lotes_insert on cert_lotes;
create policy cert_lotes_insert on cert_lotes
  for insert with check (workspace_id = current_user_workspace_id());
drop policy if exists cert_lotes_update on cert_lotes;
create policy cert_lotes_update on cert_lotes
  for update using (workspace_id = current_user_workspace_id());
drop policy if exists cert_lotes_delete on cert_lotes;
create policy cert_lotes_delete on cert_lotes
  for delete using (workspace_id = current_user_workspace_id());

-- cert_documentos (RLS via su propio workspace_id, denormalizado)
drop policy if exists cert_documentos_select on cert_documentos;
create policy cert_documentos_select on cert_documentos
  for select using (workspace_id = current_user_workspace_id());
drop policy if exists cert_documentos_insert on cert_documentos;
create policy cert_documentos_insert on cert_documentos
  for insert with check (workspace_id = current_user_workspace_id());
drop policy if exists cert_documentos_delete on cert_documentos;
create policy cert_documentos_delete on cert_documentos
  for delete using (workspace_id = current_user_workspace_id());

-- cert_recertificaciones
drop policy if exists cert_recert_select on cert_recertificaciones;
create policy cert_recert_select on cert_recertificaciones
  for select using (workspace_id = current_user_workspace_id());
drop policy if exists cert_recert_insert on cert_recertificaciones;
create policy cert_recert_insert on cert_recertificaciones
  for insert with check (workspace_id = current_user_workspace_id());

-- =============================================================================
-- STORAGE — bucket publico para los PDFs (carpeta raiz = workspace_id)
-- =============================================================================
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'cert-documentos',
  'cert-documentos',
  true,
  20971520, -- 20MB (databooks pueden ser pesados)
  array['application/pdf']
)
on conflict (id) do nothing;

drop policy if exists "Users can upload cert documentos" on storage.objects;
create policy "Users can upload cert documentos"
on storage.objects for insert to authenticated
with check (
  bucket_id = 'cert-documentos'
  and (storage.foldername(name))[1] = (
    select workspace_id::text from profiles where id = auth.uid()
  )
);

drop policy if exists "Anyone can read cert documentos" on storage.objects;
create policy "Anyone can read cert documentos"
on storage.objects for select to public
using (bucket_id = 'cert-documentos');

drop policy if exists "Users can delete cert documentos" on storage.objects;
create policy "Users can delete cert documentos"
on storage.objects for delete to authenticated
using (
  bucket_id = 'cert-documentos'
  and (storage.foldername(name))[1] = (
    select workspace_id::text from profiles where id = auth.uid()
  )
);

-- =============================================================================
-- ACTIVAR MODULO cert_qr EN WORKSPACE wmc-sm
-- =============================================================================
-- Sin credenciales asociadas (a diferencia de valida), asi que activar el flag
-- en la migracion es seguro e idempotente.
update workspaces
set modules = coalesce(modules, '{}'::jsonb) || jsonb_build_object('cert_qr', true)
where slug = 'wmc-sm';

comment on table cert_lotes is
  'Certificacion por lote de fabricacion. El id (uuid) es lo que codifica el QR fisico en el producto. La pagina publica /cert/[id] lee via service-role solo filas estado=publicado. Reutilizable por cualquier workspace con modules.cert_qr=true.';
