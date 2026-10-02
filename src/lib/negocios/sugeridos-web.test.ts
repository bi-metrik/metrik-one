import { describe, expect, it } from 'vitest'
import { textoConflicto, textoSugerido } from './sugeridos'

describe('lo pegado en la web (fuente web)', () => {
  it('el sugerido dice que salió de lo que se pegó; el de WhatsApp sigue igual', () => {
    expect(textoSugerido({ fuente: 'web', frase: 'ella y el papá de 72' })).toBe('Sugerido de lo que pegaste: «ella y el papá de 72»')
    expect(textoSugerido({ fuente: 'whatsapp', frase: 'va mi hijo' })).toBe('Sugerido desde WhatsApp: «va mi hijo»')
  })

  it('el conflicto dice «en el texto pegado» con el día de Bogotá', () => {
    expect(textoConflicto('14 mar', { fuente: 'web', valor: '2027-03-14', origen: 'mensaje', en: '2026-10-02T15:00:00Z' }))
      .toBe('El cliente dijo 14 mar en el texto pegado del 2-oct')
    expect(textoConflicto('20 nov', { fuente: 'whatsapp', valor: '2026-11-20', origen: 'audio', en: '2026-09-30T15:00:00Z' }))
      .toBe('El cliente dijo 20 nov en el audio del 30-sep')
  })
})
