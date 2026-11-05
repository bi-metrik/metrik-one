-- ============================================================
-- Entrega única del bloqueo por WhatsApp (Trappvel, brief del 2026-11-04)
-- ------------------------------------------------------------
-- La asesora le entrega a Trappi el pedido de un bloqueo (texto + pantallazos), confirma una vez y
-- recibe la cotización en PDF. Dos tablas NUEVAS; no toca ninguna fila existente.
--
--  · entregas_bloqueo: un pedido. Su `estado` es el «por confirmar» del brief: vive en la ENTREGA, no
--    en el viaje ni en la cotización (que siguen con sus estados de siempre: viaje abierto, cotización
--    en borrador). `tiempos` guarda la hora de cada paso (primer mensaje, modelo, etapas, PDF).
--  · entregas_bloqueo_piezas: cada mensaje del hilo, entrante o saliente, con su wamid y el wamid que
--    cita (`contexto_wamid`). Es el ancla: lo que llega citando un mensaje del hilo va a ese pedido.
--    Una pieza sin pedido (`entrega_id` null) es un mensaje suelto que se le preguntó a la asesora.
--
-- Escriben el webhook (service_role) y la ruta interna de la app (service_role). La pantalla de revisión
-- lee con la sesión de la asesora: RLS por workspace + select a authenticated. Nadie más escribe.
-- ============================================================

create table if not exists public.entregas_bloqueo (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  staff_id uuid references public.staff(id) on delete set null,
  telefono text not null,
  estado text not null default 'recibiendo'
    check (estado in ('recibiendo', 'procesando', 'tipo_por_confirmar', 'por_confirmar', 'aplicando', 'listo', 'frenado', 'a_medida', 'error', 'descartada')),
  tentativa boolean not null default false,
  codigo text,
  negocio_id uuid references public.negocios(id) on delete set null,
  cotizacion_id uuid references public.cotizaciones(id) on delete set null,
  contacto_id uuid references public.contactos(id) on delete set null,
  salida jsonb,
  preguntas jsonb not null default '[]'::jsonb,
  resueltas text[] not null default '{}',
  tipo_confirmado boolean not null default false,
  validacion jsonb,
  pdf_ref text,
  tiempos jsonb not null default '{}'::jsonb,
  uso jsonb not null default '[]'::jsonb,
  error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists entregas_bloqueo_abiertas_idx
  on public.entregas_bloqueo (workspace_id, telefono, updated_at desc)
  where estado not in ('listo', 'a_medida', 'error', 'descartada');

create table if not exists public.entregas_bloqueo_piezas (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  entrega_id uuid references public.entregas_bloqueo(id) on delete cascade,
  telefono text not null,
  direccion text not null check (direccion in ('entrante', 'saliente')),
  wamid text,
  contexto_wamid text,
  tipo text not null check (tipo in ('texto', 'imagen', 'boton', 'documento')),
  texto text,
  media_ref text,
  mime text,
  created_at timestamptz not null default now()
);

create index if not exists entregas_bloqueo_piezas_entrega_idx on public.entregas_bloqueo_piezas (entrega_id, created_at);
create unique index if not exists entregas_bloqueo_piezas_wamid_idx on public.entregas_bloqueo_piezas (wamid) where wamid is not null;

alter table public.entregas_bloqueo enable row level security;
alter table public.entregas_bloqueo_piezas enable row level security;

-- La pantalla de revisión (sesión de la asesora) solo lee, y solo su workspace.
create policy entregas_bloqueo_lectura on public.entregas_bloqueo
  for select to authenticated using (workspace_id = public.current_user_workspace_id());
create policy entregas_bloqueo_piezas_lectura on public.entregas_bloqueo_piezas
  for select to authenticated using (workspace_id = public.current_user_workspace_id());

grant select on public.entregas_bloqueo to authenticated;
grant select on public.entregas_bloqueo_piezas to authenticated;
