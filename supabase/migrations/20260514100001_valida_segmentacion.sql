-- Valida — Segmentación SARLAFT del cliente
-- Spec autorizada por Lucia (Compliance LA/FT). Ver cerebro/reglas/valida-alcance-normativo.md
-- y futura cerebro/reglas/segmentacion-sarlaft-metodologia-cliente.md
--
-- Arquitectura:
-- 1. Cada workspace tiene UNA configuración activa de segmentación.
-- 2. La metodología se compone de pesos (suman 1.0) + umbrales de clasificación.
-- 3. Dos universos: contrapartes (proveedores/clientes) y empleados.
-- 4. Cada cambio se versiona en bitácora con timestamp + usuario + razón.
-- 5. Tres diccionarios globales (países, CIIU, municipios) mantenidos por MeTRIK.
-- 6. Cada negocio tiene un score calculado en función de la configuración + consultas Valida.
--
-- Riesgo regulatorio: la metodología SARLAFT es indelegable del sujeto obligado
-- (Circular Básica Jurídica SFC C.E. 006/25, Circular 100-000016/2020 Supersociedades,
-- Resolución 2328/2025 Supertransporte). Por eso requiere checkbox de confirmación
-- explícito (disclaimer_aceptado) antes de activar.

-- =============================================================================
-- 1. Configuración activa por workspace
-- =============================================================================

create table if not exists valida_segmentacion_config (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  preset text not null check (preset in ('sector_real_general', 'concesion_vial_transporte', 'notariado_registro', 'personalizado')),

  pesos_contrapartes jsonb not null default '{}'::jsonb,
  pesos_empleados jsonb not null default '{}'::jsonb,

  umbrales_contrapartes jsonb not null default '{}'::jsonb,
  umbrales_empleados jsonb not null default '{}'::jsonb,

  disclaimer_aceptado boolean not null default false,
  version int not null default 1,

  aplicada_at timestamptz,
  aplicada_por uuid references profiles(id),

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  unique (workspace_id)
);

create index if not exists idx_valida_segmentacion_workspace
  on valida_segmentacion_config(workspace_id);

comment on table valida_segmentacion_config is
  'Configuración activa de segmentación SARLAFT por workspace. Una fila por workspace.';
comment on column valida_segmentacion_config.preset is
  'Preset sectorial usado como base. Personalizado = pesos ajustados libremente.';
comment on column valida_segmentacion_config.pesos_contrapartes is
  'JSONB con pesos 0-1 que suman 1.0. Keys: pais, ciiu, calidad_verificado, forma_operacion, pep_listas';
comment on column valida_segmentacion_config.pesos_empleados is
  'JSONB con pesos 0-1 que suman 1.0. Keys: ubicacion, tipo_contrato, criticidad_cargo, pep_listas, endeudamiento';
comment on column valida_segmentacion_config.umbrales_contrapartes is
  'JSONB con umbrales y frecuencias. Keys: alto_min, medio_min, frec_alto_meses, frec_medio_meses, frec_bajo_meses';
comment on column valida_segmentacion_config.disclaimer_aceptado is
  'true cuando el oficial de cumplimiento confirma que la metodología refleja la realidad de su organización';

-- RLS
alter table valida_segmentacion_config enable row level security;

create policy valida_segmentacion_config_select on valida_segmentacion_config
  for select using (workspace_id = current_user_workspace_id());
create policy valida_segmentacion_config_modify on valida_segmentacion_config
  for all using (workspace_id = current_user_workspace_id())
  with check (workspace_id = current_user_workspace_id());

-- =============================================================================
-- 2. Bitácora de cambios
-- =============================================================================

create table if not exists valida_segmentacion_bitacora (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  version int not null,
  preset text not null,
  pesos_contrapartes jsonb not null,
  pesos_empleados jsonb not null,
  umbrales_contrapartes jsonb not null,
  umbrales_empleados jsonb not null,
  aplicada_at timestamptz not null default now(),
  aplicada_por uuid references profiles(id),
  razon_cambio text
);

create index if not exists idx_valida_segmentacion_bitacora_workspace
  on valida_segmentacion_bitacora(workspace_id, aplicada_at desc);

alter table valida_segmentacion_bitacora enable row level security;

create policy valida_segmentacion_bitacora_select on valida_segmentacion_bitacora
  for select using (workspace_id = current_user_workspace_id());
