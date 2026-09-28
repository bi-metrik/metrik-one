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

describe('el SQL provisional de Trappvel', () => {
  it('agrega los 8 campos en su sitio y todo pedir_si se lee', () => {
    expect(fields).toHaveLength(sintetica.length + 8)
    expect(slugs(fields).slice(0, 3)).toEqual(['destino', 'destino_tipo', 'tipo_viaje'])
    expect(slugs(fields)).toContain('edades_menores')
    for (const f of fields) expect(leerPedirSi(f.pedir_si)).not.toHaveProperty('error')
    // Ninguno de los nuevos frena el bloque: el mínimo avisa.
    expect(fields.filter(f => f.nivel && f.required).map(f => f.slug)).toEqual(['destino', 'adultos'])
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
    expect(slugs(r.minimo.faltan)).toEqual(['fecha_salida', 'fecha_regreso', 'ninos', 'infantes'])
    expect(r.minimo).toMatchObject({ completos: 2, total: 6 })
  })

  it('un 0 escrito sí cuenta como respondido', () => {
    const r = calcularNiveles(fields, { destino: 'Punta Cana', adultos: 2, ninos: 0, infantes: 0 })
    expect(r.errores).toEqual([])
    expect(r.minimo.total).toBe(6)
    expect(slugs(r.minimo.faltan)).toEqual(['fecha_salida', 'fecha_regreso'])
    expect(slugs(r.deseable.faltan)).toEqual(['tipo_viaje', 'presupuesto', 'categoria_hotel', 'plan_alimentacion', 'equipaje'])
  })

  it('para CALCULAR, un vacío sigue valiendo 0: la composición y el total no se rompen', () => {
    const vals = aplicarSumas(fields, { adultos: 2, ninos: '', infantes: undefined })
    expect(vals.numero_pasajeros).toBe(2)
    expect(normalizarComposicion(vals)).toEqual({ adultos: 2, ninos: 0, infantes: 0 })
  })

  it('con menores: la edad entra al mínimo', () => {
    const r = calcularNiveles(fields, { destino: 'Madrid', adultos: 2, ninos: 1, infantes: 1, numero_pasajeros: 4 })
    expect(r.minimo.total).toBe(7)
    expect(r.minimo.faltan.map(f => f.pregunta)).toEqual(['¿Qué día salen?', '¿Qué día regresan?', '¿Qué edad tiene cada niño?'])
  })

  it('grupo de 17 adultos y 5 menores, destino de playa (nacional)', () => {
    const r = calcularNiveles(fields, {
      adultos: 17, ninos: 5, infantes: 0, numero_pasajeros: 22, tipo_viaje: 'playa', destino_tipo: 'nacional',
    })
    expect(slugs(r.minimo.faltan)).toEqual(['destino', 'fecha_salida', 'fecha_regreso', 'edades_menores'])
    expect(r.minimo).toMatchObject({ completos: 3, total: 7 })
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
