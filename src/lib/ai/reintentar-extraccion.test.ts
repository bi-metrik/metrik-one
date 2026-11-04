import { describe, expect, it, vi } from 'vitest'

import { extraerConReintento } from './reintentar-extraccion'

vi.spyOn(console, 'warn').mockImplementation(() => {})

describe('extraerConReintento', () => {
  it('reintenta una falla del sistema', async () => {
    const f = vi.fn().mockResolvedValueOnce({ data: null, error: 'Error de Gemini (503)' }).mockResolvedValueOnce({ data: { ok: 1 } })
    expect(await extraerConReintento(f, 'prueba')).toEqual({ data: { ok: 1 } })
    expect(f).toHaveBeenCalledTimes(2)
  })

  it('NO reintenta un archivo que el modelo rechazó: el mismo archivo falla igual (V0634)', async () => {
    const f = vi.fn().mockResolvedValue({ data: null, error: 'Error de Gemini (400)', archivo: 'sin_paginas' })
    expect(await extraerConReintento(f, 'prueba')).toMatchObject({ archivo: 'sin_paginas' })
    expect(f).toHaveBeenCalledTimes(1)
  })
})
