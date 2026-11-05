-- SOE-041 · La Factura del vehículo extrae el descuento y el código hace la resta.
--
-- NO es una migración: escribe la CONFIG del bloque «Factura Venta Vehículo» de SOENA y no se aplica
-- sola al desplegar. La corre Mauricio (o la sesión principal con su «autorizo escribir en soena»)
-- DESPUÉS del deploy del PR de SOE-041: sin ese código, `derivar` y `coherencia_pct` se ignoran y
-- los dos campos nuevos solo se leerían.
--
-- Qué hace, sobre bloque_configs f2227f75-37e0-4ff9-8e78-0038f0c9c4c6 (workspace SOENA):
--   1. Respalda config_extra en public.backup_factura_descuento_20261105.
--   2. Agrega `valor_antes_descuento` y `descuento` (currency, required false) justo después de
--      `valor_unitario_sin_iva`.
--   3. `valor_unitario_sin_iva.derivar = { resta: [valor_antes_descuento, descuento] }`.
--   4. `valor_iva.coherencia_pct = { de: [valor_unitario_sin_iva, valor_antes_descuento],
--      pct: [0.05, 0.19], tolerancia: 0.002 }`.
--   El resto (orden, textos, demás llaves de config_extra) queda intacto, y se verifica.
--
-- MODO: por defecto es DRY-RUN (v_aplicar := false): hace todo, verifica y termina con
-- RAISE EXCEPTION, que deshace todo, incluido el respaldo. Para aplicar: v_aplicar := true.
-- Idempotente: si los campos ya existen, no hace nada.
--
-- Solo cambia lo que se lea DE AQUÍ EN ADELANTE. Los documentos ya leídos no se tocan (reprocesar
-- borra correcciones a mano: fuera de alcance).
--
-- Reversa:
--   update public.bloque_configs b set config_extra = r.config_extra
--     from public.backup_factura_descuento_20261105 r where b.id = r.id;

do $$
declare
  v_aplicar boolean := false;   -- ← true para aplicar
  v_id uuid := 'f2227f75-37e0-4ff9-8e78-0038f0c9c4c6';
  v_ws uuid := '7dea141d-d4da-483d-a78d-b14ef35500c5';
  v_ce jsonb;
  v_campos jsonb;
  v_nuevos jsonb := '[]'::jsonb;
  v_c jsonb;
  v_antes int;
  v_despues int;
  v_tocados int := 0;
  v_resto_igual boolean;
  v_valor_antes jsonb := jsonb_build_object(
    'slug', 'valor_antes_descuento',
    'tipo', 'currency',
    'label', 'Valor antes de descuento',
    'required', false,
    'descripcion_ai', 'Valor del vehículo antes de impuestos y ANTES del descuento, tal como aparece impreso en la factura (rótulos como "Precio lista", "Precio de lista", "Valor vehículo", "Valor unitario", "Precio unitario", "Precio de venta sin impuestos", "Total bruto"). Solo el vehículo: no incluir accesorios, planes de servicio, seguros, fletes, financiación ni matrícula. No restar ni sumar nada: transcribir el número tal como aparece. Solo números sin puntos ni comas.'
  );
  v_descuento jsonb := jsonb_build_object(
    'slug', 'descuento',
    'tipo', 'currency',
    'label', 'Descuento',
    'required', false,
    'descripcion_ai', 'Descuento sobre el vehículo, en pesos. Puede venir rotulado ("Descuento", "Desc. producto", "Descuentos", "% Dto", "Descuento Global") o implícito: si el valor unitario del vehículo es mayor que el valor total de su línea, el descuento es la diferencia. Si no hay descuento, devolver 0. No restar ni sumar nada más: transcribir. Solo números sin puntos ni comas.'
  );
