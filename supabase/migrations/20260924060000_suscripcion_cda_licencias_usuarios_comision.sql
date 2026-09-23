-- ============================================================
-- 20260924060000 — Sección Suscripción de los CDA: licencias adicionales, usuarios retirados,
-- interés en Sustenta y la comisión fija + porcentaje de AFI
--
-- Diseño: proyectos/metrik/valida/docs/2026-09-23_seccion-suscripcion-cda-noor.md (con las
-- decisiones de Mauricio del 2026-09-23).
--
-- ## Qué escribe: DDL y funciones. Ni una fila de datos.
--
-- La comisión de AFI en cada contrato y el valor del usuario adicional (`parametros`) van en
-- `sql/valida-cda/2026-09-23_comision-afi-y-usuario-adicional.sql`, que aplica la sesión principal.
--
-- ## Las piezas
--
--   1. `comision_coherente(jsonb)` admite el modo `fijo_mas_porcentaje`: `monto_fijo` por cobro más
--      `pct` sobre la parte ADICIONAL del cobro. Espeja `src/lib/servicios/comision.ts`. Los dos
--      modos de antes no cambian: toda comisión válida hoy sigue siendo válida.
--   2. `licencias_adicionales` — una fila por usuario adicional comprado (cláusula 2.3), con su valor
--      mensual, quién y cuándo lo pidió y, si se retiró, cuándo y quién. La compra y el retiro dejan
--      además su fila en la bitácora inmutable `servicios_contratados_cambios`.
--   3. `licencias_adicionales_cargos` — cuánto suma cada licencia a cada cuota de
--      `plan_cobro_cuotas` (la prorrata del periodo en curso y un periodo completo por cuota). Es el
--      desglose que explica el monto de la cuota y la base del 20 % de AFI.
--   4. `usuarios_espacio_retiros` — quién retiró a quién de un espacio. Libera la licencia al
--      instante (la cuenta de licencias excluye a los retirados); el acceso lo corta el servidor
--      suspendiendo la cuenta en Auth. No va como columna de `profiles` porque la política
--      `profiles_update` deja a cada usuario reescribir su propia fila.
--   5. `sugerencias_descartadas` — «Ahora no» de una sugerencia (el bloque de Sustenta), por
--      persona, hasta una fecha. En el servidor y no en el navegador: vale en cualquier equipo.
--   6. `interes_servicios` — un «Quiero que me contacten» por espacio y servicio. Único: el segundo
--      clic no crea otro lead.
--   7. `registrar_compra_licencia(...)` y `registrar_retiro_licencia(...)` — las dos escrituras del
--      cobro de licencias, cada una en UNA transacción: bitácora, licencia, cargos, cuotas, contrato y
--      `workspaces.max_seats`. La aritmética la hace el servidor (`src/lib/seccion-suscripcion/
--      periodos.ts`, con pruebas); la función vuelve a comprobar, con las filas bloqueadas, lo que no
--      puede fallar: que ninguna cuota tocada tenga un cobro vivo ni haya cambiado de monto, que el
--      contrato tenga las licencias y el valor que el servidor leyó, y que cada cuota suba (o baje)
--      exactamente lo que suman sus cargos.
--
-- ## Por qué la cuota no se toca si tiene un cobro
--
-- El emisor de cuentas no valida pagos: una cuota ya cobrada que cambia de monto se vuelve a cobrar.
-- Una cuota con un cobro vivo (programado con su enlace de pago, o pagado) queda como está, y lo
-- que le tocaba se corre a la siguiente (lo decide `periodos.ts`). Los planes de los CDA están
-- apagados (`planes_cobro.activo = false`): cambiar el monto de una cuota no emite nada.
--
-- ## Grants: `revoke from public` NO basta en este repo
--
-- Los privilegios por defecto del esquema conceden EXECUTE a `anon` y `authenticated` por nombre.
-- Cada función se revoca nombrando a los tres y se concede solo a `service_role`: las llama el
-- servidor después de comprobar quién pide. Las tablas revocan a los tres: son server-only.
--
-- ## Verificación después de aplicar (solo lectura)
--
--   select p.proname, p.prosecdef, p.proacl::text
--     from pg_proc p join pg_namespace n on n.oid = p.pronamespace
--    where n.nspname = 'public'
--      and p.proname in ('comision_coherente', 'registrar_compra_licencia', 'registrar_retiro_licencia');
--     -> sin `anon=`, sin `authenticated=` y sin `=X/` (PUBLIC) en ninguna
--   select relname, relrowsecurity, relacl::text from pg_class
--    where relname in ('licencias_adicionales', 'licencias_adicionales_cargos', 'usuarios_espacio_retiros',
--                      'sugerencias_descartadas', 'interes_servicios');
--     -> las cinco con RLS y sin anon ni authenticated en la ACL
--   select public.comision_coherente('{"beneficiario_empresa_id":"x","beneficiario_nit":"1","modo":"fijo_mas_porcentaje","monto_fijo":50000,"pct":20,"base":"cada_cobro"}');
--     -> true
--
-- ## Cómo revertir (antes de que haya compras)
--
--   drop function public.registrar_retiro_licencia(uuid, uuid, date, uuid[], jsonb, integer, text);
--   drop function public.registrar_compra_licencia(uuid, uuid, date, numeric, integer, jsonb, jsonb, text);
--   drop table public.interes_servicios, public.sugerencias_descartadas, public.usuarios_espacio_retiros,
--              public.licencias_adicionales_cargos, public.licencias_adicionales;
--   -- comision_coherente: re-crear con el cuerpo de 20260916120000 (solo si ningún contrato usa
--   -- `fijo_mas_porcentaje`; si alguno lo usa, el CHECK lo rechazaría al revalidar).
-- ============================================================


