/**
 * El honorario de cada pago se ABONA a la factura, sea que el pago llegue antes o después.
 *
 * Brief del 2026-09-22 (Mauricio): la factura sale en cualquier momento, a crédito, y la
 * cuenta por cobrar que abre la cierran los pagos. La porción honorario de un pago deja de
 * ser un anticipo suelto (RC-1 `AdvancePayment`) y pasa a ser un abono (RC-1
 * `DebtPayment`) que cruza la factura. La porción UPME sigue siendo el RC-3 de siempre.
 *
 * Las seis pruebas mínimas del brief, una por `describe`:
 *
 *   1. factura antes del pago, luego el pago  → abono por el honorario + RC-3 por la UPME
 *   2. pago antes de la factura, luego la factura → al facturar sale el abono de los previos
 *   3. un cobro con RC-1 de anticipo ya emitido → no sale abono
 *   4. honorario mayor al saldo de la factura  → el abono llega solo hasta el saldo
 *   5. pago con retención                      → no sale abono, queda marcado
 *   6. reintento tras un fallo parcial         → no se duplica nada
 *
 * Más la regla 6 (la fecha), que no se pudo probar contra el Siigo real: se prueban los
 * DOS desenlaces posibles, porque no se sabe cuál de los dos pasa.
 *
 * ⚠️ El Siigo de este archivo es un SIMULADOR con estado, no un doble mudo: el saldo de la
 * factura baja con cada abono (así el tope se prueba contra lo que Siigo diría después de
 * cada documento), y una clave de idempotencia repetida devuelve el comprobante que ya
 * existe, que es lo que documenta Siigo. Sin eso, "no se duplica nada" pasaría aunque ONE
 * reemitiera: el doble no sabría que el documento ya existía.
 *
 * Las cifras son las de SOENA: honorario $637.500 (plan 50/50 = dos tramos de $318.750),
 * tarifa UPME $701.812, comprobantes 4594 (RC-1) y 33546 (RC-3), forma de pago del recibo
 * 1059 y de la factura 1055, leídos de producción el 2026-09-22.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const WS = 'ws-soena'
const NEG = 'neg-v0502'
const LINEA = 'linea-ve'
const CLIENTE = '80815711'
const HONORARIO = 637_500
const TRAMO = 318_750
const TARIFA = 701_812

const RC1 = 4594
const RC3 = 33546

// ─── La base: un mini motor de consultas con estado ──────────────────────────

type Fila = Record<string, unknown>
let tablas: Record<string, Fila[]>
let avisos: string[]
/** Lo que se archivó en el bloque del recibo, en orden. */
let archivados: Array<{ numero_recibo: unknown; entrada: Fila | undefined }>

function consulta(tabla: string) {
  const filtros: Array<(f: Fila) => boolean> = []
  let orden: { campo: string; asc: boolean } | null = null
  let rango: [number, number] | null = null
  let parche: Fila | null = null

  const filas = () => {
    let out = (tablas[tabla] ?? []).filter(f => filtros.every(p => p(f)))
    if (orden) {
      const { campo, asc } = orden
      out = [...out].sort((a, b) => String(a[campo] ?? '').localeCompare(String(b[campo] ?? '')) * (asc ? 1 : -1))
    }
    if (rango) out = out.slice(rango[0], rango[1] + 1)
    return out
  }
  // `select('…, siigo_factura:metadata->siigo_factura')` de la cola de reclamos.
  const proyectar = (f: Fila) => ({
    ...structuredClone(f),
    siigo_factura: (f.metadata as Fila | undefined)?.siigo_factura ?? null,
  })

  const chain = {
    select: () => chain,
    eq: (c: string, v: unknown) => { filtros.push(f => f[c] === v); return chain },
    is: (c: string, v: unknown) => { filtros.push(f => (v === null ? f[c] == null : f[c] === v)); return chain },
    not: (c: string, op: string, v: unknown) => {
      filtros.push(f => (op === 'is' && v === null ? f[c] != null : f[c] !== v)); return chain
    },
    in: (c: string, vs: unknown[]) => { filtros.push(f => vs.includes(f[c])); return chain },
    order: (c: string, o?: { ascending?: boolean }) => { orden = { campo: c, asc: o?.ascending !== false }; return chain },
    range: (a: number, b: number) => { rango = [a, b]; return chain },
    limit: () => chain,
    single: async () => {
      const [f] = filas()
      return f ? { data: proyectar(f), error: null } : { data: null, error: { message: 'no existe' } }
    },
    maybeSingle: async () => {
      const [f] = filas()
      return { data: f ? proyectar(f) : null, error: null }
    },
    update: (p: Fila) => { parche = p; return chain },
    then: (resolve: (v: { data: unknown; error: null }) => unknown) => {
      if (parche) {
        for (const f of filas()) Object.assign(f, structuredClone(parche))
        return resolve({ data: null, error: null })
      }
      return resolve({ data: filas().map(proyectar), error: null })
    },
  }
  return chain
}

