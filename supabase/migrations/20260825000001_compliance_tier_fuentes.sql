-- Compliance — catálogo de tier de fuentes de consulta (dictamen 2026-08-25)
--
-- Problema: la severidad de una consulta contra listas restrictivas es binaria
-- (`compliance-dual.ts`: total_matches > 0 -> 'alto'). Trata igual un acto del
-- Consejo de Seguridad de la ONU y una nota de El Tiempo. Medido en `alma-afi`
-- el 2026-08-25: 4 consultas con hallazgo, 50 coincidencias, CERO en lista
-- vinculante, y la mitad de las coincidencias (25/50) son menciones de prensa.
--
-- Esta migración crea el catálogo que clasifica la fuente por su naturaleza
-- jurídica. NO cambia el comportamiento de ninguna pantalla: `severidad` queda
-- intacta y nada consume todavía el tier. El clasificador se construye al lado
-- (src/lib/compliance/tier-fuentes.ts) y no decide nada en producción.
--
-- Tres decisiones de diseño que explican la forma de las tablas:
--
--   1. El catálogo es GLOBAL del producto, NO por workspace. El tier es un hecho
--      normativo —qué ES la fuente— no una preferencia de cliente. Lo que sí será
--      por workspace, más adelante, es qué tier frena una contratación. Por eso
--      aquí no hay `workspace_id` y no hay RLS por tenant.
--
--   2. La llave es `matches[].detalle.fuente` NORMALIZADO, nunca el nombre visible
--      de la lista. En producción ya hay mojibake:
--      'USA WANTED: NARCOTICS REWARDS PROGRAMâ<80><94>MISCELLANEOUS TARGETS' (guion largo
--      UTF-8 leído como latin-1). Si la llave fuera el texto visible, un cambio de
--      codificación aguas arriba convertiría una lista clasificada en fuente
--      desconocida — es decir, en un falso negativo silencioso. Con llave
--      `NAREWUSA` eso no pasa.
--
--   3. CADA FUENTE DECLARA POR QUÉ LLAVE RESUELVE (`llave_tipo`), en vez de
--      cablear una excepción para medios. Es una columna y no un supuesto porque
--      los casos que no resuelven por código son más de uno y no comparten causa:
--        - Medios: `fuente` es el NOMBRE DEL MEDIO —14 distintos medidos bajo la
--          única lista 'NSN MEDIOS'— y el conjunto crece con cada nota. Es
--          cardinalidad abierta.
--        - PEP Decreto 830: `fuente` no es un código sino
--          'PEP - Cumple Decreto 830 - 26 de Julio de 2021', un texto con la fecha
--          adentro. Una llave con fecha caduca el día que Informa reedite la
--          etiqueta, y la fila dejaría de resolver en silencio.
--      Con `llave_tipo` en la tabla, el tercer caso que aparezca se agrega como
--      fila y no como rama de código.
--
-- El catálogo NO define el veredicto ni la bandeja. Esa parte del dictamen
-- (§10/§11) está pendiente de la firma jurídica de Emilio y no se implementa aquí.

-- =============================================================================
-- 1. Versiones del catálogo — cadena de custodia y firma dual
-- =============================================================================

-- Por qué el catálogo se versiona en vez de ser una tabla plana: el tier es una
-- afirmación normativa sobre la que se emite un veredicto. Sin la versión
-- estampada en cada consulta, un veredicto verde de hoy es irreconstruible
-- mañana — no se podría probar bajo qué clasificación se emitió. Es la extensión
-- del requisito ya obligatorio para Tier 3 (log inmutable de versión de lista al
-- momento de cada consulta).
--
-- Estructura de firma dual tomada de cerebro/decisiones/2026-05-30_gobernanza-catalogos-sarlaft.md.

