import { describe, expect, it } from 'vitest'
import { destinoCorto, leerPlantillaNombre, nombreSegunPlantilla, renombrarSegunPlantilla } from './nombre-viaje'

/**
 * Mauricio, 2026-10-12: «El nombre del viaje debería ser automático pero tener unos parámetros claros de cómo
 * nombrarlo». «MIAMI 7N» quedó con 6 noches porque el nombre se ponía al crear y no cambiaba. La regla vive en la línea
 * (`lineas_negocio.config_extra.nombre_automatico`) y arma el nombre con campos estructurados. Datos inventados.
 */

const REGLA = { nombre_automatico: { plantilla: '{destino} {noches}N {mes}' } }
const P = leerPlantillaNombre(REGLA)!

describe('la regla de la línea', () => {
  it('sin plantilla, la línea no tiene nombre automático; con ella, valores por defecto claros', () => {
    expect(leerPlantillaNombre(null)).toBeNull()
    expect(leerPlantillaNombre({ nombre_automatico: { plantilla: '  ' } })).toBeNull()
    expect(P).toEqual({
      plantilla: '{destino} {noches}N {mes}', sinDatos: 'Viaje de {cliente}', requiere: ['destino'], maxDestino: 18,
      campos: { destino: 'destino', salida: 'fecha_salida', regreso: 'fecha_regreso' },
    })
  })

  it('«MIAMI 6N NOV»: destino, noches de las fechas y mes de salida', () => {
    expect(nombreSegunPlantilla(P, { destino: 'Miami', fecha_salida: '2026-11-19', fecha_regreso: '2026-11-25' }, 'MARTIN MORA'))
      .toEqual({ nombre: 'MIAMI 6N NOV', provisional: false })
  })

  it('si falta un dato se omite esa parte entera; sin destino va el provisional', () => {
    expect(nombreSegunPlantilla(P, { destino: 'Miami' }, null)?.nombre).toBe('MIAMI')
    expect(nombreSegunPlantilla(P, { destino: 'Miami', fecha_salida: '2026-12-03' }, null)?.nombre).toBe('MIAMI DIC')
    // Un regreso antes de la salida no da noches.
    expect(nombreSegunPlantilla(P, { destino: 'Miami', fecha_salida: '2026-12-03', fecha_regreso: '2026-12-01' }, null)?.nombre).toBe('MIAMI DIC')
    expect(nombreSegunPlantilla(P, { fecha_salida: '2026-12-03' }, 'MARTIN MORA')).toEqual({ nombre: 'Viaje de Martin Mora', provisional: true })
    expect(nombreSegunPlantilla(P, {}, null)).toBeNull()
  })

  it('el destino largo se abrevia: primero los lugares que caben, si no las palabras', () => {
    expect(destinoCorto('San Andrés y Providencia', 18)).toBe('SAN ANDRÉS')
    expect(destinoCorto('Cartagena, Santa Marta', 25)).toBe('CARTAGENA, SANTA MARTA')
    expect(destinoCorto('Cartagena, Santa Marta, Barranquilla', 25)).toBe('CARTAGENA - SANTA MARTA')
    expect(destinoCorto('Cartagena, Santa Marta', 18)).toBe('CARTAGENA')
    expect(destinoCorto('Islas Galápagos del Ecuador continental', 18)).toBe('ISLAS GALÁPAGOS')
    expect(destinoCorto('Punta Cana', 18)).toBe('PUNTA CANA')
  })

  it('otra línea, otra regla: campos, marcadores y provisional propios', () => {
    const otra = leerPlantillaNombre({ nombre_automatico: { plantilla: '{mes}{anio} {destino} {dias}D', sin_datos: 'Cotización {cliente}', max_destino: 8, campos: { destino: 'ciudad', salida: 'ida', regreso: 'vuelta' } } })!
    expect(nombreSegunPlantilla(otra, { ciudad: 'Medellín', ida: '2027-01-10', vuelta: '2027-01-14' }, null)?.nombre).toBe('ENE27 MEDELLÍN 5D')
    expect(nombreSegunPlantilla(otra, {}, 'ANA TORRES')?.nombre).toBe('Cotización Ana Torres')
  })
})

// ── En la base (un Supabase falso, en memoria) ───────────────────────────────

