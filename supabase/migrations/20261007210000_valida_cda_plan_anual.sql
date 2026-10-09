-- ============================================================
-- 20261007210000 — Plan Anual de VALIDA · Plan CDA: la elección con su aceptación, y la activación
--
-- Decisión de Mauricio del 2026-10-06 (proyectos/metrik/valida/decisions.md): 12 períodos por
-- $1.650.000 (11 x 12), oferta hasta el 2027-03-31, elegida en la plataforma antes de pagar. Anexo del
-- Plan Anual (Emilio; textos finales aprobados por Legal y por Vera el 2026-10-07): v1 para los Términos
-- v1.3/v1.4 y el de los Términos v2.0 CDA vía AFI. Copias en docs/legal/plan-anual/.
--
-- ## Qué escribe: DDL y funciones. Ni una fila de datos.
--
-- Nada cambia para nadie al aplicarla: la oferta solo se muestra en un contrato con
-- `parametros.plan_anual_habilitado = true` (dato que hoy ningún contrato tiene), y sin una elección
-- pagada ninguna función de aquí se llama.
--
-- ## Las piezas
--
--   1. `plan_cobro_cuotas` admite dos tipos nuevos:
--        · `anual`: la cuota única de los 12 períodos, a la que se ata el cobro pagado. Una cuota, una
--          factura (`facturas_cuota`, carga manual).
--        · `usuarios_adicionales`: la cuota mensual de un período cubierto por el plan, que ya no cobra
--          el servicio sino solo los usuarios adicionales (anexo 5.2). Puede valer CERO (sin usuarios
--          adicionales): existe para que una compra de usuario adicional durante el plan tenga dónde
--          cargarse, por la misma maquinaria de `registrar_compra_licencia`. Una cuota en cero no la
--          lee el reparto FIFO, no recibe enlace ni cuenta de cobro, y no se pinta.
--      Por eso `monto > 0` pasa a `monto > 0 o (usuarios_adicionales y monto >= 0)`, y el rango del IVA
--      admite `iva = 0` sobre una cuota en cero.
--   2. `planes_anuales_cda` — una fila por elección: la constancia de la aceptación del anexo (anexo
--      13.2: fecha y hora, usuario, IP, dispositivo, versión y huella SHA-256 del texto, las fechas del
--      plazo, la referencia del enlace y si se dio o no la autorización de mención) y su estado
--      (`elegido` → `activo`, o `sin_efecto` / `requiere_revision`). Lo aceptado no se modifica ni se
--      borra (trigger).
--   2b. `autorizaciones_mencion_cda` — la autorización de mención del numeral 11 del anexo, «registrada
--      aparte» (13.2): una fila por elección (la de la casilla del anexo, que la escribe un trigger al
--      insertar la elección) y una por cada cambio posterior en /suscripcion (revocar o volver a dar).
--      Solo inserción. `v_autorizacion_mencion_cda` dice la vigente por contrato: la consulta Mateo/Sami
--      antes de publicar un logo.
--   3. `activar_plan_anual_cda(...)` — al aprobarse el pago: en UNA transacción, las cuotas mensuales
--      del plazo pasan a `usuarios_adicionales` por lo que sumen sus cargos de licencias, se crean las
--      de los períodos que faltaban (en cero), se anulan los cobros programados SIN pagar de esas
--      cuotas (un enlace mensual ya emitido), se crea la cuota `anual` y se le ata el cobro pagado. La
--      aritmética la hace el servidor (`src/lib/valida-cda/plan-anual.ts`, con pruebas); la función
--      vuelve a comprobar con las filas bloqueadas que nada cambió. En la misma transacción, la fecha
--      de la cláusula 12.1 (`servicios_contratados.vigente_hasta`) pasa al fin del Plazo Anual si llegaba
--      antes (anexo v1, 3.3; Maxitec: del 21-dic-2026 al fin de su año), con su fila en
--      `servicios_contratados_cambios`. Nunca la acorta.
--   4. `registrar_retiro_licencia(...)` — el mismo cuerpo de 20260924060000 con UN cambio: una cuota
--      `usuarios_adicionales` puede quedar en cero al retirar su único usuario adicional (antes el
--      retiro exigía que la cuota quedara en más de cero, porque toda cuota cobraba el servicio).
--
-- ## Por qué la aceptación NO va en `aceptaciones_terminos` ni el anexo en `documentos_contractuales_versiones`
--
-- Un documento de `documentos_contractuales_versiones` visible para un CDA es un documento que la
-- entrada de `/valida` le EXIGE aceptar para operar (`estadoTerminos` pide todos los vigentes
-- visibles): registrar el anexo ahí cerraría Valida a los cuatro CDA hasta que lo firmaran. Y la guarda
-- de `aceptaciones_terminos` (canal módulo) exige una versión vigente con su PDF y huellas. El anexo es
-- opcional, sigue en borrador y no tiene PDF. La constancia guarda lo mismo (quién, cuándo, desde dónde,
-- el texto exacto con su SHA-256 y el slug y la versión del documento) en su propia tabla, inmutable.
-- Cuando el anexo se publique, su versión se puede registrar y atar por `documento_texto_sha256`.
--
-- ## Datos existentes que toca
--
-- Ninguno al aplicarla. Al activarse un plan (después de un pago aprobado): las cuotas mensuales de
-- los 12 períodos de ESE contrato cambian de tipo y monto, se crean cuotas nuevas, los cobros
-- programados sin pagar de esas cuotas quedan anulados y el `vigente_hasta` de ESE contrato pasa al fin
-- del Plazo Anual. Las cuotas de otros períodos, los pagos ya
-- recibidos, las facturas y los demás contratos no se tocan.
--
-- ## Verificación después de aplicar (solo lectura)
--
--   select conname, pg_get_constraintdef(oid) from pg_constraint
--    where conrelid = 'public.plan_cobro_cuotas'::regclass and contype = 'c' order by 1;
--     -> plan_cobro_cuotas_tipo (4 tipos), plan_cobro_cuotas_monto, plan_cobro_cuotas_iva_rango nuevo
--   select relname, relrowsecurity, relacl::text from pg_class
--    where oid in ('public.planes_anuales_cda'::regclass, 'public.autorizaciones_mencion_cda'::regclass);
--     -> true, sin anon ni authenticated
--   select relname, reloptions from pg_class where oid = 'public.v_autorizacion_mencion_cda'::regclass;
--     -> {security_invoker=on}
--   select p.proname, p.proacl::text from pg_proc p join pg_namespace n on n.oid = p.pronamespace
--    where n.nspname = 'public' and p.proname in ('activar_plan_anual_cda', 'registrar_retiro_licencia',
--                                                 'planes_anuales_cda_guardas', 'planes_anuales_cda_mencion',
--                                                 'autorizaciones_mencion_cda_inmutable');
--     -> sin `anon=`, sin `authenticated=` y sin `=X/`
--   select count(*) from public.plan_cobro_cuotas where tipo not in ('anticipo', 'cuota');  -> 0
--
-- ## Cómo revertir (mientras ningún plan se haya activado)
--
--   drop function public.activar_plan_anual_cda(uuid, uuid, jsonb);
--   drop view public.v_autorizacion_mencion_cda;
--   drop table public.autorizaciones_mencion_cda;
--   drop table public.planes_anuales_cda;
--   -- registrar_retiro_licencia: re-crear con el cuerpo de 20260924060000.
--   alter table public.plan_cobro_cuotas drop constraint plan_cobro_cuotas_tipo,
--     drop constraint plan_cobro_cuotas_monto, drop constraint plan_cobro_cuotas_iva_rango;
--   alter table public.plan_cobro_cuotas
--     add constraint plan_cobro_cuotas_tipo_check check (tipo in ('anticipo', 'cuota')),
--     add constraint plan_cobro_cuotas_monto_check check (monto > 0),
--     add constraint plan_cobro_cuotas_iva_rango check (iva >= 0 and iva < monto);
-- ============================================================


