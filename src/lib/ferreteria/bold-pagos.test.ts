import { beforeEach, describe, expect, it } from 'vitest'
import { guardarProducto, guardarPublicacion } from './nucleo'
import { repoEnMemoria } from './repo-memoria'
import type { Autor, PuertoNegocios, RepoFerreteria } from './tipos'
import { procesarPagoBold, type DepsPagoBold, type LinkBoldFila, type RepoLinksBold } from './bold-pagos'

/** Datos INVENTADOS. */
const WS = 'ws-dimpro'
const AHORA = '2026-10-29T17:00:00.000Z'
const HOY = '2026-10-29'
const AGENTE: Autor = { tipo: 'agente', id: null, nombre: 'Agente MeTRIK' }

type FilaBase = LinkBoldFila & { reclamado_at: string | null; motivo: string | null }

/**
 * La tabla `ferreteria_links_bold` en memoria, como la base: guarda COPIAS (lo que el webhook recibió puede estar viejo),
 * el reclamo condicional (libre, o `procesando` vencido), el rechazo condicional y `venta_id` que se suelta al borrar.
 */
function linksEnMemoria(inicial: LinkBoldFila) {
  const filas: FilaBase[] = [{ ...inicial, reclamado_at: null, motivo: null }]
  const veces: Record<string, number> = {}
  const conversaciones: string[] = []
  const fallas: { cerrarRegistrada?: boolean } = {}
  const f = (id: string) => filas.find((x) => x.id === id)!
  const repo: RepoLinksBold = {
    async recibido(id) {
      veces[id] = (veces[id] ?? 0) + 1
    },
    async reclamar(id, ahora, vencido) {
      const x = f(id)
      const libre = ['creado', 'rechazado', 'error'].includes(x.registro)
      const viejo = x.registro === 'procesando' && x.reclamado_at !== null && x.reclamado_at < vencido
      if (!libre && !viejo) return false
      x.registro = 'procesando'
      x.reclamado_at = ahora
      return true
    },
    async leer(id) {
      const { reclamado_at: _r, motivo: _m, ...resto } = f(id)
      return { ...resto }
    },
    async anotarVenta(id, ventaId) {
      f(id).venta_id = ventaId
    },
    async cerrar(id, c) {
      if (c.registro === 'registrada' && fallas.cerrarRegistrada) {
        fallas.cerrarRegistrada = false
        throw new Error('la base se cayó al cerrar')
      }
      const x = f(id)
      x.registro = c.registro
      x.motivo = c.motivo ?? null
      if (c.venta_id !== undefined) x.venta_id = c.venta_id
    },
    async marcarRechazado(id) {
      const x = f(id)
      if (['creado', 'error'].includes(x.registro)) x.registro = 'rechazado'
    },
    async conversacion(fila) {
      conversaciones.push(`chatwoot:${fila.chatwoot_cuenta_id}:${fila.chatwoot_conversacion_id}`)
      return null
    },
  }
  return { repo, filas, veces, conversaciones, fallas }
}

function negociosFalsos() {
  const creados: { id: string; pagos: { monto: number; referencia: string }[] }[] = []
  const fallas: { crear?: boolean; pago?: boolean } = {}
  const puerto: PuertoNegocios = {
    async crear() {
      if (fallas.crear) {
        fallas.crear = false
        throw new Error('base caída al crear el negocio')
      }
      const id = `neg-${creados.length + 1}`
      creados.push({ id, pagos: [] })
      return { ok: true, negocioId: id }
    },
    fijarPrecioAprobado: async () => null,
    async registrarPago(id, pago) {
      if (fallas.pago) {
        fallas.pago = false
        throw new Error('base caída al registrar el pago')
      }
      creados.find((n) => n.id === id)!.pagos.push(pago)
      return null
    },
    estado: async () => ({ paso: 'vendido', abierto: true }),
    moverA: async () => 'no',
    completar: async () => 'no',
    asignarResponsable: async () => null,
    anotar: async () => {},
  }
  return { puerto, creados, fallas }
}

let repo: RepoFerreteria & { estado: ReturnType<typeof repoEnMemoria>['estado'] }
let fila: LinkBoldFila
let links: ReturnType<typeof linksEnMemoria>
let neg: ReturnType<typeof negociosFalsos>
let avisos: string[]
let confirmados: string[]
let consultaBold: { estado: string; total: number | null } | null

const base = () => links.filas[0]
const aprobado = (monto: number | null = 515_000, moneda: string | null = 'COP') => ({ estado: 'aprobado' as const, monto, moneda })

