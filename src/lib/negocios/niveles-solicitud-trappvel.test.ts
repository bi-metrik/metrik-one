/**
 * La config PROVISIONAL de Trappvel, tal como la deja el SQL sin aplicar
 * (`sql/trappvel/2026-09-28_solicitud-minimo-deseable-PROVISIONAL.sql`).
 *
 * El SQL se EJECUTA en Postgres en memoria (PGlite) sobre un bloque sintético con los slugs y
 * tipos que el SQL exige (`__fixtures__/solicitud-viaje-sintetica.json`, escrito a mano: no es
 * una copia de producción). Lo que se evalúa es lo que el SQL de verdad produce, no una
 * reimplementación del merge: si alguien lo edita y lo deja inválido, cae aquí.
 */
import { afterAll, beforeAll, describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { PGlite } from '@electric-sql/pglite'
import { calcularNiveles, leerPedirSi, type CampoConNivel } from './niveles-solicitud'
import { aplicarSumas } from './campo-suma'
import { normalizarComposicion } from '@/lib/cotizaciones/tarifa-pasajero'
import sintetica from './__fixtures__/solicitud-viaje-sintetica.json'

const SQL = readFileSync(
  path.resolve(__dirname, '../../../sql/trappvel/2026-09-28_solicitud-minimo-deseable-PROVISIONAL.sql'),
  'utf8',
)
const ID = '98281a40-2f67-4d8e-9bc5-6ca1f7a69417'

let db: PGlite
let fields: CampoConNivel[]

async function leerFields(): Promise<CampoConNivel[]> {
  const r = await db.query<{ fields: CampoConNivel[] }>(`select config_extra->'fields' as fields from public.bloque_configs where id = $1`, [ID])
  return r.rows[0].fields
}

beforeAll(async () => {
  db = new PGlite()
  await db.exec(`create table public.bloque_configs (id uuid primary key, slug text, config_extra jsonb)`)
  await db.query(`insert into public.bloque_configs values ($1, 'condiciones_del_viaje', $2)`, [ID, { label: 'x', fields: sintetica }])
  await db.exec(SQL)
  fields = await leerFields()
}, 30_000)
afterAll(async () => { await db.close() })

const slugs = (xs: { slug: string }[]) => xs.map(x => x.slug)
const nivel = (slug: string) => fields.find(f => f.slug === slug)?.nivel

describe('el SQL provisional de Trappvel', () => {
  it('agrega los 10 campos en su sitio y todo pedir_si se lee', () => {
    expect(fields).toHaveLength(sintetica.length + 10)
    expect(slugs(fields).slice(0, 4)).toEqual(['destino', 'ciudad_origen', 'destino_tipo', 'tipo_viaje'])
    expect(slugs(fields).slice(5, 8)).toEqual(['fecha_salida', 'fecha_regreso', 'flexibilidad_fecha'])
    expect(slugs(fields)).toContain('edades_menores')
    for (const f of fields) expect(leerPedirSi(f.pedir_si)).not.toHaveProperty('error')
    // Ninguno de los nuevos frena el bloque: el mínimo avisa.
    expect(fields.filter(f => f.nivel && f.required).map(f => f.slug)).toEqual(['destino', 'adultos'])
  })

  it('decisiones del 30-sep: ciudad de salida y categoría al mínimo; presupuesto, equipaje y tipo de viaje deseables', () => {
    expect(nivel('ciudad_origen')).toBe('minimo')
    expect(nivel('categoria_hotel')).toBe('minimo')
    expect(nivel('presupuesto')).toBe('deseable')
    expect(nivel('equipaje')).toBe('deseable')
    expect(nivel('tipo_viaje')).toBe('deseable')
    // tipo_viaje es informativo: ningún pedir_si lo mira.
    expect(JSON.stringify(fields.map(f => f.pedir_si ?? null))).not.toContain('tipo_viaje')
  })

  it('no agrega un campo de autorización de datos: la registra el bloque de contacto', () => {
    expect(slugs(fields).some(s => s.includes('autoriza'))).toBe(false)
  })

  it('niños e infantes pierden el default 0', () => {
    for (const s of ['ninos', 'infantes']) expect(fields.find(f => f.slug === s)).not.toHaveProperty('default')
  })

  it('es idempotente: la segunda pasada no cambia nada', async () => {
    await db.exec(SQL)
    expect(await leerFields()).toEqual(fields)
  })
})

describe('niveles con la config provisional', () => {
  it('niños e infantes vacíos: el mínimo los pregunta', () => {
    const r = calcularNiveles(fields, { destino: 'Punta Cana', adultos: 2 })
    expect(slugs(r.minimo.faltan)).toEqual(['ciudad_origen', 'fecha_salida', 'fecha_regreso', 'ninos', 'infantes', 'categoria_hotel'])
    expect(r.minimo).toMatchObject({ completos: 2, total: 8 })
  })

  it('un 0 escrito sí cuenta como respondido', () => {
    const r = calcularNiveles(fields, { destino: 'Punta Cana', adultos: 2, ninos: 0, infantes: 0 })
    expect(r.errores).toEqual([])
    expect(r.minimo.total).toBe(8)
    expect(slugs(r.minimo.faltan)).toEqual(['ciudad_origen', 'fecha_salida', 'fecha_regreso', 'categoria_hotel'])
    expect(slugs(r.deseable.faltan)).toEqual(['tipo_viaje', 'flexibilidad_fecha', 'presupuesto', 'plan_alimentacion', 'equipaje'])
  })

  it('la flexibilidad de fechas solo cuenta mientras no hay fecha de salida', () => {
    const sin = calcularNiveles(fields, { adultos: 2, ninos: 0, infantes: 0 })
    const con = calcularNiveles(fields, { adultos: 2, ninos: 0, infantes: 0, fecha_salida: '2026-11-15' })
    expect(slugs(sin.deseable.faltan)).toContain('flexibilidad_fecha')
    expect(slugs(con.deseable.faltan)).not.toContain('flexibilidad_fecha')
    expect(con.deseable.total).toBe(sin.deseable.total - 1)
  })

  it('para CALCULAR la composición, un vacío sigue valiendo 0; el TOTAL no se inventa con lo que falta', () => {
    const vals = aplicarSumas(fields, { adultos: 2, ninos: '', infantes: undefined })
    // Prueba en vivo de la bandeja (2026-10-01, error 5): el total sale solo con las tres fuentes.
    expect(vals.numero_pasajeros).toBeUndefined()
    expect(normalizarComposicion(vals)).toEqual({ adultos: 2, ninos: 0, infantes: 0 })
    expect(aplicarSumas(fields, { adultos: 2, ninos: 0, infantes: 0 }).numero_pasajeros).toBe(2)
  })

  it('con menores: la edad entra al mínimo', () => {
    const r = calcularNiveles(fields, { destino: 'Madrid', adultos: 2, ninos: 1, infantes: 1, numero_pasajeros: 4 })
    expect(r.minimo.total).toBe(9)
    expect(r.minimo.faltan.map(f => f.pregunta)).toEqual([
      '¿Desde qué ciudad salen?', '¿Qué día salen?', '¿Qué día regresan?',
      '¿Qué edad tiene cada niño?', '¿De qué categoría prefieren el hotel?',
    ])
  })

  it('grupo de 17 adultos y 5 menores, destino de playa (nacional)', () => {
    const r = calcularNiveles(fields, {
      adultos: 17, ninos: 5, infantes: 0, numero_pasajeros: 22, tipo_viaje: 'playa', destino_tipo: 'nacional',
    })
    expect(slugs(r.minimo.faltan)).toEqual(['destino', 'ciudad_origen', 'fecha_salida', 'fecha_regreso', 'edades_menores', 'categoria_hotel'])
    expect(r.minimo).toMatchObject({ completos: 3, total: 9 })
    expect(slugs(r.deseable.faltan)).toContain('acomodacion')
    expect(slugs(r.deseable.faltan)).not.toContain('permiso_salida_menores')
  })

  it('internacional con menores: el permiso de salida entra al deseable', () => {
    const r = calcularNiveles(fields, { adultos: 17, ninos: 5, numero_pasajeros: 22, destino_tipo: 'internacional' })
    expect(slugs(r.deseable.faltan)).toEqual(expect.arrayContaining(['acomodacion', 'permiso_salida_menores']))
    expect(r.deseable.total).toBe(7)
  })

  it('internacional sin menores: sin permiso', () => {
    const r = calcularNiveles(fields, { adultos: 2, ninos: 0, infantes: 0, destino_tipo: 'internacional' })
    expect(slugs(r.deseable.faltan)).not.toContain('permiso_salida_menores')
  })
})