-- ── 1. La comisión admite fijo + porcentaje de lo adicional ─────────────────────────────

-- Cuerpo de 20260916120000 con un modo más. ⚠️ Cada comparación sigue envuelta en
-- `coalesce(..., false)`: un CHECK solo rechaza con FALSE, y con NULL deja pasar.
create or replace function public.comision_coherente(c jsonb)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select coalesce(
    case
      when c is null or c = 'null'::jsonb then true
      when jsonb_typeof(c) <> 'object' then false
      else
        coalesce(length(btrim(c->>'beneficiario_empresa_id')) > 0, false)
        and coalesce(length(btrim(c->>'beneficiario_nit')) > 0, false)
        and coalesce((c->>'base') in ('cada_cobro', 'primer_cobro'), false)
        and coalesce(
          case c->>'modo'
            when 'porcentaje' then
              coalesce(jsonb_typeof(c->'pct') = 'number', false)
              and coalesce((c->>'pct')::numeric > 0, false)
              and coalesce((c->>'pct')::numeric <= 100, false)
              and (c->'pct') is not null
              and (c->'monto_fijo') is null
            when 'monto_fijo' then
              coalesce(jsonb_typeof(c->'monto_fijo') = 'number', false)
              and coalesce((c->>'monto_fijo')::numeric > 0, false)
              and (c->'monto_fijo') is not null
              and (c->'pct') is null
            -- El fijo por cobro Y el porcentaje sobre lo adicional: los dos se declaran.
            when 'fijo_mas_porcentaje' then
              coalesce(jsonb_typeof(c->'monto_fijo') = 'number', false)
              and coalesce((c->>'monto_fijo')::numeric > 0, false)
              and coalesce(jsonb_typeof(c->'pct') = 'number', false)
              and coalesce((c->>'pct')::numeric > 0, false)
              and coalesce((c->>'pct')::numeric <= 100, false)
            else false
          end,
          false
        )
        and (
          (c->'fee_unico') is null
          or (coalesce(jsonb_typeof(c->'fee_unico') = 'number', false)
              and coalesce((c->>'fee_unico')::numeric > 0, false))
        )
    end,
    false
  );
$$;

revoke execute on function public.comision_coherente(jsonb) from public, anon, authenticated;

comment on function public.comision_coherente(jsonb) is
  'Espeja src/lib/servicios/comision.ts. Monto fijo, porcentaje, o fijo + porcentaje sobre lo adicional; el valor sale del contrato, nunca de un valor global (N3).';

comment on column public.servicios_contratados.comision is
  'Canal que cobra comisión por esta venta: { beneficiario_empresa_id, beneficiario_nit, modo (porcentaje | monto_fijo | fijo_mas_porcentaje), pct, monto_fijo, base, fee_unico }. Con fijo_mas_porcentaje, pct va sobre la parte adicional del cobro. Null = no se pactó.';


