import { beforeEach, describe, expect, it } from 'vitest'
import { guardarProducto, guardarPublicacion } from '@/lib/ferreteria/nucleo'
import { repoEnMemoria } from '@/lib/ferreteria/repo-memoria'
import { convertidorDeFerreteria } from '@/lib/ferreteria/carrito-a-venta'
import { marcarVentaEntregada } from '@/lib/ferreteria/ventas'
import type { Autor, RepoFerreteria } from '@/lib/ferreteria/tipos'
import { negociosFalsos } from '../../../test/negocios-ferreteria-doble'
import {
  procesarPagoCarrito,
  type CarritoPagado,
  type DepsPagoCarrito,
  type LineaPagada,
  type PagoCarritoFila,
  type RepoPagosCarrito,
} from './pago-bold'

/**
 * El pago de Bold de un carrito → UN negocio con una venta por línea (Ferretería), con el repositorio en memoria y el
 * doble de negocios: el caso de la conversación 10 (MP-62 + MP-64, un link, un flete), los reintentos de Bold, el corte
 * a mitad y el pago que llega con el link vencido.
 */

const WS = 'ws-dimpro'
const AGENTE: Autor = { tipo: 'agente', id: null, nombre: 'Agente MeTRIK' }
const AHORA = '2026-11-04T21:00:00.000Z'
const HOY = '2026-11-04'

let repo: RepoFerreteria & { estado: ReturnType<typeof repoEnMemoria>['estado'] }
let neg: ReturnType<typeof negociosFalsos>
let pubs: Record<string, string>

/** Las tablas del carrito en memoria, con lo que haría la base. */
function pagosEnMemoria(carrito: CarritoPagado, lineas: LineaPagada[], pago: PagoCarritoFila) {
  const m = { carrito: structuredClone(carrito), lineas: structuredClone(lineas), pago: { ...structuredClone(pago), reclamado_at: null as string | null, veces: 0, monto_recibido: null as number | null }, fallarEn: null as string | null }
  const r: RepoPagosCarrito = {
    async recibido() { m.pago.veces += 1 },
    async reclamar(_id, ahora, vencidoAntesDe) {
      const libre = ['creado', 'rechazado', 'vencido', 'error'].includes(m.pago.estado) || (m.pago.estado === 'procesando' && (m.pago.reclamado_at ?? '') < vencidoAntesDe)
      if (!libre) return false
      m.pago.estado = 'procesando'
      m.pago.reclamado_at = ahora
      return true
    },
    leerPago: async () => structuredClone(m.pago),
    carrito: async () => structuredClone(m.carrito),
    lineas: async () => structuredClone(m.lineas),
    async anotarVenta(lineaId, ventaId) {
      if (m.fallarEn === 'anotarVenta' && ventaId) { m.fallarEn = null; throw new Error('base caída (doble)') }
      m.lineas.find((l) => l.id === lineaId)!.venta_id = ventaId
    },
    async anotarNegocio(_c, negocioId) {
      m.carrito.negocio_id = negocioId
      if (m.fallarEn === 'despuesDelNegocio') { m.fallarEn = null; throw new Error('corte después del negocio (doble)') }
    },
    async cerrar(_id, c) {
      m.pago.estado = c.estado
      m.pago.motivo = c.motivo ?? null
      if (c.monto_recibido !== undefined) m.pago.monto_recibido = c.monto_recibido
    },
    async marcarCarrito(_id, estado) { m.carrito.estado = estado },
    async marcarRechazado() { if (['creado', 'error'].includes(m.pago.estado)) m.pago.estado = 'rechazado' },
  }
  return { r, m }
}

beforeEach(async () => {
  repo = repoEnMemoria(undefined, () => AHORA)
  neg = negociosFalsos()
  pubs = {}
  for (const [sku, codigo, precio, costo] of [['BAT20', 'MP-62', 220_000, 150_000], ['PUN10', 'MP-64', 30_000, 18_000]] as const) {
    await guardarProducto(repo, WS, { sku, nombre: `Producto ${sku}`, marca: 'Dongcheng', costo: { fecha_lista: '2026-10-01', costo_f: costo } }, AHORA)
    const r = await guardarPublicacion(repo, WS, { codigo, sku, titulo: `Producto ${codigo}`, precio, estado: 'activa', linea: 'ticket_alto' }, { origen: 'canal', autor: AGENTE, ahora: AHORA })
    if (!r.ok) throw new Error('sin publicación')
    pubs[codigo] = (await repo.publicacionPorCodigo(WS, codigo))!.id
  }
})

