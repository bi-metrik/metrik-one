-- ============================================================
-- 20260916120000 — Catálogo de servicios y servicios contratados (entrega A2)
-- Spec: proyectos/metrik/one/2026-09-15_spec-modulos-servicios-cobro.md, §3.3
--
-- Construye sobre A1 (`20260915210000_workspace_modulos`, aplicada en producción el
-- 2026-09-15 y verificada: RLS encendido, sin grants, 0 filas).
--
-- ## Cuatro cosas distintas que hoy están mezcladas (§3.1)
--
--   1. TIPO DE SERVICIO — lo que MeTRIK vende. Nace en el cerebro
--      (`cerebro/catalogo/servicios/<slug>.md`) y llega aquí por `POST /api/catalogo/versiones`.
--      `catalogo_servicios` + `catalogo_servicios_versiones`.
--   2. SERVICIO CONTRATADO — un cliente, un tipo, sus parámetros pactados y los workspaces que
--      cubre. `servicios_contratados` + `servicio_contratado_beneficiarios`.
--   3. NEGOCIO — la venta en el embudo de metrik. Ya existe, no se toca.
--   4. COBRO — estado de pago. `suscripciones` y lo de §4, que es la entrega B1.
--
-- ## Qué escribe esta migración: DDL, nada más
--
-- Ninguna fila se inserta ni se reescribe. Los contratos de hoy (los 7 planes de §0.8 y el de
-- 4D SOFT) son carga de datos en producción y van en A3, con autorización. Las versiones del
-- catálogo entran por la ruta firmada, no por SQL.
--
-- ## Decisiones que la base hace cumplir, no la disciplina
--
--   - **Una versión del catálogo es inmutable.** Un trigger rechaza UPDATE y DELETE sobre
--     `catalogo_servicios_versiones`. Cambiar un precio de lista obliga a subir la versión, y
--     ningún contrato vivo cambia por debajo (§3.2). La ruta devuelve 409 cuando la misma
--     versión llega con otra huella; el trigger es la red por si alguien escribe por SQL.
--   - **Un contrato apunta a una VERSIÓN, no al servicio.** `(servicio_slug, servicio_version)`
--     es llave foránea a la versión exacta. Pasar un contrato a otra versión es un acto
--     explícito, no algo que le pase por debajo (§3.4).
--   - **La comisión, si se declara, se declara entera.** `comision_coherente(jsonb)` exige
--     beneficiario, modo y el campo del modo, y espeja `src/lib/servicios/comision.ts`. Un
--     campo ausente nunca autoriza una comisión: una comisión a medias no se completa con
--     ceros, se rechaza. Monto fijo y porcentaje, las dos formas que decidió Mauricio el
--     2026-09-15 (AFI $50.000 fijos por licencia de CDA; 20 % sobre el paquete de Valida API).
--     **El porcentaje no vive aquí ni en el catálogo: vive en cada contrato** (N3), y
--     `contactos.comision_porcentaje` —que hoy trae 10 por defecto— no la alimenta.
--   - **La historia de un contrato no se reescribe.** `servicios_contratados_cambios` es
--     inmutable por trigger, igual que `workspace_modulos`.
--
-- ## Verificación después de aplicar (solo lectura)
--
--   select relname, relrowsecurity from pg_class
--    where relnamespace = 'public'::regnamespace
--      and relname in ('catalogo_servicios','catalogo_servicios_versiones','servicios_contratados',
--                      'servicio_contratado_beneficiarios','servicios_contratados_cambios');
--     -> las 5 con relrowsecurity = true
--   select t.relname, has_table_privilege('anon', t.oid, 'select') as anon,
--          has_table_privilege('authenticated', t.oid, 'select') as auth
--     from pg_class t where t.relnamespace='public'::regnamespace
--      and t.relname like 'catalogo_servicios%' or t.relname like 'servicio%contratad%';
--     -> anon y auth en false en todas
--   select conname from pg_constraint where conrelid='public.workspace_modulos'::regclass
--     and conname='workspace_modulos_servicio_fk';   -> 1 fila
--   select count(*) from public.catalogo_servicios;  -> 0
-- ============================================================

-- ── 1. Catálogo: el tipo de servicio, copia fiel del cerebro ─────────────────