-- ── 2. Licencias adicionales ────────────────────────────────────────────────────────────

create table public.licencias_adicionales (
  id uuid primary key default gen_random_uuid(),
  servicio_contratado_id uuid not null references public.servicios_contratados(id),
  -- El valor del contrato el día de la compra (`parametros.valor_usuario_adicional`).
  valor_mensual numeric not null
    constraint licencias_adicionales_valor check (valor_mensual > 0),
  fecha_compra date not null,
  comprada_por uuid not null references public.profiles(id),
  cambio_compra_id uuid not null references public.servicios_contratados_cambios(id),
  fecha_retiro date,
  retirada_por uuid references public.profiles(id),
  cambio_retiro_id uuid references public.servicios_contratados_cambios(id),
  created_at timestamptz not null default now(),
  constraint licencias_adicionales_retiro_completo check (
    (fecha_retiro is null and retirada_por is null and cambio_retiro_id is null)
    or (fecha_retiro is not null and retirada_por is not null and cambio_retiro_id is not null)
  ),
  constraint licencias_adicionales_retiro_fecha check (fecha_retiro is null or fecha_retiro >= fecha_compra)
);

alter table public.licencias_adicionales enable row level security;
-- server-only: la escribe `registrar_compra_licencia`/`registrar_retiro_licencia` y la lee el servidor tras exigir dueño, administrador o persona designada.
revoke all on table public.licencias_adicionales from public, anon, authenticated;

create index idx_licencias_adicionales_contrato on public.licencias_adicionales (servicio_contratado_id) where fecha_retiro is null;

comment on table public.licencias_adicionales is
  'Un usuario adicional (cláusula 2.3) comprado por el cliente con solicitud expresa: valor, quién, cuándo, y su retiro. La bitácora del contrato guarda el mismo hecho en servicios_contratados_cambios.';


create table public.licencias_adicionales_cargos (
  id uuid primary key default gen_random_uuid(),
  licencia_id uuid not null references public.licencias_adicionales(id),
  -- RESTRICT: borrar una cuota con cargos perdería en silencio por qué su monto es el que es.
  plan_cobro_cuota_id uuid not null references public.plan_cobro_cuotas(id) on delete restrict,
  tipo text not null
    constraint licencias_cargos_tipo check (tipo in ('prorrata', 'periodo')),
  -- El periodo que paga el cargo (la prorrata empieza el día de la compra).
  periodo_desde date not null,
  periodo_hasta date not null,
  dias integer not null,
  dias_periodo integer not null,
  monto numeric not null
    constraint licencias_cargos_monto check (monto > 0),
  anulado_at timestamptz,
  cambio_anulacion_id uuid references public.servicios_contratados_cambios(id),
  created_at timestamptz not null default now(),
  constraint licencias_cargos_periodo check (periodo_desde <= periodo_hasta),
  constraint licencias_cargos_dias check (dias between 1 and dias_periodo and dias_periodo between 28 and 31),
  constraint licencias_cargos_anulacion check ((anulado_at is null) = (cambio_anulacion_id is null))
);

alter table public.licencias_adicionales_cargos enable row level security;
-- server-only: la escriben las dos funciones de licencias; es el desglose del monto de cada cuota y la base del porcentaje de la comisión.
revoke all on table public.licencias_adicionales_cargos from public, anon, authenticated;

create index idx_licencias_cargos_licencia on public.licencias_adicionales_cargos (licencia_id);
create index idx_licencias_cargos_cuota on public.licencias_adicionales_cargos (plan_cobro_cuota_id) where anulado_at is null;

comment on table public.licencias_adicionales_cargos is
  'Lo que suma cada licencia adicional a cada cuota de plan_cobro_cuotas: prorrata del periodo de la compra y un periodo completo por cuota. Un cargo anulado (retiro) ya no suma.';


-- ── 3. Usuarios retirados de un espacio ─────────────────────────────────────────────────

create table public.usuarios_espacio_retiros (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id),
  profile_id uuid not null references public.profiles(id),
  retirado_por uuid not null references public.profiles(id),
  retirado_at timestamptz not null default now(),
  reincorporado_at timestamptz,
  reincorporado_por uuid references public.profiles(id),
  constraint usuarios_retiros_reincorporacion check ((reincorporado_at is null) = (reincorporado_por is null))
);