function caso(o: { monto?: number; estadoPago?: PagoCarritoFila['estado'] } = {}) {
  const carrito: CarritoPagado = {
    id: 'carrito-1', workspace_id: WS, dominio: 'ferreteria', estado: 'en_pago', subtotal: 250_000, flete: 15_000, total: 265_000, zona: 'bogota',
    ruta: 'despacho', comprador_nombre: 'Mauricio Moreno', comprador_telefono: '3001234567', direccion: 'Calle 1 # 2-3',
    chatwoot_cuenta_id: 77, chatwoot_conversacion_id: 10, canal: 'otro', negocio_id: null,
  }
  const lineas: LineaPagada[] = [
    { id: 'l1', orden: 1, item_tipo: 'ferreteria_publicacion', item_id: pubs['MP-62'], codigo: 'MP-62', descripcion: 'Batería', cantidad: 1, precio_unitario: 220_000, venta_id: null },
    { id: 'l2', orden: 2, item_tipo: 'ferreteria_publicacion', item_id: pubs['MP-64'], codigo: 'MP-64', descripcion: 'Puntas', cantidad: 1, precio_unitario: 30_000, venta_id: null },
  ]
  const pago: PagoCarritoFila = { id: 'pago-1', carrito_id: 'carrito-1', referencia: 'LNK_CONV10', monto: o.monto ?? 265_000, version: 2, estado: o.estadoPago ?? 'creado', motivo: o.estadoPago === 'vencido' ? 'reemplazado por otro link' : null }
  const mem = pagosEnMemoria(carrito, lineas, pago)
  const avisos: string[] = []
  const confirmados: string[] = []
  const deps: DepsPagoCarrito = {
    repo: mem.r,
    convertidor: convertidorDeFerreteria({ ws: WS, repo, negocios: async () => neg.puerto, conversacion: async () => null }),
    consultarLink: async () => ({ estado: 'PAID', total: 265_000 }),
    avisar: async (t) => { avisos.push(t) },
    confirmarEnChatwoot: async (ref) => { confirmados.push(ref) },
    ahoraIso: AHORA,
    hoyISO: HOY,
  }
  return { mem, deps, avisos, confirmados, pagar: (monto: number | null = 265_000) => procesarPagoCarrito(mem.m.pago, { estado: 'aprobado', monto, moneda: 'COP' }, deps) }
}

