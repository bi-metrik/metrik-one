/** P11 del caso Providencia: la × también vale mientras se analiza (Mauricio, 2026-09-23). */
import { describe, expect, it } from 'vitest'

import {
  leerCaptura,
  procesarCaptura,
  type CambioDeCaptura,
  type Deteccion,
  type DependenciasDeProceso,
  type Lectura,
} from './proceso-captura'
import type { Ubicada } from './ubicador-capturas'

/** Una promesa que se resuelve cuando la prueba lo decide: así se quita la captura «en vuelo». */
function diferida<T>() {
  let resolver!: (v: T) => void
  const promesa = new Promise<T>(r => { resolver = r })
  return { promesa, resolver }
}

const DETECTADA: Deteccion = { ok: true, tipo: 'vuelo', lugar: null, origen: 'ADZ', destino: 'PVA', ranuras: [] }
const UBICADA: Ubicada = { ok: true, itemId: 'item-1', grupo: 'g1', como: 'nueva', etiqueta: 'Vuelo a Providencia' }
const LEIDA: Lectura = {
  ok: true,
  alertas: [],
  opcion: { id: 'item-1', nombre: 'Satena', grupo: 'g1', tarifa_pax: null, tramos: null, cargo_destino_valor: null, cargo_destino_moneda: null },
}

function armar(opciones: {
  detectar?: () => Promise<Deteccion>
  ubicar?: () => Promise<Ubicada>
  leer?: () => Promise<Lectura>
} = {}) {
  let vigente = true
  const informados: CambioDeCaptura[] = []
  const descartados: string[] = []
  const creados: string[] = []
  let refrescos = 0
  const deps: DependenciasDeProceso = {
    detectar: opciones.detectar ?? (async () => DETECTADA),
    ubicar: async () => {
      const u = await (opciones.ubicar ?? (async () => UBICADA))()
      if (u.ok) creados.push(u.itemId)
      return u
    },
    leer: opciones.leer ?? (async () => LEIDA),
    descartar: async itemId => { descartados.push(itemId); return true },
    vigente: () => vigente,
    informar: c => { informados.push(c) },
    refrescar: () => { refrescos++ },
  }
  return {
    deps,
    quitar: () => { vigente = false },
    informados,
    descartados,
    creados,
    refrescos: () => refrescos,
    fases: () => informados.flatMap(c => (c.estado ? [c.estado.fase] : [])),
  }
}

describe('sin quitar nada, el recorrido de siempre', () => {
  it('mira, ubica, lee y queda lista', async () => {
    const t = armar()
    await procesarCaptura(t.deps)
    expect(t.fases()).toEqual(['mirando', 'ubicando', 'leyendo', 'lista'])
    expect(t.descartados).toEqual([])
    expect(t.informados).toContainEqual(expect.objectContaining({ itemId: 'item-1', donde: 'Vuelo a Providencia · nuevo' }))
  })

  it('una lectura que no sirve se lleva su opción vacía', async () => {
    const t = armar({ leer: async () => ({ ok: false, mensaje: 'No es un vuelo' }) })
    await procesarCaptura(t.deps)
    expect(t.descartados).toEqual(['item-1'])
    expect(t.fases().at(-1)).toBe('rechazada')
  })
})

describe('el pantallazo repetido (P10)', () => {
  it('parecida a una que ya estaba: la fila pregunta, abierta, y la opción nueva NO se borra sola', async () => {
    const t = armar()
    t.deps.comparar = () => ({ fase: 'parecida', conItemId: 'item-0', donde: 'Opción 1 de Vuelo 1' })
    await procesarCaptura(t.deps)
    const ultimo = t.informados.at(-1)!
    expect(ultimo.estado).toEqual({ fase: 'parecida', conItemId: 'item-0', donde: 'Opción 1 de Vuelo 1', alertas: [] })
    expect(ultimo.abierta).toBe(true)
    expect(ultimo.leida?.id).toBe('item-1')
    expect(t.descartados).toEqual([])
  })

  it('mismo servicio con otro precio: se ofrece reemplazar', async () => {
    const t = armar()
    t.deps.comparar = () => ({ fase: 'otro_precio', conItemId: 'item-0', donde: 'Opción 1 de Vuelo 1', corta: 'Opción 1' })
    await procesarCaptura(t.deps)
    expect(t.fases().at(-1)).toBe('otro_precio')
  })

  it('sin parecido (o sin comparar), queda lista como siempre', async () => {
    const t = armar()
    t.deps.comparar = () => null
    await procesarCaptura(t.deps)
    expect(t.fases().at(-1)).toBe('lista')
    expect(t.informados.at(-1)!.abierta).toBeUndefined()
  })
})

