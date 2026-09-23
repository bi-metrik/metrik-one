-- ============================================================================
-- Valida · CDA · cargar el enlace de pago de Bold de una o varias cuotas · plantilla
--
-- El botón «Pagar» que ve el CDA en `/valida` sale del COBRO PROGRAMADO de su cuota:
-- `cobros.enlace_pago_url` y `cobros.enlace_pago_expira` (migración 20260923220000). Es la misma
-- columna que el adaptador `bold-link` de suscripciones va a escribir cuando cree el enlace por
-- API, así que el día que el enlace deje de ser manual la pantalla no cambia.
--
-- Mientras Bold no cobre recurrente, Mauricio crea un enlace por cuota en el panel de Bold (se manda
-- el día 20 y vence el 27, ciclo del 23 al 22) y esta plantilla lo carga.
--
-- ⚠️ Escribe datos de producción: lo corre la sesión principal. Requiere el contrato del CDA ya
-- cargado (`2026-09-23_contratos-y-terminos-cdas.sql`).
--
-- ── Cómo se corre ───────────────────────────────────────────────────────────
--   1. Llenar `c_enlaces`: una fila por enlace, con el espacio del CDA, el número de la cuota
--      (1 = periodo del 23/09 al 22/10), el enlace tal cual lo da Bold y hasta cuándo sirve.
--   2. Correrlo tal cual: ENSAYO, termina en «ENSAYO OK … Nada quedó escrito».
--   3. `c_ensayo := false` y correrlo de nuevo. Es UN statement.
--
-- Qué hace con cada fila:
--   · Sin cobro programado para esa cuota → lo crea (monto y vencimiento de la cuota) con el enlace.
--   · Con cobro programado sin pagar → le pone o le cambia el enlace (un enlace vencido se reemplaza
--     cargando el nuevo).
--   · Cuota ya pagada, o su cobro anulado → aborta todo: un enlace nuevo sobre una cuota pagada
--     cobraría dos veces.
--
-- El cobro programado NO sale en ninguna cuenta de cobro: los planes de los CDA están apagados
-- (`planes_cobro.activo = false`) y los dos emisores solo leen planes encendidos. Pasado su
-- vencimiento sin pago, el cron lo marca vencido y avisa al equipo de MeTRIK (no al cliente).
--
-- Cuando el CDA paga: se confirma ese mismo cobro programado (fecha y referencia de Bold) desde el
-- negocio en metrik, bloque Cobros → «Confirmar pago manual». No se registra un pago aparte: la
-- cuota quedaría pagada dos veces.
--
-- ── Verificación (solo lectura) ─────────────────────────────────────────────
--   select w.slug, c.numero_cuota, c.monto, c.fecha_esperada, c.fecha, c.enlace_pago_url, c.enlace_pago_expira
--     from public.cobros c
--     join public.servicios_contratados sc on sc.negocio_id = c.negocio_id
--     join public.workspaces w on w.id = sc.workspace_pagador_id
--    where sc.servicio_slug = 'valida-cda-licencia' and c.tipo_cobro = 'programado'
--    order by w.slug, c.numero_cuota;
-- ============================================================================

do $enlaces$
declare
  -- ⚠️ true = ENSAYO (deshace todo). Para cargar, false.
  c_ensayo constant boolean := true;
  -- ⚠️ Llenar antes de correr. Ejemplo:
  --   {"espacio": "cda-caqueta", "cuota": 1, "url": "https://checkout.bold.co/payment/LNK_XXXX",
  --    "expira": "2026-09-30T23:59:00-05:00"}
  c_enlaces constant jsonb := '[]';

  r record;
  v_sc record;
  v_plan record;
  v_cuota record;
  v_cobro record;
  v_n int;
  v_creados int := 0;
  v_actualizados int := 0;