-- ── 1. Los tipos y el monto de las cuotas ─────────────────────────────────────────────────

-- Los CHECK de columna de 20260630000001 nacieron sin nombre explícito: PostgreSQL los llamó
-- `<tabla>_<columna>_check`. Se buscan por definición para no depender de ese nombre.
do $$
declare
  r record;
begin
  for r in
    select conname
      from pg_constraint
     where conrelid = 'public.plan_cobro_cuotas'::regclass
       and contype = 'c'
       and (
         pg_get_constraintdef(oid) ilike '%anticipo%'
         or pg_get_constraintdef(oid) ~* '^check \(\(monto > \(?0\)?(::numeric)?\)\)$'
         or conname = 'plan_cobro_cuotas_iva_rango'
       )
  loop
    execute format('alter table public.plan_cobro_cuotas drop constraint %I', r.conname);
  end loop;
end;
$$;

alter table public.plan_cobro_cuotas
  add constraint plan_cobro_cuotas_tipo
    check (tipo in ('anticipo', 'cuota', 'anual', 'usuarios_adicionales')),
  add constraint plan_cobro_cuotas_monto
    check (monto > 0 or (tipo = 'usuarios_adicionales' and monto >= 0)),
  add constraint plan_cobro_cuotas_iva_rango
    check (iva >= 0 and (iva < monto or (monto = 0 and iva = 0)));

