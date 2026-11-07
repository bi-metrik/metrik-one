import { describe, expect, it } from 'vitest'
import { firmarCuerpo, firmaValida, motivoRechazo, VIGENCIA_FIRMA_MS } from './entrega-bloqueo-firma'

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
  it('dice por qué la rechaza, sin el secreto', async () => {
    const f = await firmarCuerpo(llave, cuerpo, 1_000_000)
    expect(await motivoRechazo(llave, cuerpo, f, 1_000_000)).toBeNull()
    expect(await motivoRechazo('', cuerpo, f, 1_000_000)).toBe('sin_secreto')
    expect(await motivoRechazo(llave, cuerpo, null, 1_000_000)).toBe('sin_firma')
    expect(await motivoRechazo(llave, cuerpo, 'v1=abc', 1_000_000)).toBe('formato')
    expect(await motivoRechazo(llave, cuerpo, f, 1_000_000 + VIGENCIA_FIRMA_MS + 1)).toBe('vencida')
    // La llave de servicio de Supabase cambió de un lado y no del otro (2026-11-05): no coincide.
    expect(await motivoRechazo('otra', cuerpo, f, 1_000_000)).toBe('no_coincide')
  })
})
