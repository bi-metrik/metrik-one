/**
 * El recorrido de una captura de la bandeja (H2, prueba del 2026-09-24): mirar y leer NO
 * escriben nada. Las dependencias no tienen cómo crear ni borrar: si una prueba necesitara
 * limpiar algo, el diseño estaría mal.
 */
import { describe, expect, it } from 'vitest'

import {
  leerCaptura,
  procesarCaptura,
  type Borrador,
  type CambioDeCaptura,
  type DependenciasDeProceso,
  type Deteccion,
  type LecturaDeBorrador,
  type Revision,
} from './proceso-captura'
import type { LecturaCasilla } from './tarifa-pasajero'

const LECTURA = { nombre: 'Hotel Posada', campos: [], alertas: [] } as unknown as LecturaCasilla
const LEIDA = { id: 'borrador:c', nombre: 'Hotel Posada', grupo: 'hotel', tarifa_pax: null, tramos: null, cargo_destino_valor: null, cargo_destino_moneda: null }

function montar(opts: {
  deteccion?: Deteccion | Error
  lecturas?: (LecturaDeBorrador | Error)[]
  revision?: (b: Borrador) => Revision
} = {}) {
  const cambios: CambioDeCaptura[] = []
  const leidas: { tipo: string; enfoque: unknown }[] = []
  let vigente = true
  let n = 0
  const deps: DependenciasDeProceso = {
    detectar: async () => {
      const d = opts.deteccion ?? { ok: true, tipo: 'hotel', lugar: 'Providencia', origen: null, destino: null }
      if (d instanceof Error) throw d
      return d
    },
    leer: async (tipo, enfoque) => {
      leidas.push({ tipo, enfoque })
      const l = opts.lecturas?.[n++] ?? { ok: true, lectura: LECTURA, lecturaJson: '{"x":1}', firma: 'f', alertas: ['ojo'] }
      if (l instanceof Error) throw l
      return l
    },
    revisar: opts.revision ?? (() => ({ leida: LEIDA, donde: 'Hotel en Providencia · nuevo' })),
    vigente: () => vigente,
    informar: c => cambios.push(c),
  }
  return { deps, cambios, leidas, quitar: () => { vigente = false } }
}

const ultimo = (cs: CambioDeCaptura[]) => cs[cs.length - 1]

describe('procesarCaptura', () => {
  it('mira, lee y deja el borrador listo con a dónde irá', async () => {
    const m = montar()
    await procesarCaptura(m.deps)
    expect(m.cambios.map(c => c.estado?.fase).filter(Boolean)).toEqual(['mirando', 'leyendo', 'lista'])
    const fin = ultimo(m.cambios)
    expect(fin.borrador).toMatchObject({ tipo: 'hotel', lecturaJson: '{"x":1}', firma: 'f', pistas: { lugar: 'Providencia' } })
    expect(fin.donde).toBe('Hotel en Providencia · nuevo')
    expect(fin.estado).toEqual({ fase: 'lista', alertas: ['ojo'] })
    expect(m.cambios.some(c => c.tipo === 'hotel' && c.pistas?.lugar === 'Providencia')).toBe(true)
  })

  it('sin tipo reconocible pregunta qué es, abierta', async () => {
    const m = montar({ deteccion: { ok: false, codigo: 'SIN_TIPO', mensaje: 'No sé qué es' } })
    await procesarCaptura(m.deps)
    expect(ultimo(m.cambios)).toEqual({ estado: { fase: 'eligiendo_tipo', motivo: 'No sé qué es' }, abierta: true })
    expect(m.leidas).toHaveLength(0)
  })

  it('con el tipo elegido no vuelve a mirar', async () => {
    const m = montar({ deteccion: new Error('no debería mirar') })
    await procesarCaptura(m.deps, 'vuelo')
    expect(m.leidas).toEqual([{ tipo: 'vuelo', enfoque: null }])
    expect(ultimo(m.cambios).estado?.fase).toBe('lista')
  })

  it('una lectura caída no deja la fila en «Leyendo…»', async () => {
    const m = montar({ lecturas: [new Error('timeout')] })
    await procesarCaptura(m.deps)
    expect(ultimo(m.cambios).estado).toMatchObject({ fase: 'rechazada' })
    expect(ultimo(m.cambios).borrador).toBeNull()
  })

  it('varias opciones en el pantallazo: pregunta cuál, sin borrador', async () => {
    const m = montar({ lecturas: [{ ok: false, mensaje: '¿Cuál?', opciones: [{ nombre: 'A', precio: null }] }] })
    await procesarCaptura(m.deps)
    expect(ultimo(m.cambios)).toEqual({ estado: { fase: 'eligiendo_opcion', mensaje: '¿Cuál?', opciones: [{ nombre: 'A', precio: null }] }, abierta: true })
  })

  it('parecida a algo que ya estaba: pregunta, abierta, con el borrador guardado', async () => {
    const m = montar({ revision: () => ({ leida: LEIDA, donde: 'x', pregunta: { fase: 'parecida', conItemId: 'i1', donde: 'Opción 1 de Hotel' } }) })
    await procesarCaptura(m.deps)
    const fin = ultimo(m.cambios)
    expect(fin.estado).toEqual({ fase: 'parecida', conItemId: 'i1', donde: 'Opción 1 de Hotel', alertas: ['ojo'] })
    expect(fin.abierta).toBe(true)
    expect(fin.borrador).not.toBeNull()
  })

  it('quitada mientras se lee (P11): lo que llega se descarta, sin informar nada', async () => {
    const m = montar()
    const original = m.deps.leer
    m.deps.leer = async (t, e) => { m.quitar(); return original(t, e) }
    await procesarCaptura(m.deps)
    expect(m.cambios.some(c => c.estado?.fase === 'lista')).toBe(false)
    expect(m.cambios.some(c => c.borrador)).toBe(false)
  })
})

describe('leerCaptura (segunda pasada, «¿Cuál de estas?»)', () => {
  it('lee con el enfoque y el tipo y lugar que ya se sabían', async () => {
    const m = montar()
    await leerCaptura(m.deps, 'hotel', { lugar: 'San Andrés', origen: null, destino: null }, { nombre: 'Doble', precio: '$1' })
    expect(m.leidas).toEqual([{ tipo: 'hotel', enfoque: { nombre: 'Doble', precio: '$1' } }])
    expect(ultimo(m.cambios).borrador?.pistas.lugar).toBe('San Andrés')
  })

  it('con enfoque, una lectura que vuelve a ofrecer opciones se rechaza (no pregunta dos veces)', async () => {
    const m = montar({ lecturas: [{ ok: false, mensaje: 'no', opciones: [{ nombre: 'A', precio: null }] }] })
    await leerCaptura(m.deps, 'hotel', { lugar: null, origen: null, destino: null }, { nombre: 'A', precio: null })
    expect(ultimo(m.cambios).estado?.fase).toBe('rechazada')
  })
})
