-- ============================================================
-- El asistente público solo atiende en vivo con una versión que pasó su banco (encargo 2026-10-30, versiones con banco)
-- ------------------------------------------------------------
-- Hasta hoy, `asistente_publicar_rol` (20261026183000) exigía el banco pass^k para los roles, pero el reglamento de
-- siempre del asistente público (bot `asistente-publico`) se publicaba sin él: en producción, las 6 versiones de
-- Dimpro (29 y 30-oct) no tienen banco. Publicar sin banco se sigue pudiendo (es el ensayo); lo que cambia es dónde
-- llega a un cliente:
--   · `bot_banco_valido(banco, fichas)`: el mismo criterio de `asistente_publicar_rol` (pasa, k >= 3, fecha, huella)
--     y además que la huella sea la de ESAS fichas. Pura.
--   · `banco_valido(bot_reglamentos)`: la misma, como columna calculada de PostgREST. `chatwoot-agente` la pide al
--     leer la versión y, sin banco válido, el turno pasa a una persona (`turno-con-rol.ts`).
--   · disparador en `workspaces`: prender `config_extra.bot_conversacional.chatwoot.activo` exige que la versión
--     vigente (la del puntero `reglamento_id`, o la última) tenga banco válido. Con roles en el canal `chatwoot` no
--     se mira: esas versiones ya pasaron su banco al publicarse.
-- No toca datos: ninguna versión ni configuración existente cambia. Un workspace que ya estuviera prendido no se
-- apaga aquí; si su versión no tiene banco, desde el despliegue sus turnos pasan a una persona.
-- ============================================================

create or replace function public.bot_banco_valido(p_banco jsonb, p_fichas jsonb) returns boolean
language sql
immutable
set search_path = public
as $$
  select case
    when p_banco is null or jsonb_typeof(p_banco) <> 'object' then false
    when p_banco->'pasa' is distinct from 'true'::jsonb then false
    when jsonb_typeof(p_banco->'k') is distinct from 'number' then false
    when (p_banco->>'k')::numeric < 3 then false
    when coalesce(p_banco->>'fecha', '') = '' then false
    when coalesce(p_banco->>'huella_fichas', '') !~ '^[0-9a-f]{64}$' then false
    else public.asistente_huella_fichas(coalesce(p_fichas, '[]'::jsonb)) = p_banco->>'huella_fichas'
  end;
$$;

revoke execute on function public.bot_banco_valido(jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.bot_banco_valido(jsonb, jsonb) to service_role;

-- Columna calculada: `select('id, version, huella, fichas, banco_valido')` sobre `bot_reglamentos`.
create or replace function public.banco_valido(r public.bot_reglamentos) returns boolean
language sql
stable
set search_path = public
as $$
  select public.bot_banco_valido(r.banco, r.fichas);
$$;

revoke execute on function public.banco_valido(public.bot_reglamentos) from public, anon, authenticated;
grant execute on function public.banco_valido(public.bot_reglamentos) to service_role;

create or replace function public.asistente_publico_prender_exige_banco() returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_antes boolean := false;
  v_puntero text;
  v_r public.bot_reglamentos%rowtype;
begin
  if (new.config_extra #> '{bot_conversacional,chatwoot,activo}') is distinct from 'true'::jsonb then
    return new;
  end if;
  if tg_op = 'UPDATE' then
    v_antes := (old.config_extra #> '{bot_conversacional,chatwoot,activo}') is not distinct from 'true'::jsonb;
  end if;
  if v_antes then
    return new;
  end if;

  -- Con roles en el canal, el reglamento de siempre no atiende a nadie (`turnoPublico`): manda el banco del rol.
  if exists (select 1 from public.asistente_roles where workspace_id = new.id and canal = 'chatwoot') then
    return new;
  end if;

  -- La versión vigente, como la lee `chatwoot-agente`: la del puntero si hay uno, si no la última publicada.
  v_puntero := nullif(new.config_extra #>> '{bot_conversacional,chatwoot,reglamento_id}', '');
  if v_puntero is not null then
    select * into v_r from public.bot_reglamentos
    where id::text = v_puntero and workspace_id = new.id and bot = 'asistente-publico';
  else
    select * into v_r from public.bot_reglamentos
    where workspace_id = new.id and bot = 'asistente-publico'
    order by version desc limit 1;
  end if;

  if not found then
    raise exception using errcode = '23514',
      message = 'el asistente publico no se prende: no hay una version publicada de asistente-publico'
        || case when v_puntero is not null then ' con el id del puntero reglamento_id' else '' end;
  end if;
  if not public.bot_banco_valido(v_r.banco, v_r.fichas) then
    raise exception using errcode = '23514',
      message = format('el asistente publico no se prende con la version %s: no tiene un banco del arnes que pase (pasa, k >= 3, fecha y la huella de sus fichas)', v_r.version),
      hint = 'corre el arnes del publico con --k 3 y publica con bot_publicar_reglamento(workspace, ''asistente-publico'', quien, banco)';
  end if;
  return new;
end;
$$;

revoke execute on function public.asistente_publico_prender_exige_banco() from public, anon, authenticated;

drop trigger if exists asistente_publico_prender_exige_banco on public.workspaces;
create trigger asistente_publico_prender_exige_banco
  before insert or update of config_extra on public.workspaces
  for each row execute function public.asistente_publico_prender_exige_banco();
