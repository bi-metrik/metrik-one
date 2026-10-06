-- Una entrada REPETIDA a la misma etapa en minutos no vuelve a avisar (brief del doble
-- guardado, 2026-10-06).
--
-- POR QUÉ. `avisar_entrada_etapa` cuelga de CADA cambio de `negocios.etapa_actual_id`. Si el
-- caso entra a la misma etapa dos veces en poco tiempo (va y vuelve: un avance, un retorno por
-- corrección, otro avance), el trigger dispara dos veces y avisa dos veces: la campana del equipo
-- (`negocio_en_etapa`, 183 pares medidos, 51 en los últimos 30 días, a ~68 s uno del otro) y,
-- si la etapa lo declara, el correo interno y el correo/WhatsApp AL CLIENTE vía `notificar-etapa`.
-- Un WhatsApp no se desmanda.
--
-- QUÉ CAMBIA. Antes de crear avisos, el trigger mira si esta MISMA etapa ya avisó por este
-- negocio en los últimos 10 minutos: una notificación `negocio_en_etapa` con ese `etapa_id`, o
-- una fila de `avisos_cliente` de esa etapa (no de bloque). Si la hay, no avisa nada, ni al
-- equipo ni al cliente. Una re-entrada días después (una devolución) sigue avisando como hoy: esa
-- la gobierna `omitir_si_bloque_completo` (20260825000001).
--
-- LÍMITE. Dos entradas en la MISMA transacción, o dos transacciones que se cruzan en
-- milisegundos, no se ven entre sí. El patrón medido es de decenas de segundos.
--
-- CÓMO. Igual que 20260902000004: NO se reescribe la función (cuelga del avance de etapa; una
-- copia mal transcrita rompe producción). Se toma la definición VIVA, se inserta la guarda tras
-- una línea ancla que debe aparecer exactamente una vez, y si no, aborta sin tocar nada.

do $$
declare
  v_def text;
  v_ancla text := 'if coalesce((v_cfg ->> ''activo'')::boolean, true) = false then return new; end if;';
  v_guarda text := v_ancla || '

  -- Doble guardado (2026-10-06): esta misma etapa ya avisó por este negocio hace minutos.
  if exists (
    select 1 from notificaciones n
    where n.entidad_id = new.id
      and n.tipo = ''negocio_en_etapa''
      and n.metadata ->> ''etapa_id'' = new.etapa_actual_id::text
      and n.created_at > now() - interval ''10 minutes''
  ) or exists (
    select 1 from avisos_cliente a
    where a.negocio_id = new.id
      and a.etapa_id = new.etapa_actual_id
      and a.bloque_config_id is null
      and a.created_at > now() - interval ''10 minutes''
  ) then
    return new;
  end if;';
  v_n integer;
begin
  select pg_get_functiondef(p.oid) into v_def
  from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
  where ns.nspname = 'public' and p.proname = 'avisar_entrada_etapa';

  if v_def is null then
    raise exception 'ABORTA: no existe public.avisar_entrada_etapa';
  end if;

  -- Idempotente: si la guarda ya está, no hay nada que hacer.
  if position('Doble guardado (2026-10-06)' in v_def) > 0 then
    raise notice 'avisar_entrada_etapa ya tiene la guarda de minutos, sin cambios';
    return;
  end if;

  v_n := (length(v_def) - length(replace(v_def, v_ancla, ''))) / length(v_ancla);
  if v_n <> 1 then
    raise exception 'ABORTA: se esperaba 1 ocurrencia del ancla, hay %', v_n;
  end if;

  execute replace(v_def, v_ancla, v_guarda);

  select pg_get_functiondef(p.oid) into v_def
  from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
  where ns.nspname = 'public' and p.proname = 'avisar_entrada_etapa';
  if position('Doble guardado (2026-10-06)' in v_def) = 0 then
    raise exception 'ABORTA: la guarda no quedó en la función desplegada';
  end if;
end $$;

-- `create or replace` (dentro del execute) la deja otra vez ejecutable por PUBLIC.
revoke execute on function public.avisar_entrada_etapa() from public, anon;

-- La guarda corre en CADA cambio de etapa: tiene que ser barata a cualquier escala.
-- `avisos_cliente_negocio_idx (negocio_id, created_at desc)` ya cubre la segunda pregunta. Para la
-- primera, `idx_notificaciones_dedup` solo mira pendientes: se agrega uno por entidad y tipo.
create index if not exists idx_notificaciones_entidad_tipo_creada
  on public.notificaciones (entidad_id, tipo, created_at desc);
