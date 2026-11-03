import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { PGlite } from '@electric-sql/pglite'
import { huellaPublicable } from '../reglamento'
import type { Ficha } from '../tipos'
import { BOT_BANDEJA } from './dominio'
import { FUNCIONES_ROL, WS_TRAPPVEL, fichasBaseBandeja, fichasDelRol } from './roles-trappvel'
import type { ClaveRolTrappvel } from './roles-trappvel'
import { archivoBanco, cambiosDeFichas, carpetaDe, leerAsignaciones, leerBancos, sqlEnsayo, sqlPendiente, sqlReversa, sqlReversaCambio } from './roles-trappvel-sql'
import type { Asignaciones } from './roles-trappvel-sql'

/**
 * El SQL de publicación de los roles de Trappvel (2026-10-29), con asignaciones INVENTADAS (las de verdad viven en un JSON
 * fuera del repo): corre en Postgres en memoria (PGlite) con las migraciones REALES (wa_conversacion, bot_reglamento,
 * asistentes_roles). El ensayo revierte todo, la aplicación deja los roles resolviendo a cada persona, un banco que no
 * pasa no publica nada, la base distinta frena la publicación y la reversa vuelve al camino de hoy. Nada se conecta a
 * producción.
 */

const raiz = process.cwd()
const leerMigracion = (a: string) => readFileSync(join(raiz, 'supabase/migrations', a), 'utf8')
const id = (sufijo: string) => `00000000-0000-4000-8000-${sufijo.padStart(12, '0')}`
const STAFF_PRUEBA = id('f001')
const STAFF_OTRO = id('f002')
const TELEFONOS_DE_HOY = [570000000011, 570000000012, 570000000013]

/** Asignaciones inventadas, con la misma forma que el JSON de la carpeta del proyecto. */
const CRUDO = {
  asignaciones: [
    { quien: 'Dueño (staff)', rol: 'mano_derecha', staff: id('a1') },
    { quien: 'Asesora uno (staff)', rol: 'asesor_viajes', staff: id('a2') },
    { quien: 'Asesora uno (colaboradora)', rol: 'asesor_viajes', colaborador: id('c1') },
    { quien: 'Asesora dos (colaboradora)', rol: 'asesor_viajes', colaborador: id('c2') },
    { quien: 'Asesora dos (staff)', rol: 'asesor_viajes', staff: id('a3') },
    { quien: 'Prueba MeTRIK (colaborador)', rol: 'mano_derecha', colaborador: id('c9') },
  ],
  telefonos_agente: ['570000000021', '570000000022'],
  telefono_prueba: '0000000099',
  staff_sin_telefono: [{ quien: 'Asesora dos', staff: id('a3'), telefono: '570000000022' }],
}
const ASIG: Asignaciones = leerAsignaciones(CRUDO)

const bancoDe = async (rol: ClaveRolTrappvel, base: Ficha[] = fichasBaseBandeja(), pasa = true) =>
  ({ pasa, k: 3, fecha: '2026-10-29T12:00:00Z', huella_fichas: await huellaPublicable(fichasDelRol(rol, base)) })
const bancosDePrueba = async (pasa = true) => ({ mano_derecha: await bancoDe('mano_derecha', undefined, pasa), asesor_viajes: await bancoDe('asesor_viajes', undefined, pasa) })
const entrada = async (pasa = true) => ({ base: fichasBaseBandeja(), bancos: await bancosDePrueba(pasa), asignaciones: ASIG })

let db: PGlite

