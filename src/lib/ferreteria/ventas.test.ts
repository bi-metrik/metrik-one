import { beforeEach, describe, expect, it } from 'vitest'
import { guardarProducto, guardarPublicacion } from './nucleo'
import { repoEnMemoria } from './repo-memoria'
import type { Autor, PuertoNegocios, RepoFerreteria } from './tipos'
import type { PasoVenta } from './reglas'
import { alinearNegocio, marcarVentaEntregada, referenciaPago, registrarPagoDeVenta, registrarVenta } from './ventas'

const WS = 'ws-dimpro'
const DIETMAR: Autor = { tipo: 'persona', id: 'perfil-dietmar', nombre: 'Dietmar Niño' }
const AGENTE: Autor = { tipo: 'agente', id: null, nombre: 'Agente MeTRIK' }
const HOY = '2026-10-05'
const AHORA = '2026-10-05T15:00:00.000Z'

interface NegocioFalso {
  nombre: string
  paso: PasoVenta
  abierto: boolean
  precioAprobado: number | null
  pagos: { monto: number; fecha: string; referencia: string }[]
  historial: string[]
  responsable: boolean
}

/**
 * Doble de los negocios de ONE. Reproduce lo que el motor de verdad exige y que el núcleo da
 * por hecho: el avance es de a una etapa (Vendido → Entregado → Pagado), solo se completa desde
 * Pagado, y un negocio cerrado no recibe pagos ni se mueve.
 */
function negociosFalsos() {
  const negocios = new Map<string, NegocioFalso>()
  const fallar: Partial<Record<keyof PuertoNegocios, string>> = {}
  let seq = 0
  const orden: PasoVenta[] = ['vendido', 'entregado', 'pagado']
  const puerto: PuertoNegocios = {
    async crear({ nombre, compradorNombre }) {
      if (fallar.crear) return { ok: false, error: fallar.crear }
      const id = `neg-${++seq}`
      negocios.set(id, { nombre, paso: 'vendido', abierto: true, precioAprobado: null, pagos: [], historial: compradorNombre ? [`contacto ${compradorNombre}`] : [], responsable: false })
      return { ok: true, negocioId: id }
    },
    async fijarPrecioAprobado(id, precio) {
      if (fallar.fijarPrecioAprobado) return fallar.fijarPrecioAprobado
      negocios.get(id)!.precioAprobado = precio
      return null
    },
    async registrarPago(id, pago) {
      if (fallar.registrarPago) return fallar.registrarPago
      const n = negocios.get(id)!
      if (!n.abierto) return 'Negocio cerrado'
      // Idempotente por referencia, como `registrarPagoEnNegocio`.
      if (!n.pagos.some((p) => p.referencia === pago.referencia)) n.pagos.push(pago)
      return null
    },
    async estado(id) {
      const n = negocios.get(id)
      return n ? { paso: n.paso, abierto: n.abierto } : null
    },
    async moverA(id, paso) {
      if (fallar.moverA) return fallar.moverA
      const n = negocios.get(id)!
      if (!n.abierto) return 'Negocio cerrado'
      if (orden.indexOf(paso) !== orden.indexOf(n.paso) + 1) return `Salto no permitido de ${n.paso} a ${paso}`
      n.paso = paso
      n.historial.push(`etapa ${paso}`)
      return null
    },
    async completar(id) {
      if (fallar.completar) return fallar.completar
      const n = negocios.get(id)!
      if (n.paso !== 'pagado') return 'Solo se completa desde la etapa de cierre'
      if (!n.abierto) return 'El negocio ya esta cerrado'
      n.abierto = false
      n.historial.push('completado')
      return null
    },
    async asignarResponsable(id) {
      if (fallar.asignarResponsable) return fallar.asignarResponsable
      negocios.get(id)!.responsable = true
      return null
    },
    async anotar(id, texto) {
      negocios.get(id)?.historial.push(texto)
    },
  }
  return { puerto, negocios, fallar }
}

let repo: RepoFerreteria & { estado: ReturnType<typeof repoEnMemoria>['estado'] }
let neg: ReturnType<typeof negociosFalsos>

