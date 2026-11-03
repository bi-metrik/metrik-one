import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
import { PGlite } from '@electric-sql/pglite'
import { todayBogotaISO } from '@/lib/dates/bogota'
import { sumarDias } from './plazos'
import { datosDelTextoV15 } from './terminos-v1-5'
import { ESQUEMA_BASE, LINEA_VALIDA, MAURICIO, WS_METRIK } from './__fixtures__/terminos-sql-esquema'

/**
 * La v1.5 de los Términos de los CDA POR AVISO, EJECUTADA contra las migraciones reales: la de 20261007150000
 * (modificación por aviso), la nueva 20261029190000 (publicación programada) y el alta de datos
 * `sql/valida-cda/2026-11-01_terminos-v1.5-por-aviso.sql`, que aplica una persona sobre producción.
 *
 * Lo que se fija:
 *   - el archivo trae los 4 CDA (más el de QA), en ensayo, con publicación el 1-nov y vigencia el 1-dic, y
 *     cada texto es el de su huella y dice lo que la pantalla lee (día de renovación, 12.1, 16.4);
 *   - el alta reemplaza la v1.4 por aviso de cada CDA (aceptada o no: la v1.3 aceptada la cubre), deja la
 *     v1.4 vigente hasta el día anterior a la vigencia y no corre otro día, ni sin el PDF, ni dos veces;
 *   - registrada ANTES del día de la publicación, `publicada_at` queda a las 00:00 (Bogotá) de ese día, solo
 *     con la migración de la publicación programada; sin ella, el bloque lo dice y no escribe;
 *   - la base no deja aceptar la v1.5 antes de su `publicada_at`, ni programar un aviso a más de 7 días;
 *   - la migración parcha la definición VIVA de la guarda (conserva lo que otra migración le agregó) y es
 *     idempotente.
 */

const RAIZ = process.cwd()
const leer = (ruta: string) => readFileSync(join(RAIZ, ruta), 'utf8')
const migracion = (archivo: string) => leer(join('supabase/migrations', archivo))
const ALTA = leer('sql/valida-cda/2026-11-01_terminos-v1.5-por-aviso.sql')
const PROGRAMADA = migracion('20261029190000_terminos_aviso_publicacion_programada.sql')

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
  anteriorPdf: string
  textoSha: string
  pdfSha: string
  pdfPath: string
  texto: string
  designada: string
  operadora: string
  contrato: string
  anterior: string
}

function constante(sql: string, nombre: string): string {
  const m = new RegExp(`${nombre}\\s+constant (?:uuid|text|date|time) := (?:date |time )?'([^']*)'`).exec(sql)
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
    anteriorPdf: constante(sql, 'c_anterior_pdf'),
    textoSha: constante(sql, 'c_texto_sha256'),
    pdfSha: constante(sql, 'c_pdf_sha256'),
    pdfPath: constante(sql, 'c_pdf_path'),
    texto: /c_texto constant text := \$texto\$([\s\S]*?)\$texto\$;/.exec(sql)?.[1] ?? '',
    designada: `00000000-0000-4000-8000-0000000e00${n}`,
    operadora: `00000000-0000-4000-8000-0000000d00${n}`,
    contrato: `00000000-0000-4000-8000-0000000c00${n}`,
    anterior: `00000000-0000-4000-8000-0000000a00${n}`,
  }
})
const CDAS = BLOQUES.slice(0, 4)
const QA = BLOQUES[4]

/** El día de hoy en Bogotá: la prueba corre cualquier día. */
const HOY = todayBogotaISO()
const MANANA = sumarDias(HOY, 1)

/** El bloque con otro día de publicación y, si se pide, fuera de ensayo. */
function preparar(b: Bloque, o: { ensayo: boolean; publicacion: string }): string {
  let sql = b.sql
  const reemplazar = (de: string, a: string) => {
    expect(sql.split(de).length - 1).toBe(1)
    sql = sql.replace(de, a)
  }
  reemplazar("c_publicacion       constant date := date '2026-11-01';", `c_publicacion       constant date := date '${o.publicacion}';`)
  reemplazar("c_vigencia          constant date := date '2026-12-01';", `c_vigencia          constant date := date '${sumarDias(o.publicacion, 30)}';`)
  if (!o.ensayo) reemplazar('c_ensayo constant boolean := true;', 'c_ensayo constant boolean := false;')
  return sql
}

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

