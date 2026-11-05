/**
 * Una venta de Ferretería es un negocio de ONE en la línea Ferretería de Dimpro.
 *
 * Tres pasos, que son las tres etapas de esa línea:
 *
 *   contra entrega:  Vendido → Entregado → (entra el pago) → Pagado, cierra
 *   anticipado:      Vendido, con el pago registrado al nacer → (se entrega) → Pagado, cierra
 *
 * El registro es a mano (Dietmar o MeTRIK) o, para un pago aprobado de un link de Wompi con código
 * de publicación, lo hace el webhook (`wompi-pagos.ts`) por esta misma función. El cron no crea ventas.
 *
 * ── Orden de las escrituras ─────────────────────────────────────────────────────────
 * La venta nace primero (sin negocio) y el negocio después. Si el negocio no se puede crear, la
 * venta se borra y no queda nada a medias. Todo lo que pasa DESPUÉS de crear el negocio (precio
 * aprobado, responsable, pago anticipado) ya no deshace nada: se devuelve como aviso, porque
 * la venta y su negocio existen y lo que falta se completa desde ONE.
 *
 * Al avanzar, el negocio se mueve ANTES de marcar la venta: si ONE no deja moverlo, la venta
 * no cambia. Los pasos de después (pasar a Pagado y cerrar) los hace `alinearNegocio`, que lee
 * dónde está el negocio y lo lleva hasta el paso que la venta dice. Si se corta a mitad, se
 * vuelve a llamar y sigue desde donde quedó.
 *
 * La ganancia se congela al registrar (costo del día de la venta). La parte de MeTRIK no se
 * calcula aquí: es mensual (`liquidacion.ts`).
 *
 * ── Pedido del carrito (4-nov) ──────────────────────────────────────────────────────
 * Un carrito pagado del asistente de ventas es UN negocio con una venta por línea (`registrarPedido`): un pago, un
 * cliente, un paquete. La venta sigue siendo por publicación (ganancia y liquidación por producto). Entrega y pago contra
 * entrega se marcan por negocio: marcar una venta marca todas las de su negocio.
 */
import { conAutor } from './nucleo'
import {
  PASOS_VENTA,
  costoEnFecha,
  esFormaPago,
  formatoPesos,
  gananciaPorVenta,
  pasoDeVenta,
  ETIQUETA_FORMA_PAGO,
  RUTAS_VENTA,
  type FormaPago,
  type PasoVenta,
  type RutaVenta,
} from './reglas'
import type { Autor, PublicacionFila, PuertoNegocios, RepoFerreteria, VentaFila } from './tipos'

export interface EntradaVenta {
  fecha_venta: string
  precio_final: number
  ruta: string
  forma_pago: string
  comprador_nombre?: string | null
  /** Solo lo trae un pago de Wompi: ayuda a no duplicar el contacto del negocio. */
  comprador_telefono?: string | null
  conversacion_id?: string | null
  /**
   * Referencia del cobro anticipado. Sin ella, `referenciaPago` (FER-MP-xx-…). Un pago de Wompi
   * trae la suya (`WOMPI-<id de transacción>`), que además impide cobrarlo dos veces.
   */
  referencia_pago?: string | null
  /**
   * Unidades (asistente de ventas, 1 a 3). `precio_final` es el de todas; la ganancia se mide contra el costo F de
   * todas (costo del día × cantidad). Sin esto, 1.
   */
  cantidad?: number | null
}

type Fallo = { ok: false; mensaje: string }

const FECHA = /^\d{4}-\d{2}-\d{2}$/

/** Referencia del cobro en el negocio: legible y única por venta. */
export function referenciaPago(codigoPublicacion: string, ventaId: string): string {
  return `FER-${codigoPublicacion}-${ventaId.slice(0, 8)}`
}

export function nombreNegocioVenta(pub: Pick<PublicacionFila, 'codigo' | 'titulo'>): string {
  const nombre = `Venta ${pub.codigo} · ${pub.titulo.trim()}`
  return nombre.length > 120 ? `${nombre.slice(0, 119)}…` : nombre
}

