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

  for (const motivo of ['duda_abierta', 'falla', 'no_entiende']) {
    it(`un «Sí» a la autorización no se pasa a persona por ${motivo}: el candado lo devuelve y la compra sigue`, async () => {
      const base = CASOS_VENTAS.find((c) => c.id === 'v-compra-completa')!
      const i = base.guion!.findIndex((p) => JSON.stringify(p).includes('Perfecto. ¿Me das'))
      const persona = { name: 'pasar_a_persona', args: { motivo, pidio: 'autorizó' } }
      const guion = [...base.guion!.slice(0, i), persona, ...base.guion!.slice(i)]
      const r = await correrCaso({ ...base, guion }, { modelo: null, k: 1 })
      const c = r.corridas[0]
      expect(c.transcripcion.join('\n')).toContain(`${motivo}_tras_autorizar`)
      expect(c.personas).not.toContain(motivo)
      expect(r.pasa).toBe(true)
    })
  }
})
