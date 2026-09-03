-- Compliance — indice de documentos del expediente (autosuficiencia probatoria)
--
-- Que resuelve: el objetivo declarado por ALMA es que, ante una auditoria
-- externa, todo salga de ONE y no toque salir a buscar nada. Hoy el expediente
-- esta partido: la plataforma tiene la matriz, los controles, las consultas y
-- las liberaciones, pero el manual SARLAFT/PTEE, el acta que lo aprueba, la
-- designacion del oficial, los informes a junta y las constancias de
-- capacitacion viven en un Drive del cliente y ONE no sabe que existen.
--
-- ── Por que un indice y no un repositorio ─────────────────────────────────
--
-- Duplicar los archivos dentro de ONE crearia dos verdades y le quitaria al
-- cliente el documento vivo que ya sabe manejar. Lo que falta no es almacenar
-- bytes: es que ONE sepa QUE piezas debe tener el expediente, CUAL version
-- estaba vigente en una fecha y QUIEN la aprobo. Eso es un hecho de gobierno y
-- no esta en el historial de revisiones de Drive.
--
-- ── Vigencia, no control de versiones ─────────────────────────────────────
--
-- Drive versiona el contenido (que cambio entre la v2 y la v3). ONE no compite
-- con eso. ONE responde la unica pregunta que hace un auditor:
--
--   "El dia del hecho, cual era la version vigente, quien la aprobo y con que
--    acta."
--
-- Por eso la vigencia vive en filas, una por version aprobada, con intervalo
-- [vigente_desde, vigente_hasta). El limite superior es EXCLUYENTE: la version
-- nueva arranca exactamente el dia en que cierra la anterior, sin huecos ni
-- solapes que obliguen a alguien a interpretar.
--
-- ── Por que la fila apunta a un archivo congelado ─────────────────────────
--
-- Si la URL apunta al documento vivo de Google, ONE apunta a un blanco movil:
-- la fila dice "version 3.0" y el archivo ya va en la 4. La regla operativa
-- acordada es que al aprobarse una version se exporta un PDF a la subcarpeta de
-- versiones y ESE es el que se enlaza. La aplicacion no puede garantizar la
-- regla, pero si puede detectar lo evidente: un enlace a carpeta se rechaza
-- (una carpeta no es una version) y un enlace a documento editable se advierte.
--
-- ── Lo que NO va aqui ─────────────────────────────────────────────────────
--
-- Reportes UIAF, expediente de contraparte y ejecucion de controles son
-- evidencia POR REGISTRO, no documentos de gobierno. Un link pegado a mano por
-- cada consulta se olvida o apunta a un archivo editado despues. Esa evidencia
-- queda amarrada a su propio registro en ONE, no a esta tabla.
--
-- ⚠️ Ninguna pieza de este catalogo puede presentarse como "exigida por norma":
-- el regimen que obliga a ALMA (SAGRILAFT Supersociedades / Circular 027
-- Supertransporte / SAGRILAFT ANI) sigue sin resolverse en nuestros archivos.
-- Lo que la plataforma afirma es que el obligado declaro esa pieza obligatoria
-- para SU expediente. Ver `cerebro/reglas/cautela-afirmacion-marco-normativo.md`.

-- ── Tabla 1: la pieza documental ──────────────────────────────────────────

create table if not exists compliance_documentos (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,

  -- Codigo estable del expediente: MAN-SARLAFT, DES-OC, INF-JD. Es lo que cita
  -- un auditor y lo que sobrevive a que alguien renombre el archivo en Drive.
  codigo text not null check (length(trim(codigo)) between 2 and 40),

  -- Vocabulario cerrado, en check y no en enum: agregar un tipo no deberia
  -- exigir un ALTER TYPE fuera de transaccion. Mismo criterio que
  -- `compliance_periodicidad_config.nivel`.
  tipo text not null check (tipo in (
    'manual',        -- manual SARLAFT / PTEE
    'politica',      -- politicas aprobadas por junta
    'procedimiento', -- procedimientos operativos del sistema
    'acta',          -- acta que aprueba o adopta algo
    'designacion',   -- designacion y posesion del oficial de cumplimiento
    'informe_junta', -- informes periodicos del oficial al organo de gobierno
    'capacitacion',  -- constancias de capacitacion con asistentes
    'otro'
  )),

  nombre text not null check (length(trim(nombre)) between 3 and 200),
  descripcion text,

  -- Si el obligado declaro esta pieza parte de su expediente. Es lo que hace
  -- que el estado `faltante` signifique algo: sin esta bandera, "no hay
  -- version" es indistinguible de "no aplica".
  obligatorio boolean not null default true,

  -- Cada cuantos meses vence la vigencia de la version aprobada (manual anual,
  -- informe a junta trimestral). NULL = no vence por calendario.
  -- El tope de 120 no es normativo: frena un cero o un numero tecleado por
  -- error, que en un lado marca todo vencido y en el otro nunca avisa.
  periodicidad_meses integer
    check (periodicidad_meses is null or (periodicidad_meses >= 1 and periodicidad_meses <= 120)),

  -- Quien responde por mantenerlo vigente. Reusa el catalogo de cargos que ya
  -- existe: inventar aqui un campo de texto libre crearia un segundo padron de
  -- responsables que nadie mantendria sincronizado.
  responsable_cargo_id uuid references compliance_cargos(id) on delete set null,

  activo boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  unique (workspace_id, codigo)
);