-- Ningún otro CHECK sobre `monto` puede haber sobrevivido: rechazaría la cuota en cero.
do $$
begin
  if exists (
    select 1 from pg_constraint
     where conrelid = 'public.plan_cobro_cuotas'::regclass and contype = 'c'
       and conname not in ('plan_cobro_cuotas_tipo', 'plan_cobro_cuotas_monto', 'plan_cobro_cuotas_iva_rango')
       and pg_get_constraintdef(oid) ~* '(monto|tipo)'
  ) then
    raise exception 'plan_cobro_cuotas conserva un CHECK viejo sobre monto o tipo: revisar antes de seguir';
  end if;
end;
$$;

comment on column public.plan_cobro_cuotas.tipo is
  'anticipo | cuota | anual (la cuota única del Plan Anual de Valida CDA) | usuarios_adicionales (período cubierto por el Plan Anual: cobra solo los usuarios adicionales; puede valer 0).';


-- ── 2. Las elecciones del Plan Anual ──────────────────────────────────────────────────────

create table public.planes_anuales_cda (
  id uuid primary key default gen_random_uuid(),

  -- Donde viven el plan, las cuotas y los cobros: el espacio que COBRA (metrik).
  workspace_id uuid not null references public.workspaces(id),
  -- El espacio del CDA que elige y paga.
  workspace_cliente_id uuid not null references public.workspaces(id),
  servicio_contratado_id uuid not null references public.servicios_contratados(id),
  negocio_id uuid not null references public.negocios(id),
  plan_cobro_id uuid not null references public.planes_cobro(id),

  estado text not null default 'elegido'
    constraint planes_anuales_estado check (estado in ('elegido', 'activo', 'sin_efecto', 'requiere_revision')),

  -- El Plazo Anual, fijado al aceptar (anexo 3.1).
  periodo_desde date not null,
  periodo_hasta date not null,
  periodos integer not null default 12
    constraint planes_anuales_periodos check (periodos = 12),
  monto numeric not null
    constraint planes_anuales_monto check (monto > 0),
  precio_lista numeric not null
    constraint planes_anuales_precio_lista check (precio_lista >= monto),
  constraint planes_anuales_plazo check (periodo_desde < periodo_hasta),

  -- ── La constancia de la aceptación (anexo 13.2) ──
  documento_slug text not null
    constraint planes_anuales_slug check (length(btrim(documento_slug)) between 1 and 80),
  documento_version text not null,
  -- La huella de la PLANTILLA del anexo (sin datos): identifica la versión del documento.
  documento_texto_sha256 text not null
    constraint planes_anuales_doc_sha check (documento_texto_sha256 ~ '^[0-9a-f]{64}$'),
  -- El anexo con los datos del cliente y las fechas, tal como se mostró, y su huella.
  texto_anexo text not null,
  texto_anexo_sha256 text not null
    constraint planes_anuales_anexo_sha check (texto_anexo_sha256 ~ '^[0-9a-f]{64}$'),
  -- El texto de la casilla marcada, y su huella.
  texto_aceptacion text not null
    constraint planes_anuales_aceptacion_largo check (char_length(texto_aceptacion) between 1 and 2000),
  texto_aceptacion_sha256 text not null
    constraint planes_anuales_aceptacion_sha check (texto_aceptacion_sha256 ~ '^[0-9a-f]{64}$'),
  -- La autorización de mención (numeral 11): casilla SEPARADA, desmarcada por defecto, que no condiciona
  -- nada. Se guarda la respuesta y el texto que se mostró; el trigger la copia a `autorizaciones_mencion_cda`.
  autoriza_mencion boolean not null,
  texto_mencion text not null
    constraint planes_anuales_mencion_largo check (char_length(texto_mencion) between 1 and 1000),
  texto_mencion_sha256 text not null
    constraint planes_anuales_mencion_sha check (texto_mencion_sha256 ~ '^[0-9a-f]{64}$'),
  -- La persona REAL de la sesión (nunca la de «Ver como»), con lo que escribió.
  usuario_id uuid not null references public.profiles(id),
  nombre_aceptante text not null
    constraint planes_anuales_nombre check (length(btrim(nombre_aceptante)) between 5 and 120),
  tipo_documento text not null
    constraint planes_anuales_tipo_doc check (tipo_documento in ('CC', 'CE', 'PA')),
  numero_documento text not null
    constraint planes_anuales_numero_doc check (numero_documento ~ '^[A-Z0-9]{5,15}$'),
  ip text,
  user_agent text,
  aceptado_at timestamptz not null default now(),

  -- ── El pago ──
  -- El cobro programado de $1.650.000 con el enlace. Uno por elección.
  cobro_id uuid unique references public.cobros(id),
  enlace_referencia text,
  enlace_expira timestamptz,
  fecha_pago date,
  cuota_anual_id uuid references public.plan_cobro_cuotas(id),
  activado_at timestamptz,
  -- Por qué quedó sin efecto o en revisión (p. ej. pagado con cuotas vencidas: se devuelve, anexo 2.2).
  detalle text,

  created_at timestamptz not null default now(),

  constraint planes_anuales_activo_completo check (
    (estado = 'activo') = (activado_at is not null and cuota_anual_id is not null and fecha_pago is not null and cobro_id is not null)
  )
);

