import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
import { PGlite } from '@electric-sql/pglite'
import { todayBogotaISO } from '@/lib/dates/bogota'
import { RESTRICCION_VIGENTE_DESDE, sumarDias } from './plazos'

/**
 * La v1.4 de los Términos de los CDA POR AVISO (cláusula 13.1), EJECUTADA contra las migraciones reales:
 * `20261007150000_terminos_modificacion_por_aviso.sql` y el alta de datos
 * `sql/valida-cda/2026-10-07_terminos-v1.4-por-aviso.sql`, que aplica una persona sobre producción y no
 * corre ningún otro check.
 *
 * Lo que la base decide sola, aunque el servidor tuviera un defecto:
 *   - una versión por aviso modifica una de su misma serie y rige al menos 30 días después de publicada;
 *   - lo del aviso (qué reemplaza, cuándo se publicó) no se reescribe;
 *   - la persona designada (y solo ella) acepta la v1.4 publicada ANTES de que rija; una versión de
 *     entrada futura sigue sin poder aceptarse;
 *   - la constancia de quién vio el aviso se inserta una vez por persona y no se modifica ni se borra;
 *   - `mis_documentos_de_servicio` le dice al servidor qué versión es por aviso.
 *
 * Y lo que promete el alta de datos: un bloque por CDA, en ensayo por defecto, que no corre otro día que el
 * de la publicación, ni sin el PDF subido, ni sobre una v1.3 sin aceptar; que deja la v1.3 vigente hasta el
 * 5-nov y la v1.4 desde el 6-nov; y que una segunda corrida no duplica.
 */

const RAIZ = process.cwd()
const leer = (ruta: string) => readFileSync(join(RAIZ, ruta), 'utf8')
const migracion = (archivo: string) => leer(join('supabase/migrations', archivo))
const ALTA = leer('sql/valida-cda/2026-10-07_terminos-v1.4-por-aviso.sql')

const WS_METRIK = 'a21bfc88-1a60-48c3-afcd-144226aa2392'
const LINEA_VALIDA = '7d9f8994-a843-4032-a632-a6286ec61d94'
const MAURICIO = 'cc6f6100-4eb7-4eed-9a7c-096729f5cedf'
const TITULO = 'Términos de Suscripción al Servicio VALIDA · Plan CDA'
const sha256 = (t: string) => createHash('sha256').update(t, 'utf8').digest('hex')

interface Bloque {
  sql: string
  slug: string
  ws: string
  empresa: string
  negocio: string
  previa: string
  previaVersion: string
  previaPdf: string
  textoSha: string
  pdfSha: string
  pdfPath: string
  designada: string
  operadora: string
  contrato: string
}

function constante(sql: string, nombre: string): string {
  const m = new RegExp(`${nombre}\\s+constant (?:uuid|text|date) := (?:date )?'([^']*)'`).exec(sql)
  if (!m) throw new Error(`el bloque no declara ${nombre}`)
  return m[1]
}

const BLOQUES: Bloque[] = [...ALTA.matchAll(/do \$bloque\$[\s\S]*?\$bloque\$;/g)].map((m, i) => {
  const sql = m[0]
  const n = (i + 1).toString(16).padStart(2, '0')
  return {
    sql,
    slug: constante(sql, 'c_slug_ws'),
    ws: constante(sql, 'c_ws_cda'),
    empresa: constante(sql, 'c_empresa'),
    negocio: constante(sql, 'c_negocio'),
    previa: constante(sql, 'c_previa'),
    previaVersion: constante(sql, 'c_previa_version'),
    previaPdf: constante(sql, 'c_previa_pdf'),
    textoSha: constante(sql, 'c_texto_sha256'),
    pdfSha: constante(sql, 'c_pdf_sha256'),
    pdfPath: constante(sql, 'c_pdf_path'),
    designada: `00000000-0000-4000-8000-0000000e00${n}`,
    operadora: `00000000-0000-4000-8000-0000000d00${n}`,
    contrato: `00000000-0000-4000-8000-0000000c00${n}`,
  }
})
const CDAS = BLOQUES.slice(0, 4)
const QA = BLOQUES[4]

/** El día de hoy en Bogotá: la prueba corre cualquier día, y el bloque solo corre el de la publicación. */
const HOY = todayBogotaISO()

