-- Funciones (Sabor, etapa 2): el plazo del saldo puede ser «hasta que empieza la función» (dias_saldo_antes = 0).
--
-- Por qué (Mauricio, 26-oct, P16 del diseño §1.11 punto 5): «lo que se quiere es que todo el mundo llegue con la
-- función totalmente paga». El aviso del saldo sale unas 3 horas antes de la función, y el servidor tiene que poder
-- generar el link a esa hora. Con 1 o más días, después del plazo `funcion_preparar_pago_saldo` le responde
-- `saldo_vencido` al servidor. Con 0, el plazo es la hora de inicio: el link vale hasta que empieza la función y
-- después responde `funcion_pasada` (se cobra en el evento con el QR de Bold y [Saldo cobrado]).
--
-- Qué cambia, y nada más:
--   · Los checks de `funcion_campanas.dias_saldo_antes` y de su foto en `funcion_reservas` pasan de 1..30 a 0..30
--     (mismos nombres). El default sigue en 1.
--   · `funcion_plazo_saldo(t, 0)` = t. Con 1 o más, la misma regla de antes (inicio del día de Bogotá siguiente al
--     que queda p_dias antes).
--   · `funcion_guardar_campana` acepta 0 (copia de la versión de 20261022170000; solo cambia el rango).
-- No cambia datos: sin UPDATE, INSERT ni DELETE. Ensanchar el rango no deja ninguna fila fuera.
-- Depende de 20261022170000_modulo_funciones.sql (aplicada el 26-oct).

-- ── 1. Los dos checks: de 0 a 30 ──
-- Son checks de columna, así que Postgres les dio el nombre `<tabla>_<columna>_check`. Sin `if exists`: si el nombre no
-- es ese, la migración falla en vez de dejar dos checks.
alter table public.funcion_campanas
  drop constraint funcion_campanas_dias_saldo_antes_check,
  add constraint funcion_campanas_dias_saldo_antes_check check (dias_saldo_antes between 0 and 30);

alter table public.funcion_reservas
  drop constraint funcion_reservas_dias_saldo_antes_check,
  add constraint funcion_reservas_dias_saldo_antes_check check (dias_saldo_antes between 0 and 30);

-- ── 2. El fin del plazo del saldo ──
-- Con 0: la hora de inicio de la función. Con 1 o más: el primer instante del día de Bogotá siguiente al que queda
-- `p_dias` antes de la función (igual que antes).
create or replace function public.funcion_plazo_saldo(p_inicia_at timestamptz, p_dias integer)
returns timestamptz
language sql
stable
set search_path = public
as $$
  select case
    when p_dias = 0 then p_inicia_at
    else (((p_inicia_at at time zone 'America/Bogota')::date - p_dias + 1)::timestamp) at time zone 'America/Bogota'
  end;
$$;

revoke execute on function public.funcion_plazo_saldo(timestamptz, integer) from public, anon, authenticated, service_role;

