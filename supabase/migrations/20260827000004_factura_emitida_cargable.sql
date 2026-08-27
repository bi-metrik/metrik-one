-- "Factura emitida" pasa a ser cargable desde donde este el caso, no solo en Cargue.
-- YA APLICADA EN PRODUCCION el 2026-08-27 (13 configuraciones actualizadas).
--
-- El problema: hay negocios cuya factura se hizo ANTES de que ONE facturara. La
-- factura correcta existe, se baja de Siigo en PDF, y hay que meterla al expediente.
-- Pero el bloque solo es editable en su etapa nativa (Cargue, orden 7): en las 12
-- etapas siguientes vive como copia `estado = 'visible'`, o sea de solo lectura. Un
-- caso en Cobro o en Facturacion muestra el bloque y no recibe el archivo, y la unica
-- salida que quedaba era emitir una segunda factura por lo mismo.
--
-- `editable_siempre` es el flag que ya existe para exactamente esto: el bloque sigue
-- editable aunque su etapa haya pasado. Lo usan el RUT, el Certificado UPME y los
-- formularios 010/1668, por la misma razon (documentos que aparecen despues). El gate
-- de rol no cambia: supervisor, admin u owner.
--
-- Solo toca `config_extra` de 13 configuraciones de bloque de SOENA. No toca ningun
-- negocio, ningun dato de un caso ni nada que la DIAN haya visto.
do $$
declare
  ws_soena constant uuid := '7dea141d-d4da-483d-a78d-b14ef35500c5';
  tocados int;
begin
  update bloque_configs bc
     set config_extra = coalesce(bc.config_extra, '{}'::jsonb)
                        || jsonb_build_object('editable_siempre', true)
    from etapas_negocio e
    join lineas_negocio ln on ln.id = e.linea_id
   where e.id = bc.etapa_id
     and bc.workspace_id = ws_soena
     and ln.nombre = 'GIT EV/HEV'
     and bc.nombre = 'Factura emitida'
     and coalesce(bc.config_extra->>'editable_siempre', 'false') <> 'true';
  get diagnostics tocados = row_count;

  -- Una nativa (Cargue, con slug `factura_emitida`) y 12 copias visibles, de Pago UPME
  -- a Seguimiento. Idempotente: al reaplicarla ya estan todas en true y toca 0.
  if tocados not in (0, 13) then
    raise exception 'se esperaban 0 o 13 configuraciones de "Factura emitida" y se tocaron %', tocados;
  end if;
end $$;
