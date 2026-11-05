/**
 * Qué hace ONE con un pago de Bold de un link del CARRITO de un asistente de ventas (spec
 * docs/specs/2026-11-04_carrito-asistentes-venta.md). Sin red ni base: todo entra por `DepsPagoCarrito`, así que las
 * pruebas lo corren con dobles.
 *
 * El asistente (Edge Function `chatwoot-agente`) congela el carrito y registra el link en `carrito_pagos`. El webhook de
 * Bold del workspace (`/api/webhooks/bold/funciones/[workspace]`) ya verificó la firma; si el `LNK_…` es de esa tabla,
 * llega aquí en vez de a `funcion_registrar_pago`.
 *
 * Un pago APROBADO se vuelve venta en ONE por el CONVERTIDOR del dominio del carrito (Ferretería: un negocio con una
 * venta por línea). Después: campana al equipo y aviso al asistente para que le confirme al cliente.
 *
 * Idempotencia por `LNK_…` (Bold reintenta): un pago `aprobado` no hace nada. Para trabajarlo hay que RECLAMARLO:
 * `procesando` desde `creado`, `rechazado`, `vencido` o `error`, o desde un `procesando` de más de 2 minutos (un corte).
 * Dos entregas simultáneas no registran dos veces; la que no pudo reclamar responde 500 (`en_proceso`) y Bold reintenta.
 * El convertidor anota cada venta en su línea y el negocio en el carrito apenas existen: el reintento retoma.
 *
 * El monto: el del aviso tiene que ser el del link y en COP (mismo `pspReference` con otro monto = error, como Saleor).
 * Si el aviso no trae monto, se le pregunta a Bold por el link; si tampoco lo dice, no se registra. Un pago que llega
 * con el link vencido o reemplazado SE REGISTRA igual (la plata entró), con su carrito congelado, y se avisa.
 */

/** El carrito pagado como lo ve el servidor. */
export interface CarritoPagado {
  id: string
  workspace_id: string
  dominio: string
  estado: string
  subtotal: number
  flete: number
  total: number
  zona: string
  ruta: 'despacho' | 'recoge'
  comprador_nombre: string
  comprador_telefono: string
  direccion: string | null
  chatwoot_cuenta_id: number
  chatwoot_conversacion_id: number
  canal: string
  negocio_id: string | null
}

export interface LineaPagada {
  id: string
  orden: number
  item_tipo: string
  item_id: string
  codigo: string
  descripcion: string
  cantidad: number
  precio_unitario: number
  venta_id: string | null
}

export interface PagoCarritoFila {
  id: string
  carrito_id: string
  referencia: string
  monto: number
  version: number
  estado: 'creado' | 'procesando' | 'aprobado' | 'rechazado' | 'vencido' | 'error'
  motivo: string | null
}

/** Cuánto vive un `procesando` antes de leerse como un corte y volverse a reclamar. */
export const PROCESANDO_VENCE_MS = 2 * 60_000

export interface RepoPagosCarrito {
  /** Suma una recepción del aviso (para ver los reintentos de Bold). */
  recibido(pagoId: string): Promise<void>
  /** `procesando` desde un estado libre o un `procesando` reclamado antes de `vencidoAntesDe`. `false` = otro lo tiene. */
  reclamar(pagoId: string, ahoraIso: string, vencidoAntesDe: string): Promise<boolean>
  leerPago(pagoId: string): Promise<PagoCarritoFila | null>
  carrito(carritoId: string): Promise<CarritoPagado | null>
  lineas(carritoId: string): Promise<LineaPagada[]>
  anotarVenta(lineaId: string, ventaId: string | null): Promise<void>
  anotarNegocio(carritoId: string, negocioId: string): Promise<void>
  /** Cierra el pago: `aprobado` (con el carrito `registrado`) o `error`. */
  cerrar(pagoId: string, cierre: { estado: 'aprobado' | 'error'; motivo?: string | null; monto_recibido?: number | null }, ahoraIso: string): Promise<void>
  /** El carrito pasa a `pagado` (la plata entró; falta registrar) o `registrado`. */
  marcarCarrito(carritoId: string, estado: 'pagado' | 'registrado', ahoraIso: string): Promise<void>
  /** Un pago rechazado: solo si sigue `creado` o `error`. */
  marcarRechazado(pagoId: string, ahoraIso: string): Promise<void>
}