export async function registrarVenta(
  repo: RepoFerreteria,
  negocios: PuertoNegocios,
  ws: string,
  pub: PublicacionFila,
  entrada: EntradaVenta,
  autor: Autor,
  hoyISO: string,
  opciones: {
    /**
     * Apenas la venta existe (antes de su negocio): el pago de Bold la anota en su link para que un reintento tras un
     * corte a mitad no cree otra. Si lanza, la venta recién insertada se borra y el error sigue.
     */
    alInsertar?: (ventaId: string) => Promise<void>
  } = {},
): Promise<{ ok: true; ventaId: string; negocioId: string; ganancia: number; avisos: string[] } | Fallo> {
  if (!FECHA.test(entrada.fecha_venta)) return { ok: false, mensaje: 'La fecha de la venta no es válida.' }
  if (entrada.fecha_venta > hoyISO) return { ok: false, mensaje: 'La fecha de la venta no puede ser futura.' }
  const precio = Number(entrada.precio_final)
  if (!Number.isFinite(precio) || precio <= 0) return { ok: false, mensaje: 'El precio final tiene que ser mayor que cero.' }
  if (!(RUTAS_VENTA as readonly string[]).includes(entrada.ruta)) return { ok: false, mensaje: 'Ruta desconocida.' }
  if (!esFormaPago(entrada.forma_pago)) return { ok: false, mensaje: 'Forma de pago desconocida.' }
  const formaPago: FormaPago = entrada.forma_pago
  const comprador = entrada.comprador_nombre?.trim() || null
  const cantidad = entrada.cantidad ?? 1
  if (!Number.isInteger(cantidad) || cantidad < 1 || cantidad > 50) return { ok: false, mensaje: 'La cantidad tiene que ser un entero entre 1 y 50.' }

  const conversacionId = entrada.conversacion_id?.trim() || null
  if (conversacionId) {
    const conv = await repo.conversacionPorId(ws, conversacionId)
    if (!conv || conv.publicacion_id !== pub.id) return { ok: false, mensaje: 'La conversación no es de esta publicación.' }
  }

  const costos = (await repo.costos(ws, pub.producto_id)).map((c) => ({ ...c, costo_f: Number(c.costo_f) }))
  const costo = costoEnFecha(costos, entrada.fecha_venta)
  if (!costo) return { ok: false, mensaje: 'No hay una lista de costos vigente en la fecha de la venta.' }
  const ganancia = gananciaPorVenta(precio, costo.costo_f * cantidad)

  const venta = await repo.insertarVenta({
    workspace_id: ws,
    publicacion_id: pub.id,
    conversacion_id: conversacionId,
    fecha_venta: entrada.fecha_venta,
    fecha_primer_pago: formaPago === 'anticipado' ? entrada.fecha_venta : null,
    precio_final: precio,
    costo_dia: costo.costo_f,
    ganancia,
    ruta: entrada.ruta as RutaVenta,
    forma_pago: formaPago,
    comprador_nombre: comprador,
    negocio_id: null,
    entregada_at: null,
    registrado_por: autor.tipo === 'persona' ? autor.id : null,
    ...(cantidad > 1 ? { cantidad } : {}),
  })
  if (opciones.alInsertar) {
    try {
      await opciones.alInsertar(venta.id)
    } catch (e) {
      await repo.borrarVenta(ws, venta.id)
      throw e
    }
  }

  const creado = await negocios.crear({
    nombre: nombreNegocioVenta(pub),
    precio,
    compradorNombre: comprador,
    compradorTelefono: entrada.comprador_telefono?.trim() || null,
  })
  if (!creado.ok) {
    await repo.borrarVenta(ws, venta.id)
    return { ok: false, mensaje: `No se pudo crear el negocio de la venta: ${creado.error}` }
  }
  const negocioId = creado.negocioId
  await repo.actualizarVenta(ws, venta.id, { negocio_id: negocioId })

  const avisos: string[] = []
  const errPrecio = await negocios.fijarPrecioAprobado(negocioId, precio)
  if (errPrecio) avisos.push(`El precio aprobado del negocio no quedó escrito: ${errPrecio}`)
  const errResp = await negocios.asignarResponsable(negocioId)
  if (errResp) avisos.push(`El negocio quedó sin responsable: ${errResp}`)
  if (formaPago === 'anticipado') {
    const errPago = await negocios.registrarPago(negocioId, {
      monto: precio,
      fecha: entrada.fecha_venta,
      referencia: entrada.referencia_pago?.trim() || referenciaPago(pub.codigo, venta.id),
    })
    if (errPago) avisos.push(`El pago anticipado no quedó en el negocio: ${errPago}. Regístralo desde el negocio.`)
  }

  await repo.insertarEventos([
    conAutor(ws, pub.id, autor, {
      tipo: 'venta',
      campo: null,
      valor_anterior: null,
      valor_nuevo: `precio ${precio} · ganancia ${ganancia} · ${entrada.ruta} · ${formaPago}`,
      motivo: null,
    }),
  ])
  await negocios.anotar(
    negocioId,
    `Venta de Ferretería ${pub.codigo}${cantidad > 1 ? ` (${cantidad} unidades)` : ''}: ${formatoPesos(precio)}, costo del día ${formatoPesos(costo.costo_f)}, ` +
      `ganancia ${formatoPesos(ganancia)}. ${ETIQUETA_FORMA_PAGO[formaPago]}, ${entrada.ruta === 'despacho' ? 'despacho' : 'recoge en punto'}.`,
  )

  return { ok: true, ventaId: venta.id, negocioId, ganancia, avisos }
}

