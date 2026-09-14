-- Opciones dentro del item e itinerarios de una cotizacion.
--
-- Paso 2 del motor de cotizacion de Trappvel
-- (`proyectos/trappvel/clarity/docs/diseno/motor-cotizacion.md`, seccion 9).
--
-- ## Que resuelve
--
-- Una agencia cotiza 3 vuelos x 3 hoteles + un traslado fijo. Son nueve precios y
-- hoy salen de nueve cotizaciones armadas a mano. Medido sobre un caso real (mismo
-- hotel, mismas fechas, dos aerolineas): AVIANCA deja 13,0% de margen y WINGO 3,1%,
-- y esa diferencia no se ve en ninguna parte.
--
-- ## COMPATIBILIDAD (R6) — la restriccion que manda sobre todo lo demas
--
-- Esta migracion es DDL PURO y ADITIVO. No toca una sola fila de datos.
--
--   · Las tres columnas de `items` nacen NULL, que es exactamente el estado de las
--     lineas que ya existen: sin grupo, sin ser opcion de nadie, sin unidad.
--   · Las dos tablas nuevas nacen VACIAS. Una cotizacion sin filas en
--     `cotizacion_itinerarios` se comporta EXACTAMENTE como hoy: suma todos sus
--     items. Termotech, Arca, WMC y las 18 cotizaciones que existen no cambian de
--     precio ni de comportamiento.
--
-- El codigo lo sostiene del mismo lado: `itemsFijos` (src/lib/cotizaciones/itinerarios.ts)
-- devuelve TODOS los items cuando ninguno declara grupo, y `recalcularTotales` solo
-- reparte por itinerario cuando hay uno marcado principal.
--
-- ## Por que la ranura es el `grupo` y no el titular
--
-- La tabla de combinaciones tiene una COLUMNA por grupo y una celda elige entre las
-- opciones de ese grupo. Si la ranura fuera el item titular, dos titulares con el
-- mismo grupo darian dos columnas para la misma decision. `opcion_de` se conserva
-- porque dice de quien es alternativa cada opcion —lo que permite copiarla, ordenarla
-- y arrastrarla al borrar el titular— pero no es lo que define la ranura.

-- ── 2a · opciones dentro del item ────────────────────────────────────────────

alter table public.items
  add column if not exists grupo text,
  add column if not exists opcion_de uuid references public.items(id) on delete cascade,
  add column if not exists unidad text;

comment on column public.items.grupo is
  'Ranura a la que pertenece la linea: vuelo, hotel, traslado, tour, dia-1... NULL = componente suelto, entra en todos los itinerarios. Es lo que define la columna de la tabla de combinaciones.';

comment on column public.items.opcion_de is
  'Item titular del que esta linea es alternativa. NULL = es el titular. Misma forma que cotizaciones.duplicada_de. Cada opcion tiene sus PROPIOS rubros, margen y precio_manual: no hereda del titular mas que el grupo.';

comment on column public.items.unidad is
  'Unidad de la linea de cara al cliente: pax, noche, trayecto, servicio. Antes solo existia en rubros, que es costo interno, asi que la linea no podia decir "3 noches".';

-- Las opciones de un titular, y las lineas de una ranura. Las dos consultas que hace
-- la tabla de combinaciones en cada render.
create index if not exists idx_items_opcion_de
  on public.items (opcion_de) where opcion_de is not null;

create index if not exists idx_items_cotizacion_grupo
  on public.items (cotizacion_id, grupo) where grupo is not null;

-- ── 2b · itinerarios ─────────────────────────────────────────────────────────

create table if not exists public.cotizacion_itinerarios (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  cotizacion_id uuid not null references public.cotizaciones(id) on delete cascade,
  -- Libre, y viaja al PDF ("Economica", "Recomendada"). Vacio: el PDF numera.
  nombre text,
  orden integer not null default 0,
  va_en_propuesta boolean not null default false,
  es_principal boolean not null default false,
  created_at timestamptz not null default now()
);

comment on table public.cotizacion_itinerarios is
  'Una combinacion completa de opciones (Wingo + Hard Rock + traslado) con su propio total y su propio margen. Una cotizacion sin filas aqui se comporta como antes de que esta tabla existiera.';

comment on column public.cotizacion_itinerarios.va_en_propuesta is
  'Si este itinerario sale en el PDF al cliente. Nace en false a proposito (T2): ninguna combinacion generada llega al cliente por omision. El servidor RECHAZA ponerlo en true si el itinerario esta incompleto o su margen real esta bajo el piso congelado de la cotizacion.';

comment on column public.cotizacion_itinerarios.es_principal is
  'El itinerario que manda sobre cotizaciones.valor_total (R5). Exactamente uno por cotizacion, y tiene que ir en la propuesta (T5). Lo garantiza el indice unico parcial de abajo.';

-- T5 · exactamente un principal. Indice unico PARCIAL: permite cero principales
-- (una cotizacion a medio armar) y prohibe dos. Cero es un estado legitimo y
-- transitorio; dos es una cotizacion con dos precios.
create unique index if not exists idx_itinerario_principal_unico
  on public.cotizacion_itinerarios (cotizacion_id) where es_principal;

create index if not exists idx_itinerarios_cotizacion
  on public.cotizacion_itinerarios (cotizacion_id, orden);

alter table public.cotizacion_itinerarios enable row level security;

drop policy if exists cotizacion_itinerarios_workspace on public.cotizacion_itinerarios;
create policy cotizacion_itinerarios_workspace on public.cotizacion_itinerarios
  for all
  using (workspace_id = (select current_user_workspace_id()))
  with check (workspace_id = (select current_user_workspace_id()));

-- El editor de cotizacion corre con el cliente authenticated.
grant select, insert, update, delete on public.cotizacion_itinerarios to authenticated;

-- ── itinerario_opciones ──────────────────────────────────────────────────────

create table if not exists public.itinerario_opciones (
  itinerario_id uuid not null references public.cotizacion_itinerarios(id) on delete cascade,
  item_id uuid not null references public.items(id) on delete cascade,
  primary key (itinerario_id, item_id)
);

comment on table public.itinerario_opciones is
  'Que opcion elige este itinerario en cada ranura. Solo se guardan las ranuras CON alternativas: los componentes sin alternativa (traslado unico, seguro) entran solos en todos los itinerarios (R3) y no se teclean N veces.';

-- `on delete cascade` en las dos FK y no un guard en el codigo: borrar un item o un
-- itinerario tiene que llevarse sus vinculos, o quedan filas apuntando a nada que
-- vuelven incompleto un itinerario sin que nadie pueda ver por que.

create index if not exists idx_itinerario_opciones_item
  on public.itinerario_opciones (item_id);

alter table public.itinerario_opciones enable row level security;

-- La tabla NO tiene workspace_id propio: se valida por join contra el itinerario,
-- que es el patron de `staff_areas` y `control_causa`. Agregarle la columna abriria
-- la puerta a que un vinculo diga un workspace y su itinerario diga otro.
drop policy if exists itinerario_opciones_workspace on public.itinerario_opciones;
create policy itinerario_opciones_workspace on public.itinerario_opciones
  for all
  using (
    exists (
      select 1 from public.cotizacion_itinerarios ci
      where ci.id = itinerario_opciones.itinerario_id
        and ci.workspace_id = (select current_user_workspace_id())
    )
  )
  with check (
    exists (
      select 1 from public.cotizacion_itinerarios ci
      where ci.id = itinerario_opciones.itinerario_id
        and ci.workspace_id = (select current_user_workspace_id())
    )
  );

grant select, insert, update, delete on public.itinerario_opciones to authenticated;
