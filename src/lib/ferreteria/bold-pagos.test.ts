import { beforeEach, describe, expect, it } from 'vitest'
import { guardarProducto, guardarPublicacion } from './nucleo'
import { repoEnMemoria } from './repo-memoria'
import type { Autor, PuertoNegocios, RepoFerreteria } from './tipos'
import { procesarPagoBold, type CierreLinkBold, type DepsPagoBold, type LinkBoldFila, type RepoLinksBold } from './bold-pagos'

/** Datos INVENTADOS. */
const WS = 'ws-dimpro'
const AHORA = '2026-10-29T17:00:00.000Z'
const HOY = '2026-10-29'
const AGENTE: Autor = { tipo: 'agente', id: null, nombre: 'Agente MeTRIK' }

/** La tabla `ferreteria_links_bold` en memoria, con el mismo reclamo que la base (solo desde creado/rechazado/error). */
function linksEnMemoria(filas: LinkBoldFila[]) {
  const veces: Record<string, number> = {}
  const conversaciones: string[] = []
  const repo: RepoLinksBold = {
    async recibido(id) {
      veces[id] = (veces[id] ?? 0) + 1
    },
    async reclamar(id) {
      const f = filas.find((x) => x.id === id)
      if (!f || !['creado', 'rechazado', 'error'].includes(f.registro)) return false
      f.registro = 'procesando'
      return true
    },
    async cerrar(id, c: CierreLinkBold) {
      const f = filas.find((x) => x.id === id)!
      f.registro = c.registro
      if (c.venta_id !== undefined) f.venta_id = c.venta_id
    },
    async conversacion(fila) {
      conversaciones.push(`chatwoot:${fila.chatwoot_cuenta_id}:${fila.chatwoot_conversacion_id}`)
      return null
    },
  }
  return { repo, veces, conversaciones }
}

function negociosFalsos() {
  const creados: { id: string; pagos: { monto: number; referencia: string }[] }[] = []
  const puerto: PuertoNegocios = {
    async crear() {
      const id = `neg-${creados.length + 1}`
      creados.push({ id, pagos: [] })
      return { ok: true, negocioId: id }
    },
    fijarPrecioAprobado: async () => null,
    async registrarPago(id, pago) {
      creados.find((n) => n.id === id)!.pagos.push(pago)
      return null
    },
    estado: async () => ({ paso: 'vendido', abierto: true }),
    moverA: async () => 'no',
    completar: async () => 'no',
    asignarResponsable: async () => null,
    anotar: async () => {},
  }
  return { puerto, creados }
}

let repo: RepoFerreteria & { estado: ReturnType<typeof repoEnMemoria>['estado'] }
let pubId: string
let fila: LinkBoldFila
let links: ReturnType<typeof linksEnMemoria>
let neg: ReturnType<typeof negociosFalsos>
let avisos: string[]
let confirmados: string[]

function deps(extra: Partial<DepsPagoBold> = {}): DepsPagoBold {
  return {
    ws: WS,
    repo,
    links: links.repo,
    negocios: async () => neg.puerto,
    avisar: async (t) => {
      avisos.push(t)
    },
    confirmarEnChatwoot: async (r) => {
      confirmados.push(r)
    },
    ahoraIso: AHORA,
    hoyISO: HOY,
    ...extra,
  }
}

beforeEach(async () => {
  repo = repoEnMemoria(undefined, () => AHORA)
  await guardarProducto(repo, WS, { sku: 'EJ-TAL650', nombre: 'Taladro de ejemplo', costo: { fecha_lista: '2026-10-01', costo_f: 150_000 } }, AHORA)
  const r = await guardarPublicacion(
    repo,
    WS,
    { codigo: 'MP-01', sku: 'EJ-TAL650', titulo: 'Taladro percutor 650 W', precio: 250_000, estado: 'activa' },
    { origen: 'canal', autor: AGENTE, ahora: AHORA },
  )
  expect(r.ok).toBe(true)
  pubId = (await repo.publicacionPorCodigo(WS, 'MP-01'))!.id
  fila = {
    id: 'link-1', workspace_id: WS, referencia: 'LNK_PRUEBA1', publicacion_id: pubId, cantidad: 2, precio_unitario: 250_000, flete: 15_000,
    monto: 515_000, zona: 'bogota', ruta: 'despacho', comprador_nombre: 'Ana Pérez', comprador_telefono: '3001234567', direccion: 'Calle 1 # 2-3',
    chatwoot_cuenta_id: 77, chatwoot_conversacion_id: 9001, canal: 'instagram', registro: 'creado', venta_id: null,
  }
  links = linksEnMemoria([fila])
  neg = negociosFalsos()
  avisos = []
  confirmados = []
})

