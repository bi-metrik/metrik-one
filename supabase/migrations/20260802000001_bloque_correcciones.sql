-- Trazabilidad de correcciones sobre bloques de etapas ya superadas.
--
-- POR QUÉ UNA TABLA Y NO SOLO activity_log
-- La corrección post-avance (2026-07-29) ya deja marca de QUIÉN y CUÁNDO dentro de
-- `negocio_bloques.data._ediciones`, pero no de QUÉ cambió ni POR QUÉ. Y el evento
-- "bloque completado" de activity_log va con `valor_anterior`/`valor_nuevo` vacíos,
-- así que hoy no se puede reconstruir qué decía un campo antes de que lo tocaran.
--
-- Medido en SOENA el 2026-08-02: 411 eventos de bloque completado, todos sin valores;
-- y la única corrección registrada (18 campos, un negocio) sin causa ni valor previo.
--
-- Agregar por área, causa, etapa o campo desde un jsonb anidado obliga a consultas
-- artesanales. Esta tabla es la fuente para esa lectura; activity_log conserva el
-- evento legible del timeline y queda enlazado por `activity_log_id`.
--
-- ATRIBUCIÓN POR ÁREA, NO POR PERSONA (decisión de Mauricio, 2026-08-02)
-- `area` es el área DUEÑA del bloque corregido (derivada del stage de su etapa), no
-- el área de quien corrige. Sin esa distinción, quien limpia errores ajenos aparece
-- como el que más se equivoca. `corregido_por_*` se guarda para auditoría, no para
-- rankear personas.

create table if not exists public.bloque_correcciones (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  negocio_id uuid not null references public.negocios(id) on delete cascade,
  negocio_bloque_id uuid not null references public.negocio_bloques(id) on delete cascade,

  -- Contexto del bloque corregido (denormalizado a propósito: un rename posterior del
  -- bloque o de la etapa no debe reescribir la historia de lo que pasó).
  bloque_slug text,
  bloque_nombre text,
  etapa_id uuid,
  etapa_nombre text,
  etapa_orden integer,
  area text check (area in ('comercial', 'operaciones', 'financiera')),

  campo_slug text not null,
  valor_anterior text,
  valor_nuevo text,

  -- Las tres causas se eligen en un clic al corregir. Distinguen el error real del
  -- cambio legítimo: un cliente que cambia de idea no es una falla de nadie.
  causa text not null check (causa in ('error_captura', 'cambio_cliente', 'dato_posterior')),

  -- Agrupa los campos tocados en una misma corrección (una causa, N campos). Lo
  -- genera el cliente al abrir la corrección; solo agrupa, no autoriza nada.
  sesion_id uuid not null,

  corregido_por uuid,
  corregido_por_nombre text,
  activity_log_id uuid,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  -- Un campo corregido varias veces dentro de la misma sesión es UNA corrección:
  -- el `valor_anterior` se fija en el insert y el `valor_nuevo` se refresca.
  constraint bloque_correcciones_unicidad unique (negocio_bloque_id, campo_slug, sesion_id)
);

create index if not exists idx_bloque_correcciones_ws_fecha
  on public.bloque_correcciones (workspace_id, created_at desc);
create index if not exists idx_bloque_correcciones_negocio
  on public.bloque_correcciones (negocio_id);
create index if not exists idx_bloque_correcciones_area
  on public.bloque_correcciones (workspace_id, area, causa);

alter table public.bloque_correcciones enable row level security;

-- La consume el cliente `authenticated` (el registro ocurre dentro de server actions
-- que usan la sesión del usuario, y la lectura agregada es del equipo del workspace).
drop policy if exists "bloque_correcciones_select" on public.bloque_correcciones;
create policy "bloque_correcciones_select" on public.bloque_correcciones
  for select to authenticated
  using (workspace_id = current_user_workspace_id());

drop policy if exists "bloque_correcciones_insert" on public.bloque_correcciones;
create policy "bloque_correcciones_insert" on public.bloque_correcciones
  for insert to authenticated
  with check (workspace_id = current_user_workspace_id());

-- El update existe solo para refrescar `valor_nuevo` dentro de la misma sesión.
drop policy if exists "bloque_correcciones_update" on public.bloque_correcciones;
create policy "bloque_correcciones_update" on public.bloque_correcciones
  for update to authenticated
  using (workspace_id = current_user_workspace_id())
  with check (workspace_id = current_user_workspace_id());

-- Toda tabla nueva de este proyecto nace con privilegios para `anon`; el REVOKE es
-- explícito porque la anon key viaja en el bundle del browser.
revoke all on public.bloque_correcciones from anon;
grant select, insert, update on public.bloque_correcciones to authenticated;
