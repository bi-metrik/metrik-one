-- ============================================================
-- Servicio al cliente por WhatsApp — identificación + bandeja de llamadas
-- ------------------------------------------------------------
-- Dos piezas:
--   1. cs_identificar_cliente() — de un teléfono al perfil del cliente
--   2. cs_escalamientos          — los casos que el bot no resolvió
--
-- Nada de esto crea datos nuevos del cliente: el perfil (quién es, qué
-- producto tiene, en qué etapa va) YA vive en contactos + negocios +
-- etapas_negocio. Lo que faltaba era la vía para leerlo desde el teléfono.
-- ============================================================

-- ── 1. Identificación por teléfono ──────────────────────────────────────
--
-- Los teléfonos en `contactos` están sucios y en formatos distintos:
--   '+573154781894'  ·  '301 7909400'  ·  '+57 (301) 5311781'
-- y WhatsApp entrega '573159509103' pelado. Comparar el texto no sirve, y
-- comparar solo dígitos tampoco: uno trae indicativo de país y el otro no.
--
-- Se comparan los ÚLTIMOS 10 dígitos, que es el número nacional tanto en
-- Colombia como en Estados Unidos y Puerto Rico.
--
-- Regla dura: si el sufijo coincide con MÁS DE UN contacto, no se
-- identifica a ninguno. Contestarle a una persona con el caso de otra es
-- peor que no reconocerla — expone datos de un tercero.

create or replace function public.cs_identificar_cliente(
  p_workspace_id uuid,
  p_phone text
)
returns table (
  contacto_id      uuid,
  contacto_nombre  text,
  negocio_id       uuid,
  caso_codigo      text,
  producto         text,
  etapa_numero     int,
  etapa_nombre     text,
  stage            text,
  responsable      text,
  precio_aprobado  numeric,
  ambiguo          boolean
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_sufijo text;
  v_n int;
begin
  v_sufijo := right(regexp_replace(coalesce(p_phone, ''), '[^0-9]', '', 'g'), 10);
  if length(v_sufijo) < 10 then
    return; -- número demasiado corto para identificar con seguridad
  end if;

  select count(*) into v_n
  from contactos c
  where c.workspace_id = p_workspace_id
    and c.telefono is not null
    and right(regexp_replace(c.telefono, '[^0-9]', '', 'g'), 10) = v_sufijo;

  if v_n = 0 then
    return;
  end if;

  if v_n > 1 then
    -- Ambigüedad: se reporta para que el bot atienda SIN datos del caso,
    -- en vez de arriesgarse a hablarle del caso equivocado.
    return query select null::uuid, null::text, null::uuid, null::text, null::text,
                        null::int, null::text, null::text, null::text, null::numeric, true;
    return;
  end if;

  return query
  select c.id, c.nombre,
         n.id, n.codigo, l.nombre,
         e.numero, e.nombre, n.stage_actual,
         s.full_name, n.precio_aprobado,
         false
  from contactos c
  -- El caso abierto más reciente. Si tiene varios, el bot habla del último;
  -- si no tiene ninguno, igual lo saluda por su nombre (las columnas del
  -- negocio quedan en null y el prompt lo sabe manejar).
  left join lateral (
    select n2.* from negocios n2
    where n2.contacto_id = c.id
      and n2.workspace_id = p_workspace_id
      and n2.estado = 'abierto'
    order by n2.created_at desc
    limit 1
  ) n on true
  left join lineas_negocio l on l.id = n.linea_id
  left join etapas_negocio e on e.id = n.etapa_actual_id
  left join staff s on s.id = n.responsable_id
  where c.workspace_id = p_workspace_id
    and c.telefono is not null
    and right(regexp_replace(c.telefono, '[^0-9]', '', 'g'), 10) = v_sufijo
  limit 1;
end;
$$;

-- La consume la edge function con service_role. Nadie más.
revoke all on function public.cs_identificar_cliente(uuid, text) from public, anon, authenticated;

comment on function public.cs_identificar_cliente(uuid, text) is
  'Resuelve el perfil de un cliente desde su telefono (ultimos 10 digitos). Devuelve ambiguo=true si el sufijo coincide con mas de un contacto: en ese caso el bot atiende sin datos del caso.';


-- ── 2. Bandeja de llamadas ──────────────────────────────────────────────
--
-- Lo que el bot no resolvió queda aquí, con lo que el agente necesita para
-- levantar el teléfono: quién, por qué, y cuándo dijo que lo llamaran.

create table if not exists public.cs_escalamientos (
  id            uuid primary key default gen_random_uuid(),
  workspace_id  uuid not null references public.workspaces(id) on delete cascade,
  contacto_id   uuid references public.contactos(id) on delete set null,
  negocio_id    uuid references public.negocios(id) on delete set null,

  phone         text not null,
  cliente_nombre text,

  -- Por qué se escaló y qué pidió el cliente.
  motivo        text not null,
  franja        text,                -- cuándo pidió que lo llamen, textual
  resumen       text,                -- contexto para el agente, sin releer el chat
  conversacion  jsonb not null default '[]'::jsonb,

  estado        text not null default 'pendiente',
  tomado_por    uuid references public.staff(id) on delete set null,
  tomado_at     timestamptz,
  resuelto_at   timestamptz,
  nota_cierre   text,

  created_at    timestamptz not null default now(),

  constraint cs_escalamientos_estado_check
    check (estado in ('pendiente', 'tomado', 'resuelto', 'descartado'))
);

-- La bandeja se lee por workspace y por estado, con los pendientes primero.
create index if not exists idx_cs_escalamientos_bandeja
  on public.cs_escalamientos (workspace_id, estado, created_at desc);

alter table public.cs_escalamientos enable row level security;

-- La escribe la edge function (service_role) y la LEE el equipo desde la
-- app, así que a diferencia de cs_chat_sessions esta sí necesita policy y
-- grant para `authenticated`.
drop policy if exists cs_escalamientos_select on public.cs_escalamientos;
create policy cs_escalamientos_select on public.cs_escalamientos
  for select to authenticated
  using (workspace_id = current_user_workspace_id());

drop policy if exists cs_escalamientos_update on public.cs_escalamientos;
create policy cs_escalamientos_update on public.cs_escalamientos
  for update to authenticated
  using (workspace_id = current_user_workspace_id())
  with check (workspace_id = current_user_workspace_id());

grant select, update on public.cs_escalamientos to authenticated;
-- Insertar es solo del bot: nadie crea un escalamiento a mano desde la app.
revoke insert, delete on public.cs_escalamientos from authenticated;
revoke all on public.cs_escalamientos from anon;

comment on table public.cs_escalamientos is
  'Casos que el bot de WhatsApp no resolvio y pasan a llamada. Los inserta la edge function; el equipo los lee y los toma desde la app.';
