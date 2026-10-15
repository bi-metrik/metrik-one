/**
 * H3 (verificación D de Vera, 2026-10-14) · la lancha de Cayo Cangrejo leída de verdad: «8
 * pasajeros · Total COP 720.000», sin separar adultos y menores, en un viaje de 6 adultos, 1 niño
 * y 1 infante.
 *
 * Con la lectura real quedaba «sin costo · Falta precio: niño, infante» y no había cómo cerrarlo
 * sin inventar otro pantallazo: el infante no paga en una actividad (decisión del 2026-10-01), y
 * aun así se pedía su precio.
 */
import { describe, expect, it } from 'vitest'

import { tiposSinPrecio } from './precio-que-falta'
import { preciosQueFaltan, resolverTarifa, type LecturaCasilla } from './tarifa-pasajero'

const VIAJE = { adultos: 6, ninos: 1, infantes: 1 }

/** «Providencia · 24 nov 2026 · 8 pasajeros · Total: COP 720.000» (pantallazo 09 de Vera). */
const LANCHA: LecturaCasilla = {
  moneda: 'COP', total: 720_000, aPagarAgencia: null, porTipo: [],
  ocupacion: { adultos: null, ninos: null, infantes: null, total: 8 }, ocupacionDelItem: false,
  identidad: { nombre: 'Tour Cayo Cangrejo · Lancha compartida', fecha: '2026-11-24' },
  notasCliente: [], alertas: [], campos: [], nombre: 'Tour Cayo Cangrejo · Lancha compartida', descripcion: '',
  leidaEn: '2026-10-14T15:00:00.000Z', paraComposicion: VIAJE,
}
const CASILLAS = { grupo_completo: LANCHA }
const LINEA = { grupo: 'actividad: Actividad en Providencia', tarifa_pax: { casillas: CASILLAS } }

describe('H3 · actividad de grupo con niño e infante', () => {
  it('lo que falta es el precio del niño; el del infante no se pide (no paga en una actividad)', () => {
    expect(preciosQueFaltan(VIAJE, CASILLAS, 'actividad_detalle')).toEqual(['nino'])
    expect(tiposSinPrecio(LINEA, VIAJE)).toEqual(['nino'])
  })

  it('con el niño escrito, el total del grupo es el costo: los adultos se llevan el resto y el infante 0', () => {
    const e = resolverTarifa(VIAJE, CASILLAS, 'actividad_detalle', { aMano: { nino: 90_000 } })
    expect(e.estado).toBe('resuelta')
    if (e.estado !== 'resuelta') return
    expect(e.costoTotal).toBe(720_000)
    expect(e.costos.map(c => [c.tipo, c.cantidad, c.total])).toEqual([['adulto', 6, 630_000], ['nino', 1, 90_000], ['infante', 1, 0]])
    expect(e.costos[2].deDonde).toBe('En una actividad el infante no paga')
    expect(tiposSinPrecio({ ...LINEA, tarifa_pax: { casillas: CASILLAS, costosAMano: { nino: { unitario: 90_000, por: null, porId: null, en: 'x' } } } }, VIAJE)).toEqual([])
  })

  it('si lo único que falta es el infante, se sigue pidiendo (se cierra con «No paga»)', () => {
    const conNino = { grupo_completo: { ...LANCHA, porTipo: [{ tipo: 'adulto' as const, cantidad: 6, subtotal: 630_000 }, { tipo: 'nino' as const, cantidad: 1, subtotal: 90_000 }] } }
    expect(preciosQueFaltan(VIAJE, conNino, 'actividad_detalle')).toEqual(['infante'])
  })

  it('un vuelo sigue pidiendo los dos: ahí el infante sí paga', () => {
    expect(preciosQueFaltan(VIAJE, CASILLAS, 'vuelo_detalle')).toEqual(['nino', 'infante'])
  })
})
