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
import { BUCKET_DOCUMENTOS_ONE, construirReferenciaOne } from '@/lib/almacenamiento/referencia'

const BUCKET = BUCKET_DOCUMENTOS_ONE

export interface ResultadoArchivado {
  ok: boolean
  /** URL final del archivo (Drive, o Storage si Drive no estaba disponible). */
  url?: string
  /**
   * Id del archivo en Drive, cuando quedó ahí.
   *
   * Lo pide quien guarda una marca en otra tabla (`cobros.siigo_recibo`): con el archivo
   * cerrado, el id es lo único con lo que `/api/archivos/cobro` puede bajar los bytes.
   * Sacarlo del enlace después es un parser que se puede evitar guardándolo.
   */
  driveFileId?: string | null
  /**
   * El bloque donde quedó. Lo necesita quien emite para pedir el aviso al cliente
   * (`avisar_documento_al_cliente`), que se identifica por `bloque_config_id`.
   */
  bloqueConfigId?: string
  /**
   * Referencia `one://` a la copia del PDF en Storage, cuando se pidió conservarla.
   *
   * Es la única forma de entregarle el documento a alguien SIN sesión: se firma por
   * siete días desde la edge function. Ver `copiaParaElCliente`.
   */
  referenciaCliente?: string | null
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
  /**
   * Entrada que se ACUMULA en una lista dentro del bloque, en vez de pisar lo anterior.
   *
   * Existe porque un negocio puede recibir varios recibos de caja: medido el 2026-09-02,
   * 74 de 306 negocios con cobros ya recibieron más de un pago. `drive_url` solo puede
   * apuntar a uno (el último, que es el que la pantalla muestra y el que el aviso
   * enlaza), así que sin esta lista los anteriores quedarían solo en Drive, fuera del
   * expediente. La factura no la usa: de esa hay una sola.
   */
  historial?: { clave: string; entrada: Record<string, unknown> },
  /**
   * Cómo llegó el archivo al bloque. Por defecto, ONE lo emitió.
   *
   * `adoptada_de_siigo` es para la factura que YA existía en Siigo y que alguien
   * reconoce como la de este negocio: ONE no la emitió, solo la trajo. Decir lo
   * contrario dejaría escrito en el expediente que la emitimos nosotros.
   *
   * `cargada_manual` es el PDF que una persona subió desde Tesorería porque la
   * factura se hizo por fuera de ONE o Siigo no devolvió el archivo. Es el único
   * origen que se puede reemplazar a mano después.
   *
   * ⚠️ Escribe con el service role, así que `trg_avisar_documento_cargado` (que exige
   * `auth.uid()`) NO le avisa al cliente, venga el archivo de donde venga.
   */
  origen: 'emitido_en_siigo' | 'adoptada_de_siigo' | 'cargada_manual' = 'emitido_en_siigo',
  /**
   * Si el archivo queda ABIERTO en Drive a cualquiera con el enlace.
   *
   * ⚠️ El default es `true` a propósito: es el comportamiento que esta función tuvo
   * siempre, y apagarlo para todos cerraría también la FACTURA, que sí llega al cliente
   * final (que no tiene cuenta de Google) y es otro frente. Quien no lo necesita lo
   * declara: hoy solo el recibo de caja, que lo lee el equipo con sesión.
   *
   * Un archivo abierto así no vence, sobrevive al cierre del negocio y a que el correo se
   * reenvíe. Medido el 2026-09-16: 22 de 22 archivos vivos de estos caminos estaban
   * abiertos, ninguno cerrado.
   */
  publicoConEnlace = true,
  /**
   * Si se conserva una copia del PDF en Storage para poder dársela a alguien SIN sesión.
   *
   * ⚠️ **Es la contrapartida de haber cerrado el archivo de Drive.** Desde el 2026-09-16
   * el recibo de caja nace cerrado y solo se abre por `/api/archivos/cobro`, que exige
   * sesión. El correo al cliente seguía prometiendo "puedes ver y descargar el recibo
   * aquí" con la URL de Drive: medido el 2026-09-21, 401 en los tres que se probaron, y
   * 14 avisos `enviado` a 8 clientes reales el 16 y el 17 de septiembre.
   *
   * Con esto el PDF queda en dos sitios: **Drive** es el expediente que lee el equipo, y
   * **Storage** es de donde sale el enlace firmado del cliente. El bucket `ve-documentos`
   * es privado desde el 2026-09-16, así que la copia no se abre sola: solo existe el
   * enlace firmado, y vence a los siete días. Eso es justo lo que "cualquiera con el
   * enlace" de Drive no hacía.
   *
   * Tres efectos, y son UNA sola decisión:
   *   1. la copia de Storage no se borra cuando el archivo se sube a Drive,
   *   2. se devuelve su referencia `one://` en `referenciaCliente`,
   *   3. y si hay `historial`, la entrada nueva la lleva en `ref` — que es lo que el
   *      aviso firma documento por documento cuando el cobro produjo dos recibos.
   */
  copiaParaElCliente = false,
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
    /** La copia de Storage, cuando sobrevive: es de donde sale el enlace del cliente. */
    let referenciaCliente: string | null = null
    const carpetaId = (neg.carpeta_url as string | null)?.match(/folders\/([-\w]+)/)?.[1] ?? null