function servicioFalso() {
  return {
    from: (tabla: string) => consulta(tabla),
    rpc: async (nombre: string, args: Record<string, string>) => {
      if (nombre === 'avisar_documento_al_cliente') avisos.push(args.p_negocio_id)
      return { data: true, error: null }
    },
  }
}

vi.mock('@/lib/supabase/server', () => ({
  createServiceClient: () => servicioFalso(),
  createClient: async () => servicioFalso(),
}))

// ─── Siigo: un simulador con saldo e idempotencia ────────────────────────────

interface FacturaSim {
  id: string; name: string; number: number; date: string; total: number; balance: number
  customer: { identification: string; branch_office: number }
  payments: Array<{ id: number; value: number; due_date: string }>
}
interface VoucherSim {
  id: string; name: string; date: string; type: string
  document: { id: number }; customer: { identification: string }
  items?: Array<{ due: { prefix: string; consecutive: number }; value: number }>
  payment: { value: number }; observations?: string
}

let facturas: Record<string, FacturaSim>
let vouchers: VoucherSim[]
let porClave: Map<string, VoucherSim>
/** Cada POST a `/v1/vouchers`, incluidos los que Siigo rechazó. */
let postsVoucher: Array<{ body: VoucherSim; clave: string; rechazado: boolean }>
let consecutivos: Record<number, number>
/** Si devuelve un error, Siigo rechaza ese POST (y NO crea el documento). */
let rechazar: ((body: VoucherSim) => Error | null) | null

vi.mock('./client', async () => {
  const real = await vi.importActual<typeof import('./client')>('./client')
  return {
    ...real,
    getSiigoConfig: async () => ({
      facturaDocumentId: 32055, reciboDocumentId: RC1, sellerId: 119,
      productoCode: '11', ivaId: 2467, facturaPaymentId: 1055, reciboPaymentId: 1059,
    }),
    siigoRequest: async (
      _ws: string,
      ruta: string,
      opts?: { method?: string; body?: unknown; idempotencyKey?: string },
    ) => {
      const metodo = opts?.method ?? 'GET'
      if (metodo === 'GET' && ruta.startsWith('/v1/invoices?')) return { results: [] }
      if (metodo === 'GET' && ruta.endsWith('/pdf')) return {}
      if (metodo === 'GET' && ruta.startsWith('/v1/invoices/')) {
        const id = decodeURIComponent(ruta.slice('/v1/invoices/'.length))
        const f = facturas[id]
        if (!f) throw new real.SiigoError('Invoice not found', 404)
        return structuredClone(f)
      }
      if (metodo === 'GET' && ruta.startsWith('/v1/vouchers?')) {
        const doc = Number(new URLSearchParams(ruta.split('?')[1]).get('document_id'))
        return { results: vouchers.filter(v => v.document.id === doc).map(v => structuredClone(v)) }
      }
      if (metodo === 'POST' && ruta === '/v1/invoices') {
        const body = opts!.body as { date: string; customer: { identification: string }; payments: Array<{ value: number; due_date: string }> }
        const n = Object.keys(facturas).length + 600
        const f: FacturaSim = {
          id: `fv-${n}`, name: `FV-2-${n}`, number: n, date: body.date,
          total: body.payments[0].value, balance: body.payments[0].value,
          customer: { identification: body.customer.identification, branch_office: 0 },
          payments: [{ id: 1055, value: body.payments[0].value, due_date: body.payments[0].due_date }],
        }
        facturas[f.id] = f
        return { id: f.id, name: f.name, total: f.total }
      }
      if (metodo === 'POST' && ruta === '/v1/vouchers') {
        const body = structuredClone(opts!.body) as VoucherSim
        const clave = opts?.idempotencyKey ?? '(sin clave)'
        // Idempotencia de Siigo: la misma clave devuelve el comprobante que ya existe.
        const previo = porClave.get(clave)
        if (previo) {
          postsVoucher.push({ body, clave, rechazado: false })
          return { id: previo.id, name: previo.name, date: previo.date }
        }
        const error = rechazar?.(body) ?? null
        postsVoucher.push({ body, clave, rechazado: !!error })
        if (error) throw error
        const doc = body.document.id
        consecutivos[doc] = (consecutivos[doc] ?? 0) + 1
        const v: VoucherSim = {
          ...body, id: `v-${doc}-${consecutivos[doc]}`,
          name: `RC-${doc === RC1 ? 1 : 3}-${consecutivos[doc]}`,
        }
        if (body.type === 'DebtPayment') {
          const due = body.items![0].due
          const f = Object.values(facturas).find(x => x.name === `${due.prefix}-${due.consecutive}`)
          if (!f) throw new real.SiigoError('Due not found', 400)
          f.balance = Math.round((f.balance - body.items![0].value) * 100) / 100
        }
        vouchers.push(v)
        porClave.set(clave, v)
        return { id: v.id, name: v.name, date: v.date }
      }
      throw new Error(`ruta inesperada en el simulador: ${metodo} ${ruta}`)
    },
  }
})

