/**
 * Qué hace ONE con un pago de Bold de un link del ASISTENTE DE VENTAS (Dimpro, ensayo del 29-oct). Sin red ni base:
 * todo entra por `DepsPagoBold`, así que las pruebas lo corren con el repositorio en memoria y dobles.
 *
 * El asistente (Edge Function `chatwoot-agente`, dominio ventas) crea el link con las llaves de Bold del workspace y lo
 * guarda en `ferreteria_links_bold` con la publicación, la cantidad, el flete, el comprador y la conversación. El
 * webhook de Bold del workspace (`/api/webhooks/bold/funciones/[workspace]`) ya verificó la firma; si el `LNK_…` es de
 * esa tabla, llega aquí en vez de a `funcion_registrar_pago`.
 *
 * Un pago APROBADO se vuelve venta de Ferretería con su negocio en ONE, por `registrarVenta` (la misma acción de la
 * pantalla y de Wompi): anticipada, `precio_final` = precio × cantidad (sin el flete, que no es venta del producto),
 * ruta despacho o recoge, conversación de origen (la de Chatwoot, como fila de `ferreteria_conversaciones`) y cobro con
 * referencia `BOLD-<LNK>` (fuente Bold). Después: campana al equipo y aviso al asistente para que le confirme al cliente
 * y pase a persona con `despachar`.
 *
 * Idempotencia por `LNK_…` (Bold reintenta): una fila por link; una ya `registrada` no hace nada. Para trabajarla hay
 * que RECLAMARLA: `procesando` desde `creado`, `rechazado` o `error`, o desde un `procesando` de más de 2 minutos (un
 * corte entre reclamar y cerrar). Dos entregas simultáneas no registran dos ventas; la que no pudo reclamar responde 500
 * (`en_proceso`) y Bold reintenta: la encuentra cerrada, o vieja y la retoma.
 * La venta queda anotada en el link APENAS se inserta (antes de su negocio). Si el proceso se corta después, el reintento
 * la encuentra: con negocio la retoma como registrada; sin negocio la borra y registra de nuevo. Nunca dos ventas.
 *
 * Carrito (4-nov): un link puede llevar varios productos (`ferreteria_links_bold_lineas`). Se registra UNA venta por línea,
 * cada una con su negocio y su parte del cobro (precio × cantidad, la misma referencia `BOLD-<LNK>`); el flete no es venta.
 * Cada venta se anota en SU línea apenas se inserta, así que el reintento retoma línea por línea. Un link sin líneas (los
 * de antes) es de un solo producto, el de sus columnas. La venta de la primera línea es también la del link (`venta_id`).
 *
 * El monto: el del aviso tiene que ser el del link y en COP. Si el aviso no trae monto, se le pregunta a Bold por el link
 * (`consultarLink`, `PAID` con su total); si tampoco lo dice, no se registra.
 */
import { formatoPesos } from './reglas'
import { registrarVenta } from './ventas'
import type { Autor, PuertoNegocios, RepoFerreteria } from './tipos'

export interface LinkBoldFila {
  id: string
  workspace_id: string
  referencia: string
  publicacion_id: string
  cantidad: number
  precio_unitario: number
  flete: number
  monto: number
  zona: string
  ruta: 'despacho' | 'recoge'
  comprador_nombre: string
  comprador_telefono: string
  direccion: string | null
  chatwoot_cuenta_id: number
  chatwoot_conversacion_id: number
  canal: string
  registro: 'creado' | 'procesando' | 'registrada' | 'rechazado' | 'error'
  venta_id: string | null
}

/** Un producto del carrito del link. `id` null = el producto de las columnas del link (link sin líneas, de antes). */
export interface LineaLinkBold {
  id: string | null
  publicacion_id: string
  cantidad: number
  precio_unitario: number
  venta_id: string | null
}

/** Cuánto vive un `procesando` antes de leerse como un corte y volverse a reclamar. */
export const PROCESANDO_VENCE_MS = 2 * 60_000

