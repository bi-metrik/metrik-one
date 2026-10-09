import { describe, expect, it, vi } from 'vitest'
import { ROTULO_INACTIVO, rotularFilas, rotularNombre, staffInactivos } from './inactivos'

describe('rotularNombre', () => {
  it('rotula solo a quien está inactivo', () => {
    expect(rotularNombre('Jhon Fredy Rios Varon', true)).toBe('Jhon Fredy Rios Varon (inactivo)')
    expect(rotularNombre('Ana Pérez', false)).toBe('Ana Pérez')
  })

  it('no pone el rótulo dos veces', () => {
    const una = rotularNombre('Jhon', true)
    expect(rotularNombre(una, true)).toBe(una)
    expect(una.split(ROTULO_INACTIVO)).toHaveLength(2)
  })
})

describe('rotularFilas', () => {
  const filas = [
    { responsable_id: 'a', nombre: 'Ana', num_ventas: 3 },
    { responsable_id: 'j', nombre: 'Jhon', num_ventas: 7 },
    { responsable_id: null, nombre: '(sin responsable)', num_ventas: 1 },
  ]

  it('rotula la fila del inactivo y deja las cifras intactas', () => {
    const r = rotularFilas(filas, (f) => f.responsable_id, new Set(['j']))
    expect(r.map((f) => f.nombre)).toEqual(['Ana', 'Jhon (inactivo)', '(sin responsable)'])
    expect(r.map((f) => f.num_ventas)).toEqual([3, 7, 1])
    // No muta la entrada: viene de la caché de Tableros y la comparten otras lecturas.
    expect(filas[1].nombre).toBe('Jhon')
  })

  it('no quita a nadie: el inactivo sigue en su periodo', () => {
    expect(rotularFilas(filas, (f) => f.responsable_id, new Set(['j']))).toHaveLength(3)
  })

  it('sin inactivos o sin filas devuelve lo mismo', () => {
    expect(rotularFilas(filas, (f) => f.responsable_id, new Set())).toBe(filas)
    expect(rotularFilas(null, (f: { nombre: string; id: string }) => f.id, new Set(['x']))).toEqual([])
  })
})

describe('staffInactivos', () => {
  function cliente(resultado: { data: unknown; error: { message: string } | null }) {
    const eq = vi.fn()
    const q = { select: vi.fn(() => q), eq: eq.mockImplementation(() => q), then: undefined as unknown }
    // El segundo `.eq` resuelve la consulta.
    let llamadas = 0
    eq.mockImplementation(() => {
      llamadas += 1
      return llamadas === 2 ? Promise.resolve(resultado) : q
    })
    return { from: vi.fn(() => q), eq }
  }

  it('pide solo los inactivos del workspace', async () => {
    const c = cliente({ data: [{ id: 'j' }], error: null })
    const r = await staffInactivos(c, 'ws-1')
    expect([...r]).toEqual(['j'])
    expect(c.from).toHaveBeenCalledWith('staff')
    expect(c.eq).toHaveBeenNthCalledWith(1, 'workspace_id', 'ws-1')
    expect(c.eq).toHaveBeenNthCalledWith(2, 'is_active', false)
  })

  it('si la lectura falla, no rotula pero no rompe el tablero', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const r = await staffInactivos(cliente({ data: null, error: { message: 'x' } }), 'ws-1')
    expect(r.size).toBe(0)
    spy.mockRestore()
  })
})
