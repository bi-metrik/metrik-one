import { beforeEach, describe, expect, it } from 'vitest'
import { guardarProducto, guardarPublicacion } from './nucleo'
import { repoEnMemoria } from './repo-memoria'
import type { Autor, PuertoNegocios, RepoFerreteria } from './tipos'
import { checksumEvento, type EventoWompi } from './wompi'
import {
  procesarEventoWompi,
  RECLAMABLES_ASIGNAR,
  registrarVentaDePago,
  type AvisoPago,
  type DepsWompi,
  type FilaPagoWompi,
  type LinkWompi,
  type RepoPagosWompi,
} from './wompi-pagos'

const WS = 'ws-dimpro'
const SECRETO = 'test_events_PruebaMetrikFerreteria0000000001'
const AHORA = '2026-09-29T12:00:00.000Z'
const HOY = '2026-09-29'
const AGENTE: Autor = { tipo: 'agente', id: null, nombre: 'Agente MeTRIK' }
const DIETMAR: Autor = { tipo: 'persona', id: 'perfil-dietmar', nombre: 'Dietmar Niño' }

function evento(tx: Record<string, unknown>, environment = 'prod'): EventoWompi {
  const e: EventoWompi = {
    event: 'transaction.updated',
    data: { transaction: tx },
    environment,
    signature: { properties: ['transaction.id', 'transaction.status', 'transaction.amount_in_cents'], checksum: '' },
    timestamp: 1790627311,
  }
  e.signature.checksum = checksumEvento(e, SECRETO)
  return e
}

const APROBADO = {
  id: '1234-1790627311-49201',
  amount_in_cents: 32_190_000,
  reference: 'SoXVSa_1790627311_S6Wh9yfN4',
  customer_email: 'luis@example.com',
  currency: 'COP',
  payment_method_type: 'NEQUI',
  status: 'APPROVED',
  payment_link_id: 'SoXVSa',
  // 22:10 del 28-sep en Bogotá.
  finalized_at: '2026-09-29T03:10:00.000Z',
  customer_data: { full_name: 'Luis Carlos Gómez', phone_number: '573001112233', legal_id: '1020304050', legal_id_type: 'CC' },
  shipping_address: { address_line_1: 'Calle 45 # 23-10', city: 'Medellín', region: 'Antioquia', country: 'CO', phone_number: '573001112233' },
}

/** Pagos en memoria, con la misma llave única (transacción, estado) y el mismo reclamo que la base. */
function pagosEnMemoria() {
  const filas: FilaPagoWompi[] = []
  let seq = 0
  const repo: RepoPagosWompi = {
    async guardarEvento(nueva) {
      const previa = filas.find((f) => f.transaccion_id === nueva.transaccion_id && f.estado_wompi === nueva.estado_wompi)
      if (previa) {
        const antes = { ...previa }
        previa.veces_recibido += 1
        return { nuevo: false, fila: antes }
      }
      const { payload: _payload, ...resto } = nueva
      const fila: FilaPagoWompi = {
        ...resto,
        id: `pago-${++seq}`,
        sku: null,
        publicacion_id: null,
        registro: 'recibido',
        motivo: null,
        venta_id: null,
        veces_recibido: 1,
        recibido_at: AHORA,
        procesado_at: null,
      }
      filas.push(fila)
      return { nuevo: true, fila: { ...fila } }
    },
    async reclamar(id, desde = ['recibido', 'error']) {
      const f = filas.find((x) => x.id === id)
      if (!f || !desde.includes(f.registro)) return false
      f.registro = 'procesando'
      return true
    },
    async cerrar(id, c, ahora) {
      const f = filas.find((x) => x.id === id)!
      Object.assign(f, { registro: c.registro, motivo: c.motivo ?? null, procesado_at: ahora })
      if (c.venta_id !== undefined) f.venta_id = c.venta_id
      if (c.sku !== undefined) f.sku = c.sku
      if (c.publicacion_id !== undefined) f.publicacion_id = c.publicacion_id
      if (c.envio !== undefined) f.envio = c.envio
      if (c.pagado_at !== undefined) f.pagado_at = c.pagado_at
      Object.assign(f, c.comprador ?? {})
    },
    async anotarDatos(id, d) {
      const f = filas.find((x) => x.id === id)!
      if (d.sku !== undefined) f.sku = d.sku
      if (d.publicacion_id !== undefined) f.publicacion_id = d.publicacion_id
      if (d.envio !== undefined) f.envio = d.envio
      if (d.pagado_at !== undefined) f.pagado_at = d.pagado_at
      Object.assign(f, d.comprador ?? {})
    },
    async pagoPorId(ws, id) {
      const f = filas.find((x) => x.id === id && x.workspace_id === ws)
      return f ? { ...f } : null
    },
  }
  return { repo, filas }
}

