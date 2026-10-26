-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- Termotech (A3 26 2): la suscripción de ONE se cobra con enlace de Bold y el cliente lo ve en
-- termotech.metrikone.co/suscripcion, igual que los CDA de Valida.
--
-- Pedido de Mauricio, 2026-10-05. Va DESPUÉS del deploy del PR que abre /suscripcion a Clarity
-- (sin él, el contrato existe pero Termotech no tiene dónde ver el enlace; el enlace sí se generaría).
--
-- NO CORRE SOLO. Se corre dos veces, a mano, por el MCP de Supabase:
--   1. tal cual (c_ensayo = true): valida, escribe, comprueba y DESHACE con «ENSAYO OK …»;
--   2. con c_ensayo = false: escribe de verdad y termina con «CARGA OK …».
-- Después, las consultas de VERIFICACIÓN del final.
--
-- Qué escribe (todo en metrik, a21bfc88…, salvo que se diga):
--   a. `plan_cobro_cuotas`: la fila de la CUOTA 1 (05-sep-2026, $150.000), que hoy no existe a propósito.
--      Sin ella, el reparto FIFO de la pestaña Pagos y de `generarEnlacePagoCuota` le abona el pago de
--      septiembre a la cuota 2: el enlace de octubre saldría rechazado («ya quedó cubierta») y la
--      cuota 6 aparecería como deuda al final. Su cobro (464f66a0…, pagado el 07-sep) ya dice
--      plan + número 1, así que con la fila queda «pagada» y el enlace automático la descarta.
--   b. `plan_cobro_cuotas.concepto_detalle` de las 6 cuotas (solo si está vacío): «Suscripción MeTRIK
--      ONE · Termotech — periodo del 05/10/2026 al 04/11/2026». Es el texto de la pantalla de Bold y
--      de la pestaña Pagos; sin él dicen «Cuota 2 de 6 · vence 05/10/2026».
--   c. `planes_cobro` 31d4bc5f…: pasarela 'manual' → 'bold' (de ahí sale la pasarela del enlace) y
--      activo true → false. `activo` es SOLO el interruptor del EMISOR de cuentas de cobro: con el
--      plan activo, el 10-oct el cron le emite a Termotech una cuenta de cobro de persona natural
--      (Brallan Mauricio Moreno) por la misma cuota 2 que el enlace de Bold cobra a nombre de METRIK
--      IA S.A.S.: dos cobros por lo mismo, de dos emisores. El enlace (paso 6) NO mira `activo`.
--      ⚠️ Decisión de Mauricio, no técnica: si la cuota se sigue soportando con cuenta de cobro de
--      persona natural, este SQL NO va (Bold recauda a la S.A.S.).
--   d. `servicios_contratados`: el contrato `licencia-clarity` v1 que Termotech PAGA
--      (`workspace_pagador_id` = su espacio), activo desde el 05-sep-2026, $150.000/mes, día de
--      cobro 5, persona designada Omar Castro (único usuario del espacio, dueño). Sin comisión
--      (`comision` null pasa `comision_coherente`). Sin `parametros.licencias`: el cupo cae al
--      `max_seats` del espacio (10) y no se proyecta nada.
--   e. `servicios_contratados_cambios`: la fila de alta (la bitácora es obligatoria e inmutable).
--
-- Qué NO toca: `workspaces.modules` ni `workspace_modulos` de Termotech (Clarity ya está encendido por
-- la llave `business`), ni términos (Clarity no tiene documento publicado), ni cobros.
-- ═══════════════════════════════════════════════════════════════════════════════════════════════

do $bloque$
declare
  c_ensayo constant boolean := true;

  c_ws_metrik      constant uuid := 'a21bfc88-1a60-48c3-afcd-144226aa2392';
  c_ws_termotech   constant uuid := 'b4d2ace9-7141-49a6-a34e-53461b55c85b';
  c_empresa        constant uuid := '8f9f75ce-0d51-463a-a886-820266f3712d';  -- Termotech en metrik (A3)
  c_nit            constant text := '902.080.631-1';
  c_negocio        constant uuid := '43b2f059-4999-4bbd-aa59-57608c1a0616';  -- A3 26 2
  c_codigo         constant text := 'A3 26 2';
  c_plan           constant uuid := '31d4bc5f-711c-4221-a184-fec75caa70c9';
  c_cuota2         constant uuid := 'f2394f81-3b7d-49a4-a74b-92c54e2a3894';
  c_cobro_cuota1   constant uuid := '464f66a0-473d-46ee-8561-0c731d920800';
  c_designado      constant uuid := '64864a69-f5b5-4f33-96bf-99fe2b3bbe4c';  -- Omar Castro, dueño de termotech
  c_correo         constant text := 'infotermotechsas@gmail.com';            -- email_fiscal de la empresa
  c_registrado_por constant uuid := 'cc6f6100-4eb7-4eed-9a7c-096729f5cedf';  -- Mauricio (platform admin)
  c_precio         constant numeric := 150000;
  c_prefijo        constant text := 'Suscripción MeTRIK ONE · Termotech — periodo del ';

  v_plan record;
  v_perfil record;
  v_sc uuid;
  v_cuota1 uuid;
  v_conceptos integer;
  v_n integer;
