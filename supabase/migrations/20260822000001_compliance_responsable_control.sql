-- Compliance — responsable por control + bitácora de aceptación (R2)
--
-- Problema: los controles de la matriz de riesgo no dicen QUIÉN responde por
-- ellos. Un control sin responsable identificado no es un control ante un
-- auditor: es una descripción de una actividad que nadie se comprometió a hacer.
--
-- La norma separa tres cosas que el software tiende a confundir en una sola:
--
--   NOMINAR  = decir qué CARGO responde. Responde un cargo, no una persona ni
--              una cuenta. La matriz fuente ya lo dice así ("Tesorero",
--              "Jefe HSEQ", "Coordinador jurídico predial"...). Es
--              `riesgos_controles.cargo_responsable_id`.
--   EJECUTAR = operar el control. Casi todos se ejecutan FUERA de ONE (correo,
--              formatos, expedientes). Solo eso justificaría una cuenta, y por
--              eso `riesgos_controles.responsable_id` (usuario) se conserva y
--              queda OPCIONAL.
--   ACEPTAR  = el acto por el que la persona reconoce que responde. Es lo que
--              sirve de evidencia en auditoría, y es `compliance_aceptaciones`.
--
-- Por qué no se le da cuenta de ONE a cada responsable: el módulo expone quién
-- quedó reportado en listas restrictivas, y eso es dato sensible que un tesorero
-- no necesita. Dar cuentas masivamente CREA riesgo. Principio de mínimo
-- necesario.
--
-- Hermana de `compliance_liberaciones` (R4) y con el mismo patrón: bitácora
-- append-only impuesta por un trigger en la base, no por una policy — el service
-- client bypasea RLS y una policy no alcanzaría.

-- =============================================================================
-- 1. Catálogo de cargos por workspace
-- =============================================================================

-- Un cargo, no una persona: quien ocupe el cargo cambia y la responsabilidad se
-- queda donde está. Por eso el catálogo no referencia `profiles`.
create table if not exists compliance_cargos (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,

  nombre text not null,
  -- Desactivar en vez de borrar: un cargo que ya nominó controles y firmó
  -- aceptaciones no se puede hacer desaparecer sin romper la trazabilidad. El
  -- borrado real está bloqueado por las FK de abajo (`on delete restrict`), así
  -- que `activo=false` es la salida — sale del selector, sigue en la bitácora.
  activo boolean not null default true,
  -- Orden de presentación. No tiene semántica de jerarquía.
  orden integer not null default 0,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint compliance_cargos_nombre_no_vacio check (btrim(nombre) <> '')
);

-- Dos cargos con el mismo nombre en un workspace son el mismo cargo escrito dos
-- veces, y partirían la cobertura en dos sin que nadie lo note: la mitad de los
-- controles quedaría colgando de un cargo que nunca firmó. La unicidad se aplica
-- sobre el nombre NORMALIZADO (sin tildes, sin mayúsculas, sin espacios de más)
-- para que "Coordinador COMPLIANCE" y "Coordinador Compliance" colisionen.
-- `immutable_unaccent` no existe aquí, así que se normaliza con translate: cubre
-- las vocales acentuadas y la eñe del español, que es todo lo que hace falta.
create unique index if not exists idx_compliance_cargos_nombre_unico
  on compliance_cargos(
    workspace_id,
    lower(btrim(regexp_replace(translate(nombre, 'áàäâéèëêíìïîóòöôúùüûñÁÀÄÂÉÈËÊÍÌÏÎÓÒÖÔÚÙÜÛÑ', 'aaaaeeeeiiiioooouuuunAAAAEEEEIIIIOOOOUUUUN'), '\s+', ' ', 'g')))
  );

create index if not exists idx_compliance_cargos_workspace
  on compliance_cargos(workspace_id, activo, orden);

drop trigger if exists trg_compliance_cargos_updated_at on compliance_cargos;
create trigger trg_compliance_cargos_updated_at
  before update on compliance_cargos
  for each row execute function set_updated_at();

comment on table compliance_cargos is
  'Catálogo de cargos responsables de controles, por workspace. Responde un CARGO, no una persona: quien lo ocupe cambia y la responsabilidad se queda. No referencia profiles a propósito.';
comment on column compliance_cargos.activo is
  'Desactivar es la única forma de retirar un cargo: borrarlo está bloqueado por las FK de riesgos_controles y compliance_aceptaciones, porque destruiría la trazabilidad.';

-- server-only: el catálogo se lee y escribe desde server actions con
-- `createServiceClient()` y guard de rol (compliance-responsables.ts) — la
-- pantalla es solo del oficial de cumplimiento. No se otorga a `authenticated`.
alter table compliance_cargos enable row level security;

