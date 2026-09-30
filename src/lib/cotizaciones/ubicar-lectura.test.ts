import { describe, expect, it } from 'vitest'

import fixture from './__fixtures__/cot-2026-0013-hoteles.fixture.json'
import { agregarHabitacion, habitacionesDeTarifa } from './habitaciones'
import { leerTarifaPax, type LecturaCasilla, type TarifaPax } from './tarifa-pasajero'
import { lugaresCompatibles, ubicarLectura, type LineaParaUbicar } from './ubicar-lectura'

const GRUPO = fixture.grupo
const lectura = (id: string) => fixture.hoteles.find(h => h.item === id)!.lectura as unknown as LecturaCasilla
const SIN_PISTAS = { lugar: null, origen: null, destino: null }

/**
 * Lo que hace «Aceptar» en el servidor, en memoria: ubica la lectura contra lo que la
 * cotización tiene en ese momento y la escribe donde tocó.
 */
function aceptarEnOrden(ids: string[], pistas: (id: string) => { lugar: string | null; origen: null; destino: null } = () => SIN_PISTAS) {
  let lineas: (LineaParaUbicar & { tarifa_pax: TarifaPax })[] = []
  let ranuras = 0
  const sobrantes: string[] = []
  for (const id of ids) {
    const l = lectura(id)
    const d = ubicarLectura({ tipo: 'hotel', lectura: l, pistas: pistas(id), lineas, grupoViaje: GRUPO })
    if (d.como === 'habitacion') {
      if (d.sobra) { sobrantes.push(id); continue }
      lineas = lineas.map(x => (x.id === d.itemId ? { ...x, tarifa_pax: agregarHabitacion(x.tarifa_pax, { id, lectura: l }, GRUPO) } : x))
    } else if (d.como === 'hermana') {
      lineas = [...lineas, { id, grupo: d.grupo, tarifa_pax: { casillas: { grupo_completo: l } } }]
    } else {
      ranuras++
      lineas = [...lineas, { id, grupo: ranuras === 1 ? 'hotel' : `hotel ${ranuras}`, tarifa_pax: { casillas: { grupo_completo: l } } }]
    }
  }
  return { lineas, ranuras, sobrantes }
}

describe('H1 · dos hoteles con las mismas fechas van en UN bloque, una opción por hotel', () => {
  it('las seis capturas de COT-2026-0013, mezcladas: 1 ranura, 2 opciones de 3 habitaciones', () => {
    const { lineas, ranuras, sobrantes } = aceptarEnOrden(['2164b941', 'efb0a3c3', '68d431db', 'f9fbc4d5', '7944d5cc', '5542356a'])
    expect(ranuras).toBe(1)
    expect(sobrantes).toEqual([])
    expect(lineas).toHaveLength(2)
    expect(lineas.map(l => l.grupo)).toEqual(['hotel', 'hotel'])
    expect(lineas.map(l => habitacionesDeTarifa(leerTarifaPax(l.tarifa_pax)).length)).toEqual([3, 3])
  })

  it('aunque el detector nombre la ciudad distinto en cada captura («Providencia» / «Isla de Providencia»)', () => {
    const lugar = (id: string) => ({ lugar: ['efb0a3c3', 'f9fbc4d5', '5542356a'].includes(id) ? 'Isla de Providencia' : 'Providencia', origen: null, destino: null })
    const { ranuras } = aceptarEnOrden(['2164b941', 'efb0a3c3', '68d431db', 'f9fbc4d5', '7944d5cc', '5542356a'], lugar)
    expect(ranuras).toBe(1)
  })

  it('otras fechas en la misma ciudad: otra ranura', () => {
    const otras = { ...lectura('efb0a3c3'), identidad: { ...lectura('efb0a3c3').identidad, check_in: '2026-11-25', check_out: '2026-11-27' } }
    const lineas = [{ id: 'a', grupo: 'hotel', tarifa_pax: { casillas: { grupo_completo: lectura('2164b941') } } }]
    expect(ubicarLectura({ tipo: 'hotel', lectura: otras, pistas: SIN_PISTAS, lineas, grupoViaje: GRUPO })).toEqual({ como: 'nueva' })
  })

  it('una séptima captura con el grupo cubierto se marca como sobrante (regla 6), no se suma sola', () => {
    const { lineas } = aceptarEnOrden(['2164b941', '68d431db', '7944d5cc'])
    const otra = { ...lectura('2164b941'), huellaImagen: 'otra' }
    const d = ubicarLectura({ tipo: 'hotel', lectura: otra, pistas: SIN_PISTAS, lineas, grupoViaje: GRUPO })
    expect(d).toMatchObject({ como: 'habitacion', sobra: true })
    // «Agregar como otra opción»: nunca como habitación.
    expect(ubicarLectura({ tipo: 'hotel', lectura: otra, pistas: SIN_PISTAS, lineas, grupoViaje: GRUPO, sinHabitacion: true })).toEqual({ como: 'hermana', grupo: 'hotel' })
  })

  it('sin nada en la cotización, nace la ranura', () => {
    expect(ubicarLectura({ tipo: 'hotel', lectura: lectura('2164b941'), pistas: SIN_PISTAS, lineas: [], grupoViaje: GRUPO })).toEqual({ como: 'nueva' })
  })
})