beforeEach(async () => {
  repo = repoEnMemoria(undefined, () => AHORA)
  neg = negociosFalsos()
  await guardarProducto(repo, WS, { sku: 'EKM80', nombre: 'Esmeril 800 W', marca: 'Ekon', costo: { fecha_lista: '2026-09-23', costo_f: 80_000 } }, AHORA)
  await guardarProducto(repo, WS, { sku: 'EKM80', costo: { fecha_lista: '2026-10-15', costo_f: 90_000 } }, AHORA)
  const r = await guardarPublicacion(
    repo,
    WS,
    { codigo: 'MP-01', sku: 'EKM80', titulo: 'Esmeril Ekon 800 W', precio: 120_000, estado: 'activa', linea: 'ticket_alto' },
    { origen: 'canal', autor: AGENTE, ahora: AHORA },
  )
  expect(r.ok).toBe(true)
})

async function pub() {
  const p = await repo.publicacionPorCodigo(WS, 'MP-01')
  if (!p) throw new Error('sin MP-01')
  return p
}

const GANANCIA_120 = Math.round(120_000 * 0.777933 - 80_000 * 0.840336)

async function vender(forma_pago: 'anticipado' | 'contra_entrega', extra: Partial<Parameters<typeof registrarVenta>[4]> = {}) {
  return registrarVenta(
    repo,
    neg.puerto,
    WS,
    await pub(),
    { fecha_venta: '2026-10-03', precio_final: 120_000, ruta: 'despacho', forma_pago, comprador_nombre: 'Pedro Pérez', ...extra },
    DIETMAR,
    HOY,
  )
}

describe('registrar la venta crea su negocio', () => {
  it('congela el costo del día de la venta, crea el negocio con el precio aprobado y lo enlaza', async () => {
    const r = await vender('contra_entrega')
    if (!r.ok) throw new Error(r.mensaje)
    expect(r.avisos).toEqual([])
    const venta = repo.estado.ventas[0]
    // Costo del 23-sep (80.000), no el del 15-oct.
    expect(venta).toMatchObject({ costo_dia: 80_000, ganancia: GANANCIA_120, negocio_id: r.negocioId, fecha_venta: '2026-10-03', fecha_primer_pago: null, forma_pago: 'contra_entrega', comprador_nombre: 'Pedro Pérez' })
    const n = neg.negocios.get(r.negocioId)!
    expect(n).toMatchObject({ nombre: 'Venta MP-01 · Esmeril Ekon 800 W', paso: 'vendido', abierto: true, precioAprobado: 120_000, responsable: true })
    expect(n.pagos).toEqual([])
    expect(repo.estado.eventos.at(-1)).toMatchObject({ tipo: 'venta' })
  })

  it('si el negocio no se puede crear, la venta no queda', async () => {
    neg.fallar.crear = 'sin línea Ferretería'
    const r = await vender('anticipado')
    expect(r).toEqual({ ok: false, mensaje: 'No se pudo crear el negocio de la venta: sin línea Ferretería' })
    expect(repo.estado.ventas).toHaveLength(0)
    expect(repo.estado.eventos.filter((e) => e.tipo === 'venta')).toHaveLength(0)
  })

  it('rechaza sin escribir: fecha futura, sin lista de costos, conversación ajena, forma de pago desconocida', async () => {
    expect(await vender('anticipado', { fecha_venta: '2026-10-06' })).toMatchObject({ ok: false })
    expect(await vender('anticipado', { fecha_venta: '2026-09-01' })).toEqual({ ok: false, mensaje: 'No hay una lista de costos vigente en la fecha de la venta.' })
    expect(await vender('anticipado', { conversacion_id: 'conv-que-no-existe' })).toMatchObject({ ok: false })
    expect(await vender('a_credito' as 'anticipado')).toMatchObject({ ok: false })
    expect(repo.estado.ventas).toHaveLength(0)
    expect(neg.negocios.size).toBe(0)
  })
})