-- server-only: la escribe `POST /api/catalogo/versiones` con service_role, firmado por la
-- Action del cerebro. El cliente ve su catálogo por la RPC de A3, con campos cerrados; que la
-- lista de precios de todos los productos sea legible con la anon key no le sirve a nadie.
create table public.catalogo_servicios (
  slug text primary key
    constraint catalogo_servicios_slug_kebab check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  nombre text not null
    constraint catalogo_servicios_nombre_no_vacio check (length(btrim(nombre)) > 0),

  -- Llave de módulo de `workspaces.modules`. La misma lista del CHECK de `workspace_modulos`
  -- (20260915210000) y de `CLAVES_DE_MODULO` en `src/lib/modulos/catalogo.ts`;
  -- `src/lib/modulos/catalogo.test.ts` lee ESTE archivo y falla si las tres se separan.
  modulo text not null
    constraint catalogo_servicios_modulo check
      (modulo in ('business', 'valida_consulta', 'valida_api', 'compliance', 'calidad_llamadas', 'cert_qr')),

  disparador_cobro text not null
    constraint catalogo_servicios_disparador check (disparador_cobro in ('ciclo', 'consumo', 'unico')),

  -- La versión que un contrato nuevo toma por defecto. Nunca baja: la Action manda versiones
  -- hacia adelante, y bajarla dejaría contratos apuntando a una versión "futura".
  version_vigente integer not null
    constraint catalogo_servicios_version_vigente check (version_vigente >= 1),
  activo boolean not null default true,
  updated_at timestamptz not null default now()
);

alter table public.catalogo_servicios enable row level security;
revoke all on table public.catalogo_servicios from public, anon, authenticated;

comment on table public.catalogo_servicios is
  'Un tipo de servicio que MeTRIK vende. Fuente: cerebro/catalogo/servicios/<slug>.md. Se escribe solo por POST /api/catalogo/versiones.';

-- ── 2. Versiones: inmutables por trigger ─────────────────────────────────────

-- server-only: misma razón que arriba.
create table public.catalogo_servicios_versiones (
  slug text not null references public.catalogo_servicios(slug),
  version integer not null
    constraint catalogo_versiones_version check (version >= 1),

  -- El frontmatter ya validado contra `src/lib/catalogo/definicion.ts`. Se guarda entero para
  -- que un contrato pueda mostrar con qué condiciones se firmó, aunque el tipo haya cambiado.
  definicion jsonb not null,

  -- De dónde salió y con qué huella. `fuente_sha256` es del ARCHIVO crudo, no de `definicion`:
  -- es lo que compara la revisión de deriva nocturna contra `GET /api/catalogo/huellas` (§3.2).
  fuente_ruta text not null
    constraint catalogo_versiones_ruta check (fuente_ruta like 'cerebro/catalogo/servicios/%.md'),
  fuente_sha256 text not null
    constraint catalogo_versiones_sha check (fuente_sha256 ~ '^[0-9a-f]{64}$'),
  recibida_at timestamptz not null default now(),

  primary key (slug, version)
);

alter table public.catalogo_servicios_versiones enable row level security;
revoke all on table public.catalogo_servicios_versiones from public, anon, authenticated;

comment on table public.catalogo_servicios_versiones is
  'Copia fiel e inmutable de una versión del catálogo. Cambiar un precio de lista exige subir la versión: ningún contrato vivo cambia por debajo.';

-- Inmutable de verdad, no por convención. Sin esto, «la versión no cambia» sería una promesa
-- de la ruta HTTP, y un UPDATE por SQL la rompería sin dejar rastro: un contrato firmado bajo
-- la versión 1 pasaría a decir otra cosa con la misma etiqueta.
create or replace function public.catalogo_versiones_inmutable()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception
    'catalogo_servicios_versiones (% v%): una versión publicada no se % ; subí la versión en el cerebro',
    coalesce(old.slug, new.slug), coalesce(old.version, new.version),
    case tg_op when 'DELETE' then 'borra' else 'reescribe' end;
end;
$$;

create trigger trg_catalogo_versiones_inmutable
  before update or delete on public.catalogo_servicios_versiones
  for each row execute function public.catalogo_versiones_inmutable();

revoke execute on function public.catalogo_versiones_inmutable() from public, anon, authenticated;

