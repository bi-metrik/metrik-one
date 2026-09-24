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
