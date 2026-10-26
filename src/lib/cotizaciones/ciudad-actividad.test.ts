/**
 * La ciudad de una actividad no sale del nombre del tour (brief del 2026-10-05, C3 de #976 sobre
 * COT-2026-0020: «Tour en lancha por la bahía de Manzanillo» volvió con `Ciudad: Manzanillo`).
 */
import { describe, expect, it } from 'vitest'

import { construirPrompt } from '@/lib/ai/extraer-ranura'
import { ciudadDeActividad, lugarDeBloqueNuevo } from './actividad-pantallazo'
import { ciudadEsLugarDelNombre } from './ciudad-actividad'
import { evaluarLectura, type LecturaCruda } from './lectura-pantallazo'
import { ranuraPorSlug } from './ranuras-pantallazo'
import type { LecturaCasilla } from './tarifa-pasajero'

const ACTIVIDAD = ranuraPorSlug('actividad_detalle')!
const v = (valor: string | null, confianza = 0.95) => ({ value: valor, confidence: confianza })

/** La captura de Civitatis del C3: 300.000 COP, 3 personas, 10 nov. */
function cruda(nombre: string, ciudad: string | null): LecturaCruda {
  return {
    veredicto: 'detalle_unico',
    observacion: 'Ficha de la actividad en Civitatis',
    campos: {
      proveedor: v('Civitatis'),
      nombre: v(nombre),
      ciudad: ciudad === null ? v(null, 0) : v(ciudad),
      fecha: v('2026-11-10'),
      idioma: v('Español'),
      pax: v('3'),
      moneda: v('COP'),
      precio_total: v('300000'),
      base_precio: v('total'),
    },
    desglose: [],
  }
}

/** La lectura YA guardada (ítem `d15ce887…` de COT-2026-0020), con la ciudad inventada. */
function guardada(nombre: string, ciudad: string | null): LecturaCasilla {
  return {
    total: 300000, moneda: 'COP', aPagarAgencia: null, porTipo: [],
    ocupacion: { adultos: null, ninos: null, infantes: null, total: 3 }, ocupacionDelItem: false,
    identidad: { nombre, fecha: '2026-11-10' }, notasCliente: [], alertas: [],
    campos: [
      { label: 'Proveedor', valor: 'Civitatis' },
      { label: 'Actividad', valor: nombre },
      ...(ciudad ? [{ label: 'Ciudad', valor: ciudad }] : []),
      { label: 'Fecha', valor: '2026-11-10' },
    ],
    nombre, descripcion: '', leidaEn: '2026-10-04T01:53:29.582Z',
  }
}

describe('criterio 1 · un lugar del nombre del tour no es la ciudad', () => {
  it('«bahía de Manzanillo»: Manzanillo se descarta', () => {
    expect(ciudadEsLugarDelNombre('Manzanillo', 'Tour en lancha por la bahía de Manzanillo')).toBe(true)
  })
  it('bahía, playa, cayo, isla, parque, antes o después, con o sin tildes', () => {
    expect(ciudadEsLugarDelNombre('Cangrejo', 'Excursión a Cayo Cangrejo')).toBe(true)
    expect(ciudadEsLugarDelNombre('Crab', 'Snorkel en Crab Cay')).toBe(true)
    expect(ciudadEsLugarDelNombre('Manzanillo', 'Manzanillo Bay boat tour')).toBe(true)
    expect(ciudadEsLugarDelNombre('la Piedra', 'Paseo a la Isla de la Piedra')).toBe(true)
    expect(ciudadEsLugarDelNombre('Tayrona', 'Caminata en el Parque Tayrona')).toBe(true)
    expect(ciudadEsLugarDelNombre('MANZANILLO', 'TOUR EN LANCHA POR LA BAHIA DE MANZANILLO')).toBe(true)
  })
  it('una ciudad de verdad se queda, aunque esté en el nombre o empiece por un accidente', () => {
    expect(ciudadEsLugarDelNombre('San Andrés', 'Tour por San Andrés')).toBe(false)
    expect(ciudadEsLugarDelNombre('Punta Cana', 'Buggies en Punta Cana')).toBe(false)
    expect(ciudadEsLugarDelNombre('Bahía Solano', 'Avistamiento de ballenas en Bahía Solano')).toBe(false)
    expect(ciudadEsLugarDelNombre('Providencia', 'Snorkel en Crab Cay')).toBe(false)
    expect(ciudadEsLugarDelNombre('San Andrés', 'Snorkel en el acuario')).toBe(false)
    expect(ciudadEsLugarDelNombre(null, 'Tour en lancha por la bahía de Manzanillo')).toBe(false)
    expect(ciudadEsLugarDelNombre('Manzanillo', null)).toBe(false)
  })
  it('no confunde palabras a medias: «Andrés» no es «San Andrés»', () => {
    expect(ciudadEsLugarDelNombre('Andrés', 'Isla San Andrés tour')).toBe(false)
  })
})

