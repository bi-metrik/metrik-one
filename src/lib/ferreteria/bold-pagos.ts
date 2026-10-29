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
 * Idempotencia por `LNK_…` (Bold reintenta): una fila por link; una ya `registrada` no hace nada; para trabajarla hay
 * que RECLAMARLA (`procesando` solo desde `creado`, `rechazado` o `error`), así dos entregas simultáneas no registran
 * dos ventas. Además `venta_id` es único en la tabla.
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

export interface CierreLinkBold {
  registro: 'registrada' | 'rechazado' | 'error'
  motivo?: string | null
  venta_id?: string | null
  monto_recibido?: number | null
}

export interface RepoLinksBold {
  /** Suma una recepción del aviso (para ver los reintentos de Bold). */
  recibido(id: string): Promise<void>
  /** Pasa la fila a `procesando` solo desde `creado`, `rechazado` o `error`. `false` = otro la tiene o ya terminó. */
  reclamar(id: string): Promise<boolean>
  cerrar(id: string, cierre: CierreLinkBold, ahoraIso: string): Promise<void>
  /** La conversación de origen como fila de `ferreteria_conversaciones` (resultado `vendio`). Null si no se pudo. */
  conversacion(fila: LinkBoldFila, hoyISO: string): Promise<string | null>
}

export interface DepsPagoBold {
  ws: string
  repo: RepoFerreteria
  links: RepoLinksBold
  negocios(): Promise<PuertoNegocios | { error: string }>
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
  fila: LinkBoldFila,
  evento: { estado: 'aprobado' | 'fallido'; monto: number | null },
  deps: DepsPagoBold,
): Promise<SalidaPagoBold> {
  await deps.links.recibido(fila.id)
  if (fila.registro === 'registrada') return listo({ resultado: 'registrada', repetida: true })

  if (evento.estado === 'fallido') {
    // El link sigue abierto en Bold: un rechazo no cierra nada; queda anotado por si el cliente vuelve a intentar.
    if (fila.registro !== 'procesando') await deps.links.cerrar(fila.id, { registro: 'rechazado', motivo: 'Bold avisó un pago rechazado.' }, deps.ahoraIso)
    return listo({ resultado: 'rechazado' })
  }

  if (!(await deps.links.reclamar(fila.id))) return listo({ resultado: 'en_proceso' })
  // Desde aquí la fila es de este proceso: cualquier salida la cierra.
  const error = async (motivo: string, codigo: string | null, avisar = true): Promise<SalidaPagoBold> => {
    await deps.links.cerrar(fila.id, { registro: 'error', motivo, monto_recibido: evento.monto }, deps.ahoraIso)
    if (avisar) await deps.avisar(textoAvisoBold('error', fila, codigo, motivo), fila.id)
    return listo({ resultado: 'error' })
  }

  if (evento.monto !== null && Math.round(evento.monto) !== Math.round(fila.monto)) {
    return error(`Bold cobró ${formatoPesos(evento.monto)} y el link era por ${formatoPesos(fila.monto)}: revisar antes de despachar.`, null)
  }
  const pub = await deps.repo.publicacionPorId(deps.ws, fila.publicacion_id)
  if (!pub) return error('La publicación del link ya no existe.', null)
  let r: Awaited<ReturnType<typeof registrarVenta>>
  try {
    const negocios = await deps.negocios()
    if ('error' in negocios) return error(negocios.error, pub.codigo)
    const conversacionId = await deps.links.conversacion(fila, deps.hoyISO)
    r = await registrarVenta(
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
    )
  } catch (e) {
    // La base falló a mitad: Bold reintenta y la fila (en `error`) se vuelve a reclamar.
    await deps.links.cerrar(fila.id, { registro: 'error', motivo: `Falló el registro de la venta: ${(e as Error).message}` }, deps.ahoraIso).catch(() => undefined)
    return { status: 500, body: { ok: false, motivo: 'error_interno' } }
  }
  if (!r.ok) return error(r.mensaje, pub.codigo)

  await deps.links.cerrar(
    fila.id,
    { registro: 'registrada', venta_id: r.ventaId, monto_recibido: evento.monto, motivo: r.avisos.length ? r.avisos.join(' ') : null },
    deps.ahoraIso,
  )
  await deps.avisar(textoAvisoBold('registrada', fila, pub.codigo), fila.id)
  await deps.confirmarEnChatwoot(fila.referencia)
  return listo({ resultado: 'registrada', venta: r.ventaId })
}
