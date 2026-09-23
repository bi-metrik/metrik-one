import 'server-only'
import { createServiceClient } from '@/lib/supabase/server'
import { huellaTexto } from '@/lib/valida-api/politica-huella'
import type { ResultadoTerminosAprobados } from '@/lib/valida-api/resultados'
import type { HuellasVersion } from '@/lib/valida-api/terminos-aprobados'
import { documentosDelCliente } from '@/lib/valida-api/terminos-servidor'
import { leerPestanaPagosCda, type LecturaPestanaPagos } from './pago-servidor'
import { puedeVerPagosCda, type EntradaValidaCda } from './puerta'
import { terminosAceptadosPorEmpresa } from './terminos-empresa'

/**
 * Lo que cargan las pestañas Pagos y Términos de `/valida` del CDA, el mismo patrón de Valida API:
 * cada una carga sola y dice por qué no cargó, nunca una lista vacía en su lugar.
 *
 * Las dos exigen lo mismo que la página: la entrada del CDA con los términos aceptados. Pagos exige
 * además dueño, administrador o persona designada (`puedeVerPagosCda`).
 */

export type ResultadoPagosCda =
  | LecturaPestanaPagos
  | { estado: 'sin_acceso'; razon: string }

export async function leerPagosCda(e: EntradaValidaCda): Promise<ResultadoPagosCda> {
  if (e.tipo !== 'ok' || e.estado.estado !== 'aprobada' || !e.servicioContratadoId) {
    return { estado: 'sin_acceso', razon: 'Los pagos se ven cuando tu empresa acepte los términos.' }
  }
  if (!(await puedeVerPagosCda(e))) {
    return {
      estado: 'sin_acceso',
      razon: 'Los pagos los ven el dueño y los administradores del espacio, y la persona designada por tu empresa.',
    }
  }
  return leerPestanaPagosCda(e.servicioContratadoId, e.hoy)
}

export async function leerTerminosEmpresaCda(e: EntradaValidaCda): Promise<ResultadoTerminosAprobados> {
  if (e.tipo !== 'ok' || e.estado.estado !== 'aprobada') {
    return { estado: 'sin_acceso', razon: 'Los términos se releen aquí cuando tu empresa los acepte.' }
  }
  const docs = await documentosDelCliente()
  if (!docs.ok) return { estado: 'no_disponible', motivo: docs.motivo }

  const ids = [...new Set(docs.documentos.filter((d) => d.aceptadoAt !== null).map((d) => d.documentoId))]
  const huellas = new Map<string, HuellasVersion>()
  if (ids.length > 0) {
    // Las huellas registradas de cada versión. Los ids salen de la RPC de SESIÓN, así que el cliente
    // de servicio solo lee versiones que el espacio ya puede ver.
    const versiones = await createServiceClient()
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .from('documentos_contractuales_versiones' as any)
      .select('id, texto_sha256, pdf_sha256')
      .in('id', ids)
    if (versiones.error) {
      console.error('[valida-cda] huellas de las versiones:', versiones.error.message)
      return { estado: 'no_disponible', motivo: 'base' }
    }
    for (const v of (versiones.data ?? []) as unknown as { id: string; texto_sha256: string; pdf_sha256: string }[]) {
      huellas.set(v.id, { textoSha256: v.texto_sha256, pdfSha256: v.pdf_sha256 })
    }
  }
  return {
    estado: 'ok',
    datos: terminosAceptadosPorEmpresa({ documentos: docs.documentos, huellas, huella: huellaTexto }),
  }
}