begin
  select config_extra into v_ce
    from public.bloque_configs
   where id = v_id and workspace_id = v_ws
   for update;
  if v_ce is null then
    raise exception 'no existe el bloque % en el workspace SOENA', v_id;
  end if;

  v_campos := v_ce->'campos_extraccion';
  v_antes := jsonb_array_length(v_campos);

  if exists (select 1 from jsonb_array_elements(v_campos) e where e->>'slug' in ('valor_antes_descuento', 'descuento')) then
    raise notice 'los campos ya existen: no se hace nada';
    return;
  end if;
  if (select count(*) from jsonb_array_elements(v_campos) e where e->>'slug' in ('valor_unitario_sin_iva', 'valor_iva')) <> 2 then
    raise exception 'faltan valor_unitario_sin_iva o valor_iva en la config viva';
  end if;

  for v_c in select t.e from jsonb_array_elements(v_campos) with ordinality as t(e, i) order by t.i loop
    if v_c->>'slug' = 'valor_unitario_sin_iva' then
      v_nuevos := v_nuevos
        || jsonb_build_array(v_c || jsonb_build_object('derivar', jsonb_build_object(
             'resta', jsonb_build_array('valor_antes_descuento', 'descuento'))))
        || jsonb_build_array(v_valor_antes, v_descuento);
      v_tocados := v_tocados + 1;
    elsif v_c->>'slug' = 'valor_iva' then
      v_nuevos := v_nuevos || jsonb_build_array(v_c || jsonb_build_object('coherencia_pct', jsonb_build_object(
        'de', jsonb_build_array('valor_unitario_sin_iva', 'valor_antes_descuento'),
        'pct', jsonb_build_array(0.05, 0.19),
        'tolerancia', 0.002)));
      v_tocados := v_tocados + 1;
    else
      v_nuevos := v_nuevos || jsonb_build_array(v_c);
    end if;
  end loop;

  v_despues := jsonb_array_length(v_nuevos);

  -- Verificaciones: dos campos más; los demás, idénticos y en el mismo orden.
  if v_tocados <> 2 or v_despues <> v_antes + 2 then
    raise exception 'conteo inesperado: antes %, después %, tocados %', v_antes, v_despues, v_tocados;
  end if;
  select bool_and(a.e = b.e) and count(*) = v_antes - 2 into v_resto_igual
    from (select t.e, row_number() over (order by t.i) as n
            from jsonb_array_elements(v_campos) with ordinality as t(e, i)
           where t.e->>'slug' not in ('valor_unitario_sin_iva', 'valor_iva')) a
    join (select t.e, row_number() over (order by t.i) as n
            from jsonb_array_elements(v_nuevos) with ordinality as t(e, i)
           where t.e->>'slug' not in ('valor_unitario_sin_iva', 'valor_iva', 'valor_antes_descuento', 'descuento')) b
      using (n);
  if not coalesce(v_resto_igual, false) then
    raise exception 'el resto de los campos no quedó idéntico';
  end if;

  -- server-only: respaldo manual, solo lo lee service_role.
  create table if not exists public.backup_factura_descuento_20261105 (
    id uuid primary key,
    config_extra jsonb not null,
    respaldado_en timestamptz not null default now()
  );
  alter table public.backup_factura_descuento_20261105 enable row level security;
  revoke all on public.backup_factura_descuento_20261105 from public, anon, authenticated;
  insert into public.backup_factura_descuento_20261105 (id, config_extra)
  values (v_id, v_ce)
  on conflict (id) do nothing;

  update public.bloque_configs
     set config_extra = jsonb_set(v_ce, '{campos_extraccion}', v_nuevos)
   where id = v_id and workspace_id = v_ws;

  if (select jsonb_array_length(config_extra->'campos_extraccion') from public.bloque_configs where id = v_id) <> v_antes + 2
     or (select config_extra - 'campos_extraccion' from public.bloque_configs where id = v_id) <> (v_ce - 'campos_extraccion') then
    raise exception 'la config guardada no es la esperada';
  end if;

  if not v_aplicar then
    raise exception 'DRY-RUN OK (se deshace todo): campos antes %, después %. Orden: %', v_antes, v_despues,
      (select string_agg(t.e->>'slug', ', ' order by t.i) from jsonb_array_elements(v_nuevos) with ordinality as t(e, i));
  end if;
  raise notice 'APLICADO: campos antes %, después %', v_antes, v_despues;
end;
$$;