describe('un carrito pagado es UN negocio con una venta por línea', () => {
  it('MP-62 + MP-64 en un link con un flete: un negocio, dos ventas, un cobro por el subtotal', async () => {
    const c = caso()
    const r = await c.pagar()
    expect(r).toMatchObject({ status: 200, body: { resultado: 'registrada', productos: 2 } })
    expect(neg.negocios.size).toBe(1)
    const [negocioId, n] = [...neg.negocios.entries()][0]
    expect(n.nombre).toBe('Pedido MP-62 + MP-64')
    expect(n.precioAprobado).toBe(250_000)
    expect(n.pagos).toEqual([{ monto: 250_000, fecha: HOY, referencia: 'BOLD-LNK_CONV10' }])
    expect(n.historial.join(' ')).toMatch(/flete \$\s?15\.000 \(no es venta\)/)
    expect(repo.estado.ventas.map((v) => [v.publicacion_id, v.precio_final, v.negocio_id, v.carrito_linea_id])).toEqual([
      [pubs['MP-62'], 220_000, negocioId, 'l1'],
      [pubs['MP-64'], 30_000, negocioId, 'l2'],
    ])
    expect(c.mem.m.lineas.every((l) => l.venta_id)).toBe(true)
    expect(c.mem.m.carrito).toMatchObject({ estado: 'registrado', negocio_id: negocioId })
    expect(c.mem.m.pago).toMatchObject({ estado: 'aprobado', monto_recibido: 265_000 })
    expect(c.avisos[0]).toMatch(/MP-62 ×1, MP-64 ×1 \$265\.000 \(flete \$15\.000\)/)
    expect(c.confirmados).toEqual(['LNK_CONV10'])
  })

  it('el aviso repetido de Bold no registra otra vez', async () => {
    const c = caso()
    await c.pagar()
    const r = await c.pagar()
    expect(r.body).toMatchObject({ repetida: true })
    expect(neg.negocios.size).toBe(1)
    expect(repo.estado.ventas).toHaveLength(2)
  })

  it('dos avisos a la vez: el segundo responde 500 en_proceso y no escribe', async () => {
    const c = caso()
    c.mem.m.pago.estado = 'procesando'
    c.mem.m.pago.reclamado_at = AHORA
    const r = await c.pagar()
    expect(r).toMatchObject({ status: 500, body: { resultado: 'en_proceso' } })
    expect(repo.estado.ventas).toHaveLength(0)
  })

  it('un monto distinto al del link no registra nada y avisa', async () => {
    const c = caso()
    const r = await c.pagar(200_000)
    expect(r.body).toMatchObject({ resultado: 'error' })
    expect(c.mem.m.pago.estado).toBe('error')
    expect(repo.estado.ventas).toHaveLength(0)
    expect(c.avisos[0]).toMatch(/no quedó registrado: Bold cobró \$200\.000/)
  })

  it('sin monto en el aviso pregunta a Bold', async () => {
    const c = caso()
    const r = await c.pagar(null)
    expect(r.body).toMatchObject({ resultado: 'registrada' })
  })

  it('un corte después de crear el negocio: el reintento lo retoma sin otro negocio ni otra venta', async () => {
    const c = caso()
    c.mem.m.fallarEn = 'despuesDelNegocio'
    const r1 = await c.pagar()
    expect(r1.status).toBe(500)
    expect(c.mem.m.pago.estado).toBe('error')
    expect(neg.negocios.size).toBe(1)
    const r2 = await c.pagar()
    expect(r2.body).toMatchObject({ resultado: 'registrada' })
    expect(neg.negocios.size).toBe(1)
    expect(repo.estado.ventas).toHaveLength(2)
    expect(new Set(repo.estado.ventas.map((v) => v.negocio_id)).size).toBe(1)
    expect([...neg.negocios.values()][0].pagos).toHaveLength(1)
  })

  it('un corte al anotar la segunda venta: la venta sin anotar se borra y el reintento completa', async () => {
    const c = caso()
    c.mem.m.lineas[1].venta_id = null
    let llamadas = 0
    const anotar = c.mem.r.anotarVenta
    c.mem.r.anotarVenta = async (l, v) => { if (v && ++llamadas === 2) throw new Error('base caída (doble)'); return anotar(l, v) }
    const r1 = await c.pagar()
    expect(r1.status).toBe(500)
    expect(repo.estado.ventas).toHaveLength(1)
    expect(neg.negocios.size).toBe(0)
    const r2 = await c.pagar()
    expect(r2.body).toMatchObject({ resultado: 'registrada' })
    expect(repo.estado.ventas).toHaveLength(2)
    expect(neg.negocios.size).toBe(1)
  })

  it('si ONE no crea el negocio no queda ninguna venta suelta', async () => {
    const c = caso()
    neg.fallar.crear = 'sin línea Ferretería'
    const r = await c.pagar()
    expect(r.body).toMatchObject({ resultado: 'error' })
    expect(repo.estado.ventas).toHaveLength(0)
    expect(c.mem.m.lineas.every((l) => l.venta_id === null)).toBe(true)
  })

  it('un pago que llega con el link vencido se registra igual (la plata entró) y lo avisa', async () => {
    const c = caso({ estadoPago: 'vencido' })
    const r = await c.pagar()
    expect(r.body).toMatchObject({ resultado: 'registrada' })
    expect(c.avisos[0]).toMatch(/link estaba vencido o reemplazado/)
  })

  it('un link viejo cuyo carrito ya cambió no se registra solo: lo revisa una persona', async () => {
    const c = caso({ estadoPago: 'vencido', monto: 220_000 + 15_000 })
    const r = await c.pagar(235_000)
    expect(r.body).toMatchObject({ resultado: 'error' })
    expect(c.mem.m.pago.motivo).toMatch(/el cliente lo cambió después/)
    expect(repo.estado.ventas).toHaveLength(0)
  })

  it('un rechazo deja el link abierto y no escribe ventas', async () => {
    const c = caso()
    const r = await procesarPagoCarrito(c.mem.m.pago, { estado: 'fallido', monto: null }, c.deps)
    expect(r.body).toMatchObject({ resultado: 'rechazado' })
    expect(c.mem.m.pago.estado).toBe('rechazado')
  })

  it('marcar una venta del pedido entregada entrega todo el pedido', async () => {
    const c = caso()
    await c.pagar()
    const r = await marcarVentaEntregada(repo, neg.puerto, WS, repo.estado.ventas[0].id!, AHORA)
    expect(r.ok).toBe(true)
    expect(repo.estado.ventas.every((v) => v.entregada_at === AHORA)).toBe(true)
    const n = [...neg.negocios.values()][0]
    expect(n.historial.filter((h) => h === 'etapa entregado')).toHaveLength(1)
  })
})