/** El bloque con el día de publicación de la prueba (hoy) y, si se pide, fuera de ensayo. */
function preparar(b: Bloque, o: { ensayo: boolean; publicacion?: string }): string {
  let sql = b.sql
  const reemplazar = (de: string, a: string) => {
    expect(sql.split(de).length - 1).toBe(1)
    sql = sql.replace(de, a)
  }
  const publicacion = o.publicacion ?? HOY
  reemplazar("c_publicacion constant date := date '2026-10-07';", `c_publicacion constant date := date '${publicacion}';`)
  reemplazar("c_vigencia    constant date := date '2026-11-06';", `c_vigencia    constant date := date '${sumarDias(publicacion, 30)}';`)
  if (!o.ensayo) reemplazar('c_ensayo constant boolean := true;', 'c_ensayo constant boolean := false;')
  return sql
}

const ESQUEMA_BASE = `
  set time zone 'UTC';
  create role anon nologin;
  create role authenticated nologin;
  create role service_role nologin;
  grant usage on schema public to anon, authenticated, service_role;
  alter default privileges in schema public grant execute on functions to anon, authenticated, service_role;
  alter default privileges in schema public grant all on tables to service_role;

  create schema vault;
  create table vault.secrets (id uuid primary key default gen_random_uuid(), secret text not null);
  create view vault.decrypted_secrets as select id, secret as decrypted_secret from vault.secrets;

  create schema cron;
  create table cron.job (jobid bigserial primary key, jobname text unique, schedule text not null, command text not null);
  create function cron.schedule(job_name text, schedule text, command text) returns bigint
    language sql as $$
      insert into cron.job (jobname, schedule, command) values (job_name, schedule, command)
      on conflict (jobname) do update set schedule = excluded.schedule, command = excluded.command
      returning jobid $$;
  create function cron.unschedule(job_name text) returns boolean
    language sql as $$ delete from cron.job where jobname = job_name returning true $$;

  create schema storage;
  create table storage.buckets (id text primary key, name text not null, public boolean not null default false);
  create table storage.objects (id uuid primary key default gen_random_uuid(), bucket_id text, name text);

  create table public.workspaces (id uuid primary key, slug text);
  create table public.profiles (
    id uuid primary key,
    workspace_id uuid references public.workspaces(id),
    role text,
    full_name text,
    platform_admin boolean not null default false
  );
  create table public.empresas (id uuid primary key, nombre text);
  create table public.lineas_negocio (id uuid primary key, nombre text);
  create table public.negocios (
    id uuid primary key,
    workspace_id uuid not null references public.workspaces(id),
    nombre text
  );
  create table public.cobros (
    id uuid primary key,
    workspace_id uuid not null references public.workspaces(id),
    negocio_id uuid references public.negocios(id),
    fecha date,
    monto numeric(15,2) not null default 0,
    monto_anulado numeric(15,2),
    fuente text,
    anulado_at timestamptz,
    notas text,
    siigo_recibo jsonb,
    plan_cobro_id uuid,
    numero_cuota integer,
    tipo_cobro text,
    created_at timestamptz not null default now()
  );
  create table public.catalogo_servicios (
    slug text primary key, nombre text not null, modulo text not null, disparador_cobro text not null
  );
  create table public.servicios_contratados (
    id uuid primary key,
    workspace_id uuid not null references public.workspaces(id),
    empresa_id uuid not null references public.empresas(id),
    negocio_id uuid not null references public.negocios(id),
    servicio_slug text not null references public.catalogo_servicios(slug),
    servicio_version integer not null,
    workspace_pagador_id uuid references public.workspaces(id),
    estado text not null default 'activo',
    vigente_desde date not null,
    vigente_hasta date,
    comision jsonb,
    correo_facturacion text
  );
  create table public.servicio_contratado_beneficiarios (
    servicio_contratado_id uuid not null references public.servicios_contratados(id) on delete cascade,
    workspace_id uuid not null references public.workspaces(id),
    primary key (servicio_contratado_id, workspace_id)
  );
  create table public.wa_message_log (
    id uuid primary key default gen_random_uuid(),
    workspace_id uuid references public.workspaces(id),
    phone text not null,
    direction text not null,
    intent text,
    message_preview text,
    created_at timestamptz default now()
  );
  create table public.planes_cobro (
    id uuid primary key,
    workspace_id uuid not null references public.workspaces(id),
    negocio_id uuid not null references public.negocios(id),
    activo boolean not null default true,
    notas text
  );
  create table public.plan_cobro_cuotas (
    id uuid primary key default gen_random_uuid(),
    workspace_id uuid not null references public.workspaces(id),
    plan_cobro_id uuid not null references public.planes_cobro(id),
    numero integer not null,
    tipo text not null default 'cuota',
    monto numeric not null,
    fecha_vencimiento date not null,
    concepto_detalle text
  );
  create table public.bot_sessions (
    id uuid primary key default gen_random_uuid(),
    workspace_id uuid not null references public.workspaces(id),
    user_phone text not null,
    context jsonb default '{}',
    expires_at timestamptz default (now() + interval '5 minutes')
  );

  create function public.current_user_workspace_id() returns uuid
    language sql stable as $$ select nullif(current_setting('prueba.ws', true), '')::uuid $$;

  insert into public.workspaces (id, slug) values ('${WS_METRIK}', 'metrik');
  insert into public.profiles (id, workspace_id, role, full_name, platform_admin)
    values ('${MAURICIO}', '${WS_METRIK}', 'owner', 'Mauricio', true);
  insert into public.lineas_negocio (id, nombre) values ('${LINEA_VALIDA}', 'Valida');
  insert into public.catalogo_servicios values ('valida-cda-licencia', 'Suscripción Valida por CDA', 'valida_consulta', 'ciclo');
`