create policy valida_segmentacion_bitacora_insert on valida_segmentacion_bitacora
  for insert with check (workspace_id = current_user_workspace_id());

-- =============================================================================
-- 3. Diccionarios globales (mantenidos por MeTRIK)
-- =============================================================================

-- Países
create table if not exists valida_dict_paises (
  codigo_iso text primary key,
  nombre text not null,
  score int not null check (score in (1, 2, 3)),
  motivo text,
  actualizado_at timestamptz not null default now()
);
comment on table valida_dict_paises is
  'Score de riesgo por país (1-3). Fuentes: GAFI, OFAC, DIAN Decreto 1357/2024.';

-- CIIU
create table if not exists valida_dict_ciiu (
  codigo text primary key,
  descripcion text not null,
  score int not null check (score in (1, 2, 3)),
  actualizado_at timestamptz not null default now()
);
comment on table valida_dict_ciiu is
  'Score de riesgo LA/FT por código CIIU (1-3). Heurística MeTRIK basada en DANE + ENV UIAF.';

-- Municipios
create table if not exists valida_dict_municipios (
  divipola text primary key,
  municipio text not null,
  departamento text not null,
  score int not null check (score in (1, 2, 3)),
  actualizado_at timestamptz not null default now()
);
comment on table valida_dict_municipios is
  'Score de riesgo por municipio Colombia (1-3). Fuente: ENV UIAF + cruces Defensoría/UNODC.';

-- Diccionarios son globales y lectura libre
alter table valida_dict_paises enable row level security;
alter table valida_dict_ciiu enable row level security;
alter table valida_dict_municipios enable row level security;

create policy paises_select_all on valida_dict_paises for select using (true);
create policy ciiu_select_all on valida_dict_ciiu for select using (true);
create policy municipios_select_all on valida_dict_municipios for select using (true);

-- Anulación local de CIIU por workspace (override del diccionario global)
create table if not exists valida_segmentacion_ciiu_override (
  workspace_id uuid not null references workspaces(id) on delete cascade,
  codigo_ciiu text not null,
  score int not null check (score in (1, 2, 3)),
  razon text,
  creado_at timestamptz not null default now(),
  creado_por uuid references profiles(id),
  primary key (workspace_id, codigo_ciiu)
);

alter table valida_segmentacion_ciiu_override enable row level security;

create policy ciiu_override_workspace on valida_segmentacion_ciiu_override
  for all using (workspace_id = current_user_workspace_id())
  with check (workspace_id = current_user_workspace_id());

-- =============================================================================
-- 4. Score por negocio (calculado)
-- =============================================================================

create table if not exists valida_score_negocio (
  negocio_id uuid primary key references negocios(id) on delete cascade,
  workspace_id uuid not null references workspaces(id) on delete cascade,
  universo text not null check (universo in ('contraparte', 'empleado')),
  puntaje numeric(4,2) not null,
  nivel text not null check (nivel in ('alto', 'medio', 'bajo')),
  factores_aplicados jsonb not null default '{}'::jsonb,
  valida_consulta_id_ultima uuid,
  proxima_revision date,
  actualizado_at timestamptz not null default now()
);

create index if not exists idx_valida_score_workspace
  on valida_score_negocio(workspace_id, nivel);
create index if not exists idx_valida_score_proxima_revision
  on valida_score_negocio(proxima_revision)
  where proxima_revision is not null;

alter table valida_score_negocio enable row level security;
create policy score_negocio_workspace on valida_score_negocio
  for all using (workspace_id = current_user_workspace_id())
  with check (workspace_id = current_user_workspace_id());

comment on table valida_score_negocio is
  'Score SARLAFT calculado por negocio según la configuración activa del workspace y la consulta Valida más reciente.';

-- =============================================================================
-- 5. Trigger updated_at en config
-- =============================================================================

create or replace function set_updated_at_segmentacion()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_valida_segmentacion_updated_at on valida_segmentacion_config;
create trigger trg_valida_segmentacion_updated_at
  before update on valida_segmentacion_config
  for each row
  execute function set_updated_at_segmentacion();

-- =============================================================================
-- 6. Seed mínimo de diccionarios (solo para testing inmediato)
-- =============================================================================
-- El seed completo se carga por script admin separado.
-- Aquí solo entradas críticas para validar el flujo end-to-end.

