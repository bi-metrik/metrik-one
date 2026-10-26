import 'server-only'

/**
 * Webhook de Bold para los pagos de FUNCIONES de un workspace (`/api/webhooks/bold/funciones/[workspace]`): los links
 * que crea la pasarela del workspace con SUS llaves. No es `/api/webhooks/bold`, que es de las cuotas de MéTRIK y
 * registra en sus cobros.
 *
 * Bold manda el aviso a la URL que el dueño configuró en SU panel de Bold. Aquí:
 *   1. La firma se verifica sobre el cuerpo CRUDO con la llave secreta de ESE workspace (o la anterior, unos días
 *      después de un cambio de cuenta). Sin llaves o con firma inválida: 401, sin escribir nada.
 *   2. Ambiente de pruebas: Bold firma con la llave vacía. Se acepta solo si Bold, consultado con la llave de identidad
 *      del workspace, dice que el link es de pruebas (`is_sandbox`) y, si el aviso es de pago aprobado, que está pagado.
 *      Con llaves reales los links no son de pruebas, así que una firma vacía no aprueba nada.
 *   3. El pago se registra con `funcion_registrar_pago` (idempotente por referencia: el reintento de Bold no paga dos
 *      veces). La referencia es el `LNK_…` del link, que es lo que Bold trae en `data.metadata.reference`.
 *
 * Ninguna llave ni firma va a la respuesta ni a los logs.
 */
import { parsearEventoBold } from '@/lib/suscripciones/pasarela/bold'
import { createServiceClient } from '@/lib/supabase/server'
import {
  CLAVES_BOLD,
  DIAS_SECRETA_ANTERIOR,
  consultarLinkBold,
  firmaBoldValida,
  llavesBoldDelWorkspace,
} from '../../../supabase/functions/_shared/funciones/bold-workspace.ts'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const RE_LINK = /^LNK_[A-Za-z0-9]+$/

type ClienteRpc = {
  rpc: (fn: string, args: Record<string, unknown>) => PromiseLike<{ data: unknown; error: { code?: string; message: string } | null }>
}

export interface DepsWebhookFunciones {
  cliente?: ClienteRpc
  fetch?: typeof fetch
  ahora?: () => number
}

export interface RespuestaWebhook {
  status: number
  body: Record<string, unknown>
}

const no = (status: number, motivo: string): RespuestaWebhook => ({ status, body: { ok: false, motivo } })

/** ¿La secreta anterior sigue valiendo? Solo `DIAS_SECRETA_ANTERIOR` días desde que se reemplazó. */
async function anteriorVigente(cliente: ClienteRpc, workspaceId: string, ahora: number): Promise<boolean> {
  const { data, error } = await cliente.rpc('boveda_estado', { p_workspace_id: workspaceId })
  if (error || !Array.isArray(data)) return false
  const fila = (data as Array<{ clave?: string; actualizado_at?: string }>).find((x) => x.clave === CLAVES_BOLD.secretaAnterior)
  const t = fila?.actualizado_at ? Date.parse(fila.actualizado_at) : NaN
  return Number.isFinite(t) && ahora - t <= DIAS_SECRETA_ANTERIOR * 86_400_000
}

/** El LNK del aviso, sin confiar en nada más del cuerpo (la firma aún no se ha decidido). */
function linkDelCuerpo(cuerpoCrudo: string): string | null {
  const e = parsearEventoBold(cuerpoCrudo)
  return e?.referencia && RE_LINK.test(e.referencia) ? e.referencia : null
}

export async function atenderWebhookBoldFunciones(
  workspaceId: string,
  cuerpoCrudo: string,
  firma: string | null | undefined,
  deps: DepsWebhookFunciones = {},
): Promise<RespuestaWebhook> {
  if (!UUID.test(workspaceId)) return no(401, 'no_configurado')
  const cliente = deps.cliente ?? (createServiceClient() as unknown as ClienteRpc)
  const f = deps.fetch ?? fetch
  const ahora = (deps.ahora ?? Date.now)()

  let llaves
  try {
    llaves = await llavesBoldDelWorkspace(cliente, workspaceId)
  } catch {
    console.error(`[webhook-bold-funciones] no se pudieron leer las llaves del workspace ${workspaceId}`)
    return no(500, 'error_interno')
  }
  if (!llaves.secreta && !llaves.secretaAnterior && !llaves.identidad) return no(401, 'no_configurado')
  if (!firma) return no(401, 'sin_firma')

  let modo: 'cuenta' | 'cuenta_anterior' | 'pruebas' | null = null
  if (llaves.secreta && (await firmaBoldValida(cuerpoCrudo, firma, llaves.secreta))) modo = 'cuenta'
  else if (
    llaves.secretaAnterior &&
    (await firmaBoldValida(cuerpoCrudo, firma, llaves.secretaAnterior)) &&
    (await anteriorVigente(cliente, workspaceId, ahora))
  )
    modo = 'cuenta_anterior'
  else if (llaves.identidad && (await firmaBoldValida(cuerpoCrudo, firma, ''))) {
    const link = linkDelCuerpo(cuerpoCrudo)
    const tipo = parsearEventoBold(cuerpoCrudo)?.tipo
    const consulta = link ? await consultarLinkBold(llaves.identidad, link, f) : null
    if (consulta?.sandbox && (tipo !== 'aprobado' || consulta.estado === 'PAID')) modo = 'pruebas'
  }
  if (!modo) {
    console.warn(`[webhook-bold-funciones] firma inválida para el workspace ${workspaceId}`)
    return no(401, 'firma_invalida')
  }

  const evento = parsearEventoBold(cuerpoCrudo)
  if (!evento) return no(400, 'cuerpo_invalido')
  const estado = evento.tipo === 'aprobado' ? 'aprobado' : evento.tipo === 'rechazado' ? 'fallido' : null
  // Anulaciones y otros avisos no cambian un pago de funciones solos: los mira una persona.
  if (!estado) return { status: 200, body: { ok: true, ignorado: evento.tipoOriginal } }
  // Un pago que no salió de un link (datáfono, QR, botón) no es de funciones.
  if (!evento.referencia || !RE_LINK.test(evento.referencia)) return { status: 200, body: { ok: true, ignorado: 'sin_link' } }

  const { data, error } = await cliente.rpc('funcion_registrar_pago', {
    p_workspace_id: workspaceId,
    p_referencia: evento.referencia,
    p_estado: estado,
    p_monto_recibido: evento.monto === null ? null : Math.round(evento.monto),
  })
  if (error) {
    // Un link de la misma cuenta que no es de un pago de funciones: 200 para que Bold no reintente.
    if (/pago_no_existe/.test(error.message)) return { status: 200, body: { ok: true, ignorado: 'pago_no_existe' } }
    console.error(`[webhook-bold-funciones] funcion_registrar_pago falló (${workspaceId}): ${error.code ?? ''} ${error.message.slice(0, 200)}`)
    return no(500, 'error_interno')
  }
  const r = (data ?? {}) as { estado?: string; repetida?: boolean }
  return { status: 200, body: { ok: true, modo, estado: r.estado ?? estado, repetida: r.repetida === true } }
}
