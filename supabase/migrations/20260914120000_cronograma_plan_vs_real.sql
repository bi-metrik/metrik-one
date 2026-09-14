-- ============================================================
-- El cronograma deja de ser una lista de fechas y pasa a tener plan, real y versión.
--
-- Hasta hoy `bloque_items.fecha_inicio` / `fecha_fin` guardaban UNA fecha por paso, y
-- esa fecha se editaba durante la obra. El efecto es un cronograma que siempre se
-- cumple: al correrse el montaje se corregía la fecha y el desfase desaparecía del
-- registro. Quien lo mira después no puede saber si la obra fue puntual o si el plan
-- se reescribió tres veces.
--
-- A partir de aquí:
--   · fecha_inicio / fecha_fin            = el PLAN (se define en planeación).
--   · fecha_inicio_real / fecha_fin_real  = lo que EFECTIVAMENTE pasó (en ejecución).
--
-- Y cada cambio de PLANEACIÓN (un paso nuevo, un paso menos, una fecha planeada que se
-- mueve, un responsable que cambia) corta una versión del cronograma. Marcar avance
-- real NO corta versión: el avance es lo que se mide CONTRA la versión publicada. Esa
-- versión es la que se exporta y se le manda al cliente.
-- ============================================================

alter table bloque_items
  add column if not exists fecha_inicio_real date,
  add column if not exists fecha_fin_real date;

comment on column bloque_items.fecha_inicio is
  'Fecha PLANEADA de inicio. Cambiarla corta una versión nueva del cronograma.';
comment on column bloque_items.fecha_inicio_real is
  'Fecha REAL de inicio. Es avance, no planeación: no corta versión.';

-- ── Versiones del cronograma ────────────────────────────────────────────────

create table if not exists cronograma_versiones (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  negocio_id uuid not null references negocios(id) on delete cascade,
  negocio_bloque_id uuid not null references negocio_bloques(id) on delete cascade,
  numero integer not null,
  -- El plan congelado: los pasos con sus fechas planeadas al momento del corte. Es una
  -- COPIA a propósito. Si apuntara a los items vivos, la versión publicada cambiaría
  -- sola cada vez que alguien mueve una fecha, que es justo lo que se quiere evitar.
  snapshot jsonb not null default '[]'::jsonb,
  -- Qué cambió frente a la versión anterior, en frases leíbles. Es lo que se imprime
  -- al pie del documento que ve el cliente.
  cambios jsonb not null default '[]'::jsonb,
  creado_por uuid references profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  -- Ventana de agrupación: mientras siga abierta, los cambios de planeación del mismo
  -- autor se acumulan en ESTA versión en vez de cortar una nueva. Sin esto, crear los
  -- ocho pasos de una obra dejaría ocho versiones y el historial sería ilegible.
  abierta_hasta timestamptz,
  unique (negocio_bloque_id, numero)
);

create index if not exists idx_cronograma_versiones_bloque
  on cronograma_versiones (negocio_bloque_id, numero desc);

alter table cronograma_versiones enable row level security;

drop policy if exists cronograma_versiones_select on cronograma_versiones;
create policy cronograma_versiones_select on cronograma_versiones
  for select using (workspace_id = current_user_workspace_id());

drop policy if exists cronograma_versiones_insert on cronograma_versiones;
create policy cronograma_versiones_insert on cronograma_versiones
  for insert with check (workspace_id = current_user_workspace_id());

drop policy if exists cronograma_versiones_update on cronograma_versiones;
create policy cronograma_versiones_update on cronograma_versiones
  for update using (workspace_id = current_user_workspace_id());

-- Se lee y se escribe desde la ficha del negocio, con la sesión del usuario. No se
-- borra: una versión publicada es el documento que ya salió para el cliente.
grant select, insert, update on public.cronograma_versiones to authenticated;