begin
  if jsonb_typeof(c_enlaces) is distinct from 'array' or jsonb_array_length(c_enlaces) = 0 then
    raise exception 'c_enlaces está vacío: una fila por enlace (espacio, cuota, url, expira)';
  end if;

  for r in
    select * from jsonb_to_recordset(c_enlaces) as x(espacio text, cuota integer, url text, expira timestamptz)
  loop
    if r.espacio is null or r.cuota is null or r.url is null or r.expira is null then
      raise exception 'Fila incompleta: %', to_jsonb(r);
    end if;
    -- Lo mismo que exige la pantalla para pintar el botón: https y dominio de Bold. El dominio va
    -- anclado al inicio y cerrado por `/`, `?`, `#` o el final, así que ni `https://bold.co@otro.sitio`
    -- ni `https://bold.co.otro.sitio` pasan.
    if r.url !~ '^https://([a-z0-9-]+\.)*bold\.co([/?#]|$)' then
      raise exception '%: el enlace no es de Bold: %', r.espacio, r.url;
    end if;
    if r.expira <= now() then
      raise exception '%: el enlace de la cuota % ya venció (%)', r.espacio, r.cuota, r.expira;
    end if;

    -- El contrato del CDA: el que ese espacio paga.
    select count(*) into v_n
      from public.servicios_contratados sc
      join public.workspaces w on w.id = sc.workspace_pagador_id
     where w.slug = r.espacio and sc.servicio_slug = 'valida-cda-licencia' and sc.estado = 'activo';
    if v_n <> 1 then
      raise exception '%: se esperaba un contrato valida-cda-licencia activo y hay %', r.espacio, v_n;
    end if;
    select sc.id, sc.negocio_id, sc.workspace_id
      into v_sc
      from public.servicios_contratados sc
      join public.workspaces w on w.id = sc.workspace_pagador_id
     where w.slug = r.espacio and sc.servicio_slug = 'valida-cda-licencia' and sc.estado = 'activo';

    -- Su plan: el del negocio del contrato, en el workspace del cobrador.
    select count(*) into v_n
      from public.planes_cobro p
     where p.negocio_id = v_sc.negocio_id and p.workspace_id = v_sc.workspace_id;
    if v_n <> 1 then
      raise exception '%: se esperaba un plan de cobro para el negocio del contrato y hay %', r.espacio, v_n;
    end if;
    select p.id, p.workspace_id, p.negocio_id, p.total_cuotas
      into v_plan
      from public.planes_cobro p
     where p.negocio_id = v_sc.negocio_id and p.workspace_id = v_sc.workspace_id;

    select q.numero, q.monto, q.fecha_vencimiento
      into v_cuota
      from public.plan_cobro_cuotas q
     where q.plan_cobro_id = v_plan.id and q.numero = r.cuota;
    if not found then
      raise exception '%: el plan no tiene cuota %', r.espacio, r.cuota;
    end if;

    select c.id, c.fecha, c.anulado_at
      into v_cobro
      from public.cobros c
     where c.plan_cobro_id = v_plan.id and c.numero_cuota = r.cuota;
    if found then
      if v_cobro.anulado_at is not null then
        raise exception '%: el cobro de la cuota % está anulado. Revisar antes de cargar un enlace.', r.espacio, r.cuota;
      end if;
      if v_cobro.fecha is not null then
        raise exception '%: la cuota % ya está pagada (%). No se carga un enlace.', r.espacio, r.cuota, v_cobro.fecha;
      end if;
      update public.cobros
         set enlace_pago_url = r.url, enlace_pago_expira = r.expira
       where id = v_cobro.id;
      v_actualizados := v_actualizados + 1;
    else
      insert into public.cobros (
        workspace_id, negocio_id, plan_cobro_id, numero_cuota, monto, tipo_cobro,
        fecha_esperada, fecha, revisado, notas, retencion, enlace_pago_url, enlace_pago_expira
      ) values (
        v_plan.workspace_id, v_plan.negocio_id, v_plan.id, r.cuota, v_cuota.monto, 'programado',
        v_cuota.fecha_vencimiento, null, false, format('Cuota %s de %s', r.cuota, v_plan.total_cuotas), 0,
        r.url, r.expira
      );
      v_creados := v_creados + 1;
    end if;
  end loop;

  if c_ensayo then
    raise exception 'ENSAYO OK: % cobros programados nuevos, % con enlace cambiado. Nada quedó escrito.',
      v_creados, v_actualizados;
  end if;
  raise notice 'CARGA OK: % cobros programados nuevos, % con enlace cambiado', v_creados, v_actualizados;
end;
$enlaces$;
