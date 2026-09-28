/**
 * Qué hace ONE con un evento de Wompi ya verificado. Sin red ni base: todo entra por `DepsWompi`,
 * así que las pruebas lo corren con el repositorio en memoria y un doble de los negocios.
 *
 * Regla: SOLO un pago APROBADO, de producción, hecho por un link de pago, con una publicación que
 * exista, se vuelve venta. Todo lo demás se guarda y ya (rechazado, anulado, error, pendiente,
 * sandbox, pago sin link). Un aprobado sin publicación reconocible queda «pendiente de asignar»:
 * ONE no adivina de qué publicación fue, avisa y alguien lo asigna desde Ferretería.
 *
 * La venta se registra con `registrarVenta`, la misma acción de «Registrar venta»: anticipada
 * (el cobro entra con la venta), precio = lo pagado, fecha = día del pago en Bogotá, ruta despacho
 * si Wompi trae dirección de envío, y la referencia del cobro es `WOMPI-<id de transacción>`.
 *
 * Idempotencia (Wompi reintenta hasta tres veces): una fila por (transacción, estado). Un evento
 * repetido de una fila ya resuelta no hace nada. Una fila en `error` (o en `recibido`, si el
 * proceso se cortó antes de reclamarla) se vuelve a intentar. Para trabajar una fila hay que
 * RECLAMARLA (pasa a `procesando` solo desde `recibido` o `error`): dos entregas simultáneas del
 * mismo evento no registran dos ventas.
 */
import { formatoPesos } from './reglas'
import { registrarVenta, type EntradaVenta } from './ventas'
import {
  codigoDesdeSku,
  completarTransaccion,
  direccionEnvio,
  fechaPagoBogota,
  leerTransaccion,
  type EnvioWompi,
  type EventoWompi,
  type TransaccionWompi,
} from './wompi'
import type { Autor, PublicacionFila, PuertoNegocios, RepoFerreteria } from './tipos'

export const REGISTROS_PAGO = ['recibido', 'procesando', 'registrada', 'pendiente_asignar', 'solo_guardado', 'error'] as const
export type RegistroPago = (typeof REGISTROS_PAGO)[number]

/** Lo que ya no se vuelve a trabajar si Wompi reenvía el evento. */
const RESUELTOS: readonly RegistroPago[] = ['registrada', 'pendiente_asignar', 'solo_guardado']

/** Lo que el webhook puede volver a intentar. */
export const RECLAMABLES_WEBHOOK: readonly RegistroPago[] = ['recibido', 'error']
/** Lo que «Asignar» de la pestaña puede tomar: un aprobado que ONE no pudo amarrar solo. */
export const RECLAMABLES_ASIGNAR: readonly RegistroPago[] = ['pendiente_asignar', 'error']

export interface FilaPagoWompi {
  id: string
  workspace_id: string
  transaccion_id: string
  estado_wompi: string
  entorno: 'prod' | 'test'
  payment_link_id: string | null
  sku: string | null
  publicacion_id: string | null
  referencia: string | null
  metodo_pago: string | null
  monto: number | null
  moneda: string | null
  pagado_at: string | null
  comprador_nombre: string | null
  comprador_email: string | null
  comprador_telefono: string | null
  comprador_documento: string | null
  envio: EnvioWompi | null
  registro: RegistroPago
  motivo: string | null
  venta_id: string | null
  veces_recibido: number
  recibido_at: string
  procesado_at: string | null
}

export type NuevaFilaPago = Omit<
  FilaPagoWompi,
  'id' | 'registro' | 'motivo' | 'venta_id' | 'veces_recibido' | 'recibido_at' | 'procesado_at' | 'sku' | 'publicacion_id'
> & { payload: unknown }

export type CierrePago = {
  registro: Exclude<RegistroPago, 'recibido' | 'procesando'>
  motivo?: string | null
  venta_id?: string | null
  sku?: string | null
  publicacion_id?: string | null
  /** Datos del comprador que se completaron consultando la transacción. */
  comprador?: Partial<Pick<FilaPagoWompi, 'comprador_nombre' | 'comprador_email' | 'comprador_telefono' | 'comprador_documento'>>
  envio?: EnvioWompi | null
  pagado_at?: string | null
}