/** Negocios de ONE, reducidos a lo que una venta anticipada toca al nacer. */
function negociosFalsos() {
  const creados: { id: string; nombre: string; comprador: string | null; telefono: string | null; pagos: { monto: number; fecha: string; referencia: string }[] }[] = []
  const puerto: PuertoNegocios = {
    async crear({ nombre, compradorNombre, compradorTelefono }) {
      const id = `neg-${creados.length + 1}`
      creados.push({ id, nombre, comprador: compradorNombre, telefono: compradorTelefono ?? null, pagos: [] })
      return { ok: true, negocioId: id }
    },
    async fijarPrecioAprobado() {
      return null
    },
    async registrarPago(id, pago) {
      creados.find((n) => n.id === id)!.pagos.push(pago)
      return null
    },
    async estado() {
      return { paso: 'vendido', abierto: true }
    },
    async moverA() {
      return 'no'
    },
    async completar() {
      return 'no'
    },
    async asignarResponsable() {
      return null
    },
    async anotar() {},
  }
  return { puerto, creados }
}

let repo: RepoFerreteria & { estado: ReturnType<typeof repoEnMemoria>['estado'] }
let pagos: ReturnType<typeof pagosEnMemoria>
let neg: ReturnType<typeof negociosFalsos>
let avisos: AvisoPago[]
let links: Record<string, LinkWompi | Error>
let lecturasDeLink: number

function deps(extra: Partial<DepsWompi> = {}): DepsWompi {
  return {
    ws: WS,
    repo,
    pagos: pagos.repo,
    moduloActivo: async () => true,
    leerLink: async (id) => {
      lecturasDeLink++
      const l = links[id]
      if (l instanceof Error) throw l
      return l ?? { existe: false, sku: null }
    },
    negocios: async () => neg.puerto,
    avisar: async (a) => {
      avisos.push(a)
    },
    ahoraIso: AHORA,
    hoyISO: HOY,
    ...extra,
  }
}

beforeEach(async () => {
  repo = repoEnMemoria(undefined, () => AHORA)
  pagos = pagosEnMemoria()
  neg = negociosFalsos()
  avisos = []
  lecturasDeLink = 0
  links = { SoXVSa: { existe: true, sku: 'MP-26' } }
  await guardarProducto(repo, WS, { sku: 'ECM130', nombre: 'Bomba Aquastrong ECM130', costo: { fecha_lista: '2026-09-01', costo_f: 250_000 } }, AHORA)
  const r = await guardarPublicacion(
    repo,
    WS,
    { codigo: 'MP-26', sku: 'ECM130', titulo: 'Bomba de agua Aquastrong ECM130 0,5 HP', precio: 321_900, estado: 'activa' },
    { origen: 'canal', autor: AGENTE, ahora: AHORA },
  )
  expect(r.ok).toBe(true)
})