/** Lo que pone cada dominio: cómo un carrito pagado se vuelve venta en ONE. */
export interface ConvertidorCarrito {
  registrar(e: {
    carrito: CarritoPagado
    lineas: LineaPagada[]
    referencia: string
    hoyISO: string
    anotarVenta(lineaId: string, ventaId: string | null): Promise<void>
    anotarNegocio(negocioId: string): Promise<void>
  }): Promise<{ ok: true; negocioId: string; avisos: string[] } | { ok: false; mensaje: string }>
}

export interface DepsPagoCarrito {
  repo: RepoPagosCarrito
  convertidor: ConvertidorCarrito
  /** El link en Bold (`GET /online/link/v1/{LNK}`), para el aviso que no trae el monto. Null si no respondió. */
  consultarLink(referencia: string): Promise<{ estado: string; total: number | null } | null>
  /** La campana del equipo. No lanza. */
  avisar(texto: string, pagoId: string): Promise<void>
  /** El aviso al asistente (Chatwoot: confirmar y pasar a persona con `despachar`). No lanza. */
  confirmarEnChatwoot(referencia: string): Promise<void>
  ahoraIso: string
  hoyISO: string
}

export interface SalidaPagoCarrito {
  /** 500 hace que Bold reintente: solo para lo que un reintento puede arreglar. */
  status: 200 | 500
  body: Record<string, unknown>
}

function pesos(n: number): string {
  return `$${Math.round(n).toLocaleString('es-CO')}`
}

/** «MP-62 ×1, MP-64 ×2». */
export function detalleLineas(lineas: LineaPagada[]): string {
  return lineas.map((l) => `${l.codigo} ×${l.cantidad}`).join(', ')
}

export function textoAvisoCarrito(tipo: 'registrada' | 'error', c: CarritoPagado, lineas: LineaPagada[], motivo?: string): string {
  const destino = c.ruta === 'despacho' ? `despachar${c.direccion ? ` a ${c.direccion}` : ''}` : 'recoge en punto'
  if (tipo === 'registrada') {
    return `Pago Bold aprobado ${detalleLineas(lineas)} ${pesos(c.total)} (flete ${pesos(c.flete)}), ${c.comprador_nombre}, ${destino}${motivo ? `. ${motivo}` : ''}`
      .replace(/\s+/g, ' ')
  }
  return `Pago Bold aprobado ${pesos(c.total)} de ${c.comprador_nombre} no quedó registrado: ${motivo ?? 'error'}`
}

const listo = (body: Record<string, unknown>): SalidaPagoCarrito => ({ status: 200, body: { ok: true, ...body } })