/**
 * Lleva el negocio hasta el paso que dice la venta y, si ese paso es Pagado, lo cierra.
 * Idempotente: sobre un negocio ya alineado no hace nada.
 */
export async function alinearNegocio(
  negocios: PuertoNegocios,
  venta: Pick<VentaFila, 'negocio_id' | 'entregada_at' | 'fecha_primer_pago'>,
): Promise<{ ok: true; cerrado: boolean } | Fallo> {
  if (!venta.negocio_id) return { ok: false, mensaje: 'La venta no tiene negocio.' }
  const objetivo = pasoDeVenta(venta)
  const actual = await negocios.estado(venta.negocio_id)
  if (!actual) return { ok: false, mensaje: 'El negocio de la venta no existe.' }
  if (!actual.paso) return { ok: false, mensaje: 'El negocio no está en una etapa de la línea Ferretería.' }

  let paso: PasoVenta = actual.paso
  const indice = (p: PasoVenta) => PASOS_VENTA.indexOf(p)
  if (actual.abierto) {
    while (indice(paso) < indice(objetivo)) {
      const siguiente = PASOS_VENTA[indice(paso) + 1] as 'entregado' | 'pagado'
      const err = await negocios.moverA(venta.negocio_id, siguiente)
      if (err) return { ok: false, mensaje: `El negocio no pasó a ${siguiente}: ${err}` }
      paso = siguiente
    }
    if (objetivo === 'pagado') {
      const err = await negocios.completar(venta.negocio_id)
      if (err) return { ok: false, mensaje: `El negocio no se cerró: ${err}` }
      return { ok: true, cerrado: true }
    }
    return { ok: true, cerrado: false }
  }
  return { ok: true, cerrado: true }
}

export async function marcarVentaEntregada(
  repo: RepoFerreteria,
  negocios: PuertoNegocios,
  ws: string,
  ventaId: string,
  ahoraIso: string,
): Promise<{ ok: true; cerrado: boolean; aviso?: string } | Fallo> {
  const venta = await repo.ventaPorId(ws, ventaId)
  if (!venta) return { ok: false, mensaje: 'La venta no existe.' }
  if (!venta.negocio_id) return { ok: false, mensaje: 'La venta no tiene negocio en ONE.' }
  if (venta.entregada_at) return { ok: false, mensaje: 'La venta ya está entregada.' }

  const actual = await negocios.estado(venta.negocio_id)
  if (!actual) return { ok: false, mensaje: 'El negocio de la venta no existe.' }
  if (!actual.abierto) return { ok: false, mensaje: 'El negocio de la venta ya está cerrado.' }
  if (actual.paso === 'vendido') {
    const err = await negocios.moverA(venta.negocio_id, 'entregado')
    if (err) return { ok: false, mensaje: `El negocio no pasó a Entregado: ${err}` }
  }
  const entregada = { ...venta, entregada_at: ahoraIso }
  // Un pedido es un paquete: se entregan todas las ventas del negocio.
  for (const v of await hermanas(repo, ws, venta)) {
    if (!v.entregada_at) await repo.actualizarVenta(ws, v.id, { entregada_at: ahoraIso })
  }

  const r = await alinearNegocio(negocios, entregada)
  if (!r.ok) return { ok: true, cerrado: false, aviso: `Entrega registrada, pero ${r.mensaje.charAt(0).toLowerCase()}${r.mensaje.slice(1)}` }
  return { ok: true, cerrado: r.cerrado }
}

