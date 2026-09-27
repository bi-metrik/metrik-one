import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { PGlite } from '@electric-sql/pglite'
import { horasHabilesEntre } from './horas-habiles'
import { festivosColombia } from '@/lib/dates/festivos-colombia'

/**
 * Paridad del SLA: la funcion SQL `horas_habiles_entre` (la que alimenta /flujo, /equipo y
 * `v_negocios_etapa_vencimiento`) contra su espejo TypeScript `horasHabilesEntre` (el badge
 * de atraso del listado), ejecutando EL ARCHIVO de la migracion 20260927000001 en Postgres
 * en memoria.
 *
 * Hasta ahora la paridad se habia medido a mano contra produccion (#929: "32 h en SQL y en
 * TS"). A mano no se repite: el dia que alguien toque una de las dos, nada lo avisaba. Aqui
 * corre en cada PR.
 *
 * Se aplica la migracion hasta la seccion 4 inclusive (hoy_bogota, festivos calculados, la
 * siembra de `festivos_colombia` y `horas_habiles_entre`). La seccion 5 reescribe funciones
 * vivas de produccion que esta base no tiene.
 *
 * La base corre con `TimeZone = UTC`, como produccion: el borde que importa (19:00-23:59
 * de Bogota, que en UTC ya es el dia siguiente) solo existe si la sesion NO esta en Bogota.
 */

const MIGRACION = '20260927000001_fechas_bogota_festivos_calculados.sql'

let db: PGlite

function hastaSeccion5(sql: string): string {
  const corte = sql.indexOf('-- 5. CURRENT_DATE')
  if (corte < 0) throw new Error('la migracion cambio de forma: no encuentro la seccion 5')
  // Retrocede a la linea de guiones que abre la seccion.
  return sql.slice(0, sql.lastIndexOf('-- ----', corte))
}

beforeAll(async () => {
  db = new PGlite()
  await db.exec(`
    set time zone 'UTC';
    create role anon nologin;
    create role authenticated nologin;
    create role service_role nologin;
    create table public.festivos_colombia (fecha date primary key, descripcion text);
  `)
  const sql = readFileSync(join(process.cwd(), 'supabase/migrations', MIGRACION), 'utf8')
  await db.exec(hastaSeccion5(sql))
}, 60_000)

afterAll(async () => {
  await db?.close()
})

/** Los festivos de 2025 a 2100, igual que la siembra de la migracion. */
const FESTIVOS = new Set<string>()
for (let a = 2025; a <= 2100; a++) for (const f of festivosColombia(a)) FESTIVOS.add(f.fecha)

/** Generador determinista: la misma lista de casos en cada corrida. */
function lcg(semilla: number) {
  let s = semilla >>> 0
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0
    return s / 2 ** 32
  }
}

type Caso = [inicio: string, fin: string]

function casos(): Caso[] {
  const r = lcg(20260927)
  const out: Caso[] = []
  const base = Date.UTC(2025, 0, 1)
  const span = Date.UTC(2027, 11, 31) - base
  for (let i = 0; i < 400; i++) {
    const ini = base + Math.floor(r() * span)
    const dur = Math.floor(r() * 21 * 86_400_000) // hasta 3 semanas
    out.push([new Date(ini).toISOString(), new Date(ini + dur).toISOString()])
  }
  // El borde: rangos que empiezan o terminan entre las 19:00 y las 23:59 de Bogota
  // (00:00-04:59 UTC del dia siguiente), en viernes, domingo, festivo y fin de mes.
  const bordes = [
    ['2026-07-24T17:00:00Z', '2026-07-27T01:00:00Z'], // el caso de #929: 32 h
    ['2026-07-25T00:30:00Z', '2026-07-27T04:59:00Z'], // viernes 19:30 -> domingo 23:59
    ['2026-09-30T23:59:00Z', '2026-10-01T04:59:00Z'], // 30-sep 18:59 -> 23:59 (fin de mes)
    ['2026-10-01T00:00:00Z', '2026-10-13T00:00:00Z'], // 30-sep 19:00 -> lunes festivo 12-oct 19:00
    ['2026-12-31T23:00:00Z', '2027-01-05T02:00:00Z'], // fin de anio con festivo
    ['2026-04-01T23:30:00Z', '2026-04-06T04:00:00Z'], // Semana Santa
    ['2028-02-29T00:10:00Z', '2028-03-01T04:50:00Z'], // bisiesto, noche de Bogota
    ['2026-07-27T12:00:00Z', '2026-07-27T12:00:00Z'], // rango vacio
    ['2026-07-28T12:00:00Z', '2026-07-27T12:00:00Z'], // invertido
  ] as Caso[]
  return [...bordes, ...out]
}

describe('horas_habiles_entre (SQL) = horasHabilesEntre (TS)', () => {
  it('los festivos que siembra la migracion son exactamente los calculados en TypeScript', async () => {
    const r = await db.query<{ fecha: string }>(`select to_char(fecha, 'YYYY-MM-DD') as fecha from public.festivos_colombia order by 1`)
    expect(r.rows.map((x) => x.fecha)).toEqual([...FESTIVOS].sort())
  })

  it('coinciden en 409 rangos, borde de Bogota incluido', async () => {
    const lista = casos()
    const valores = lista.map(([a, b]) => `('${a}'::timestamptz, '${b}'::timestamptz)`).join(',\n')
    const r = await db.query<{ i: number; h: string }>(`
      select i, public.horas_habiles_entre(a, b)::text as h
      from (select row_number() over () as i, a, b from (values ${valores}) v(a, b)) x
      order by i
    `)
    expect(r.rows).toHaveLength(lista.length)
    const distintos: string[] = []
    lista.forEach(([a, b], k) => {
      const sql = Number(r.rows[k].h)
      const ts = horasHabilesEntre(a, Date.parse(b), FESTIVOS)
      if (Math.abs(sql - ts) > 1e-6) distintos.push(`${a} -> ${b}: SQL ${sql} / TS ${ts}`)
    })
    expect(distintos).toEqual([])
  })

  it('el caso que motivo #929 da 32 h en los dos lados', async () => {
    const r = await db.query<{ h: string }>(
      `select public.horas_habiles_entre('2026-07-24T17:00:00Z', '2026-07-27T01:00:00Z')::text as h`,
    )
    expect(Number(r.rows[0].h)).toBe(32)
    expect(horasHabilesEntre('2026-07-24T17:00:00Z', Date.parse('2026-07-27T01:00:00Z'), FESTIVOS)).toBe(32)
  })

  it('hoy_bogota: a las 00:30 UTC todavia es el dia anterior en Bogota', async () => {
    // `now()` no se puede fijar en una prueba; se comprueba la expresion de la funcion.
    const r = await db.query<{ d: string }>(
      `select (('2026-10-01T00:30:00Z'::timestamptz) at time zone 'America/Bogota')::date::text as d`,
    )
    expect(r.rows[0].d).toBe('2026-09-30')
  })
})
