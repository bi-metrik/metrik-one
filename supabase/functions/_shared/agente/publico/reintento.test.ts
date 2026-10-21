import { describe, expect, it } from 'vitest'
import { turnoConReintento } from './reintento'
import type { SalidaTurno } from '../nucleo'

/** El reintento con aviso (§4.1) con tiempos reales cortos. */

const bien = (t: string): SalidaTurno => ({ salida: { tipo: 'texto', texto: t }, traza: { tipo: 'modelo', bot: 'b' } })
const mal = (motivo: string): SalidaTurno => ({ salida: { tipo: 'texto', texto: 'no pude' }, traza: { tipo: 'modelo', bot: 'b', error: `modelo: ${motivo}` } })
const tras = <T>(ms: number, v: T) => new Promise<T>((r) => setTimeout(() => r(v), ms))
const base = { corte1Ms: 60, corteTotalMs: 400, reloj: () => performance.now() }

describe('turnoConReintento', () => {
  it('rápido: sin aviso, un intento', async () => {
    let avisos = 0
    const r = await turnoConReintento({ ...base, avisar: async () => { avisos++ }, intentar: async () => bien('hola') })
    expect(r.desenlace).toMatchObject({ tipo: 'respuesta', ganador: 1 })
    expect(avisos).toBe(0)
    expect(r.intentos).toHaveLength(1)
  })
  it('lento: aviso una vez y gana el primero que termine (el 2)', async () => {
    let avisos = 0
    const r = await turnoConReintento({ ...base, avisar: async () => { avisos++ }, intentar: (n) => (n === 1 ? tras(300, bien('uno')) : tras(20, bien('dos'))) })
    expect(r.desenlace).toMatchObject({ tipo: 'respuesta', ganador: 2 })
    expect((r.desenlace as { r: SalidaTurno }).r.salida?.texto).toBe('dos')
    expect(avisos).toBe(1)
    expect(r.demora).toBe(true)
  })
  it('lento pero el 1 termina antes que el 2: gana el 1 (no se pierde)', async () => {
    const r = await turnoConReintento({ ...base, avisar: async () => {}, intentar: (n) => (n === 1 ? tras(90, bien('uno')) : tras(250, bien('dos'))) })
    expect(r.desenlace).toMatchObject({ tipo: 'respuesta', ganador: 1 })
  })
  it('error: un reintento inmediato; si vuelve a fallar, falla', async () => {
    const r1 = await turnoConReintento({ ...base, avisar: async () => {}, intentar: async (n) => (n === 1 ? mal('http 529') : bien('ok')) })
    expect(r1.desenlace).toMatchObject({ tipo: 'respuesta', ganador: 2 })
    const r2 = await turnoConReintento({ ...base, avisar: async () => {}, intentar: async () => mal('http 500') })
    expect(r2.desenlace).toMatchObject({ tipo: 'falla', motivo: 'http 500' })
    expect(r2.intentos).toHaveLength(2)
  })
  it('rechazo: sin reintento', async () => {
    let n = 0
    const r = await turnoConReintento({ ...base, avisar: async () => {}, intentar: async () => { n++; return mal('refusal') } })
    expect(r.desenlace.tipo).toBe('rechazo')
    expect(n).toBe(1)
  })
  it('corte total sin ninguno: falla', async () => {
    const r = await turnoConReintento({ ...base, avisar: async () => {}, intentar: () => tras(800, bien('tarde')) })
    expect(r.desenlace).toMatchObject({ tipo: 'falla', motivo: 'corte_total' })
  })
})