describe('contra entrega: Vendido → Entregado → el pago lo lleva a Pagado y cierra', () => {
  it('recorre las tres etapas y cierra ganado con el pago registrado', async () => {
    const r = await vender('contra_entrega')
    if (!r.ok) throw new Error(r.mensaje)
    const ventaId = r.ventaId

    // No se cobra antes de entregar.
    expect(await registrarPagoDeVenta(repo, neg.puerto, WS, ventaId, '2026-10-04', HOY)).toMatchObject({ ok: false })

    expect(await marcarVentaEntregada(repo, neg.puerto, WS, ventaId, AHORA)).toEqual({ ok: true, cerrado: false })
    expect(neg.negocios.get(r.negocioId)).toMatchObject({ paso: 'entregado', abierto: true })

    expect(await registrarPagoDeVenta(repo, neg.puerto, WS, ventaId, '2026-10-05', HOY)).toEqual({ ok: true, cerrado: true })
    const n = neg.negocios.get(r.negocioId)!
    expect(n).toMatchObject({ paso: 'pagado', abierto: false })
    expect(n.pagos).toEqual([{ monto: 120_000, fecha: '2026-10-05', referencia: referenciaPago('MP-01', ventaId) }])
    expect(repo.estado.ventas[0]).toMatchObject({ fecha_primer_pago: '2026-10-05', entregada_at: AHORA })

    // Segundo intento: ya pagada.
    expect(await registrarPagoDeVenta(repo, neg.puerto, WS, ventaId, '2026-10-05', HOY)).toMatchObject({ ok: false })
  })

  it('si ONE no deja pasar a Entregado, la venta no se marca', async () => {
    const r = await vender('contra_entrega')
    if (!r.ok) throw new Error(r.mensaje)
    neg.fallar.moverA = 'Sin permiso'
    expect(await marcarVentaEntregada(repo, neg.puerto, WS, r.ventaId, AHORA)).toMatchObject({ ok: false })
    expect(repo.estado.ventas[0].entregada_at).toBeNull()
  })

  it('si el cierre falla después del pago, se avisa y reintentar lo termina', async () => {
    const r = await vender('contra_entrega')
    if (!r.ok) throw new Error(r.mensaje)
    await marcarVentaEntregada(repo, neg.puerto, WS, r.ventaId, AHORA)
    neg.fallar.completar = 'gate pendiente'
    const pago = await registrarPagoDeVenta(repo, neg.puerto, WS, r.ventaId, '2026-10-05', HOY)
    expect(pago).toMatchObject({ ok: true, cerrado: false })
    expect(neg.negocios.get(r.negocioId)).toMatchObject({ paso: 'pagado', abierto: true })

    delete neg.fallar.completar
    const venta = await repo.ventaPorId(WS, r.ventaId)
    expect(await alinearNegocio(neg.puerto, venta!)).toEqual({ ok: true, cerrado: true })
    expect(neg.negocios.get(r.negocioId)!.abierto).toBe(false)
    expect(neg.negocios.get(r.negocioId)!.pagos).toHaveLength(1)
  })
})

describe('anticipado: el pago entra al crear y cierra al marcar la entrega', () => {
  it('registra el cobro al nacer y al entregarse pasa por Entregado a Pagado y cierra', async () => {
    const r = await vender('anticipado')
    if (!r.ok) throw new Error(r.mensaje)
    const n = neg.negocios.get(r.negocioId)!
    expect(n.pagos).toEqual([{ monto: 120_000, fecha: '2026-10-03', referencia: referenciaPago('MP-01', r.ventaId) }])
    expect(n).toMatchObject({ paso: 'vendido', abierto: true })
    expect(repo.estado.ventas[0].fecha_primer_pago).toBe('2026-10-03')

    // Ya pagada: no hay segundo cobro.
    expect(await registrarPagoDeVenta(repo, neg.puerto, WS, r.ventaId, '2026-10-05', HOY)).toMatchObject({ ok: false })

    expect(await marcarVentaEntregada(repo, neg.puerto, WS, r.ventaId, AHORA)).toEqual({ ok: true, cerrado: true })
    expect(neg.negocios.get(r.negocioId)).toMatchObject({ paso: 'pagado', abierto: false })
    expect(neg.negocios.get(r.negocioId)!.historial).toEqual(expect.arrayContaining(['etapa entregado', 'etapa pagado', 'completado']))
    expect(neg.negocios.get(r.negocioId)!.pagos).toHaveLength(1)
  })

  it('si el cobro anticipado falla, la venta y el negocio quedan y se avisa', async () => {
    neg.fallar.registrarPago = 'referencia duplicada'
    const r = await vender('anticipado')
    expect(r).toMatchObject({ ok: true })
    if (!r.ok) return
    expect(r.avisos).toHaveLength(1)
    expect(r.avisos[0]).toContain('pago anticipado')
    expect(repo.estado.ventas).toHaveLength(1)
  })
})
