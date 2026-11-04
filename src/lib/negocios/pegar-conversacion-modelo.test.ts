import { describe, expect, it } from 'vitest'

import { leerChatConModelo, parrafoChatHaiku } from './pegar-conversacion-modelo'
import { instruccionesCarga } from '../../../supabase/functions/_shared/agente/bandeja/extraccion.ts'
import type { CampoEntendible } from '../../../supabase/functions/_shared/wa-entendimiento-reglas.ts'

const FIELDS = [
  { slug: 'destino', tipo: 'texto', label: 'Destino' },
  { slug: 'adultos', tipo: 'numero', label: 'Adultos' },
] as unknown as CampoEntendible[]

function capturar() {
  const cuerpos: Array<{ system_instruction: { parts: { text: string }[] } }> = []
  const f = (async (_u: unknown, init?: RequestInit) => {
    cuerpos.push(JSON.parse(String(init?.body)))
    return new Response(JSON.stringify({ candidates: [{ finishReason: 'STOP', content: { parts: [{ text: '{"mensajes":[],"valores":{}}' }] } }] }), { status: 200 })
  }) as unknown as typeof fetch
  return { cuerpos, f }
}

const pedido = { fields: FIELDS, mensajes: ['Hola, San Andrés el 18 de junio'], hoyISO: '2026-10-29', yaTiene: {}, viaje: 'T1 26 1', apiKey: 'k' }

describe('leerChatConModelo · el párrafo solo de Haiku (arnés de Trappvel, 2026-11-04)', () => {
  it('hacia Gemini el prompt es el de siempre, byte a byte', async () => {
    const { cuerpos, f } = capturar()
    await leerChatConModelo({ ...pedido, fetch: f, paraHaiku: false })
    expect(cuerpos[0].system_instruction.parts[0].text).toBe(instruccionesCarga(FIELDS, '2026-10-29', {}, {}, { viaje: 'T1 26 1' }))
  })

  it('hacia Haiku suma el párrafo: frase nunca vacía, la agencia que resume es «cliente», el año y el rango', async () => {
    const { cuerpos, f } = capturar()
    await leerChatConModelo({ ...pedido, fetch: f, paraHaiku: true })
    const texto = cuerpos[0].system_instruction.parts[0].text
    expect(texto.startsWith(instruccionesCarga(FIELDS, '2026-10-29', {}, {}, { viaje: 'T1 26 1' }))).toBe(true)
    expect(texto).toContain(parrafoChatHaiku('2026-10-29'))
  })

  it('el año del ejemplo sale de hoy: una fecha ya pasada es del año siguiente', () => {
    expect(parrafoChatHaiku('2026-10-29')).toMatch(/«18 de septiembre» es\s+2027-09-18, no 2026-09-18/)
    expect(parrafoChatHaiku('2027-01-05')).toMatch(/«18 de diciembre» es\s+2027-12-18, no 2026-12-18/)
  })
})
