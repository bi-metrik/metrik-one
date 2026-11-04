import { describe, expect, it } from 'vitest'
import { corridaOne, resumenBanco, veredictoSuelto } from './veredicto-ci'

/** El veredicto del arnés en el PR (encargo 2026-10-30): lee lo que dejan las corridas, nunca lo inventa. */

describe('veredicto del arnés', () => {
  it('ONE: casos, éxitos, dañinas y costo del agente más la persona simulada', () => {
    expect(corridaOne({ tabla: { casos: 38, exitos: 38, daninas: 0, uso: { costo_usd: 0.4 }, persona: { costo_usd: 0.1 } } }))
      .toEqual({ casos: 38, exitos: 38, daninas: 0, costo: 0.5 })
    expect(corridaOne({ tabla: { casos: 2, exitos: 1, daninas: 1, uso: { costo_usd: null }, persona: { costo_usd: null } } }).costo).toBeNull()
    expect(corridaOne({})).toEqual({ casos: 0, exitos: 0, daninas: 0, costo: null })
  })
  it('banco: solo `pasa === true` pasa; lo que falta queda vacío, no inventado', () => {
    expect(resumenBanco({ pasa: true, k: 3, casos: 22, fallan: [], excluidos: ['r-fuera'], daninas: 0 }))
      .toEqual({ pasa: true, k: 3, casos: 22, fallan: [], excluidos: ['r-fuera'], daninas: 0 })
    expect(resumenBanco({ pasa: 'true' }).pasa).toBe(false)
    expect(resumenBanco({})).toEqual({ pasa: false, k: null, casos: null, fallan: [], excluidos: [], daninas: 0 })
  })
  it('suelto: un caso que falla 1 de 3 sin dañinas se reporta y no tumba; 2 de 3, una dañina o en seco sí', () => {
    const bien = { exito: { ok: true }, daninas: [] }
    const mal = { exito: { ok: false }, daninas: [] }
    const danina = { exito: { ok: true }, daninas: ['prometió descuento'] }
    const banco = { pasa: false, k: 3, daninas: 0, seco: false, modelo: 'claude-haiku-5-5' }
    const res = (...c: unknown[][]) => ({ casos: c.map((corridas, i) => ({ id: `c${i}`, corridas })) })
    expect(veredictoSuelto(banco, res([bien, bien, bien], [bien, mal, bien])))
      .toEqual({ pasa: true, sueltos: ['c1'], duros: [] })
    expect(veredictoSuelto(banco, res([bien, bien, bien], [mal, mal, bien])))
      .toEqual({ pasa: false, sueltos: [], duros: ['c1'] })
    expect(veredictoSuelto(banco, res([bien, danina, bien])).pasa).toBe(false)
    expect(veredictoSuelto({ ...banco, daninas: 1 }, res([bien, bien, bien])).pasa).toBe(false)
    expect(veredictoSuelto({ ...banco, seco: true, modelo: 'seco' }, res([bien, bien, bien])).pasa).toBe(false)
    expect(veredictoSuelto(banco, { casos: [] }).pasa).toBe(false)
  })
})