/** La declaración que firma la persona designada (lo que la guarda exige: nombre, cédula y huella). */
function declaracion(b: Bloque, version: string, pdf: string): string {
  return `Yo, Representante ${b.slug}, identificado(a) con cédula 79123456, actúo como REPRESENTANTE LEGAL. ACEPTO los ${TITULO} ${version} (huella SHA-256 del PDF: ${pdf}). Ley 527 de 1999.`
}

function aceptar(b: Bloque, o: { documento: string; version: string; pdf: string; texto: string; usuario?: string }): string {
  return `insert into public.aceptaciones_terminos
    (workspace_id, negocio_id, canal, estado, nombre_aceptante, cedula_aceptante, calidad, empresa_nombre, empresa_nit,
     usuario_id, workspace_cliente_id, documento_version_id, documento_titulo, documento_version, documento_sha256,
     texto_documento_sha256, texto_aceptacion, ip, user_agent)
  values
    ('${WS_METRIK}', '${b.negocio}', 'modulo', 'aceptado', 'Representante ${b.slug}', '79123456', 'representante_legal',
     'RAZON ${b.slug}', '900000000-0', '${o.usuario ?? b.designada}', '${b.ws}', '${o.documento}', '${TITULO}',
     '${o.version}', '${o.pdf}', '${o.texto}', '${declaracion(b, o.version, o.pdf)}', '190.24.1.10', 'Mozilla/5.0')`
}

/** Lo que había en producción el 2026-10-07: el CDA con su v1.3 vigente y aceptada por la designada. */
function sembrarCda(b: Bloque): string {
  const textoPrevio = sha256(`# Términos ${b.previaVersion} ${b.slug}`)
  return `
    insert into public.workspaces (id, slug) values ('${b.ws}', '${b.slug}');
    insert into public.profiles (id, workspace_id, role, full_name) values
      ('${b.designada}', '${b.ws}', 'owner', 'Representante ${b.slug}'),
      ('${b.operadora}', '${b.ws}', 'operator', 'Operadora ${b.slug}');
    insert into public.empresas (id, nombre) values ('${b.empresa}', 'RAZON ${b.slug}');
    insert into public.negocios (id, workspace_id, nombre) values ('${b.negocio}', '${WS_METRIK}', 'Valida CDA — ${b.slug}');
    insert into public.servicios_contratados
      (id, workspace_id, empresa_id, negocio_id, servicio_slug, servicio_version, workspace_pagador_id, vigente_desde, aceptante_designado_id)
    values
      ('${b.contrato}', '${WS_METRIK}', '${b.empresa}', '${b.negocio}', 'valida-cda-licencia', 1, '${b.ws}', date '2026-09-23', '${b.designada}');
    insert into public.documentos_contractuales_versiones
      (id, workspace_id, linea_id, slug, alcance, empresa_id, titulo, version, texto_md, texto_sha256, pdf_path, pdf_sha256, vigente_desde)
    values
      ('${b.previa}', '${WS_METRIK}', '${LINEA_VALIDA}', 'terminos-suscripcion-valida-cda', 'cliente', '${b.empresa}', '${TITULO}',
       '${b.previaVersion}', '# Términos ${b.previaVersion} ${b.slug}', '${textoPrevio}', '${b.slug}/previa.pdf', '${b.previaPdf}',
       date '2026-09-24');
    ${aceptar(b, { documento: b.previa, version: b.previaVersion, pdf: b.previaPdf, texto: textoPrevio })};
    insert into storage.objects (bucket_id, name) values ('aceptaciones-documentos', '${b.pdfPath}');
  `
}

