import { describe, expect, it } from 'vitest'
import { anotarReenvio, CLAVE_COLA, encolar, leerCola, quitarDeCola, type Almacen } from './cola'
import { MAX_BYTES_REPORTE, MAX_COLA, MAX_EDAD_COLA_MS, MAX_REENVIOS } from './limites'

function almacenEnMemoria(): Almacen & { datos: Map<string, string> } {
  const datos = new Map<string, string>()
  return {
    datos,
    getItem: (k) => datos.get(k) ?? null,
    setItem: (k, v) => void datos.set(k, v),
    removeItem: (k) => void datos.delete(k),
  }
}

const AHORA = 1_790_000_000_000
const entrada = (id: string, creado = AHORA, reenvios = 0) => ({ id, creado, reenvios, cuerpo: { message: `m-${id}` } })

describe('cola de reenvio de errores-cliente', () => {
  it('encola, lee y quita por id', () => {
    const a = almacenEnMemoria()
    encolar(a, entrada('a'), AHORA)
    encolar(a, entrada('b'), AHORA)
    expect(leerCola(a, AHORA).map((e) => e.id)).toEqual(['a', 'b'])
    quitarDeCola(a, 'a', AHORA)
    expect(leerCola(a, AHORA).map((e) => e.id)).toEqual(['b'])
    quitarDeCola(a, 'b', AHORA)
    // Vacia: la clave se borra, no queda un "[]" ocupando el almacen.
    expect(a.datos.has(CLAVE_COLA)).toBe(false)
  })

  it('tope de tamano: al pasarse salen los mas viejos', () => {
    const a = almacenEnMemoria()
    for (let i = 0; i < MAX_COLA + 4; i++) encolar(a, entrada(`r${i}`), AHORA)
    const ids = leerCola(a, AHORA).map((e) => e.id)
    expect(ids).toHaveLength(MAX_COLA)
    expect(ids[0]).toBe('r4')
    expect(ids.at(-1)).toBe(`r${MAX_COLA + 3}`)
  })

  it('tope de edad: lo de mas de un dia se descarta (y lo del futuro tambien)', () => {
    const a = almacenEnMemoria()
    encolar(a, entrada('viejo', AHORA - MAX_EDAD_COLA_MS - 1), AHORA - MAX_EDAD_COLA_MS - 1)
    encolar(a, entrada('nuevo', AHORA - 1000), AHORA)
    encolar(a, entrada('futuro', AHORA + 10 * 60_000), AHORA)
    expect(leerCola(a, AHORA).map((e) => e.id)).toEqual(['nuevo'])
  })

  it('tope de reintentos: tras MAX_REENVIOS se suelta', () => {
    const a = almacenEnMemoria()
    encolar(a, entrada('x'), AHORA)
    for (let i = 0; i < MAX_REENVIOS - 1; i++) anotarReenvio(a, 'x', AHORA)
    expect(leerCola(a, AHORA)[0].reenvios).toBe(MAX_REENVIOS - 1)
    anotarReenvio(a, 'x', AHORA)
    expect(leerCola(a, AHORA)).toEqual([])
  })

  it('un reporte que no cabe en el endpoint no se guarda', () => {
    const a = almacenEnMemoria()
    encolar(a, { ...entrada('g'), cuerpo: { message: 'x'.repeat(MAX_BYTES_REPORTE + 1) } }, AHORA)
    expect(leerCola(a, AHORA)).toEqual([])
  })

  it('sin localStorage (null) no hace nada y no lanza', () => {
    expect(() => encolar(null, entrada('a'), AHORA)).not.toThrow()
    expect(leerCola(null, AHORA)).toEqual([])
    expect(() => quitarDeCola(null, 'a', AHORA)).not.toThrow()
    expect(() => anotarReenvio(null, 'a', AHORA)).not.toThrow()
  })

  it('un almacen que lanza (Safari privado, cuota llena) no rompe', () => {
    const roto: Almacen = {
      getItem: () => {
        throw new Error('SecurityError')
      },
      setItem: () => {
        throw new Error('QuotaExceededError')
      },
      removeItem: () => {
        throw new Error('SecurityError')
      },
    }
    expect(() => encolar(roto, entrada('a'), AHORA)).not.toThrow()
    expect(leerCola(roto, AHORA)).toEqual([])
    expect(() => quitarDeCola(roto, 'a', AHORA)).not.toThrow()
  })

  it('basura en la clave (otro formato, JSON roto) se ignora', () => {
    const a = almacenEnMemoria()
    a.setItem(CLAVE_COLA, '{no es json')
    expect(leerCola(a, AHORA)).toEqual([])
    a.setItem(CLAVE_COLA, JSON.stringify([{ id: 1 }, entrada('ok'), 'x']))
    expect(leerCola(a, AHORA).map((e) => e.id)).toEqual(['ok'])
  })
})