-- La versión vigente de un servicio tiene que existir. Sin esto, un servicio puede apuntar a
-- una versión que nunca llegó y la ficha de un contrato queda sin condiciones que mostrar.
--
-- Va DIFERIDA porque las dos tablas se apuntan: `versiones.slug` exige el servicio y el
-- servicio exige su versión vigente. Diferida, las dos filas entran en la misma transacción.
-- Consecuencia práctica, medida con PGlite antes de escribir la ruta: **fuera de una
-- transacción no hay orden que funcione** (en autocommit cada sentencia se valida sola). Por
-- eso registrar una versión es UNA llamada, `registrar_version_catalogo`, y no dos inserts
-- desde el cliente de Supabase, que no sabe abrir transacciones.
alter table public.catalogo_servicios
  add constraint catalogo_servicios_version_vigente_fk
  foreign key (slug, version_vigente)
  references public.catalogo_servicios_versiones(slug, version)
  deferrable initially deferred;

-- ── 2 bis. Registrar una versión, atómico e idempotente ──────────────────────
--
-- La usa `POST /api/catalogo/versiones`. Devuelve qué pasó, para que la ruta traduzca a
-- código HTTP sin adivinar:
--
--   'creada'            -> la versión no existía (201)
--   'ya_estaba'         -> misma versión, MISMA huella: reenvío, nada que hacer (200)
--   'conflicto_huella'  -> misma versión, OTRA huella (409). El archivo cambió sin subir la
--                          versión: aceptarlo movería las condiciones de los contratos vivos
--                          bajo la misma etiqueta, que es justo lo que §3.2 prohíbe.
--
-- `version_vigente` solo SUBE. Si llega una versión menor que la vigente (un push viejo, una
-- rama que se mezcló al revés) la versión se guarda pero el puntero no retrocede: un contrato
-- nuevo no puede nacer con condiciones más viejas que las publicadas.
create or replace function public.registrar_version_catalogo(
  p_slug text,
  p_version integer,
  p_definicion jsonb,
  p_fuente_ruta text,
  p_fuente_sha256 text
)
returns jsonb
language plpgsql
volatile
set search_path = ''
as $$
declare
  v_sha_existente text;
  v_resultado text;
  v_vigente integer;
begin
  select fuente_sha256 into v_sha_existente
    from public.catalogo_servicios_versiones
   where slug = p_slug and version = p_version;

  if found then
    if v_sha_existente = p_fuente_sha256 then
      v_resultado := 'ya_estaba';
    else
      return jsonb_build_object(
        'resultado', 'conflicto_huella',
        'slug', p_slug, 'version', p_version,
        'sha_registrada', v_sha_existente, 'sha_recibida', p_fuente_sha256
      );
    end if;
  else
    v_resultado := 'creada';
  end if;

  -- El servicio primero (su FK a la versión va diferida), la versión después.
  insert into public.catalogo_servicios (slug, nombre, modulo, disparador_cobro, version_vigente, activo)
  values (
    p_slug,
    p_definicion->>'nombre',
    p_definicion->>'modulo',
    p_definicion->>'disparador_cobro',
    p_version,
    coalesce((p_definicion->>'activo')::boolean, true)
  )
  on conflict (slug) do update set
    nombre           = excluded.nombre,
    modulo           = excluded.modulo,
    disparador_cobro = excluded.disparador_cobro,
    version_vigente  = greatest(public.catalogo_servicios.version_vigente, excluded.version_vigente),
    activo           = excluded.activo,
    updated_at       = now();

  if v_resultado = 'creada' then
    insert into public.catalogo_servicios_versiones (slug, version, definicion, fuente_ruta, fuente_sha256)
    values (p_slug, p_version, p_definicion, p_fuente_ruta, p_fuente_sha256);
  end if;

  select version_vigente into v_vigente from public.catalogo_servicios where slug = p_slug;

  return jsonb_build_object(
    'resultado', v_resultado,
    'slug', p_slug, 'version', p_version, 'version_vigente', v_vigente
  );
end;
$$;

-- server-only: la llama la ruta con service_role, y la ruta solo entra con la firma buena.
revoke execute on function public.registrar_version_catalogo(text, integer, jsonb, text, text)
  from public, anon, authenticated;

-- ── 3. Coherencia de la comisión (espejo de src/lib/servicios/comision.ts) ────