let db: PGlite

async function correr(sql: string): Promise<string> {
  try {
    await db.exec(sql)
    return ''
  } catch (e) {
    return (e as Error).message
  }
}

/** Corre `sql` en una transacción que se deshace. Devuelve el mensaje de error, o '' si pasó. */
async function ensayo(sql: string): Promise<string> {
  await db.exec('begin')
  try {
    await db.exec(sql)
    return ''
  } catch (e) {
    return (e as Error).message
  } finally {
    await db.exec('rollback')
  }
}

async function v14De(b: Bloque) {
  const r = await db.query<{
    id: string
    vigente_desde: string
    rige_por_aviso: boolean
    reemplaza_version_id: string
    publicado: string
    titulo: string
    linea_id: string
  }>(
    `select id, vigente_desde::text, rige_por_aviso, reemplaza_version_id,
            ((publicada_at at time zone 'America/Bogota')::date)::text as publicado, titulo, linea_id
       from public.documentos_contractuales_versiones
      where empresa_id = '${b.empresa}' and version = 'v1.4'`,
  )
  return r.rows
}

beforeAll(async () => {
  db = new PGlite()
  await db.exec(ESQUEMA_BASE)
  await db.exec(migracion('20260901000003_wa_envios.sql'))
  await db.exec(migracion('20260915040000_aceptaciones_terminos.sql'))
  await db.exec(migracion('20260915060000_purga_registros_bot.sql'))
  await db.exec(migracion('20260916180000_modulo_valida_api.sql'))
  await db.exec(migracion('20260916213000_mis_documentos_de_servicio_por_negocio.sql'))
  await db.exec(migracion('20260917014500_aceptacion_terminos_en_modulo.sql'))
  await db.exec(migracion('20260923220000_terminos_cda_designado_y_enlace_pago.sql'))
  await db.exec(migracion('20260929030000_documentos_alcance_plantilla.sql'))
  await db.exec(migracion('20261007150000_terminos_modificacion_por_aviso.sql'))
  for (const b of BLOQUES) await db.exec(sembrarCda(b))
}, 60_000)

afterAll(async () => {
  await db?.close()
})

describe('el archivo de alta', () => {
  it('trae un bloque por cada uno de los 4 CDA con contrato, y uno de QA para CDA Pruebas', () => {
    expect(CDAS.map((b) => b.slug)).toEqual(['cda-caqueta', 'cda-elcarmen', 'cda-puertotest', 'maxitec'])
    expect(QA.slug).toBe('cda-pruebas')
    expect(new Set(BLOQUES.map((b) => b.pdfSha)).size).toBe(5)
    for (const b of BLOQUES) expect(b.pdfPath).toBe(`${b.slug}/terminos-suscripcion-valida-cda-v1.4.pdf`)
  })

  it('cada bloque nace en ensayo, publica el 7-oct y rige el 6-nov (la constante de plazos.ts dice lo mismo)', () => {
    for (const b of BLOQUES) {
      expect(b.sql).toContain('c_ensayo constant boolean := true;')
      expect(constante(b.sql, 'c_publicacion')).toBe('2026-10-07')
      expect(constante(b.sql, 'c_vigencia')).toBe(RESTRICCION_VIGENTE_DESDE)
      expect(sumarDias('2026-10-07', 30)).toBe(RESTRICCION_VIGENTE_DESDE)
    }
  })

  it('el texto embebido es el de su huella, dice el 6 de noviembre y nunca el 5', () => {
    for (const b of BLOQUES) {
      const texto = /c_texto constant text := \$texto\$([\s\S]*?)\$texto\$;/.exec(b.sql)?.[1] ?? ''
      expect(sha256(texto), b.slug).toBe(b.textoSha)
      expect(texto).toContain('# TÉRMINOS DE SUSCRIPCIÓN AL SERVICIO VALIDA · PLAN CDA v1.4')
      expect(texto).toContain('## 11. Restricción y suspensión')
      expect(texto).toContain('11.4. **Transición.** Esta cláusula rige desde el 6 de noviembre de 2026')
      expect(texto).toContain('2.5. **Mora.** El incumplimiento del pago faculta a METRIK para restringir o suspender el Servicio')
      expect(texto).not.toContain('5 de noviembre')
    }
  })
})