export interface RepoPagosWompi {
  /**
   * Guarda el evento. Si ya había una fila para esa transacción y estado, suma una recepción y la
   * devuelve tal como estaba (`nuevo: false`).
   */
  guardarEvento(fila: NuevaFilaPago): Promise<{ nuevo: boolean; fila: FilaPagoWompi }>
  /**
   * Pasa la fila a `procesando` solo si está en uno de `desde` (por defecto `recibido` o `error`;
   * «Asignar» de la pestaña reclama también `pendiente_asignar`). `false` = otro la tiene o ya terminó.
   */
  reclamar(id: string, desde?: readonly RegistroPago[]): Promise<boolean>
  cerrar(id: string, cierre: CierrePago, ahoraIso: string): Promise<void>
  /** Escribe lo que se supo del pago sin cambiar su `registro`. */
  anotarDatos(id: string, datos: Omit<CierrePago, 'registro' | 'motivo' | 'venta_id'>): Promise<void>
  pagoPorId(ws: string, id: string): Promise<FilaPagoWompi | null>
}

export interface LinkWompi {
  existe: boolean
  sku: string | null
}

export type TipoAviso = 'registrada' | 'pendiente_asignar' | 'error'

export interface AvisoPago {
  tipo: TipoAviso
  pagoId: string
  texto: string
}

export interface DepsWompi {
  ws: string
  repo: RepoFerreteria
  pagos: RepoPagosWompi
  /** ¿El espacio tiene Ferretería encendido? Apagado, el pago solo se guarda. */
  moduloActivo(): Promise<boolean>
  /** Lee el link de pago en Wompi. LANZA si Wompi no responde: el evento se reintenta. */
  leerLink(linkId: string, entorno: 'prod' | 'test'): Promise<LinkWompi>
  /**
   * La transacción completa (`GET /v1/transactions/<id>`), para llenar los datos del comprador que
   * el evento no trajo. Opcional: sin llave privada no se consulta. Nunca lanza.
   */
  consultarTransaccion?(id: string, entorno: 'prod' | 'test'): Promise<unknown | null>
  negocios(): Promise<PuertoNegocios | { error: string }>
  avisar(aviso: AvisoPago): Promise<void>
  ahoraIso: string
  hoyISO: string
}

export type ResultadoEvento =
  | 'ignorado'
  | 'duplicado'
  | 'en_proceso'
  | 'solo_guardado'
  | 'pendiente_asignar'
  | 'registrada'
  | 'error'

/** 500 hace que Wompi reintente. Solo para lo que un reintento puede arreglar. */
export interface SalidaEvento {
  http: 200 | 500
  resultado: ResultadoEvento
  detalle?: string
  pagoId?: string
}

export const AUTOR_WOMPI: Autor = { tipo: 'cron', id: null, nombre: 'Pago Wompi' }

export function referenciaCobroWompi(transaccionId: string): string {
  return `WOMPI-${transaccionId}`
}

export function filaDesdeTransaccion(ws: string, tx: TransaccionWompi, payload: unknown): NuevaFilaPago {
  return {
    workspace_id: ws,
    transaccion_id: tx.id,
    estado_wompi: tx.estado,
    entorno: tx.entorno,
    payment_link_id: tx.paymentLinkId,
    referencia: tx.referencia,
    metodo_pago: tx.metodoPago,
    monto: tx.montoCentavos == null ? null : tx.montoCentavos / 100,
    moneda: tx.moneda,
    pagado_at: tx.pagadoAt,
    comprador_nombre: tx.comprador.nombre,
    comprador_email: tx.comprador.email,
    comprador_telefono: tx.comprador.telefono,
    comprador_documento: tx.comprador.documento,
    envio: tx.envio,
    payload,
  }
}

/** Qué se registra como venta a partir del pago guardado. */
export function entradaVentaDesdePago(fila: FilaPagoWompi, ahoraIso: string, hoyISO: string): EntradaVenta {
  const dia = fechaPagoBogota(fila.pagado_at, ahoraIso)
  return {
    // Un reloj de Wompi adelantado no puede dejar la venta "en el futuro" (registrarVenta la rechaza).
    fecha_venta: dia > hoyISO ? hoyISO : dia,
    precio_final: Number(fila.monto),
    ruta: fila.envio ? 'despacho' : 'recoge',
    forma_pago: 'anticipado',
    comprador_nombre: fila.comprador_nombre,
    comprador_telefono: fila.comprador_telefono ?? fila.envio?.telefono ?? null,
    conversacion_id: null,
    referencia_pago: referenciaCobroWompi(fila.transaccion_id),
  }
}