alter table public.planes_anuales_cda enable row level security;
-- server-only: la escribe el servidor (la acción de /suscripcion de la persona designada y el webhook de la pasarela con service_role) y la lee el servidor tras exigir el contexto de la suscripción.
revoke all on table public.planes_anuales_cda from public, anon, authenticated;

-- Una sola elección esperando pago por contrato.
create unique index uq_planes_anuales_elegido
  on public.planes_anuales_cda (servicio_contratado_id) where estado = 'elegido';
create index idx_planes_anuales_contrato on public.planes_anuales_cda (servicio_contratado_id, estado);

comment on table public.planes_anuales_cda is
  'Plan Anual de Valida CDA: la elección con la constancia de la aceptación del anexo (texto, huellas, persona, IP, dispositivo, fechas del plazo, enlace) y su estado. Lo aceptado es evidencia: no se modifica ni se borra.';

-- Lo aceptado no cambia: solo el estado, el pago y su detalle. Y no se borra.
create or replace function public.planes_anuales_cda_guardas()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'planes_anuales_cda %: es la constancia de una aceptación; no se borra', old.id;
  end if;
  if new.workspace_id            is distinct from old.workspace_id
  or new.workspace_cliente_id    is distinct from old.workspace_cliente_id
  or new.servicio_contratado_id  is distinct from old.servicio_contratado_id
  or new.negocio_id              is distinct from old.negocio_id
  or new.plan_cobro_id           is distinct from old.plan_cobro_id
  or new.periodo_desde           is distinct from old.periodo_desde
  or new.periodo_hasta           is distinct from old.periodo_hasta
  or new.periodos                is distinct from old.periodos
  or new.monto                   is distinct from old.monto
  or new.precio_lista            is distinct from old.precio_lista
  or new.documento_slug          is distinct from old.documento_slug
  or new.documento_version       is distinct from old.documento_version
  or new.documento_texto_sha256  is distinct from old.documento_texto_sha256
  or new.texto_anexo             is distinct from old.texto_anexo
  or new.texto_anexo_sha256      is distinct from old.texto_anexo_sha256
  or new.texto_aceptacion        is distinct from old.texto_aceptacion
  or new.texto_aceptacion_sha256 is distinct from old.texto_aceptacion_sha256
  or new.autoriza_mencion        is distinct from old.autoriza_mencion
  or new.texto_mencion           is distinct from old.texto_mencion
  or new.texto_mencion_sha256    is distinct from old.texto_mencion_sha256
  or new.usuario_id              is distinct from old.usuario_id
  or new.nombre_aceptante        is distinct from old.nombre_aceptante
  or new.tipo_documento          is distinct from old.tipo_documento
  or new.numero_documento        is distinct from old.numero_documento
  or new.ip                      is distinct from old.ip
  or new.user_agent              is distinct from old.user_agent
  or new.aceptado_at             is distinct from old.aceptado_at
  or new.created_at              is distinct from old.created_at
  then
    raise exception 'planes_anuales_cda %: lo aceptado no cambia', old.id;
  end if;
  -- Un enlace, una vez puesto, no se cambia por otro: el pago se busca por él.
  if old.cobro_id is not null and new.cobro_id is distinct from old.cobro_id then
    raise exception 'planes_anuales_cda %: el cobro del plan no cambia', old.id;
  end if;
  -- Activo es definitivo.
  if old.estado = 'activo' and new.estado <> 'activo' then
    raise exception 'planes_anuales_cda %: un plan activo no vuelve atrás', old.id;
  end if;
  return new;
