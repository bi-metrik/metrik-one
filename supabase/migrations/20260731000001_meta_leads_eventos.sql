-- Bitacora cruda de lo que Meta entrega al webhook de Lead Ads.
--
-- POR QUE EXISTE
--
-- Hasta hoy, un lead que no lograba convertirse en interaccion no dejaba NINGUNA
-- fila. Si el `page_id` no mapeaba a ningun workspace, si la Graph API devolvia
-- error o si el worker moria a mitad del trabajo diferido, todo el rastro era un
-- `console.warn` que se pierde a las 24 horas. Comprobado en produccion (SOENA,
-- workspace 7dea141d-d4da-483d-a78d-b14ef35500c5): de 153 leads que Meta entrego
-- desde el 2026-07-08, en ONE hay 135. Faltan 18 y no habia forma de saber cuales
-- ni por que, porque los POST responden 200 igual.
--
-- Esta tabla responde dos preguntas que antes no se podian responder:
--   1. Llego este leadgen_id?          -> select ... where leadgen_id = '...'
--   2. Por que no se convirtio?        -> columna `estado` + `motivo`
-- Y sirve de base para reprocesar: el `payload` guardado es el cuerpo completo
-- del POST, asi que un reproceso no necesita que Meta vuelva a entregar nada.
--
-- UNA FILA POR LEAD, NO POR POST. Un POST de Meta puede traer varios cambios
-- `leadgen`; cada uno es un lead distinto con su propio destino, asi que cada uno
-- lleva su fila. El `payload` completo se repite en las filas del mismo POST a
-- proposito: es diminuto y evita una tabla padre para nada. Un POST del que no se
-- puede extraer ningun leadgen igual deja su fila (con `leadgen_id` nulo) para que
-- una entrega malformada tampoco sea invisible.
--
-- NO hay unicidad por leadgen_id: si Meta reentrega el mismo lead, eso es un HECHO
-- distinto y merece su propia fila. La no-duplicacion del dato real la sigue
-- garantizando el indice unico de `contacto_interacciones`; la segunda entrega
-- queda registrada aqui como descartada por 'ya_ingerido', que es justo lo que uno
-- quiere ver al auditar.

create table if not exists public.meta_leads_eventos (
  id uuid primary key default gen_random_uuid(),

  -- Nulo a proposito: el evento se registra ANTES de resolver el routing, y si el
  -- `page_id` no mapea a ningun workspace nunca habra uno. Ese caso es justamente
  -- el que hoy desaparecia sin dejar rastro.
  workspace_id uuid references public.workspaces(id) on delete set null,

  page_id    text,
  leadgen_id text,
  form_id    text,

  -- Cuando Meta dice que se creo el lead (no cuando nos llego). Sirve para cruzar
  -- contra la Graph API sin depender de nuestro reloj.
  created_time timestamptz,
  recibido_en  timestamptz not null default now(),
  procesado_en timestamptz,

  --   recibido   -> entro y se valido la firma; el trabajo diferido aun no termino.
  --                 Una fila que se queda AQUI es la huella del worker reciclado.
  --   procesado  -> termino en una interaccion registrada.
  --   descartado -> decidimos no procesarlo (page_id sin workspace, ya ingerido).
  --   error      -> algo que debia funcionar fallo (Graph API, insert, token).
  estado text not null default 'recibido'
    check (estado in ('recibido', 'procesado', 'descartado', 'error')),
  motivo text,

  -- A donde fue a parar cuando si se proceso.
  interaccion_id uuid references public.contacto_interacciones(id) on delete set null,
  contacto_id    uuid references public.contactos(id) on delete set null,

  -- El cuerpo COMPLETO del POST, tal como llego. Es lo que permite reprocesar.
  payload jsonb not null,

  created_at timestamptz not null default now()
);

-- "Llego este leadgen_id?" es la consulta de auditoria principal.
create index if not exists idx_meta_leads_eventos_leadgen
  on public.meta_leads_eventos (leadgen_id);

-- "Que quedo colgado o fallo?" — el barrido para reprocesar.
create index if not exists idx_meta_leads_eventos_estado
  on public.meta_leads_eventos (estado, recibido_en desc);

create index if not exists idx_meta_leads_eventos_workspace
  on public.meta_leads_eventos (workspace_id, recibido_en desc);

alter table public.meta_leads_eventos enable row level security;

-- Tabla server-only: la escribe la edge function con service_role (que bypasea RLS
-- y grants) y por ahora no la lee ningun cliente. Sin policy y sin grant.
--
-- El REVOKE no es decorativo: en esta instancia las tablas nuevas de `public` nacen
-- con TODOS los privilegios para `anon` y `authenticated` por un default privilege
-- del schema, al reves de lo que dice la convencion de CLAUDE.md. Omitir el GRANT
-- no protege nada; hay que revocar. Y aqui importa mas que en otras tablas: el
-- payload crudo trae nombre, email y telefono de personas reales, y la anon key
-- viaja en el bundle del navegador.
revoke all on public.meta_leads_eventos from anon, authenticated;

comment on table public.meta_leads_eventos is
  'Bitacora cruda de las entregas del webhook de Meta Lead Ads: una fila por lead recibido, con el payload completo y por que termino (procesado/descartado/error). Server-only. Base para auditar y reprocesar.';