describe('el alta no corre fuera de su estado esperado', () => {
  const b = () => CDAS[0]

  it('otro día que el de la publicación, se detiene: la vigencia del texto sería falsa', async () => {
    const ayer = sumarDias(HOY, -1)
    const r = await ensayo(preparar(b(), { ensayo: false, publicacion: ayer }))
    expect(r).toMatch(/Publicar otro día cambia la vigencia/)
  })

  it('sin el PDF subido, se detiene', async () => {
    const r = await ensayo(`delete from storage.objects where name = '${b().pdfPath}'; ${preparar(b(), { ensayo: false })}`)
    expect(r).toMatch(/falta subir el PDF/)
  })

  it('sobre una v1.3 sin aceptar, se detiene: no hay qué modificar por aviso', async () => {
    // La constancia no se borra por las buenas (sus triggers lo impiden): se quita saltándolos, solo
    // dentro de esta transacción que se deshace.
    const r = await ensayo(
      `set local session_replication_role = replica;
       delete from public.aceptaciones_terminos where documento_sha256 = '${b().previaPdf}';
       set local session_replication_role = origin;
       ${preparar(b(), { ensayo: false })}`,
    )
    expect(r).toMatch(/no tiene aceptación registrada en el contrato/)
  })

  it('si la v1.3 registrada no es la esperada (otra huella), se detiene', async () => {
    const otra = b().sql.replace(
      `c_previa_pdf     constant text := '${b().previaPdf}'`,
      `c_previa_pdf     constant text := '${'0'.repeat(64)}'`,
    )
    expect(await ensayo(preparar({ ...b(), sql: otra }, { ensayo: false }))).toMatch(/no está registrada para esta empresa con su huella/)
  })

  it('el ensayo dice ENSAYO OK y no deja nada escrito', async () => {
    const r = await correr(preparar(b(), { ensayo: true }))
    expect(r).toMatch(/ENSAYO OK cda-caqueta: v1\.4 .* por aviso, publicada el .*, rige el .*; v1\.3 vigente hasta el .*\. Nada quedó escrito\./)
    expect(await v14De(b())).toEqual([])
    const previa = await db.query<{ vigente_hasta: string | null }>(
      `select vigente_hasta from public.documentos_contractuales_versiones where id = '${b().previa}'`,
    )
    expect(previa.rows).toEqual([{ vigente_hasta: null }])
  })
})