end;
$$;

revoke execute on function public.planes_anuales_cda_guardas() from public, anon, authenticated;

create trigger trg_planes_anuales_cda_guardas
  before update or delete on public.planes_anuales_cda
  for each row execute function public.planes_anuales_cda_guardas();


-- ── 2b. La autorización de mención (anexo, numeral 11), registrada aparte ──────────────────

create table public.autorizaciones_mencion_cda (
  id uuid primary key default gen_random_uuid(),
  servicio_contratado_id uuid not null references public.servicios_contratados(id),
  -- El espacio del CDA.
  workspace_cliente_id uuid not null references public.workspaces(id),
  -- La elección del plan anual en la que se dio o a la que pertenece el cambio.
  plan_anual_id uuid references public.planes_anuales_cda(id),
  -- `anexo_plan_anual`: la casilla del anexo al elegir (cuenta solo si ese plan se activa).
  -- `suscripcion`: un cambio posterior en /suscripcion (revocar, o volver a darla).
  origen text not null
    constraint autorizaciones_mencion_origen check (origen in ('anexo_plan_anual', 'suscripcion')),
  autoriza boolean not null,
  texto text not null
    constraint autorizaciones_mencion_texto check (char_length(texto) between 1 and 1000),
  texto_sha256 text not null
    constraint autorizaciones_mencion_sha check (texto_sha256 ~ '^[0-9a-f]{64}$'),
  usuario_id uuid not null references public.profiles(id),
  ip text,
  user_agent text,
  created_at timestamptz not null default now(),
  constraint autorizaciones_mencion_anexo_con_plan check (origen <> 'anexo_plan_anual' or plan_anual_id is not null)
);

alter table public.autorizaciones_mencion_cda enable row level security;
-- server-only: la escriben el trigger de la elección y la acción de /suscripcion de la persona designada (service_role); la lee el servidor y quien consulta antes de publicar un logo.
revoke all on table public.autorizaciones_mencion_cda from public, anon, authenticated;

create index idx_autorizaciones_mencion_contrato
  on public.autorizaciones_mencion_cda (servicio_contratado_id, created_at desc);

comment on table public.autorizaciones_mencion_cda is
  'Autorización de mención del numeral 11 del Anexo del Plan Anual de Valida CDA (razón social y logo en material comercial): voluntaria, revocable. Solo inserción: la vigente es la última que cuenta (v_autorizacion_mencion_cda).';

create or replace function public.autorizaciones_mencion_cda_inmutable()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'autorizaciones_mencion_cda %: es la constancia de una autorización; no se cambia ni se borra (se registra otra)',
    coalesce(old.id, new.id);
end;
$$;

revoke execute on function public.autorizaciones_mencion_cda_inmutable() from public, anon, authenticated;

create trigger trg_autorizaciones_mencion_cda_inmutable
  before update or delete on public.autorizaciones_mencion_cda
  for each row execute function public.autorizaciones_mencion_cda_inmutable();

-- La casilla del anexo se registra aparte en la MISMA transacción que la elección.
create or replace function public.planes_anuales_cda_mencion()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  insert into public.autorizaciones_mencion_cda (
    servicio_contratado_id, workspace_cliente_id, plan_anual_id, origen, autoriza, texto, texto_sha256,
    usuario_id, ip, user_agent, created_at
  ) values (
    new.servicio_contratado_id, new.workspace_cliente_id, new.id, 'anexo_plan_anual', new.autoriza_mencion,
    new.texto_mencion, new.texto_mencion_sha256, new.usuario_id, new.ip, new.user_agent, new.aceptado_at
  );
  return new;
end;
$$;

revoke execute on function public.planes_anuales_cda_mencion() from public, anon, authenticated;