function quien(fila: Pick<FilaPagoWompi, 'comprador_nombre' | 'comprador_email'>): string {
  return fila.comprador_nombre ?? fila.comprador_email ?? 'comprador sin nombre'
}

export function textoAviso(tipo: TipoAviso, fila: FilaPagoWompi, codigo: string | null, motivo?: string | null): string {
  const monto = fila.monto != null ? formatoPesos(Number(fila.monto)) : 'monto desconocido'
  if (tipo === 'registrada') {
    const destino = fila.envio ? `despachar${direccionEnvio(fila.envio) ? ` a ${direccionEnvio(fila.envio)}` : ''}` : 'recoge en punto'
    return `Pago aprobado ${codigo} ${monto}, ${quien(fila)}, ${destino}`
  }
  if (tipo === 'pendiente_asignar') {
    return `Pago aprobado ${monto} de ${quien(fila)} sin publicación: asígnalo en Ferretería (${motivo ?? 'sin código'})`
  }
  return `Pago aprobado ${monto} de ${quien(fila)} no quedó registrado: ${motivo ?? 'error'}`
}

/**
 * Registra la venta de un pago ya reclamado y cierra la fila. La usan el webhook (con el puerto
 * sin sesión) y «Asignar» de la pestaña (con el de la sesión). Devuelve cómo quedó.
 */
export async function registrarVentaDePago(
  repo: RepoFerreteria,
  pagos: RepoPagosWompi,
  negocios: PuertoNegocios,
  ws: string,
  fila: FilaPagoWompi,
  pub: PublicacionFila,
  autor: Autor,
  ahoraIso: string,
  hoyISO: string,
): Promise<{ ok: true; ventaId: string; avisos: string[] } | { ok: false; mensaje: string }> {
  if (fila.monto == null || !(Number(fila.monto) > 0) || (fila.moneda && fila.moneda !== 'COP')) {
    const mensaje = `Monto no válido para una venta (${fila.monto ?? 'sin monto'} ${fila.moneda ?? ''}).`.replace(' )', ')')
    await pagos.cerrar(fila.id, { registro: 'error', motivo: mensaje, publicacion_id: pub.id }, ahoraIso)
    return { ok: false, mensaje }
  }
  const r = await registrarVenta(repo, negocios, ws, pub, entradaVentaDesdePago(fila, ahoraIso, hoyISO), autor, hoyISO)
  if (!r.ok) {
    await pagos.cerrar(fila.id, { registro: 'error', motivo: r.mensaje, publicacion_id: pub.id }, ahoraIso)
    return { ok: false, mensaje: r.mensaje }
  }
  await pagos.cerrar(
    fila.id,
    {
      registro: 'registrada',
      venta_id: r.ventaId,
      publicacion_id: pub.id,
      motivo: r.avisos.length > 0 ? r.avisos.join(' ') : null,
    },
    ahoraIso,
  )
  return { ok: true, ventaId: r.ventaId, avisos: r.avisos }
}

