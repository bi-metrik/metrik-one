-- Compliance — liberación de contrapartes por el oficial de cumplimiento (R4)
--
-- Problema: el workspace consulta listas restrictivas y muestra hallazgos, pero
-- NO registra qué decidió el oficial sobre ellos. La debida diligencia no es la
-- consulta: es la decisión documentada sobre lo que la consulta encontró. Hoy la
-- operación avanza sin dejar rastro de esa decisión.
--
-- La liberación cuelga de la CONTRAPARTE, no de la consulta. Una misma
-- contraparte se consulta muchas veces (y con el monitoreo recurrente se va a
-- re-consultar sola): si la vigencia colgara de `consulta_id`, la siguiente
-- consulta la dejaría huérfana y el oficial tendría que volver a liberar lo ya
-- liberado. Por eso la fila lleva LAS DOS cosas:
--   - `consulta_id`  -> la evidencia sobre la que decidió (qué hallazgos tenía a la vista)
--   - documento_tipo + documento_numero -> la llave por la que se busca la vigencia
--
-- ONE todavía no tiene entidad "contraparte". No se inventa aquí: se denormaliza
-- la identidad y queda anotado que la entidad propia es el paso natural cuando
-- llegue el monitoreo recurrente (R3).
--
-- NO CONFUNDIR con `registrarVeredicto()` / `DualDecision` de compliance-dual.ts:
-- eso es la auditoría interna de MéTRIK sobre la calidad comparada de Informa
-- contra Valida, invisible para el cliente. Dos bitácoras, dos audiencias.
--
-- NOTA sobre `consultas_listas_dual`: esa tabla se creó fuera de este directorio
-- de migraciones (existe en producción, no en el historial del repo). Este archivo
-- solo la REFERENCIA; la FK falla ruidoso si no existe, que es el comportamiento
-- correcto — no queremos una bitácora de decisiones sin su evidencia detrás.

-- =============================================================================
-- 1. La bitácora
-- =============================================================================

create table if not exists compliance_liberaciones (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,

  -- Evidencia: la consulta que el oficial tenía a la vista al decidir.
  -- `on delete restrict`: borrar la consulta destruiría el sustento de una
  -- decisión ya tomada. Si alguien limpia el historial, esta fila lo frena, y
  -- eso es exactamente lo que debe pasar.
  consulta_id uuid not null references consultas_listas_dual(id) on delete restrict,

  -- Identidad de la contraparte, denormalizada. ES la llave de la vigencia.
  documento_tipo text not null,
  documento_numero text not null,
  nombre text,

  decision text not null check (decision in ('liberada', 'rechazada')),
  justificacion text not null,

  vigente_desde date not null default current_date,
  -- NULL solo en un rechazo: un rechazo no tiene vigencia, revoca y punto.
  vigente_hasta date,

  -- Amarre a la matriz de riesgo: qué control está operando el oficial al
  -- liberar. Opcional. `on delete restrict` por la misma razón que la consulta,
  -- y además porque un `set null` sería un UPDATE sobre una tabla que no admite
  -- UPDATE (ver el trigger de abajo): el borrado del control fallaría con un
  -- error incomprensible en vez de decir lo que pasa.
  control_id uuid references riesgos_controles(id) on delete restrict,

  liberada_por uuid references profiles(id) on delete set null,
  created_at timestamptz not null default now(),

  -- La justificación NUNCA va vacía, tampoco en un rechazo: la bitácora existe
  -- para responder "por qué se decidió esto".
  constraint compliance_liberaciones_justificacion_no_vacia
    check (btrim(justificacion) <> ''),

  -- Una liberación sin fecha de fin no vence nunca, que es lo contrario de una
  -- liberación. Un rechazo, en cambio, no puede traerla.
  constraint compliance_liberaciones_vigencia_segun_decision
    check (
      (decision = 'liberada' and vigente_hasta is not null)
      or (decision = 'rechazada' and vigente_hasta is null)
    ),

  constraint compliance_liberaciones_vigencia_ordenada
    check (vigente_hasta is null or vigente_hasta >= vigente_desde),

  -- Sin documento no hay contraparte a la cual atar la vigencia. Una consulta
  -- hecha solo por nombre no se puede liberar por esta vía; la pantalla lo dice
  -- en vez de dejar filas que no cubren a nadie.
  constraint compliance_liberaciones_documento_no_vacio
    check (btrim(documento_tipo) <> '' and btrim(documento_numero) <> '')
);

