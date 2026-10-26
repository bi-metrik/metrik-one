import { describe, expect, it } from 'vitest'

import { rescatarCortada } from './detectar-tipo-captura'

/**
 * Brief del 2026-10-05, punto 8: «Hotel Sirius QA 976» dijo «No se pudo mirar el pantallazo»
 * porque los dos intentos de la detección terminaron en MAX_TOKENS. La forma de la respuesta
 * cortada es la medida contra Gemini sobre el banco de capturas (02 y 04 del caso Providencia):
 * el modelo se enreda en una letra con tilde y escribe saltos de línea hasta el tope.
 */
describe('rescatarCortada', () => {
  it('rescata el tipo de un hotel cortado en la tilde del lugar, sin el lugar a medias', () => {
    const cortada = '{"tipo": "hotel", "lugar": "Providencia, San Andr\n\n\n\n\n\n\n\n'
    expect(rescatarCortada(cortada)).toEqual({ tipo: 'hotel', lugar: null, origen: null, destino: null })
  })

  it('conserva los lugares que alcanzaron a cerrarse', () => {
    const cortada = '{"tipo": "vuelo", "destino": "Providencia (PVA)", "lugar": null, "origen": "San Andr\n\n\n\n'
    expect(rescatarCortada(cortada)).toEqual({ tipo: 'vuelo', lugar: null, origen: null, destino: 'Providencia (PVA)' })
  })

  it('sin el tipo entero no rescata nada', () => {
    expect(rescatarCortada('{"tipo": "hot')).toBeNull()
    expect(rescatarCortada('\n\n\n')).toBeNull()
  })

  it('«ninguno» rescatado sigue siendo «no se sabe qué es»', () => {
    expect(rescatarCortada('{"tipo": "ninguno", "lugar": "Bogot\n\n')?.tipo).toBeNull()
  })
})
