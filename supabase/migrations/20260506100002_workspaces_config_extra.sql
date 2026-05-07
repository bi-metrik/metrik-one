-- Workspaces — config_extra JSONB para credenciales y configs por workspace
-- Necesario para almacenar valida_api_key (server-only) por workspace
-- sin tener que crear tabla aparte de secrets.

alter table workspaces
  add column if not exists config_extra jsonb not null default '{}'::jsonb;

comment on column workspaces.config_extra is
  'Configuraciones server-only por workspace. Nunca exponer al cliente. Ejemplos: valida_api_key, valida_cliente_id.';
