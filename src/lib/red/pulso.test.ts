import { describe, expect, it } from 'vitest'
import { INTERVALO_CORTE_MS, INTERVALO_NORMAL_MS, crearMedidor, percentil } from './pulso'

const ok = (ms = 100) => ({ ok: true, ms })
const caida = { ok: false, ms: 4000 }

function medidor() {
  let n = 0
  return crearMedidor({ inicio: 1_000, nuevoId: () => `id-${++n}`, sw: () => false })
}

describe('pulso de conexión', () => {
  it('sin fallas no hay cortes y el intervalo es el normal', () => {
    const m = medidor()
    expect(m.anotarRonda(1_000, ok(), ok())).toBeNull()
    expect(m.anotarRonda(16_000, ok(), ok())).toBeNull()
    expect(m.enCorte()).toBe(false)
    expect(m.intervalo()).toBe(INTERVALO_NORMAL_MS)
  })

  it('las dos sondas caídas = corte del internet de la persona, con su duración', () => {
    const m = medidor()
    m.anotarRonda(10_000, caida, caida)
    expect(m.intervalo()).toBe(INTERVALO_CORTE_MS)
    m.anotarRonda(12_000, caida, caida)
    const corte = m.anotarRonda(14_000, ok(), ok(), '/negocios/[id]')
    expect(corte).toMatchObject({ tipo: 'corte', inicio: 10_000, dur_ms: 4_000, vercel: true, control: true, cierre: 'volvio' })
    expect(m.enCorte()).toBe(false)
  })

  it('solo Vercel caído = falla el camino a Vercel (el control respondió)', () => {
    const m = medidor()
    m.anotarRonda(10_000, caida, ok(), '/negocios')
    const corte = m.anotarRonda(12_000, ok(), ok())
    expect(corte).toMatchObject({ vercel: true, control: false, dur_ms: 2_000, ruta: '/negocios' })
  })

  it('el corte no se cierra mientras falte una de las dos', () => {
    const m = medidor()
    m.anotarRonda(10_000, caida, ok())
    expect(m.anotarRonda(12_000, ok(), caida)).toBeNull()
    expect(m.anotarRonda(14_000, ok(), ok())).toMatchObject({ vercel: true, control: true, dur_ms: 4_000 })
  })

  it('ocultar la pestaña con el corte abierto lo cierra como piso', () => {
    const m = medidor()
    m.anotarRonda(10_000, caida, caida)
    m.anotarRonda(12_000, caida, caida)
    const corte = m.cerrarPorOculta(60_000)
    expect(corte).toMatchObject({ cierre: 'oculta', dur_ms: 4_000 })
    expect(m.cerrarPorOculta(61_000)).toBeNull()
  })

  it('la ventana resume sondas, pérdidas, latencias y tiempos, y vuelve a empezar', () => {
    const m = medidor()
    m.anotarRonda(1_000, ok(100), ok(300))
    m.anotarRonda(16_000, caida, ok(500))
    m.anotarRonda(18_000, ok(200), ok(100))
    m.anotarVisible(60_000)
    m.anotarOffline(1_500)
    const p = m.tomarVentana(301_000, { tipo: '4g' })
    expect(p).toMatchObject({
      tipo: 'pulso',
      t0: 1_000,
      t1: 301_000,
      visible_ms: 60_000,
      offline_ms: 1_500,
      vercel: { n: 3, perdidas: 1, p50: 100, max: 200 },
      control: { n: 3, perdidas: 0, p50: 300, p95: 500, max: 500 },
      red: { tipo: '4g' },
      sw: false,
    })
    // Ventana nueva, nada medido: no sale evento.
    expect(m.tomarVentana(302_000)).toBeNull()
  })

  it('percentil por rango más cercano', () => {
    expect(percentil([], 50)).toBeUndefined()
    expect(percentil([1, 2, 3, 4], 50)).toBe(2)
    expect(percentil([1, 2, 3, 4], 95)).toBe(4)
  })
})