vi.mock('./clientes', () => ({
  asegurarClienteSiigo: async () => ({
    estado: 'ya_existia' as const, identificacion: CLIENTE, siigo_id: 'cli-1', branch_office: 0, nombre: 'CLIENTE PRUEBA',
  }),
  corregirContactoParaFactura: async () => ({ ok: true as const, cambiado: false }),
  identificacionDelNegocio: async () => ({ identificacion: CLIENTE }),
}))
vi.mock('./concepto-negocio', () => ({
  resolverConceptoDeNegocio: async () => ({ code: '11', servicio: 'completo', porDefecto: false }),
}))
vi.mock('@/lib/pdf/pdf-render-client', () => ({ renderReciboCaja: async () => Buffer.from('%PDF') }))
vi.mock('./archivar-documento', () => ({
  archivarPdfEnBloque: async (...args: unknown[]) => {
    const campos = args[5] as { numero_recibo?: unknown } | undefined
    const historial = args[6] as { entrada?: Fila } | undefined
    archivados.push({ numero_recibo: campos?.numero_recibo, entrada: historial?.entrada })
    return { ok: true as const, url: `https://drive/${archivados.length}`, driveFileId: `d-${archivados.length}`, bloqueConfigId: 'blq-recibo' }
  },
}))
/** Una factura CARGADA en el bloque, sin vínculo a Siigo. Null = no hay. */
let facturaCargada: string | null
vi.mock('@/lib/facturacion/leer-factura-del-negocio', () => ({
  leerFacturaDeUnNegocio: async () =>
    facturaCargada ? { resolucion: { factura: { numero: facturaCargada } } } : null,
}))
vi.mock('@/app/(app)/negocios/negocio-v2-actions', () => ({ cerrarNegocioSiQuedaResuelto: async () => {} }))

import { SiigoError } from './client'
import { emitirReciboDeCobro } from './recibos'
import { emitirReciboAutomatico } from './recibo-automatico'
import { abonarPagosPreviosALaFactura } from './abonos-factura'
import { emitirFacturaNegocio } from './facturas'
import { abonosAManoDelCobro, leerReciboPorConcepto, recibosDelCobro } from './recibo-componentes'

// ─── La configuración de SOENA, con el honorario como abono ─────────────────

const SIIGO_LINEA = {
  recibo_automatico: true,
  bloque_recibo_slug: 'recibo_caja_upme',
  bloque_factura_slug: 'factura_emitida',
  recibo_concepto: 'Dinero recibido del cliente',
  recibo_por_concepto: {
    honorario: { document_id: RC1, concepto: 'Honorarios de asesoría', tipo: 'abono' },
    pasante: { document_id: RC3, concepto: 'Recaudo pago certificación UPME' },
  },
}
const POR_CONCEPTO = leerReciboPorConcepto(SIIGO_LINEA)!

function cobro(id: string, p: {
  fecha: string; honorario: number; tarifa: number; retencion?: number; siigo_recibo?: unknown
}) {
  tablas.cobros.push({
    id, negocio_id: NEG, workspace_id: WS, monto: p.honorario + p.tarifa, fecha: p.fecha,
    tipo_cobro: 'pago', siigo_recibo: p.siigo_recibo ?? null, anulado_at: null,
    retencion: p.retencion ?? 0, recibo_no_aplica: null,
  })
  tablas.v_cobro_valor.push({ cobro_id: id, workspace_id: WS, a_tramo1: p.honorario, a_tramo2: 0, a_tarifa: p.tarifa, excedente: 0 })
}

/** Una factura que ya existe en Siigo y que el negocio ya tiene marcada. */
function facturaEmitida(p: { saldo?: number; fecha?: string } = {}) {
  const f: FacturaSim = {
    id: 'fv-540', name: 'FV-2-540', number: 540, date: p.fecha ?? '2026-09-10',
    total: HONORARIO, balance: p.saldo ?? HONORARIO,
    customer: { identification: CLIENTE, branch_office: 0 },
    payments: [{ id: 1055, value: HONORARIO, due_date: p.fecha ?? '2026-09-10' }],
  }
  facturas[f.id] = f
  negocio().metadata = { siigo_factura: { numero: 'FV-2-540', siigo_id: 'fv-540', total: HONORARIO, emitida: true } }
  return f
}

const negocio = () => tablas.negocios[0]
const marcas = (id: string) => recibosDelCobro(tablas.cobros.find(c => c.id === id)!.siigo_recibo)
const aMano = (id: string) => abonosAManoDelCobro(tablas.cobros.find(c => c.id === id)!.siigo_recibo)
const creados = () => postsVoucher.filter(p => !p.rechazado)