export async function registrarPagoDeVenta(
  repo: RepoFerreteria,
  negocios: PuertoNegocios,
  ws: string,
  ventaId: string,
  fecha: string,
  hoyISO: string,
): Promise<{ ok: true; cerrado: boolean; aviso?: string } | Fallo> {
  const venta = await repo.ventaPorId(ws, ventaId)
  if (!venta) return { ok: false, mensaje: 'La venta no existe.' }
  if (!venta.negocio_id) return { ok: false, mensaje: 'La venta no tiene negocio en ONE.' }
  if (venta.forma_pago !== 'contra_entrega') return { ok: false, mensaje: 'Esta venta se pagó por anticipado.' }
  if (venta.fecha_primer_pago) return { ok: false, mensaje: 'El pago de esta venta ya está registrado.' }
  if (!venta.entregada_at) return { ok: false, mensaje: 'Marca primero la entrega: contra entrega se paga al recibir.' }
  if (!FECHA.test(fecha)) return { ok: false, mensaje: 'La fecha del pago no es válida.' }
  if (fecha > hoyISO) return { ok: false, mensaje: 'La fecha del pago no puede ser futura.' }
  if (fecha < venta.fecha_venta) return { ok: false, mensaje: 'El pago no puede ser anterior a la venta.' }

  // Un pedido se paga entero: el cobro es la suma de sus ventas, y todas quedan pagadas.
  const delNegocio = (await hermanas(repo, ws, venta)).filter((v) => !v.fecha_primer_pago)
  const pub = await repo.publicacionPorId(ws, venta.publicacion_id)
  const err = await negocios.registrarPago(venta.negocio_id, {
    monto: delNegocio.reduce((s, v) => s + Number(v.precio_final), 0),
    fecha,
    referencia: referenciaPago(pub?.codigo ?? 'MP', venta.id),
  })
  if (err) return { ok: false, mensaje: `El pago no quedó en el negocio: ${err}` }
  const pagada = { ...venta, fecha_primer_pago: fecha }
  for (const v of delNegocio) await repo.actualizarVenta(ws, v.id, { fecha_primer_pago: fecha })

  const r = await alinearNegocio(negocios, pagada)
  if (!r.ok) return { ok: true, cerrado: false, aviso: `Pago registrado, pero ${r.mensaje.charAt(0).toLowerCase()}${r.mensaje.slice(1)}` }
  return { ok: true, cerrado: r.cerrado }
}

/** Las ventas del mismo negocio (ella incluida). Sin negocio, solo ella. */
async function hermanas(repo: RepoFerreteria, ws: string, venta: VentaFila & { id: string }): Promise<(VentaFila & { id: string })[]> {
  if (!venta.negocio_id) return [venta]
  const vs = await repo.ventasPorNegocio(ws, venta.negocio_id)
  return vs.some((v) => v.id === venta.id) ? vs : [venta, ...vs]
}

// ── Pedido del carrito del asistente ─────────────────────────────────────────

/** Una línea del carrito pagado: la publicación, sus unidades, la foto del precio y la venta si ya existe (reintento). */
export interface LineaPedidoVenta {
  lineaId: string
  pub: PublicacionFila
  cantidad: number
  precioUnitario: number
  ventaId: string | null
}

export interface EntradaPedido {
  lineas: LineaPedidoVenta[]
  /** El negocio ya creado por un intento anterior (reintento tras un corte), o null. */
  negocioId: string | null
  fecha_venta: string
  ruta: RutaVenta
  comprador_nombre: string
  comprador_telefono: string | null
  /** La conversación de origen (de la primera línea: `ferreteria_conversaciones` es por publicación). */
  conversacion_id: string | null
  /** La referencia del cobro (`BOLD-<LNK>`): una sola, del pedido entero. */
  referencia_pago: string
  flete: number
  direccion: string | null
}