-- La policy de lectura no sobra aunque hoy nadie use el cliente autenticado: es
-- la red por si mañana un consumidor la lee así. Sin ella, ese día se leería
-- cross-tenant.
drop policy if exists compliance_cargos_select on compliance_cargos;
create policy compliance_cargos_select on compliance_cargos
  for select using (workspace_id = current_user_workspace_id());

-- =============================================================================
-- 2. El control apunta a su cargo
-- =============================================================================

alter table riesgos_controles
  add column if not exists cargo_responsable_id uuid references compliance_cargos(id) on delete restrict;

-- `on delete restrict`: borrar un cargo que nomina controles los dejaría sin
-- responsable EN SILENCIO, que es exactamente el estado que este frente viene a
-- eliminar. Para retirar un cargo se usa `activo=false`.

create index if not exists idx_riesgos_controles_cargo
  on riesgos_controles(workspace_id, cargo_responsable_id);

comment on column riesgos_controles.cargo_responsable_id is
  'Cargo que RESPONDE por el control (nominación). Distinto de responsable_id, que es el usuario de ONE que lo OPERA cuando el control se ejecuta dentro de la plataforma — casi ninguno lo hace.';
comment on column riesgos_controles.responsable_id is
  'Usuario de ONE que opera el control dentro de la plataforma. OPCIONAL. No es la nominación (esa es cargo_responsable_id) y no se le da cuenta a alguien solo por ser responsable: el módulo expone quién quedó reportado en listas restrictivas.';

-- -----------------------------------------------------------------------------
-- 2.b `updated_at` tiene que MOVERSE, o la regla de desactualización es inerte
-- -----------------------------------------------------------------------------
--
-- ⚠️ Medido en producción el 2026-08-22: `riesgos_controles.updated_at` existe
-- con `default now()` y NO tiene trigger que la mantenga — los 18 controles del
-- workspace tienen `updated_at = created_at`, o sea que la columna nunca se ha
-- movido desde que nacieron las filas.
--
-- Toda la detección de aceptaciones desactualizadas compara el `updated_at` del
-- control contra el que quedó fotografiado en la aceptación. Sin este trigger,
-- esa comparación NUNCA daría distinto y el indicador diría "todo al día" para
-- siempre: una pantalla sana que miente, que es peor que una pantalla rota
-- porque no se ve.
drop trigger if exists trg_riesgos_controles_updated_at on riesgos_controles;
create trigger trg_riesgos_controles_updated_at
  before update on riesgos_controles
  for each row execute function set_updated_at();

-- =============================================================================
-- 3. Bitácora de aceptación (append-only)
-- =============================================================================

-- El acto por el que una persona reconoce que responde por unos controles.
-- Append-only: corregir o revocar es una fila nueva.
create table if not exists compliance_aceptaciones (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,

  cargo_id uuid not null references compliance_cargos(id) on delete restrict,

  -- La persona que acepta. Puede NO tener cuenta en ONE, que es el caso normal:
  -- un tesorero firma la carta y nunca entra a la plataforma. Por eso el nombre
  -- y el documento son texto y no una FK.
  persona_nombre text not null,
  persona_documento text not null,

  -- El usuario de ONE que aceptó, si lo hizo desde la plataforma. Nulo casi
  -- siempre. NO es el firmante: es el rastro de la sesión.
  aceptada_por uuid references profiles(id) on delete set null,
  -- El oficial de cumplimiento que registró la aceptación. Siempre hay uno:
  -- alguien de ONE tuvo que cargar el documento.
  registrada_por uuid references profiles(id) on delete set null,

  medio text not null check (medio in ('firma_one', 'documento_cargado')),
  -- Path en el bucket `compliance-soportes`. Obligatorio en `documento_cargado`
  -- (ver CHECK abajo): sin el documento, la aceptación es la palabra del oficial.
  soporte_path text,

  -- La fecha en que la persona FIRMÓ, que puede ser anterior al registro.
  -- Contrasta a propósito con `compliance_liberaciones.vigente_desde`, que se
  -- fuerza a hoy: allá es una ventana de permiso y retroactivarla cubriría
  -- contrataciones que ocurrieron sin ella; aquí es un hecho del pasado y
  -- falsear su fecha sería falsear la evidencia. Lo que no puede es estar en el
  -- futuro.
  fecha_aceptacion date not null default current_date,

  -- FOTO de los controles aceptados. Es el corazón del frente: sin ella no se
  -- puede saber si lo que la persona aceptó sigue siendo lo que el control dice
  -- hoy. Cada elemento: {id, referencia, nombre, updated_at}.
  controles_snapshot jsonb not null,

  created_at timestamptz not null default now(),

  constraint compliance_aceptaciones_persona_no_vacia
    check (btrim(persona_nombre) <> '' and btrim(persona_documento) <> ''),

  -- Un documento cargado sin documento no es un documento cargado.
  constraint compliance_aceptaciones_soporte_segun_medio
    check (
      (medio = 'documento_cargado' and soporte_path is not null and btrim(soporte_path) <> '')
      or medio = 'firma_one'
    ),

  -- Una aceptación de cero controles no acepta nada, y contaría como cobertura
  -- de un cargo que no cubre a ninguno.
  constraint compliance_aceptaciones_snapshot_no_vacio
    check (jsonb_typeof(controles_snapshot) = 'array' and jsonb_array_length(controles_snapshot) > 0)
);