async function base(fichasBandeja: Ficha[] = fichasBaseBandeja()) {
  db = new PGlite()
  const staff = ASIG.asignaciones.filter((a) => a.staff).map((a) => `('${a.staff}', '${WS_TRAPPVEL}', null, null)`)
  const colabs = ASIG.asignaciones.filter((a) => a.colaborador).map((a) => `('${a.colaborador}', '${WS_TRAPPVEL}')`)
  await db.exec(`
    set time zone 'UTC';
    create role anon nologin; create role authenticated nologin; create role service_role nologin;
    grant usage on schema public to anon, authenticated, service_role;
    create table public.workspaces (id uuid primary key, slug text, config_extra jsonb);
    insert into public.workspaces values ('${WS_TRAPPVEL}', 'trappvel',
      '{"bot_conversacional": {"agente": true, "agente_telefonos": ${JSON.stringify(TELEFONOS_DE_HOY)}}}');
    create table public.staff (id uuid primary key, workspace_id uuid not null references public.workspaces(id), profile_id uuid unique, phone_whatsapp text);
    insert into public.staff values ${staff.join(', ')},
      ('${STAFF_PRUEBA}', '${WS_TRAPPVEL}', null, '+57 000 000 0099'), ('${STAFF_OTRO}', '${WS_TRAPPVEL}', null, '0000000055');
    create table public.wa_collaborators (id uuid primary key, workspace_id uuid not null references public.workspaces(id));
    insert into public.wa_collaborators values ${[...new Set(colabs)].join(', ')};
  `)
  await db.exec(leerMigracion('20261006213100_wa_conversacion.sql'))
  await db.exec(leerMigracion('20261006213200_bot_reglamento_y_uso.sql'))
  await db.exec(leerMigracion('20261026183000_asistentes_roles.sql'))
  // La bandeja publicada de hoy.
  for (const f of fichasBandeja) {
    await db.query(
      `insert into public.bot_parametros (workspace_id, bot, clave, tipo, carga, cuando, hacer, herramientas, prioridad, fuente, valores)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
      [WS_TRAPPVEL, BOT_BANDEJA, f.clave, f.tipo, f.carga, f.cuando ?? null, f.hacer, f.herramientas ?? null, f.prioridad ?? null, f.fuente || null, f.valores ? JSON.stringify(f.valores) : null],
    )
  }
  await db.query(`select public.bot_publicar_reglamento($1, $2, 'prueba')`, [WS_TRAPPVEL, BOT_BANDEJA])
}
afterEach(async () => { if (db && !db.closed) await db.close() })

const resolver = async (p: { staff?: string; colaborador?: string }) =>
  (await db.query<{ r: { usa_roles: boolean; rol: { clave: string; activo: boolean; funciones: Array<{ funcion: string }> } | null } }>(
    `select public.asistente_resolver_rol($1, 'wa_one', $2, $3, 'operator', null) as r`, [WS_TRAPPVEL, p.staff ?? null, p.colaborador ?? null],
  )).rows[0].r
const contar = async (sql: string) => (await db.query<{ n: number }>(sql)).rows[0].n
const telefonos = async () => (await db.query<{ t: unknown[] }>(`select config_extra->'bot_conversacional'->'agente_telefonos' as t from public.workspaces`)).rows[0].t
const DUENO = { staff: ASIG.asignaciones[0].staff }

describe('el JSON de asignaciones (fuera del repo)', () => {
  it('lo válido pasa tal cual', () => {
    expect(ASIG.asignaciones).toHaveLength(6)
    expect(ASIG.telefonos_agente).toEqual(['570000000021', '570000000022'])
    expect(ASIG.telefono_prueba).toBe('0000000099')
  })

  it('frena lo que no cuadra: sin lista, rol raro, staff y colaborador a la vez, id que no es uuid, teléfono con letras', () => {
    expect(() => leerAsignaciones({})).toThrow('falta la lista')
    expect(() => leerAsignaciones({ asignaciones: [{ quien: 'x', rol: 'jefe', staff: id('1') }] })).toThrow('rol «jefe»')
    expect(() => leerAsignaciones({ asignaciones: [{ quien: 'x', rol: 'mano_derecha', staff: id('1'), colaborador: id('2') }] })).toThrow('uno solo')
    expect(() => leerAsignaciones({ asignaciones: [{ quien: 'x', rol: 'mano_derecha' }] })).toThrow('uno solo')
    expect(() => leerAsignaciones({ asignaciones: [{ quien: 'x', rol: 'mano_derecha', staff: 'st-1' }] })).toThrow('no es un uuid')
    expect(() => leerAsignaciones({ asignaciones: [{ quien: '', rol: 'mano_derecha', staff: id('1') }] })).toThrow('falta `quien`')
    expect(() => leerAsignaciones({ ...CRUDO, telefonos_agente: ['57 300 abc'] })).toThrow('no son solo dígitos')
  })

  it('el nombre del JSON solo va en un comentario de una línea (un salto de línea no rompe el SQL)', async () => {
    const a = leerAsignaciones({ asignaciones: [{ quien: "O'Neil\nsegunda línea", rol: 'mano_derecha', staff: id('a1') }], telefonos_agente: [] })
    const sql = await sqlPendiente({ ...(await entrada()), asignaciones: a })
    expect(sql).toContain("-- O'Neil segunda línea")
  })

  it('sin teléfonos ni teléfono de prueba, el SQL no trae esos pasos ni la nota', async () => {
    const a = leerAsignaciones({ asignaciones: CRUDO.asignaciones })
    const sql = await sqlPendiente({ ...(await entrada()), asignaciones: a })
    expect(sql).not.toContain('agente_telefonos}')
    expect(sql).not.toContain('teléfono de prueba')
    expect(sql).not.toContain('Nota (no se aplica aquí)')
    expect(sqlReversa(a)).not.toContain('agente_telefonos')
  })

  it('los bancos y los SQL van en la carpeta del JSON', async () => {
    expect(carpetaDe('/proyectos/x/roles/asignaciones.json')).toBe('/proyectos/x/roles')
    expect(carpetaDe('asignaciones.json')).toBe('.')
    const leidas: string[] = []
    await leerBancos('/carpeta', async (r) => { leidas.push(r); return '{}' })
    expect(leidas).toEqual([`/carpeta/${archivoBanco('mano_derecha')}`, `/carpeta/${archivoBanco('asesor_viajes')}`])
    const conPrefijo: string[] = []
    await leerBancos('/carpeta', async (r) => { conPrefijo.push(r); return '{}' }, '2026-10-30_x-')
    expect(conPrefijo).toEqual(['/carpeta/2026-10-30_x-banco-mano_derecha.json', '/carpeta/2026-10-30_x-banco-asesor_viajes.json'])
  })
})

describe('el SQL en Postgres con las migraciones reales', { timeout: 60_000 }, () => {
  beforeEach(async () => { await base() }, 60_000)

  it('el ensayo corre todo y no deja nada', async () => {
    await expect(db.exec(await sqlEnsayo(await entrada()))).rejects.toThrow('dry-run ok')
    expect(await contar('select count(*)::int as n from public.asistente_roles')).toBe(0)
    expect(await contar('select count(*)::int as n from public.asistente_funciones_empresa')).toBe(0)
    expect((await resolver(DUENO)).usa_roles).toBe(false)
  })

  it('aplicado: cada persona resuelve a su rol, con sus funciones; quien no está asignado, sin rol', async () => {
    await db.exec(await sqlPendiente(await entrada()))
    for (const a of ASIG.asignaciones) {
      const r = await resolver(a.staff ? { staff: a.staff } : { colaborador: a.colaborador })
      expect([a.quien, r.rol?.clave, r.rol?.activo]).toEqual([a.quien, a.rol, true])
      expect(r.rol!.funciones.map((f) => f.funcion).sort()).toEqual([...FUNCIONES_ROL[a.rol]].sort())
    }
    // El staff con el teléfono de prueba también va a la mano derecha; otro staff sin asignación, sin rol.
    expect((await resolver({ staff: STAFF_PRUEBA })).rol?.clave).toBe('mano_derecha')
    expect(await resolver({ staff: STAFF_OTRO })).toEqual({ usa_roles: true, rol: null })
    // Los dos teléfonos nuevos, sin repetir y sin tocar los de antes.
    expect(await telefonos()).toEqual([...TELEFONOS_DE_HOY, '570000000021', '570000000022'])
    // La versión publicada de cada rol trae sus fichas (las del arnés).
    const fichas = (await db.query<{ n: number }>(`select jsonb_array_length(fichas) as n from public.bot_reglamentos where bot = 'rol:asesor_viajes'`)).rows[0].n
    expect(fichas).toBe(fichasDelRol('asesor_viajes').length)
  })

  it('aplicar dos veces no duplica teléfonos ni falla por los roles (las asignaciones vigentes sí chocan: es a propósito)', async () => {
    const sql = await sqlPendiente(await entrada())
    await db.exec(sql)
    await expect(db.exec(sql)).rejects.toThrow()
  })

  it('con un banco que no pasa (pasa: false), la publicación se rechaza y no queda nada', async () => {
    await expect(db.exec(await sqlPendiente(await entrada(false)))).rejects.toThrow('no se publica sin un banco del arnes que pase')
    expect(await contar('select count(*)::int as n from public.asistente_roles')).toBe(0)
    expect(await contar('select count(*)::int as n from public.asistente_funciones_empresa')).toBe(0)
    expect((await resolver(DUENO)).usa_roles).toBe(false)
    expect(await telefonos()).toEqual(TELEFONOS_DE_HOY)
  })

  it('la reversa vuelve al camino de hoy', async () => {
    await db.exec(await sqlPendiente(await entrada()))
    await db.exec(sqlReversa(ASIG))
    expect(await resolver(DUENO)).toEqual({ usa_roles: false, rol: null })
    expect(await telefonos()).toEqual(TELEFONOS_DE_HOY)
  })
})

describe('si la bandeja publicada no es la base del arnés, no se publica', { timeout: 60_000 }, () => {
  const otra = () => fichasBaseBandeja().map((f) => (f.clave === 'g.fechas' ? { ...f, hacer: 'texto que la agencia ajustó' } : f))

  it('frena en el paso 0 y no deja nada', async () => {
    await base(otra())
    await expect(db.exec(await sqlPendiente(await entrada()))).rejects.toThrow('no son la base del arnés')
    expect(await contar('select count(*)::int as n from public.asistente_roles')).toBe(0)
  })

  it('regenerado con esa base (--fichas-base), se publica sobre ella', async () => {
    const o = otra()
    await base(o)
    const bancos = { mano_derecha: await bancoDe('mano_derecha', o), asesor_viajes: await bancoDe('asesor_viajes', o) }
    await db.exec(await sqlPendiente({ base: o, bancos, asignaciones: ASIG }))
    expect((await resolver(DUENO)).rol?.clave).toBe('mano_derecha')
  })
})

/**
 * Un cambio de fichas sobre los roles ya publicados (2026-10-30: «plata» fuera del texto de `alc.plata`). La bandeja
 * publicada no se edita (es inmutable): se cambia su borrador y se publica una versión nueva; los dos roles se vuelven a
 * publicar sobre ella sin tocar asignaciones, teléfonos ni si el rol está prendido. La reversa vuelve a lo de antes.
 */
describe('un cambio de fichas sobre los roles ya publicados (--antes)', { timeout: 60_000 }, () => {
  const TEXTO_ANTES = 'esta bandeja no consulta plata: dilo en una línea'
  // La bandeja publicada antes del 30-oct: «plata» en alc.plata y el nombre de antes en el perfil (hoy se llama Trappi).
  const antes = () => fichasBaseBandeja().map((f) => (f.clave === 'alc.plata' ? { ...f, hacer: TEXTO_ANTES }
    : f.clave === 'perfil' ? { ...f, valores: { ...f.valores, nombre: 'el asistente de solicitudes' } } : f))
  const bancos = async (b: Ficha[]) => ({ mano_derecha: await bancoDe('mano_derecha', b), asesor_viajes: await bancoDe('asesor_viajes', b) })
  const cambio = async () => ({ base: fichasBaseBandeja(), antes: antes(), bancos: await bancos(fichasBaseBandeja()), asignaciones: ASIG })
  const publicarAntes = async () => {
    await base(antes())
    await db.exec(await sqlPendiente({ base: antes(), bancos: await bancos(antes()), asignaciones: ASIG }))
  }
  const huellaBandeja = async () => (await db.query<{ h: string }>(
    `select public.asistente_huella_fichas(fichas) as h from public.bot_reglamentos where bot = '${BOT_BANDEJA}' order by version desc limit 1`)).rows[0].h
  const huellaRol = async (r: ClaveRolTrappvel) => (await db.query<{ h: string }>(
    `select public.asistente_huella_fichas(g.fichas) as h from public.asistente_roles r join public.bot_reglamentos g on g.id = r.reglamento_id where r.clave = '${r}'`)).rows[0].h
  const asignaciones = () => contar('select count(*)::int as n from public.asistente_asignaciones')

  it('solo cambian alc.plata (su texto) y perfil (el nombre)', () => {
    expect(cambiosDeFichas(antes(), fichasBaseBandeja()).map((c) => c.clave)).toEqual(['perfil', 'alc.plata'])
    expect(() => cambiosDeFichas(antes(), fichasBaseBandeja().slice(1))).toThrow('entran o salen claves')
    expect(() => cambiosDeFichas(antes(), fichasBaseBandeja().map((f) => (f.clave === 'alc.plata' ? { ...f, carga: 'indice' as const } : f)))).toThrow('cambia carga')
  })

  it('aplicado: la bandeja y los dos roles quedan con el texto nuevo; asignaciones, teléfonos y lo apagado no cambian', async () => {
    await publicarAntes()
    await db.exec(`update public.asistente_roles set activo = false`)
    const n = await asignaciones()
    const tels = await telefonos()
    await db.exec(await sqlPendiente(await cambio()))
    expect(await huellaBandeja()).toBe(await huellaPublicable(fichasBaseBandeja()))
    for (const r of ['mano_derecha', 'asesor_viajes'] as const) expect(await huellaRol(r)).toBe(await huellaPublicable(fichasDelRol(r)))
    const textos = (await db.query<{ t: string }>(`select string_agg(coalesce(hacer, '') || ' ' || coalesce(cuando, ''), ' ') as t from public.bot_parametros`)).rows[0].t
    expect(textos).not.toMatch(/\bplata\b/i)
    const nombres = (await db.query<{ n: string }>(`select distinct g.fichas_nombre as n from (select f->'valores'->>'nombre' as fichas_nombre
      from public.asistente_roles r join public.bot_reglamentos b on b.id = r.reglamento_id, jsonb_array_elements(b.fichas) f where f->>'clave' = 'perfil') g`)).rows
    expect(nombres).toEqual([{ n: 'Trappi' }])
    expect(await asignaciones()).toBe(n)
    expect(await telefonos()).toEqual(tels)
    expect((await resolver(DUENO)).rol).toMatchObject({ clave: 'mano_derecha', activo: false })
    expect((await resolver({ staff: ASIG.asignaciones[1].staff })).rol).toMatchObject({ clave: 'asesor_viajes', activo: false })
    // Aplicarlo otra vez no falla (la bandeja ya está; los roles se vuelven a publicar igual).
    await db.exec(await sqlPendiente(await cambio()))
    expect(await asignaciones()).toBe(n)
  })

  it('el ensayo corre todo y no deja nada', async () => {
    await publicarAntes()
    const versiones = await contar('select count(*)::int as n from public.bot_reglamentos')
    await expect(db.exec(await sqlEnsayo(await cambio()))).rejects.toThrow('dry-run ok')
    expect(await contar('select count(*)::int as n from public.bot_reglamentos')).toBe(versiones)
    expect(await huellaBandeja()).toBe(await huellaPublicable(antes()))
  })

  it('la reversa vuelve la bandeja y los roles a lo de antes', async () => {
    await publicarAntes()
    await db.exec(await sqlPendiente(await cambio()))
    const huellas = { mano_derecha: await huellaPublicable(fichasDelRol('mano_derecha', antes())), asesor_viajes: await huellaPublicable(fichasDelRol('asesor_viajes', antes())) }
    await db.exec(await sqlReversaCambio(await cambio(), 'prueba', huellas))
    expect(await huellaBandeja()).toBe(await huellaPublicable(antes()))
    for (const r of ['mano_derecha', 'asesor_viajes'] as const) expect(await huellaRol(r)).toBe(huellas[r])
    expect((await resolver(DUENO)).rol?.clave).toBe('mano_derecha')
    // El borrador de cada rol queda igual a su versión de antes: publicarlo da la misma huella.
    for (const r of ['mano_derecha', 'asesor_viajes'] as const) {
      const id = (await db.query<{ id: string }>(`select public.bot_publicar_reglamento($1, $2, 'prueba') as id`, [WS_TRAPPVEL, `rol:${r}`])).rows[0].id
      expect((await db.query<{ h: string }>(`select public.asistente_huella_fichas(fichas) as h from public.bot_reglamentos where id = $1`, [id])).rows[0].h).toBe(huellas[r])
    }
    // Con una huella que no está publicada, la reversa no toca nada.
    await expect(db.exec(await sqlReversaCambio(await cambio(), 'prueba', { ...huellas, asesor_viajes: '0'.repeat(64) }))).rejects.toThrow('con la huella de su banco de antes')
  })

  it('con el puntero fijo en la bandeja, lo mueve a la versión nueva', async () => {
    await publicarAntes()
    await db.exec(`update public.workspaces set config_extra = jsonb_set(config_extra, '{bot_conversacional,agente_config}',
      jsonb_build_object('reglamento_id', (select id::text from public.bot_reglamentos where bot = '${BOT_BANDEJA}')))`)
    await db.exec(await sqlPendiente(await cambio()))
    const pin = (await db.query<{ h: string }>(`select public.asistente_huella_fichas(g.fichas) as h from public.workspaces w
      join public.bot_reglamentos g on g.id::text = w.config_extra->'bot_conversacional'->'agente_config'->>'reglamento_id'`)).rows[0].h
    expect(pin).toBe(await huellaPublicable(fichasBaseBandeja()))
  })

  it('frena sin tocar nada: sin roles publicados, o con la bandeja publicada distinta de la de antes', async () => {
    await base(antes())
    await expect(db.exec(await sqlPendiente(await cambio()))).rejects.toThrow('no están publicados')
    await db.close()
    await publicarAntes()
    await db.exec(`update public.bot_parametros set hacer = 'otro' where bot = '${BOT_BANDEJA}' and clave = 'g.fechas'`)
    await db.query(`select public.bot_publicar_reglamento($1, $2, 'prueba')`, [WS_TRAPPVEL, BOT_BANDEJA])
    const versiones = await contar('select count(*)::int as n from public.bot_reglamentos')
    await expect(db.exec(await sqlPendiente(await cambio()))).rejects.toThrow('no son las de antes del cambio')
    expect(await contar('select count(*)::int as n from public.bot_reglamentos')).toBe(versiones)
  })

  it('si el borrador de la bandeja no era lo publicado, no publica', async () => {
    await publicarAntes()
    await db.exec(`update public.bot_parametros set hacer = 'borrador sin publicar' where bot = '${BOT_BANDEJA}' and clave = 'g.fechas'`)
    await expect(db.exec(await sqlPendiente(await cambio()))).rejects.toThrow('no era lo publicado')
    expect(await huellaBandeja()).toBe(await huellaPublicable(antes()))
  })
})