export interface CierreLinkBold {
  registro: 'registrada' | 'error'
  motivo?: string | null
  venta_id?: string | null
  monto_recibido?: number | null
}

export interface RepoLinksBold {
  /** Suma una recepción del aviso (para ver los reintentos de Bold). */
  recibido(id: string): Promise<void>
  /**
   * Pasa la fila a `procesando` (con `reclamado_at`) desde `creado`, `rechazado` o `error`, o desde un `procesando`
   * reclamado antes de `vencidoAntesDe`. `false` = otro la tiene ahora o ya terminó.
   */
  reclamar(id: string, ahoraIso: string, vencidoAntesDe: string): Promise<boolean>
  /** La fila como está ahora en la base. */
  leer(id: string): Promise<LinkBoldFila | null>
  /** Anota (o quita) la venta del link sin cambiar su `registro`. */
  anotarVenta(id: string, ventaId: string | null): Promise<void>
  /** Los productos del carrito del link, en orden. Vacío si el link es de antes del carrito (un solo producto). */
  lineas(linkId: string): Promise<LineaLinkBold[]>
  /** Anota (o quita) la venta de una línea del carrito. */
  anotarVentaLinea(lineaId: string, ventaId: string | null): Promise<void>
  cerrar(id: string, cierre: CierreLinkBold, ahoraIso: string): Promise<void>
  /** Un pago rechazado: solo si la fila sigue en `creado` o `error` (nunca pisa una venta registrada ni una en curso). */
  marcarRechazado(id: string, ahoraIso: string): Promise<void>
  /** La conversación de origen como fila de `ferreteria_conversaciones` (resultado `vendio`). Null si no se pudo. */
  conversacion(fila: LinkBoldFila, hoyISO: string): Promise<string | null>
}

export interface DepsPagoBold {
  ws: string
  repo: RepoFerreteria
  links: RepoLinksBold
  negocios(): Promise<PuertoNegocios | { error: string }>
  /** El link en Bold (`GET /online/link/v1/{LNK}`), para el aviso que no trae el monto. Null si no respondió. */
  consultarLink(referencia: string): Promise<{ estado: string; total: number | null } | null>
  /** La campana del equipo. No lanza. */
  avisar(texto: string, linkId: string): Promise<void>
  /** El aviso al asistente (Chatwoot: confirmar y pasar a persona con `despachar`). No lanza. */
  confirmarEnChatwoot(referencia: string): Promise<void>
  ahoraIso: string
  hoyISO: string
}

export interface SalidaPagoBold {
  /** 500 hace que Bold reintente: solo para lo que un reintento puede arreglar. */
  status: 200 | 500
  body: Record<string, unknown>
}

export const AUTOR_BOLD: Autor = { tipo: 'cron', id: null, nombre: 'Pago Bold (asistente)' }

export function referenciaCobroBold(link: string): string {
  return `BOLD-${link}`
}

/** `detalle`: los productos del link («MP-01 ×2, MP-02 ×1»), o null si no se pudieron leer. */
export function textoAvisoBold(tipo: 'registrada' | 'error', fila: LinkBoldFila, detalle: string | null, motivo?: string): string {
  const destino = fila.ruta === 'despacho' ? `despachar${fila.direccion ? ` a ${fila.direccion}` : ''}` : 'recoge en punto'
  if (tipo === 'registrada') {
    return `Pago Bold aprobado ${detalle ?? ''} ${formatoPesos(fila.monto)} (flete ${formatoPesos(fila.flete)}), ${fila.comprador_nombre}, ${destino}`
      .replace(/\s+/g, ' ')
  }
  return `Pago Bold aprobado ${formatoPesos(fila.monto)} de ${fila.comprador_nombre} no quedó registrado: ${motivo ?? 'error'}`
}

const listo = (body: Record<string, unknown>): SalidaPagoBold => ({ status: 200, body: { ok: true, ...body } })