-- Una comisión declarada a medias escribiría un gasto por un número inventado. El criterio es
-- el mismo del módulo puro: **un campo ausente nunca autoriza una comisión**. Se admite null
-- (no se pactó comisión), nunca un objeto incompleto.
--
-- ⚠️ Cada comparación va envuelta en `coalesce(..., false)`, y no es adorno: **un CHECK solo
-- rechaza cuando la expresión da FALSE; si da NULL, deja pasar.** Sin el coalesce, una comisión
-- `{"modo":"porcentaje"}` sin `pct` hace que `jsonb_typeof(c->'pct')` sea NULL, que la cadena
-- entera sea NULL y que el CHECK **acepte justo el caso que existe para rechazar**. Lo
-- encontró la prueba de PGlite (`migracion-sql.test.ts`), no la lectura del SQL.
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
            -- El modo se escribe; no se deduce de qué campo vino lleno. Deducirlo convierte un
            -- olvido en una comisión de otra naturaleza.
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
  'Espeja src/lib/servicios/comision.ts. Monto fijo y porcentaje; el porcentaje sale del contrato, nunca de un valor global (N3).';

-- ── 4. Servicios contratados ─────────────────────────────────────────────────

-- server-only: viven en el workspace metrik y traen precio, comisión y correo de facturación.
-- El cliente los lee por la RPC `mis_servicios()` de A3, que devuelve una lista cerrada de
-- campos y nunca la comisión ni los datos de otro cliente (§3.6).
create table public.servicios_contratados (
  id uuid primary key default gen_random_uuid(),

  -- El cobrador: hoy siempre metrik. Se guarda porque el modelo no asume un solo cobrador.
  workspace_id uuid not null references public.workspaces(id),
  -- El cliente en el directorio del cobrador. Los 4 CDA todavía no existen como empresas
  -- (hallazgo 17): crearlas es prerrequisito de su contrato, y esta llave lo obliga.
  empresa_id uuid not null references public.empresas(id),
  -- La venta. Un negocio por contrato, y cada renovación es un cobro de ese negocio (§3.5):
  -- crear un negocio por renovación deja negocios sin carpeta de Drive y el emisor descarta
  -- sus PDF en silencio.
  negocio_id uuid not null references public.negocios(id),

  servicio_slug text not null,
  servicio_version integer not null,

  -- Lo pactado con este cliente, validado contra la definición de ESA versión antes de
  -- guardarse (lo hace el servidor en A3; la base solo exige que sea un objeto).
  parametros jsonb not null default '{}'::jsonb
    constraint servicios_contratados_parametros_objeto check (jsonb_typeof(parametros) = 'object'),

  -- Quién gestiona el pago. Null = lo gestiona MeTRIK (el caso de hoy, con cuenta de cobro).
  -- Con D3 cada CDA es su propio pagador.
  workspace_pagador_id uuid references public.workspaces(id),
  correo_facturacion text,

  estado text not null default 'borrador'
    constraint servicios_contratados_estado check
      (estado in ('borrador', 'activo', 'pausado', 'cancelado', 'terminado')),

  vigente_desde date not null,
  vigente_hasta date,

  -- Solo para tipos del módulo Valida API: el cliente en la base de Valida.
  valida_cliente_api_id uuid,
  -- La bolsa que ya existe y que la reconciliación no debe volver a pedir. En 4D SOFT,
  -- 'bold-TXRRP7Q95ZJ' (§5.2).
  bolsa_inicial_referencia text,

  -- Canal que cobra comisión por esta venta (§4.15). Ver `comision_coherente`.
  comision jsonb
    constraint servicios_contratados_comision_coherente check (public.comision_coherente(comision)),

  -- D5: quién puede autorizar el cargo sin poder escrito. Hoy solo el contrato de 4D SOFT.
  -- Por defecto FALSE: un contrato que no lo declare exige representante legal o poder, que
  -- es la regla, y la excepción tiene que escribirse contrato por contrato.
  autorizacion_sin_poder_permitida boolean not null default false,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  actualizado_por uuid references public.profiles(id),

  constraint servicios_contratados_vigencia check (vigente_hasta is null or vigente_hasta >= vigente_desde),
  -- Un contrato apunta a la VERSIÓN exacta con la que se firmó.
  constraint servicios_contratados_version_fk
    foreign key (servicio_slug, servicio_version)
    references public.catalogo_servicios_versiones(slug, version)
);

alter table public.servicios_contratados enable row level security;
revoke all on table public.servicios_contratados from public, anon, authenticated;

