-- La excepción del dueño a una cotización bajo el margen mínimo (Trappvel, 2026-09-22).
--
-- «Nada sale al cliente bajo el margen mínimo sin la firma de Edgar.» Una cotización bajo
-- el piso descarga el PDF con marca de agua de borrador y no se puede enviar ni aprobar,
-- salvo que el DUEÑO del workspace la autorice con un motivo. Esta tabla guarda esa
-- autorización, atada al estado exacto que se autorizó (`huella`): si después cambia un
-- precio, un costo o un margen, la excepción se marca perdida (`perdida_at`) y hay que
-- volver a pedirla. Reglas en src/lib/cotizaciones/piso-salida.ts y piso-salida-datos.ts.
--
-- Solo DDL: crea una tabla vacía. No toca una sola fila existente.
--
-- ⚠️ Va ANTES del merge del PR que la usa. Sin la tabla el código no se rompe (lee
-- «sin excepción» y todo lo que esté bajo el piso sale como borrador, el lado seguro),
-- pero el botón «Autorizar bajo el mínimo» no puede guardar nada.

create table public.cotizacion_excepciones_margen (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  cotizacion_id uuid not null references public.cotizaciones(id) on delete cascade,
  -- Quien autorizó. `staff.id`, que es lo que pinta el nombre en el editor.
  autorizada_por_staff_id uuid references public.staff(id) on delete set null,
  -- Y su `profiles.id`, que es la identidad de la sesión: el staff puede cambiar de
  -- workspace, la persona que firmó no.
  autorizada_por_profile_id uuid not null references public.profiles(id) on delete restrict,
  autorizada_at timestamptz not null default now(),
  motivo text not null check (char_length(btrim(motivo)) >= 3),
  -- El piso contra el que se autorizó (el congelado en la cotización).
  piso_pct numeric not null,
  -- sha256 del estado autorizado. Cuando la de hoy no coincide, la excepción no vale.
  huella text not null,
  -- Lo que el dueño vio: el total y el margen de cada tarifa, y las cifras de cada línea.
  -- De aquí sale la causa cuando se pierde.
  detalle jsonb not null,
  perdida_at timestamptz,
  perdida_causa text,
  created_at timestamptz not null default now()
);

comment on table public.cotizacion_excepciones_margen is
  'Autorización del dueño del workspace para que una cotización bajo el margen mínimo pueda salir al cliente. Se pierde sola si cambia cualquier precio, costo o margen.';

-- Una sola excepción vigente por cotización.
create unique index cotizacion_excepciones_margen_vigente
  on public.cotizacion_excepciones_margen (cotizacion_id)
  where perdida_at is null;

create index cotizacion_excepciones_margen_ws_cot
  on public.cotizacion_excepciones_margen (workspace_id, cotizacion_id, autorizada_at desc);

alter table public.cotizacion_excepciones_margen enable row level security;

-- server-only: la escribe y la lee solo el servidor con el cliente de servicio, después de comprobar que quien autoriza es el dueño. Un grant a authenticated le permitiría a cualquier operadora fabricarse una autorización por PostgREST sin pasar por esa comprobación.
revoke all on public.cotizacion_excepciones_margen from anon, authenticated;