export async function procesarPagoCarrito(
  pagoRecibido: PagoCarritoFila,
  evento: { estado: 'aprobado' | 'fallido'; monto: number | null; moneda?: string | null },
  deps: DepsPagoCarrito,
): Promise<SalidaPagoCarrito> {
  const id = pagoRecibido.id
  // Cómo estaba ANTES de reclamarlo (después se lee `procesando`): un link vencido que igual se pagó se avisa.
  const previo = { estado: pagoRecibido.estado, motivo: pagoRecibido.motivo }
  await deps.repo.recibido(id)
  if (pagoRecibido.estado === 'aprobado') return listo({ resultado: 'registrada', repetida: true })

  if (evento.estado === 'fallido') {
    // El link sigue abierto en Bold: un rechazo no cierra nada; queda anotado por si el cliente vuelve a intentar.
    await deps.repo.marcarRechazado(id, deps.ahoraIso)
    return listo({ resultado: 'rechazado' })
  }

  const vencido = new Date(Date.parse(deps.ahoraIso) - PROCESANDO_VENCE_MS).toISOString()
  if (!(await deps.repo.reclamar(id, deps.ahoraIso, vencido))) {
    return { status: 500, body: { ok: false, resultado: 'en_proceso' } }
  }

  // Desde aquí el pago es de este proceso: toda salida lo cierra, y los cierres van dentro del try.
  let carrito: CarritoPagado | null = null
  let lineas: LineaPagada[] = []
  const error = async (motivo: string, monto: number | null): Promise<SalidaPagoCarrito> => {
    await deps.repo.cerrar(id, { estado: 'error', motivo, monto_recibido: monto }, deps.ahoraIso)
    if (carrito) await deps.avisar(textoAvisoCarrito('error', carrito, lineas, motivo), id)
    return listo({ resultado: 'error' })
  }
  try {
    const pago = (await deps.repo.leerPago(id)) ?? pagoRecibido
    carrito = await deps.repo.carrito(pago.carrito_id)
    if (!carrito) return await error('El carrito del link ya no existe.', evento.monto)
    lineas = await deps.repo.lineas(carrito.id)
    if (!lineas.length) return await error('El carrito del link no tiene productos.', evento.monto)

    if (evento.moneda && evento.moneda !== 'COP') return await error(`Bold avisó un pago en ${evento.moneda}, no en COP.`, evento.monto)
    let monto = evento.monto
    if (monto === null) {
      const c = await deps.consultarLink(pago.referencia)
      if (!c || c.estado !== 'PAID' || c.total === null) return await error('El aviso de Bold no trae el monto y Bold no lo confirmó al consultar el link.', null)
      monto = c.total
    }
    if (Math.round(monto) !== Math.round(pago.monto)) {
      return await error(`Bold cobró ${pesos(monto)} y el link era por ${pesos(pago.monto)}: revisar antes de despachar.`, monto)
    }
    // El link era de una versión vieja del carrito (lo reemplazó otro): la plata entró, se registra lo que cobró ese link
    // solo si el carrito sigue en esa versión; si no, lo revisa una persona.
    if (Math.round(carrito.total) !== Math.round(pago.monto)) {
      return await error(`El link cobró ${pesos(pago.monto)} pero el carrito ya es de ${pesos(carrito.total)} (el cliente lo cambió después): revisar a mano.`, monto)
    }
    const tarde = previo.estado === 'vencido' ? `Ojo: el link estaba vencido o reemplazado (${previo.motivo ?? 'sin motivo'}), pero la plata entró.` : null

    await deps.repo.marcarCarrito(carrito.id, 'pagado', deps.ahoraIso)
    const cid = carrito.id
    const r = await deps.convertidor.registrar({
      carrito,
      lineas,
      referencia: pago.referencia,
      hoyISO: deps.hoyISO,
      anotarVenta: (lineaId, ventaId) => deps.repo.anotarVenta(lineaId, ventaId),
      anotarNegocio: (negocioId) => deps.repo.anotarNegocio(cid, negocioId),
    })
    if (!r.ok) return await error(r.mensaje, monto)

    const motivo = [tarde, ...r.avisos].filter(Boolean).join(' ') || null
    await deps.repo.marcarCarrito(carrito.id, 'registrado', deps.ahoraIso)
    await deps.repo.cerrar(id, { estado: 'aprobado', motivo, monto_recibido: monto }, deps.ahoraIso)
    await deps.avisar(textoAvisoCarrito('registrada', carrito, lineas, tarde ?? undefined), id)
    await deps.confirmarEnChatwoot(pago.referencia)
    return listo({ resultado: 'registrada', negocio: r.negocioId, productos: lineas.length })
  } catch (e) {
    // La base falló a mitad. Lo ya anotado (ventas, negocio) lo retoma el reintento. El pago pasa a `error` y Bold
    // reintenta (500).
    try {
      await deps.repo.cerrar(id, { estado: 'error', motivo: `Falló el registro de la venta: ${(e as Error).message}` }, deps.ahoraIso)
    } catch {
      // Sin base no se puede ni cerrar: queda en `procesando` y se retoma cuando venza.
    }
    return { status: 500, body: { ok: false, motivo: 'error_interno' } }
  }
}
