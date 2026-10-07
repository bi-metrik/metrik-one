import 'server-only'
import { getWorkspace } from '@/lib/actions/get-workspace'
import { createServiceClient } from '@/lib/supabase/server'
import { BUCKET_DOCUMENTOS_SERVICIO, nombreDescargaRecibo } from '@/lib/valida-api/recibo-manual'
import { esUuid } from '@/lib/valida-api/reglas'
import { nombreDescargaFactura } from './factura-cuota'
import { entradaSuscripcion } from '@/lib/seccion-suscripcion/entrada-servidor'
import { entradaValidaCda, puedeVerPagosCda } from './puerta'

/**
 * Qué archivo de la pestaña Pagos de `/valida` pide un CDA, y si puede bajarlo. La ruta
 * `/api/valida/archivo/[clase]/[id]` solo traduce el resultado a HTTP (un `route.ts` no puede
 * exportar helpers: el build lo rechaza).
 *
 *   factura_pdf / factura_xml  → id = `plan_cobro_cuotas.id`, autorizado por `mis_cuotas_de_servicio`
 *   recibo                     → id = `cobros.id`,            autorizado por `mis_cobros_de_servicio`
 *
 * La autorización es la MISMA RPC que lista, llamada con el cliente de SESIÓN (mismo criterio que
 * la descarga de recibos de Valida API): si el archivo no aparece en lo que el espacio puede ver, no
 * se baja. Un id que no existe y uno de otro cliente responden el mismo 404.
 *
 * Exige la entrada del CDA con los términos aceptados (la pestaña no existe sin ella) y quien pida
 * tiene que poder ver la plata (dueño, administrador o persona designada). La mora NO cierra la
 * descarga: con Valida pausada, la factura es justo lo que se necesita para pagar.
 *
 * La entrada es la de `/suscripcion` (`entradaSuscripcion`), así que también baja los archivos de la
 * licencia de ONE de un cliente de Clarity: la pestaña Pagos es la misma.
 *
 *   terminos  → id = `documentos_contractuales_versiones.id`, autorizado por `mis_documentos_de_servicio`
 *
 * El PDF de una versión de los Términos (el enlace del aviso de una modificación por la cláusula 13.1).
 * Lo baja CUALQUIER usuario del CDA, no solo quien ve la plata: el aviso es para todos. No exige la
 * entrada aprobada (los términos son justo lo que se lee antes de aceptar), sí un contrato de Valida que
 * cubra al espacio, y solo una versión que la MISMA RPC de la pestaña le muestra a ese espacio.
 */

export const CLASES_ARCHIVO_CDA = ['factura_pdf', 'factura_xml', 'recibo', 'terminos'] as const
export type ClaseArchivoCda = (typeof CLASES_ARCHIVO_CDA)[number]

export type ArchivoCda =
  | { tipo: 'ok'; url: string }
  | { tipo: 'error'; status: 403 | 404 | 503; error: string }

const NO_ENCONTRADO: ArchivoCda = { tipo: 'error', status: 404, error: 'no_encontrado' }

function esClase(c: string): c is ClaseArchivoCda {
  return (CLASES_ARCHIVO_CDA as readonly string[]).includes(c)
}

/** El PDF de una versión de los Términos que el espacio puede ver. */
async function resolverPdfTerminos(id: string): Promise<ArchivoCda> {
  const entrada = await entradaValidaCda()
  if (entrada.tipo !== 'ok') return { tipo: 'error', status: 403, error: 'sin_acceso' }

  const { supabase } = await getWorkspace()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const r = await (supabase as any).rpc('mis_documentos_de_servicio')
  if (r.error) return { tipo: 'error', status: 503, error: 'no_disponible' }
  const fila = ((r.data ?? []) as { documento_id: string; pdf_bucket: string | null; pdf_path: string | null }[]).find(
    (d) => d.documento_id === id && d.pdf_bucket && d.pdf_path,
  )
  if (!fila?.pdf_bucket || !fila.pdf_path) return NO_ENCONTRADO

  const nombre = fila.pdf_path.split('/').pop() || 'terminos.pdf'
  const { data, error } = await createServiceClient()
    .storage.from(fila.pdf_bucket)
    .createSignedUrl(fila.pdf_path, 60, { download: nombre })
  if (error || !data?.signedUrl) return { tipo: 'error', status: 503, error: 'no_disponible' }
  return { tipo: 'ok', url: data.signedUrl }
}

export async function resolverArchivoCda(clase: string, id: string): Promise<ArchivoCda> {
  if (!esClase(clase) || !esUuid(id)) return NO_ENCONTRADO
  if (clase === 'terminos') return resolverPdfTerminos(id)

  const e = await entradaSuscripcion()
  if (e.tipo !== 'ok') return { tipo: 'error', status: 403, error: 'sin_acceso' }
  const { entrada } = e
  if (entrada.estado.estado !== 'aprobada') return { tipo: 'error', status: 403, error: 'entrada_pendiente' }
  if (!entrada.servicioContratadoId || !(await puedeVerPagosCda(entrada))) {
    return { tipo: 'error', status: 403, error: 'sin_acceso' }
  }

  const { supabase } = await getWorkspace()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const cliente = supabase as any

  let ruta: string | null = null
  let nombre = ''
  if (clase === 'recibo') {
    const r = await cliente.rpc('mis_cobros_de_servicio', { p_servicio_contratado_id: entrada.servicioContratadoId })
    if (r.error) return { tipo: 'error', status: 503, error: 'no_disponible' }
    const fila = ((r.data ?? []) as { cobro_id: string; recibo_path: string | null; recibo_numero: string | null }[]).find(
      (c) => c.cobro_id === id && c.recibo_path,
    )
    ruta = fila?.recibo_path ?? null
    nombre = nombreDescargaRecibo(fila?.recibo_numero ?? null)
  } else {
    const r = await cliente.rpc('mis_cuotas_de_servicio', { p_servicio_contratado_id: entrada.servicioContratadoId })
    if (r.error) return { tipo: 'error', status: 503, error: 'no_disponible' }
    const fila = (
      (r.data ?? []) as {
        cuota_id: string | null
        factura_numero: string | null
        factura_pdf_path: string | null
        factura_xml_path: string | null
      }[]
    ).find((c) => c.cuota_id === id)
    const parte = clase === 'factura_pdf' ? 'pdf' : 'xml'
    ruta = (parte === 'pdf' ? fila?.factura_pdf_path : fila?.factura_xml_path) ?? null
    nombre = nombreDescargaFactura(fila?.factura_numero ?? null, parte)
  }
  if (!ruta) return NO_ENCONTRADO

  const { data, error } = await createServiceClient()
    .storage.from(BUCKET_DOCUMENTOS_SERVICIO)
    .createSignedUrl(ruta, 60, { download: nombre })
  if (error || !data?.signedUrl) return { tipo: 'error', status: 503, error: 'no_disponible' }
  return { tipo: 'ok', url: data.signedUrl }
}