function deps(extra: Partial<DepsPagoBold> = {}): DepsPagoBold {
  return {
    ws: WS,
    repo,
    links: links.repo,
    negocios: async () => neg.puerto,
    consultarLink: async () => consultaBold,
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
  const pubId = (await repo.publicacionPorCodigo(WS, 'MP-01'))!.id
  fila = {
    id: 'link-1', workspace_id: WS, referencia: 'LNK_PRUEBA1', publicacion_id: pubId, cantidad: 2, precio_unitario: 250_000, flete: 15_000,
    monto: 515_000, zona: 'bogota', ruta: 'despacho', comprador_nombre: 'Ana Pérez', comprador_telefono: '3001234567', direccion: 'Calle 1 # 2-3',
    chatwoot_cuenta_id: 77, chatwoot_conversacion_id: 9001, canal: 'otro', registro: 'creado', venta_id: null,
  }
  links = linksEnMemoria(fila)
  neg = negociosFalsos()
  avisos = []
  confirmados = []
  consultaBold = null
})

describe('pago de Bold de un link del asistente de ventas', () => {
  it('aprobado: venta anticipada por producto × cantidad (sin flete), cobro BOLD-<LNK>, aviso y confirmación en Chatwoot', async () => {
    const s = await procesarPagoBold(fila, aprobado(), deps())
    expect(s).toMatchObject({ status: 200, body: { ok: true, resultado: 'registrada' } })
    expect(repo.estado.ventas).toHaveLength(1)
    const v = repo.estado.ventas[0]
    expect(v).toMatchObject({ precio_final: 500_000, cantidad: 2, ruta: 'despacho', forma_pago: 'anticipado', fecha_venta: HOY, comprador_nombre: 'Ana Pérez', negocio_id: 'neg-1' })
    expect(v.costo_dia).toBe(150_000)
    expect(v.ganancia).toBe(Math.round(500_000 * 0.777933 - 300_000 * 0.840336))
    expect(neg.creados[0].pagos).toEqual([{ monto: 500_000, fecha: HOY, referencia: 'BOLD-LNK_PRUEBA1' }])
    expect(base().registro).toBe('registrada')
    expect(base().venta_id).toBe(v.id)
    expect(links.conversaciones).toEqual(['chatwoot:77:9001'])
    expect(avisos[0]).toContain('Pago Bold aprobado MP-01 ×2')
    expect(confirmados).toEqual(['LNK_PRUEBA1'])
  })

  it('el mismo webhook dos veces: una sola venta y un solo aviso', async () => {
    await procesarPagoBold(fila, aprobado(), deps())
    const s2 = await procesarPagoBold({ ...base() }, aprobado(), deps())
    expect(s2.body).toMatchObject({ ok: true, repetida: true })
    expect(repo.estado.ventas).toHaveLength(1)
    expect(neg.creados).toHaveLength(1)
    expect(confirmados).toHaveLength(1)
    expect(links.veces['link-1']).toBe(2)
  })

  it('dos entregas a la vez: una registra; la otra responde 500 en_proceso (Bold reintenta) y no crea otra', async () => {
    const [a, b] = await Promise.all([procesarPagoBold(fila, aprobado(), deps()), procesarPagoBold({ ...fila }, aprobado(), deps())])
    expect([a.body.resultado, b.body.resultado].sort()).toEqual(['en_proceso', 'registrada'])
    expect([a.status, b.status].sort()).toEqual([200, 500])
    expect(repo.estado.ventas).toHaveLength(1)
  })
})