/**
 * Lo que hay en producción el 2026-10-29: la v1.3 aceptada (vigente hasta el 5-nov) y la v1.4 por aviso
 * publicada el 7-oct (vigente desde el 6-nov). El Carmen y Puertotest aceptaron también la v1.4. CDA
 * Pruebas: solo su v1.1 aceptada.
 */
function sembrar(b: Bloque, aceptoV14: boolean): string {
  const base = `
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
    insert into storage.objects (bucket_id, name) values ('aceptaciones-documentos', '${b.pdfPath}');
  `
  if (b.previaVersion === 'v1.1') {
    const t = sha256(`# Términos v1.1 ${b.slug}`)
    return `${base}
      insert into public.documentos_contractuales_versiones
        (id, workspace_id, linea_id, slug, alcance, empresa_id, titulo, version, texto_md, texto_sha256, pdf_path, pdf_sha256, vigente_desde)
      values ('${b.previa}', '${WS_METRIK}', '${LINEA_VALIDA}', 'terminos-suscripcion-valida-cda', 'cliente', '${b.empresa}', '${TITULO}',
              'v1.1', '# Términos v1.1 ${b.slug}', '${t}', '${b.slug}/v11.pdf', '${b.previaPdf}', date '2026-09-23');
      ${aceptar(b, { documento: b.previa, version: 'v1.1', pdf: b.previaPdf, texto: t })};`
  }
  const t13 = sha256(`# Términos v1.3 ${b.slug}`)
  const t14 = sha256(`# Términos v1.4 ${b.slug}`)
  return `${base}
    insert into public.documentos_contractuales_versiones
      (id, workspace_id, linea_id, slug, alcance, empresa_id, titulo, version, texto_md, texto_sha256, pdf_path, pdf_sha256, vigente_desde, vigente_hasta)
    values ('${b.anterior}', '${WS_METRIK}', '${LINEA_VALIDA}', 'terminos-suscripcion-valida-cda', 'cliente', '${b.empresa}', '${TITULO}',
            'v1.3', '# Términos v1.3 ${b.slug}', '${t13}', '${b.slug}/v13.pdf', '${b.anteriorPdf}', date '2026-09-24', date '2026-11-05');
    ${aceptar(b, { documento: b.anterior, version: 'v1.3', pdf: b.anteriorPdf, texto: t13 })};
    insert into public.documentos_contractuales_versiones
      (id, workspace_id, linea_id, slug, alcance, empresa_id, titulo, version, texto_md, texto_sha256, pdf_path, pdf_sha256,
       vigente_desde, rige_por_aviso, reemplaza_version_id, publicada_at)
    values ('${b.previa}', '${WS_METRIK}', '${LINEA_VALIDA}', 'terminos-suscripcion-valida-cda', 'cliente', '${b.empresa}', '${TITULO}',
            'v1.4', '# Términos v1.4 ${b.slug}', '${t14}', '${b.slug}/v14.pdf', '${b.previaPdf}', date '2026-11-06', true,
            '${b.anterior}', timestamptz '2026-10-07 12:59:50-05');
    ${aceptoV14 ? `${aceptar(b, { documento: b.previa, version: 'v1.4', pdf: b.previaPdf, texto: t14 })};` : ''}`
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

async function v15De(b: Bloque) {
  const r = await db.query<{
    id: string
    vigente_desde: string
    rige_por_aviso: boolean
    reemplaza_version_id: string
    publicada: string
    pdf_path: string
  }>(
    `select id, vigente_desde::text, rige_por_aviso, reemplaza_version_id,
            to_char(publicada_at at time zone 'America/Bogota', 'YYYY-MM-DD HH24:MI') as publicada, pdf_path
       from public.documentos_contractuales_versiones
      where empresa_id = '${b.empresa}' and version = 'v1.5'`,
  )
  return r.rows
}

async function vigenteHasta(id: string): Promise<string | null> {
  const r = await db.query<{ h: string | null }>(`select vigente_hasta::text as h from public.documentos_contractuales_versiones where id = '${id}'`)
  return r.rows[0]?.h ?? null
}

beforeAll(async () => {
  db = new PGlite()
  await db.exec(ESQUEMA_BASE)
  for (const m of [
    '20260901000003_wa_envios.sql',
    '20260915040000_aceptaciones_terminos.sql',
    '20260915060000_purga_registros_bot.sql',
    '20260916180000_modulo_valida_api.sql',
    '20260916213000_mis_documentos_de_servicio_por_negocio.sql',
    '20260917014500_aceptacion_terminos_en_modulo.sql',
    '20260923220000_terminos_cda_designado_y_enlace_pago.sql',
    '20260929030000_documentos_alcance_plantilla.sql',
    '20261007150000_terminos_modificacion_por_aviso.sql',
  ]) {
    await db.exec(migracion(m))
  }
  const aceptaronV14 = new Set(['cda-elcarmen', 'cda-puertotest'])
  for (const b of BLOQUES) await db.exec(sembrar(b, aceptaronV14.has(b.slug)))
}, 60_000)

afterAll(async () => {
  await db?.close()
})

describe('el archivo de alta', () => {
  it('trae un bloque por cada uno de los 4 CDA, y uno de QA para CDA Pruebas', () => {
    expect(CDAS.map((b) => b.slug)).toEqual(['cda-caqueta', 'cda-elcarmen', 'cda-puertotest', 'maxitec'])
    expect(QA.slug).toBe('cda-pruebas')
    expect(new Set(BLOQUES.map((b) => b.pdfSha)).size).toBe(5)
    for (const b of BLOQUES) expect(b.pdfPath).toBe(`${b.slug}/terminos-suscripcion-valida-cda-v1.5.pdf`)
    for (const b of CDAS) expect(b.previaVersion).toBe('v1.4')
    expect(QA.previaVersion).toBe('v1.1')
  })

  it('cada bloque nace en ensayo, publica el 1-nov a las 00:00 y rige el 1-dic', () => {
    for (const b of BLOQUES) {
      expect(b.sql).toContain('c_ensayo constant boolean := true;')
      expect(constante(b.sql, 'c_publicacion')).toBe('2026-11-01')
      expect(constante(b.sql, 'c_hora_publicacion')).toBe('00:00')
      expect(constante(b.sql, 'c_vigencia')).toBe('2026-12-01')
      expect(sumarDias('2026-11-01', 30)).toBe('2026-12-01')
    }
  })

  it('el texto embebido es el de su huella y dice lo que la pantalla lee de él', () => {
    const esperado: Record<string, { fin: string; exige: string }> = {
      'cda-caqueta': { fin: '2027-01-15', exige: '2027-01-16' },
      'cda-elcarmen': { fin: '2027-01-15', exige: '2027-01-16' },
      'cda-puertotest': { fin: '2027-01-15', exige: '2027-01-16' },
      maxitec: { fin: '2026-12-21', exige: '2026-12-22' },
      'cda-pruebas': { fin: '2027-01-23', exige: '2027-01-24' },
    }
    for (const b of BLOQUES) {
      expect(sha256(b.texto), b.slug).toBe(b.textoSha)
      expect(b.texto.startsWith('# TÉRMINOS DE SUSCRIPCIÓN AL SERVICIO VALIDA · PLAN CDA v1.5\n\n')).toBe(true)
      expect(b.texto).toContain('11.7. **Transición.**')
      expect(b.texto).toContain('16.4. **Paso desde la versión 1.4.**')
      expect(b.texto).not.toMatch(/\{\{|\}\}|ANEXO DE TRABAJO|BORRADOR/)
      const d = datosDelTextoV15(b.texto)
      expect(d.diaRenovacion, b.slug).toBe(23)
      expect(d.fin12_1, b.slug).toBe(esperado[b.slug].fin)
      expect(d.exigeDesde, b.slug).toBe(esperado[b.slug].exige)
      expect(d.razonSocial, b.slug).toBeTruthy()
    }
  })
})

describe('el alta no corre fuera de su estado esperado', () => {
  const b = () => CDAS[0]

  it('otro día (ayer) no corre: la vigencia del texto sería falsa', async () => {
    expect(await ensayo(preparar(b(), { ensayo: false, publicacion: sumarDias(HOY, -1) }))).toMatch(/Publicar otro día cambia la vigencia/)
  })

  it('antes del día de la publicación, sin la migración de la publicación programada, lo dice y no escribe', async () => {
    expect(await ensayo(preparar(b(), { ensayo: false, publicacion: MANANA }))).toMatch(
      /falta la migración 20261029190000_terminos_aviso_publicacion_programada\.sql/,
    )
    expect(await v15De(b())).toEqual([])
  })

  it('sin el PDF subido, se detiene', async () => {
    const r = await ensayo(`delete from storage.objects where name = '${b().pdfPath}'; ${preparar(b(), { ensayo: false, publicacion: HOY })}`)
    expect(r).toMatch(/falta subir el PDF/)
  })

  it('sin nada aceptado detrás (ni la v1.4 ni la v1.3), se detiene: no hay qué modificar por aviso', async () => {
    const r = await ensayo(
      `set local session_replication_role = replica;
       delete from public.aceptaciones_terminos where negocio_id = '${b().negocio}';
       set local session_replication_role = origin;
       ${preparar(b(), { ensayo: false, publicacion: HOY })}`,
    )
    expect(r).toMatch(/tienen aceptación registrada en el contrato: la v1\.5 no se publica por aviso/)
  })

  it('si la v1.4 registrada no es la esperada (otra huella), se detiene', async () => {
    const otra = b().sql.replace(`c_previa_pdf     constant text := '${b().previaPdf}'`, `c_previa_pdf     constant text := '${'0'.repeat(64)}'`)
    expect(await ensayo(preparar({ ...b(), sql: otra }, { ensayo: false, publicacion: HOY }))).toMatch(
      /no está registrada para esta empresa con su huella/,
    )
  })

  it('el ensayo dice ENSAYO OK y no deja nada escrito', async () => {
    const r = await correr(preparar(b(), { ensayo: true, publicacion: HOY }))
    expect(r).toMatch(/ENSAYO OK cda-caqueta: v1\.5 .* por aviso, publicada .*, rige el .*; v1\.4 vigente hasta el .*\. Nada quedó escrito\./)
    expect(await v15De(b())).toEqual([])
    expect(await vigenteHasta(b().previa)).toBeNull()
  })
})

describe('la migración de la publicación programada', () => {
  beforeAll(async () => {
    // Como en producción, la guarda ya trae parches de otra migración (20261016100100 le sumó
    // `suscripcion_id`): aquí se simula con una línea extra en la definición viva.
    const def = await db.query<{ d: string }>(`select pg_get_functiondef('public.documentos_versiones_por_aviso()'::regprocedure) as d`)
    const conMarca = def.rows[0].d.replace('  if not new.rige_por_aviso then', '  -- parche-vivo-de-otra-migracion\n  if not new.rige_por_aviso then')
    expect(conMarca).not.toBe(def.rows[0].d)
    await db.exec(conMarca)
    expect(await correr(PROGRAMADA)).toBe('')
  })

  it('reemplaza solo la condición de la publicación: lo demás de la definición viva sigue', async () => {
    const r = await db.query<{ d: string }>(`select prosrc as d from pg_proc where proname = 'documentos_versiones_por_aviso'`)
    expect(r.rows[0].d).toContain('publicacion_programada')
    expect(r.rows[0].d).toContain('parche-vivo-de-otra-migracion')
    expect(r.rows[0].d).toContain("interval '7 days'")
    expect(r.rows[0].d).not.toContain('se registra al publicarlo')
  })

  it('es idempotente', async () => {
    expect(await correr(PROGRAMADA)).toBe('')
  })

  it('nadie la ejecuta directamente', async () => {
    const r = await db.query<{ anon: boolean; auth: boolean }>(
      `select has_function_privilege('anon', 'public.documentos_versiones_por_aviso()', 'execute') as anon,
              has_function_privilege('authenticated', 'public.documentos_versiones_por_aviso()', 'execute') as auth`,
    )
    expect(r.rows).toEqual([{ anon: false, auth: false }])
  })

  it('un aviso se programa a lo sumo 7 días antes; la vigencia sigue contando desde el día publicado', async () => {
    const b = CDAS[1]
    const insertar = (publicada: string, vigente: string) => `insert into public.documentos_contractuales_versiones
      (workspace_id, linea_id, slug, alcance, empresa_id, titulo, version, texto_md, texto_sha256, pdf_path, pdf_sha256,
       vigente_desde, rige_por_aviso, reemplaza_version_id, publicada_at)
    values ('${WS_METRIK}', '${LINEA_VALIDA}', 'terminos-suscripcion-valida-cda', 'cliente', '${b.empresa}', '${TITULO}', 'v1.9',
            '# v1.9', '${'3'.repeat(64)}', 'x/v19.pdf', '${'4'.repeat(64)}', date '${vigente}', true, '${b.previa}', ${publicada})`
    expect(await ensayo(insertar("now() + interval '8 days'", '2099-01-01'))).toMatch(/a lo sumo 7 días antes/)
    expect(await ensayo(insertar("now() + interval '6 days'", '2099-01-01'))).toBe('')
    // Programado para dentro de 6 días, no puede regir a los 30 días de HOY: cuentan desde la publicación.
    expect(await ensayo(insertar("now() + interval '6 days'", sumarDias(HOY, 31)))).toMatch(/al menos 30 días calendario/)
  })
})

describe('la publicación programada de los 4 CDA (y la de QA)', () => {
  beforeAll(async () => {
    for (const b of BLOQUES) {
      expect(await correr(preparar(b, { ensayo: false, publicacion: MANANA })), b.slug).toBe('')
    }
  })

  it('cada CDA queda con la v1.5 por aviso: reemplaza su versión vigente, publicada a las 00:00 del día, rige 30 días después', async () => {
    for (const b of BLOQUES) {
      expect(await v15De(b), b.slug).toEqual([
        {
          id: expect.any(String),
          vigente_desde: sumarDias(MANANA, 30),
          rige_por_aviso: true,
          reemplaza_version_id: b.previa,
          publicada: `${MANANA} 00:00`,
          pdf_path: `${b.slug}/terminos-suscripcion-valida-cda-v1.5.pdf`,
        },
      ])
      expect(await vigenteHasta(b.previa), b.slug).toBe(sumarDias(MANANA, 29))
    }
  })

  it('la v1.3 (que la v1.4 reemplazó) no se toca', async () => {
    expect(await vigenteHasta(CDAS[0].anterior)).toBe('2026-11-05')
  })

  it('una segunda corrida no duplica', async () => {
    expect(await correr(preparar(CDAS[1], { ensayo: false, publicacion: MANANA }))).toMatch(
      /la v1\.5 de esta empresa ya está registrada\. Nada que hacer\./,
    )
    expect(await v15De(CDAS[1])).toHaveLength(1)
  })

  it('antes de su publicación, la v1.5 NO se puede aceptar (la base lo niega)', async () => {
    const b = CDAS[0]
    const [v15] = await v15De(b)
    expect(await ensayo(`${aceptar(b, { documento: v15.id, version: 'v1.5', pdf: b.pdfSha, texto: b.textoSha })};`)).toMatch(
      /no está vigente hoy/,
    )
  })

  it('publicada (simulando el reloj), la persona designada la acepta; la operadora no', async () => {
    const b = CDAS[3]
    const [v15] = await v15De(b)
    await db.exec('begin')
    try {
      // La inmutabilidad no deja mover publicada_at: se salta solo dentro de esta transacción que se deshace.
      await db.exec(`set local session_replication_role = replica;
        update public.documentos_contractuales_versiones set publicada_at = now() - interval '1 minute' where id = '${v15.id}';
        set local session_replication_role = origin;`)
      await db.exec('savepoint operadora')
      const op = await db
        .exec(`${aceptar(b, { documento: v15.id, version: 'v1.5', pdf: b.pdfSha, texto: b.textoSha, usuario: b.operadora })};`)
        .then(() => '')
        .catch((e: Error) => e.message)
      expect(op).toMatch(/los acepta la persona que la empresa designó/)
      await db.exec('rollback to savepoint operadora')
      await db.exec(`${aceptar(b, { documento: v15.id, version: 'v1.5', pdf: b.pdfSha, texto: b.textoSha })};`)
      const r = await db.query<{ huella: string }>(
        `select texto_aceptacion_sha256 as huella from public.aceptaciones_terminos where documento_version_id = '${v15.id}'`,
      )
      expect(r.rows).toEqual([{ huella: sha256(declaracion(b, 'v1.5', b.pdfSha)) }])
    } finally {
      await db.exec('rollback')
    }
  })

  it('mis_documentos_de_servicio le dice al CDA la v1.5, qué reemplaza y cuándo se publica', async () => {
    const b = CDAS[3]
    await db.exec(`select set_config('prueba.ws', '${b.ws}', false)`)
    try {
      const r = await db.query<{ version: string; rige_por_aviso: boolean; reemplaza_version_id: string | null; futura: boolean }>(
        `select version, rige_por_aviso, reemplaza_version_id, publicada_at > now() as futura
           from public.mis_documentos_de_servicio() order by version`,
      )
      expect(r.rows).toEqual([
        { version: 'v1.3', rige_por_aviso: false, reemplaza_version_id: null, futura: null },
        { version: 'v1.4', rige_por_aviso: true, reemplaza_version_id: b.anterior, futura: false },
        { version: 'v1.5', rige_por_aviso: true, reemplaza_version_id: b.previa, futura: true },
      ])
    } finally {
      await db.exec(`select set_config('prueba.ws', '', false)`)
    }
  })
})

describe('la publicación el mismo día (sin programar)', () => {
  it('publicada_at es el momento de correrla, y no exige la migración', async () => {
    // Un CDA nuevo, sembrado como los demás, con la guarda VIEJA (sin la migración de la publicación programada).
    const db2 = new PGlite()
    const prev = db
    db = db2
    try {
      await db.exec(ESQUEMA_BASE)
      for (const m of [
        '20260901000003_wa_envios.sql',
        '20260915040000_aceptaciones_terminos.sql',
        '20260915060000_purga_registros_bot.sql',
        '20260916180000_modulo_valida_api.sql',
        '20260916213000_mis_documentos_de_servicio_por_negocio.sql',
        '20260917014500_aceptacion_terminos_en_modulo.sql',
        '20260923220000_terminos_cda_designado_y_enlace_pago.sql',
        '20260929030000_documentos_alcance_plantilla.sql',
        '20261007150000_terminos_modificacion_por_aviso.sql',
      ]) {
        await db.exec(migracion(m))
      }
      const b = CDAS[2]
      await db.exec(sembrar(b, true))
      expect(await correr(preparar(b, { ensayo: false, publicacion: HOY }))).toBe('')
      const r = await db.query<{ hace: number; dia: string }>(
        `select extract(epoch from now() - publicada_at)::int as hace, ((publicada_at at time zone 'America/Bogota')::date)::text as dia
           from public.documentos_contractuales_versiones where empresa_id = '${b.empresa}' and version = 'v1.5'`,
      )
      expect(r.rows).toHaveLength(1)
      expect(r.rows[0].dia).toBe(HOY)
      expect(r.rows[0].hace).toBeLessThan(60)
    } finally {
      db = prev
      await db2.close()
    }
  }, 60_000)
})

void MAURICIO
