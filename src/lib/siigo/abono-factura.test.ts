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
  items?: Array<{ due?: { prefix: string; consecutive: number }; value: number }>
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
/** Cada GET a una factura: preguntarle a Siigo también cuesta, y un «a mano» no lo repite. */
let getsFactura: number
/** Cómo se porta la lista de recibos de Siigo en cada prueba. Vacío = como Siigo. */
let siigoVouchers: {
  /** La lista no trae los ítems: el vencimiento solo sale del detalle. */
  listaSinItems?: boolean
  /** Siigo ignora `page` y devuelve siempre la primera. */
  ignorarPagina?: boolean
  /** Un `total_results` distinto de lo que de verdad hay. */
  totalDeclarado?: number
  fallarPagina?: (pagina: number) => Error | null
  fallarDetalle?: (id: string) => Error | null
}
/** Las páginas de `GET /v1/vouchers` que se pidieron, en orden. */
let paginasPedidas: number[]
/** Los recibos cuyo detalle se pidió (`GET /v1/vouchers/{id}`). */
let detallesPedidos: string[]

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
        getsFactura++
        const id = decodeURIComponent(ruta.slice('/v1/invoices/'.length))
        const f = facturas[id]
        if (!f) throw new real.SiigoError('Invoice not found', 404)
        return structuredClone(f)
      }
      if (metodo === 'GET' && ruta.startsWith('/v1/vouchers?')) {
        // Como Siigo: paginado, con `total_results`. Sin `page`, la primera.
        const q = new URLSearchParams(ruta.split('?')[1])
        const doc = Number(q.get('document_id'))
        const pagina = siigoVouchers.ignorarPagina ? 1 : Number(q.get('page') ?? 1)
        const tam = Number(q.get('page_size') ?? 25)
        paginasPedidas.push(pagina)
        const error = siigoVouchers.fallarPagina?.(pagina) ?? null
        if (error) throw error
        const delDoc = vouchers.filter(v => v.document.id === doc)
        const lote = delDoc.slice((pagina - 1) * tam, pagina * tam).map(v => {
          const copia = structuredClone(v)
          if (siigoVouchers.listaSinItems) delete copia.items
          return copia
        })
        return {
          results: lote,
          pagination: { page: pagina, page_size: tam, total_results: siigoVouchers.totalDeclarado ?? delDoc.length },
        }
      }
      if (metodo === 'GET' && ruta.startsWith('/v1/vouchers/')) {
        const id = decodeURIComponent(ruta.slice('/v1/vouchers/'.length))
        detallesPedidos.push(id)
        const error = siigoVouchers.fallarDetalle?.(id) ?? null
        if (error) throw error
        const v = vouchers.find(x => x.id === id)
        if (!v) throw new real.SiigoError('Voucher not found', 404)
        return structuredClone(v)
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
          const due = body.items![0].due!
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
  guardarCorreccionesDeFactura: async () => ({ ok: true as const, contactoCambiado: false, titularCambiado: false }),
  empujarCorreccionesAlTercero: async () => ({ ok: true as const, empujado: false }),
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
import { alRegistrarCobro, abonarAlRegistrarPago } from './recibo-automatico'
import { abonarPagosDelNegocio } from './abonos-factura'
import { abonarRezago } from './rezago-abonos'
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
  /** Otro negocio del workspace. Sin él, el de siempre. */
  negocio?: string
}) {
  tablas.cobros.push({
    id, negocio_id: p.negocio ?? NEG, workspace_id: WS, monto: p.honorario + p.tarifa, fecha: p.fecha,
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
  getsFactura = 0
  siigoVouchers = {}
  paginasPedidas = []
  detallesPedidos = []
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

    await alRegistrarCobro(WS, 'cob-mixto')

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
    await alRegistrarCobro(WS, 'cob-mixto')

    const [hon, pas] = marcas('cob-mixto')
    expect(hon).toMatchObject({ componente: 'honorario', tipo: 'abono', factura: { numero: 'FV-2-540', siigo_id: 'fv-540' }, valor: HONORARIO })
    expect(hon).not.toHaveProperty('sin_abonar')
    // El RC-3 sigue siendo el anticipo de siempre: sin `tipo`.
    expect(pas).toMatchObject({ componente: 'pasante', valor: TARIFA })
    expect(pas).not.toHaveProperty('tipo')
  })

  it('el cliente recibe UN aviso, y en el bloque queda SOLO el RC-3: el abono no tiene PDF', async () => {
    // Regla 5 del brief del 2026-09-22 (recibo solo UPME): el abono es un asiento interno.
    // El correo se arma con la lista del bloque, así que el cliente lee solo su RC-3.
    facturaEmitida()
    cobro('cob-mixto', { fecha: '2026-09-15', honorario: HONORARIO, tarifa: TARIFA })
    await alRegistrarCobro(WS, 'cob-mixto')

    expect(avisos).toEqual([NEG])
    expect(archivados.map(a => a.entrada)).toMatchObject([
      { componente: 'pasante', concepto: 'Recaudo pago certificación UPME' },
    ])
    expect(archivados).toHaveLength(1)
    // El abono existe en Siigo y en la marca, sin archivo.
    expect(marcas('cob-mixto')[0]).toMatchObject({ componente: 'honorario', tipo: 'abono', archivo_url: null })
  })

  it('el abono y el anticipo usan claves de idempotencia distintas', async () => {
    facturaEmitida()
    cobro('cob-mixto', { fecha: '2026-09-15', honorario: HONORARIO, tarifa: TARIFA })
    await alRegistrarCobro(WS, 'cob-mixto')

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
    const r = await abonarPagosDelNegocio(WS, NEG, 'Diana')
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
    const again = await abonarPagosDelNegocio(WS, NEG, 'Diana')

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

// ─────────────────────────────────────────────────────────────────────────────
// 7. Brief del 2026-09-22 «Tesorería solo emite recibos de la tarifa UPME»: el abono es
//    100 % automático al registrar el pago, sin depender de `recibo_automatico`.
// ─────────────────────────────────────────────────────────────────────────────

describe('7 · el abono sale solo al registrar el pago, aunque recibo_automatico esté apagado', () => {
  /** La configuración real de SOENA hoy: `recibo_automatico` en false. */
  const apagado = () => {
    tablas.lineas_negocio[0].config_extra = { siigo: { ...SIIGO_LINEA, recibo_automatico: false } }
  }

  it('un pago de puro honorario en un negocio facturado se abona solo, SIN PDF y SIN aviso', async () => {
    apagado()
    const f = facturaEmitida()
    cobro('cob-h', { fecha: '2026-09-15', honorario: HONORARIO, tarifa: 0 })

    await alRegistrarCobro(WS, 'cob-h')

    expect(creados().map(p => [p.body.type, p.body.document.id, p.clave])).toEqual([['DebtPayment', RC1, 'cobhabhon']])
    expect(f.balance).toBe(0)
    // Regla 5: un asiento interno. Nada al bloque del recibo, nada al cliente.
    expect(archivados).toEqual([])
    expect(avisos).toEqual([])
    expect(marcas('cob-h')[0]).toMatchObject({ tipo: 'abono', archivo_url: null, factura: { numero: 'FV-2-540' } })
  })

  it('un pago mixto abona el honorario y NO emite el RC-3: ese lo gobierna recibo_automatico', async () => {
    apagado()
    facturaEmitida()
    cobro('cob-mixto', { fecha: '2026-09-15', honorario: HONORARIO, tarifa: TARIFA })

    await alRegistrarCobro(WS, 'cob-mixto')

    expect(creados().map(p => p.body.type)).toEqual(['DebtPayment'])
    expect(avisos).toEqual([])
  })

  it('sin factura no se toca Siigo: el abono espera a que se facture', async () => {
    cobro('cob-h', { fecha: '2026-09-15', honorario: HONORARIO, tarifa: 0 })

    await alRegistrarCobro(WS, 'cob-h')

    expect(postsVoucher).toHaveLength(0)
    expect(getsFactura).toBe(0)
    expect(marcas('cob-h')).toEqual([])
  })

  it('si Siigo falla, registrar el pago NO lanza y el cobro queda sin marca', async () => {
    apagado()
    facturaEmitida()
    cobro('cob-h', { fecha: '2026-09-15', honorario: HONORARIO, tarifa: 0 })
    rechazar = () => new SiigoError('Service unavailable', 503)

    await expect(alRegistrarCobro(WS, 'cob-h')).resolves.toBeUndefined()

    expect(vouchers).toHaveLength(0)
    expect(marcas('cob-h')).toEqual([])
    expect(aMano('cob-h')).toEqual([])
  })

  it('el pago siguiente del MISMO negocio recoge el abono que falló la vez anterior', async () => {
    apagado()
    const f = facturaEmitida()
    cobro('cob-1', { fecha: '2026-09-01', honorario: TRAMO, tarifa: 0 })
    rechazar = () => new SiigoError('Service unavailable', 503)
    await alRegistrarCobro(WS, 'cob-1')
    expect(vouchers).toHaveLength(0)

    rechazar = null
    cobro('cob-2', { fecha: '2026-09-15', honorario: TRAMO, tarifa: 0 })
    await abonarAlRegistrarPago(WS, NEG)

    // Del más viejo al más nuevo, cada uno una vez.
    expect(creados().map(p => p.clave)).toEqual(['cob1abhon', 'cob2abhon'])
    expect(f.balance).toBe(0)
  })

  it('una porción propuesta por el comercial NO se abona hasta que la financiera la acepte', async () => {
    apagado()
    facturaEmitida()
    cobro('cob-rep', { fecha: '2026-09-15', honorario: TRAMO, tarifa: 0 })
    const fila = tablas.cobros.find(c => c.id === 'cob-rep')!
    fila.split_json = { split_id: 's-1', origen: 'comercial' }

    await abonarAlRegistrarPago(WS, NEG)
    expect(postsVoucher).toHaveLength(0)

    // `aceptarRepartoComercial` estampa la marca y vuelve a llamar al abono.
    fila.split_json = { split_id: 's-1', origen: 'comercial', confirmado_at: '2026-09-16T10:00:00Z' }
    await abonarAlRegistrarPago(WS, NEG)
    expect(creados().map(p => p.clave)).toEqual(['cobrepabhon'])
  })

  it('un «a mano» NO se vuelve a preguntar en cada pago nuevo', async () => {
    apagado()
    facturaEmitida({ saldo: 0 })
    cobro('cob-1', { fecha: '2026-09-01', honorario: HONORARIO, tarifa: 0 })

    await abonarAlRegistrarPago(WS, NEG)
    expect(aMano('cob-1')).toMatchObject([{ abono_a_mano: { motivo: 'factura_saldada' } }])
    const gets = getsFactura

    await abonarAlRegistrarPago(WS, NEG)
    expect(getsFactura).toBe(gets)
    expect(postsVoucher).toHaveLength(0)
  })

  it('la factura SIN vínculo sí se reintenta el día que se adopta', async () => {
    apagado()
    facturaCargada = 'FV-2-540'
    cobro('cob-1', { fecha: '2026-09-01', honorario: HONORARIO, tarifa: 0 })
    await abonarAlRegistrarPago(WS, NEG)
    expect(aMano('cob-1')).toMatchObject([{ abono_a_mano: { motivo: 'factura_sin_vinculo' } }])

    // Adoptarla le pone la marca con su id de Siigo.
    facturaEmitida()
    await abonarAlRegistrarPago(WS, NEG)

    expect(creados().map(p => p.body.type)).toEqual(['DebtPayment'])
    expect(marcas('cob-1')[0]).toMatchObject({ tipo: 'abono' })
  })

  it('CONTROL: sin `tipo: abono` en la línea, registrar el pago no abona nada', async () => {
    tablas.lineas_negocio[0].config_extra = {
      siigo: {
        ...SIIGO_LINEA,
        recibo_automatico: false,
        recibo_por_concepto: {
          honorario: { document_id: RC1, concepto: 'Honorarios de asesoría' },
          pasante: { document_id: RC3, concepto: 'Recaudo pago certificación UPME' },
        },
      },
    }
    facturaEmitida()
    cobro('cob-h', { fecha: '2026-09-15', honorario: HONORARIO, tarifa: 0 })

    await alRegistrarCobro(WS, 'cob-h')

    expect(postsVoucher).toHaveLength(0)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// 8. El rezago en lote: idempotente
// ─────────────────────────────────────────────────────────────────────────────

describe('8 · el rezago de abonos en lote', () => {
  beforeEach(() => {
    tablas.lineas_negocio[0].config_extra = { siigo: { ...SIIGO_LINEA, recibo_automatico: false } }
  })

  it('simular solo LEE: lista lo que abonaría sin hablarle a Siigo', async () => {
    facturaEmitida()
    cobro('cob-1', { fecha: '2026-09-01', honorario: TRAMO, tarifa: 0 })
    cobro('cob-2', { fecha: '2026-09-05', honorario: TRAMO, tarifa: TARIFA })
    cobro('cob-tar', { fecha: '2026-09-06', honorario: 0, tarifa: TARIFA })

    const r = await abonarRezago(WS, { aplicar: false })

    expect(r.aplicado).toBe(false)
    expect(r.candidatos.map(c => c.cobro_id)).toEqual(['cob-1', 'cob-2'])
    expect(r.valor).toBe(TRAMO * 2)
    expect(postsVoucher).toHaveLength(0)
    expect(getsFactura).toBe(0)
  })

  it('aplicado dos veces, NO duplica: la segunda corrida no encuentra nada', async () => {
    const f = facturaEmitida()
    cobro('cob-1', { fecha: '2026-09-01', honorario: TRAMO, tarifa: 0 })
    cobro('cob-2', { fecha: '2026-09-05', honorario: TRAMO, tarifa: TARIFA })

    const primera = await abonarRezago(WS, { aplicar: true, staffNombre: 'Lote' })
    expect(primera.emitidos.map(e => e.cobro_id)).toEqual(['cob-1', 'cob-2'])
    expect(f.balance).toBe(0)
    const documentos = vouchers.length

    const segunda = await abonarRezago(WS, { aplicar: true, staffNombre: 'Lote' })

    expect(segunda.candidatos).toEqual([])
    expect(segunda.emitidos).toEqual([])
    expect(vouchers).toHaveLength(documentos)
    // Solo abonos: el RC-3 de esos pagos no es asunto del lote.
    expect(vouchers.map(v => v.type)).toEqual(['DebtPayment', 'DebtPayment'])
  })

  it('no toca los pagos del corte histórico, los que ya tienen anticipo ni los negocios sin factura', async () => {
    facturaEmitida()
    cobro('cob-na', { fecha: '2026-09-01', honorario: TRAMO, tarifa: 0 })
    tablas.cobros.find(c => c.id === 'cob-na')!.recibo_no_aplica = { motivo: 'Negocio ya facturado' }
    cobro('cob-ant', {
      fecha: '2026-09-02', honorario: TRAMO, tarifa: 0,
      siigo_recibo: [{ numero: 'RC-1-80', siigo_id: 'x', valor: TRAMO, archivo_url: null, at: '', por: null, componente: 'honorario' }],
    })
    // Otro negocio, sin factura.
    tablas.negocios.push({ id: 'neg-otro', workspace_id: WS, codigo: 'V0600', nombre: 'OTRO', linea_id: LINEA, metadata: {} })
    tablas.cobros.push({
      id: 'cob-otro', negocio_id: 'neg-otro', workspace_id: WS, monto: TRAMO, fecha: '2026-09-03',
      tipo_cobro: 'pago', siigo_recibo: null, anulado_at: null, retencion: 0, recibo_no_aplica: null,
    })
    tablas.v_cobro_valor.push({ cobro_id: 'cob-otro', workspace_id: WS, a_tramo1: TRAMO, a_tramo2: 0, a_tarifa: 0, excedente: 0 })

    const r = await abonarRezago(WS, { aplicar: true })

    expect(r.candidatos).toEqual([])
    expect(postsVoucher).toHaveLength(0)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// 9. El control de duplicados del abono (brief del 2026-09-22, caso V0409)
//
// V0409 no recibió su abono: el control encontró RC-1-96 —mismo cliente, $510.000, mismo
// día— y lo tomó por el suyo, cuando RC-1-96 es el abono de V0408 (otro vehículo) contra
// otra factura. Y solo miraba la primera página de recibos.
// ─────────────────────────────────────────────────────────────────────────────

describe('9 · el control de duplicados del abono', () => {
  const NEG_HERMANO = 'neg-v0409'

  /** Un abono que ya está en Siigo y que ONE no emitió (hecho a mano, o de otro negocio). */
  function abonoEnSiigo(p: {
    id: string; nombre: string; fecha?: string; valor: number
    factura?: { prefix: string; consecutive: number } | null
    cliente?: string
  }) {
    vouchers.push({
      id: p.id, name: p.nombre, date: p.fecha ?? '2026-09-16', type: 'DebtPayment',
      document: { id: RC1 }, customer: { identification: p.cliente ?? CLIENTE },
      items: p.factura === null ? [{ value: p.valor }] : [{ due: p.factura ?? { prefix: 'FV-2', consecutive: 540 }, value: p.valor }],
      payment: { value: p.valor },
    })
  }

  /** El vehículo hermano: mismo cliente, su propia factura por el mismo valor. */
  function negocioHermano() {
    facturas['fv-541'] = {
      id: 'fv-541', name: 'FV-2-541', number: 541, date: '2026-09-10', total: HONORARIO, balance: HONORARIO,
      customer: { identification: CLIENTE, branch_office: 0 },
      payments: [{ id: 1055, value: HONORARIO, due_date: '2026-09-10' }],
    }
    tablas.negocios.push({
      id: NEG_HERMANO, workspace_id: WS, codigo: 'V0503', nombre: 'CLIENTE PRUEBA - OTRO VEHÍCULO',
      linea_id: LINEA, precio_aprobado: HONORARIO,
      metadata: { siigo_factura: { numero: 'FV-2-541', siigo_id: 'fv-541', total: HONORARIO, emitida: true } },
    })
  }

  it('dos negocios del mismo cliente, mismo valor y misma fecha, con facturas distintas: cada uno recibe su abono', async () => {
    const f540 = facturaEmitida()
    negocioHermano()
    cobro('cob-a', { fecha: '2026-08-27', honorario: HONORARIO, tarifa: 0 })
    cobro('cob-b', { fecha: '2026-08-27', honorario: HONORARIO, tarifa: 0, negocio: NEG_HERMANO })

    const a = await abonarPagosDelNegocio(WS, NEG, 'Lote')
    const b = await abonarPagosDelNegocio(WS, NEG_HERMANO, 'Lote')

    expect(a.emitidos.map(e => e.cobro_id)).toEqual(['cob-a'])
    // El abono del hermano (mismo cliente, mismo valor, mismo día) ya está en Siigo y NO
    // es el de este negocio: cruza otra factura.
    expect(b).toMatchObject({ emitidos: [{ cobro_id: 'cob-b', valor: HONORARIO }], a_mano: [], fallidos: [] })
    expect(creados().map(p => [p.body.items![0].due!.consecutive, p.body.items![0].value])).toEqual([
      [540, HONORARIO], [541, HONORARIO],
    ])
    expect(f540.balance).toBe(0)
    expect(facturas['fv-541'].balance).toBe(0)
    expect(aMano('cob-b')).toEqual([])
  })

  it('un abono que YA existe para la misma factura no se duplica: queda a mano con el abono que se encontró', async () => {
    // Plan 50/50: Tesorería cruzó a mano el primer pago (RC-1-41) y la factura quedó con
    // la mitad de saldo. Cuando ONE llega a ese pago, el abono ya está.
    const f = facturaEmitida({ saldo: TRAMO })
    abonoEnSiigo({ id: 'v-manual', nombre: 'RC-1-41', fecha: '2026-09-02', valor: TRAMO })
    cobro('cob-1', { fecha: '2026-09-01', honorario: TRAMO, tarifa: 0 })

    const r = await abonarPagosDelNegocio(WS, NEG, 'Lote')

    expect(r.emitidos).toEqual([])
    expect(r.a_mano).toMatchObject([{ cobro_id: 'cob-1', motivo: 'duplicado_en_siigo' }])
    expect(postsVoucher).toHaveLength(0)
    expect(f.balance).toBe(TRAMO)
    const [marca] = aMano('cob-1')
    expect(marca).toMatchObject({ componente: 'honorario', valor: TRAMO, abono_a_mano: { motivo: 'duplicado_en_siigo' } })
    expect(marca.abono_a_mano.detalle).toContain('RC-1-41')
    expect(marca.abono_a_mano.detalle).toContain('FV-2-540')
  })

  it('y el mismo abono contra OTRA factura del cliente no frena nada', async () => {
    const f = facturaEmitida({ saldo: TRAMO })
    abonoEnSiigo({ id: 'v-otro', nombre: 'RC-1-41', fecha: '2026-09-01', valor: TRAMO, factura: { prefix: 'FV-2', consecutive: 511 } })
    cobro('cob-1', { fecha: '2026-09-01', honorario: TRAMO, tarifa: 0 })

    const r = await abonarPagosDelNegocio(WS, NEG, 'Lote')

    expect(r.emitidos.map(e => e.cobro_id)).toEqual(['cob-1'])
    expect(f.balance).toBe(0)
  })

  it('un cliente con más de 100 abonos y el duplicado en la página 2: se detecta', async () => {
    const f = facturaEmitida({ saldo: TRAMO })
    // 120 abonos del MISMO cliente, a otras facturas y por otros valores: la primera página
    // entera no dice nada. El duplicado es el 121, en la segunda.
    for (let i = 0; i < 120; i++) {
      abonoEnSiigo({ id: `v-${i}`, nombre: `RC-1-${i + 1}`, valor: 100_000 + i, factura: { prefix: 'FV-2', consecutive: 1_000 + i } })
    }
    abonoEnSiigo({ id: 'v-dup', nombre: 'RC-1-121', valor: TRAMO })
    cobro('cob-1', { fecha: '2026-09-01', honorario: TRAMO, tarifa: 0 })

    const r = await abonarPagosDelNegocio(WS, NEG, 'Lote')

    expect(paginasPedidas).toEqual([1, 2])
    expect(r.a_mano).toMatchObject([{ cobro_id: 'cob-1', motivo: 'duplicado_en_siigo' }])
    expect(aMano('cob-1')[0].abono_a_mano.detalle).toContain('RC-1-121')
    expect(postsVoucher).toHaveLength(0)
    expect(f.balance).toBe(TRAMO)
  })

  it('con más de 100 abonos y ninguno de esta factura, lee todas las páginas y abona', async () => {
    facturaEmitida()
    for (let i = 0; i < 230; i++) {
      abonoEnSiigo({ id: `v-${i}`, nombre: `RC-1-${i + 1}`, valor: HONORARIO, factura: { prefix: 'FV-2', consecutive: 1_000 + i } })
    }
    cobro('cob-1', { fecha: '2026-09-15', honorario: HONORARIO, tarifa: 0 })

    const r = await abonarPagosDelNegocio(WS, NEG, 'Lote')

    expect(paginasPedidas).toEqual([1, 2, 3])
    expect(r.emitidos.map(e => e.cobro_id)).toEqual(['cob-1'])
  })

  it('si falla la consulta de abonos existentes: NO se emite y queda marca a mano', async () => {
    const f = facturaEmitida()
    cobro('cob-1', { fecha: '2026-09-15', honorario: HONORARIO, tarifa: 0 })
    siigoVouchers.fallarPagina = () => new SiigoError('Service unavailable', 503)

    const r = await abonarPagosDelNegocio(WS, NEG, 'Lote')

    expect(r.emitidos).toEqual([])
    expect(r.a_mano).toMatchObject([{ cobro_id: 'cob-1', motivo: 'abonos_sin_revisar' }])
    expect(postsVoucher).toHaveLength(0)
    expect(f.balance).toBe(HONORARIO)
    expect(aMano('cob-1')).toMatchObject([{ componente: 'honorario', valor: HONORARIO, abono_a_mano: { motivo: 'abonos_sin_revisar' } }])
  })

  it('también si falla a mitad: una lista a medias no se da por revisada', async () => {
    facturaEmitida()
    for (let i = 0; i < 150; i++) {
      abonoEnSiigo({ id: `v-${i}`, nombre: `RC-1-${i + 1}`, valor: 1_000 + i, factura: { prefix: 'FV-2', consecutive: 1_000 + i } })
    }
    cobro('cob-1', { fecha: '2026-09-15', honorario: HONORARIO, tarifa: 0 })
    siigoVouchers.fallarPagina = pagina => (pagina === 2 ? new SiigoError('Too many requests', 429) : null)

    const r = await abonarPagosDelNegocio(WS, NEG, 'Lote')

    expect(r.a_mano).toMatchObject([{ motivo: 'abonos_sin_revisar' }])
    expect(postsVoucher).toHaveLength(0)
  })

  it('si Siigo entrega menos recibos de los que dice tener, tampoco se da por revisada', async () => {
    facturaEmitida()
    abonoEnSiigo({ id: 'v-1', nombre: 'RC-1-1', valor: 5_000, factura: { prefix: 'FV-2', consecutive: 999 } })
    cobro('cob-1', { fecha: '2026-09-15', honorario: HONORARIO, tarifa: 0 })
    siigoVouchers.totalDeclarado = 180

    const r = await abonarPagosDelNegocio(WS, NEG, 'Lote')

    expect(r.a_mano).toMatchObject([{ motivo: 'abonos_sin_revisar' }])
    expect(aMano('cob-1')[0].abono_a_mano.detalle).toContain('180')
    expect(postsVoucher).toHaveLength(0)
  })

  it('si Siigo ignora la página y repite la primera, no se toma como el final de la lista', async () => {
    facturaEmitida()
    for (let i = 0; i < 150; i++) {
      abonoEnSiigo({ id: `v-${i}`, nombre: `RC-1-${i + 1}`, valor: 1_000 + i, factura: { prefix: 'FV-2', consecutive: 1_000 + i } })
    }
    cobro('cob-1', { fecha: '2026-09-15', honorario: HONORARIO, tarifa: 0 })
    siigoVouchers.ignorarPagina = true

    const r = await abonarPagosDelNegocio(WS, NEG, 'Lote')

    expect(r.a_mano).toMatchObject([{ motivo: 'abonos_sin_revisar' }])
    expect(postsVoucher).toHaveLength(0)
  })

  it('lo que no se pudo revisar no lo destraba una justificación: nadie vio nada', async () => {
    facturaEmitida()
    cobro('cob-1', { fecha: '2026-09-15', honorario: HONORARIO, tarifa: 0 })
    siigoVouchers.fallarPagina = () => new SiigoError('Service unavailable', 503)

    const r = await emitirReciboDeCobro(WS, 'cob-1', 'Diana', { porConcepto: POR_CONCEPTO, justificacionDuplicado: 'lo revisé' })

    expect(r).toMatchObject({ ok: false, motivo: 'abono_a_mano', a_mano: [{ motivo: 'abonos_sin_revisar' }] })
    expect(postsVoucher).toHaveLength(0)
  })

  it('un «a mano» por duplicado no se vuelve a preguntar con el pago siguiente', async () => {
    facturaEmitida({ saldo: TRAMO })
    abonoEnSiigo({ id: 'v-manual', nombre: 'RC-1-41', valor: TRAMO })
    cobro('cob-1', { fecha: '2026-09-01', honorario: TRAMO, tarifa: 0 })
    await abonarAlRegistrarPago(WS, NEG)
    const paginas = paginasPedidas.length
    expect(aMano('cob-1')).toMatchObject([{ abono_a_mano: { motivo: 'duplicado_en_siigo' } }])

    await abonarAlRegistrarPago(WS, NEG)

    expect(paginasPedidas.length).toBe(paginas)
    expect(postsVoucher).toHaveLength(0)
  })

  describe('cuando la lista de Siigo no trae los ítems', () => {
    beforeEach(() => { siigoVouchers.listaSinItems = true })

    it('lee el detalle de los abonos del cliente, y si pagan otra factura, abona', async () => {
      const f = facturaEmitida()
      abonoEnSiigo({ id: 'v-hermano', nombre: 'RC-1-96', fecha: '2026-08-27', valor: HONORARIO, factura: { prefix: 'FV-2', consecutive: 511 } })
      // Un abono de OTRO cliente no puede cruzar esta factura: ni se pide su detalle.
      abonoEnSiigo({ id: 'v-ajeno', nombre: 'RC-1-97', valor: HONORARIO, cliente: '11111111' })
      cobro('cob-1', { fecha: '2026-08-27', honorario: HONORARIO, tarifa: 0 })

      const r = await abonarPagosDelNegocio(WS, NEG, 'Lote')

      expect(detallesPedidos).toEqual(['v-hermano'])
      expect(r.emitidos.map(e => e.cobro_id)).toEqual(['cob-1'])
      expect(f.balance).toBe(0)
    })

    it('y si el detalle dice que es esta factura, es duplicado', async () => {
      facturaEmitida({ saldo: TRAMO })
      abonoEnSiigo({ id: 'v-manual', nombre: 'RC-1-41', valor: TRAMO })
      cobro('cob-1', { fecha: '2026-09-01', honorario: TRAMO, tarifa: 0 })

      const r = await abonarPagosDelNegocio(WS, NEG, 'Lote')

      expect(r.a_mano).toMatchObject([{ motivo: 'duplicado_en_siigo' }])
      expect(postsVoucher).toHaveLength(0)
    })

    it('si el detalle no se puede leer, no se abona a ciegas', async () => {
      facturaEmitida()
      abonoEnSiigo({ id: 'v-hermano', nombre: 'RC-1-96', valor: HONORARIO, factura: { prefix: 'FV-2', consecutive: 511 } })
      cobro('cob-1', { fecha: '2026-09-15', honorario: HONORARIO, tarifa: 0 })
      siigoVouchers.fallarDetalle = () => new SiigoError('Service unavailable', 503)

      const r = await abonarPagosDelNegocio(WS, NEG, 'Lote')

      expect(r.a_mano).toMatchObject([{ motivo: 'abonos_sin_revisar' }])
      expect(aMano('cob-1')[0].abono_a_mano.detalle).toContain('RC-1-96')
      expect(postsVoucher).toHaveLength(0)
    })

    it('un abono cuyo detalle tampoco dice a qué factura pagó, tampoco', async () => {
      facturaEmitida()
      abonoEnSiigo({ id: 'v-raro', nombre: 'RC-1-50', valor: HONORARIO, factura: null })
      cobro('cob-1', { fecha: '2026-09-15', honorario: HONORARIO, tarifa: 0 })

      const r = await abonarPagosDelNegocio(WS, NEG, 'Lote')

      expect(r.a_mano).toMatchObject([{ motivo: 'abonos_sin_revisar' }])
      expect(postsVoucher).toHaveLength(0)
    })
  })

  it('CONTROL: los abonos que ONE ya le emitió a este negocio siguen sin contar como duplicado', async () => {
    // El plan 50/50: el segundo abono es del MISMO valor contra la MISMA factura. Con la
    // factura como criterio, sin excluir los conocidos, el segundo quedaría a mano.
    cobro('cob-1', { fecha: '2026-09-01', honorario: TRAMO, tarifa: 0 })
    cobro('cob-2', { fecha: '2026-09-05', honorario: TRAMO, tarifa: 0 })

    const r = await emitirFacturaNegocio(WS, NEG, 'Diana', { emitir: true })

    expect(r.ok && r.abonos.emitidos.map(a => a.cobro_id)).toEqual(['cob-1', 'cob-2'])
    expect(r.ok && r.abonos.a_mano).toEqual([])
  })
})
