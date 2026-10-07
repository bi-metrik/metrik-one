import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { PGlite } from '@electric-sql/pglite'
import { sumarUso } from './uso'
import { semillaSql } from './bandeja/semilla-sql'
import { REGLAMENTO_ANEXO_A } from './bandeja/reglamento-anexo-a'
import { fichaValida } from './reglamento'
import type { Traza } from './tipos'

/**
 * El reglamento versionado, los precios y el contador de uso del núcleo conversacional, con LOS ARCHIVOS de migración
 * en Postgres en memoria (PGlite). El contador en SQL (`bot_uso_mes`) tiene que dar lo mismo que `sumarUso` (TS).
 */

const leer = (a: string) => readFileSync(join(process.cwd(), 'supabase/migrations', a), 'utf8')
const WS = '00000000-0000-4000-8000-0000000000a1'
const WS_2 = '00000000-0000-4000-8000-0000000000a2'

let db: PGlite

beforeAll(async () => {
  db = new PGlite()
  await db.exec(`
    set time zone 'UTC';
    create role anon nologin; create role authenticated nologin; create role service_role nologin;
    grant usage on schema public to anon, authenticated, service_role;
    alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
    alter default privileges in schema public grant execute on functions to anon, authenticated, service_role;
    create table public.workspaces (id uuid primary key, slug text);
    insert into public.workspaces values ('${WS}', 'prueba'), ('${WS_2}', 'trappvel');
  `)
  await db.exec(leer('20261006213100_wa_conversacion.sql'))
  await db.exec(leer('20261006213200_bot_reglamento_y_uso.sql'))
})
afterAll(async () => { await db.close() })

const ficha = (ws: string | null, clave: string, hacer: string, activo = true) => db.query(
  `insert into public.bot_parametros (workspace_id, bot, clave, tipo, carga, hacer, activo) values ($1, 'b', $2, 'guia', 'siempre', $3, $4)`,
  [ws, clave, hacer, activo],
)

describe('reglamento versionado', () => {
  it('publica las globales más las del workspace (que ganan por clave), sin las inactivas, con versión y huella', async () => {
    await ficha(null, 'g.uno', 'global uno')
    await ficha(null, 'g.dos', 'global dos')
    await ficha(WS, 'g.dos', 'del workspace')
    await ficha(WS, 'g.tres', 'apagada', false)
    const r = await db.query<{ id: string }>(`select public.bot_publicar_reglamento($1, 'b', 'max') as id`, [WS])
    const v = await db.query<{ version: number; fichas: Array<{ clave: string; hacer: string }>; huella: string }>(
      'select version, fichas, huella from public.bot_reglamentos where id = $1', [r.rows[0].id])
    expect(v.rows[0].version).toBe(1)
    expect(v.rows[0].fichas.map((f) => [f.clave, f.hacer])).toEqual([['g.dos', 'del workspace'], ['g.uno', 'global uno']])
    expect(v.rows[0].huella).toMatch(/^[0-9a-f]{64}$/)
    const r2 = await db.query<{ id: string }>(`select public.bot_publicar_reglamento($1, 'b', 'max') as id`, [WS])
    const v2 = await db.query<{ version: number; huella: string }>('select version, huella from public.bot_reglamentos where id = $1', [r2.rows[0].id])
    expect(v2.rows[0]).toEqual({ version: 2, huella: v.rows[0].huella })
  })
  it('una versión publicada no se edita', async () => {
    await expect(db.query(`update public.bot_reglamentos set huella = 'x'`)).rejects.toThrow(/inmutable/)
  })
  it('sin fichas no se publica', async () => {
    await expect(db.query(`select public.bot_publicar_reglamento($1, 'otro', 'max')`, [WS])).rejects.toThrow(/no hay fichas/)
  })
  it('la misma clave dos veces en el mismo alcance choca', async () => {
    await expect(ficha(WS, 'g.dos', 'otra')).rejects.toThrow(/duplicate key/)
  })
})