-- La lectura caliente: "la aceptación más reciente de este cargo".
-- `created_at desc` en el índice para que esa consulta no ordene.
create index if not exists idx_compliance_aceptaciones_cargo
  on compliance_aceptaciones(workspace_id, cargo_id, created_at desc);

create index if not exists idx_compliance_aceptaciones_workspace
  on compliance_aceptaciones(workspace_id, created_at desc);

comment on table compliance_aceptaciones is
  'Bitácora APPEND-ONLY del acto por el que una persona reconoce responder por los controles de un cargo. Corregir o revocar = fila nueva. La foto de controles es lo que permite detectar aceptaciones desactualizadas.';
comment on column compliance_aceptaciones.controles_snapshot is
  'Foto de los controles aceptados: [{id, referencia, nombre, updated_at}]. Un control está cubierto solo si la aceptación más reciente de su cargo lo incluye CON EL MISMO updated_at; si cambió después, la aceptación quedó desactualizada.';
comment on column compliance_aceptaciones.fecha_aceptacion is
  'Fecha en que la persona firmó. Puede ser anterior al registro (es un hecho del pasado), nunca posterior a hoy.';
comment on column compliance_aceptaciones.aceptada_por is
  'Usuario de ONE que aceptó desde la plataforma. Nulo casi siempre: el firmante normalmente no tiene cuenta. NO confundir con registrada_por, que es el oficial que cargó el soporte.';

-- -----------------------------------------------------------------------------
-- Append-only, en la base
-- -----------------------------------------------------------------------------
--
-- La inmutabilidad no puede depender de que la aplicación no escriba un UPDATE:
-- el service client bypasea RLS, así que una policy no alcanza. El trigger sí,
-- porque los triggers corren para todos los roles, `service_role` incluido.
create or replace function compliance_aceptaciones_append_only()
returns trigger language plpgsql as $$
begin
  raise exception
    'compliance_aceptaciones es append-only: % no está permitido. Para corregir o revocar una aceptación, registra una nueva.',
    tg_op
    using errcode = 'restrict_violation';
end;
$$;

-- Toda función nace ejecutable por PUBLIC y `anon` la alcanza por ahí; el default
-- de la base no lo puede evitar, así que el revoke explícito es el único
-- mecanismo. Disparar un trigger NO exige EXECUTE, solo crearlo.
revoke execute on function public.compliance_aceptaciones_append_only() from public, anon;

drop trigger if exists trg_compliance_aceptaciones_append_only on compliance_aceptaciones;
create trigger trg_compliance_aceptaciones_append_only
  before update or delete on compliance_aceptaciones
  for each row
  execute function compliance_aceptaciones_append_only();

-- server-only: toda lectura y escritura pasa por server actions con
-- `createServiceClient()` y guard de rol, más la ruta de la carta en PDF. El
-- cliente nunca consulta esta tabla directo: el documento de identidad de un
-- responsable no es dato que deba viajar al navegador de cualquiera del
-- workspace.
alter table compliance_aceptaciones enable row level security;

drop policy if exists compliance_aceptaciones_select on compliance_aceptaciones;
create policy compliance_aceptaciones_select on compliance_aceptaciones
  for select using (workspace_id = current_user_workspace_id());

-- =============================================================================
-- 4. Bucket del soporte firmado
-- =============================================================================

-- PRIVADO. Un soporte de aceptación lleva nombre y documento de identidad de una
-- persona: en un bucket público bastaría adivinar la ruta.
insert into storage.buckets (id, name, public)
values ('compliance-soportes', 'compliance-soportes', false)
on conflict (id) do nothing;

-- No se crean policies de storage para `authenticated`: la subida y la descarga
-- pasan por el servidor (service client + guard de rol + URL firmada), igual que
-- el resto del módulo. Sin policies, el cliente autenticado no alcanza el bucket,
-- que es lo que se quiere.