export async function procesarPagoBold(
  filaRecibida: LinkBoldFila,
  evento: { estado: 'aprobado' | 'fallido'; monto: number | null; moneda?: string | null },
  deps: DepsPagoBold,
): Promise<SalidaPagoBold> {
  const id = filaRecibida.id
  await deps.links.recibido(id)
  if (filaRecibida.registro === 'registrada') return listo({ resultado: 'registrada', repetida: true })

  if (evento.estado === 'fallido') {
    // El link sigue abierto en Bold: un rechazo no cierra nada; queda anotado por si el cliente vuelve a intentar.
    await deps.links.marcarRechazado(id, deps.ahoraIso)
    return listo({ resultado: 'rechazado' })
  }

  const vencido = new Date(Date.parse(deps.ahoraIso) - PROCESANDO_VENCE_MS).toISOString()
  if (!(await deps.links.reclamar(id, deps.ahoraIso, vencido))) {
    return { status: 500, body: { ok: false, resultado: 'en_proceso' } }
  }

  // Desde aquí la fila es de este proceso: toda salida la cierra, y los cierres van dentro del try.
  let ventaInsertada: { linea: LineaLinkBold; id: string } | null = null
  let detalle: string | null = null
  let fila = filaRecibida
  let lineas: LineaLinkBold[] = []
  const anotar = async (l: LineaLinkBold, ventaId: string | null) => {
    if (l.id) await deps.links.anotarVentaLinea(l.id, ventaId)
    if (l === lineas[0]) await deps.links.anotarVenta(id, ventaId)
  }
  const error = async (motivo: string, monto: number | null): Promise<SalidaPagoBold> => {
    await deps.links.cerrar(id, { registro: 'error', motivo, monto_recibido: monto }, deps.ahoraIso)
    await deps.avisar(textoAvisoBold('error', fila, detalle, motivo), id)
    return listo({ resultado: 'error' })
  }
  try {
    fila = (await deps.links.leer(id)) ?? filaRecibida
    const delCarrito = await deps.links.lineas(id)
    lineas = delCarrito.length
      ? delCarrito
      : [{ id: null, publicacion_id: fila.publicacion_id, cantidad: fila.cantidad, precio_unitario: fila.precio_unitario, venta_id: fila.venta_id }]
    const pubs = await Promise.all(lineas.map((l) => deps.repo.publicacionPorId(deps.ws, l.publicacion_id)))
    detalle = lineas.map((l, i) => `${pubs[i]?.codigo ?? '?'} ×${l.cantidad}`).join(', ')

    // Un intento anterior se cortó con ventas ya insertadas: con negocio se retoman; sin él, se limpian y se repiten.
    const hechas = new Map<LineaLinkBold, string>()
    for (const l of lineas) {
      if (!l.venta_id) continue
      const previa = await deps.repo.ventaPorId(deps.ws, l.venta_id)
      if (previa?.negocio_id) {
        hechas.set(l, previa.id)
        continue
      }
      await anotar(l, null)
      l.venta_id = null
      if (previa) await deps.repo.borrarVenta(deps.ws, previa.id)
    }
    if (hechas.size === lineas.length) {
      await deps.links.cerrar(
        id,
        { registro: 'registrada', venta_id: hechas.get(lineas[0])!, monto_recibido: evento.monto, motivo: 'Retomada tras un corte: revisar el pago anticipado en el negocio.' },
        deps.ahoraIso,
      )
      await deps.avisar(textoAvisoBold('registrada', fila, detalle), id)
      await deps.confirmarEnChatwoot(fila.referencia)
      return listo({ resultado: 'registrada', venta: hechas.get(lineas[0])!, ventas: lineas.map((l) => hechas.get(l)), retomada: true })
    }

    if (evento.moneda && evento.moneda !== 'COP') return await error(`Bold avisó un pago en ${evento.moneda}, no en COP.`, evento.monto)
    let monto = evento.monto
    if (monto === null) {
      const c = await deps.consultarLink(fila.referencia)
      if (!c || c.estado !== 'PAID' || c.total === null) return await error('El aviso de Bold no trae el monto y Bold no lo confirmó al consultar el link.', null)
      monto = c.total
    }
    if (Math.round(monto) !== Math.round(fila.monto)) {
      return await error(`Bold cobró ${formatoPesos(monto)} y el link era por ${formatoPesos(fila.monto)}: revisar antes de despachar.`, monto)
    }
    if (pubs.some((p) => !p)) return await error('Una publicación del link ya no existe.', monto)
    const negocios = await deps.negocios()
    if ('error' in negocios) return await error(negocios.error, monto)

    // La conversación de origen es de la publicación de la primera línea (`ferreteria_conversaciones` es por publicación).
    const conversacionId = hechas.has(lineas[0]) ? null : await deps.links.conversacion(fila, deps.hoyISO)
    const avisos: string[] = []
    for (const [i, l] of lineas.entries()) {
      if (hechas.has(l)) continue
      const r = await registrarVenta(
        deps.repo,
        negocios,
        deps.ws,
        pubs[i]!,
        {
          fecha_venta: deps.hoyISO,
          precio_final: Math.round(l.precio_unitario) * l.cantidad,
          ruta: fila.ruta,
          forma_pago: 'anticipado',
          comprador_nombre: fila.comprador_nombre,
          comprador_telefono: fila.comprador_telefono,
          conversacion_id: i === 0 ? conversacionId : null,
          referencia_pago: referenciaCobroBold(fila.referencia),
          cantidad: l.cantidad,
        },
        AUTOR_BOLD,
        deps.hoyISO,
        {
          alInsertar: async (ventaId) => {
            await anotar(l, ventaId)
            ventaInsertada = { linea: l, id: ventaId }
          },
        },
      )
      if (!r.ok) {
        // registrarVenta ya borró la venta si no pudo crear el negocio: la línea la suelta. Las líneas ya registradas
        // quedan con su negocio y el reintento las retoma.
        if (ventaInsertada) await anotar(l, null)
        return await error(lineas.length > 1 ? `${pubs[i]!.codigo}: ${r.mensaje}` : r.mensaje, monto)
      }
      ventaInsertada = null
      hechas.set(l, r.ventaId)
      avisos.push(...r.avisos)
    }
    const ventaLink = hechas.get(lineas[0])!
    await deps.links.cerrar(
      id,
      { registro: 'registrada', venta_id: ventaLink, monto_recibido: monto, motivo: avisos.length ? avisos.join(' ') : null },
      deps.ahoraIso,
    )
    await deps.avisar(textoAvisoBold('registrada', fila, detalle), id)
    await deps.confirmarEnChatwoot(fila.referencia)
    return listo({ resultado: 'registrada', venta: ventaLink, ...(lineas.length > 1 ? { ventas: lineas.map((l) => hechas.get(l)) } : {}) })
  } catch (e) {
    // La base falló a mitad. Una venta sin negocio se borra (como en el fallo normal); con negocio queda anotada y el
    // reintento la retoma. La fila pasa a `error` y Bold reintenta (500).
    try {
      const v0 = ventaInsertada as { linea: LineaLinkBold; id: string } | null
      if (v0) {
        const v = await deps.repo.ventaPorId(deps.ws, v0.id)
        if (v && !v.negocio_id) {
          await anotar(v0.linea, null)
          await deps.repo.borrarVenta(deps.ws, v.id)
        }
      }
      await deps.links.cerrar(id, { registro: 'error', motivo: `Falló el registro de la venta: ${(e as Error).message}` }, deps.ahoraIso)
    } catch {
      // Sin base no se puede ni limpiar: la fila queda en `procesando` y se retoma cuando venza.
    }
    return { status: 500, body: { ok: false, motivo: 'error_interno' } }
  }
}
