import { describe, expect, it } from 'vitest'
import { CASOS_VENTAS } from './conjuntos-ventas'
import { correrCaso } from './correr-caso'

/**
 * El candado de autorización improvisada (cola.ts, 8b'') no se dispara cuando el modelo agradece «por autorizar» en el
 * mismo turno en que el cliente tocó «Sí»: ese «sí» viene en el resultado del turno, todavía no en las filas. Visto con
 * Haiku real el 3-nov: volvía a pedir la autorización y la compra se corría un paso. En seco, datos inventados.
 */
describe('el «sí» de este turno cuenta para el candado de autorización', () => {
  it('«Gracias por autorizar» tras el «Sí» no vuelve a pedir la autorización', async () => {
    const base = CASOS_VENTAS.find((c) => c.id === 'v-compra-completa')!
    const guion = base.guion!.map((p) => JSON.parse(JSON.stringify(p).replace('Perfecto. ¿Me das', 'Gracias por autorizar. ¿Me das')))
    expect(JSON.stringify(guion)).toContain('Gracias por autorizar')
    const r = await correrCaso({ ...base, guion }, { modelo: null, k: 1 })
    const c = r.corridas[0]
    expect(c.transcripcion.join('\n')).not.toContain('autorizacion_improvisada')
    expect(c.transcripcion.join('\n')).toContain('Gracias por autorizar')
    expect(r.pasa).toBe(true)
  })
})