-- La llave de la consulta de vigencia: "de esta contraparte, la fila más
-- reciente". `created_at desc` en el índice para que esa lectura no ordene.
create index if not exists idx_compliance_liberaciones_contraparte
  on compliance_liberaciones(workspace_id, documento_tipo, documento_numero, created_at desc);

-- La bitácora completa del workspace y el barrido de contrapartes cubiertas.
create index if not exists idx_compliance_liberaciones_workspace
  on compliance_liberaciones(workspace_id, created_at desc);

comment on table compliance_liberaciones is
  'Bitácora APPEND-ONLY de decisiones del oficial de cumplimiento sobre contrapartes con hallazgo. Revocar o cambiar = fila nueva. NO es la auditoría dual Informa/Valida (esa vive en metrik-valida).';
comment on column compliance_liberaciones.consulta_id is
  'La consulta cuyos hallazgos el oficial tenía a la vista al decidir. Es la evidencia, no la llave de la vigencia.';
comment on column compliance_liberaciones.documento_numero is
  'Llave de la vigencia junto con documento_tipo. Se guarda tal como lo registró la consulta; la comparación normaliza (ver claveContraparte en src/lib/compliance/liberaciones.ts).';
comment on column compliance_liberaciones.vigente_hasta is
  'Obligatoria si decision=liberada, NULL si decision=rechazada. Vencida deja de cubrir sola: no hay proceso que tenga que pasar a marcarla.';
comment on column compliance_liberaciones.control_id is
  'Control de riesgos_controles que el oficial está operando al decidir. Opcional — es lo que vuelve la matriz un documento vivo en vez de decorativo.';

-- =============================================================================
-- 2. Append-only, en la base
-- =============================================================================

-- La inmutabilidad no puede depender de que la aplicación no escriba un UPDATE:
-- el service client bypasea RLS, así que una policy no alcanza. El trigger sí,
-- porque los triggers corren para todos los roles, service_role incluido.
--
-- Una bitácora que se puede reescribir no es bitácora. El principio de
-- compliance es que si no está documentado no existe; el corolario es que si se
-- puede reescribir, tampoco.
create or replace function compliance_liberaciones_append_only()
returns trigger language plpgsql as $$
begin
  raise exception
    'compliance_liberaciones es append-only: % no está permitido. Para revocar o cambiar una decisión, inserta una fila nueva.',
    tg_op
    using errcode = 'restrict_violation';
end;
$$;

-- Toda función nace ejecutable por PUBLIC y `anon` la alcanza por ahí; el default
-- de la base no lo puede evitar, así que el revoke explícito es el único
-- mecanismo. Disparar un trigger NO exige EXECUTE, solo crearlo.
revoke execute on function public.compliance_liberaciones_append_only() from public, anon;

drop trigger if exists trg_compliance_liberaciones_append_only on compliance_liberaciones;
create trigger trg_compliance_liberaciones_append_only
  before update or delete on compliance_liberaciones
  for each row
  execute function compliance_liberaciones_append_only();

-- =============================================================================
-- 3. Acceso
-- =============================================================================

-- server-only: toda lectura y escritura pasa por server actions con
-- `createServiceClient()` (compliance-liberaciones.ts) y por la ruta del PDF de
-- autorización, ambas con guard de rol. El cliente nunca consulta esta tabla
-- directo, así que no se otorga nada a `authenticated`: quién decidió sobre una
-- contraparte con hallazgo no es dato que deba viajar al navegador de cualquiera
-- del workspace.
alter table compliance_liberaciones enable row level security;

-- La policy de lectura NO sobra aunque hoy nadie use el cliente autenticado: es
-- la red por si mañana un consumidor la lee así — sin ella, ese día se leería
-- cross-tenant. No hay policy de insert/update/delete a propósito: escribir es
-- server-only, y update/delete no existen para nadie.
drop policy if exists compliance_liberaciones_select on compliance_liberaciones;
create policy compliance_liberaciones_select on compliance_liberaciones
  for select using (workspace_id = current_user_workspace_id());