describe('la publicación de los 4 CDA (y la de QA)', () => {
  beforeAll(async () => {
    for (const b of BLOQUES) {
      const r = await correr(preparar(b, { ensayo: false }))
      expect(r, b.slug).toBe('')
    }
  })

  it('cada CDA queda con la v1.4 por aviso: reemplaza su v1.3, publicada hoy, rige 30 días después', async () => {
    for (const b of BLOQUES) {
      const filas = await v14De(b)
      expect(filas, b.slug).toEqual([
        {
          id: expect.any(String),
          vigente_desde: sumarDias(HOY, 30),
          rige_por_aviso: true,
          reemplaza_version_id: b.previa,
          publicado: HOY,
          titulo: TITULO,
          linea_id: LINEA_VALIDA,
        },
      ])
      const previa = await db.query<{ vigente_hasta: string }>(
        `select vigente_hasta::text from public.documentos_contractuales_versiones where id = '${b.previa}'`,
      )
      expect(previa.rows, b.slug).toEqual([{ vigente_hasta: sumarDias(HOY, 29) }])
    }
  })

  it('una segunda corrida no duplica', async () => {
    const r = await correr(preparar(CDAS[1], { ensayo: false }))
    expect(r).toMatch(/la v1\.4 de esta empresa ya está registrada\. Nada que hacer\./)
    expect(await v14De(CDAS[1])).toHaveLength(1)
  })

  it('mis_documentos_de_servicio le dice al CDA cuál es por aviso, qué reemplaza y cuándo se publicó', async () => {
    const b = CDAS[3]
    await db.exec(`select set_config('prueba.ws', '${b.ws}', false)`)
    try {
      const r = await db.query<{ version: string; rige_por_aviso: boolean; reemplaza_version_id: string | null; publicada: boolean; aceptado: boolean }>(
        `select version, rige_por_aviso, reemplaza_version_id, publicada_at is not null as publicada, aceptado_at is not null as aceptado
           from public.mis_documentos_de_servicio() order by version`,
      )
      expect(r.rows).toEqual([
        { version: 'v1.3', rige_por_aviso: false, reemplaza_version_id: null, publicada: false, aceptado: true },
        { version: 'v1.4', rige_por_aviso: true, reemplaza_version_id: b.previa, publicada: true, aceptado: false },
      ])
    } finally {
      await db.exec(`select set_config('prueba.ws', '', false)`)
    }
  })

  it('la persona designada acepta la v1.4 publicada ANTES de que rija; la base pone la hora y la huella', async () => {
    const b = CDAS[0]
    const [v14] = await v14De(b)
    await db.exec('begin')
    try {
      await db.exec(`${aceptar(b, { documento: v14.id, version: 'v1.4', pdf: b.pdfSha, texto: b.textoSha })};`)
      const r = await db.query<{ respondido: boolean; huella: string }>(
        `select respondido_at is not null as respondido, texto_aceptacion_sha256 as huella
           from public.aceptaciones_terminos where documento_version_id = '${v14.id}'`,
      )
      expect(r.rows).toEqual([{ respondido: true, huella: sha256(declaracion(b, 'v1.4', b.pdfSha)) }])
    } finally {
      await db.exec('rollback')
    }
  })

  it('la operadora no la acepta, ni el soporte de MeTRIK', async () => {
    const b = CDAS[0]
    const [v14] = await v14De(b)
    expect(await ensayo(`${aceptar(b, { documento: v14.id, version: 'v1.4', pdf: b.pdfSha, texto: b.textoSha, usuario: b.operadora })};`)).toMatch(
      /los acepta la persona que la empresa designó/,
    )
    expect(await ensayo(`${aceptar(b, { documento: v14.id, version: 'v1.4', pdf: b.pdfSha, texto: b.textoSha, usuario: MAURICIO })};`)).toMatch(
      /persona que la empresa designó|soporte de MeTRIK/,
    )
  })

  it('una versión de ENTRADA futura sigue sin poder aceptarse (lo de siempre no cambió)', async () => {
    const b = CDAS[2]
    const futura = '00000000-0000-4000-8000-00000000f001'
    const r = await ensayo(`
      insert into public.documentos_contractuales_versiones
        (id, workspace_id, linea_id, slug, alcance, empresa_id, titulo, version, texto_md, texto_sha256, pdf_path, pdf_sha256, vigente_desde)
      values ('${futura}', '${WS_METRIK}', '${LINEA_VALIDA}', 'otro-doc', 'cliente', '${b.empresa}', '${TITULO}', 'v9.0',
              '# futura', '${'1'.repeat(64)}', 'x/futura.pdf', '${'2'.repeat(64)}', date '2099-01-01');
      ${aceptar(b, { documento: futura, version: 'v9.0', pdf: '2'.repeat(64), texto: '1'.repeat(64) })};`)
    expect(r).toMatch(/no está vigente hoy/)
  })

  it('lo del aviso no se reescribe; la fecha de retiro sí se mueve', async () => {
    const [v14] = await v14De(CDAS[0])
    for (const cambio of ['rige_por_aviso = false', `reemplaza_version_id = null`, `publicada_at = now() - interval '40 days'`]) {
      expect(await ensayo(`update public.documentos_contractuales_versiones set ${cambio} where id = '${v14.id}'`), cambio).toMatch(
        /inmutable salvo vigente_hasta/,
      )
    }
    expect(await ensayo(`update public.documentos_contractuales_versiones set vigente_hasta = date '2027-06-30' where id = '${v14.id}'`)).toBe('')
  })
})

