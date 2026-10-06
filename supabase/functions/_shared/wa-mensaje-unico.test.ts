import { describe, expect, it, vi } from 'vitest'
import { primeraVezDelMensaje } from './wa-mensaje-unico'

function tabla() {
  const claves = new Set<string>()
  return {
    from: () => ({
      insert: async (f: { clave: string }) => {
        await new Promise((r) => setTimeout(r, 0))
        if (claves.has(f.clave)) return { error: { code: '23505', message: 'duplicate key' } }
        claves.add(f.clave)
        return { error: null }
      },
    }),
  }
}

describe('primeraVezDelMensaje', () => {
  it('el mismo wamid reenviado por Meta solo pasa una vez', async () => {
    const db = tabla()
    expect(await primeraVezDelMensaje(db, 'wamid.A')).toBe(true)
    expect(await primeraVezDelMensaje(db, 'wamid.A')).toBe(false)
    expect(await primeraVezDelMensaje(db, 'wamid.B')).toBe(true)
  })

  it('dos entregas A LA VEZ: pasa una', async () => {
    const db = tabla()
    const r = await Promise.all([primeraVezDelMensaje(db, 'wamid.C'), primeraVezDelMensaje(db, 'wamid.C')])
    expect(r.filter(Boolean)).toHaveLength(1)
  })

  it('sin id, o sin la tabla, se procesa (perder un mensaje es peor)', async () => {
    const espia = vi.spyOn(console, 'error').mockImplementation(() => {})
    const sinTabla = { from: () => ({ insert: async () => ({ error: { code: 'PGRST205', message: 'no table' } }) }) }
    expect(await primeraVezDelMensaje(sinTabla, 'wamid.D')).toBe(true)
    expect(await primeraVezDelMensaje(tabla(), undefined)).toBe(true)
    espia.mockRestore()
  })
})