comment on table compliance_documentos is
  'Indice del expediente de cumplimiento: que piezas documentales debe tener el obligado. El archivo vive en el Drive del cliente; aqui vive el inventario y el estado.';
comment on column compliance_documentos.obligatorio is
  'Declarado por el obligado, no por MeTRIK. El regimen aplicable a ALMA sigue sin verificarse: la plataforma no afirma que la norma lo exija.';

create index if not exists idx_compliance_documentos_ws
  on compliance_documentos(workspace_id) where activo;

-- ── Tabla 2: la vigencia ──────────────────────────────────────────────────

create table if not exists compliance_documento_versiones (
  id uuid primary key default gen_random_uuid(),

  -- Denormalizado a proposito: toda consulta y toda politica filtran por
  -- workspace, y sin esta columna cada lectura tendria que unir contra la tabla
  -- padre solo para saber de quien es la fila.
  workspace_id uuid not null references workspaces(id) on delete cascade,
  documento_id uuid not null references compliance_documentos(id) on delete cascade,

  version text not null check (length(trim(version)) between 1 and 40),

  -- Enlace al archivo CONGELADO de esa version. No al documento vivo.
  url text not null check (url ~ '^https://'),
  drive_file_id text,

  fecha_aprobacion date,
  aprobado_por text,           -- organo o cargo: "Junta Directiva"
  aprobacion_referencia text,  -- numero de acta

  -- Intervalo [vigente_desde, vigente_hasta). Limite superior EXCLUYENTE.
  vigente_desde date not null,
  vigente_hasta date,          -- null = es la version vigente hoy
  check (vigente_hasta is null or vigente_hasta > vigente_desde),

  -- Prueba de no alteracion. Opcional: si esta, un auditor puede comprobar que
  -- el PDF que abrio es el mismo que se registro.
  hash_sha256 text check (hash_sha256 is null or hash_sha256 ~ '^[0-9a-f]{64}$'),

  -- Un enlace roto no es evidencia parcial, es evidencia ausente. Se guarda el
  -- resultado de la ultima comprobacion para que la pantalla lo muestre sin
  -- salir a la red en cada render.
  url_estado text check (url_estado is null or url_estado in ('ok', 'rota', 'sin_permiso')),
  url_verificada_at timestamptz,

  cargado_por uuid references auth.users(id),
  notas text,
  created_at timestamptz not null default now(),

  unique (documento_id, version)
);

comment on table compliance_documento_versiones is
  'Una fila por version aprobada. Intervalo [vigente_desde, vigente_hasta) con limite superior excluyente: la version nueva arranca el dia en que cierra la anterior.';
comment on column compliance_documento_versiones.url is
  'Enlace al archivo congelado de esta version, no al documento vivo. Si apunta al doc editable, la fila dice una version y el archivo puede ir en otra.';

-- LA invariante del diseno: una sola version abierta por documento. Dos filas
-- con `vigente_hasta` nulo es no saber cual version se aplico, que es
-- exactamente la pregunta que esta tabla existe para responder.
create unique index if not exists idx_documento_version_abierta
  on compliance_documento_versiones(documento_id)
  where vigente_hasta is null;

create index if not exists idx_documento_versiones_doc
  on compliance_documento_versiones(documento_id, vigente_desde desc);

