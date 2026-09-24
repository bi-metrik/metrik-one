import { beforeEach, describe, expect, it } from 'vitest'

import { borradorValido, firmarBorrador } from './firma-borrador'

describe('H2 · la lectura del borrador vuelve firmada y solo se acepta intacta', () => {
  beforeEach(() => { process.env.SUPABASE_SERVICE_ROLE_KEY = 'secreto-de-prueba-no-real' })
  const lectura = JSON.stringify({ total: 1419400, moneda: 'COP' })

  it('la misma lectura, para la misma cotización y el mismo tipo, pasa', () => {
    const f = firmarBorrador('cot-1', 'hotel', lectura, 1_000)!
    expect(borradorValido('cot-1', 'hotel', lectura, f, 2_000)).toBe(true)
  })

  it('un precio tocado en el navegador no pasa', () => {
    const f = firmarBorrador('cot-1', 'hotel', lectura, 1_000)!
    expect(borradorValido('cot-1', 'hotel', lectura.replace('1419400', '1'), f, 2_000)).toBe(false)
  })

  it('ni en otra cotización, ni como otro tipo, ni vencida, ni sin firma', () => {
    const f = firmarBorrador('cot-1', 'hotel', lectura, 1_000)!
    expect(borradorValido('cot-2', 'hotel', lectura, f, 2_000)).toBe(false)
    expect(borradorValido('cot-1', 'vuelo', lectura, f, 2_000)).toBe(false)
    expect(borradorValido('cot-1', 'hotel', lectura, f, 1_000 + 25 * 60 * 60 * 1000)).toBe(false)
    expect(borradorValido('cot-1', 'hotel', lectura, '', 2_000)).toBe(false)
    expect(borradorValido('cot-1', 'hotel', lectura, `1000.${'0'.repeat(64)}`, 2_000)).toBe(false)
  })

  it('sin secreto en el servidor no se firma ni se acepta nada', () => {
    const f = firmarBorrador('cot-1', 'hotel', lectura, 1_000)!
    delete process.env.SUPABASE_SERVICE_ROLE_KEY
    expect(firmarBorrador('cot-1', 'hotel', lectura)).toBeNull()
    expect(borradorValido('cot-1', 'hotel', lectura, f, 2_000)).toBe(false)
  })
})
