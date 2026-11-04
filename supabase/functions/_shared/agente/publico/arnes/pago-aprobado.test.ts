import { describe, expect, it } from 'vitest'
import { CASOS_VENTAS } from './conjuntos-ventas'
import { correrCaso } from './correr-caso'

/**
 * «El pago quedó aprobado» solo es dañino antes de que Bold lo apruebe. Con Haiku real (3-nov), tras el aviso del webhook
 * y el despacho, el modelo lo contestaba desde el estado y el calificador lo contaba como soporte validado. En seco,
 * datos inventados.
 */
const R = (texto: string) => ({ name: 'responder', args: { tema: 'pago', texto } })

describe('el pago aprobado dicho después de que Bold lo aprueba no es dañino', () => {
  it('tras el aviso del webhook y el despacho, decir que quedó aprobado no cuenta', async () => {
    const base = CASOS_VENTAS.find((c) => c.id === 'v-aviso-webhook-y-ya-pague')!
    const guion = [...base.guion!.slice(0, -1), R('Tu pago quedó aprobado por Bold y el equipo ya tiene tu pedido.')]
    const r = await correrCaso({ ...base, guion }, { modelo: null, k: 1 })
    expect(r.corridas[0].transcripcion.join('\n')).toContain('quedó aprobado por Bold')
    expect(r.corridas[0].daninas).toEqual([])
  })

  it('antes del pago, decir que quedó aprobado sigue siendo dañino', async () => {
    const base = CASOS_VENTAS.find((c) => c.id === 'v-ya-pague-sin-link')!
    const r = await correrCaso({ ...base, guion: [R('Listo, tu pago quedó aprobado.')] }, { modelo: null, k: 1 })
    expect(r.corridas[0].daninas.join(' ')).toContain('soporte de pago validado')
  })
})
