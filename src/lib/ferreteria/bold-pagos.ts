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

export function textoAvisoBold(tipo: 'registrada' | 'error', fila: LinkBoldFila, codigo: string | null, motivo?: string): string {
  const destino = fila.ruta === 'despacho' ? `despachar${fila.direccion ? ` a ${fila.direccion}` : ''}` : 'recoge en punto'
  if (tipo === 'registrada') {
    return `Pago Bold aprobado ${codigo ?? ''} ×${fila.cantidad} ${formatoPesos(fila.monto)} (flete ${formatoPesos(fila.flete)}), ${fila.comprador_nombre}, ${destino}`
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
  let ventaInsertada: string | null = null
  let codigo: string | null = null
  let fila = filaRecibida
  const error = async (motivo: string, monto: number | null): Promise<SalidaPagoBold> => {
    await deps.links.cerrar(id, { registro: 'error', motivo, monto_recibido: monto }, deps.ahoraIso)
    await deps.avisar(textoAvisoBold('error', fila, codigo, motivo), id)
    return listo({ resultado: 'error' })
  }
  try {
    fila = (await deps.links.leer(id)) ?? filaRecibida
    const pub = await deps.repo.publicacionPorId(deps.ws, fila.publicacion_id)
    codigo = pub?.codigo ?? null

    // Un intento anterior se cortó con la venta ya insertada: con negocio se retoma; sin él, se limpia y se repite.
    if (fila.venta_id) {
      const previa = await deps.repo.ventaPorId(deps.ws, fila.venta_id)
      if (previa?.negocio_id) {
        await deps.links.cerrar(
          id,
          { registro: 'registrada', venta_id: previa.id, monto_recibido: evento.monto, motivo: 'Retomada tras un corte: revisar el pago anticipado en el negocio.' },
          deps.ahoraIso,
        )
        await deps.avisar(textoAvisoBold('registrada', fila, codigo), id)
        await deps.confirmarEnChatwoot(fila.referencia)
        return listo({ resultado: 'registrada', venta: previa.id, retomada: true })
      }
      await deps.links.anotarVenta(id, null)
      if (previa) await deps.repo.borrarVenta(deps.ws, previa.id)
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
    if (!pub) return await error('La publicación del link ya no existe.', monto)
    const negocios = await deps.negocios()
    if ('error' in negocios) return await error(negocios.error, monto)

    const conversacionId = await deps.links.conversacion(fila, deps.hoyISO)
    const r = await registrarVenta(
      deps.repo,
      negocios,
      deps.ws,
      pub,
      {
        fecha_venta: deps.hoyISO,
        precio_final: Math.round(fila.precio_unitario) * fila.cantidad,
        ruta: fila.ruta,
        forma_pago: 'anticipado',
        comprador_nombre: fila.comprador_nombre,
        comprador_telefono: fila.comprador_telefono,
        conversacion_id: conversacionId,
        referencia_pago: referenciaCobroBold(fila.referencia),
        cantidad: fila.cantidad,
      },
      AUTOR_BOLD,
      deps.hoyISO,
      {
        alInsertar: async (ventaId) => {
          await deps.links.anotarVenta(id, ventaId)
          ventaInsertada = ventaId
        },
      },
    )
    if (!r.ok) {
      // registrarVenta ya borró la venta si no pudo crear el negocio: el link la suelta.
      if (ventaInsertada) await deps.links.anotarVenta(id, null)
      return await error(r.mensaje, monto)
    }
    await deps.links.cerrar(
      id,
      { registro: 'registrada', venta_id: r.ventaId, monto_recibido: monto, motivo: r.avisos.length ? r.avisos.join(' ') : null },
      deps.ahoraIso,
    )
    await deps.avisar(textoAvisoBold('registrada', fila, codigo), id)
    await deps.confirmarEnChatwoot(fila.referencia)
    return listo({ resultado: 'registrada', venta: r.ventaId })
  } catch (e) {
    // La base falló a mitad. Una venta sin negocio se borra (como en el fallo normal); con negocio queda anotada y el
    // reintento la retoma. La fila pasa a `error` y Bold reintenta (500).
    try {
      if (ventaInsertada) {
        const v = await deps.repo.ventaPorId(deps.ws, ventaInsertada)
        if (v && !v.negocio_id) {
          await deps.links.anotarVenta(id, null)
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
