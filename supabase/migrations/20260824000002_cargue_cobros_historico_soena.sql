-- Cargue historico de cobros de SOENA desde el Sheet " 2.0 CLIENTES VEHICULO".
--
-- Los negocios del cargue `historico_iva_2026_07` entraron a ONE con su precio pero sin
-- un solo cobro: se vendieron y se cobraron antes de que ONE operara. El primer cobro que
-- existe en toda la operacion es del 2026-06-24, y esos casos cerraron entre diciembre y junio.
--
-- Criterio de pago (Mauricio, 2026-08-22): un pago existe si tiene referencia ePayco escrita
-- en su columna. `Referencia de pago anticipo` para el abono, `Referencia segundo pago` para
-- el segundo tramo. El monto por si solo no prueba nada: `ESTIMADO SEGUNDO PAGO` de la pestana
-- CLIENTES es la formula `tarifa - abono`.
--
-- Referencias compartidas: cuando la misma referencia ePayco aparece en dos negocios, es un
-- solo pago repartido entre los dos, igual que ONE lo modela hoy. Cada negocio recibe su parte
-- y los dos cobros comparten `split_json` con el `split_id` y el `ref_total` de la referencia.
--
-- Queda pendiente lo que no se puede identificar y tiene que resolver SOENA:
--   * V0138, V0153, V0155 y V0238: dos filas del Sheet apuntan al mismo negocio de ONE.
--   * V0139, V0174 y V0196: el Sheet convirtio la referencia del segundo pago a notacion
--     cientifica y el numero real se perdio.
--   * V0192, V0221 y V0248: la referencia del abono solo dice `Davivienda`.
--   * V0261: no tiene honorario en ONE, es un negocio de solo tarifa.
--
-- Detalle en proyectos/soena/ve/conciliacion-cargue-2026-08/.

