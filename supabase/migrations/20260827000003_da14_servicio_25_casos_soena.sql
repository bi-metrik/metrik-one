-- Cargue del servicio contratado (bloque DA14 "Servicio contratado") en 25 negocios
-- abiertos de SOENA que lo tenian vacio. YA APLICADA EN PRODUCCION el 2026-08-27.
--
-- De donde sale el dato: columna "Servicio Adquirido" del Google Sheet
-- `2.0 CLIENTES VEHÍCULO` (fileId 1kkTlT-zmMewAYckhNvO9HquMInbQTh46Ygj28HiYoAY),
-- leido el 2026-08-27. El cruce se hizo por id de HubSpot y, para los casos nuevos,
-- por codigo de ONE: esa columna del Sheet cambio de contenido a mitad de camino y
-- para V0047, V0076 y V0253 trae el codigo, no el id. Las cuatro pestanas donde
-- aparece cada caso (CLIENTES, OPERACIONES UPME, OPEREACION DIAN, CONTABILIDAD)
-- dicen lo mismo: cero contradicciones.
--
-- Por que no reescribe ninguna decision de enrutamiento: los 24 `completo` estan en
-- Cita o Generacion, etapas del lado DIAN que solo se recorren cuando hay devolucion
-- de IVA. El unico `solo_upme` (V0253) esta en Facturacion y nunca paso por DIAN. El
-- dato confirma la ruta que cada caso ya tomo; no la cambia.
--
-- Detalle caso por caso en `proyectos/soena/ve/2026-08-27_25-casos-sin-servicio-resueltos.md`.
do $$
declare
  ws_soena  constant uuid := '7dea141d-d4da-483d-a78d-b14ef35500c5';
  cfg_da14  constant uuid := '20ede2cd-9647-4c8f-b149-fd49be53620e';
  actualizados int; insertados int;
begin
  create temp table _da14 (codigo text primary key, servicio text) on commit drop;
  insert into _da14 values
    ('V0047','completo'),('V0076','completo'),('V0131','completo'),('V0137','completo'),
    ('V0151','completo'),('V0160','completo'),('V0161','completo'),('V0165','completo'),
    ('V0171','completo'),('V0186','completo'),('V0198','completo'),('V0200','completo'),
    ('V0202','completo'),('V0207','completo'),('V0210','completo'),('V0213','completo'),
    ('V0227','completo'),('V0230','completo'),('V0241','completo'),('V0244','completo'),
    ('V0246','completo'),('V0248','completo'),('V0253','solo_upme'),('V0348','completo'),
    ('V0403','completo');

  -- 23 casos ya tenian la fila del bloque creada y vacia.
  update negocio_bloques nb
     set data = coalesce(nb.data,'{}'::jsonb) || jsonb_build_object('servicio', d.servicio),
         estado = 'completo',
         completado_at = coalesce(nb.completado_at, now()),
         updated_at = now()
    from _da14 d
    join negocios n on n.codigo = d.codigo and n.workspace_id = ws_soena
   where nb.negocio_id = n.id
     and nb.bloque_config_id = cfg_da14
     and coalesce(nb.data->>'servicio', nb.data->'campos'->>'servicio') is null;
  get diagnostics actualizados = row_count;

  -- V0348 y V0403 ni siquiera tenian la fila.
  insert into negocio_bloques (negocio_id, bloque_config_id, estado, data, completado_at)
  select n.id, cfg_da14, 'completo', jsonb_build_object('servicio', d.servicio), now()
    from _da14 d
    join negocios n on n.codigo = d.codigo and n.workspace_id = ws_soena
   where not exists (
     select 1 from negocio_bloques nb
      where nb.negocio_id = n.id and nb.bloque_config_id = cfg_da14);
  get diagnostics insertados = row_count;

  -- Idempotente: al reaplicarla los 25 ya tienen valor y no se toca nada.
  if actualizados + insertados not in (0, 25) then
    raise exception 'se esperaban 0 o 25 bloques y se tocaron % (update %, insert %)',
      actualizados + insertados, actualizados, insertados;
  end if;
end $$;