alter table public.usuarios_espacio_retiros enable row level security;
-- server-only: la escribe el servidor al retirar o reincorporar a alguien, tras exigir dueño, administrador o persona designada del espacio.
revoke all on table public.usuarios_espacio_retiros from public, anon, authenticated;

-- Un retiro vigente por persona.
create unique index uq_usuarios_retiro_vigente on public.usuarios_espacio_retiros (profile_id) where reincorporado_at is null;
create index idx_usuarios_retiros_ws on public.usuarios_espacio_retiros (workspace_id) where reincorporado_at is null;

comment on table public.usuarios_espacio_retiros is
  'Personas retiradas de un espacio desde la gestión de usuarios. Un retiro vigente (reincorporado_at null) libera la licencia y el servidor suspende la cuenta en Auth.';


-- ── 4. «Ahora no» de una sugerencia ─────────────────────────────────────────────────────

create table public.sugerencias_descartadas (
  profile_id uuid not null references public.profiles(id),
  clave text not null
    constraint sugerencias_clave check (clave ~ '^[a-z0-9_-]{1,60}$'),
  descartada_hasta timestamptz not null,
  updated_at timestamptz not null default now(),
  primary key (profile_id, clave)
);

alter table public.sugerencias_descartadas enable row level security;
-- server-only: la escribe y la lee el servidor para la persona de la sesión; no es dato de nadie más.
revoke all on table public.sugerencias_descartadas from public, anon, authenticated;

comment on table public.sugerencias_descartadas is
  'Hasta cuándo no se le muestra a una persona una sugerencia comercial (clave, p. ej. sustenta). Vale en cualquier equipo.';


-- ── 5. «Quiero que me contacten» ────────────────────────────────────────────────────────

create table public.interes_servicios (
  id uuid primary key default gen_random_uuid(),
  workspace_origen_id uuid not null references public.workspaces(id),
  servicio text not null
    constraint interes_servicios_servicio check (servicio ~ '^[a-z0-9_-]{1,60}$'),
  solicitado_por uuid not null references public.profiles(id),
  -- La empresa del cliente en el directorio de metrik (la del contrato), si se conoce.
  empresa_id uuid references public.empresas(id),
  -- El lead que se creó en metrik. Null mientras se crea.
  contacto_id uuid references public.contactos(id),
  created_at timestamptz not null default now(),
  constraint interes_servicios_unico unique (workspace_origen_id, servicio)
);

alter table public.interes_servicios enable row level security;
-- server-only: la escribe el servidor al pedir contacto; el único por espacio y servicio es lo que evita el lead duplicado.
revoke all on table public.interes_servicios from public, anon, authenticated;

comment on table public.interes_servicios is
  'Un «Quiero que me contacten» por espacio y servicio. El lead vive en contactos del espacio metrik.';


-- ── 6. Registrar la compra de una licencia adicional ────────────────────────────────────