insert into valida_dict_paises (codigo_iso, nombre, score, motivo) values
  ('IR', 'Irán', 3, 'GAFI call for action + OFAC sanción geográfica'),
  ('KP', 'Corea del Norte', 3, 'GAFI call for action + OFAC sanción geográfica'),
  ('MM', 'Myanmar', 3, 'GAFI call for action'),
  ('SY', 'Siria', 3, 'OFAC sanción geográfica'),
  ('CU', 'Cuba', 3, 'OFAC sanción geográfica'),
  ('PA', 'Panamá', 2, 'DIAN paraíso fiscal Decreto 1357/2024'),
  ('AE', 'Emiratos Árabes Unidos', 2, 'GAFI increased monitoring'),
  ('TR', 'Turquía', 2, 'GAFI increased monitoring'),
  ('CO', 'Colombia', 1, 'Jurisdicción local — riesgo base'),
  ('US', 'Estados Unidos', 1, 'Riesgo base'),
  ('MX', 'México', 1, 'Riesgo base'),
  ('CL', 'Chile', 1, 'Riesgo base'),
  ('PE', 'Perú', 1, 'Riesgo base'),
  ('EC', 'Ecuador', 1, 'Riesgo base'),
  ('ES', 'España', 1, 'Riesgo base')
on conflict (codigo_iso) do nothing;

insert into valida_dict_ciiu (codigo, descripcion, score) values
  ('0122', 'Cultivo de plátano y banano', 3),
  ('0123', 'Cultivo de café', 2),
  ('0710', 'Extracción de minerales de hierro', 3),
  ('0729', 'Extracción de otros minerales metalíferos no ferrosos n.c.p.', 3),
  ('0721', 'Extracción de minerales de uranio y de torio', 3),
  ('4923', 'Transporte de carga por carretera', 2),
  ('9200', 'Actividades de juegos de azar y apuestas', 3),
  ('6810', 'Actividades inmobiliarias realizadas con bienes propios', 2),
  ('6499', 'Otras actividades de servicio financiero', 2),
  ('5610', 'Actividades de restaurantes, cafeterías y servicio móvil de comidas', 1),
  ('4711', 'Comercio al por menor en establecimientos no especializados', 1),
  ('6201', 'Actividades de desarrollo de sistemas informáticos', 1)
on conflict (codigo) do nothing;

insert into valida_dict_municipios (divipola, municipio, departamento, score) values
  ('05001', 'Medellín', 'Antioquia', 2),
  ('05045', 'Apartadó', 'Antioquia', 3),
  ('05154', 'Caucasia', 'Antioquia', 3),
  ('05837', 'Turbo', 'Antioquia', 3),
  ('05895', 'Zaragoza', 'Antioquia', 3),
  ('05665', 'San Pedro de Urabá', 'Antioquia', 3),
  ('11001', 'Bogotá D.C.', 'Cundinamarca', 1),
  ('76001', 'Cali', 'Valle del Cauca', 2),
  ('08001', 'Barranquilla', 'Atlántico', 1),
  ('13001', 'Cartagena', 'Bolívar', 2),
  ('27001', 'Quibdó', 'Chocó', 3),
  ('27800', 'Unguía', 'Chocó', 3),
  ('19001', 'Popayán', 'Cauca', 2),
  ('19318', 'Guapi', 'Cauca', 3),
  ('52001', 'Pasto', 'Nariño', 2),
  ('52250', 'El Charco', 'Nariño', 3),
  ('52520', 'La Tola', 'Nariño', 3),
  ('54001', 'Cúcuta', 'Norte de Santander', 2),
  ('54498', 'Ocaña', 'Norte de Santander', 2),
  ('54810', 'Tibú', 'Norte de Santander', 3),
  ('50001', 'Villavicencio', 'Meta', 1),
  ('50568', 'Puerto Gaitán', 'Meta', 3),
  ('50711', 'Vista Hermosa', 'Meta', 3),
  ('86001', 'Mocoa', 'Putumayo', 2),
  ('86568', 'Puerto Asís', 'Putumayo', 3),
  ('86573', 'Puerto Caicedo', 'Putumayo', 3),
  ('91001', 'Leticia', 'Amazonas', 2),
  ('66001', 'Pereira', 'Risaralda', 1),
  ('17001', 'Manizales', 'Caldas', 1)
on conflict (divipola) do nothing;