describe('la × mientras se analiza (P11)', () => {
  it('quitada mientras se lee: la opción que nació para ella se borra y la fila no se toca más', async () => {
    const lectura = diferida<Lectura>()
    const t = armar({ leer: () => lectura.promesa })
    const vuelo = procesarCaptura(t.deps)
    await new Promise(r => setTimeout(r, 0))
    expect(t.fases().at(-1)).toBe('leyendo')

    t.quitar()
    const informadosAlQuitar = t.informados.length
    lectura.resolver(LEIDA)
    await vuelo

    expect(t.descartados).toEqual(['item-1'])
    // Ni «lista» ni nada: pintar la fila la resucitaría.
    expect(t.informados.length).toBe(informadosAlQuitar)
    expect(t.refrescos()).toBe(1)
  })

  it('quitada mientras se ubica: la opción que alcanzó a crearse también se borra', async () => {
    const ubicacion = diferida<Ubicada>()
    let leyo = false
    const t = armar({ ubicar: () => ubicacion.promesa, leer: async () => { leyo = true; return LEIDA } })
    const vuelo = procesarCaptura(t.deps)
    await new Promise(r => setTimeout(r, 0))
    expect(t.fases().at(-1)).toBe('ubicando')

    t.quitar()
    ubicacion.resolver(UBICADA)
    await vuelo

    expect(t.creados).toEqual(['item-1'])
    expect(t.descartados).toEqual(['item-1'])
    expect(leyo).toBe(false)
    // No se anunció dónde quedó: esa opción ya no existe.
    expect(t.informados.some(c => c.itemId === 'item-1')).toBe(false)
  })

  it('quitada mientras se mira qué es: no se crea nada', async () => {
    const deteccion = diferida<Deteccion>()
    const t = armar({ detectar: () => deteccion.promesa })
    const vuelo = procesarCaptura(t.deps)
    t.quitar()
    deteccion.resolver(DETECTADA)
    await vuelo

    expect(t.creados).toEqual([])
    expect(t.descartados).toEqual([])
    expect(t.fases()).toEqual(['mirando'])
  })

  it('quitada en la segunda lectura (después de elegir cuál de las opciones): la opción se va', async () => {
    const lectura = diferida<Lectura>()
    const t = armar({ leer: () => lectura.promesa })
    const vuelo = leerCaptura(t.deps, 'item-7', { nombre: 'Satena', precio: '$ 820.000' })
    t.quitar()
    lectura.resolver({ ok: false, mensaje: 'No coincide' })
    await vuelo

    expect(t.descartados).toEqual(['item-7'])
    expect(t.fases()).toEqual(['leyendo'])
  })

  it('una lectura caída después de quitarla no deja error en la fila', async () => {
    const t = armar({ leer: async () => { t.quitar(); throw new Error('timeout') } })
    await procesarCaptura(t.deps)
    expect(t.descartados).toEqual(['item-1'])
    expect(t.informados.some(c => c.estado?.fase === 'rechazada')).toBe(false)
  })
})

describe('R8 · una captura de hotel del mismo hotel y fechas es una habitación', () => {
  const OPCION_DESTINO = { id: 'item-0', nombre: 'CABAÑAS AGUA DULCE', grupo: 'g1', tarifa_pax: null, tramos: null, cargo_destino_valor: null, cargo_destino_moneda: null }

  it('unida: la fila pasa a apuntar a la opción destino y a su habitación, sin descartar nada', async () => {
    const t = armar()
    t.deps.unir = async () => ({ tipo: 'unida', itemId: 'item-0', habitacionId: 'hab-2', donde: 'Habitación 2 de CABAÑAS AGUA DULCE', opcion: OPCION_DESTINO })
    t.deps.comparar = () => { throw new Error('una habitación unida no se compara') }
    await procesarCaptura(t.deps)
    const ultimo = t.informados.at(-1)!
    expect(ultimo.estado?.fase).toBe('lista')
    expect(ultimo.itemId).toBe('item-0')
    expect(ultimo.habitacionId).toBe('hab-2')
    expect(ultimo.donde).toBe('Habitación 2 de CABAÑAS AGUA DULCE')
    expect(ultimo.leida?.id).toBe('item-0')
    // La opción propia la retira el servidor al unir: la bandeja no la vuelve a borrar.
    expect(t.descartados).toEqual([])
  })

  it('sobra (grupo ya cubierto): pregunta como «parecida», con la marca de habitación', async () => {
    const t = armar()
    t.deps.unir = async () => ({ tipo: 'sobra', conItemId: 'item-0', donde: 'Opción 1 de Hotel 1' })
    await procesarCaptura(t.deps)
    const ultimo = t.informados.at(-1)!
    expect(ultimo.estado).toEqual({ fase: 'parecida', conItemId: 'item-0', donde: 'Opción 1 de Hotel 1', alertas: [], habitacion: true })
    expect(ultimo.abierta).toBe(true)
    expect(t.descartados).toEqual([])
  })

  it('sola (u otro servicio): sigue al camino de siempre', async () => {
    const t = armar()
    t.deps.unir = async () => ({ tipo: 'sola' })
    t.deps.comparar = () => null
    await procesarCaptura(t.deps)
    expect(t.fases().at(-1)).toBe('lista')
    expect(t.informados.at(-1)!.habitacionId).toBeUndefined()
  })

  it('si unir falla, la captura se queda en su opción: no se pierde', async () => {
    const t = armar()
    t.deps.unir = async () => { throw new Error('red') }
    await procesarCaptura(t.deps)
    expect(t.fases().at(-1)).toBe('lista')
    expect(t.descartados).toEqual([])
  })

  it('quitada mientras se unía: se quita SOLO la habitación que dejó, no la opción destino', async () => {
    const union = diferida<{ tipo: 'unida'; itemId: string; habitacionId: string; donde: string; opcion: null }>()
    const t = armar()
    const quitadas: string[] = []
    t.deps.unir = () => union.promesa
    t.deps.quitarHabitacion = async (itemId, habitacionId) => { quitadas.push(`${itemId}/${habitacionId}`); return true }
    const pasada = procesarCaptura(t.deps)
    await new Promise(r => setTimeout(r, 0))
    t.quitar()
    union.resolver({ tipo: 'unida', itemId: 'item-0', habitacionId: 'hab-2', donde: 'x', opcion: null })
    await pasada
    expect(quitadas).toEqual(['item-0/hab-2'])
    expect(t.descartados).toEqual([])
  })
})