-- server-only: quién clasificó una fuente y bajo qué firma es la evidencia con
-- la que MéTRIK responde ante un supervisor. Se lee desde server actions con
-- `createServiceClient()`; el navegador nunca la consulta directo.
create table if not exists compliance_tier_catalogo_versiones (
  version integer primary key,

  status text not null check (status in ('propuesta', 'validada_tecnica', 'vigente', 'historica')),

  razon_cambio text not null,
  -- Documento normativo que sustenta ESTA versión. Sin él, la clasificación es
  -- una opinión sin autor.
  fuente_dictamen text not null,
  extraccion_metodo text not null default 'manual'
    check (extraccion_metodo in ('manual', 'ia_asistida')),

  -- Firma técnica: valida el método y la clasificación. Lucía es un rol
  -- funcional, no un `profiles.id`, así que se guarda como texto — el día que
  -- exista usuario, se migra; hoy inventar la FK sería inventar la evidencia.
  validada_tecnica_by text,
  validada_tecnica_at timestamptz,
  validada_tecnica_nota text,

  -- Firma jurídica: decide publicar. Representante legal de MéTRIK SAS, suplente
  -- Emilio (CLO).
  firmada_legal_by uuid references profiles(id) on delete restrict,
  firmada_legal_at timestamptz,
  -- Qué vio el firmante ANTES de firmar. No basta con registrar que alguien
  -- firmó: sin la huella, la firma es un rubber-stamp y la defensa ante un
  -- supervisor se cae.
  huella_revision_legal_jsonb jsonb,

  created_at timestamptz not null default now(),
  retirada_at timestamptz,

  -- La regla que hace que "un catálogo sin firmar no opera" sea un hecho de la
  -- base y no una convención de la aplicación: sin firma jurídica, la versión no
  -- puede alcanzar `vigente`.
  constraint compliance_tier_catalogo_vigente_exige_firma_legal
    check (
      status <> 'vigente'
      or (firmada_legal_by is not null and firmada_legal_at is not null)
    ),

  constraint compliance_tier_catalogo_firma_legal_completa
    check ((firmada_legal_by is null) = (firmada_legal_at is null)),

  constraint compliance_tier_catalogo_firma_tecnica_completa
    check ((validada_tecnica_by is null) = (validada_tecnica_at is null))
);

-- Una sola versión vigente a la vez. Dos versiones vigentes es no saber bajo cuál
-- se clasificó, que es exactamente lo que el versionado existe para evitar.
create unique index if not exists idx_compliance_tier_catalogo_una_vigente
  on compliance_tier_catalogo_versiones((status))
  where status = 'vigente';

comment on table compliance_tier_catalogo_versiones is
  'Versiones del catálogo de tier de fuentes, con firma dual (técnica + jurídica). Global del producto, NO por workspace: el tier es un hecho normativo, no una preferencia de cliente.';
comment on column compliance_tier_catalogo_versiones.status is
  'Solo `vigente` opera en producción, y el CHECK exige firma jurídica para llegar ahí. La versión 1 nace en `validada_tecnica` a propósito: tiene firma técnica de Lucía y le falta la jurídica.';
comment on column compliance_tier_catalogo_versiones.huella_revision_legal_jsonb is
  'Qué tenía a la vista el firmante jurídico. Mismo patrón que la gobernanza de catálogos SARLAFT: registrar la firma sin registrar lo revisado no prueba nada.';

-- =============================================================================
-- 2. Las fuentes clasificadas
-- =============================================================================

