/**
 * El recibo de caja cuelga del COBRO, no del negocio.
 *
 * EL CASO QUE IMPORTA: el segundo pago de un mismo negocio.
 *
 * Hasta el 2026-09-03 la marca vivía en `negocios.metadata.siigo_recibo`, un objeto
 * único, y la clave de idempotencia contra Siigo se derivaba del `negocioId`. Las dos
 * cosas juntas hacían que el segundo pago de un caso **nunca** emitiera: la marca
 * devolvía `ya_emitido`, y si se hubiera saltado esa guarda, Siigo habría devuelto el
 * primer recibo por la clave repetida. `ya_emitido` no se ve como error: se lee como
 * éxito, así que el recibo se perdía en silencio.
 *
 * No es un caso de borde. Medido sobre producción el 2026-09-02: de 306 negocios con
 * cobros, **74 (el 24%) ya recibieron más de un pago**.
 *
 * SE VIERON FALLAR contra la implementación anterior:
 *   - "el segundo pago del mismo negocio también emite"  → devolvía `ya_emitido`
 *   - "cada cobro lleva su propia clave de idempotencia" → la clave se repetía
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

const WS = 'ws-soena'
const NEG = 'neg-v0412'
const COBRO_1 = 'cobro-anticipo'
const COBRO_2 = 'cobro-saldo'

type FilaCobro = {
  id: string
  negocio_id: string | null
  monto: number | null
  siigo_recibo: Record<string, unknown> | null
  anulado_at: string | null
}

let cobros: Record<string, FilaCobro>
/** Claves de idempotencia con las que se llamó a Siigo, en orden. */
let clavesUsadas: string[]
/** Observaciones que viajaron en el payload del recibo. */
let observacionesUsadas: string[]
/** Llamadas a la RPC del aviso al cliente. */
let avisos: Array<{ negocio: string; bloque: string }>
let consecutivo: number

function servicioFalso() {
  const from = (tabla: string) => {
    if (tabla === 'cobros') {
      let id: string | null = null
      const chain = {
        select: () => chain,
        eq: (col: string, val: string) => { if (col === 'id') id = val; return chain },
        is: () => chain,
        order: () => chain,
        limit: () => chain,
        single: async () =>
          id && cobros[id] ? { data: { ...cobros[id] }, error: null } : { data: null, error: { message: 'no existe' } },
        maybeSingle: async () =>
          id && cobros[id] ? { data: { ...cobros[id] }, error: null } : { data: null, error: null },
        update: (patch: Record<string, unknown>) => {
          const upd = {
            eq: (col: string, val: string) => { if (col === 'id') id = val; return upd },
            then: (resolve: (v: { error: null }) => unknown) => {
              if (id && cobros[id]) Object.assign(cobros[id], patch)
              return resolve({ error: null })
            },
          }
          return upd
        },
      }
      return chain
    }
    if (tabla === 'negocios') {
      const chain = {
        select: () => chain,
        eq: () => chain,
        single: async () => ({ data: { id: NEG, codigo: 'V0412', nombre: 'Cliente Prueba' }, error: null }),
        maybeSingle: async () => ({ data: { id: NEG, codigo: 'V0412', nombre: 'Cliente Prueba' }, error: null }),
      }
      return chain
    }
    throw new Error(`tabla inesperada en el doble: ${tabla}`)
  }
  return {
    from,
    rpc: async (nombre: string, args: Record<string, string>) => {
      if (nombre === 'avisar_documento_al_cliente') {
        avisos.push({ negocio: args.p_negocio_id, bloque: args.p_bloque_config_id })
        return { data: true, error: null }
      }
      return { data: null, error: null }
    },
  }
}

vi.mock('@/lib/supabase/server', () => ({
  createServiceClient: () => servicioFalso(),
  createClient: async () => servicioFalso(),
}))

vi.mock('./client', async () => {
  const real = await vi.importActual<typeof import('./client')>('./client')
  return {
    ...real,
    getSiigoConfig: async () => ({
      facturaDocumentId: 1, reciboDocumentId: 2, sellerId: 3,
      productoCode: '11', ivaId: 4, facturaPaymentId: 5, reciboPaymentId: 6,
    }),
    siigoRequest: async (
      _ws: string,
      ruta: string,
      opts?: { idempotencyKey?: string; body?: { observations?: string } },
    ) => {
      // La consulta de recibos existentes del cliente: ninguno.
      if (ruta.startsWith('/v1/vouchers?')) return { results: [] }
      clavesUsadas.push(opts?.idempotencyKey ?? '(sin clave)')
      observacionesUsadas.push(opts?.body?.observations ?? '(sin concepto)')
      consecutivo += 1
      return { id: `siigo-rc-${consecutivo}`, name: `RC-1-${consecutivo}`, date: '2026-09-03' }
    },
  }
})

vi.mock('./clientes', () => ({
  asegurarClienteSiigo: async () => ({
    estado: 'ya_existia' as const, identificacion: '80815711', siigo_id: 'siigo-cli-1',
  }),
}))