    if (carpetaId) {
      const subcarpeta = (cfg.config_extra?.drive_subfolder as string | undefined) ?? null
      const destino = await createSubfolderPath(subcarpeta, carpetaId, workspaceId)
      const subido = await uploadFileToDrive(pdf, nombreArchivo, 'application/pdf', destino, workspaceId)
      driveFileId = subido.fileId
      url = subido.webViewLink
      if (publicoConEnlace) await setFilePublicByLink(driveFileId, workspaceId)
      if (copiaParaElCliente) {
        // Se queda: el de Drive está cerrado y no hay otra forma de que el cliente,
        // que no tiene cuenta, abra su propio documento.
        referenciaCliente = construirReferenciaOne(BUCKET_DOCUMENTOS_ONE, storagePath)
      } else {
        // El de Storage era temporal: el archivo vive en Drive, como los demás.
        await svc.storage.from(BUCKET).remove([storagePath])
      }
    } else {
      // Sin carpeta de Drive el documento se queda en `ve-documentos`, y lo que se
      // guarda es la REFERENCIA: el bucket deja de ser público y `object/public` sería
      // un enlace muerto sobre un documento fiscal ya emitido.
      url = construirReferenciaOne(BUCKET_DOCUMENTOS_ONE, storagePath)
      // Por este camino ya es la misma referencia: no hay copia que conservar.
      if (copiaParaElCliente) referenciaCliente = url
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
      origen,
      // Los campos se escriben con la MISMA forma que deja la extracción con IA
      // (`{value, confidence, manual}`), porque los leen las mismas pantallas y
      // los mismos gates. `manual: true` porque no salieron de una extracción:
      // los devolvió Siigo, y marcarlos como extraídos les pondría un porcentaje
      // de confianza inventado.
      ...(historial
        ? {
            [historial.clave]: [
              ...(((existente?.data as Record<string, unknown> | undefined)?.[historial.clave] ?? []) as unknown[]),
              // `ref` lo pone ESTA función y no quien llama: la ruta de Storage se arma
              // aquí adentro (necesita el `bloque_config_id`, que se resuelve aquí), y
              // duplicar esa convención afuera la dejaría desincronizarse en silencio.
              referenciaCliente ? { ...historial.entrada, ref: referenciaCliente } : historial.entrada,
            ],
          }
        : {}),
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
      if (error) return { ok: false, error: error.message, bloqueConfigId: cfg.id }
    } else {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { error } = await (svc as any).from('negocio_bloques').insert({
        negocio_id: negocioId,
        bloque_config_id: cfg.id,
        data,
        completado_at: new Date().toISOString(),
      })
      if (error) return { ok: false, error: error.message, bloqueConfigId: cfg.id }
    }

    return { ok: true, url, driveFileId, bloqueConfigId: cfg.id, referenciaCliente }
  } catch (e) {
    return { ok: false, error: (e as Error).message }
  }
}
