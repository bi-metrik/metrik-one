-- ============================================================================
-- Perfil del contacto: un hecho por fila (motor de perfil, corte 1: lo explícito por el bot).
-- SIN APLICAR al abrir el PR: la aplica la sesión principal con OK de Mauricio, ANTES del merge.
--
-- Diseño: proyectos/trappvel/clarity/docs/diseno/motor-perfil-cliente.md §4.1 (hechos, no un blob) y §11; brief a Max
-- del 2026-10-12 («recuerda que a Mauricio Moreno le gusta la comida italiana»).
--
--   · Un hecho = una fila: dimensión (vocabulario cerrado), texto, valor jsonb opcional.
--   · `estado`: sugerido (no cuenta como dato hasta que alguien lo confirma en ONE), confirmado, descartado.
--     Descartar es un cambio de estado, no un borrado: la tabla no concede DELETE a la sesión. El borrado por petición
--     del titular (§9.2) es una operación de servicio (service_role).
--   · `origen_tipo`: bot_explicito (el comercial se lo pidió al bot y tocó Guardar), bot_conversacion (el bot lo separó
--     de una solicitud de viaje, entra como sugerido), manual (una persona en ONE). `origen_ref` obligatorio: la fila de
--     `wa_conversacion` del mensaje, o el usuario.
--
-- Las invariantes que no dependen de quién escribe viven en el trigger, no solo en el código:
--   1. el contacto es del workspace de la fila;
--   2. sin autorización de datos VIGENTE (`autorizacion_datos_estado(...).vigente.generales`, la misma regla del gate y
--      del bot) no nace ningún hecho ni se confirma uno sugerido. Descartar sí se puede siempre;
--   3. nace sugerido o confirmado (nunca descartado); las transiciones son sugerido → confirmado, sugerido → descartado
--      y confirmado → descartado; un descartado no vuelve;
--   4. lo que dice el hecho y de dónde salió no se reescribe: solo cambian el estado y quién/cuándo lo cambió.
-- Lo demás (que el bot no escriba sin toque, que no guarde sensibles ni juicios, los permisos por rol) lo decide el
-- código: el modelo marca, el código obedece la marca.
--
-- No escribe ni corrige ninguna fila de ningún workspace.
-- ============================================================================

create table public.contacto_perfil_hechos (
  id              uuid primary key default gen_random_uuid(),
  workspace_id    uuid not null references public.workspaces(id) on delete cascade,
  contacto_id     uuid not null references public.contactos(id) on delete cascade,
  dimension       text not null
                  check (dimension in ('nucleo_viaje', 'preferencias', 'frecuencia', 'capacidad_pago', 'documentos', 'identidad', 'otro')),
  texto           text not null check (length(btrim(texto)) between 1 and 280),
  valor           jsonb,
  estado          text not null default 'sugerido'
                  check (estado in ('sugerido', 'confirmado', 'descartado')),
  origen_tipo     text not null check (origen_tipo in ('bot_explicito', 'bot_conversacion', 'manual')),
  origen_ref      text not null check (length(btrim(origen_ref)) between 1 and 200),
  creado_por      uuid references public.staff(id) on delete set null,
  confirmado_por  uuid references public.staff(id) on delete set null,
  confirmado_at   timestamptz,
  descartado_por  uuid references public.staff(id) on delete set null,
  descartado_at   timestamptz,
  created_at      timestamptz not null default now(),
  constraint contacto_perfil_hechos_confirmado_con_fecha check (estado <> 'confirmado' or confirmado_at is not null),
  constraint contacto_perfil_hechos_descartado_con_fecha check (estado <> 'descartado' or descartado_at is not null)
);

-- El perfil de un contacto, sin lo descartado (lo que lee la ficha y el viaje).
create index idx_contacto_perfil_hechos_contacto
  on public.contacto_perfil_hechos (workspace_id, contacto_id) where estado <> 'descartado';

-- Un mismo texto vivo una sola vez por contacto (sugerido o confirmado): repetirlo no duplica.
create unique index contacto_perfil_hechos_texto_unico
  on public.contacto_perfil_hechos (contacto_id, lower(btrim(texto))) where estado <> 'descartado';