-- server-only: mismo criterio que la tabla de versiones — se lee por server
-- action, nunca desde el navegador.
create table if not exists compliance_tier_fuentes (
  id uuid primary key default gen_random_uuid(),
  catalogo_version integer not null
    references compliance_tier_catalogo_versiones(version) on delete cascade,

  -- Cuál de los dos campos del payload es la llave de ESTA fila.
  --   'fuente' -> `matches[].detalle.fuente` (código estable: OFAC, PEPINT, CSL…)
  --   'lista'  -> `matches[].lista`, solo cuando `fuente` es de cardinalidad
  --               abierta (medios) o no es un código (PEP Decreto 830)
  llave_tipo text not null check (llave_tipo in ('fuente', 'lista')),
  -- Guardada YA NORMALIZADA (mayúsculas, sin tildes, espacios colapsados). La
  -- normalización canónica es `normalizarLlave()` en
  -- src/lib/compliance/tier-fuentes.ts; si las dos se separan, el catálogo deja
  -- de resolver y todo cae a `sin_clasificar` — ruidoso, no silencioso.
  llave text not null,

  -- `sin_clasificar` NO es un valor de esta tabla: es la AUSENCIA de fila. Que no
  -- se pueda escribir es la garantía de que nadie clasifique algo como
  -- "desconocido" a mano y lo saque de la cola de clasificación.
  tier text not null check (tier in ('tier_1', 'tier_2', 'tier_3', 'tier_4', 'medios')),

  familia text not null check (familia in (
    'vinculante',            -- Tier 1: consecuencia jurídica directa en Colombia
    'pep',                   -- Tier 2: condición/cargo, no infracción
    'sanciones_extranjeras', -- Tier 3: acto de autoridad, materia LA/FT, no vinculante acá
    'judicial',              -- Tier 4: proceso judicial, materia no LA/FT
    'contratacion_publica',  -- Tier 4
    'ambiental',             -- Tier 4
    'medios'                 -- publicación de un tercero, sin acto de autoridad
  )),

  -- Clasificación no firme: se aplica, se muestra como provisional y queda en
  -- cola de verificación. Hoy solo NSNLAT, cuya composición está pedida a Informa.
  provisional boolean not null default false,

  etiqueta text not null,
  -- Por qué ESTE tier. Es lo que se cita en pantalla y ante un supervisor.
  sustento text not null,

  -- El nombre de lista tal como llega, SOLO informativo cuando la llave es
  -- `fuente`. Deliberadamente NO es llave ni tiene índice único: es el campo con
  -- mojibake.
  lista_referencia text,

  -- Deduplicación entre fuentes que agregan a otras: la Consolidated Screening
  -- List del gobierno de EE.UU. reempaqueta OFAC, así que la misma entidad puede
  -- venir por ambas. Es un hallazgo, no dos. Fuentes del mismo grupo colapsan
  -- cuando además coinciden en la entidad encontrada. NULL = no agrupa con nadie.
  grupo_dedup text,

  created_at timestamptz not null default now(),

  constraint compliance_tier_fuentes_llave_no_vacia check (btrim(llave) <> ''),
  -- Una fuente no puede tener dos tiers dentro de la misma versión del catálogo.
  constraint compliance_tier_fuentes_llave_unica
    unique (catalogo_version, llave_tipo, llave)
);

-- La lectura real: "dame todas las fuentes de la versión N".
create index if not exists idx_compliance_tier_fuentes_version
  on compliance_tier_fuentes(catalogo_version);

comment on table compliance_tier_fuentes is
  'Clasificación por tier de cada fuente devuelta por Informa/SEIYA. Llave = detalle.fuente normalizado; `lista` solo cuando fuente es de cardinalidad abierta (medios) o no es un código.';
comment on column compliance_tier_fuentes.llave is
  'Normalizada con el mismo criterio que normalizarLlave() en src/lib/compliance/tier-fuentes.ts. Nunca el nombre visible de la lista: en producción ya hay mojibake.';
comment on column compliance_tier_fuentes.provisional is
  'La clasificación se aplica pero no es firme. Se muestra como provisional y queda en cola de verificación con la fuente.';
comment on column compliance_tier_fuentes.grupo_dedup is
  'Fuentes que reempaquetan a otras comparten grupo (CSL agrega OFAC). Misma entidad en el mismo grupo = un hallazgo, no dos.';

-- =============================================================================
-- 3. Estampa de versión en la consulta
-- =============================================================================

-- Nullable a propósito, y el histórico existente queda en NULL = "versión 0",
-- que se lee como "clasificada antes de que existiera el catálogo". Rellenarlo
-- hacia atrás sería afirmar que esas consultas se emitieron bajo una
-- clasificación que en ese momento no existía.
alter table consultas_listas_dual
  add column if not exists tier_catalogo_version integer
  references compliance_tier_catalogo_versiones(version) on delete restrict;

comment on column consultas_listas_dual.tier_catalogo_version is
  'Versión del catálogo de tier vigente al clasificar esta consulta. NULL = consulta anterior al catálogo (versión 0). Sin esto, un veredicto de hoy es irreconstruible mañana.';

-- =============================================================================
-- 4. Acceso
-- =============================================================================

-- Las dos tablas son globales del producto: no hay `workspace_id` contra el cual
-- filtrar y no se otorga nada a `authenticated` ni a `anon`. RLS queda habilitada
-- igual —sin policies, nadie lee por el cliente— para que el día que alguien
-- exponga la tabla al navegador tenga que escribir la policy a propósito en vez
-- de heredarla abierta.
alter table compliance_tier_catalogo_versiones enable row level security;
alter table compliance_tier_fuentes enable row level security;

-- =============================================================================
-- 5. Siembra — versión 1
-- =============================================================================