create trigger trg_planes_anuales_cda_mencion
  after insert on public.planes_anuales_cda
  for each row execute function public.planes_anuales_cda_mencion();

-- La vigente por contrato: la última que cuenta. La del anexo cuenta solo si su plan se activó (una
-- elección que no se pagó no dejó anexo vigente); un cambio en /suscripcion cuenta siempre. `vigente` =
-- autoriza Y el contrato sigue activo (11.4: «dura mientras el Cliente lo sea»).
--   select * from public.v_autorizacion_mencion_cda where vigente;   -- antes de publicar un logo
create view public.v_autorizacion_mencion_cda with (security_invoker = on) as
select distinct on (a.servicio_contratado_id)
       a.servicio_contratado_id,
       a.workspace_cliente_id,
       sc.empresa_id,
       a.autoriza,
       a.autoriza and sc.estado = 'activo' as vigente,
       a.origen,
       a.texto,
       a.usuario_id,
       a.created_at
  from public.autorizaciones_mencion_cda a
  join public.servicios_contratados sc on sc.id = a.servicio_contratado_id
  left join public.planes_anuales_cda p on p.id = a.plan_anual_id
 where a.origen = 'suscripcion' or p.estado = 'activo'
 order by a.servicio_contratado_id, a.created_at desc, a.id desc;

-- server-only: la lee el servidor con service_role (security_invoker y sin grant: authenticated no la ve).
revoke all on table public.v_autorizacion_mencion_cda from public, anon, authenticated;


-- ── 3. Activar el plan al aprobarse el pago ───────────────────────────────────────────────

create or replace function public.activar_plan_anual_cda(
  p_plan_anual_id uuid,
  p_cobro_id uuid,
  -- {
  --   actualizar: [{id, monto_esperado, tipo_esperado, monto, concepto}],
  --   insertar:   [{numero, tipo, monto, fecha_vencimiento, concepto}],
  --   anular_cobros: [uuid],
  --   cuota_anual: {numero, tipo, monto, fecha_vencimiento, concepto}
  -- }
  p_cambios jsonb
)
returns text
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_pa record;
  v_cobro record;
  v_q record;
  r record;
  v_suma numeric;
  v_anual record;
  v_cuota_anual uuid;
  v_n integer;
  v_sc record;
  v_hasta date;
