-- Cargue de los 7 cobros historicos de SOENA que quedaron fuera del cargue del 2026-08-24.
--
-- Origen: hoja CONTABILIDAD del libro "2.0 CLIENTES VEHICULO" de SOENA.
-- Los 7 estaban frenados por dos razones, ambas resueltas con evidencia interna:
--
--  a) V0139, V0174 y V0196: la referencia del segundo pago venia escrita en notacion
--     cientifica (3.78264968E8). Son los 9 digitos completos, sin truncar, y cada una
--     encaja en la serie cronologica de referencias ePayco ya cargadas para esa fecha.
--     El abono de estos tres ya entro en 20260824000002.
--
--  b) V0138, V0153, V0155 y V0238: dos filas del Sheet apuntaban al mismo cliente. El
--     Id de HubSpot desempata: una de las dos coincide exacto con el del negocio en ONE.
--     Se verifico contra produccion que los Id de las otras cuatro filas (57553843087,
--     60177467699, 58560143209, 57021726131) no existen bajo ningun codigo, es decir,
--     son negocios que nunca se crearon. Quedan reportados a SOENA aparte.
--
-- Las referencias #341862510 (V0138) y #350743855 (V0155) aparecen tambien en la fila del
-- negocio que no existe en ONE. No se marcan como reparto porque el negocio hermano no
-- existe todavia; queda anotado en las notas del cobro.
--
-- Cada cobro cierra exacto contra el techo de honorario del negocio: no genera excedente.

do $$
declare
  ws_soena uuid := '7dea141d-d4da-483d-a78d-b14ef35500c5';
  creados int;
begin
  with e (codigo, monto, fecha, tipo, ref, nota_extra) as (values
    -- segundos pagos con la referencia recuperada del formato numerico
    ('V0139', 382500.00, '2026-07-27', 'pago',     '378264968', null),
    ('V0174', 425000.00, '2026-06-02', 'pago',     '369562282', null),
    ('V0196', 425000.00, '2026-07-07', 'pago',     '375256776', null),
    -- abonos desempatados por Id de HubSpot
    ('V0138', 637500.00, '2026-03-04', 'anticipo', '341862510',
       ' La misma referencia aparece en una segunda fila del Sheet (HubSpot 57553843087) cuyo negocio no existe en ONE.'),
    ('V0153', 637500.00, '2026-03-27', 'anticipo', '350365708', null),
    ('V0155', 573750.00, '2026-03-30', 'anticipo', '350743855',
       ' La misma referencia aparece en una segunda fila del Sheet (HubSpot 58560143209) cuyo negocio no existe en ONE.'),
    ('V0238', 510000.00, '2026-06-10', 'anticipo', '370687485', null)
  )
  insert into cobros (workspace_id, negocio_id, monto, fecha, tipo_cobro, external_ref,
                      fuente, canal_registro, notas)
  select n.workspace_id,
         n.id,
         e.monto::numeric,
         e.fecha::date,
         e.tipo,
         e.ref,
         'epayco',
         'app',
         'Cargue historico desde el Sheet de SOENA (2026-08-24, recuperados). Referencia ePayco #'
           || e.ref || coalesce(e.nota_extra, '')
    from e
    join negocios n
      on n.codigo = e.codigo
     and n.workspace_id = ws_soena
   where not exists (
           select 1 from cobros c
            where c.negocio_id = n.id
              and c.external_ref = e.ref
         );

  get diagnostics creados = row_count;

  if creados <> 7 then
    raise exception 'se esperaban 7 cobros y se crearon %', creados;
  end if;
end $$;
