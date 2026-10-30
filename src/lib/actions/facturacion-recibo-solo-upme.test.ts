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
 *
 * SOE-029 (2026-10-26): cuánto y en qué pago lo decide el plan del negocio
 * (`planRc3DelNegocio`, real aquí; solo la lectura de la base se dobla).
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

/** Lo que devuelve la base para la línea. Cambia por prueba. */
let configLinea: Record<string, unknown>
/** Lo que la base dice del RC-3 del negocio: comprobante, techo y pagos. */
let entradaRc3: Parameters<typeof import('@/lib/siigo/rc3-negocio')['planRc3DelNegocio']>[0]
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

vi.mock('@/lib/siigo/rc3-negocio-servidor', async () => {
  const { planRc3DelNegocio } = await vi.importActual<typeof import('@/lib/siigo/rc3-negocio')>('@/lib/siigo/rc3-negocio')
  return { cargarPlanRc3: async () => planRc3DelNegocio(entradaRc3) }
})

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
  entradaRc3 = {
    comprobante: { estado: 'ok', valor: 701_812 },
    techoTarifa: 701_812,
    pagos: [
      { id: 'c-mixto', fecha: '2026-09-20', aTarifa: 701_812, marca: null, noAplica: false },
      { id: 'c-v0513', fecha: '2026-09-21', aTarifa: 0, marca: null, noAplica: false },
    ],
  }
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
    const r = await emitirReciboDeNegocio('neg-1', { cobroId: 'c-v0513' })

    expect(r.ok).toBe(false)
    expect(!r.ok && r.error).toContain('no trae tarifa UPME')
    expect(llamadas).toEqual([])
  })

  it('un pago sin reparto se rechaza: no se adivina cuánto es tarifa', async () => {
    // Sin fila en el reparto la porción UPME del pago es 0 para el plan: no es titular.
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

describe('emitirReciboDeNegocio — el RC-3 sale del comprobante UPME, uno por negocio (SOE-029)', () => {
  it('sin valor en el comprobante bloquea con el mensaje claro, SIN tocar la emisión', async () => {
    entradaRc3 = { ...entradaRc3, comprobante: { estado: 'falta' } }
    const r = await emitirReciboDeNegocio('neg-1', { cobroId: 'c-mixto' })

    expect(r.ok).toBe(false)
    expect(!r.ok && r.error).toBe('Aún no se ha pagado a la UPME: el recibo sale cuando se cargue el comprobante de pago UPME en el negocio.')
    expect(llamadas).toEqual([])
  })

  it('con dos pagos, el primero no emite: va en el del negocio', async () => {
    entradaRc3 = {
      comprobante: { estado: 'ok', valor: 701_812 },
      techoTarifa: 701_812,
      pagos: [
        { id: 'c-a', fecha: '2026-09-10', aTarifa: 45, marca: null, noAplica: false },
        { id: 'c-b', fecha: '2026-09-20', aTarifa: 701_767, marca: null, noAplica: false },
      ],
    }
    const r = await emitirReciboDeNegocio('neg-1', { cobroId: 'c-a' })

    expect(r.ok).toBe(false)
    expect(!r.ok && r.error).toContain('va en el recibo del negocio')
    expect(llamadas).toEqual([])
  })

  it('sin cobroId, el recibo va en el pago titular', async () => {
    entradaRc3 = {
      comprobante: { estado: 'ok', valor: 701_812 },
      techoTarifa: 701_812,
      pagos: [
        { id: 'c-a', fecha: '2026-09-10', aTarifa: 45, marca: null, noAplica: false },
        { id: 'c-b', fecha: '2026-09-20', aTarifa: 701_767, marca: null, noAplica: false },
      ],
    }
    const r = await emitirReciboDeNegocio('neg-1')

    expect(r.ok).toBe(true)
    expect(llamadas.map(l => l.cobroId)).toEqual(['c-b'])
  })

  it('si lo emitido ya cubre el comprobante, no se ofrece otro', async () => {
    entradaRc3 = {
      comprobante: { estado: 'ok', valor: 978_707 },
      techoTarifa: 978_870,
      pagos: [
        { id: 'c-1', fecha: '2026-09-10', aTarifa: 978_865, noAplica: false,
          marca: [{ numero: 'RC-3-9', siigo_id: 's', valor: 978_865, componente: 'pasante' }] },
        { id: 'c-2', fecha: '2026-09-20', aTarifa: 5, marca: null, noAplica: false },
      ],
    }
    const r = await emitirReciboDeNegocio('neg-1', { cobroId: 'c-2' })

    expect(r.ok).toBe(false)
    expect(!r.ok && r.error).toContain('ya tiene su recibo')
    expect(llamadas).toEqual([])
  })
})