-- Indice para "que estaba vigente el dia F", que es la consulta del auditor.
create index if not exists idx_documento_versiones_vigencia
  on compliance_documento_versiones(workspace_id, vigente_desde, vigente_hasta);

-- `updated_at` con trigger y no solo con default, por lo mismo que se
-- documento en la migracion de periodicidad: `riesgos_controles` llevaba meses
-- con `updated_at = created_at` porque tenia default y no trigger, y cualquier
-- indicador que comparara contra esa columna decia "todo al dia" para siempre.
create or replace function tg_compliance_documentos_touch()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

revoke execute on function public.tg_compliance_documentos_touch() from public;
revoke execute on function public.tg_compliance_documentos_touch() from anon;

drop trigger if exists trg_compliance_documentos_touch on compliance_documentos;
create trigger trg_compliance_documentos_touch
  before update on compliance_documentos
  for each row execute function tg_compliance_documentos_touch();

-- ── Registrar una version nueva, atomicamente ─────────────────────────────
--
-- Publicar una version es DOS escrituras: cerrar la anterior y abrir la nueva.
-- Hechas por separado desde la aplicacion, un fallo entre las dos deja el
-- documento sin ninguna version abierta y la pantalla diria "faltante" sobre un
-- manual que si existe. El indice unico parcial ademas rechazaria el orden
-- inverso. Por eso vive en una funcion: o pasan las dos, o no pasa ninguna.
create or replace function compliance_registrar_version_documento(
  p_documento_id uuid,
  p_workspace_id uuid,
  p_version text,
  p_url text,
  p_vigente_desde date,
  p_drive_file_id text default null,
  p_fecha_aprobacion date default null,
  p_aprobado_por text default null,
  p_aprobacion_referencia text default null,
  p_hash_sha256 text default null,
  p_notas text default null,
  p_cargado_por uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
  v_abierta_desde date;
begin
  -- El documento tiene que ser del workspace que dice serlo. La funcion es
  -- security definer: sin esta verificacion, cualquiera que la alcanzara
  -- podria escribir sobre el expediente de otro cliente.
  if not exists (
    select 1 from compliance_documentos
    where id = p_documento_id and workspace_id = p_workspace_id
  ) then
    raise exception 'documento_no_pertenece_al_workspace';
  end if;

  select vigente_desde into v_abierta_desde
  from compliance_documento_versiones
  where documento_id = p_documento_id and vigente_hasta is null
  for update;

  -- Una version no puede empezar antes que la que viene a reemplazar: el
  -- intervalo quedaria invertido y la pregunta del auditor tendria dos
  -- respuestas para el mismo dia.
  if v_abierta_desde is not null and p_vigente_desde <= v_abierta_desde then
    raise exception 'vigencia_anterior_a_la_version_abierta';
  end if;

  update compliance_documento_versiones
     set vigente_hasta = p_vigente_desde
   where documento_id = p_documento_id and vigente_hasta is null;

  insert into compliance_documento_versiones (
    workspace_id, documento_id, version, url, drive_file_id,
    fecha_aprobacion, aprobado_por, aprobacion_referencia,
    vigente_desde, hash_sha256, notas, cargado_por
  ) values (
    p_workspace_id, p_documento_id, p_version, p_url, p_drive_file_id,
    p_fecha_aprobacion, p_aprobado_por, p_aprobacion_referencia,
    p_vigente_desde, p_hash_sha256, p_notas, p_cargado_por
  )
  returning id into v_id;

  return v_id;
end $$;

-- Toda funcion nace ejecutable por PUBLIC y `anon` la alcanza por ahi. El
-- default de la base no lo evita: hay que revocarlo a mano. La llama el server
-- action con el service client, que ya valido el rol del oficial.
revoke execute on function public.compliance_registrar_version_documento(
  uuid, uuid, text, text, date, text, date, text, text, text, text, uuid
) from public, anon, authenticated;

-- ── RLS ───────────────────────────────────────────────────────────────────
--
-- Server-only, mismo criterio que el resto de compliance: el expediente lo lee
-- y lo escribe el oficial de cumplimiento a traves de server actions que
-- validan el rol antes de tocar nada. Ningun cliente consulta directo.
alter table compliance_documentos enable row level security;
alter table compliance_documento_versiones enable row level security;

revoke all on compliance_documentos from anon, authenticated;
revoke all on compliance_documento_versiones from anon, authenticated;
