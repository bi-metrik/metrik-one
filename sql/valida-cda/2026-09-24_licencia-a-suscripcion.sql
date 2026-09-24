-- ============================================================================
-- Valida · los cobros de los CDA dejan de decir «licencia» · 2026-09-24
--
-- VALIDA se factura SIN IVA como servicio de computación en la nube (art. 476 num. 21 ET; regla
-- `cerebro/reglas/exclusion-iva-nube-exige-autodiagnostico.md`). Un concepto de cobro o de factura que
-- diga «Licencia VALIDA» puede leerse como licenciamiento de software, que está gravado. Redacción de
-- Felipe (tributario), literal:
--   · plan / concepto:  «Suscripción VALIDA · Plan CDA — servicio de computación en la nube (SaaS)»
--   · con periodo:      «… · periodo del DD-mmm al DD-mmm»
--
-- Qué cambia, en el workspace metrik y SOLO en los negocios C1 26 1, C2 26 1, C3 26 1, M2 26 1 y CP 26 1:
--   1. `planes_cobro.concepto_detalle_template` de sus planes → el nombre del plan (sin periodo: el
--      periodo lo trae cada cuota). Solo si está vacío o dice «licencia»; cualquier otro se reporta y
--      no se toca.
--   2. `plan_cobro_cuotas.concepto_detalle` de sus cuotas NO pagadas que digan «licencia»:
--      «Licencia VALIDA · Starter — periodo del 23/09/2026 al 22/10/2026»
--        → «Suscripción VALIDA · Plan CDA — servicio de computación en la nube (SaaS) · periodo del 23-sep al 22-oct»
--      Si la cuota trae el desglose de usuarios adicionales (« · Incluye: …»), se conserva tal cual detrás.
--
-- Qué NO toca, a propósito:
--   · Cuotas pagadas o con abono. Se decide con el MISMO reparto de la pantalla del CDA
--     (`cuotasConEstado` en src/lib/valida-cda/pago-pendiente.ts): todo lo recibido del negocio
--     (cobros con fecha, no anulados, más su retención de IVA) cubre de la cuota más vieja a la más
--     nueva; una cuota con algo cubierto no se toca. Tampoco una cuota cuyo cobro programado ya está
--     confirmado (fecha puesta), ni una que ya tenga factura cargada (`facturas_cuota`): la factura
--     emitida dice lo que dice.
--   · Los cobros (`cobros`) ni sus enlaces de pago: el enlace ya generado guarda su descripción en la
--     pasarela y no se puede reescribir; el siguiente enlace sale con el concepto nuevo.
--   · `catalogo_servicios.nombre` («Licencia Valida por CDA»): lo publica el archivo de catálogo de
--     `cerebro/catalogo/servicios/` con su huella, y el CDA ya no lo ve (la pantalla usa el nombre fiscal
--     fijo). Cambiarlo es una versión nueva del catálogo, no un UPDATE.
--   · `negocios.nombre`: el ensayo LISTA los que dicen «licencia» para decidir aparte.
--   · Identificadores internos (`valida-cda-licencia`, `parametros.licencias`, `licencias_adicionales`).
--
-- ⚠️ ESTO NO ESTÁ APLICADO. Escribe datos de producción: lo corre la sesión principal.
--   1. Tal cual (ENSAYO): termina en «ENSAYO OK … Nada quedó escrito» con el detalle de cada plan y
--      cada cuota (antes → después) y lo que se saltó con su motivo. Leerlo entero.
--   2. `c_ensayo` → false y correrlo de nuevo: «CARGA OK …».
--   Es UN statement: el ensayo se deshace solo aunque pase por el pooler. Correrlo dos veces es seguro:
--   lo ya convertido se salta con motivo «ya_convertida».
--
-- Verificación después (solo lectura):
--   select n.codigo, q.numero, q.fecha_vencimiento, q.concepto_detalle
--     from public.plan_cobro_cuotas q
--     join public.planes_cobro p on p.id = q.plan_cobro_id
--     join public.negocios n on n.id = p.negocio_id
--    where p.workspace_id = 'a21bfc88-1a60-48c3-afcd-144226aa2392'
--      and n.codigo in ('C1 26 1', 'C2 26 1', 'C3 26 1', 'M2 26 1', 'CP 26 1')
--    order by n.codigo, q.numero;
-- ============================================================================
do $licencia$
declare
  -- ⚠️ true = ENSAYO: hace todo, lo reporta y lo deshace con RAISE EXCEPTION 'ENSAYO OK …'.
  c_ensayo constant boolean := true;

  c_ws_metrik constant uuid := 'a21bfc88-1a60-48c3-afcd-144226aa2392';
  c_codigos   constant text[] := array['C1 26 1', 'C2 26 1', 'C3 26 1', 'M2 26 1', 'CP 26 1'];
  -- Redacción de Felipe, literal. Es la misma constante PLAN_CDA de src/lib/valida-cda/redaccion-fiscal.ts.
  c_plan      constant text := 'Suscripción VALIDA · Plan CDA — servicio de computación en la nube (SaaS)';
  c_meses     constant text[] := array['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
  c_marca_desglose constant text := ' · Incluye: ';

  v_hay_facturas boolean := to_regclass('public.facturas_cuota') is not null;
  v_neg record;
  v_plan record;
  v_q record;
  v_recibido numeric;
  v_disponible numeric;
  v_abonado numeric;
  v_confirmado boolean;
  v_facturada boolean;
  v_i int;
  v_base text;
  v_resto text;
  v_m text[];
  v_nuevo text;
  v_motivo text;
  v_encontrados text[] := '{}';
  v_faltan text[];
  v_nombres jsonb := '[]'::jsonb;
  v_planes jsonb := '[]'::jsonb;
  v_cuotas jsonb := '[]'::jsonb;
  v_saltadas jsonb := '[]'::jsonb;
  v_n_planes int := 0;
  v_n_cuotas int := 0;
begin
  for v_neg in
    select n.id, n.codigo, n.nombre
      from public.negocios n
     where n.workspace_id = c_ws_metrik and n.codigo = any (c_codigos)
     order by n.codigo
  loop
    v_encontrados := v_encontrados || v_neg.codigo;
    if v_neg.nombre ilike '%licencia%' then
      v_nombres := v_nombres || jsonb_build_object('negocio', v_neg.codigo, 'nombre', v_neg.nombre);
    end if;

    -- Lo recibido del negocio, como lo reparte la pantalla del CDA: cobros con fecha y no anulados,
    -- más su retención de IVA (columna nueva; si todavía no existe, cuenta cero).
    select coalesce(sum(c.monto + coalesce((to_jsonb(c) ->> 'retencion_iva')::numeric, 0)), 0)
      into v_recibido
      from public.cobros c
     where c.negocio_id = v_neg.id and c.fecha is not null and c.anulado_at is null;

    for v_plan in
      select p.id, p.concepto_detalle_template as plantilla
        from public.planes_cobro p
       where p.workspace_id = c_ws_metrik and p.negocio_id = v_neg.id
       order by p.id
    loop
      -- 1. La plantilla del plan.
      if v_plan.plantilla is null or v_plan.plantilla ilike '%licencia%' then
        v_planes := v_planes || jsonb_build_object(
          'negocio', v_neg.codigo, 'plan', v_plan.id, 'antes', v_plan.plantilla, 'despues', c_plan);
        update public.planes_cobro set concepto_detalle_template = c_plan where id = v_plan.id;
        v_n_planes := v_n_planes + 1;
      elsif v_plan.plantilla is distinct from c_plan then
        v_saltadas := v_saltadas || jsonb_build_object(
          'negocio', v_neg.codigo, 'plan', v_plan.id, 'motivo', 'plantilla_ajena', 'texto', v_plan.plantilla);
      end if;
    end loop;

    -- 2. Las cuotas, en el orden del reparto (vencimiento, número) y sobre TODOS los planes del
    --    negocio, igual que `mis_cuotas_de_servicio` + `cuotasConEstado`.
    v_disponible := v_recibido;
    for v_q in
      select q.id, q.plan_cobro_id, q.numero, q.monto, q.fecha_vencimiento, q.concepto_detalle
        from public.plan_cobro_cuotas q
        join public.planes_cobro p on p.id = q.plan_cobro_id
       where p.workspace_id = c_ws_metrik and p.negocio_id = v_neg.id and q.monto > 0
       order by q.fecha_vencimiento, q.numero
    loop
      v_abonado := least(greatest(v_disponible, 0), v_q.monto);
      v_disponible := v_disponible - v_q.monto;

      select exists (
        select 1 from public.cobros c
         where c.plan_cobro_id = v_q.plan_cobro_id and c.numero_cuota = v_q.numero
           and c.fecha is not null and c.anulado_at is null
      ) into v_confirmado;
      v_facturada := false;
      if v_hay_facturas then
        execute 'select exists (select 1 from public.facturas_cuota f where f.plan_cobro_cuota_id = $1)'
          into v_facturada using v_q.id;
      end if;

      v_motivo := case
        when v_abonado > 0 then 'pagada_o_abonada'
        when v_confirmado then 'cobro_confirmado'
        when v_facturada then 'facturada'
        when v_q.concepto_detalle is null then 'sin_concepto'   -- el generador usa la plantilla del plan
        when v_q.concepto_detalle ilike 'Suscripción VALIDA%' then 'ya_convertida'
        when v_q.concepto_detalle not ilike '%licencia%' then 'concepto_ajeno'
        else null
      end;
      if v_motivo is not null then
        if v_motivo not in ('sin_concepto', 'ya_convertida') then
          v_saltadas := v_saltadas || jsonb_build_object(
            'negocio', v_neg.codigo, 'cuota', v_q.numero, 'motivo', v_motivo, 'texto', v_q.concepto_detalle);
        end if;
        continue;
      end if;

      -- El desglose de usuarios adicionales («· Incluye: …») lo escribe la sección Suscripción y se
      -- conserva tal cual; solo cambia la parte de antes.
      v_i := position(c_marca_desglose in v_q.concepto_detalle);
      if v_i > 0 then
        v_base := left(v_q.concepto_detalle, v_i - 1);
        v_resto := substr(v_q.concepto_detalle, v_i);
      else
        v_base := v_q.concepto_detalle;
        v_resto := '';
      end if;
      v_m := regexp_match(v_base, 'periodo del (\d{2})/(\d{2})/(\d{4}) al (\d{2})/(\d{2})/(\d{4})');
      if v_m is null then
        v_nuevo := c_plan || v_resto;
        v_saltadas := v_saltadas || jsonb_build_object(
          'negocio', v_neg.codigo, 'cuota', v_q.numero, 'motivo', 'sin_periodo_en_el_concepto (queda solo el plan)',
          'texto', v_q.concepto_detalle);
      else
        v_nuevo := c_plan || ' · periodo del '
                   || v_m[1] || '-' || c_meses[v_m[2]::int] || ' al '
                   || v_m[4] || '-' || c_meses[v_m[5]::int]
                   || v_resto;
      end if;

      v_cuotas := v_cuotas || jsonb_build_object(
        'negocio', v_neg.codigo, 'cuota', v_q.numero, 'vence', v_q.fecha_vencimiento,
        'antes', v_q.concepto_detalle, 'despues', v_nuevo);
      update public.plan_cobro_cuotas set concepto_detalle = v_nuevo where id = v_q.id;
      v_n_cuotas := v_n_cuotas + 1;
    end loop;
  end loop;

  if cardinality(v_encontrados) = 0 then
    raise exception 'Ninguno de los negocios % existe en el workspace metrik. Nada que hacer.', c_codigos;
  end if;
  select coalesce(array_agg(x), '{}') into v_faltan from unnest(c_codigos) x where x <> all (v_encontrados);

  if c_ensayo then
    raise exception E'ENSAYO OK: % planes y % cuotas cambiarían. Negocios: %. No encontrados: %.\nPlanes: %\nCuotas: %\nSaltadas: %\nNegocios cuyo NOMBRE dice licencia (no se tocan): %\nNada quedó escrito.',
      v_n_planes, v_n_cuotas, v_encontrados, v_faltan,
      jsonb_pretty(v_planes), jsonb_pretty(v_cuotas), jsonb_pretty(v_saltadas), jsonb_pretty(v_nombres);
  end if;
  raise notice 'CARGA OK: % planes y % cuotas cambiadas. Negocios: %. No encontrados: %. Saltadas: %',
    v_n_planes, v_n_cuotas, v_encontrados, v_faltan, v_saltadas;
end;
$licencia$;