begin
  select * into v_pa from public.planes_anuales_cda where id = p_plan_anual_id for update;
  if not found then raise exception 'activar_plan_anual_cda: elección inexistente'; end if;
  if v_pa.estado = 'activo' then return 'ya_activo'; end if;
  if v_pa.estado <> 'elegido' then
    raise exception 'activar_plan_anual_cda: la elección está %', v_pa.estado;
  end if;
  if v_pa.cobro_id is distinct from p_cobro_id then
    raise exception 'activar_plan_anual_cda: el cobro % no es el de esta elección', p_cobro_id;
  end if;

  -- El cobro del plan, pagado y vivo, del mismo plan y sin cuota todavía.
  select c.id, c.fecha, c.anulado_at, c.plan_cobro_id, c.numero_cuota, c.tipo_cobro, c.negocio_id, c.workspace_id
    into v_cobro
    from public.cobros c
   where c.id = p_cobro_id
   for update;
  if not found then raise exception 'activar_plan_anual_cda: cobro inexistente'; end if;
  if v_cobro.fecha is null or v_cobro.anulado_at is not null or v_cobro.tipo_cobro <> 'programado' then
    raise exception 'activar_plan_anual_cda: el cobro % no está pagado', p_cobro_id;
  end if;
  if v_cobro.plan_cobro_id is distinct from v_pa.plan_cobro_id or v_cobro.negocio_id <> v_pa.negocio_id
     or v_cobro.workspace_id <> v_pa.workspace_id then
    raise exception 'activar_plan_anual_cda: el cobro % no es de este contrato', p_cobro_id;
  end if;
  if v_cobro.numero_cuota is not null then
    raise exception 'activar_plan_anual_cda: el cobro % ya está atado a la cuota %', p_cobro_id, v_cobro.numero_cuota;
  end if;

  -- Las cuotas que cambian: del plan de la elección, sin tocar desde que el servidor las leyó, sin
  -- plata, y valiendo después exactamente lo que suman sus cargos vivos de licencias.
  for r in select * from jsonb_to_recordset(coalesce(p_cambios->'actualizar', '[]'::jsonb))
             as x(id uuid, monto_esperado numeric, tipo_esperado text, monto numeric, concepto text)
  loop
    select q.id, q.numero, q.monto, q.tipo
      into v_q
      from public.plan_cobro_cuotas q
     where q.id = r.id and q.plan_cobro_id = v_pa.plan_cobro_id
     for update;
    if not found then raise exception 'activar_plan_anual_cda: la cuota % no es de este plan', r.id; end if;
    if v_q.monto <> r.monto_esperado or v_q.tipo <> r.tipo_esperado or v_q.tipo <> 'cuota' then
      raise exception 'cuota_cambio: la cuota % (% %) cambió desde que se leyó', v_q.numero, v_q.tipo, v_q.monto;
    end if;
    -- Un cobro vivo de la cuota solo puede ser uno programado SIN pagar que se anula aquí.
    if exists (
      select 1 from public.cobros c
       where c.plan_cobro_id = v_pa.plan_cobro_id and c.numero_cuota = v_q.numero and c.anulado_at is null
         and (c.fecha is not null
              or not (c.id = any(coalesce(array(select jsonb_array_elements_text(p_cambios->'anular_cobros'))::uuid[], '{}'::uuid[]))))
    ) then
      raise exception 'cuota_con_cobro: la cuota % tiene un cobro pagado o no declarado', v_q.numero;
    end if;
    select coalesce(sum(c.monto), 0) into v_suma
      from public.licencias_adicionales_cargos c
     where c.plan_cobro_cuota_id = v_q.id and c.anulado_at is null;
    if r.monto <> v_suma then
      raise exception 'activar_plan_anual_cda: la cuota % quedaría en % y sus cargos de licencias suman %', v_q.numero, r.monto, v_suma;
    end if;
    if r.concepto is null or length(btrim(r.concepto)) = 0 then
      raise exception 'activar_plan_anual_cda: la cuota % queda sin concepto', v_q.numero;
    end if;
  end loop;

  -- Los cobros que se anulan: programados, sin pagar, de cuotas que cambian.
  select count(*) into v_n
    from jsonb_array_elements_text(coalesce(p_cambios->'anular_cobros', '[]'::jsonb)) a(id)
   where not exists (
     select 1 from public.cobros c
       join jsonb_to_recordset(coalesce(p_cambios->'actualizar', '[]'::jsonb)) as x(id uuid, monto_esperado numeric, tipo_esperado text, monto numeric, concepto text) on true
       join public.plan_cobro_cuotas q on q.id = x.id
      where c.id = a.id::uuid and c.tipo_cobro = 'programado' and c.fecha is null and c.anulado_at is null
        and c.plan_cobro_id = v_pa.plan_cobro_id and c.numero_cuota = q.numero
   );
  if v_n > 0 then raise exception 'activar_plan_anual_cda: hay cobros por anular que no son programados sin pagar de las cuotas que cambian'; end if;

  -- Las cuotas nuevas: solo de usuarios adicionales en cero, con número libre.
  for r in select * from jsonb_to_recordset(coalesce(p_cambios->'insertar', '[]'::jsonb))
             as x(numero integer, tipo text, monto numeric, fecha_vencimiento date, concepto text)
  loop
    if r.tipo <> 'usuarios_adicionales' or r.monto <> 0 then
      raise exception 'activar_plan_anual_cda: una cuota nueva del plazo nace como usuarios_adicionales en cero';
    end if;
  end loop;

  select * into v_anual
    from jsonb_to_record(p_cambios->'cuota_anual')
      as x(numero integer, tipo text, monto numeric, fecha_vencimiento date, concepto text);
  if v_anual.tipo is distinct from 'anual' or v_anual.monto is distinct from v_pa.monto
     or v_anual.numero is null or v_anual.fecha_vencimiento is null
     or v_anual.concepto is null or length(btrim(v_anual.concepto)) = 0 then
    raise exception 'activar_plan_anual_cda: la cuota anual no coincide con la elección';
  end if;

  -- ── Escrituras ──
  update public.cobros
     set anulado_at = now(),
         notas = concat_ws(' · ', nullif(notas, ''), 'Anulado: el período quedó cubierto por el plan anual')
   where id = any(coalesce(array(select jsonb_array_elements_text(p_cambios->'anular_cobros'))::uuid[], '{}'::uuid[]));

  update public.plan_cobro_cuotas q
     set tipo = 'usuarios_adicionales', monto = x.monto, iva = 0, concepto_detalle = x.concepto, updated_at = now()
    from jsonb_to_recordset(coalesce(p_cambios->'actualizar', '[]'::jsonb))
      as x(id uuid, monto_esperado numeric, tipo_esperado text, monto numeric, concepto text)
   where q.id = x.id;

  insert into public.plan_cobro_cuotas (workspace_id, plan_cobro_id, numero, tipo, monto, fecha_vencimiento, concepto_detalle)
  select v_pa.workspace_id, v_pa.plan_cobro_id, x.numero, x.tipo, x.monto, x.fecha_vencimiento, x.concepto
    from jsonb_to_recordset(coalesce(p_cambios->'insertar', '[]'::jsonb))
      as x(numero integer, tipo text, monto numeric, fecha_vencimiento date, concepto text);

  insert into public.plan_cobro_cuotas (workspace_id, plan_cobro_id, numero, tipo, monto, fecha_vencimiento, concepto_detalle)
  values (v_pa.workspace_id, v_pa.plan_cobro_id, v_anual.numero, 'anual', v_anual.monto, v_anual.fecha_vencimiento, v_anual.concepto)
  returning id into v_cuota_anual;

  update public.cobros
     set numero_cuota = v_anual.numero, fecha_esperada = v_anual.fecha_vencimiento
   where id = p_cobro_id;

  update public.planes_anuales_cda
     set estado = 'activo', cuota_anual_id = v_cuota_anual, fecha_pago = v_cobro.fecha, activado_at = now(), detalle = null
   where id = p_plan_anual_id;

  -- La fecha de la cláusula 12.1 pasa al fin del Plazo Anual (anexo v1, 3.3): con el año pagado no puede
  -- asomar un fin de contrato antes de que el año termine. Nunca se acorta (`greatest` ignora el null:
  -- un contrato sin fecha también pasa al fin del plazo). Mismo criterio que `vigenteHastaConPlanAnual`.
  select sc.id, sc.vigente_hasta into v_sc
    from public.servicios_contratados sc
   where sc.id = v_pa.servicio_contratado_id
   for update;
  if not found then raise exception 'activar_plan_anual_cda: el contrato de la elección no existe'; end if;
  v_hasta := greatest(v_sc.vigente_hasta, v_pa.periodo_hasta);
  if v_sc.vigente_hasta is distinct from v_hasta then
    update public.servicios_contratados
       set vigente_hasta = v_hasta, actualizado_por = v_pa.usuario_id
     where id = v_sc.id;
    insert into public.servicios_contratados_cambios (servicio_contratado_id, campo, valor_anterior, valor_nuevo, motivo, registrado_por)
    values (
      v_sc.id, 'vigente_hasta',
      jsonb_build_object('vigente_hasta', v_sc.vigente_hasta),
      jsonb_build_object('vigente_hasta', v_hasta, 'plan_anual_id', p_plan_anual_id),
      'Plan Anual activado: el Plazo Anual absorbe y extiende la fecha de la cláusula 12.1 (Anexo del Plan Anual, 3.3)',
      v_pa.usuario_id
    );
  end if;

  return 'activado';