create or replace function public.registrar_compra_licencia(
  p_servicio_contratado_id uuid,
  p_registrado_por uuid,
  p_fecha date,
  p_valor numeric,
  p_licencias_antes integer,
  -- [{cuota_id, tipo, periodo_desde, periodo_hasta, dias, dias_periodo, monto}]
  p_cargos jsonb,
  -- [{cuota_id, monto_antes, monto_nuevo, concepto_nuevo}]
  p_cuotas jsonb,
  p_motivo text
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_sc record;
  v_q record;
  r record;
  v_cambio uuid;
  v_licencia uuid;
  v_suma numeric;
  v_n integer;
begin
  if p_cargos is null or jsonb_typeof(p_cargos) <> 'array' or jsonb_array_length(p_cargos) = 0 then
    raise exception 'registrar_compra_licencia: sin cargos';
  end if;
  if p_cuotas is null or jsonb_typeof(p_cuotas) <> 'array' or jsonb_array_length(p_cuotas) = 0 then
    raise exception 'registrar_compra_licencia: sin cuotas';
  end if;

  select sc.id, sc.estado, sc.parametros, sc.negocio_id, sc.workspace_id, sc.workspace_pagador_id
    into v_sc
    from public.servicios_contratados sc
   where sc.id = p_servicio_contratado_id
   for update;
  if not found then raise exception 'registrar_compra_licencia: contrato inexistente'; end if;
  if v_sc.estado <> 'activo' then raise exception 'registrar_compra_licencia: contrato no activo (%)', v_sc.estado; end if;
  if (v_sc.parametros->>'licencias') is null or (v_sc.parametros->>'licencias')::integer <> p_licencias_antes then
    raise exception 'licencias_cambiaron: el contrato tiene % licencias y se esperaban %', v_sc.parametros->>'licencias', p_licencias_antes;
  end if;
  if (v_sc.parametros->>'valor_usuario_adicional') is null
     or (v_sc.parametros->>'valor_usuario_adicional')::numeric <> p_valor then
    raise exception 'valor_distinto: el contrato no declara % como valor del usuario adicional', p_valor;
  end if;

  -- Cada cargo va a una cuota declarada en p_cuotas.
  select count(*) into v_n
    from jsonb_array_elements(p_cargos) c
   where not exists (select 1 from jsonb_array_elements(p_cuotas) q where q->>'cuota_id' = c->>'cuota_id');
  if v_n > 0 then raise exception 'registrar_compra_licencia: hay cargos sin su cuota'; end if;

  for r in select * from jsonb_to_recordset(p_cuotas) as x(cuota_id uuid, monto_antes numeric, monto_nuevo numeric, concepto_nuevo text)
  loop
    select q.id, q.monto, q.numero, q.plan_cobro_id
      into v_q
      from public.plan_cobro_cuotas q
      join public.planes_cobro p on p.id = q.plan_cobro_id
     where q.id = r.cuota_id
       and p.negocio_id = v_sc.negocio_id
       and p.workspace_id = v_sc.workspace_id
     for update of q;
    if not found then raise exception 'registrar_compra_licencia: la cuota % no es de este contrato', r.cuota_id; end if;
    if v_q.monto <> r.monto_antes then
      raise exception 'cuota_cambio: la cuota % vale % y se esperaba %', v_q.numero, v_q.monto, r.monto_antes;
    end if;
    -- El emisor no valida pagos: una cuota con un cobro vivo no cambia de monto.
    if exists (
      select 1 from public.cobros c
       where c.plan_cobro_id = v_q.plan_cobro_id and c.numero_cuota = v_q.numero and c.anulado_at is null
    ) then
      raise exception 'cuota_con_cobro: la cuota % ya tiene un cobro', v_q.numero;
    end if;
    select coalesce(sum((c->>'monto')::numeric), 0) into v_suma
      from jsonb_array_elements(p_cargos) c where (c->>'cuota_id')::uuid = r.cuota_id;
    if r.monto_nuevo - r.monto_antes <> v_suma or v_suma <= 0 then
      raise exception 'registrar_compra_licencia: la cuota % sube % y sus cargos suman %', v_q.numero, r.monto_nuevo - r.monto_antes, v_suma;
    end if;
    if r.concepto_nuevo is null or length(btrim(r.concepto_nuevo)) = 0 then
      raise exception 'registrar_compra_licencia: la cuota % queda sin concepto', v_q.numero;
    end if;
  end loop;

  insert into public.servicios_contratados_cambios (servicio_contratado_id, campo, valor_anterior, valor_nuevo, motivo, registrado_por)
  values (
    v_sc.id, 'licencias',
    jsonb_build_object('licencias', p_licencias_antes),
    jsonb_build_object(
      'licencias', p_licencias_antes + 1,
      'cantidad', 1,
      'valor_usuario_adicional', p_valor,
      'fecha_compra', p_fecha,
      'cargos', p_cargos
    ),
    p_motivo, p_registrado_por
  )
  returning id into v_cambio;

  insert into public.licencias_adicionales (servicio_contratado_id, valor_mensual, fecha_compra, comprada_por, cambio_compra_id)
  values (v_sc.id, p_valor, p_fecha, p_registrado_por, v_cambio)
  returning id into v_licencia;

  insert into public.licencias_adicionales_cargos
    (licencia_id, plan_cobro_cuota_id, tipo, periodo_desde, periodo_hasta, dias, dias_periodo, monto)
  select v_licencia, x.cuota_id, x.tipo, x.periodo_desde, x.periodo_hasta, x.dias, x.dias_periodo, x.monto
    from jsonb_to_recordset(p_cargos) as x(cuota_id uuid, tipo text, periodo_desde date, periodo_hasta date, dias integer, dias_periodo integer, monto numeric);

  update public.plan_cobro_cuotas q
     set monto = x.monto_nuevo, concepto_detalle = x.concepto_nuevo, updated_at = now()
    from jsonb_to_recordset(p_cuotas) as x(cuota_id uuid, monto_antes numeric, monto_nuevo numeric, concepto_nuevo text)
   where q.id = x.cuota_id;

  update public.servicios_contratados
     set parametros = jsonb_set(parametros, '{licencias}', to_jsonb(p_licencias_antes + 1)),
         actualizado_por = p_registrado_por
   where id = v_sc.id;

  -- `max_seats` es el límite que lee el resto de ONE: se mantiene igual al del contrato.
  if v_sc.workspace_pagador_id is not null then
    update public.workspaces set max_seats = p_licencias_antes + 1 where id = v_sc.workspace_pagador_id;
  end if;

  return v_licencia;
end;
$$;

-- server-only: la llama el servidor con service_role después de exigir la solicitud expresa y el rol de quien la pide.
revoke execute on function public.registrar_compra_licencia(uuid, uuid, date, numeric, integer, jsonb, jsonb, text)
  from public, anon, authenticated;
grant execute on function public.registrar_compra_licencia(uuid, uuid, date, numeric, integer, jsonb, jsonb, text)
  to service_role;

comment on function public.registrar_compra_licencia(uuid, uuid, date, numeric, integer, jsonb, jsonb, text) is
  'Compra de un usuario adicional (cláusula 2.3) en una transacción: bitácora, licencia, cargos, cuotas, licencias del contrato y max_seats. La aritmética viene del servidor; aquí se comprueba con las filas bloqueadas.';


-- ── 7. Registrar el retiro de una licencia adicional ────────────────────────────────────

create or replace function public.registrar_retiro_licencia(
  p_licencia_id uuid,
  p_registrado_por uuid,
  p_fecha date,
  -- Los cargos que se anulan (de periodos posteriores al del retiro, en cuotas sin cobro).
  p_cargos_anular uuid[],
  -- [{cuota_id, monto_antes, monto_nuevo, concepto_nuevo}]
  p_cuotas jsonb,
  p_licencias_antes integer,
  p_motivo text
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_lic record;
  v_sc record;
  v_q record;
  r record;
  v_cambio uuid;
  v_suma numeric;
  v_n integer;
begin
  select l.id, l.servicio_contratado_id, l.fecha_retiro, l.fecha_compra
    into v_lic
    from public.licencias_adicionales l
   where l.id = p_licencia_id
   for update;
  if not found then raise exception 'registrar_retiro_licencia: licencia inexistente'; end if;
  if v_lic.fecha_retiro is not null then raise exception 'licencia_ya_retirada'; end if;
  if p_fecha < v_lic.fecha_compra then raise exception 'registrar_retiro_licencia: fecha anterior a la compra'; end if;

  select sc.id, sc.parametros, sc.negocio_id, sc.workspace_id, sc.workspace_pagador_id
    into v_sc
    from public.servicios_contratados sc
   where sc.id = v_lic.servicio_contratado_id
   for update;
  if (v_sc.parametros->>'licencias') is null or (v_sc.parametros->>'licencias')::integer <> p_licencias_antes then
    raise exception 'licencias_cambiaron: el contrato tiene % licencias y se esperaban %', v_sc.parametros->>'licencias', p_licencias_antes;
  end if;
  if p_licencias_antes < 2 then raise exception 'registrar_retiro_licencia: el contrato quedaría sin licencias'; end if;

  -- Cada cargo a anular es de esta licencia y está vivo.
  select count(*) into v_n
    from unnest(coalesce(p_cargos_anular, '{}'::uuid[])) as a(id)
   where not exists (
     select 1 from public.licencias_adicionales_cargos c
      where c.id = a.id and c.licencia_id = p_licencia_id and c.anulado_at is null
   );
  if v_n > 0 then raise exception 'registrar_retiro_licencia: hay cargos que no son de esta licencia o ya están anulados'; end if;

  for r in select * from jsonb_to_recordset(coalesce(p_cuotas, '[]'::jsonb)) as x(cuota_id uuid, monto_antes numeric, monto_nuevo numeric, concepto_nuevo text)
  loop
    select q.id, q.monto, q.numero, q.plan_cobro_id
      into v_q
      from public.plan_cobro_cuotas q
      join public.planes_cobro p on p.id = q.plan_cobro_id
     where q.id = r.cuota_id and p.negocio_id = v_sc.negocio_id and p.workspace_id = v_sc.workspace_id
     for update of q;
    if not found then raise exception 'registrar_retiro_licencia: la cuota % no es de este contrato', r.cuota_id; end if;
    if v_q.monto <> r.monto_antes then
      raise exception 'cuota_cambio: la cuota % vale % y se esperaba %', v_q.numero, v_q.monto, r.monto_antes;
    end if;
    if exists (
      select 1 from public.cobros c
       where c.plan_cobro_id = v_q.plan_cobro_id and c.numero_cuota = v_q.numero and c.anulado_at is null
    ) then
      raise exception 'cuota_con_cobro: la cuota % ya tiene un cobro', v_q.numero;
    end if;
    select coalesce(sum(c.monto), 0) into v_suma
      from public.licencias_adicionales_cargos c
     where c.id = any(p_cargos_anular) and c.plan_cobro_cuota_id = r.cuota_id;
    if r.monto_antes - r.monto_nuevo <> v_suma or r.monto_nuevo <= 0 then
      raise exception 'registrar_retiro_licencia: la cuota % baja % y sus cargos anulados suman %', v_q.numero, r.monto_antes - r.monto_nuevo, v_suma;
    end if;
  end loop;

  -- Cada cargo anulado pertenece a una cuota declarada.
  select count(*) into v_n
    from public.licencias_adicionales_cargos c
   where c.id = any(coalesce(p_cargos_anular, '{}'::uuid[]))
     and not exists (select 1 from jsonb_array_elements(coalesce(p_cuotas, '[]'::jsonb)) q where (q->>'cuota_id')::uuid = c.plan_cobro_cuota_id);
  if v_n > 0 then raise exception 'registrar_retiro_licencia: hay cargos anulados sin su cuota'; end if;

  insert into public.servicios_contratados_cambios (servicio_contratado_id, campo, valor_anterior, valor_nuevo, motivo, registrado_por)
  values (
    v_sc.id, 'licencias',
    jsonb_build_object('licencias', p_licencias_antes),
    jsonb_build_object(
      'licencias', p_licencias_antes - 1,
      'licencia_retirada', p_licencia_id,
      'fecha_retiro', p_fecha,
      'cargos_anulados', to_jsonb(coalesce(p_cargos_anular, '{}'::uuid[]))
    ),
    p_motivo, p_registrado_por
  )
  returning id into v_cambio;

  update public.licencias_adicionales_cargos
     set anulado_at = now(), cambio_anulacion_id = v_cambio
   where id = any(coalesce(p_cargos_anular, '{}'::uuid[]));

  update public.licencias_adicionales
     set fecha_retiro = p_fecha, retirada_por = p_registrado_por, cambio_retiro_id = v_cambio
   where id = p_licencia_id;

  update public.plan_cobro_cuotas q
     set monto = x.monto_nuevo, concepto_detalle = x.concepto_nuevo, updated_at = now()
    from jsonb_to_recordset(coalesce(p_cuotas, '[]'::jsonb)) as x(cuota_id uuid, monto_antes numeric, monto_nuevo numeric, concepto_nuevo text)
   where q.id = x.cuota_id;

  update public.servicios_contratados
     set parametros = jsonb_set(parametros, '{licencias}', to_jsonb(p_licencias_antes - 1)),
         actualizado_por = p_registrado_por
   where id = v_sc.id;

  if v_sc.workspace_pagador_id is not null then
    update public.workspaces set max_seats = p_licencias_antes - 1 where id = v_sc.workspace_pagador_id;
  end if;

  return v_cambio;
end;
$$;

-- server-only: la llama el servidor con service_role al retirar a un usuario, si quien retira decide dejar de pagar la licencia adicional.
revoke execute on function public.registrar_retiro_licencia(uuid, uuid, date, uuid[], jsonb, integer, text)
  from public, anon, authenticated;
grant execute on function public.registrar_retiro_licencia(uuid, uuid, date, uuid[], jsonb, integer, text)
  to service_role;

comment on function public.registrar_retiro_licencia(uuid, uuid, date, uuid[], jsonb, integer, text) is
  'Retiro de un usuario adicional: deja de cobrarse desde el periodo siguiente (anula los cargos de cuotas sin cobro), baja las licencias del contrato y max_seats, y deja la fila en la bitácora.';