vi.mock('@/lib/pdf/pdf-render-client', () => ({
  renderReciboCaja: async () => Buffer.from('%PDF-falso'),
}))

vi.mock('./archivar-documento', () => ({
  archivarPdfEnBloque: async () => ({
    ok: true as const, url: 'https://drive.google.com/file/d/rc/view', bloqueConfigId: 'bloque-recibo',
  }),
}))

import { emitirReciboDeCobro } from './recibos'

const OPC = { bloqueReciboSlug: 'recibo_caja_upme', concepto: 'Dinero recibido del cliente' }

beforeEach(() => {
  cobros = {
    [COBRO_1]: { id: COBRO_1, negocio_id: NEG, monto: 400_000, siigo_recibo: null, anulado_at: null },
    [COBRO_2]: { id: COBRO_2, negocio_id: NEG, monto: 450_000, siigo_recibo: null, anulado_at: null },
  }
  clavesUsadas = []
  observacionesUsadas = []
  avisos = []
  consecutivo = 0
})

describe('emitirReciboDeCobro — un recibo por cobro, no por negocio', () => {
  it('el segundo pago del mismo negocio también emite, con número propio', async () => {
    const primero = await emitirReciboDeCobro(WS, COBRO_1, null, OPC)
    const segundo = await emitirReciboDeCobro(WS, COBRO_2, null, OPC)

    expect(primero.ok).toBe(true)
    expect(segundo.ok).toBe(true)
    expect(primero.ok && primero.numero).toBe('RC-1-1')
    expect(segundo.ok && segundo.numero).toBe('RC-1-2')
  })

  it('cada cobro lleva su propia clave de idempotencia', async () => {
    await emitirReciboDeCobro(WS, COBRO_1, null, OPC)
    await emitirReciboDeCobro(WS, COBRO_2, null, OPC)

    expect(clavesUsadas).toHaveLength(2)
    expect(clavesUsadas[0]).not.toBe(clavesUsadas[1])
  })

  it('la marca queda en el COBRO, y cada cobro guarda la suya', async () => {
    await emitirReciboDeCobro(WS, COBRO_1, null, OPC)
    await emitirReciboDeCobro(WS, COBRO_2, null, OPC)

    expect((cobros[COBRO_1].siigo_recibo as { numero: string }).numero).toBe('RC-1-1')
    expect((cobros[COBRO_2].siigo_recibo as { numero: string }).numero).toBe('RC-1-2')
    expect((cobros[COBRO_1].siigo_recibo as { valor: number }).valor).toBe(400_000)
    expect((cobros[COBRO_2].siigo_recibo as { valor: number }).valor).toBe(450_000)
  })

  it('el MISMO cobro dos veces no emite dos recibos', async () => {
    await emitirReciboDeCobro(WS, COBRO_1, null, OPC)
    const repetido = await emitirReciboDeCobro(WS, COBRO_1, null, OPC)

    expect(repetido.ok).toBe(false)
    expect(!repetido.ok && repetido.motivo).toBe('ya_emitido')
    expect(clavesUsadas).toHaveLength(1)
  })

  it('el valor sale del cobro, y lo escrito a mano lo pisa', async () => {
    const auto = await emitirReciboDeCobro(WS, COBRO_1, null, OPC)
    expect(auto.ok && auto.valor).toBe(400_000)

    const corregido = await emitirReciboDeCobro(WS, COBRO_2, null, { ...OPC, valorPagado: 999_000 })
    expect(corregido.ok && corregido.valor).toBe(999_000)
  })

  it('un cobro anulado no emite: no hay plata que acusar', async () => {
    cobros[COBRO_1].anulado_at = '2026-09-02T10:00:00.000Z'
    const r = await emitirReciboDeCobro(WS, COBRO_1, null, OPC)

    expect(r.ok).toBe(false)
    expect(!r.ok && r.motivo).toBe('anulado')
    expect(clavesUsadas).toHaveLength(0)
  })

  it('sin concepto no emite: un documento contable no sale con un texto inventado', async () => {
    const r = await emitirReciboDeCobro(WS, COBRO_1, null, { bloqueReciboSlug: 'recibo_caja_upme' })

    expect(r.ok).toBe(false)
    expect(!r.ok && r.motivo).toBe('faltan_datos')
    expect(clavesUsadas).toHaveLength(0)
  })

  it('el concepto viaja a Siigo y ya no está cableado a la UPME', async () => {
    await emitirReciboDeCobro(WS, COBRO_1, null, { ...OPC, concepto: 'Abono a honorarios' })
    expect(observacionesUsadas).toEqual(['Abono a honorarios'])
  })
})

describe('emitirReciboDeCobro — el aviso al cliente', () => {
  it('se pide cuando lo piden, con el bloque donde quedó el documento', async () => {
    await emitirReciboDeCobro(WS, COBRO_1, null, { ...OPC, avisarAlCliente: true })
    expect(avisos).toEqual([{ negocio: NEG, bloque: 'bloque-recibo' }])
  })

  it('no se pide si no lo piden', async () => {
    await emitirReciboDeCobro(WS, COBRO_1, null, OPC)
    expect(avisos).toEqual([])
  })
})