describe('pago aprobado con código de publicación', () => {
  it('registra la venta anticipada con el negocio, el cobro WOMPI-<id> y avisa para despachar', async () => {
    const s = await procesarEventoWompi(evento(APROBADO), deps())
    expect(s).toMatchObject({ http: 200, resultado: 'registrada' })

    expect(repo.estado.ventas).toHaveLength(1)
    expect(repo.estado.ventas[0]).toMatchObject({
      precio_final: 321_900,
      // El pago fue a las 22:10 del 28 en Bogotá: la venta es del 28, no del 29 (UTC).
      fecha_venta: '2026-09-28',
      fecha_primer_pago: '2026-09-28',
      forma_pago: 'anticipado',
      ruta: 'despacho',
      comprador_nombre: 'Luis Carlos Gómez',
      conversacion_id: null,
      registrado_por: null,
      negocio_id: 'neg-1',
    })
    expect(neg.creados[0]).toMatchObject({ comprador: 'Luis Carlos Gómez', telefono: '573001112233' })
    expect(neg.creados[0].pagos).toEqual([{ monto: 321_900, fecha: '2026-09-28', referencia: 'WOMPI-1234-1790627311-49201' }])

    const fila = pagos.filas[0]
    expect(fila).toMatchObject({ registro: 'registrada', sku: 'MP-26', venta_id: repo.estado.ventas[0].id, comprador_documento: 'CC 1020304050' })
    expect(avisos).toEqual([
      { tipo: 'registrada', pagoId: fila.id, texto: 'Pago aprobado MP-26 $321.900, Luis Carlos Gómez, despachar a Calle 45 # 23-10, Medellín, Antioquia' },
    ])
    // La bitácora de la publicación dice quién la registró.
    expect(repo.estado.eventos.at(-1)).toMatchObject({ tipo: 'venta', autor_tipo: 'cron', autor_nombre: 'Pago Wompi' })
  })

  it('sin dirección de envío la venta es «recoge»', async () => {
    await procesarEventoWompi(evento({ ...APROBADO, shipping_address: null }), deps())
    expect(repo.estado.ventas[0].ruta).toBe('recoge')
    expect(avisos[0].texto).toBe('Pago aprobado MP-26 $321.900, Luis Carlos Gómez, recoge en punto')
  })

  it('Wompi reintenta el mismo evento: una sola venta, un solo aviso', async () => {
    await procesarEventoWompi(evento(APROBADO), deps())
    const s = await procesarEventoWompi(evento(APROBADO), deps())
    expect(s).toMatchObject({ http: 200, resultado: 'duplicado' })
    expect(repo.estado.ventas).toHaveLength(1)
    expect(neg.creados).toHaveLength(1)
    expect(avisos).toHaveLength(1)
    expect(pagos.filas[0].veces_recibido).toBe(2)
  })

  it('una fila que otro proceso ya reclamó no se trabaja dos veces', async () => {
    await pagos.repo.guardarEvento({
      workspace_id: WS, transaccion_id: APROBADO.id, estado_wompi: 'APPROVED', entorno: 'prod', payment_link_id: 'SoXVSa',
      referencia: null, metodo_pago: null, monto: 321_900, moneda: 'COP', pagado_at: null, comprador_nombre: null,
      comprador_email: null, comprador_telefono: null, comprador_documento: null, envio: null, payload: {},
    })
    expect(await pagos.repo.reclamar('pago-1')).toBe(true)
    const s = await procesarEventoWompi(evento(APROBADO), deps())
    expect(s.resultado).toBe('en_proceso')
    expect(repo.estado.ventas).toHaveLength(0)
  })

  it('completa el comprador consultando la transacción cuando el evento no lo trae', async () => {
    const pobre = { ...APROBADO, customer_data: null, shipping_address: null }
    await procesarEventoWompi(evento(pobre), deps({ consultarTransaccion: async () => APROBADO }))
    expect(repo.estado.ventas[0]).toMatchObject({ comprador_nombre: 'Luis Carlos Gómez', ruta: 'despacho' })
    expect(pagos.filas[0]).toMatchObject({ comprador_nombre: 'Luis Carlos Gómez', comprador_documento: 'CC 1020304050' })
  })
})

describe('lo que solo se guarda', () => {
  it.each([
    ['DECLINED', 'prod', 'SoXVSa'],
    ['VOIDED', 'prod', 'SoXVSa'],
    ['ERROR', 'prod', 'SoXVSa'],
    ['APPROVED', 'test', 'SoXVSa'],
    ['APPROVED', 'prod', null],
  ])('%s en %s con link %s: se guarda, no hay venta ni aviso', async (status, entorno, link) => {
    const s = await procesarEventoWompi(evento({ ...APROBADO, status, payment_link_id: link }, entorno), deps())
    expect(s).toMatchObject({ http: 200, resultado: 'solo_guardado' })
    expect(pagos.filas).toHaveLength(1)
    expect(pagos.filas[0].registro).toBe('solo_guardado')
    expect(repo.estado.ventas).toHaveLength(0)
    expect(avisos).toHaveLength(0)
    expect(lecturasDeLink).toBe(0)
  })

  it('un rechazo y luego la aprobación de la misma transacción son dos eventos distintos', async () => {
    await procesarEventoWompi(evento({ ...APROBADO, status: 'DECLINED' }), deps())
    const s = await procesarEventoWompi(evento(APROBADO), deps())
    expect(s.resultado).toBe('registrada')
    expect(pagos.filas.map((f) => f.registro)).toEqual(['solo_guardado', 'registrada'])
  })

  it('con el módulo apagado no se registra nada', async () => {
    const s = await procesarEventoWompi(evento(APROBADO), deps({ moduloActivo: async () => false }))
    expect(s.resultado).toBe('solo_guardado')
    expect(repo.estado.ventas).toHaveLength(0)
  })

  it('otro tipo de evento se ignora sin guardar', async () => {
    const s = await procesarEventoWompi({ ...evento(APROBADO), event: 'nequi_token.updated' }, deps())
    expect(s).toMatchObject({ http: 200, resultado: 'ignorado' })
    expect(pagos.filas).toHaveLength(0)
  })
})

