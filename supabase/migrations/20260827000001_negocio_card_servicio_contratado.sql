-- Servicio contratado visible en la tarjeta de negocio + filtro de la lista.
--
-- La tarjeta de /negocios ya lee campos de bloques por config
-- (`workspaces.config_extra.negocio_card`): vehiculo, cedula, radicado, factura.
-- Esta migracion agrega el mismo mecanismo para "que contrato el cliente", que en
-- SOENA decide por donde va el caso y cuanto trabajo implica:
--
--   completo   -> certificacion UPME + devolucion de IVA
--   solo_upme  -> solo certificacion UPME
--   solo_iva   -> solo devolucion de IVA
--
-- El dato ya existe: bloque "Servicio contratado" (etapa Negociacion), campo
-- `servicio`. Hasta ahora solo se veia abriendo el negocio.
--
-- `servicio_labels` mapea valor crudo -> etiqueta corta de la tarjeta. El FILTRO usa
-- el valor crudo, no la etiqueta: cambiar el rotulo no rompe enlaces guardados.
--
-- Solo toca SOENA. Los workspaces sin `servicio_bloque` no muestran chip ni filtro,
-- que es el mismo comportamiento que ya tienen con vehiculo, cedula y radicado.
do $$
declare
  ws_soena constant uuid := '7dea141d-d4da-483d-a78d-b14ef35500c5';
  actualizados int;
begin
  update workspaces w
     set config_extra = jsonb_set(
           coalesce(w.config_extra, '{}'::jsonb),
           '{negocio_card}',
           coalesce(w.config_extra -> 'negocio_card', '{}'::jsonb) || jsonb_build_object(
             'servicio_bloque', 'Servicio contratado',
             'servicio_campo', 'servicio',
             'servicio_labels', jsonb_build_object(
               'completo',  'Completo',
               'solo_iva',  'Solo IVA',
               'solo_upme', 'Solo certificado'
             )
           ),
           true
         )
   where w.id = ws_soena;

  get diagnostics actualizados = row_count;
  if actualizados <> 1 then
    raise exception 'se esperaba actualizar 1 workspace (SOENA) y se actualizaron %', actualizados;
  end if;

  -- El bloque tiene que existir con ESE nombre: la lectura de la tarjeta empareja
  -- por `bloque_configs.nombre` (funcion `negocio_bloques_campos`). Si alguien lo
  -- renombra, el chip se apaga en silencio — mejor fallar aqui.
  if not exists (
    select 1 from bloque_configs
     where workspace_id = ws_soena and nombre = 'Servicio contratado'
  ) then
    raise exception 'SOENA no tiene un bloque_config llamado "Servicio contratado"';
  end if;
end $$;