begin
  -- ── Guardas: abortan antes de escribir ─────────────────────────────────────
  select p.* into v_plan from public.planes_cobro p where p.id = c_plan and p.workspace_id = c_ws_metrik;
  if not found then raise exception 'El plan % no está en metrik', c_plan; end if;
  if v_plan.negocio_id <> c_negocio then raise exception 'El plan % no es del negocio %', c_plan, c_codigo; end if;
  if v_plan.pasarela <> 'manual' then raise exception 'El plan ya no dice manual (dice %): alguien lo cambió, revisar antes', v_plan.pasarela; end if;
  if v_plan.total_cuotas <> 6 or v_plan.monto <> c_precio then
    raise exception 'El plan ya no es 6 × $150.000 (% × %)', v_plan.total_cuotas, v_plan.monto;
  end if;

  if not exists (
    select 1 from public.negocios n
     where n.id = c_negocio and n.workspace_id = c_ws_metrik and n.codigo = c_codigo and n.empresa_id = c_empresa
  ) then
    raise exception 'El negocio % no es % de la empresa %', c_negocio, c_codigo, c_empresa;
  end if;
  if not exists (
    select 1 from public.empresas e where e.id = c_empresa and e.workspace_id = c_ws_metrik and e.numero_documento = c_nit
  ) then
    raise exception 'La empresa % no está en metrik con NIT %', c_empresa, c_nit;
  end if;

  if not exists (select 1 from public.catalogo_servicios_versiones v where v.slug = 'licencia-clarity' and v.version = 1)
     or not exists (select 1 from public.catalogo_servicios c where c.slug = 'licencia-clarity' and c.modulo = 'business' and c.activo) then
    raise exception 'El catálogo no tiene licencia-clarity v1 activa del módulo business';
  end if;
  if exists (
    select 1 from public.servicios_contratados sc
     where sc.negocio_id = c_negocio and sc.estado not in ('cancelado', 'terminado')
  ) then
    raise exception 'El negocio % ya tiene un contrato vivo. Nada que hacer.', c_codigo;
  end if;

  select p.id, p.full_name, p.workspace_id, coalesce(p.platform_admin, false) as platform_admin
    into v_perfil from public.profiles p where p.id = c_designado;
  if not found then raise exception 'El perfil designado % no existe', c_designado; end if;
  if v_perfil.workspace_id <> c_ws_termotech then
    raise exception 'El perfil designado % (%) no está en el espacio de Termotech', c_designado, v_perfil.full_name;
  end if;
  if v_perfil.platform_admin then raise exception 'El soporte de MeTRIK no puede ser la persona designada'; end if;

  -- Las cuotas: 2 a 6 explícitas, sin la 1.
  select count(*) into v_n from public.plan_cobro_cuotas q where q.plan_cobro_id = c_plan;
  if v_n <> 5 or exists (select 1 from public.plan_cobro_cuotas q where q.plan_cobro_id = c_plan and q.numero = 1)
     or not exists (select 1 from public.plan_cobro_cuotas q where q.id = c_cuota2 and q.numero = 2 and q.fecha_vencimiento = date '2026-10-05') then
    raise exception 'Las cuotas del plan ya no son 2..6 con la 2 el 05-oct (hay %): revisar antes', v_n;
  end if;

  -- Los cobros del negocio: SOLO el de la cuota 1, pagado. Un cobro de otra cuota (o un enlace ya
  -- puesto) quiere decir que alguien ya empezó a cobrar octubre por otro lado.
  select count(*) into v_n from public.cobros c where c.negocio_id = c_negocio;
  if v_n <> 1 or not exists (
    select 1 from public.cobros c
     where c.id = c_cobro_cuota1 and c.negocio_id = c_negocio and c.plan_cobro_id = c_plan and c.numero_cuota = 1
       and c.fecha is not null and c.anulado_at is null and c.monto = c_precio
  ) then
    raise exception 'El negocio tiene % cobros y se esperaba solo el de la cuota 1 pagado: revisar antes', v_n;
  end if;

  -- Ninguna cuenta de cobro emitida a Termotech: si ya se le emitió la de octubre, el enlace la duplica.
  if exists (select 1 from public.cuentas_cobro_emitidas cc where cc.empresa_id_pagador = c_empresa) then
    raise exception 'Termotech ya tiene una cuenta de cobro emitida: el enlace de Bold cobraría lo mismo dos veces. Revisar antes.';
  end if;

  -- ── a. La cuota 1, ya pagada ───────────────────────────────────────────────
  insert into public.plan_cobro_cuotas (workspace_id, plan_cobro_id, numero, tipo, monto, iva, fecha_vencimiento, concepto_detalle)
  values (
    c_ws_metrik, c_plan, 1, 'cuota', c_precio, 0, date '2026-09-05',
    c_prefijo || to_char(date '2026-09-05', 'DD/MM/YYYY') || ' al ' || to_char((date '2026-09-05' + interval '1 month' - interval '1 day')::date, 'DD/MM/YYYY')
  )
  returning id into v_cuota1;

  -- ── b. El concepto de las demás (solo las vacías) ──────────────────────────
  update public.plan_cobro_cuotas q
     set concepto_detalle = c_prefijo || to_char(q.fecha_vencimiento, 'DD/MM/YYYY') || ' al '
                            || to_char((q.fecha_vencimiento + interval '1 month' - interval '1 day')::date, 'DD/MM/YYYY'),
         updated_at = now()
   where q.plan_cobro_id = c_plan and q.numero between 2 and 6 and q.concepto_detalle is null;
  get diagnostics v_conceptos = row_count;

  -- ── c. El plan: Bold, y el emisor de cuentas de cobro apagado ──────────────
  update public.planes_cobro
     set pasarela = 'bold',
         activo = false,
         notas = coalesce(notas, '') || E'\n\n2026-10-05 (Mauricio): desde la cuota 2 se cobra con enlace de Bold a nombre de METRIK IA S.A.S., visible en termotech.metrikone.co/suscripcion (contrato licencia-clarity). Plan inactivo = el cron NO emite cuenta de cobro de persona natural por estas cuotas; el enlace (paso 6) no mira activo. La cuota 1 ahora tiene fila explícita (pagada el 07-sep) para que el reparto FIFO no le abone ese pago a la cuota 2.',
         updated_at = now()
   where id = c_plan and pasarela = 'manual' and activo;
  get diagnostics v_n = row_count;
  if v_n <> 1 then raise exception 'El plan no se actualizó (%): cambió entre la guarda y la escritura', v_n; end if;

  -- ── d. El contrato ─────────────────────────────────────────────────────────
  insert into public.servicios_contratados (
    workspace_id, empresa_id, negocio_id, servicio_slug, servicio_version, parametros,
    workspace_pagador_id, correo_facturacion, estado, vigente_desde, vigente_hasta,
    comision, autorizacion_sin_poder_permitida, actualizado_por, aceptante_designado_id, terminos_plazo_hasta
  ) values (
    c_ws_metrik, c_empresa, c_negocio, 'licencia-clarity', 1,
    jsonb_build_object('precio_mensual', c_precio, 'dia_cobro', 5),
    c_ws_termotech, c_correo, 'activo', date '2026-09-05',
    -- Sin fin: el plan trae 6 cuotas (hasta el 05-feb-2027); qué pasa después lo decide Mauricio.
    null,
    null, false, c_registrado_por, c_designado,
    -- Sin plazo de términos: Clarity no tiene documento publicado que aceptar.
    null
  )
  returning id into v_sc;

  -- ── e. La bitácora ─────────────────────────────────────────────────────────
  insert into public.servicios_contratados_cambios (servicio_contratado_id, campo, valor_anterior, valor_nuevo, motivo, registrado_por)
  values (
    v_sc, 'alta', null,
    jsonb_build_object(
      'parametros', jsonb_build_object('precio_mensual', c_precio, 'dia_cobro', 5),
      'workspace_pagador_id', c_ws_termotech,
      'aceptante_designado_id', c_designado,
      'aceptante_designado_nombre', v_perfil.full_name,
      'comision', null,
      'plan_cobro_id', c_plan,
      'plan_pasarela', jsonb_build_object('antes', 'manual', 'despues', 'bold'),
      'plan_activo', jsonb_build_object('antes', true, 'despues', false),
      'cuota_1_explicita', v_cuota1
    ),
    'Alta del contrato licencia-clarity v1 de TERMOTECH SAS (negocio A3 26 2) para cobrar la suscripción de MeTRIK ONE con enlace de Bold desde la cuota 2 (05-oct-2026), visible en /suscripcion de su espacio. $150.000 mensuales sin IVA (computación en la nube), 6 cuotas, la 1 pagada el 07-sep-2026. Pedido de Mauricio del 2026-10-05.',
    c_registrado_por
  );

  -- ── Comprobaciones antes de soltar la transacción ──────────────────────────
  if (select count(*) from public.plan_cobro_cuotas q where q.plan_cobro_id = c_plan) <> 6
     or (select sum(q.monto) from public.plan_cobro_cuotas q where q.plan_cobro_id = c_plan) <> 6 * c_precio
     or exists (select 1 from public.plan_cobro_cuotas q where q.plan_cobro_id = c_plan and (q.concepto_detalle is null or length(q.concepto_detalle) > 100)) then
    raise exception 'Las cuotas no quedaron 6 × $150.000 con concepto de 100 caracteres o menos';
  end if;
  if (select count(*) from public.servicios_contratados sc
       join public.catalogo_servicios cs on cs.slug = sc.servicio_slug
      where cs.modulo = 'business' and sc.workspace_pagador_id = c_ws_termotech
        and sc.estado in ('activo', 'pausado')) <> 1 then
    raise exception 'Termotech no quedó con exactamente un contrato de Clarity que cobra';
  end if;
  if exists (select 1 from public.planes_cobro p where p.id = c_plan and (p.pasarela <> 'bold' or p.activo)) then
    raise exception 'El plan no quedó en bold e inactivo';
  end if;

  if c_ensayo then
    raise exception 'ENSAYO OK: contrato %, cuota 1 %, conceptos llenados %, designada % (%). Nada quedó escrito.',
      v_sc, v_cuota1, v_conceptos, v_perfil.full_name, c_designado;
  end if;
  raise notice 'CARGA OK: contrato %, cuota 1 %, conceptos llenados %, designada % (%)',
    v_sc, v_cuota1, v_conceptos, v_perfil.full_name, c_designado;
