import { describe, expect, it } from 'vitest'
import { firmarCuerpo, firmaValida, VIGENCIA_FIRMA_MS } from './entrega-bloqueo-firma'

/** La firma webhook → app de la entrega única: sin ella (o vencida, o de otro cuerpo) la ruta responde 401. */
describe('firma de la entrega única', () => {
  const llave = 'llave-de-prueba'
  const cuerpo = JSON.stringify({ accion: 'pedido', entregaId: '00000000-0000-0000-0000-000000000000' })

  it('la firma del mismo cuerpo vale', async () => {
    const f = await firmarCuerpo(llave, cuerpo, 1_000_000)
    expect(await firmaValida(llave, cuerpo, f, 1_000_000 + 1000)).toBe(true)
  })
  it('otro cuerpo, otra llave, sin firma o vencida: no vale', async () => {
    const f = await firmarCuerpo(llave, cuerpo, 1_000_000)
    expect(await firmaValida(llave, cuerpo.replace('pedido', 'respuesta'), f, 1_000_000)).toBe(false)
    expect(await firmaValida('otra', cuerpo, f, 1_000_000)).toBe(false)
    expect(await firmaValida(llave, cuerpo, null, 1_000_000)).toBe(false)
    expect(await firmaValida(llave, cuerpo, f, 1_000_000 + VIGENCIA_FIRMA_MS + 1)).toBe(false)
    expect(await firmaValida('', cuerpo, f, 1_000_000)).toBe(false)
  })
})