describe('contador de uso (bot_uso_mes)', () => {
  const trazas: Traza[] = [
    { tipo: 'modelo', bot: 'b', uso: [{ modelo: 'm-a', entrada: 4000, salida: 120, razonamiento: 300, cache: 1000, ms: 900, ok: true }] },
    { tipo: 'modelo', bot: 'b', uso: [
      { modelo: 'm-a', entrada: 0, salida: 0, razonamiento: 0, cache: 0, ms: 2500, ok: false, motivo: 'corte' },
      { modelo: 'm-b', entrada: 3800, salida: 80, razonamiento: 0, cache: 0, ms: 700, ok: true },
    ] },
    { tipo: 'reenvio', bot: 'b' },
  ]
  const insertar = async (ws: string, t: Traza, at: string) => db.query(
    `insert into public.wa_conversacion (workspace_id, phone, direccion, clase, texto, traza, created_at) values ($1, '573', 'entrante', 'escrito', 'x', $2, $3)`,
    [ws, JSON.stringify(t), at],
  )

  beforeAll(async () => {
    for (const t of trazas) await insertar(WS, t, '2026-10-15T15:00:00Z')
    // Fuera del mes de Bogotá (1-nov 04:00 UTC = 31-oct 23:00 Bogotá: SÍ cuenta en octubre) y otro workspace.
    await insertar(WS, trazas[0], '2026-11-01T04:00:00Z')
    await insertar(WS, trazas[0], '2026-11-01T06:00:00Z')
    await insertar(WS_2, trazas[0], '2026-10-15T15:00:00Z')
  })

  it('sin precios: suma bien y el costo queda nulo con los modelos listados', async () => {
    const r = await db.query<{ u: Record<string, unknown> }>(`select public.bot_uso_mes($1, '2026-10-20') as u`, [WS])
    expect(r.rows[0].u).toMatchObject({ mes: '2026-10', turnos: 3, llamados: 4, costo_usd: null, sin_precio: ['m-a', 'm-b'] })
  })

  it('con precios: el mismo número que sumarUso en TypeScript', async () => {
    await db.query(`insert into public.bot_modelo_precios values ('m-a', 0.5, 3, 0.125, 'prueba'), ('m-b', 0.1, 0.4, null, 'prueba')`)
    const r = await db.query<{ u: { turnos: number; llamados: number; entrada: number; salida: number; razonamiento: number; cache: number; costo_usd: number } }>(
      `select public.bot_uso_mes($1, '2026-10-01') as u`, [WS])
    const ts = sumarUso([...trazas, trazas[0]], [{ modelo: 'm-a', entrada: 0.5, salida: 3, cache: 0.125 }, { modelo: 'm-b', entrada: 0.1, salida: 0.4, cache: null }])
    const u = r.rows[0].u
    expect({ turnos: u.turnos, llamados: Number(u.llamados), entrada: Number(u.entrada), salida: Number(u.salida), razonamiento: Number(u.razonamiento), cache: Number(u.cache) })
      .toEqual({ turnos: ts.turnos, llamados: ts.llamados, entrada: ts.entrada, salida: ts.salida, razonamiento: ts.razonamiento, cache: ts.cache })
    expect(Number(u.costo_usd)).toBeCloseTo(ts.costo_usd!, 12)
  })

  it('nadie con sesión alcanza las tablas ni las funciones', async () => {
    const r = await db.query<{ t: boolean }>(`
      select bool_or(has_table_privilege(rol, t, 'select')) as t
      from unnest(array['anon','authenticated']) rol, unnest(array['public.bot_parametros','public.bot_reglamentos','public.bot_modelo_precios']) t`)
    expect(r.rows[0].t).toBe(false)
    const f = await db.query<{ f: boolean }>(`
      select bool_or(has_function_privilege(rol, fn, 'execute')) as f
      from unnest(array['anon','authenticated']) rol,
           unnest(array['public.bot_uso_mes(uuid,date)','public.bot_publicar_reglamento(uuid,text,text,jsonb)']) fn`)
    expect(f.rows[0].f).toBe(false)
  })
})

describe('semilla de prueba del Anexo A', () => {
  const SEMILLA = readFileSync(join(process.cwd(), 'sql/trappvel/2026-10-06_reglamento-bandeja-PRUEBA.sql'), 'utf8')
  it('el archivo es exactamente lo que genera el fixture (una sola fuente)', () => {
    expect(SEMILLA.trimEnd()).toBe(semillaSql().trimEnd())
  })
  it('siembra y publica en un workspace de prueba; lo publicado se lee igual que el fixture', async () => {
    await db.exec(SEMILLA.replaceAll('<WORKSPACE_DE_PRUEBA>', WS))
    const r = await db.query<{ fichas: unknown[] }>(`select fichas from public.bot_reglamentos where workspace_id = $1 and bot = 'bandeja-solicitudes'`, [WS])
    const leidas = r.rows[0].fichas.map(fichaValida)
    expect(leidas.every(Boolean)).toBe(true)
    const porClave = (fs: Array<{ clave: string }>) => [...fs].sort((a, b) => a.clave.localeCompare(b.clave))
    const normal = (f: Record<string, unknown>) => Object.fromEntries(Object.entries(f).filter(([, v]) => v !== null && v !== undefined && v !== '' && !(Array.isArray(v) && v.length === 0)))
    expect(porClave(leidas as Array<{ clave: string }>).map((f) => normal(f as Record<string, unknown>)))
      .toEqual(porClave(REGLAMENTO_ANEXO_A).map((f) => normal(f as unknown as Record<string, unknown>)))
  })
  it('se niega a sembrar en el workspace de Trappvel', async () => {
    await expect(db.exec(SEMILLA.replaceAll('<WORKSPACE_DE_PRUEBA>', WS_2))).rejects.toThrow(/no se siembra en el workspace de Trappvel/)
  })
})