export function nombreNegocioPedido(pubs: Array<Pick<PublicacionFila, 'codigo' | 'titulo'>>): string {
  if (pubs.length === 1) return nombreNegocioVenta(pubs[0])
  const nombre = `Pedido ${pubs.map((p) => p.codigo).join(' + ')}`
  return nombre.length > 120 ? `${nombre.slice(0, 119)}…` : nombre
}

/**
 * Registra un carrito pagado: una venta anticipada por línea y UN negocio con el subtotal de productos (el flete no es
 * venta: queda en la nota del negocio) y UN cobro con la referencia del pago.
 *
 * Idempotente para el reintento de Bold tras un corte a mitad:
 *   · cada venta se anota en su línea APENAS se inserta (`anotarVenta`); una línea con venta existente no se repite, y la
 *     base impide dos ventas por línea (`ferreteria_ventas_carrito_linea_unica`);
 *   · el negocio se anota en el carrito apenas se crea (`anotarNegocio`); con `negocioId` no se crea otro;
 *   · el cobro con la misma referencia en el mismo negocio no se duplica (`registrarPagoEnNegocio`).
 * Si el negocio no se puede crear, las ventas de este pedido que quedaron sin negocio se borran y las líneas se sueltan:
 * no queda nada a medias. Lo de después del negocio (precio, responsable, cobro) se devuelve como aviso.
 */