end;
$$;

-- server-only: la llama el webhook de la pasarela con service_role después de registrar el pago del plan.
revoke execute on function public.activar_plan_anual_cda(uuid, uuid, jsonb) from public, anon, authenticated;
grant execute on function public.activar_plan_anual_cda(uuid, uuid, jsonb) to service_role;

comment on function public.activar_plan_anual_cda(uuid, uuid, jsonb) is
  'Activa el Plan Anual de Valida CDA al aprobarse su pago, en una transacción: cuotas del plazo a usuarios_adicionales, cuotas nuevas en cero, cobros programados sin pagar anulados, la cuota anual con su cobro y la fecha de la cláusula 12.1 (vigente_hasta) al fin del Plazo Anual. La aritmética viene del servidor; aquí se comprueba con las filas bloqueadas.';


-- ── 4. El retiro de una licencia puede dejar en cero una cuota de usuarios adicionales ─────

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
    select q.id, q.monto, q.numero, q.plan_cobro_id, q.tipo
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
    -- Una cuota de usuarios adicionales (período del Plan Anual) puede quedar en cero; las demás no.
    if r.monto_antes - r.monto_nuevo <> v_suma
       or r.monto_nuevo < 0
       or (r.monto_nuevo = 0 and v_q.tipo <> 'usuarios_adicionales') then
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
