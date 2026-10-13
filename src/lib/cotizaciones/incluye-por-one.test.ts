import { describe, expect, it } from 'vitest'

import { incluyeConPropias, incluyeDeOne, lineasPropias, lineasQueSeCobran, MAX_RENGLONES_INCLUYE } from './incluye-por-one'
import { LINEAS_CASO_FIJO, TARIFAS_CASO_FIJO } from '../../../test/caso-san-andres'

/** C6 · D6 · «Incluye» armado por ONE, sin base: qué renglones salen y con cuánto detalle. */

const lineas = LINEAS_CASO_FIJO.map(l => structuredClone(l.item)) as never[]
const tarifas = TARIFAS_CASO_FIJO.map(t => ({ id: t.fila.id as string, nombre: t.fila.nombre as string, orden: t.fila.orden as number, vaEnPropuesta: t.fila.va_en_propuesta as boolean, seleccion: t.seleccion }))

describe('lo que se cobra en la Recomendada', () => {
  it('las 8 de la Recomendada: sin Lord Pierre, Agua Dulce ni la lancha privada', () => {
    const ids = lineasQueSeCobran(lineas, tarifas).map(l => (l as { id: string }).id)
    expect(ids.sort()).toEqual(['a-buceo', 'a-cayo-compartida', 'h-posada', 'h-verde-mar', 't-providencia', 't-san-andres', 'v-avianca', 'v-satena'].sort())
  })

  it('un servicio Opcional o que no va no se cobra', () => {
    const conOpcional = lineas.map(l => ((l as { id: string }).id === 't-providencia' ? { ...(l as object), entra_al_precio: false, mostrar_en_sugeridos: true } : l)) as never[]
    expect(lineasQueSeCobran(conOpcional, tarifas).map(l => (l as { id: string }).id)).not.toContain('t-providencia')
  })

  it('sin tarifas, lo que aporta al total', () => {
    expect(lineasQueSeCobran(lineas, []).length).toBeGreaterThanOrEqual(8)
  })
})

describe('los renglones', () => {
  const cobradas = () => lineasQueSeCobran(lineas, tarifas)

  it('uno por servicio, sin cifras, con el nivel de detalle', () => {
    const normal = incluyeDeOne(cobradas(), 'normal')
    expect(normal).toHaveLength(8)
    expect(normal.some(r => /\d{3}\.\d{3}|\$/.test(r))).toBe(false)
    expect(normal.find(r => r.startsWith('Tiquetes aéreos Bogotá'))).toMatch(/con Avianca, .*equipaje/)
    expect(normal.find(r => /Posada Enilda/.test(r))).toBe('2 noches en Posada Enilda (Providencia), con alojamiento y desayuno')
    const general = incluyeDeOne(cobradas(), 'general')
    expect(general.find(r => r.startsWith('Tiquetes aéreos Bogotá'))).not.toMatch(/equipaje/)
    expect(general.find(r => /Posada Enilda/.test(r))).toBe('2 noches en Posada Enilda')
  })

  it('las líneas propias van debajo, sin repetir las de ONE; con tope', () => {
    const deOne = incluyeDeOne(cobradas(), 'normal')
    const propias = lineasPropias([deOne[0], ' Tarjeta de turismo ', 'tarjeta de turismo', ''], deOne)
    expect(propias).toEqual(['Tarjeta de turismo'])
    const todo = incluyeConPropias(deOne, propias)
    expect(todo.at(-1)).toBe('Tarjeta de turismo')
    expect(incluyeConPropias(deOne, Array.from({ length: 20 }, (_, i) => `Propia ${i}`))).toHaveLength(MAX_RENGLONES_INCLUYE)
  })

  it('un componente suelto (asistencia médica) entra con su nombre en frase', () => {
    const asistencia = { id: 'x-asistencia', grupo: null, nombre: 'ASISTENCIA MÉDICA INTERNACIONAL', es_ajuste: false, entra_al_precio: true }
    expect(incluyeDeOne([asistencia] as never[], 'normal')).toEqual(['Asistencia médica internacional'])
  })
})
