/**
 * Una venta de Ferretería es un negocio de ONE en la línea Ferretería de Dimpro.
 *
 * Tres pasos, que son las tres etapas de esa línea:
 *
 *   contra entrega:  Vendido → Entregado → (entra el pago) → Pagado, cierra
 *   anticipado:      Vendido, con el pago registrado al nacer → (se entrega) → Pagado, cierra
 *
 * El registro es a mano (Dietmar o MeTRIK): nada en el cron crea ventas.
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
  conversacion_id?: string | null
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
): Promise<{ ok: true; ventaId: string; negocioId: string; ganancia: number; avisos: string[] } | Fallo> {
  if (!FECHA.test(entrada.fecha_venta)) return { ok: false, mensaje: 'La fecha de la venta no es válida.' }
  if (entrada.fecha_venta > hoyISO) return { ok: false, mensaje: 'La fecha de la venta no puede ser futura.' }
  const precio = Number(entrada.precio_final)
  if (!Number.isFinite(precio) || precio <= 0) return { ok: false, mensaje: 'El precio final tiene que ser mayor que cero.' }
  if (!(RUTAS_VENTA as readonly string[]).includes(entrada.ruta)) return { ok: false, mensaje: 'Ruta desconocida.' }
  if (!esFormaPago(entrada.forma_pago)) return { ok: false, mensaje: 'Forma de pago desconocida.' }
  const formaPago: FormaPago = entrada.forma_pago
  const comprador = entrada.comprador_nombre?.trim() || null

  const conversacionId = entrada.conversacion_id?.trim() || null
  if (conversacionId) {
    const conv = await repo.conversacionPorId(ws, conversacionId)
    if (!conv || conv.publicacion_id !== pub.id) return { ok: false, mensaje: 'La conversación no es de esta publicación.' }
  }

  const costos = (await repo.costos(ws, pub.producto_id)).map((c) => ({ ...c, costo_f: Number(c.costo_f) }))
  const costo = costoEnFecha(costos, entrada.fecha_venta)
  if (!costo) return { ok: false, mensaje: 'No hay una lista de costos vigente en la fecha de la venta.' }
  const ganancia = gananciaPorVenta(precio, costo.costo_f)

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
  })

  const creado = await negocios.crear({ nombre: nombreNegocioVenta(pub), precio, compradorNombre: comprador })
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
      referencia: referenciaPago(pub.codigo, venta.id),
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
    `Venta de Ferretería ${pub.codigo}: ${formatoPesos(precio)}, costo del día ${formatoPesos(costo.costo_f)}, ` +
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
  await repo.actualizarVenta(ws, venta.id, { entregada_at: ahoraIso })

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

  const pub = await repo.publicacionPorId(ws, venta.publicacion_id)
  const err = await negocios.registrarPago(venta.negocio_id, {
    monto: venta.precio_final,
    fecha,
    referencia: referenciaPago(pub?.codigo ?? 'MP', venta.id),
  })
  if (err) return { ok: false, mensaje: `El pago no quedó en el negocio: ${err}` }
  const pagada = { ...venta, fecha_primer_pago: fecha }
  await repo.actualizarVenta(ws, venta.id, { fecha_primer_pago: fecha })

  const r = await alinearNegocio(negocios, pagada)
  if (!r.ok) return { ok: true, cerrado: false, aviso: `Pago registrado, pero ${r.mensaje.charAt(0).toLowerCase()}${r.mensaje.slice(1)}` }
  return { ok: true, cerrado: r.cerrado }
}