describe('lugares compatibles', () => {
  it('uno contiene al otro palabra por palabra', () => {
    expect(lugaresCompatibles('Providencia', 'Isla de Providencia')).toBe(true)
    expect(lugaresCompatibles('Providencia Island', 'Providencia')).toBe(true)
    expect(lugaresCompatibles('San Andrés', 'Providencia')).toBe(false)
    expect(lugaresCompatibles(null, 'Providencia')).toBeNull()
    // «Andres» no es «San Andrés»: se compara por palabras enteras, no por pedazos.
    expect(lugaresCompatibles('Cartagena', 'Cartago')).toBe(false)
  })
})

// ── COT-2026-0018 (brief del 2026-09-30) ──────────────────────────────────────

const conIdentidad = (id: string, cambios: Record<string, string | null>, extra: Partial<LecturaCasilla> = {}): LecturaCasilla =>
  ({ ...lectura(id), ...extra, identidad: { ...lectura(id).identidad, ...cambios } })

describe('COT-2026-0018 · «Hotel Cabañas Agua Dulce» es el mismo hotel que «Cabañas Agua Dulce»', () => {
  it('la tercera captura, con «Hotel» delante, entra como habitación y no como opción aparte', () => {
    const { lineas } = aceptarEnOrden(['efb0a3c3', '5542356a'])
    expect(lineas).toHaveLength(1)
    const cuadruple = conIdentidad('efb0a3c3', { hotel: 'Hotel Cabañas Agua Dulce', tipo_habitacion: 'Cuádruple' }, { huellaImagen: 'cuadruple' })
    const d = ubicarLectura({ tipo: 'hotel', lectura: cuadruple, pistas: SIN_PISTAS, lineas, grupoViaje: GRUPO })
    expect(d).toMatchObject({ como: 'habitacion', itemId: 'efb0a3c3' })
  })

  it('otro hotel con las mismas fechas sigue siendo otra opción del bloque', () => {
    const { lineas } = aceptarEnOrden(['efb0a3c3'])
    const otro = conIdentidad('efb0a3c3', { hotel: 'Hotel Posada Enilda' })
    expect(ubicarLectura({ tipo: 'hotel', lectura: otro, pistas: SIN_PISTAS, lineas, grupoViaje: GRUPO })).toEqual({ como: 'hermana', grupo: 'hotel' })
  })
})

describe('COT-2026-0018 · la fecha corregida en la ficha es la que ubica (Lord Pierre)', () => {
  const CORREGIDA = { check_in: { valor: '2026-11-25', por: 'Alejandra', porId: 'p1', en: '2026-09-29T20:00:00Z' } }
  // La habitación 1 se escribió con entrada el 25 de OCTUBRE; la ficha la corrigió a noviembre.
  const hab1 = conIdentidad('efb0a3c3', { hotel: 'Hotel Lord Pierre', check_in: '2026-10-25', check_out: '2026-11-28' }, { huellaImagen: 'lp-1' })
  const hab2 = conIdentidad('5542356a', { hotel: 'Hotel Lord Pierre', check_in: '2026-11-25', check_out: '2026-11-28' }, { huellaImagen: 'lp-2' })

  it('con la corrección, la habitación 2 cae como habitación de la opción corregida', () => {
    const lineas = [{ id: 'lp', grupo: 'hotel', tarifa_pax: { casillas: { grupo_completo: hab1 }, correcciones: CORREGIDA } }]
    expect(ubicarLectura({ tipo: 'hotel', lectura: hab2, pistas: SIN_PISTAS, lineas, grupoViaje: GRUPO })).toMatchObject({ como: 'habitacion', itemId: 'lp' })
  })

  it('sin la corrección (lo que pasaba): otras fechas, otra ranura', () => {
    const lineas = [{ id: 'lp', grupo: 'hotel', tarifa_pax: { casillas: { grupo_completo: hab1 } } }]
    expect(ubicarLectura({ tipo: 'hotel', lectura: hab2, pistas: SIN_PISTAS, lineas, grupoViaje: GRUPO })).toEqual({ como: 'nueva' })
  })

  it('otro hotel con las fechas corregidas va al mismo bloque, como otra opción', () => {
    const lineas = [{ id: 'lp', grupo: 'hotel', tarifa_pax: { casillas: { grupo_completo: hab1 }, correcciones: CORREGIDA } }]
    const otro = conIdentidad('2164b941', { check_in: '2026-11-25', check_out: '2026-11-28' })
    expect(ubicarLectura({ tipo: 'hotel', lectura: otro, pistas: SIN_PISTAS, lineas, grupoViaje: GRUPO })).toEqual({ como: 'hermana', grupo: 'hotel' })
  })

  it('si la corrección deja dos opciones con la misma clave, no se fusionan: la captura siguiente cae en una', () => {
    const lineas = [
      { id: 'lp', grupo: 'hotel', tarifa_pax: { casillas: { grupo_completo: hab1 }, correcciones: CORREGIDA } },
      { id: 'lp-2', grupo: 'hotel 2', tarifa_pax: { casillas: { grupo_completo: hab2 } } },
    ]
    const hab3 = conIdentidad('f9fbc4d5', { hotel: 'Hotel Lord Pierre', check_in: '2026-11-25', check_out: '2026-11-28' }, { huellaImagen: 'lp-3' })
    const d = ubicarLectura({ tipo: 'hotel', lectura: hab3, pistas: SIN_PISTAS, lineas, grupoViaje: GRUPO })
    // Empatadas en habitaciones: la primera de la cotización. Las dos siguen donde estaban.
    expect(d).toMatchObject({ como: 'habitacion', itemId: 'lp' })
    expect(lineas).toHaveLength(2)
  })
})
