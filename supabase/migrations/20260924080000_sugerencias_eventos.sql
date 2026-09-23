-- ============================================================
-- Medición de las sugerencias comerciales (hoy, la tarjeta de Sustenta en /suscripcion)
-- ============================================================
--
-- Una fila por evento, por espacio y persona, para ver la conversión por CDA:
--
--   vista     — la tarjeta entró en pantalla (una vez por montaje de la tarjeta).
--   panel     — abrió «Ver cómo funciona».
--   cta       — pulsó «Quiero una demostración» (origen: la tarjeta o el pie del panel). Se
--               registra el clic, no el lead: el lead ya vive, único, en `interes_servicios`.
--   descarte  — pulsó «Ahora no».
--
-- La escribe SOLO el servidor, después de resolver quién pide (el espacio y la persona salen de la
-- sesión, no del navegador). Si la escritura falla, la pantalla no se entera: una medición no
-- justifica un error.
--
-- ## Grants: `revoke from public` NO basta en este repo
--
-- Los privilegios por defecto del esquema conceden a `anon` y `authenticated` por nombre: se
-- revoca nombrando a los tres. Es server-only.
--
-- ## Verificación después de aplicar (solo lectura)
--
--   select relname, relrowsecurity, relacl::text from pg_class where relname = 'sugerencias_eventos';
--     -> RLS true y sin anon ni authenticated en la ACL
--
-- ## Conversión por CDA (ejemplo de lectura)
--
--   select w.slug,
--          count(*) filter (where e.evento = 'vista')    as vistas,
--          count(*) filter (where e.evento = 'panel')    as paneles,
--          count(*) filter (where e.evento = 'cta')      as clics_cta,
--          count(*) filter (where e.evento = 'descarte') as descartes
--     from public.sugerencias_eventos e join public.workspaces w on w.id = e.workspace_id
--    where e.clave = 'sustenta'
--    group by w.slug order by vistas desc;
--
-- ## Cómo revertir
--
--   drop table public.sugerencias_eventos;
-- ============================================================

create table public.sugerencias_eventos (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  profile_id uuid not null references public.profiles(id) on delete cascade,
  clave text not null
    constraint sugerencias_eventos_clave check (clave ~ '^[a-z0-9_-]{1,60}$'),
  evento text not null
    constraint sugerencias_eventos_evento check (evento in ('vista', 'panel', 'cta', 'descarte')),
  -- Solo para `cta`: desde dónde se pulsó. ⚠️ Un CHECK solo rechaza con FALSE y con NULL deja
  -- pasar: sin el `is not null`, un `cta` con origen nulo daría NULL y entraría.
  origen text
    constraint sugerencias_eventos_origen check (
      (evento = 'cta' and origen is not null and origen in ('tarjeta', 'panel'))
      or (evento <> 'cta' and origen is null)
    ),
  created_at timestamptz not null default now()
);

create index sugerencias_eventos_clave_ws_idx
  on public.sugerencias_eventos (clave, workspace_id, created_at);

alter table public.sugerencias_eventos enable row level security;
-- server-only: la escribe el servidor con el espacio y la persona de la sesión; se lee por SQL para medir.
revoke all on table public.sugerencias_eventos from public, anon, authenticated;

comment on table public.sugerencias_eventos is
  'Eventos de una sugerencia comercial (vista, panel, cta, descarte) por espacio y persona. Server-only.';
