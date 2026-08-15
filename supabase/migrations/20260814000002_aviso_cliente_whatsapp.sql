-- El trigger de entrada a etapa también despacha cuando el aviso al cliente pide
-- WHATSAPP, no solo correo.
--
-- Sin esto, una etapa que declare `avisar_al_cliente = {"whatsapp": true}` y nada más
-- NO dispara la edge function: `v_cliente` se calcula mirando únicamente la clave
-- `email`, así que el guard de salida corta antes. El interruptor de `/flujo` quedaría
-- encendido sin efecto — exactamente la pantalla que miente que la migración
-- 20260813000003 vino a evitar, entrando por la puerta de al lado.
--
-- Un solo reemplazo, sobre la definición VIGENTE volcada de la base y contado. La
-- función cuelga del UPDATE de `negocios.etapa_actual_id`: transcribirla de memoria
-- rompería el avance de etapa en producción, y en este repo ya pasó dos veces.

do $$
declare
  v_def text;
  v_reemplazos int := 0;

  v_viejo constant text :=
    'v_cliente := coalesce((v_cfg_cliente ->> ''email'')::boolean, false);';
  v_nuevo constant text :=
    'v_cliente := coalesce((v_cfg_cliente ->> ''email'')::boolean, false)'
    || ' or coalesce((v_cfg_cliente ->> ''whatsapp'')::boolean, false);';
begin
  select pg_get_functiondef(p.oid) into v_def
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname = 'avisar_entrada_etapa';

  if v_def is null then raise exception 'avisar_entrada_etapa no existe'; end if;

  if position('whatsapp' in v_def) > 0 then
    raise notice 'ya despacha el aviso por whatsapp; sin cambios';
    return;
  end if;

  if position(v_viejo in v_def) = 0 then
    raise exception 'no se encontro el calculo de v_cliente esperado';
  end if;
  v_def := replace(v_def, v_viejo, v_nuevo);
  v_reemplazos := v_reemplazos + 1;

  if v_reemplazos <> 1 then
    raise exception 'se esperaba 1 reemplazo y se aplicaron %', v_reemplazos;
  end if;

  execute v_def;
end $$;