describe('pago aprobado sin publicación reconocible', () => {
  it('link sin sku (como SoXVSa, creado desde el panel): pendiente de asignar, avisa, no inventa publicación', async () => {
    links.SoXVSa = { existe: true, sku: null }
    const s = await procesarEventoWompi(evento(APROBADO), deps())
    expect(s).toMatchObject({ http: 200, resultado: 'pendiente_asignar' })
    expect(repo.estado.ventas).toHaveLength(0)
    expect(pagos.filas[0]).toMatchObject({ registro: 'pendiente_asignar', sku: null, publicacion_id: null })
    expect(avisos).toHaveLength(1)
    expect(avisos[0]).toMatchObject({ tipo: 'pendiente_asignar' })
    expect(avisos[0].texto).toContain('sin publicación')

    // El reintento no vuelve a avisar.
    await procesarEventoWompi(evento(APROBADO), deps())
    expect(avisos).toHaveLength(1)
  })

  it('sku que no es una publicación: pendiente, con el sku guardado', async () => {
    links.SoXVSa = { existe: true, sku: 'MP-99' }
    const s = await procesarEventoWompi(evento(APROBADO), deps())
    expect(s.resultado).toBe('pendiente_asignar')
    expect(pagos.filas[0]).toMatchObject({ sku: 'MP-99', publicacion_id: null })
    expect(pagos.filas[0].motivo).toContain('MP-99')
  })

  it('el link no existe en Wompi: pendiente', async () => {
    links = {}
    expect((await procesarEventoWompi(evento(APROBADO), deps())).resultado).toBe('pendiente_asignar')
  })

  it('«Asignar» desde la pestaña registra la venta con los datos del pago', async () => {
    links.SoXVSa = { existe: true, sku: null }
    await procesarEventoWompi(evento(APROBADO), deps())
    const fila = (await pagos.repo.pagoPorId(WS, 'pago-1'))!
    expect(await pagos.repo.reclamar(fila.id, RECLAMABLES_ASIGNAR)).toBe(true)
    const pub = (await repo.publicacionPorCodigo(WS, 'MP-26'))!
    const r = await registrarVentaDePago(repo, pagos.repo, neg.puerto, WS, fila, pub, DIETMAR, AHORA, HOY)
    expect(r.ok).toBe(true)
    expect(repo.estado.ventas[0]).toMatchObject({ precio_final: 321_900, forma_pago: 'anticipado', registrado_por: 'perfil-dietmar' })
    expect(pagos.filas[0]).toMatchObject({ registro: 'registrada', publicacion_id: pub.id })
  })
})

describe('fallas', () => {
  it('Wompi no responde al leer el link: 500 para que reintente, y el reintento registra', async () => {
    links.SoXVSa = new Error('timeout')
    const s = await procesarEventoWompi(evento(APROBADO), deps())
    expect(s).toMatchObject({ http: 500, resultado: 'error' })
    expect(pagos.filas[0].registro).toBe('error')

    links.SoXVSa = { existe: true, sku: 'MP-26' }
    const otra = await procesarEventoWompi(evento(APROBADO), deps())
    expect(otra.resultado).toBe('registrada')
    expect(repo.estado.ventas).toHaveLength(1)
  })

  it('sin lista de costos la venta no nace: error visible, aviso, 200 (reintentar no lo arregla)', async () => {
    const s = await procesarEventoWompi(evento({ ...APROBADO, finalized_at: '2026-08-01T15:00:00.000Z' }), deps())
    expect(s).toMatchObject({ http: 200, resultado: 'error' })
    expect(pagos.filas[0].registro).toBe('error')
    expect(pagos.filas[0].motivo).toContain('costos')
    expect(avisos[0]).toMatchObject({ tipo: 'error' })
    expect(repo.estado.ventas).toHaveLength(0)
  })

  it('sin línea Ferretería en ONE: error con el motivo, sin venta', async () => {
    const s = await procesarEventoWompi(evento(APROBADO), deps({ negocios: async () => ({ error: 'Este espacio no tiene la línea Ferretería configurada en ONE.' }) }))
    expect(s.resultado).toBe('error')
    expect(pagos.filas[0]).toMatchObject({ registro: 'error', publicacion_id: expect.any(String), sku: 'MP-26' })
    expect(repo.estado.ventas).toHaveLength(0)
  })

  it('la base se cae guardando el evento: la excepción sube (la ruta responde 500)', async () => {
    pagos.repo.guardarEvento = async () => {
      throw new Error('sin base')
    }
    await expect(procesarEventoWompi(evento(APROBADO), deps())).rejects.toThrow('sin base')
  })
})