describe('cortes a mitad (revisión del PR #1336)', () => {
  it('1a. el negocio no se crea (excepción) tras insertar la venta: se borra, 500, y el reintento deja UNA venta', async () => {
    neg.fallas.crear = true
    const s = await procesarPagoBold(fila, aprobado(), deps())
    expect(s.status).toBe(500)
    expect(repo.estado.ventas).toHaveLength(0)
    expect(base()).toMatchObject({ registro: 'error', venta_id: null })
    const r = await procesarPagoBold({ ...base() }, aprobado(), deps())
    expect(r.body.resultado).toBe('registrada')
    expect(repo.estado.ventas).toHaveLength(1)
    expect(neg.creados).toHaveLength(1)
  })

  it('1b. falla DESPUÉS de crear el negocio: el reintento retoma esa venta, sin segunda venta ni segundo negocio', async () => {
    neg.fallas.pago = true
    const s = await procesarPagoBold(fila, aprobado(), deps())
    expect(s.status).toBe(500)
    expect(repo.estado.ventas).toHaveLength(1)
    expect(base().venta_id).toBe(repo.estado.ventas[0].id)
    const r = await procesarPagoBold({ ...base() }, aprobado(), deps())
    expect(r.body).toMatchObject({ resultado: 'registrada', retomada: true })
    expect(repo.estado.ventas).toHaveLength(1)
    expect(neg.creados).toHaveLength(1)
    expect(base().registro).toBe('registrada')
    expect(confirmados).toEqual(['LNK_PRUEBA1'])
  })

  it('2a. el cierre de «registrada» falla: 500 y el reintento la retoma (una venta)', async () => {
    links.fallas.cerrarRegistrada = true
    const s = await procesarPagoBold(fila, aprobado(), deps())
    expect(s.status).toBe(500)
    const r = await procesarPagoBold({ ...base() }, aprobado(), deps())
    expect(r.body.resultado).toBe('registrada')
    expect(repo.estado.ventas).toHaveLength(1)
    expect(base().registro).toBe('registrada')
  })

  it('2b. un procesando reciente: 500 en_proceso; uno de más de 2 minutos (un corte) se retoma', async () => {
    Object.assign(base(), { registro: 'procesando', reclamado_at: '2026-10-29T16:59:30.000Z' })
    const s = await procesarPagoBold({ ...base() }, aprobado(), deps())
    expect(s).toMatchObject({ status: 500, body: { resultado: 'en_proceso' } })
    expect(repo.estado.ventas).toHaveLength(0)
    base().reclamado_at = '2026-10-29T16:55:00.000Z'
    const r = await procesarPagoBold({ ...base() }, aprobado(), deps())
    expect(r.body.resultado).toBe('registrada')
    expect(repo.estado.ventas).toHaveLength(1)
  })
})

describe('el monto y la moneda (revisión del PR #1336)', () => {
  it('monto distinto al del link: no registra, queda en error y avisa', async () => {
    const s = await procesarPagoBold(fila, aprobado(15_000), deps())
    expect(s.body.resultado).toBe('error')
    expect(repo.estado.ventas).toHaveLength(0)
    expect(base().registro).toBe('error')
    expect(avisos[0]).toContain('no quedó registrado')
    expect(confirmados).toEqual([])
  })

  it('4a. aviso sin monto: se le pregunta a Bold; con PAID y el total del link, registra', async () => {
    consultaBold = { estado: 'PAID', total: 515_000 }
    const s = await procesarPagoBold(fila, aprobado(null), deps())
    expect(s.body.resultado).toBe('registrada')
    expect(repo.estado.ventas).toHaveLength(1)
  })

  it('4b. aviso sin monto y Bold no lo confirma: no registra', async () => {
    consultaBold = null
    expect((await procesarPagoBold(fila, aprobado(null), deps())).body.resultado).toBe('error')
    consultaBold = { estado: 'ACTIVE', total: 515_000 }
    base().registro = 'creado'
    expect((await procesarPagoBold({ ...base() }, aprobado(null), deps())).body.resultado).toBe('error')
    expect(repo.estado.ventas).toHaveLength(0)
  })

  it('4c. moneda distinta de COP: no registra', async () => {
    const s = await procesarPagoBold(fila, aprobado(515_000, 'USD'), deps())
    expect(s.body.resultado).toBe('error')
    expect(repo.estado.ventas).toHaveLength(0)
    expect(base().motivo).toContain('USD')
  })
})

describe('rechazos (revisión del PR #1336)', () => {
  it('rechazado: no registra; el link queda abierto para otro intento que sí registra', async () => {
    await procesarPagoBold(fila, { estado: 'fallido', monto: 515_000 }, deps())
    expect(base().registro).toBe('rechazado')
    await procesarPagoBold({ ...base() }, aprobado(), deps())
    expect(repo.estado.ventas).toHaveLength(1)
  })

  it('5. un rechazo que llega tarde (con la fila vieja en la mano) no pisa una venta registrada', async () => {
    const vieja = { ...fila }
    await procesarPagoBold(fila, aprobado(), deps())
    await procesarPagoBold(vieja, { estado: 'fallido', monto: 515_000 }, deps())
    expect(base().registro).toBe('registrada')
  })

  it('la base falla al pedir el negocio: 500 y la fila en error para el reintento', async () => {
    const s = await procesarPagoBold(fila, aprobado(), deps({ negocios: async () => { throw new Error('base caída') } }))
    expect(s.status).toBe(500)
    expect(repo.estado.ventas).toHaveLength(0)
    expect(base().registro).toBe('error')
    expect((await procesarPagoBold({ ...base() }, aprobado(), deps())).body.resultado).toBe('registrada')
  })
})