create index idx_servicios_contratados_empresa on public.servicios_contratados (empresa_id);
create index idx_servicios_contratados_negocio on public.servicios_contratados (negocio_id);
create index idx_servicios_contratados_pagador on public.servicios_contratados (workspace_pagador_id);
create index idx_servicios_contratados_slug on public.servicios_contratados (servicio_slug, servicio_version);

comment on table public.servicios_contratados is
  'Un cliente con un tipo de servicio del catálogo, sus parámetros pactados y los workspaces que cubre. Vive en el workspace del cobrador (metrik).';
comment on column public.servicios_contratados.comision is
  'Canal que cobra comisión por esta venta: { beneficiario_empresa_id, beneficiario_nit, modo, pct|monto_fijo, base, fee_unico }. Null = no se pactó.';

create or replace function public.servicios_contratados_touch()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger trg_servicios_contratados_touch
  before update on public.servicios_contratados
  for each row execute function public.servicios_contratados_touch();

revoke execute on function public.servicios_contratados_touch() from public, anon, authenticated;

-- ── 5. Beneficiarios: los workspaces que cubre ───────────────────────────────

-- `A1 26 4` cubre 4 CDA con un solo contrato mientras dure; con D3 cada CDA tendrá el suyo,
-- pero el modelo conserva el caso porque no es exclusivo de ese contrato.
-- server-only.
create table public.servicio_contratado_beneficiarios (
  servicio_contratado_id uuid not null references public.servicios_contratados(id) on delete cascade,
  workspace_id uuid not null references public.workspaces(id),
  primary key (servicio_contratado_id, workspace_id)
);

alter table public.servicio_contratado_beneficiarios enable row level security;
revoke all on table public.servicio_contratado_beneficiarios from public, anon, authenticated;

create index idx_servicio_beneficiarios_workspace on public.servicio_contratado_beneficiarios (workspace_id);

-- ── 6. Bitácora de cambios, inmutable ────────────────────────────────────────

-- Un contrato mueve dinero: subir un precio, bajar licencias o cambiar la comisión tiene que
-- poder reconstruirse después. Una tabla que se puede reescribir no sirve para eso.
-- server-only.
create table public.servicios_contratados_cambios (
  id uuid primary key default gen_random_uuid(),
  servicio_contratado_id uuid not null references public.servicios_contratados(id),
  campo text not null
    constraint servicios_cambios_campo_no_vacio check (length(btrim(campo)) > 0),
  valor_anterior jsonb,
  valor_nuevo jsonb,
  -- Por qué, en palabras. Sin motivo, la bitácora dice qué cambió y no por qué, que es lo
  -- único que sirve seis meses después.
  motivo text not null
    constraint servicios_cambios_motivo_no_vacio check (length(btrim(motivo)) > 0),
  registrado_por uuid not null references public.profiles(id),
  created_at timestamptz not null default now()
);

alter table public.servicios_contratados_cambios enable row level security;
revoke all on table public.servicios_contratados_cambios from public, anon, authenticated;

create index idx_servicios_cambios_contrato on public.servicios_contratados_cambios (servicio_contratado_id, created_at desc);

create or replace function public.servicios_cambios_inmutable()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'servicios_contratados_cambios %: la bitácora de un contrato no se reescribe ni se borra',
    coalesce(old.id, new.id);
end;
$$;

create trigger trg_servicios_cambios_inmutable
  before update or delete on public.servicios_contratados_cambios
  for each row execute function public.servicios_cambios_inmutable();

revoke execute on function public.servicios_cambios_inmutable() from public, anon, authenticated;

-- ── 7. Cerrar la mitad que A1 dejó abierta ───────────────────────────────────
--
-- A1 creó `workspace_modulos.servicio_contratado_id` sin llave foránea porque la tabla no
-- existía. Ya existe. Se pone la FK ahora y no en A3: la columna está en 0 filas, así que es
-- gratis, y sin ella un id inventado se guardaría igual y la proyección apuntaría a un
-- contrato que no existe. El CHECK en la otra dirección (que `servicio` e
-- `incluido_en_proyecto` SIEMPRE traigan contrato) sigue para A3, porque la carga inicial
-- todavía no puede cumplirlo.
alter table public.workspace_modulos
  add constraint workspace_modulos_servicio_fk
  foreign key (servicio_contratado_id) references public.servicios_contratados(id);