describe('la guarda de una versión por aviso, al registrarla', () => {
  const insertar = (o: { vigente: string; publicada?: string; reemplaza?: string; empresa?: string; slug?: string; porAviso?: boolean }) => {
    const b = CDAS[1]
    return `insert into public.documentos_contractuales_versiones
      (workspace_id, linea_id, slug, alcance, empresa_id, titulo, version, texto_md, texto_sha256, pdf_path, pdf_sha256,
       vigente_desde, rige_por_aviso, reemplaza_version_id, publicada_at)
    values ('${WS_METRIK}', '${LINEA_VALIDA}', '${o.slug ?? 'terminos-suscripcion-valida-cda'}', 'cliente', '${o.empresa ?? b.empresa}',
            '${TITULO}', 'v1.9', '# v1.9', '${'3'.repeat(64)}', 'x/v19.pdf', '${'4'.repeat(64)}', date '${o.vigente}',
            ${o.porAviso === false ? 'false' : 'true'}, ${o.reemplaza === undefined ? `'${b.previa}'` : o.reemplaza},
            ${o.publicada ?? 'now()'})`
  }

  it('rige al menos 30 días calendario después de publicada (cláusula 13.1)', async () => {
    expect(await ensayo(insertar({ vigente: sumarDias(HOY, 29) }))).toMatch(/al menos 30 días calendario/)
    expect(await ensayo(insertar({ vigente: sumarDias(HOY, 30) }))).toBe('')
  })

  it('no se publica en el futuro', async () => {
    expect(await ensayo(insertar({ vigente: '2099-01-01', publicada: "now() + interval '1 day'" }))).toMatch(/no se publica en el futuro/)
  })

  it('modifica una versión de su MISMA serie (empresa y slug)', async () => {
    expect(await ensayo(insertar({ vigente: sumarDias(HOY, 30), empresa: CDAS[2].empresa }))).toMatch(/misma serie/)
    expect(await ensayo(insertar({ vigente: sumarDias(HOY, 30), slug: 'otro-doc' }))).toMatch(/misma serie/)
  })

  it('una por aviso sin lo que reemplaza, o una de entrada con datos de aviso, se contradicen', async () => {
    // El BEFORE trigger corre antes que el CHECK (PGlite y Postgres): cualquiera de los dos la rechaza.
    expect(await ensayo(insertar({ vigente: sumarDias(HOY, 30), reemplaza: 'null' }))).toMatch(
      /documentos_versiones_aviso_coherente|la versión que se modifica \(<NULL>\) no existe/,
    )
    expect(await ensayo(insertar({ vigente: sumarDias(HOY, 30), porAviso: false }))).toMatch(/documentos_versiones_aviso_coherente/)
  })
})

describe('la constancia del preaviso: quién vio el aviso y cuándo', () => {
  it('una fila por versión y persona; la segunda vista no la mueve', async () => {
    const b = CDAS[3]
    const [v14] = await v14De(b)
    await db.exec('begin')
    try {
      const fila = `('${v14.id}', '${b.ws}', '${b.operadora}', '190.24.1.10', 'Mozilla/5.0')`
      await db.exec(`insert into public.avisos_modificacion_vistos (documento_version_id, workspace_id, usuario_id, ip, user_agent) values ${fila}`)
      const primera = await db.query<{ visto_at: string }>(`select visto_at::text from public.avisos_modificacion_vistos`)
      await db.exec(
        `insert into public.avisos_modificacion_vistos (documento_version_id, workspace_id, usuario_id, ip, user_agent) values ${fila}
         on conflict (documento_version_id, usuario_id) do nothing`,
      )
      const despues = await db.query<{ visto_at: string }>(`select visto_at::text from public.avisos_modificacion_vistos`)
      expect(despues.rows).toEqual(primera.rows)
      expect(despues.rows).toHaveLength(1)
    } finally {
      await db.exec('rollback')
    }
  })

  it('no se modifica ni se borra', async () => {
    const b = CDAS[3]
    const [v14] = await v14De(b)
    const fila = `insert into public.avisos_modificacion_vistos (documento_version_id, workspace_id, usuario_id) values ('${v14.id}', '${b.ws}', '${b.designada}');`
    expect(await ensayo(`${fila} update public.avisos_modificacion_vistos set visto_at = now() - interval '1 day';`)).toMatch(/es una constancia/)
    expect(await ensayo(`${fila} delete from public.avisos_modificacion_vistos;`)).toMatch(/es una constancia/)
  })

  it('es server-only: ni anon ni authenticated la leen', async () => {
    const r = await db.query<{ anon: boolean; auth: boolean; rls: boolean }>(
      `select has_table_privilege('anon', 'public.avisos_modificacion_vistos', 'select') as anon,
              has_table_privilege('authenticated', 'public.avisos_modificacion_vistos', 'select') as auth,
              (select relrowsecurity from pg_class where oid = 'public.avisos_modificacion_vistos'::regclass) as rls`,
    )
    expect(r.rows).toEqual([{ anon: false, auth: false, rls: true }])
  })
})