-- ── 3. Guardar la campaña acepta 0 ──
-- Crea (p_campana_id nulo) o edita una campaña. `p_precios` = {precio_persona, precio_preventa_persona, abono_persona,
-- permite_pago_total, tope_sobreventa, dias_saldo_antes} (`dias_saldo_antes`: entero de 0 a 30, 0 = hasta que empieza
-- la función; ausente o nulo = 1). El código se guarda en mayúsculas y no cambia después de publicar. `activa` solo con
-- la agenda publicada (para eso está `funcion_publicar_agenda`).
create or replace function public.funcion_guardar_campana(
  p_workspace_id uuid,
  p_campana_id uuid,
  p_experiencia_id uuid,
  p_nombre text,
  p_codigo text,
  p_desde date,
  p_hasta date,
  p_estado text,
  p_minutos_apartado integer,
  p_precios jsonb
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_nombre text := nullif(btrim(coalesce(p_nombre, '')), '');
  v_codigo text := upper(btrim(coalesce(p_codigo, '')));
  v_estado text := coalesce(p_estado, 'borrador');
  v_precio integer;
  v_preventa integer;
  v_abono integer;
  v_permite boolean;
  v_dias integer := 1;
  v_publicada timestamptz;
  v_id uuid;
begin
  if public.funcion_actor(p_workspace_id, true, 'campana_no_existe') <> 'equipo' then
    raise exception 'sin_permiso' using errcode = 'P0001';
  end if;
  if v_nombre is null or length(v_nombre) > 200 then
    raise exception 'datos_invalidos' using errcode = 'P0001', detail = 'nombre';
  end if;
  if v_codigo !~ '^[A-Z0-9][A-Z0-9-]{1,19}$' then
    raise exception 'codigo_invalido' using errcode = 'P0001',
      detail = 'Entre 2 y 20 letras, números o guiones, sin espacios (por ejemplo HP-OCT26).';
  end if;
  if v_estado not in ('borrador', 'activa', 'pausada', 'cerrada') then
    raise exception 'datos_invalidos' using errcode = 'P0001', detail = 'estado';
  end if;
  if p_minutos_apartado is not null and (p_minutos_apartado < 1 or p_minutos_apartado > 10080) then
    raise exception 'datos_invalidos' using errcode = 'P0001', detail = 'minutos_apartado';
  end if;
  if p_desde is not null and p_hasta is not null and p_hasta < p_desde then
    raise exception 'datos_invalidos' using errcode = 'P0001', detail = 'fechas';
  end if;
  if not exists (select 1 from public.funcion_experiencias where id = p_experiencia_id and workspace_id = p_workspace_id) then
    raise exception 'experiencia_no_existe' using errcode = 'P0001';
  end if;
  perform public.funcion_validar_precios(p_precios, array['precio_persona', 'precio_preventa_persona', 'abono_persona', 'permite_pago_total', 'tope_sobreventa', 'dias_saldo_antes']);
  if p_precios ? 'dias_saldo_antes' and jsonb_typeof(p_precios->'dias_saldo_antes') <> 'null' then
    if jsonb_typeof(p_precios->'dias_saldo_antes') <> 'number' or (p_precios->>'dias_saldo_antes') !~ '^[0-9]{1,2}$'
       or (p_precios->>'dias_saldo_antes')::integer not between 0 and 30 then
      raise exception 'dias_saldo_invalido' using errcode = 'P0001', detail = p_precios->>'dias_saldo_antes';
    end if;
    v_dias := (p_precios->>'dias_saldo_antes')::integer;
  end if;
  v_precio := public.funcion_precio_de(p_precios, 'precio_persona');
  v_preventa := public.funcion_precio_de(p_precios, 'precio_preventa_persona');
  v_abono := public.funcion_precio_de(p_precios, 'abono_persona');
  v_permite := coalesce((p_precios->>'permite_pago_total')::boolean, true);
  if exists (select 1 from public.funcion_campanas
              where workspace_id = p_workspace_id and codigo = v_codigo and id is distinct from p_campana_id) then
    raise exception 'codigo_repetido' using errcode = 'P0001', detail = v_codigo;
  end if;

  if p_campana_id is null then
    if v_estado = 'activa' then
      raise exception 'campana_no_publicada' using errcode = 'P0001', detail = 'Se activa al publicar la agenda.';
    end if;
    insert into public.funcion_campanas (workspace_id, experiencia_id, nombre, codigo, desde, hasta, estado,
      minutos_apartado, precio_persona, precio_preventa_persona, abono_persona, permite_pago_total, tope_sobreventa,
      dias_saldo_antes)
    values (p_workspace_id, p_experiencia_id, v_nombre, v_codigo, p_desde, p_hasta, v_estado,
      p_minutos_apartado, v_precio, v_preventa, v_abono, v_permite, public.funcion_precio_de(p_precios, 'tope_sobreventa'),
      v_dias)
    returning id into v_id;
  else
    select agenda_publicada_at into v_publicada from public.funcion_campanas
     where id = p_campana_id and workspace_id = p_workspace_id and archivada_at is null
     for update;
    if not found then
      raise exception 'campana_no_existe' using errcode = 'P0001';
    end if;
    if v_estado = 'activa' and v_publicada is null then
      raise exception 'campana_no_publicada' using errcode = 'P0001', detail = 'Se activa al publicar la agenda.';
    end if;
    update public.funcion_campanas
       set experiencia_id = p_experiencia_id, nombre = v_nombre, codigo = v_codigo, desde = p_desde, hasta = p_hasta,
           estado = v_estado, minutos_apartado = p_minutos_apartado, precio_persona = v_precio,
           precio_preventa_persona = v_preventa, abono_persona = v_abono, permite_pago_total = v_permite,
           tope_sobreventa = public.funcion_precio_de(p_precios, 'tope_sobreventa'), dias_saldo_antes = v_dias
     where id = p_campana_id;
    v_id := p_campana_id;
  end if;
  return v_id;
end;
$$;

-- ejecutable-por-cliente: el panel del equipo, con su sesión. SECURITY DEFINER; exige el workspace y rol que edite.
revoke execute on function public.funcion_guardar_campana(uuid, uuid, uuid, text, text, date, date, text, integer, jsonb) from public, anon, service_role;
grant execute on function public.funcion_guardar_campana(uuid, uuid, uuid, text, text, date, date, text, integer, jsonb) to authenticated;