-- Nace en `validada_tecnica`, NO en `vigente`: tiene la firma técnica de Lucía y
-- le falta la jurídica. Un catálogo sin firmar no opera, y hoy no opera nada, así
-- que la siembra solo tiene que ser consistente con esa regla — el clasificador
-- la refleja en su bandera `operable`.
insert into compliance_tier_catalogo_versiones (
  version, status, razon_cambio, fuente_dictamen, extraccion_metodo,
  validada_tecnica_by, validada_tecnica_at, validada_tecnica_nota
) values (
  1,
  'validada_tecnica',
  'Catálogo inicial: las 14 listas observadas en producción (workspace alma-afi, medición 2026-08-25), clasificadas por naturaleza jurídica de la fuente y no por su nombre.',
  'proyectos/afi/alma/docs/entrada/2026-08-25_dictamen-tier-listas.md §3',
  'manual',
  'Lucía Miranda — Especialista Compliance LA/FT',
  '2026-08-25T00:00:00Z',
  'Clasificación por el criterio del §1: ¿hay autoridad que decidió, consta en el acto, y Colombia obliga a acatarlo? Ninguna de las 14 es Tier 1: cero coincidencias en lista vinculante en toda la historia del workspace. NSNLAT queda Tier 3 provisional hasta que Informa aclare su composición.'
) on conflict (version) do nothing;

insert into compliance_tier_fuentes
  (catalogo_version, llave_tipo, llave, tier, familia, provisional, etiqueta, sustento, lista_referencia, grupo_dedup)
