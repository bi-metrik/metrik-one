import { describe, expect, it } from 'vitest'

import { aplicarSumas } from './campo-suma'

const CAMPOS = [
  { slug: 'adultos' },
  { slug: 'ninos' },
  { slug: 'infantes' },
  { slug: 'numero_pasajeros', suma_de: ['adultos', 'ninos', 'infantes'] },
]

describe('campo suma_de · número de pasajeros', () => {
  it('es la suma de adultos, niños e infantes', () => {
    expect(aplicarSumas(CAMPOS, { adultos: 2, ninos: 1, infantes: 1 }).numero_pasajeros).toBe(4)
  })

  it('lee lo que se escribe a la colombiana y cuenta como cero lo vacío', () => {
    expect(aplicarSumas(CAMPOS, { adultos: '5', ninos: '', infantes: null }).numero_pasajeros).toBe(5)
  })

  it('pisa un total escrito a mano que no cuadra con el desglose', () => {
    expect(aplicarSumas(CAMPOS, { adultos: 2, ninos: 0, infantes: 0, numero_pasajeros: 7 }).numero_pasajeros).toBe(2)
  })

  it('sin NINGUNA fuente con número, NO vacía el total que ya había', () => {
    const viejo = { numero_pasajeros: 6 }
    expect(aplicarSumas(CAMPOS, viejo)).toBe(viejo)
  })

  it('un bloque sin campos suma_de queda idéntico (otros workspaces)', () => {
    const datos = { adultos: 2, numero_pasajeros: 9 }
    expect(aplicarSumas([{ slug: 'adultos' }, { slug: 'numero_pasajeros' }], datos)).toBe(datos)
    expect(aplicarSumas(undefined, datos)).toBe(datos)
  })
})