beforeEach(() => {
  tablas = {
    negocios: [{
      id: NEG, workspace_id: WS, codigo: 'V0502', nombre: 'CLIENTE PRUEBA - VEHÍCULO',
      linea_id: LINEA, precio_aprobado: HONORARIO, metadata: {},
    }],
    lineas_negocio: [{ id: LINEA, workspace_id: WS, config_extra: { siigo: SIIGO_LINEA } }],
    cobros: [],
    v_cobro_valor: [],
  }
  facturas = {}
  vouchers = []
  porClave = new Map()
  postsVoucher = []
  consecutivos = {}
  rechazar = null
  avisos = []
  archivados = []
  facturaCargada = null
})

afterEach(() => { vi.useRealTimers() })

// ─────────────────────────────────────────────────────────────────────────────
// 1. Factura antes del pago, y luego el pago
// ─────────────────────────────────────────────────────────────────────────────

describe('1 · la factura ya existe cuando entra el pago', () => {
  it('sale el ABONO por el honorario y el RC-3 por la UPME', async () => {
    const f = facturaEmitida()
    cobro('cob-mixto', { fecha: '2026-09-15', honorario: HONORARIO, tarifa: TARIFA })

    await emitirReciboAutomatico(WS, 'cob-mixto')

    expect(creados()).toHaveLength(2)
    const [abono, rc3] = creados().map(p => p.body)
    // El abono tiene la forma de RC-1-22: un ítem contra el vencimiento de la factura.
    expect(abono).toMatchObject({
      type: 'DebtPayment',
      document: { id: RC1 },
      date: '2026-09-15',
      customer: { identification: CLIENTE, branch_office: 0 },
      items: [{ due: { prefix: 'FV-2', consecutive: 540, quote: 1, date: '2026-09-10' }, value: HONORARIO }],
      payment: { id: 1059, value: HONORARIO },
    })
    expect(rc3).toMatchObject({ type: 'AdvancePayment', document: { id: RC3 }, payment: { value: TARIFA } })
    // Y la cuenta por cobrar quedó cerrada: es para lo que existe el abono.
    expect(f.balance).toBe(0)
  })

  it('la marca dice que es un abono y a qué factura', async () => {
    facturaEmitida()
    cobro('cob-mixto', { fecha: '2026-09-15', honorario: HONORARIO, tarifa: TARIFA })
    await emitirReciboAutomatico(WS, 'cob-mixto')

    const [hon, pas] = marcas('cob-mixto')
    expect(hon).toMatchObject({ componente: 'honorario', tipo: 'abono', factura: { numero: 'FV-2-540', siigo_id: 'fv-540' }, valor: HONORARIO })
    expect(hon).not.toHaveProperty('sin_abonar')
    // El RC-3 sigue siendo el anticipo de siempre: sin `tipo`.
    expect(pas).toMatchObject({ componente: 'pasante', valor: TARIFA })
    expect(pas).not.toHaveProperty('tipo')
  })

  it('el cliente recibe UN aviso, con los dos documentos en el historial del bloque', async () => {
    facturaEmitida()
    cobro('cob-mixto', { fecha: '2026-09-15', honorario: HONORARIO, tarifa: TARIFA })
    await emitirReciboAutomatico(WS, 'cob-mixto')

    expect(avisos).toEqual([NEG])
    expect(archivados.map(a => a.entrada)).toMatchObject([
      { componente: 'honorario', tipo: 'abono', factura: 'FV-2-540', concepto: 'Honorarios de asesoría · abono a la factura FV-2-540' },
      { componente: 'pasante', concepto: 'Recaudo pago certificación UPME' },
    ])
  })

  it('el abono y el anticipo usan claves de idempotencia distintas', async () => {
    facturaEmitida()
    cobro('cob-mixto', { fecha: '2026-09-15', honorario: HONORARIO, tarifa: TARIFA })
    await emitirReciboAutomatico(WS, 'cob-mixto')

    expect(creados().map(p => p.clave)).toEqual(['cobmixtoabhon', 'cobmixtorcpas'])
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// 2. Pago antes de la factura, y luego la factura
// ─────────────────────────────────────────────────────────────────────────────

describe('2 · los pagos llegan antes que la factura', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-09-22T15:00:00Z'))
  })

  it('sin factura: el pago mixto sale SOLO con su RC-3, y el de puro honorario no emite nada', async () => {
    cobro('cob-1', { fecha: '2026-09-01', honorario: TRAMO, tarifa: TARIFA })
    cobro('cob-2', { fecha: '2026-09-05', honorario: TRAMO, tarifa: 0 })

    const r1 = await emitirReciboDeCobro(WS, 'cob-1', 'Diana', { porConcepto: POR_CONCEPTO, bloqueReciboSlug: 'recibo_caja_upme', avisarAlCliente: true })
    const r2 = await emitirReciboDeCobro(WS, 'cob-2', 'Diana', { porConcepto: POR_CONCEPTO, bloqueReciboSlug: 'recibo_caja_upme', avisarAlCliente: true })

    expect(r1).toMatchObject({ ok: true, honorario_espera_factura: true })
    expect(creados().map(p => p.body.document.id)).toEqual([RC3])
    // Regla 8: el pago de puro honorario sin factura no emite nada y NO se avisa.
    expect(r2).toEqual({ ok: false, motivo: 'espera_factura' })
    expect(avisos).toEqual([NEG]) // solo el del RC-3 del primero
  })

  it('al FACTURAR, sale el abono de cada pago anterior y la factura queda en cero', async () => {
    cobro('cob-1', { fecha: '2026-09-01', honorario: TRAMO, tarifa: TARIFA })
    cobro('cob-2', { fecha: '2026-09-05', honorario: TRAMO, tarifa: 0 })
    await emitirReciboDeCobro(WS, 'cob-1', 'Diana', { porConcepto: POR_CONCEPTO, bloqueReciboSlug: 'recibo_caja_upme' })
    await emitirReciboDeCobro(WS, 'cob-2', 'Diana', { porConcepto: POR_CONCEPTO, bloqueReciboSlug: 'recibo_caja_upme' })
    avisos = []

    const r = await emitirFacturaNegocio(WS, NEG, 'Diana', { emitir: true, bloqueFacturaSlug: 'factura_emitida' })

    expect(r.ok).toBe(true)
    const abonos = creados().filter(p => p.body.type === 'DebtPayment')
    // Uno por pago, del más viejo al más nuevo, cada uno por su honorario.
    expect(abonos.map(p => [p.clave, p.body.items![0].value])).toEqual([
      ['cob1abhon', TRAMO],
      ['cob2abhon', TRAMO],
    ])
    expect(r.ok && r.abonos.emitidos.map(a => a.cobro_id)).toEqual(['cob-1', 'cob-2'])
    const factura = Object.values(facturas)[0]
    expect(factura.balance).toBe(0)
  })

  it('⚠️ el segundo abono del MISMO valor no se confunde con un duplicado', async () => {
    // El plan 50/50 produce dos abonos de $318.750 contra la misma factura. El guardián
    // de duplicados busca abonos del cliente por el mismo valor: sin excluir los que ONE
    // ya le conoce a este negocio, el segundo pediría justificación siempre.
    cobro('cob-1', { fecha: '2026-09-01', honorario: TRAMO, tarifa: 0 })
    cobro('cob-2', { fecha: '2026-09-05', honorario: TRAMO, tarifa: 0 })

    const r = await emitirFacturaNegocio(WS, NEG, 'Diana', { emitir: true })

    expect(r.ok && r.abonos.fallidos).toEqual([])
    expect(r.ok && r.abonos.emitidos).toHaveLength(2)
  })

  it('al facturar NO se le avisa al cliente por los pagos viejos', async () => {
    cobro('cob-1', { fecha: '2026-09-01', honorario: TRAMO, tarifa: 0 })
    await emitirFacturaNegocio(WS, NEG, 'Diana', { emitir: true })
    expect(avisos).toEqual([])
  })

  it('no toca la tarifa: el RC-3 de esos pagos no es asunto de la factura', async () => {
    cobro('cob-1', { fecha: '2026-09-01', honorario: TRAMO, tarifa: TARIFA })
    await emitirFacturaNegocio(WS, NEG, 'Diana', { emitir: true })
    expect(creados().map(p => p.body.type)).toEqual(['DebtPayment'])
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// 3. Un cobro que ya tiene su RC-1 de anticipo
// ─────────────────────────────────────────────────────────────────────────────

describe('3 · un cobro con RC-1 de anticipo ya emitido', () => {
  /** RC-1-80 de V0502: el honorario ya salió como anticipo suelto. */
  const ANTICIPO = [{
    numero: 'RC-1-80', siigo_id: 'x', valor: HONORARIO, archivo_url: null, at: '', por: 'Diana', componente: 'honorario',
  }]

  it('al entrar la factura, NO recibe abono: Tesorería lo cruza o lo anula a mano', async () => {
    cobro('cob-v0502', { fecha: '2026-09-15', honorario: HONORARIO, tarifa: 0, siigo_recibo: ANTICIPO })

    const r = await emitirFacturaNegocio(WS, NEG, 'Diana', { emitir: true })

    expect(r.ok && r.abonos.emitidos).toEqual([])
    expect(creados()).toHaveLength(0)
    const factura = Object.values(facturas)[0]
    expect(factura.balance).toBe(HONORARIO)
  })

  it('ni reintentándolo desde Tesorería: dos documentos por la misma plata no se deshacen', async () => {
    facturaEmitida()
    cobro('cob-v0502', { fecha: '2026-09-15', honorario: HONORARIO, tarifa: 0, siigo_recibo: ANTICIPO })

    const r = await emitirReciboDeCobro(WS, 'cob-v0502', 'Diana', { porConcepto: POR_CONCEPTO })

    expect(r).toMatchObject({ ok: false, motivo: 'ya_emitido', numero: 'RC-1-80' })
    expect(postsVoucher).toHaveLength(0)
  })

  it('una marca VIEJA por el total tampoco recibe abono', async () => {
    facturaEmitida()
    cobro('cob-viejo', {
      fecha: '2026-09-15', honorario: HONORARIO, tarifa: TARIFA,
      siigo_recibo: { numero: 'RC-1-67', siigo_id: 'y', valor: HONORARIO + TARIFA, archivo_url: null, at: '', por: null },
    })
    const r = await abonarPagosPreviosALaFactura(WS, NEG, 'Diana')
    expect(r.emitidos).toEqual([])
    expect(postsVoucher).toHaveLength(0)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// 4. Honorario mayor al saldo de la factura
// ─────────────────────────────────────────────────────────────────────────────

describe('4 · el honorario del pago es mayor que el saldo de la factura', () => {
  it('el abono llega SOLO hasta el saldo, y la marca dice cuánto no cupo', async () => {
    // Tesorería ya había cruzado $437.500 a mano: Siigo reporta $200.000 de saldo.
    const f = facturaEmitida({ saldo: 200_000 })
    cobro('cob-1', { fecha: '2026-09-15', honorario: HONORARIO, tarifa: 0 })

    const r = await emitirReciboDeCobro(WS, 'cob-1', 'Diana', { porConcepto: POR_CONCEPTO })

    expect(r.ok).toBe(true)
    expect(creados()[0].body).toMatchObject({ items: [{ value: 200_000 }], payment: { value: 200_000 } })
    expect(marcas('cob-1')[0]).toMatchObject({ tipo: 'abono', valor: 200_000, sin_abonar: 437_500 })
    // Nunca negativo: el abono no pasa del saldo.
    expect(f.balance).toBe(0)
  })

  it('con la factura ya saldada NO se abona nada, y queda marcado como sobrepago', async () => {
    const f = facturaEmitida({ saldo: 0 })
    cobro('cob-1', { fecha: '2026-09-15', honorario: HONORARIO, tarifa: 0 })

    const r = await emitirReciboDeCobro(WS, 'cob-1', 'Diana', { porConcepto: POR_CONCEPTO })

    expect(r).toMatchObject({ ok: false, motivo: 'abono_a_mano' })
    expect(postsVoucher).toHaveLength(0)
    expect(aMano('cob-1')).toMatchObject([{ componente: 'honorario', abono_a_mano: { motivo: 'factura_saldada' }, valor: HONORARIO }])
    expect(f.balance).toBe(0)
  })

  it('en el plan 50/50 con sobrepago, el segundo abono se topa en lo que quedó', async () => {
    // Pagó $318.750 y después $400.000: el segundo solo cabe hasta $318.750.
    cobro('cob-1', { fecha: '2026-09-01', honorario: TRAMO, tarifa: 0 })
    cobro('cob-2', { fecha: '2026-09-05', honorario: 400_000, tarifa: 0 })

    const r = await emitirFacturaNegocio(WS, NEG, 'Diana', { emitir: true })

    expect(r.ok && r.abonos.emitidos.map(a => a.valor)).toEqual([TRAMO, TRAMO])
    expect(marcas('cob-2')[0]).toMatchObject({ valor: TRAMO, sin_abonar: 400_000 - TRAMO })
    expect(Object.values(facturas)[0].balance).toBe(0)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// 5. Pago con retención
// ─────────────────────────────────────────────────────────────────────────────

describe('5 · pago con retención', () => {
  it('NO sale el abono y queda marcado para Tesorería; la tarifa sí sale', async () => {
    const f = facturaEmitida()
    cobro('cob-ret', { fecha: '2026-09-15', honorario: HONORARIO - 50_000, tarifa: TARIFA, retencion: 50_000 })

    const r = await emitirReciboDeCobro(WS, 'cob-ret', 'Diana', { porConcepto: POR_CONCEPTO, bloqueReciboSlug: 'recibo_caja_upme' })

    expect(r).toMatchObject({ ok: true, a_mano: [{ componente: 'honorario', motivo: 'retencion' }] })
    expect(creados().map(p => p.body.type)).toEqual(['AdvancePayment'])
    expect(f.balance).toBe(HONORARIO)
    // ⚠️ El RC-3 se escribió DESPUÉS del «a mano» y no lo borró.
    expect(aMano('cob-ret')).toMatchObject([{ componente: 'honorario', abono_a_mano: { motivo: 'retencion' } }])
    expect(marcas('cob-ret').map(m => m.componente)).toEqual(['pasante'])
  })

  it('un pago de puro honorario con retención no emite nada, pero queda marcado', async () => {
    facturaEmitida()
    cobro('cob-ret', { fecha: '2026-09-15', honorario: HONORARIO - 50_000, tarifa: 0, retencion: 50_000 })

    const r = await emitirReciboDeCobro(WS, 'cob-ret', 'Diana', { porConcepto: POR_CONCEPTO })

    expect(r).toMatchObject({ ok: false, motivo: 'abono_a_mano' })
    expect(postsVoucher).toHaveLength(0)
    expect(aMano('cob-ret')).toHaveLength(1)
  })

  it('al facturar, el pago con retención tampoco se abona: queda para Tesorería', async () => {
    cobro('cob-ret', { fecha: '2026-09-01', honorario: HONORARIO - 50_000, tarifa: 0, retencion: 50_000 })

    const r = await emitirFacturaNegocio(WS, NEG, 'Diana', { emitir: true })

    expect(r.ok && r.abonos.emitidos).toEqual([])
    expect(r.ok && r.abonos.a_mano).toMatchObject([{ cobro_id: 'cob-ret', motivo: 'retencion' }])
    expect(creados()).toHaveLength(0)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// 6. Reintento después de un fallo parcial
// ─────────────────────────────────────────────────────────────────────────────

describe('6 · reintento después de un fallo parcial', () => {
  it('el abono salió y el RC-3 falló: el reintento emite SOLO el RC-3', async () => {
    const f = facturaEmitida()
    cobro('cob-mixto', { fecha: '2026-09-15', honorario: HONORARIO, tarifa: TARIFA })

    rechazar = body => (body.document.id === RC3 ? new SiigoError('Siigo no responde', 503) : null)
    const primero = await emitirReciboDeCobro(WS, 'cob-mixto', 'Diana', { porConcepto: POR_CONCEPTO })
    expect(primero.ok).toBe(false)
    expect(marcas('cob-mixto').map(m => m.componente)).toEqual(['honorario'])

    rechazar = null
    const segundo = await emitirReciboDeCobro(WS, 'cob-mixto', 'Diana', { porConcepto: POR_CONCEPTO })

    expect(segundo.ok).toBe(true)
    // En Siigo quedaron exactamente DOS documentos, y la factura abonada UNA vez.
    expect(vouchers.map(v => v.type)).toEqual(['DebtPayment', 'AdvancePayment'])
    expect(f.balance).toBe(0)
    expect(marcas('cob-mixto').map(m => m.componente)).toEqual(['honorario', 'pasante'])
  })

  it('un tercer intento no produce nada: todo está acusado', async () => {
    facturaEmitida()
    cobro('cob-mixto', { fecha: '2026-09-15', honorario: HONORARIO, tarifa: TARIFA })
    await emitirReciboDeCobro(WS, 'cob-mixto', 'Diana', { porConcepto: POR_CONCEPTO })
    const antes = postsVoucher.length

    const r = await emitirReciboDeCobro(WS, 'cob-mixto', 'Diana', { porConcepto: POR_CONCEPTO })
    expect(r).toMatchObject({ ok: false, motivo: 'ya_emitido' })
    expect(postsVoucher.length).toBe(antes)
  })

  it('al facturar, un abono que falla deja a los demás, y el reintento solo hace el que faltó', async () => {
    cobro('cob-1', { fecha: '2026-09-01', honorario: TRAMO, tarifa: 0 })
    cobro('cob-2', { fecha: '2026-09-05', honorario: TRAMO, tarifa: 0 })
    rechazar = body => (body.date === '2026-09-05' ? new SiigoError('Siigo no responde', 503) : null)

    const r = await emitirFacturaNegocio(WS, NEG, 'Diana', { emitir: true })
    expect(r.ok && r.abonos.emitidos.map(a => a.cobro_id)).toEqual(['cob-1'])
    expect(r.ok && r.abonos.fallidos.map(a => a.cobro_id)).toEqual(['cob-2'])

    rechazar = null
    const again = await abonarPagosPreviosALaFactura(WS, NEG, 'Diana')

    expect(again.emitidos.map(a => a.cobro_id)).toEqual(['cob-2'])
    expect(vouchers).toHaveLength(2)
    expect(Object.values(facturas)[0].balance).toBe(0)
  })

  it('si la marca se perdió, la clave de idempotencia devuelve el MISMO abono de Siigo', async () => {
    // El abono salió pero la escritura en ONE no quedó: el reintento manda la misma
    // clave y Siigo devuelve el comprobante que ya existe, en vez de crear otro.
    facturaEmitida({ saldo: HONORARIO * 2 })
    cobro('cob-1', { fecha: '2026-09-15', honorario: HONORARIO, tarifa: 0 })
    await emitirReciboDeCobro(WS, 'cob-1', 'Diana', { porConcepto: POR_CONCEPTO })
    const numero = marcas('cob-1')[0].numero
    tablas.cobros[0].siigo_recibo = null

    await emitirReciboDeCobro(WS, 'cob-1', 'Diana', { porConcepto: POR_CONCEPTO, justificacionDuplicado: 'reintento' })

    expect(vouchers).toHaveLength(1)
    expect(marcas('cob-1')[0].numero).toBe(numero)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Regla 6: la fecha. No se sabe si Siigo acepta un abono anterior a la factura, y ninguno
// de los 8 abonos hechos a mano en SOENA lo es. Se prueban los dos desenlaces.
// ─────────────────────────────────────────────────────────────────────────────

describe('la fecha del abono', () => {
  it('va con la fecha del PAGO cuando Siigo la acepta', async () => {
    facturaEmitida({ fecha: '2026-09-10' })
    cobro('cob-1', { fecha: '2026-09-03', honorario: HONORARIO, tarifa: 0 })

    await emitirReciboDeCobro(WS, 'cob-1', 'Diana', { porConcepto: POR_CONCEPTO })

    expect(creados()[0].body.date).toBe('2026-09-03')
    expect(marcas('cob-1')[0]).toMatchObject({ fecha: '2026-09-03', fecha_pago: '2026-09-03', fecha_motivo: null })
  })

  it('si Siigo rechaza la fecha anterior a la factura, se fecha con la de la factura y queda el motivo', async () => {
    facturaEmitida({ fecha: '2026-09-10' })
    cobro('cob-1', { fecha: '2026-09-03', honorario: HONORARIO, tarifa: 0 })
    rechazar = body => (body.type === 'DebtPayment' && body.date < '2026-09-10'
      ? new SiigoError('The date cannot be earlier than the due', 400) : null)

    const r = await emitirReciboDeCobro(WS, 'cob-1', 'Diana', { porConcepto: POR_CONCEPTO })

    expect(r.ok).toBe(true)
    expect(postsVoucher.map(p => [p.body.date, p.rechazado])).toEqual([['2026-09-03', true], ['2026-09-10', false]])
    expect(marcas('cob-1')[0]).toMatchObject({ fecha: '2026-09-10', fecha_pago: '2026-09-03' })
    expect(marcas('cob-1')[0].fecha_motivo).toContain('anterior a la factura FV-2-540')
  })

  it('un rechazo de un pago POSTERIOR a la factura no se reintenta: la fecha no era el problema', async () => {
    facturaEmitida({ fecha: '2026-09-10' })
    cobro('cob-1', { fecha: '2026-09-15', honorario: HONORARIO, tarifa: 0 })
    rechazar = () => new SiigoError('Customer inactive', 400)

    const r = await emitirReciboDeCobro(WS, 'cob-1', 'Diana', { porConcepto: POR_CONCEPTO })

    expect(r).toMatchObject({ ok: false, motivo: 'error' })
    expect(postsVoucher).toHaveLength(1)
  })

  it('un 503 no se trata como problema de fecha', async () => {
    facturaEmitida({ fecha: '2026-09-10' })
    cobro('cob-1', { fecha: '2026-09-03', honorario: HONORARIO, tarifa: 0 })
    rechazar = () => new SiigoError('Service unavailable', 503)

    await emitirReciboDeCobro(WS, 'cob-1', 'Diana', { porConcepto: POR_CONCEPTO })
    expect(postsVoucher).toHaveLength(1)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// La factura que el negocio TIENE pero sin vínculo a Siigo
// ─────────────────────────────────────────────────────────────────────────────

describe('una factura cargada a mano, sin vínculo a Siigo', () => {
  it('no se abona a ciegas: queda para Tesorería con la razón', async () => {
    facturaCargada = 'FV-2-300'
    cobro('cob-1', { fecha: '2026-09-15', honorario: HONORARIO, tarifa: 0 })

    const r = await emitirReciboDeCobro(WS, 'cob-1', 'Diana', { porConcepto: POR_CONCEPTO })

    expect(r).toMatchObject({ ok: false, motivo: 'abono_a_mano', a_mano: [{ motivo: 'factura_sin_vinculo' }] })
    expect(postsVoucher).toHaveLength(0)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// CONTROL: una línea que NO declara el abono se comporta como antes
// ─────────────────────────────────────────────────────────────────────────────

describe('CONTROL · sin `tipo: abono` el honorario sigue siendo anticipo', () => {
  it('con factura y todo, sale el RC-1 AdvancePayment de siempre', async () => {
    facturaEmitida()
    cobro('cob-1', { fecha: '2026-09-15', honorario: HONORARIO, tarifa: 0 })
    const sinAbono = leerReciboPorConcepto({
      recibo_por_concepto: {
        honorario: { document_id: RC1, concepto: 'Honorarios de asesoría' },
        pasante: { document_id: RC3, concepto: 'Recaudo pago certificación UPME' },
      },
    })

    await emitirReciboDeCobro(WS, 'cob-1', 'Diana', { porConcepto: sinAbono })

    expect(creados().map(p => [p.body.type, p.clave])).toEqual([['AdvancePayment', 'cob1rchon']])
  })

  it('y al facturar no se abona nada', async () => {
    tablas.lineas_negocio[0].config_extra = {
      siigo: { ...SIIGO_LINEA, recibo_por_concepto: { honorario: { document_id: RC1, concepto: 'x' } } },
    }
    cobro('cob-1', { fecha: '2026-09-01', honorario: TRAMO, tarifa: 0 })
    const r = await emitirFacturaNegocio(WS, NEG, 'Diana', { emitir: true })
    expect(r.ok && r.abonos).toEqual({ emitidos: [], a_mano: [], fallidos: [] })
    expect(postsVoucher).toHaveLength(0)
  })
})