describe('capa 1 · el lector', () => {
  it('el prompt de la actividad pide la ciudad SOLO si se ve escrita como ciudad o destino', () => {
    const p = construirPrompt(ACTIVIDAD)
    const linea = p.split('\n').find(l => l.startsWith('- ciudad ('))!
    expect(linea).toContain('SOLO si la pantalla lo muestra escrito como ciudad o destino')
    expect(linea).toContain('bahía, playa, cayo, isla, parque')
    expect(linea).toContain('no la deduzcas del nombre de la actividad ni del viaje')
  })
})

describe('capa 2 · después de leer', () => {
  it('la lectura descarta «Ciudad: Manzanillo» y lo dice como dato que la captura no muestra', () => {
    const r = evaluarLectura(ACTIVIDAD, cruda('Tour en lancha por la bahía de Manzanillo', 'Manzanillo'), { soloMinimosDeCosto: true })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.campos.find(c => c.slug === 'ciudad')?.valor).toBeNull()
    expect(r.avisos.some(a => a.startsWith('La captura no muestra: ciudad.'))).toBe(true)
    // El costo no se toca.
    expect(r.campos.find(c => c.slug === 'precio_total')?.valor).toBe('300000')
  })

  it('criterio 2 · «Ciudad: San Andrés» que sí se ve se conserva', () => {
    const r = evaluarLectura(ACTIVIDAD, cruda('Tour en lancha por la bahía de Manzanillo', 'San Andrés'), { soloMinimosDeCosto: true })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.campos.find(c => c.slug === 'ciudad')?.valor).toBe('San Andrés')
  })

  it('hotel, vuelo y traslado no pasan por esta regla', () => {
    const hotel = ranuraPorSlug('hotel_detalle')!
    const r = evaluarLectura(hotel, {
      veredicto: 'detalle_unico', observacion: null, desglose: [],
      campos: {
        hotel: v('Hotel Bahía de Manzanillo'), ciudad: v('Manzanillo'), tipo_habitacion: v('Doble'),
        check_in: v('2026-11-09'), check_out: v('2026-11-13'), pax: v('2'), moneda: v('COP'),
        precio_total: v('900000'), base_precio: v('total'),
      },
    }, { soloMinimosDeCosto: true })
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.campos.find(c => c.slug === 'ciudad')?.valor).toBe('Manzanillo')
  })

  it('la lectura ya guardada con la ciudad inventada (COT-2026-0020) nombra el bloque con el viaje', () => {
    const l = guardada('Tour en lancha por la bahía de Manzanillo', 'Manzanillo')
    expect(ciudadDeActividad(l)).toBeNull()
    expect(lugarDeBloqueNuevo('actividad', l, 'Manzanillo')).toBeNull()
  })

  it('la ciudad corregida a mano manda siempre, aunque sea un lugar del nombre', () => {
    const l = guardada('Tour en lancha por la bahía de Manzanillo', 'Manzanillo')
    expect(ciudadDeActividad(l, [{ slug: 'ciudad', valor: 'Manzanillo' }])).toBe('Manzanillo')
  })
})