do $$
declare creados int;
begin
  with e (codigo,monto,fecha,tipo,ref,split_id,ref_total) as (values
  ('V0131',50000,'2025-12-12','a','324608516',null,null),
  ('V0131',650000,'2026-07-16','p','367700137',null,null),
  ('V0132',50000,'2026-01-30','a','332554223',null,null),
  ('V0132',375000,'2026-04-01','p','351372413',null,null),
  ('V0133',199920,'2026-02-12','a','334822252',null,null),
  ('V0133',466480,'2026-04-20','p','355869322',null,null),
  ('V0134',297500,'2026-02-23','a','339862877',null,null),
  ('V0134',297500,'2026-03-31','p','351139896',null,null),
  ('V0135',297500,'2026-02-25','a','340190923',null,null),
  ('V0135',297500,'2026-05-22','p','367771498',null,null),
  ('V0136',297500,'2026-02-25','a','340300464',null,null),
  ('V0137',50000,'2026-02-25','a','340226598',null,null),
  ('V0137',778996,'2026-07-07','p','375215059',null,null),
  ('V0139',382500,'2026-03-06','a','343448310',null,null),
  ('V0140',637500,'2026-03-10','a','344147104',null,null),
  ('V0141',637500,'2026-03-10','a','344119393','ccb15f84-1efd-300e-c648-b75ae4c0c070',1275000),
  ('V0142',637500,'2026-03-10','a','344119393','ccb15f84-1efd-300e-c648-b75ae4c0c070',1275000),
  ('V0143',573750,'2026-03-12','a','344661319',null,null),
  ('V0144',425000,'2026-03-13','a','344831311',null,null),
  ('V0145',637500,'2026-03-16','a','345282135',null,null),
  ('V0146',425000,'2026-03-16','a','345213725',null,null),
  ('V0146',425000,'2026-06-16','p','371638742',null,null),
  ('V0147',637500,'2026-03-18','a','346110158',null,null),
  ('V0148',637500,'2026-03-19','a','346953622',null,null),
  ('V0149',425000,'2026-03-19','a','346928039',null,null),
  ('V0149',425000,'2026-07-23','p','377675302',null,null),
  ('V0150',637500,'2026-03-19','a','346983526',null,null),
  ('V0151',573750,'2026-03-24','a','347981339',null,null),
  ('V0152',573750,'2026-03-26','a','349003241',null,null),
  ('V0154',573750,'2026-03-30','a','350791610','e2e79360-991c-4e33-099a-b6222ded2bb9',1147500),
  ('V0156',573750,'2026-03-30','a','350791610','e2e79360-991c-4e33-099a-b6222ded2bb9',1147500),
  ('V0157',637500,'2026-03-31','a','351036774',null,null),
  ('V0158',637500,'2026-04-06','a','352141881',null,null),
  ('V0159',636998,'2026-04-07','a','352350171',null,null),
  ('V0160',637500,'2026-04-07','a','352449997','5ebb5a6a-1da2-7c6d-23d9-c539264a24ba',1275000),
  ('V0161',637500,'2026-04-07','a','352449997','5ebb5a6a-1da2-7c6d-23d9-c539264a24ba',1275000),
  ('V0162',637500,'2026-04-10','a','354056280',null,null),
  ('V0163',425000,'2026-04-13','a','354525148',null,null),
  ('V0163',212500,'2026-06-12','p','371094752',null,null),
  ('V0164',637500,'2026-04-16','a','355169305',null,null),
  ('V0165',637500,'2026-04-19','a','355674119',null,null),
  ('V0166',637500,'2026-04-21','a','356050629',null,null),
  ('V0167',637500,'2026-04-22','a','356231738',null,null),
  ('V0168',425000,'2026-04-24','a','364168428',null,null),
  ('V0168',425000,'2026-06-22','p','372600966',null,null),
  ('V0169',400000,'2026-04-24','a','361380117','155a6421-554e-e4ad-5303-5b2ceaa2ab45',800000),
  ('V0169',160000,'2026-05-29','p','368843709','7a4ac706-603c-90fd-7737-6c1b678dc9a6',320000),
  ('V0170',400000,'2026-04-24','a','361380117','155a6421-554e-e4ad-5303-5b2ceaa2ab45',800000),
  ('V0170',160000,'2026-05-29','p','368843709','7a4ac706-603c-90fd-7737-6c1b678dc9a6',320000),
  ('V0171',637500,'2026-04-28','a','362497283',null,null),
  ('V0172',425000,'2026-04-29','a','362764726',null,null),
  ('V0173',425000,'2026-05-05','a','364177327',null,null),
  ('V0174',425000,'2026-05-06','a','364449703',null,null),
  ('V0175',637500,'2026-05-07','a','364610349',null,null),
  ('V0176',425000,'2026-05-08','a','365638381',null,null),
  ('V0176',425000,'2026-06-02','p','369494071',null,null),
  ('V0177',637500,'2026-05-08','a','365712485',null,null),
  ('V0178',637500,'2026-05-11','a','366039012',null,null),
  ('V0179',634500,'2026-05-11','a','366078795',null,null),
  ('V0180',595000,'2026-05-12','a','366191613',null,null),
  ('V0181',595000,'2026-05-12','a','366205130',null,null),
  ('V0182',425000,'2026-05-13','a','366341015',null,null),
  ('V0182',425000,'2026-06-11','p','370993740',null,null),
  ('V0183',637500,'2026-05-13','a','366377069',null,null),
  ('V0184',637500,'2026-05-13','a','366336510',null,null),
  ('V0185',425000,'2026-05-14','a','366463868',null,null),
  ('V0185',425000,'2026-06-17','p','371812853',null,null),
  ('V0186',637500,'2026-05-14','a','366559771',null,null),
  ('V0187',637500,'2026-05-15','a','366691488',null,null),
  ('V0188',637500,'2026-05-15','a','366592483',null,null),
  ('V0189',425000,'2026-05-15','a','366654092',null,null),
  ('V0189',425000,'2026-06-17','p','371844118',null,null),
  ('V0190',637500,'2026-05-17','a','366976626',null,null),
  ('V0191',637500,'2026-05-19','a','367219403',null,null),
  ('V0193',425000,'2026-05-20','a','367404134',null,null),
  ('V0193',425000,'2026-06-16','p','371671359',null,null),
  ('V0194',637500,'2026-05-20','a','367401202',null,null),
  ('V0195',637500,'2026-05-21','a','367594062',null,null),
  ('V0196',425000,'2026-05-21','a','367560586',null,null),
  ('V0197',637500,'2026-05-22','a','367713680',null,null),
  ('V0198',637500,'2026-05-22','a','367780807',null,null),
  ('V0199',637500,'2026-05-23','a','367927975',null,null),
  ('V0200',637500,'2026-05-23','a','367885212',null,null),
  ('V0201',637500,'2026-05-24','a','367972921',null,null),
  ('V0202',637500,'2026-05-25','a','368092435',null,null),
  ('V0203',573750,'2026-05-25','a','368126189',null,null),
  ('V0204',637500,'2026-05-25','a','368149011',null,null),
  ('V0205',637500,'2026-05-26','a','368194642',null,null),
  ('V0206',637500,'2026-05-26','a','368299047',null,null),
  ('V0207',595000,'2026-05-26','a','368241395','2feaa844-c704-aa76-6ad8-5b3d9fc42911',1190000),
  ('V0208',595000,'2026-05-26','a','368252319',null,null),
  ('V0209',637500,'2026-05-26','a','368296707',null,null),
  ('V0210',595000,'2026-05-26','a','368241395','2feaa844-c704-aa76-6ad8-5b3d9fc42911',1190000),
  ('V0211',637500,'2026-05-27','a','368506109',null,null),
  ('V0212',605625,'2026-05-27','a','368433923','62515da5-dd33-26e8-4c87-79620521a220',1211250),
  ('V0213',637500,'2026-05-27','a','368472757',null,null),
  ('V0214',605625,'2026-05-27','a','368433923','62515da5-dd33-26e8-4c87-79620521a220',1211250),
  ('V0215',637500,'2026-05-27','a','368497595',null,null),
  ('V0216',637500,'2026-05-27','a','368473829',null,null),
  ('V0217',637500,'2026-05-27','a','368486612',null,null),
  ('V0218',637500,'2026-05-27','a','368406352',null,null),
  ('V0219',637500,'2026-05-27','a','368391660',null,null),
  ('V0220',637500,'2026-05-27','a','368444253',null,null),
  ('V0222',637500,'2026-05-28','a','368563467',null,null),
  ('V0223',637500,'2026-05-28','a','368554756',null,null),
  ('V0224',425000,'2026-05-28','a','368621410',null,null),
  ('V0225',637500,'2026-05-28','a','368488688',null,null),
  ('V0226',637500,'2026-05-28','a','368586307',null,null),
  ('V0227',560000,'2026-05-29','a','368754557','7c1b1390-376e-9b37-d153-d7b41b3d62f4',1120000),
  ('V0228',425000,'2026-05-29','a','368826932',null,null),
  ('V0228',425000,'2026-06-11','p','370988899',null,null),
  ('V0229',637500,'2026-05-29','a','368764653',null,null),
  ('V0230',425000,'2026-05-29','a','368795890',null,null),
  ('V0231',425000,'2026-05-29','a','368775337',null,null),
  ('V0232',637500,'2026-05-29','a','368739142',null,null),
  ('V0233',560000,'2026-05-29','a','368754557','7c1b1390-376e-9b37-d153-d7b41b3d62f4',1120000),
  ('V0235',637500,'2026-06-01','a','369341468',null,null),
  ('V0236',637500,'2026-06-02','a','369421826',null,null),
  ('V0237',637500,'2026-06-02','a','369522083',null,null),
  ('V0239',637500,'2026-06-13','a','371272455',null,null),
  ('V0240',637500,'2026-06-16','a','371558844',null,null),
  ('V0241',637500,'2026-06-16','a','371558759',null,null),
  ('V0242',318000,'2026-06-18','a','372029240',null,null),
  ('V0243',637500,'2026-06-19','a','372189182',null,null),
  ('V0244',637500,'2026-06-22','a','3372598788',null,null),
  ('V0245',595000,'2026-06-23','a','372777076','fd3dd895-bcd9-ef11-e602-2cb5da25129e',1190000),
  ('V0246',595000,'2026-06-23','a','372777076','fd3dd895-bcd9-ef11-e602-2cb5da25129e',1190000),
  ('V0247',573750,'2026-06-26','a','373348438',null,null)
  )
  insert into cobros (workspace_id, negocio_id, monto, fecha, tipo_cobro, external_ref,
                      fuente, canal_registro, notas, split_json)
  select n.workspace_id, n.id, e.monto::numeric, e.fecha::date,
         case e.tipo when 'a' then 'anticipo' else 'pago' end, e.ref,
         'epayco', 'app',
         'Cargue historico desde el Sheet de SOENA (2026-08-22). Referencia ePayco #' || e.ref,
         case when e.split_id is null then null else
           jsonb_build_object('split_id', e.split_id, 'ref_total', e.ref_total, 'por_reparto', true) end
    from e
    join negocios n on n.codigo = e.codigo
     and n.workspace_id = '7dea141d-d4da-483d-a78d-b14ef35500c5'
   where not exists (select 1 from cobros c where c.negocio_id = n.id);
  get diagnostics creados = row_count;
  if creados <> 128 then
    raise exception 'se esperaban 128 cobros y se crearon %', creados;
  end if;
end $$;
