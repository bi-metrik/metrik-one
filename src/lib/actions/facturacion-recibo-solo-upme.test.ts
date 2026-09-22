/**
 * Desde Tesorería solo sale el recibo de la tarifa UPME.
 *
 * Brief del 2026-09-22 (Mauricio): «no nos debería permitir generar recibos de caja
 * diferentes a la tarifa UPME». El botón «Emitir recibo» del control de recibos llama a
 * `emitirReciboDeNegocio`, y esa acción es un endpoint alcanzable con cualquier id: la
 * regla se sostiene en el SERVIDOR, no en lo que la pantalla decida pintar.
 *
 * Tres puertas por las que antes salía un RC-1 a mano, y que aquí se ven cerradas:
 *
 *   1. un pago mixto: la emisión sacaba el honorario (anticipo o abono) junto a la tarifa;
 *   2. un pago de puro honorario (V0513, $450.000): el botón sacaba su RC-1;
 *   3. una línea sin `recibo_por_concepto`: la emisión caía al recibo por el TOTAL con el
 *      comprobante del workspace, que en SOENA es el 4594, el RC-1.
 *
 * SE VIERON FALLAR quitando cada guarda de la acción, una a la vez (que es como estaba en
 * `origin/main`, 345ab68):
 *   - sin `soloComponentes: ['pasante']`   → "pide SOLO el componente pasante"
 *   - sin la lectura de `a_tarifa`          → "un pago sin tarifa UPME se rechaza"
 *   - sin exigir `recibo_por_concepto.pasante` → las dos de la línea mal declarada
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

const WS = 'ws-soena'

const LINEA_SOENA = {
  siigo: {
    bloque_recibo_slug: 'recibo_caja_upme',
    recibo_por_concepto: {
      honorario: { document_id: 4594, concepto: 'Honorarios de asesoría', tipo: 'abono' },
      pasante: { document_id: 33546, concepto: 'Recaudo pago certificación UPME' },
    },
  },
}

/** Lo que devuelve la base para la línea y para el reparto del pago. Cambia por prueba. */
let configLinea: Record<string, unknown>
let reparto: { a_tarifa: number } | null
/** Cada llamada a la emisión, con sus opciones. Vacío = no se tocó Siigo. */
let llamadas: Array<{ cobroId: string; opciones: Record<string, unknown> }>

vi.mock('@/lib/actions/get-workspace', () => ({
  getWorkspace: async () => ({ workspaceId: WS, staffId: 's-diana', userId: 'u-diana', role: 'admin', areas: ['financiera'] }),
}))
vi.mock('@/lib/permissions/can-edit', () => ({ canEditBloque: () => true }))
vi.mock('next/cache', () => ({ revalidatePath: () => {} }))
vi.mock('@/lib/siigo/client', () => ({ siigoRequest: async () => ({ results: [] }) }))
vi.mock('@/lib/activity/nombre-de-quien-actua', () => ({ nombreDeQuienActua: async () => 'Diana Parra' }))

vi.mock('@/lib/siigo/recibos', () => ({
  emitirReciboDeCobro: async (_ws: string, cobroId: string, _nombre: string | null, opciones: Record<string, unknown>) => {
    llamadas.push({ cobroId, opciones })
    return { ok: true, numero: 'RC-3-12', valor: 701_812, archivada: true, recibos: [{ numero: 'RC-3-12', valor: 701_812 }] }
  },
}))

vi.mock('@/lib/supabase/server', () => ({
  createServiceClient: () => ({
    from: (tabla: string) => {
      const chain = {
        select: () => chain,
        eq: () => chain,
        is: () => chain,
        order: () => chain,
        limit: async () => ({ data: [], error: null }),
        maybeSingle: async () => {
          if (tabla === 'lineas_negocio') return { data: { config_extra: configLinea }, error: null }
          if (tabla === 'v_cobro_valor') return { data: reparto, error: null }
          return { data: null, error: null }
        },
        single: async () => ({ data: { linea_id: 'lin-1' }, error: null }),
      }
      return chain
    },
  }),
}))

import { emitirReciboDeNegocio } from './facturacion-actions'

beforeEach(() => {
  configLinea = LINEA_SOENA
  reparto = { a_tarifa: 701_812 }
  llamadas = []
})

describe('emitirReciboDeNegocio — solo el recibo de la tarifa UPME', () => {
  it('en un pago mixto pide a la emisión SOLO el componente pasante (el RC-3)', async () => {
    const r = await emitirReciboDeNegocio('neg-1', { cobroId: 'c-mixto' })

    expect(r.ok).toBe(true)
    expect(llamadas).toHaveLength(1)
    expect(llamadas[0].opciones.soloComponentes).toEqual(['pasante'])
    // Con el RC-3 sí se le avisa al cliente: es el «recibimos tu pago».
    expect(llamadas[0].opciones.avisarAlCliente).toBe(true)
  })

  it('no lleva un valor escrito a mano: el recibo acusa la porción UPME del reparto', async () => {
    await emitirReciboDeNegocio('neg-1', { cobroId: 'c-mixto', valorPagado: 1_339_312 } as never)

    expect(llamadas[0].opciones).not.toHaveProperty('valorPagado')
  })

  it('un pago sin tarifa UPME (todo honorario) se rechaza SIN tocar la emisión', async () => {
    reparto = { a_tarifa: 0 }
    const r = await emitirReciboDeNegocio('neg-1', { cobroId: 'c-v0513' })

    expect(r.ok).toBe(false)
    expect(!r.ok && r.error).toContain('no trae tarifa UPME')
    expect(llamadas).toEqual([])
  })

  it('un pago sin reparto se rechaza: no se adivina cuánto es tarifa', async () => {
    reparto = null
    const r = await emitirReciboDeNegocio('neg-1', { cobroId: 'c-x' })

    expect(r.ok).toBe(false)
    expect(llamadas).toEqual([])
  })

  it('una línea sin el recibo de la tarifa declarado se rechaza: no cae al recibo por el total', async () => {
    configLinea = { siigo: { recibo_concepto: 'Dinero recibido del cliente' } }
    const r = await emitirReciboDeNegocio('neg-1', { cobroId: 'c-mixto' })

    expect(r.ok).toBe(false)
    expect(!r.ok && r.error).toContain('recibo_por_concepto.pasante')
    expect(llamadas).toEqual([])
  })

  it('tampoco una línea que declara SOLO el honorario', async () => {
    configLinea = { siigo: { recibo_por_concepto: { honorario: { document_id: 4594, concepto: 'Honorarios', tipo: 'abono' } } } }
    const r = await emitirReciboDeNegocio('neg-1', { cobroId: 'c-mixto' })

    expect(r.ok).toBe(false)
    expect(llamadas).toEqual([])
  })
})
