import { describe, expect, it } from 'vitest'

import { MOTIVO_SIN_LINEAS, notaDeMargen, type SalidaParaNota } from './nota-margen'

const BASE: SalidaParaNota = {
  aplica: true,
  bloquea: true,
  pisoPct: 5,
  excepcion: null,
  lineas: 3,
  lineasSinCosto: 0,
  bajoMinimo: [{ nombre: null, margenPct: 3.2 }],
}

describe('la nota del margen mínimo dice la causa real (P1 del ensayo del 2026-09-23)', () => {
  it('cotización vacía: sin nota, y el botón dice por qué no sale', () => {
    const n = notaDeMargen({ ...BASE, lineas: 0, bajoMinimo: [{ nombre: null, margenPct: null }] })
    expect(n).toEqual({ tipo: 'sin_lineas', motivoBoton: MOTIVO_SIN_LINEAS })
    expect(MOTIVO_SIN_LINEAS).toBe('Agrega al menos una línea con costo y precio')
  })

  it('líneas sin costo: aviso neutro con cuántas faltan, no la nota roja', () => {
    const n = notaDeMargen({ ...BASE, lineasSinCosto: 2, bajoMinimo: [{ nombre: null, margenPct: null }] })
    expect(n).toMatchObject({ tipo: 'faltan_costos', texto: 'Falta el costo de 2 líneas para calcular el margen.' })
  })

  it('una sola línea sin costo va en singular', () => {
    const n = notaDeMargen({ ...BASE, lineasSinCosto: 1, bajoMinimo: [{ nombre: null, margenPct: null }] })
    expect(n).toMatchObject({ texto: 'Falta el costo de 1 línea para calcular el margen.' })
  })

  it('margen medido bajo el mínimo: la nota roja con el margen real', () => {
    expect(notaDeMargen(BASE)).toMatchObject({ tipo: 'bajo_minimo', titulo: 'Margen 3,2 %, mínimo 5 %.' })
  })

  it('con tarifas, cada una con su nombre', () => {
    const n = notaDeMargen({ ...BASE, bajoMinimo: [{ nombre: 'Económica', margenPct: 3.2 }, { nombre: 'Premium', margenPct: 4.96 }] })
    // 4,96 se trunca: «5,0 % por debajo del mínimo de 5 %» se leería como un error.
    expect(n).toMatchObject({ titulo: 'Económica: margen 3,2 %, mínimo 5 % · Premium: margen 4,9 %, mínimo 5 %.' })
  })

  it('un margen medido gana sobre las líneas sin costo: es lo que de verdad frena', () => {
    expect(notaDeMargen({ ...BASE, lineasSinCosto: 1 }).tipo).toBe('bajo_minimo')
  })

  it('autorizada por el dueño: la nota verde de siempre', () => {
    expect(notaDeMargen({ ...BASE, bloquea: false, excepcion: {} }).tipo).toBe('autorizada')
  })

  it('en una línea sin la regla, o en el mínimo, no dice nada', () => {
    expect(notaDeMargen({ ...BASE, aplica: false }).tipo).toBe('nada')
    expect(notaDeMargen({ ...BASE, bloquea: false, bajoMinimo: [] }).tipo).toBe('nada')
    expect(notaDeMargen(null).tipo).toBe('nada')
  })

  it('una vista sin el conteo cae a la nota de siempre, no a «vacía»', () => {
    const vieja: SalidaParaNota = { aplica: true, bloquea: true, pisoPct: 5, excepcion: null }
    expect(notaDeMargen(vieja).tipo).toBe('bloquea')
  })
})

describe('una línea sin costo entra al total que sale (Mauricio, 2026-09-23)', () => {
  const FALTA = 'Falta el costo de Vuelo a Providencia · Opción 1: el cliente recibiría un precio sin ese servicio.'
  it('apaga Enviar con el motivo, aunque el margen se pueda medir y esté bien', () => {
    const nota = notaDeMargen({ ...BASE, bloquea: false, bajoMinimo: [], lineasSinCosto: 1, faltaCosto: FALTA })
    expect(nota).toEqual({ tipo: 'incompleta', texto: FALTA, motivoBoton: FALTA })
  })
  it('va antes que el margen bajo el mínimo y la firma del dueño no la levanta', () => {
    expect(notaDeMargen({ ...BASE, faltaCosto: FALTA }).tipo).toBe('incompleta')
    expect(notaDeMargen({ ...BASE, excepcion: {}, faltaCosto: FALTA }).tipo).toBe('incompleta')
  })
  it('sin línea sin costo en el total, el aviso neutro de siempre no apaga Enviar', () => {
    const nota = notaDeMargen({ ...BASE, bloquea: false, bajoMinimo: [], lineasSinCosto: 1, faltaCosto: null })
    expect(nota.tipo).toBe('faltan_costos')
    expect('motivoBoton' in nota ? nota.motivoBoton : null).toBeNull()
  })
})