type Fila = Record<string, unknown>
function baseFalsa(t: { negocios: Fila[]; lineas_negocio: Fila[]; negocio_bloques: Fila[] }) {
  const consultas: string[] = []
  const from = (tabla: keyof typeof t) => {
    const filtros: Array<[string, unknown]> = []
    let cambio: Fila | null = null
    const filas = () => t[tabla].filter((f) => filtros.every(([k, v]) => f[k] === v))
    const q = {
      select: () => q,
      update: (c: Fila) => { cambio = c; return q },
      eq: (k: string, v: unknown) => { filtros.push([k, v]); return q },
      maybeSingle: async () => { consultas.push(tabla); return { data: filas()[0] ?? null, error: null } },
      then: (ok: (r: unknown) => void) => {
        consultas.push(cambio ? `${tabla}:update` : tabla)
        const fs = filas()
        if (cambio) for (const f of fs) Object.assign(f, cambio)
        ok({ data: fs, error: null })
      },
    }
    return q
  }
  return { db: { from: from as (x: string) => unknown } as never, consultas, t }
}

const negocio = (nombre: string, auto: string | null) => ({
  id: 'n-1', nombre, linea_id: 'l-viajes', metadata: auto === null ? {} : { nombre_auto: auto, nombre_pistas: { mes: 10 } },
  contactos: { nombre: 'MARTIN MORA' },
})
const bloques = (data: Fila) => [{ negocio_id: 'n-1', data, bloque_configs: { orden: 1, bloque_definitions: { tipo: 'datos' }, etapas_negocio: { orden: 1 } } }]

describe('renombrar en la base', () => {
  it('cambian las fechas de un viaje con nombre automático: «MIAMI 7N» pasa a «MIAMI 6N NOV» y la marca lo sigue', async () => {
    const b = baseFalsa({
      negocios: [negocio('MIAMI 7N', 'MIAMI 7N')],
      lineas_negocio: [{ id: 'l-viajes', config_extra: REGLA }],
      negocio_bloques: bloques({ destino: 'Miami', fecha_salida: '2026-11-19', fecha_regreso: '2026-11-25' }),
    })
    expect(await renombrarSegunPlantilla(b.db, 'n-1', ['fecha_regreso'])).toBe('MIAMI 6N NOV')
    expect(b.t.negocios[0]).toMatchObject({ nombre: 'MIAMI 6N NOV', metadata: { nombre_auto: 'MIAMI 6N NOV', nombre_provisional: false, nombre_pistas: { mes: 10 } } })
  })

  it('un nombre que una persona escribió o cambió no se pisa (ni se consulta la regla)', async () => {
    const b = baseFalsa({
      negocios: [negocio('Luna de miel de Martín', 'MIAMI 7N')],
      lineas_negocio: [{ id: 'l-viajes', config_extra: REGLA }],
      negocio_bloques: bloques({ destino: 'Miami', fecha_salida: '2026-11-19', fecha_regreso: '2026-11-25' }),
    })
    expect(await renombrarSegunPlantilla(b.db, 'n-1', ['destino'])).toBeNull()
    expect(b.t.negocios[0].nombre).toBe('Luna de miel de Martín')
    expect(b.consultas).toEqual(['negocios'])
    // Sin marca (creado a mano antes de la regla): tampoco.
    const c = baseFalsa({ negocios: [negocio('MIAMI 7N', null)], lineas_negocio: [{ id: 'l-viajes', config_extra: REGLA }], negocio_bloques: [] })
    expect(await renombrarSegunPlantilla(c.db, 'n-1')).toBeNull()
  })

  it('una línea sin regla, o un cambio que no toca sus campos, no renombra ni lee los bloques', async () => {
    const b = baseFalsa({ negocios: [negocio('MIAMI 7N', 'MIAMI 7N')], lineas_negocio: [{ id: 'l-viajes', config_extra: {} }], negocio_bloques: [] })
    expect(await renombrarSegunPlantilla(b.db, 'n-1', ['fecha_regreso'])).toBeNull()
    const c = baseFalsa({ negocios: [negocio('MIAMI 7N', 'MIAMI 7N')], lineas_negocio: [{ id: 'l-viajes', config_extra: REGLA }], negocio_bloques: [] })
    expect(await renombrarSegunPlantilla(c.db, 'n-1', ['adultos'])).toBeNull()
    expect(c.consultas).toEqual(['negocios', 'lineas_negocio'])
  })

  it('una base que falla no lanza', async () => {
    const db = { from: () => { throw new Error('caída') } } as never
    expect(await renombrarSegunPlantilla(db, 'n-1')).toBeNull()
  })
})
