import { describe, expect, it } from 'vitest'

import fixture from './__fixtures__/cot-2026-0013-hoteles.fixture.json'
import { agregarHabitacion } from './habitaciones'
import type { Borrador } from './proceso-captura'
import { esIdDeBorrador, opcionDeBorrador, revisarBorrador } from './revisar-borrador'
import type { LecturaCasilla, TarifaPax } from './tarifa-pasajero'

const GRUPO = fixture.grupo
const lectura = (id: string) => fixture.hoteles.find(h => h.item === id)!.lectura as unknown as LecturaCasilla
const borrador = (id: string, lugar: string | null = 'Providencia'): Borrador => ({
  tipo: 'hotel',
  lectura: lectura(id),
  lecturaJson: '{}',
  firma: 'f',
  pistas: { lugar, origen: null, destino: null },
})
const linea = (id: string, grupo: string, ...lecturas: string[]) => {
  let tarifa: TarifaPax = { casillas: { grupo_completo: lectura(lecturas[0]) } }
  for (const l of lecturas.slice(1)) tarifa = agregarHabitacion(tarifa, { id: l, lectura: lectura(l) }, GRUPO)
  return { id, grupo, tarifa_pax: tarifa }
}
const UBIC = { h1: { bloque: 'Hotel en Providencia', opcion: 1 } }

function revisar(b: Borrador, lineas: ReturnType<typeof linea>[], comparables = lineas) {
  return revisarBorrador({ capId: 'c1', borrador: b, lineas, comparables, composicion: GRUPO, ubicaciones: UBIC, comparar: true })
}

describe('revisarBorrador · a dónde irá la captura (sin tocar Componentes)', () => {
  it('sin nada en la cotización: ranura nueva con el lugar que dijo el detector', () => {
    const r = revisar(borrador('2164b941'), [])
    expect(r.donde).toBe('Hotel en Providencia · nuevo')
    expect(r.pregunta).toBeUndefined()
    expect(esIdDeBorrador(r.leida.id)).toBe(true)
  })

  it('H1 · otro hotel con las mismas fechas: otra opción de la ranura que ya está', () => {
    const r = revisar(borrador('efb0a3c3', 'Isla de Providencia'), [linea('h1', 'hotel', '2164b941')])
    expect(r.donde).toMatch(/^Otra opción de /)
    expect(r.leida.grupo).toBe('hotel')
  })

  it('el mismo hotel: habitación de esa opción', () => {
    const r = revisar(borrador('68d431db'), [linea('h1', 'hotel', '2164b941')])
    expect(r.donde).toBe('Habitación de Opción 1 de Hotel en Providencia')
    expect(r.pregunta).toBeUndefined()
  })

  it('R8 regla 6 · el grupo ya cubierto: pregunta, con «como habitación»', () => {
    const r = revisar(borrador('2164b941'), [linea('h1', 'hotel', '2164b941', '68d431db', '7944d5cc')])
    expect(r.pregunta).toMatchObject({ fase: 'parecida', conItemId: 'h1', habitacion: true })
  })

})

const vueloLeido = (total: number) => ({
  moneda: 'COP', total, campos: [], alertas: [],
  identidad: { aerolinea: 'Satena', origen: 'ADZ', destino: 'PVA', fecha_salida: '2026-10-12', fecha_regreso: null },
}) as unknown as LecturaCasilla
const bVuelo = (total: number): Borrador => ({ tipo: 'vuelo', lectura: vueloLeido(total), lecturaJson: '{}', firma: 'f', pistas: { lugar: null, origen: 'ADZ', destino: 'PVA' } })

describe('revisarBorrador · el mismo servicio con otro precio (P10)', () => {
  const enPagina = { id: 'v1', grupo: 'vuelo', nombre: 'OPCIÓN 1', tarifa_pax: { casillas: { grupo_completo: vueloLeido(1_000_000) } } }

  it('contra una opción de Componentes: ofrece reemplazar su precio', () => {
    const r = revisarBorrador({
      capId: 'c1', borrador: bVuelo(1_250_000), lineas: [enPagina], comparables: [enPagina], composicion: GRUPO,
      ubicaciones: { v1: { bloque: 'Vuelo ADZ → PVA', opcion: 1 } }, comparar: true,
    })
    expect(r.pregunta).toMatchObject({ fase: 'otro_precio', conItemId: 'v1', corta: 'Opción 1' })
  })

  it('contra otra captura todavía en la bandeja: no pregunta (no hay qué reemplazar)', () => {
    const otra = opcionDeBorrador('c9', 'vuelo', vueloLeido(1_000_000))
    const r = revisarBorrador({ capId: 'c1', borrador: bVuelo(1_250_000), lineas: [], comparables: [otra], composicion: GRUPO, ubicaciones: {}, comparar: true })
    expect(r.pregunta).toBeUndefined()
  })

  it('mismo precio que otra captura de la bandeja: parece igual', () => {
    const otra = opcionDeBorrador('c9', 'vuelo', vueloLeido(1_250_000))
    const r = revisarBorrador({ capId: 'c1', borrador: bVuelo(1_250_000), lineas: [], comparables: [otra], composicion: GRUPO, ubicaciones: {}, comparar: true })
    expect(r.pregunta).toMatchObject({ fase: 'parecida', donde: 'otra captura de esta bandeja' })
  })

  it('pedida «procesar igual»: no compara', () => {
    const otra = opcionDeBorrador('c9', 'vuelo', vueloLeido(1_250_000))
    const r = revisarBorrador({ capId: 'c1', borrador: bVuelo(1_250_000), lineas: [], comparables: [otra], composicion: GRUPO, ubicaciones: {}, comparar: false })
    expect(r.pregunta).toBeUndefined()
  })
})