values
  -- ── Medios ────────────────────────────────────────────────────────────────
  -- Llave por `lista`: bajo esta única lista se midieron 14 medios distintos, y
  -- ese conjunto crece con cada nota publicada. El rasgo que define la categoría
  -- es justamente ese: el emisor de la entrada es un medio de comunicación.
  (1, 'lista', 'NSN MEDIOS', 'medios', 'medios', false,
   'Menciones en medios',
   'El emisor de cada entrada es un medio de comunicación. No hay acto de autoridad ni debido proceso. Todas las coincidencias medidas son por nombre, ninguna por documento.',
   'NSN MEDIOS', null),

  -- ── Tier 3 — sanciones de autoridad extranjera, materia LA/FT ─────────────
  (1, 'fuente', 'OFAC', 'tier_3', 'sanciones_extranjeras', false,
   'OFAC — Departamento del Tesoro EE.UU.',
   'Sanción de autoridad extranjera por materia LA/FT. NO vinculante en Colombia (Concepto SFC 2011041962-001), estándar de facto por corresponsalía en USD.',
   'OFAC', 'OFAC'),

  (1, 'fuente', 'CSL', 'tier_3', 'sanciones_extranjeras', false,
   'Consolidated Screening List — EE.UU.',
   'Consolidado del gobierno de EE.UU. que agrega listas sancionatorias y de control de exportaciones. Autoridad extranjera, no vinculante en Colombia.',
   'CONSOLIDATED SCREENING LIST', 'OFAC'),

  (1, 'fuente', 'NAREWUSA', 'tier_3', 'sanciones_extranjeras', false,
   'Narcotics Rewards Program — EE.UU.',
   'Acto de autoridad extranjera, materia narcotráfico: delito fuente por excelencia. No vinculante en Colombia, pero es el Tier 3 de mayor peso material.',
   -- El nombre visible de esta lista es el que llega con mojibake en producción.
   -- Se guarda solo como referencia; la llave es el código.
   'USA WANTED: NARCOTICS REWARDS PROGRAM (MISCELLANEOUS TARGETS)', null),

  (1, 'fuente', 'GCCCASL', 'tier_3', 'sanciones_extranjeras', false,
   'Sanciones autónomas de Canadá',
   'Régimen autónomo de sanciones de autoridad extranjera. Idéntica naturaleza a OFAC; no vinculante en Colombia.',
   'CANADA CONSOLIDATED CANADIAN AUTONOMOUS SANCTIONS LIST', null),

  (1, 'fuente', 'CANFACFO', 'tier_3', 'sanciones_extranjeras', false,
   'Canadá — congelamiento de activos de funcionarios extranjeros corruptos',
   'Congelamiento de activos por autoridad extranjera, materia corrupción de funcionarios. No vinculante en Colombia. También relevante para el programa PTEE.',
   'CANADA FREEZING ASSETS OF CORRUPT FOREIGN OFFICIALS CANFACFO', null),

  (1, 'fuente', 'PANVEN', 'tier_3', 'sanciones_extranjeras', false,
   'Panamá — personas y empresas de alto riesgo LA/FT',
   'Autoridad extranjera, materia LA/FT explícita. No vinculante en Colombia.',
   'PANAMA LISTA DE PERSONA Y EMPRESA CON ALTO RIESGO LAFT', null),

  -- Provisional: el nombre no la clasifica —"NOTICIAS" sugiere prensa,
  -- "SANCIONES" sugiere actos de autoridad— y su composición está pedida a
  -- Informa. Por la regla de fuente desconocida se queda del lado que dispara
  -- hasta que se aclare, no del lado cómodo.
  (1, 'fuente', 'NSNLAT', 'tier_3', 'sanciones_extranjeras', true,
   'Sanciones y noticias LATAM (clasificación provisional)',
   'Composición por verificar con Informa. Se mantiene en el tier que dispara mientras no se aclare qué compila: bajarla sin saberlo sería elegir el lado cómodo de una duda.',
   'NOMBRES SANCIONES NOTICIAS LATAM', null),

  -- ── Tier 2 — PEP ──────────────────────────────────────────────────────────
  (1, 'fuente', 'PEPSIGEP', 'tier_2', 'pep', false,
   'PEP — SIGEP (Colombia)',
   'Fuente oficial del régimen PEP colombiano. Condición/cargo público ejercido legalmente, no infracción: exige debida diligencia intensificada (Decreto 830/2021), no reproche.',
   'PERSONAS EXPUESTAS POLITICAMENTE SIGEP', null),

  (1, 'fuente', 'PEPINT', 'tier_2', 'pep', false,
   'PEP internacionales',
   'PEP extranjeros y de organizaciones internacionales. El alcance exacto del Decreto 830/2021 sobre PEP extranjeros queda por verificar: no cambia el tier, sí el sustento que se cita en pantalla.',
   'PERSONAS EXPUESTAS POLITICAMENTE INTERNACIONALES', null),

  -- Llave por `lista`. Su `detalle.fuente` en producción es
  -- 'PEP - Cumple Decreto 830 - 26 de Julio de 2021': un texto con fecha adentro,
  -- no un código. Ese texto cambia el día que Informa reedite la etiqueta y la
  -- fila dejaría de resolver; el nombre de la lista es lo estable de las dos.
  (1, 'lista', 'PERSONA EXPUESTA POLITICAMENTE DECRETO 830 DE 2021', 'tier_2', 'pep', false,
   'PEP — Decreto 830 de 2021',
   'Condición/cargo público, no infracción. Debida diligencia intensificada (Decreto 830/2021).',
   'PERSONA EXPUESTA POLITICAMENTE DECRETO 830 DE 2021', null),

  -- ── Tier 4 — acto de autoridad, materia fuera del perímetro SARLAFT ───────
  (1, 'fuente', 'RAMA JUDICIAL', 'tier_4', 'judicial', false,
   'Incidentes judiciales — Rama Judicial',
   'Hay acto de autoridad, pero un proceso judicial no es una sanción y la materia no es LA/FT. Identidad fuerte (las 3 coincidencias medidas son por NIT al 100%): lo dudoso es la relevancia, no la persona.',
   'INCIDENTES JUDICIALES', null),

  (1, 'fuente', 'SAMEXCLS', 'tier_4', 'contratacion_publica', false,
   'SAM Exclusions — EE.UU.',
   'Exclusión de contratación federal de EE.UU. Acto de autoridad, materia contratación pública, no LA/FT. Mismo trato que BM/FMI debarred y SECOP.',
   'USA SAM EXCLUSION', null),

  (1, 'fuente', 'ANLA1', 'tier_4', 'ambiental', false,
   'Sanciones activas ANLA',
   'Acto de autoridad colombiana, materia ambiental, no LA/FT. Identidad fuerte (por NIT al 100%) y materialmente relevante para una concesión vial, pero fuera del perímetro SARLAFT.',
   'LISTA DE SANCIONES ACTIVAS DE ANLA', null)
on conflict (catalogo_version, llave_tipo, llave) do nothing;
