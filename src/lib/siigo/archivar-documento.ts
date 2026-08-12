// ============================================================
// Todo documento que ONE emite en Siigo queda ARCHIVADO dentro del negocio.
//
// Requisito de Mauricio (2026-08-10): no basta con guardar el número. El archivo
// tiene que quedar cargado en un bloque del negocio, para que el expediente esté
// completo dentro de ONE y nadie tenga que ir a Siigo a buscarlo.
//
// La subida reusa la misma mecánica que un documento cargado a mano (carpeta
// canónica del negocio en Drive, con respaldo en Storage): un documento emitido
// no puede terminar en otro lugar que uno cargado, o el expediente queda partido
// en dos.
//
// Server-only.
// ============================================================

import { createServiceClient } from '@/lib/supabase/server'
import { createSubfolderPath, setFilePublicByLink, uploadFileToDrive } from '@/lib/google-drive'

const BUCKET = 've-documentos'

export interface ResultadoArchivado {
  ok: boolean
  /** URL final del archivo (Drive, o Storage si Drive no estaba disponible). */
  url?: string
  /** Por qué no se pudo archivar. El documento en Siigo ya existe igual. */
  error?: string
}

/**
 * Guarda un PDF ya emitido dentro del bloque `slugBloque` del negocio.
 *
 * Crea la instancia del bloque si no existe: el documento puede emitirse cuando
 * el negocio todavía no ha llegado a la etapa donde vive el bloque, y esperar a
 * que llegue dejaría el archivo sin lugar donde caer.
 *
 * NUNCA lanza. Cuando esto corre, el documento YA existe en Siigo y es
 * irreversible: un fallo al archivar es un pendiente, no un motivo para dar la
 * emisión por fallida.
 */
export async function archivarPdfEnBloque(
  workspaceId: string,
  negocioId: string,
  slugBloque: string,
  pdf: Buffer,
  nombreArchivo: string,
  /**
   * Campos que ONE ya conoce del documento y que, si no se escribieran, alguien
   * tendría que transcribir del PDF que el propio sistema acaba de recibir.
   */
  campos?: Record<string, string>,
): Promise<ResultadoArchivado> {
  try {
    const svc = createServiceClient()

    // ── El bloque donde va, resuelto por slug dentro de la línea del negocio ──
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: neg } = await (svc as any)
      .from('negocios')
      .select('linea_id, carpeta_url')
      .eq('id', negocioId).eq('workspace_id', workspaceId).single()
    if (!neg?.linea_id) return { ok: false, error: 'El negocio no tiene línea' }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: cfgs } = await (svc as any)
      .from('bloque_configs')
      .select('id, config_extra, etapas_negocio!inner(linea_id)')
      .eq('slug', slugBloque)
      .eq('etapas_negocio.linea_id', neg.linea_id)
      .limit(1)
    const cfg = (cfgs ?? [])[0] as { id: string; config_extra: Record<string, unknown> | null } | undefined
    if (!cfg) return { ok: false, error: `No existe un bloque con slug "${slugBloque}" en la línea` }

    // ── Subida: Drive si el negocio tiene carpeta; Storage si no ─────────────
    const storagePath = `${workspaceId}/negocios/${negocioId}/${cfg.id}/${nombreArchivo}`
    const { error: errUp } = await svc.storage
      .from(BUCKET).upload(storagePath, pdf, { contentType: 'application/pdf', upsert: true })
    if (errUp) return { ok: false, error: `Storage: ${errUp.message}` }

    let url: string
    let driveFileId: string | null = null
    const carpetaId = (neg.carpeta_url as string | null)?.match(/folders\/([-\w]+)/)?.[1] ?? null

    if (carpetaId) {
      const subcarpeta = (cfg.config_extra?.drive_subfolder as string | undefined) ?? null
      const destino = await createSubfolderPath(subcarpeta, carpetaId, workspaceId)
      const subido = await uploadFileToDrive(pdf, nombreArchivo, 'application/pdf', destino, workspaceId)
      driveFileId = subido.fileId
      url = subido.webViewLink
      await setFilePublicByLink(driveFileId, workspaceId)
      // El de Storage era temporal: el archivo vive en Drive, como los demás.
      await svc.storage.from(BUCKET).remove([storagePath])
    } else {
      url = svc.storage.from(BUCKET).getPublicUrl(storagePath).data.publicUrl
    }

    // ── La instancia del bloque, creada si hace falta ─────────────────────────
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: existente } = await (svc as any)
      .from('negocio_bloques')
      .select('id, data')
      .eq('negocio_id', negocioId).eq('bloque_config_id', cfg.id)
      .maybeSingle()

    const data = {
      ...((existente?.data ?? {}) as Record<string, unknown>),
      drive_url: url,
      drive_file_id: driveFileId,
      file_name: nombreArchivo,
      mime_type: 'application/pdf',
      uploaded_at: new Date().toISOString(),
      // Deja dicho que el archivo lo trajo ONE desde Siigo, no una persona.
      origen: 'emitido_en_siigo',
      // Los campos se escriben con la MISMA forma que deja la extracción con IA
      // (`{value, confidence, manual}`), porque los leen las mismas pantallas y
      // los mismos gates. `manual: true` porque no salieron de una extracción:
      // los devolvió Siigo, y marcarlos como extraídos les pondría un porcentaje
      // de confianza inventado.
      ...(campos && Object.keys(campos).length > 0
        ? {
            campos: {
              ...((existente?.data as { campos?: Record<string, unknown> } | undefined)?.campos ?? {}),
              ...Object.fromEntries(
                Object.entries(campos).map(([k, v]) => [k, { value: v, manual: true }]),
              ),
            },
          }
        : {}),
    }

    if (existente?.id) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { error } = await (svc as any)
        .from('negocio_bloques').update({ data, completado_at: new Date().toISOString() }).eq('id', existente.id)
      if (error) return { ok: false, error: error.message }
    } else {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { error } = await (svc as any).from('negocio_bloques').insert({
        negocio_id: negocioId,
        bloque_config_id: cfg.id,
        data,
        completado_at: new Date().toISOString(),
      })
      if (error) return { ok: false, error: error.message }
    }

    return { ok: true, url }
  } catch (e) {
    return { ok: false, error: (e as Error).message }
  }
}