end;
$bloque$;


-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- VERIFICACIÓN (solo lectura), después de la carga real.
-- ═══════════════════════════════════════════════════════════════════════════════════════════════

-- 1. El contrato y lo que Termotech ve por `mis_servicios()` (filtrado a mano por su espacio).
select sc.id, sc.servicio_slug, sc.estado, sc.vigente_desde, sc.parametros, sc.workspace_pagador_id,
       sc.aceptante_designado_id, p.full_name as designada, cs.modulo
  from public.servicios_contratados sc
  join public.catalogo_servicios cs on cs.slug = sc.servicio_slug
  left join public.profiles p on p.id = sc.aceptante_designado_id
 where sc.workspace_id = 'a21bfc88-1a60-48c3-afcd-144226aa2392'
   and sc.negocio_id = '43b2f059-4999-4bbd-aa59-57608c1a0616';
-- Esperado: 1 fila, licencia-clarity, activo, business, pagador b4d2ace9…, designada Omar Castro.

-- 2. El plan y las cuotas como las ve la pestaña Pagos (mismo join que `mis_cuotas_de_servicio`).
select p.pasarela, p.activo, q.numero, q.fecha_vencimiento, q.monto, q.concepto_detalle,
       c.id as cobro_id, c.fecha as pagado_el, c.enlace_pago_url, c.enlace_pago_expira
  from public.planes_cobro p
  join public.plan_cobro_cuotas q on q.plan_cobro_id = p.id
  left join public.cobros c on c.plan_cobro_id = p.id and c.numero_cuota = q.numero and c.anulado_at is null
 where p.id = '31d4bc5f-711c-4221-a184-fec75caa70c9'
 order by q.numero;
-- Esperado: bold / false; 6 cuotas; la 1 con el cobro 464f66a0… pagado el 2026-09-07; la 2 sin
-- cobro hasta que el cron (7:00 a. m. de Bogotá) o el botón «Generar enlace de pago» de la ficha
-- A3 26 2 cree el cobro programado con su enlace de checkout.bold.co.

-- 3. Después de generar el enlace: el cobro programado de la cuota 2 y el aviso a Omar.
select c.id, c.monto, c.fecha, c.fecha_esperada, c.enlace_pago_url, c.enlace_pago_expira
  from public.cobros c
 where c.plan_cobro_id = '31d4bc5f-711c-4221-a184-fec75caa70c9' and c.numero_cuota = 2;
select a.created_at, a.estado, a.destino, a.titulo, a.motivo
  from public.avisos_cliente a
 where a.workspace_id = 'a21bfc88-1a60-48c3-afcd-144226aa2392'
   and a.negocio_id = '43b2f059-4999-4bbd-aa59-57608c1a0616'
 order by a.created_at desc
 limit 5;
-- Esperado: monto 150000, fecha null (sin pagar), enlace de checkout.bold.co vigente 7 días; el
-- aviso «enviado» solo si lo generó el cron (el botón no manda correo).
