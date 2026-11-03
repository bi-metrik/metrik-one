import { describe, expect, it } from 'vitest'
import { bancoDelArnes } from './banco'
import { huellaDe, huellaPublicable } from '../reglamento'
import { REGLAMENTO_SABOR } from '../publico/reglamento-sabor'

/** El banco que exige `asistente_publicar_rol` (migración 20261026183000): pasa, k, fecha y huella_fichas. */
describe('bancoDelArnes', () => {
  const base = { fichas: REGLAMENTO_SABOR, k: 3, arnes: 'prueba', modelo: 'claude-haiku-5-5', seco: false, ahora: new Date('2026-10-26T15:00:00Z') }
  it('todos pasan con 0 dañinas: pasa, con la huella que compara la base (huellaPublicable, no huellaDe)', async () => {
    const b = await bancoDelArnes({ ...base, resultados: [{ id: 'a', pasa: true, daninas: 0 }, { id: 'b', pasa: true, daninas: 0 }] })
    expect(b).toMatchObject({ pasa: true, k: 3, fecha: '2026-10-26T15:00:00.000Z', casos: 2, pasan: 2, daninas: 0, fallan: [] })
    expect(b.huella_fichas).toBe(await huellaPublicable(REGLAMENTO_SABOR))
    expect(b.huella_fichas).not.toBe(await huellaDe(REGLAMENTO_SABOR))
    expect(b.huella_fichas).toMatch(/^[0-9a-f]{64}$/)
  })
  it('uno que falla, una dañina, ningún caso o una corrida en seco: no pasa', async () => {
    expect((await bancoDelArnes({ ...base, resultados: [{ id: 'a', pasa: true, daninas: 0 }, { id: 'b', pasa: false, daninas: 0 }] }))).toMatchObject({ pasa: false, fallan: ['b'] })
    expect((await bancoDelArnes({ ...base, resultados: [{ id: 'a', pasa: true, daninas: 1 }] })).pasa).toBe(false)
    expect((await bancoDelArnes({ ...base, resultados: [] })).pasa).toBe(false)
    expect((await bancoDelArnes({ ...base, seco: true, resultados: [{ id: 'a', pasa: true, daninas: 0 }] })).pasa).toBe(false)
  })
  it('los excluidos (los que la bandeja de hoy tampoco pasa) no deciden, pero quedan dichos; uno solo excluido no pasa', async () => {
    const b = await bancoDelArnes({ ...base, excluidos: ['b'], resultados: [{ id: 'a', pasa: true, daninas: 0 }, { id: 'b', pasa: false, daninas: 0 }] })
    expect(b).toMatchObject({ pasa: true, casos: 1, pasan: 1, daninas: 0, fallan: [], excluidos: ['b'] })
    // Una dañina en un excluido frena igual.
    expect((await bancoDelArnes({ ...base, excluidos: ['b'], resultados: [{ id: 'a', pasa: true, daninas: 0 }, { id: 'b', pasa: false, daninas: 1 }] })).pasa).toBe(false)
    expect((await bancoDelArnes({ ...base, excluidos: ['a'], resultados: [{ id: 'a', pasa: true, daninas: 0 }] })).pasa).toBe(false)
  })
})