export async function procesarEventoWompi(evento: EventoWompi, deps: DepsWompi): Promise<SalidaEvento> {
  const leida = leerTransaccion(evento)
  if (!leida) return { http: 200, resultado: 'ignorado', detalle: `evento ${evento.event} sin transacción` }

  const { nuevo, fila: guardada } = await deps.pagos.guardarEvento(filaDesdeTransaccion(deps.ws, leida, evento))
  if (!nuevo && RESUELTOS.includes(guardada.registro)) {
    return { http: 200, resultado: 'duplicado', pagoId: guardada.id }
  }
  const cerrarSolo = async (motivo: string): Promise<SalidaEvento> => {
    await deps.pagos.cerrar(guardada.id, { registro: 'solo_guardado', motivo }, deps.ahoraIso)
    return { http: 200, resultado: 'solo_guardado', detalle: motivo, pagoId: guardada.id }
  }

  if (leida.estado !== 'APPROVED') return cerrarSolo(`Transacción ${leida.estado}: no es un pago aprobado.`)
  if (leida.entorno !== 'prod') return cerrarSolo('Evento de sandbox: no registra ventas.')
  if (!leida.paymentLinkId) return cerrarSolo('Pago sin link de pago: no se sabe de qué publicación es.')
  if (!(await deps.moduloActivo())) return cerrarSolo('El módulo Ferretería está apagado en el espacio.')

  if (!(await deps.pagos.reclamar(guardada.id))) {
    return { http: 200, resultado: 'en_proceso', pagoId: guardada.id }
  }

  // Desde aquí la fila es de este proceso: cualquier salida la cierra.
  let tx = leida
  let link: LinkWompi
  try {
    link = await deps.leerLink(leida.paymentLinkId, leida.entorno)
  } catch (e) {
    const motivo = `No se pudo leer el link ${leida.paymentLinkId} en Wompi: ${(e as Error).message}`
    await deps.pagos.cerrar(guardada.id, { registro: 'error', motivo }, deps.ahoraIso)
    return { http: 500, resultado: 'error', detalle: motivo, pagoId: guardada.id }
  }

  if (deps.consultarTransaccion && (!tx.comprador.nombre || !tx.comprador.documento || !tx.envio)) {
    const consultada = await deps.consultarTransaccion(tx.id, tx.entorno).catch(() => null)
    if (consultada) tx = completarTransaccion(tx, consultada)
  }
  const fila: FilaPagoWompi = {
    ...guardada,
    comprador_nombre: tx.comprador.nombre,
    comprador_email: tx.comprador.email,
    comprador_telefono: tx.comprador.telefono,
    comprador_documento: tx.comprador.documento,
    envio: tx.envio,
    pagado_at: tx.pagadoAt,
  }
  const completados: Pick<CierrePago, 'comprador' | 'envio' | 'pagado_at'> = {
    comprador: {
      comprador_nombre: fila.comprador_nombre,
      comprador_email: fila.comprador_email,
      comprador_telefono: fila.comprador_telefono,
      comprador_documento: fila.comprador_documento,
    },
    envio: fila.envio,
    pagado_at: fila.pagado_at,
  }

  const codigo = codigoDesdeSku(link.sku)
  const pendiente = async (motivo: string, sku: string | null): Promise<SalidaEvento> => {
    await deps.pagos.cerrar(guardada.id, { registro: 'pendiente_asignar', motivo, sku, ...completados }, deps.ahoraIso)
    if (nuevo) await deps.avisar({ tipo: 'pendiente_asignar', pagoId: guardada.id, texto: textoAviso('pendiente_asignar', fila, null, motivo) })
    return { http: 200, resultado: 'pendiente_asignar', detalle: motivo, pagoId: guardada.id }
  }
  if (!link.existe) return pendiente(`El link ${leida.paymentLinkId} no aparece en Wompi.`, null)
  if (!codigo) return pendiente('El link no tiene código de publicación (sku).', null)
  const pub = await deps.repo.publicacionPorCodigo(deps.ws, codigo)
  if (!pub) return pendiente(`El código ${codigo} del link no es una publicación de Ferretería.`, codigo)

  const negocios = await deps.negocios()
  if ('error' in negocios) {
    await deps.pagos.cerrar(guardada.id, { registro: 'error', motivo: negocios.error, sku: codigo, publicacion_id: pub.id, ...completados }, deps.ahoraIso)
    if (nuevo) await deps.avisar({ tipo: 'error', pagoId: guardada.id, texto: textoAviso('error', fila, codigo, negocios.error) })
    return { http: 200, resultado: 'error', detalle: negocios.error, pagoId: guardada.id }
  }

  // Lo que se completó consultando la transacción queda en la fila antes de registrar, para que la
  // pestaña lo muestre aunque la venta falle.
  let r: Awaited<ReturnType<typeof registrarVentaDePago>>
  try {
    await deps.pagos.anotarDatos(guardada.id, { sku: codigo, publicacion_id: pub.id, ...completados })
    r = await registrarVentaDePago(deps.repo, deps.pagos, negocios, deps.ws, fila, pub, AUTOR_WOMPI, deps.ahoraIso, deps.hoyISO)
  } catch (e) {
    const motivo = `Falló el registro de la venta: ${(e as Error).message}`
    await deps.pagos.cerrar(guardada.id, { registro: 'error', motivo }, deps.ahoraIso).catch(() => undefined)
    return { http: 500, resultado: 'error', detalle: motivo, pagoId: guardada.id }
  }
  if (!r.ok) {
    if (nuevo) await deps.avisar({ tipo: 'error', pagoId: guardada.id, texto: textoAviso('error', fila, codigo, r.mensaje) })
    return { http: 200, resultado: 'error', detalle: r.mensaje, pagoId: guardada.id }
  }
  await deps.avisar({ tipo: 'registrada', pagoId: guardada.id, texto: textoAviso('registrada', fila, pub.codigo) })
  return { http: 200, resultado: 'registrada', pagoId: guardada.id }
}