describe('pago de Bold de un link del asistente de ventas', () => {
  it('aprobado: venta anticipada por producto × cantidad (sin flete), cobro BOLD-<LNK>, aviso y confirmación en Chatwoot', async () => {
    const s = await procesarPagoBold(fila, { estado: 'aprobado', monto: 515_000 }, deps())
    expect(s).toMatchObject({ status: 200, body: { ok: true, resultado: 'registrada' } })
    expect(repo.estado.ventas).toHaveLength(1)
    const v = repo.estado.ventas[0]
    expect(v).toMatchObject({ precio_final: 500_000, cantidad: 2, ruta: 'despacho', forma_pago: 'anticipado', fecha_venta: HOY, comprador_nombre: 'Ana Pérez', negocio_id: 'neg-1' })
    // La ganancia se mide contra el costo de las DOS unidades.
    expect(v.costo_dia).toBe(150_000)
    expect(v.ganancia).toBe(Math.round(500_000 * 0.777933 - 300_000 * 0.840336))
    expect(neg.creados[0].pagos).toEqual([{ monto: 500_000, fecha: HOY, referencia: 'BOLD-LNK_PRUEBA1' }])
    expect(fila.registro).toBe('registrada')
    expect(fila.venta_id).toBe(v.id)
    expect(links.conversaciones).toEqual(['chatwoot:77:9001'])
    expect(avisos[0]).toContain('Pago Bold aprobado MP-01 ×2')
    expect(avisos[0]).toContain('despachar a Calle 1 # 2-3')
    expect(confirmados).toEqual(['LNK_PRUEBA1'])
  })

  it('el mismo webhook dos veces: una sola venta y un solo aviso', async () => {
    await procesarPagoBold(fila, { estado: 'aprobado', monto: 515_000 }, deps())
    const s2 = await procesarPagoBold(fila, { estado: 'aprobado', monto: 515_000 }, deps())
    expect(s2.body).toMatchObject({ ok: true, repetida: true })
    expect(repo.estado.ventas).toHaveLength(1)
    expect(neg.creados).toHaveLength(1)
    expect(confirmados).toHaveLength(1)
    expect(links.veces['link-1']).toBe(2)
  })

  it('dos entregas a la vez: solo una reclama la fila', async () => {
    const [a, b] = await Promise.all([
      procesarPagoBold(fila, { estado: 'aprobado', monto: 515_000 }, deps()),
      procesarPagoBold({ ...fila }, { estado: 'aprobado', monto: 515_000 }, deps()),
    ])
    expect([a.body.resultado, b.body.resultado].sort()).toEqual(['en_proceso', 'registrada'])
    expect(repo.estado.ventas).toHaveLength(1)
  })

  it('monto distinto al del link: no registra, queda en error y avisa', async () => {
    const s = await procesarPagoBold(fila, { estado: 'aprobado', monto: 15_000 }, deps())
    expect(s.body.resultado).toBe('error')
    expect(repo.estado.ventas).toHaveLength(0)
    expect(fila.registro).toBe('error')
    expect(avisos[0]).toContain('no quedó registrado')
    expect(confirmados).toEqual([])
  })

  it('rechazado: no registra; el link queda abierto para otro intento que sí registra', async () => {
    await procesarPagoBold(fila, { estado: 'fallido', monto: 515_000 }, deps())
    expect(fila.registro).toBe('rechazado')
    expect(repo.estado.ventas).toHaveLength(0)
    await procesarPagoBold(fila, { estado: 'aprobado', monto: 515_000 }, deps())
    expect(repo.estado.ventas).toHaveLength(1)
  })

  it('la base falla a mitad: 500 para que Bold reintente, y el reintento registra', async () => {
    const s = await procesarPagoBold(fila, { estado: 'aprobado', monto: 515_000 }, deps({ negocios: async () => { throw new Error('base caída') } }))
    expect(s.status).toBe(500)
    expect(repo.estado.ventas).toHaveLength(0)
    expect(fila.registro).toBe('error')
    const r = await procesarPagoBold(fila, { estado: 'aprobado', monto: 515_000 }, deps())
    expect(r.body.resultado).toBe('registrada')
  })
})