export async function registrarPedido(
  repo: RepoFerreteria,
  negocios: PuertoNegocios,
  ws: string,
  pedido: EntradaPedido,
  autor: Autor,
  hoyISO: string,
  opciones: {
    anotarVenta(lineaId: string, ventaId: string | null): Promise<void>
    anotarNegocio(negocioId: string): Promise<void>
  },
): Promise<{ ok: true; negocioId: string; ventaIds: string[]; ganancia: number; avisos: string[] } | Fallo> {
  if (!pedido.lineas.length) return { ok: false, mensaje: 'El pedido no tiene productos.' }
  if (!FECHA.test(pedido.fecha_venta) || pedido.fecha_venta > hoyISO) return { ok: false, mensaje: 'La fecha de la venta no es válida.' }
  if (!(RUTAS_VENTA as readonly string[]).includes(pedido.ruta)) return { ok: false, mensaje: 'Ruta desconocida.' }
  for (const l of pedido.lineas) {
    if (!Number.isInteger(l.cantidad) || l.cantidad < 1 || l.cantidad > 50) return { ok: false, mensaje: `${l.pub.codigo}: la cantidad tiene que ser un entero entre 1 y 50.` }
    if (!(l.precioUnitario > 0)) return { ok: false, mensaje: `${l.pub.codigo}: el precio tiene que ser mayor que cero.` }
  }

  // Costo del día de cada línea ANTES de escribir nada: sin lista vigente no se registra ninguna.
  const costos = new Map<string, number>()
  for (const l of pedido.lineas) {
    const cs = (await repo.costos(ws, l.pub.producto_id)).map((c) => ({ ...c, costo_f: Number(c.costo_f) }))
    const c = costoEnFecha(cs, pedido.fecha_venta)
    if (!c) return { ok: false, mensaje: `${l.pub.codigo}: no hay una lista de costos vigente en la fecha de la venta.` }
    costos.set(l.lineaId, c.costo_f)
  }

  let negocioId = pedido.negocioId
  const comprador = pedido.comprador_nombre.trim() || null
  const insertadas: string[] = []
  const ventaIds: string[] = []
  let ganancia = 0
  for (const [i, l] of pedido.lineas.entries()) {
    const precio = Math.round(l.precioUnitario) * l.cantidad
    const costo = costos.get(l.lineaId)!
    if (l.ventaId) {
      const previa = await repo.ventaPorId(ws, l.ventaId)
      if (previa) {
        ventaIds.push(previa.id)
        ganancia += Number(previa.ganancia)
        continue
      }
      await opciones.anotarVenta(l.lineaId, null)
    }
    const g = gananciaPorVenta(precio, costo * l.cantidad)
    const venta = await repo.insertarVenta({
      workspace_id: ws,
      publicacion_id: l.pub.id,
      conversacion_id: i === 0 ? pedido.conversacion_id : null,
      fecha_venta: pedido.fecha_venta,
      fecha_primer_pago: pedido.fecha_venta,
      precio_final: precio,
      costo_dia: costo,
      ganancia: g,
      ruta: pedido.ruta,
      forma_pago: 'anticipado',
      comprador_nombre: comprador,
      negocio_id: negocioId,
      entregada_at: null,
      registrado_por: autor.tipo === 'persona' ? autor.id : null,
      carrito_linea_id: l.lineaId,
      ...(l.cantidad > 1 ? { cantidad: l.cantidad } : {}),
    })
    try {
      await opciones.anotarVenta(l.lineaId, venta.id)
    } catch (e) {
      await repo.borrarVenta(ws, venta.id)
      throw e
    }
    insertadas.push(venta.id)
    ventaIds.push(venta.id)
    ganancia += g
  }

  const pubs = pedido.lineas.map((l) => l.pub)
  const subtotal = pedido.lineas.reduce((s, l) => s + Math.round(l.precioUnitario) * l.cantidad, 0)
  const nuevo = !negocioId
  if (!negocioId) {
    const creado = await negocios.crear({
      nombre: nombreNegocioPedido(pubs),
      precio: subtotal,
      compradorNombre: comprador,
      compradorTelefono: pedido.comprador_telefono?.trim() || null,
    })
    if (!creado.ok) {
      // Nada a medias: las ventas sin negocio se borran y sus líneas se sueltan.
      for (const [i, l] of pedido.lineas.entries()) {
        const v = await repo.ventaPorId(ws, ventaIds[i])
        if (v && !v.negocio_id) {
          await opciones.anotarVenta(l.lineaId, null)
          await repo.borrarVenta(ws, v.id)
        }
      }
      return { ok: false, mensaje: `No se pudo crear el negocio del pedido: ${creado.error}` }
    }
    negocioId = creado.negocioId
    await opciones.anotarNegocio(negocioId)
  }
  for (const id of ventaIds) {
    const v = await repo.ventaPorId(ws, id)
    if (v && v.negocio_id !== negocioId) await repo.actualizarVenta(ws, id, { negocio_id: negocioId })
  }

  const avisos: string[] = []
  const errPrecio = await negocios.fijarPrecioAprobado(negocioId, subtotal)
  if (errPrecio) avisos.push(`El precio aprobado del negocio no quedó escrito: ${errPrecio}`)
  if (nuevo) {
    const errResp = await negocios.asignarResponsable(negocioId)
    if (errResp) avisos.push(`El negocio quedó sin responsable: ${errResp}`)
  }
  const errPago = await negocios.registrarPago(negocioId, { monto: subtotal, fecha: pedido.fecha_venta, referencia: pedido.referencia_pago })
  if (errPago) avisos.push(`El pago anticipado no quedó en el negocio: ${errPago}. Regístralo desde el negocio.`)

  if (insertadas.length) {
    await repo.insertarEventos(pedido.lineas.filter((_, i) => insertadas.includes(ventaIds[i])).map((l) =>
      conAutor(ws, l.pub.id, autor, {
        tipo: 'venta',
        campo: null,
        valor_anterior: null,
        valor_nuevo: `precio ${Math.round(l.precioUnitario) * l.cantidad} · pedido de ${pedido.lineas.length} producto(s) · ${pedido.ruta} · anticipado`,
        motivo: null,
      })))
  }
  if (nuevo) {
    const detalle = pedido.lineas.map((l) => `${l.pub.codigo} × ${l.cantidad} (${formatoPesos(Math.round(l.precioUnitario) * l.cantidad)})`).join(', ')
    await negocios.anotar(
      negocioId,
      `Pedido del asistente de ventas: ${detalle}. Productos ${formatoPesos(subtotal)}, flete ${formatoPesos(pedido.flete)} (no es venta), ` +
        `ganancia ${formatoPesos(ganancia)}. Pago anticipado ${pedido.referencia_pago}, ${pedido.ruta === 'despacho' ? `despacho${pedido.direccion ? ` a ${pedido.direccion}` : ''}` : 'recoge en punto'}.`,
    )
  }
  return { ok: true, negocioId, ventaIds, ganancia, avisos }
}
