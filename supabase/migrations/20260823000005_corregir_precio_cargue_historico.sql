-- Corrige `precio_aprobado` de los negocios del cargue historico de SOENA.
--
-- El cargue `historico_iva_2026_07` leyo la columna de precio corrida tres filas
-- respecto de las columnas de identidad: `precio_aprobado` de ONE coincide con
-- `cargue_final.json[i+3].tarifa_con_iva` en 114 de 119 casos. El nombre, el
-- id_hubspot, la seccional y `fecha_cierre_sheet` quedaron en la fila correcta;
-- solo la plata se corrio, asi que 64 negocios cargan el precio de otro cliente.
--
-- El valor correcto es `TARIFA CON IVA` de la pestana CLIENTES del libro
-- " 2.0 CLIENTES VEHICULO" (1kkTlT-zmMewAYckhNvO9HquMInbQTh46Ygj28HiYoAY),
-- verificado el 2026-08-22 contra el snapshot de junio guardado en el repo:
-- las 116 tarifas comparables son identicas, el Sheet no cambio.
--
-- Ninguno de estos negocios tiene cobros registrados, asi que no hay imputacion
-- que rehacer. Sobre los 63 que ya tenian precio el neto es -$291.100: es una
-- permutacion dentro de un catalogo de ocho tarifas, no un error de magnitud.
-- El caso 64 es V0153, que no tiene precio en ONE; ahi no se corrige nada, se llena.
--
-- V0130 y V0234 quedan fuera a proposito: el Sheet los tiene en tarifa 0 y poner
-- cero borraria el unico precio que existe. Necesitan decision, no correccion mecanica.
--
-- Detalle caso por caso en proyectos/soena/ve/conciliacion-cargue-2026-08/.

do $$
declare
  ws_soena uuid := '7dea141d-d4da-483d-a78d-b14ef35500c5';
  corregidos int;
begin
  with correcto (codigo, precio) as (values
  ('V0131', 700000.00),
  ('V0132', 425000.00),
  ('V0133', 666400.00),
  ('V0134', 595000.00),
  ('V0135', 595000.00),
  ('V0136', 595000.00),
  ('V0137', 828996.50),
  ('V0139', 765000.00),
  ('V0140', 637500.00),
  ('V0141', 637500.00),
  ('V0143', 573750.00),
  ('V0144', 850000.00),
  ('V0148', 637500.00),
  ('V0149', 850000.00),
  ('V0153', 637500.00),
  ('V0154', 573750.00),
  ('V0155', 573750.00),
  ('V0156', 573750.00),
  ('V0159', 636998.50),
  ('V0165', 637500.00),
  ('V0166', 637500.00),
  ('V0167', 637500.00),
  ('V0168', 850000.00),
  ('V0169', 560000.00),
  ('V0170', 560000.00),
  ('V0171', 637500.00),
  ('V0172', 850000.00),
  ('V0173', 425000.00),
  ('V0174', 850000.00),
  ('V0176', 850000.00),
  ('V0177', 637500.00),
  ('V0178', 637500.00),
  ('V0179', 637500.00),
  ('V0180', 595000.00),
  ('V0181', 595000.00),
  ('V0185', 850000.00),
  ('V0186', 637500.00),
  ('V0189', 850000.00),
  ('V0190', 637500.00),
  ('V0196', 850000.00),
  ('V0200', 637500.00),
  ('V0203', 573750.00),
  ('V0204', 637500.00),
  ('V0205', 637500.00),
  ('V0208', 595000.00),
  ('V0209', 637500.00),
  ('V0210', 595000.00),
  ('V0211', 637500.00),
  ('V0212', 605625.00),
  ('V0214', 605625.00),
  ('V0218', 637500.00),
  ('V0221', 595000.00),
  ('V0224', 850000.00),
  ('V0225', 637500.00),
  ('V0227', 560000.00),
  ('V0230', 425000.00),
  ('V0233', 560000.00),
  ('V0235', 637500.00),
  ('V0238', 510000.00),
  ('V0239', 637500.00),
  ('V0242', 318000.00),
  ('V0243', 637500.00),
  ('V0244', 637500.00),
  ('V0245', 595000.00)
  )
  update negocios n
     set precio_aprobado = c.precio,
         metadata = n.metadata || jsonb_build_object(
           'precio_corregido', jsonb_build_object(
             'at', '2026-08-22',
             'anterior', n.precio_aprobado,
             'fuente', 'CLIENTES!U del libro 2.0 CLIENTES VEHICULO',
             'motivo', 'el cargue historico_iva_2026_07 leyo el precio corrido tres filas'
           )
         ),
         updated_at = now()
    from correcto c
   where n.codigo = c.codigo
     and n.workspace_id = ws_soena
     and n.metadata->>'fuente_cargue' = 'historico_iva_2026_07'
     and n.precio_aprobado is distinct from c.precio;

  get diagnostics corregidos = row_count;
  raise notice 'negocios corregidos: %', corregidos;

  if corregidos <> 64 then
    raise exception 'se esperaban 64 correcciones y se aplicaron %', corregidos;
  end if;
end $$;