alter table public.contacto_perfil_hechos enable row level security;
revoke all on table public.contacto_perfil_hechos from public, anon, authenticated;
create policy contacto_perfil_hechos_ws on public.contacto_perfil_hechos for all
  using (workspace_id = (select public.current_user_workspace_id()))
  with check (workspace_id = (select public.current_user_workspace_id()));
-- Sin delete: descartar es un cambio de estado. El bot escribe con service_role (edge function).
grant select, insert, update on public.contacto_perfil_hechos to authenticated;

comment on table public.contacto_perfil_hechos is
  'Perfil del contacto, un hecho por fila (motor de perfil §4.1). sugerido no cuenta hasta que alguien lo confirma; descartar es cambio de estado. Sin autorización de datos vigente (generales) no nace ni se confirma ningún hecho (trigger).';

-- ── Las guardas ────────────────────────────────────────────────────────────────

create or replace function public.contacto_perfil_hechos_guardas()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_aut jsonb;
begin
  if tg_op = 'INSERT' then
    if not exists (select 1 from public.contactos c where c.id = new.contacto_id and c.workspace_id = new.workspace_id) then
      raise exception 'perfil_contacto_fuera_del_workspace' using errcode = '23514';
    end if;
    if new.estado = 'descartado' then
      raise exception 'perfil_nace_descartado' using errcode = '23514';
    end if;
    if new.estado = 'confirmado' and new.confirmado_at is null then
      new.confirmado_at := now();
    end if;
  else
    -- Lo que dice el hecho y de dónde salió no se reescribe.
    if new.workspace_id is distinct from old.workspace_id or new.contacto_id is distinct from old.contacto_id
       or new.dimension is distinct from old.dimension or new.texto is distinct from old.texto
       or new.valor is distinct from old.valor or new.origen_tipo is distinct from old.origen_tipo
       or new.origen_ref is distinct from old.origen_ref or new.creado_por is distinct from old.creado_por
       or new.created_at is distinct from old.created_at then
      raise exception 'perfil_hecho_inmutable' using errcode = '23514';
    end if;
    if new.estado is distinct from old.estado then
      if not ((old.estado = 'sugerido' and new.estado in ('confirmado', 'descartado'))
              or (old.estado = 'confirmado' and new.estado = 'descartado')) then
        raise exception 'perfil_transicion_invalida: % -> %', old.estado, new.estado using errcode = '23514';
      end if;
      if new.estado = 'confirmado' and new.confirmado_at is null then new.confirmado_at := now(); end if;
      if new.estado = 'descartado' and new.descartado_at is null then new.descartado_at := now(); end if;
    elsif new.confirmado_por is distinct from old.confirmado_por or new.confirmado_at is distinct from old.confirmado_at
          or new.descartado_por is distinct from old.descartado_por or new.descartado_at is distinct from old.descartado_at then
      raise exception 'perfil_hecho_inmutable' using errcode = '23514';
    end if;
  end if;

  -- Nace o se confirma: hace falta la autorización vigente del titular (la misma regla del gate y del bot).
  if new.estado <> 'descartado' and (tg_op = 'INSERT' or new.estado is distinct from old.estado) then
    v_aut := public.autorizacion_datos_estado(new.workspace_id, new.contacto_id);
    if coalesce((v_aut -> 'vigente' ->> 'generales')::boolean, false) is not true then
      raise exception 'perfil_sin_autorizacion' using errcode = '23514';
    end if;
  end if;
  return new;
end;
$$;

revoke execute on function public.contacto_perfil_hechos_guardas() from public, anon, authenticated;

create trigger contacto_perfil_hechos_guardas
before insert or update on public.contacto_perfil_hechos
for each row execute function public.contacto_perfil_hechos_guardas();

-- Verificación tras aplicar (sin escribir):
--   select relrowsecurity, relacl from pg_class where oid = 'public.contacto_perfil_hechos'::regclass;
--     -> true; authenticated=arw (select, insert, update), sin anon
--   select has_function_privilege('anon', 'public.contacto_perfil_hechos_guardas()', 'execute');  -> false
-- Ledger: insert into supabase_migrations.schema_migrations (version, name)
--   values ('20261012234500', 'contacto_perfil_hechos');
