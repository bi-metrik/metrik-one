/**
 * Bajar de Valida el PDF de un reporte ya generado (una consulta o un lote), también con la llave
 * vencida (defecto que encontró Vera, 2026-10-28).
 *
 * La llave de un espacio de la prueba vence al terminar la prueba y otra vez, en el acto, con el
 * reverso del pago (metrik-valida#82). Hasta este cambio ONE bajaba los PDF SOLO con esa llave, así
 * que tras el corte la descarga daba 401. Eso rompe la cláusula 11.2 de los Términos (durante la
 * suspensión el cliente conserva el acceso a sus reportes) y desmiente la pantalla y el correo
 * («Tus reportes y tu historial siguen disponibles en la pestaña Historial»).
 *
 * El camino, en orden:
 *   1. Con la llave del espacio, como siempre (`/api/v1/reporte*`). Un espacio con la llave viva no
 *      cambia en nada, ni depende de `ONE_VALIDA_SECRET`.
 *   2. Si Valida responde 401, o el espacio no tiene llave, por la ruta de lectura firmada como ONE
 *      (`/api/one/v1/clientes/{cliente}/reportes*`, metrik-valida#83). El cliente lo pone el servidor
 *      desde el espacio de la sesión y el actor es quien pide la descarga.
 *
 * Lo que esto NO abre: ninguna consulta nueva. `consultarValida` y el cargue masivo siguen usando solo
 * la llave; esa ruta firmada de Valida solo lee consultas ya registradas del cliente.
 *
 * Puro, con dependencias inyectadas: la capa de servidor es `reporte-servidor.ts`.
 */

import type { ActorOne } from '@/lib/valida-api/firma'
import type { PeticionValida, ResultadoArchivoValida } from '@/lib/valida-api/cliente-nucleo'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export type PedidoPdf =
  | { tipo: 'consulta'; consultaId: string }
  | { tipo: 'lote'; consultaIds: string[]; titulo: string | null }

export interface CredencialPdf {
  llave: string | null
  /** `config_extra.valida_cliente_id` del espacio (o el de su prueba). Nunca del navegador. */
  clienteId: string | null
  /** Quien pide la descarga. Sin actor no hay ruta firmada (Valida exige a quién atribuirla). */
  actor: ActorOne | null
}

export interface DepsPdf {
  base: string
  fetch: typeof fetch
  pedirFirmado: (p: PeticionValida) => Promise<ResultadoArchivoValida>
}

export type ResultadoPdf = { ok: true; bytes: Buffer; via: 'llave' | 'one' } | { ok: false; error: string }

/** Sin llave ni forma de pedirlo como ONE: el mismo error de siempre. */
const SIN_LLAVE = 'valida_api_key_no_configurada'

async function conLlave(llave: string, pedido: PedidoPdf, deps: DepsPdf): Promise<ResultadoPdf | 'sin_autorizacion'> {
  const res =
    pedido.tipo === 'consulta'
      ? await deps.fetch(`${deps.base}/api/v1/reporte/${pedido.consultaId}`, {
          method: 'GET',
          headers: { Authorization: `Bearer ${llave}` },
          cache: 'no-store',
        })
      : await deps.fetch(`${deps.base}/api/v1/reporte-lote`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${llave}` },
          body: JSON.stringify({ consulta_ids: pedido.consultaIds, titulo: pedido.titulo ?? null }),
          cache: 'no-store',
        })
  if (res.status === 401) return 'sin_autorizacion'
  if (!res.ok) {
    const body = await res.json().catch(() => ({}))
    return { ok: false, error: (body as { error?: string }).error ?? `HTTP ${res.status}` }
  }
  return { ok: true, bytes: Buffer.from(await res.arrayBuffer()), via: 'llave' }
}

async function comoOne(cred: CredencialPdf, pedido: PedidoPdf, deps: DepsPdf, error: string): Promise<ResultadoPdf> {
  const clienteId = (cred.clienteId ?? '').trim()
  if (!UUID.test(clienteId) || !cred.actor) return { ok: false, error }
  // Los ids entran en la RUTA (o el cuerpo) de una llamada firmada: el de la consulta llega del
  // navegador, y sin esta guarda un «../» llevaría la firma de ONE a otra ruta de /api/one/v1.
  if (pedido.tipo === 'consulta' && !UUID.test(pedido.consultaId)) return { ok: false, error: 'not_found' }
  const ids = pedido.tipo === 'lote' ? pedido.consultaIds.filter((id) => UUID.test(id)) : []
  if (pedido.tipo === 'lote' && ids.length === 0) return { ok: false, error: 'lote_sin_consultas_validas' }
  const r = await deps.pedirFirmado(
    pedido.tipo === 'consulta'
      ? { metodo: 'GET', ruta: `/clientes/${clienteId}/reportes/${pedido.consultaId}`, actor: cred.actor }
      : {
          metodo: 'POST',
          ruta: `/clientes/${clienteId}/reportes-lote`,
          actor: cred.actor,
          cuerpo: { actor: cred.actor, consulta_ids: ids, titulo: pedido.titulo ?? null },
        },
  )
  if (r.tipo === 'ok') return { ok: true, bytes: Buffer.from(r.bytes), via: 'one' }
  if (r.tipo === 'rechazada') return { ok: false, error: r.codigo }
  return { ok: false, error: r.motivo === 'tiempo_agotado' ? 'valida_tiempo_agotado' : error }
}

export async function pdfDeValida(cred: CredencialPdf, pedido: PedidoPdf, deps: DepsPdf): Promise<ResultadoPdf> {
  try {
    if (cred.llave) {
      const r = await conLlave(cred.llave, pedido, deps)
      if (r !== 'sin_autorizacion') return r
      return await comoOne(cred, pedido, deps, 'invalid_api_key')
    }
    return await comoOne(cred, pedido, deps, SIN_LLAVE)
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : pedido.tipo === 'consulta' ? 'error_pdf' : 'error_pdf_lote' }
  }
}
