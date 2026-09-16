'use server'

import { getWorkspace } from '@/lib/actions/get-workspace'
import { guardEditarBloque } from '@/lib/permissions/guard-negocio'
import { puedeCorregirDocumentos } from '@/lib/roles'
import { createServiceClient } from '@/lib/supabase/server'
import { getServerKey } from '@/lib/server-keys'
import { parseVeDocuments } from '@/lib/ve/parse-ve-docs'
import { parseRut } from '@/lib/rut/parse-rut'
import { createSubfolderPath, uploadFileToDrive, setFilePublicByLink } from '@/lib/google-drive'
import { almacenamientoExternoDe } from '@/lib/almacenamiento/supabase-externo'
import { descargarDeOne } from '@/lib/almacenamiento/one'
import {
  BUCKET_DOCUMENTOS_ONE,
  construirReferenciaOne,
  esReferenciaExterna,
  esReferenciaOne,
  esRutaPendienteDe,
  extensionSegura,
  parsearReferencia,
  rutaPendiente,
} from '@/lib/almacenamiento/referencia'

const BUCKET = BUCKET_DOCUMENTOS_ONE

// Cast a untyped para tablas nuevas no en database.ts
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function db(client: unknown): any { return client }

// Slugs que disparan procesamiento AI
// - factura, cedula, soporte_upme → parseVeDocuments
// - rut → parseRut
const SLUGS_CON_AI = ['factura', 'cedula', 'soporte_upme', 'rut']

// Todos los campos extraibles de los 4 documentos de radicación
export interface CamposExtraidos {
  // Del vehículo (factura + cedula)
  nombre_propietario?: string
  numero_identificacion?: string
  marca?: string
  linea?: string
  modelo?: string
  tecnologia?: string
  tipo?: string
  numero_cus?: string
  // Datos fiscales del cliente (RUT)
  regimen_tributario_cliente?: string
  tipo_persona_cliente?: string
  telefono_propietario?: string
  municipio_propietario?: string
  correo_propietario?: string
  direccion_propietario?: string
}

// ── Guard de permiso ──────────────────────────────────────────────────────────
//
// Las 4 acciones de este archivo no tenian guard: cualquier usuario autenticado
// del workspace podia pedir URL de subida, confirmar el upload, disparar la
// extraccion IA o sobrescribir los campos de CUALQUIER bloque. Mismo patron que
// documento-actions: en la etapa activa edita quien puede editar el bloque; si
// el negocio ya avanzo, solo un rol de correccion (owner/admin/supervisor).
//
// Los 4 callers son de UI (BloqueDocumentos.tsx). Ningun cron ni flujo
// server-side sin usuario las invoca — verificado por grep.
async function guardDocumentoNegocio(
  negocioBloqueId: string,
  role?: string | null,
): Promise<{ ok: boolean; error?: string }> {
  const guard = await guardEditarBloque(negocioBloqueId)
  if (guard.ok || puedeCorregirDocumentos(role)) return { ok: true }
  return { ok: false, error: guard.error ?? 'Tu rol no permite editar este documento' }
}

// ── 1. Generar URL firmada de upload ──────────────────────────────────────────

export async function getUploadUrlDocumentoNegocio(
  negocioBloqueId: string,
  negocioId: string,
  slug: string,
  fileExtension: string,
): Promise<{ success: boolean; path?: string; token?: string; signedUrl?: string; error?: string }> {
  const { supabase, workspaceId, role, error } = await getWorkspace()
  if (error || !workspaceId) return { success: false, error: 'No autenticado' }

  const permiso = await guardDocumentoNegocio(negocioBloqueId, role)
  if (!permiso.ok) return { success: false, error: permiso.error }

  const ext = fileExtension.toLowerCase().replace(/^\./, '') || 'pdf'

  // Almacenamiento externo: URL firmada de subida DIRECTA al proyecto del cliente, a una
  // ruta pendiente de este negocio. `path` viaja como referencia `sbext://` y `signedUrl`
  // es a donde el navegador hace el PUT. Nada pasa por `ve-documentos`.
  let almacenamiento: Awaited<ReturnType<typeof almacenamientoExternoDe>>
  try {
    almacenamiento = await almacenamientoExternoDe(workspaceId)
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : String(e) }
  }
  if (almacenamiento) {
    if (!extensionSegura(ext)) return { success: false, error: 'Extensión de archivo no válida' }
    const { data: bloque } = await db(supabase)
      .from('negocio_bloques')
      .select('negocio_id')
      .eq('id', negocioBloqueId)
      .maybeSingle()
    if ((bloque?.negocio_id as string | undefined)?.toLowerCase() !== negocioId.toLowerCase()) {
      return { success: false, error: 'Bloque no encontrado en este negocio' }
    }
    try {
      const { signedUrl, referencia } = await almacenamiento.urlSubida(
        rutaPendiente(negocioId, negocioBloqueId, ext, Date.now()),
      )
      return { success: true, path: referencia, signedUrl }
    } catch (e) {
      return { success: false, error: e instanceof Error ? e.message : String(e) }
    }
  }
  const filePath = `${workspaceId}/negocios/${negocioId}/${negocioBloqueId}/${slug}.${ext}`

  const admin = createServiceClient()
  const { data, error: signError } = await admin.storage
    .from(BUCKET)
    .createSignedUploadUrl(filePath, { upsert: true })

  if (signError || !data) {
    return { success: false, error: signError?.message ?? 'Error generando URL de subida' }
  }

  return { success: true, path: filePath, token: data.token }
}

// ── 2. Confirmar upload y guardar URL en negocio_bloques.data ─────────────────

export async function confirmarUploadDocumentoNegocio(
  negocioBloqueId: string,
  slug: string,
  filePath: string,
): Promise<{ success: boolean; url?: string; error?: string }> {
  const { supabase, workspaceId, role, error } = await getWorkspace()
  if (error || !workspaceId) return { success: false, error: 'No autenticado' }

  const permiso = await guardDocumentoNegocio(negocioBloqueId, role)
  if (!permiso.ok) return { success: false, error: permiso.error }

  const admin = createServiceClient()

  // Cargar bloque + config + negocio para resolver Drive destino
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: bloqueRaw } = await (db(supabase) as any)
    .from('negocio_bloques')
    .select(`
      data, negocio_id,
      bloque_configs!inner(config_extra),
      negocios!inner(codigo, carpeta_url)
    `)
    .eq('id', negocioBloqueId)
    .single()

  if (!bloqueRaw) return { success: false, error: 'Bloque no encontrado' }

  const currentData = (bloqueRaw.data as Record<string, unknown>) ?? {}
  const currentDocs = (currentData.docs as Record<string, string>) ?? {}
  const configExtra = ((bloqueRaw.bloque_configs as { config_extra?: Record<string, unknown> }).config_extra ?? {}) as Record<string, unknown>
  const driveSubfolder = configExtra.drive_subfolder as string | undefined

  // Si el bloque tiene drive_subfolder definido → mover archivo a Drive y borrar de Storage.
  // Si no → comportamiento legacy (URL publica de Supabase Storage).
  let url: string

  if (esReferenciaExterna(filePath)) {
    // Almacenamiento externo: la subida pendiente de ESTE negocio se consolida con el
    // nombre del slot. Nunca Drive, nunca `ve-documentos`.
    const negocioId = (bloqueRaw.negocio_id as string | undefined) ?? ''
    const partes = parsearReferencia(filePath)
    if (!partes || !esRutaPendienteDe(partes.path, negocioId)) {
      return { success: false, error: 'La subida no corresponde a este negocio' }
    }
    let almacenamiento: Awaited<ReturnType<typeof almacenamientoExternoDe>>
    try {
      almacenamiento = await almacenamientoExternoDe(workspaceId)
    } catch (e) {
      return { success: false, error: e instanceof Error ? e.message : String(e) }
    }
    if (!almacenamiento) {
      return { success: false, error: 'Este espacio guarda sus archivos en Google Drive' }
    }
    const docsConfig = (configExtra.documentos ?? []) as Array<{ slug: string; label: string }>
    const slotLabel = docsConfig.find(d => d.slug === slug)?.label ?? slug
    const ext = partes.path.split('.').pop()?.toLowerCase() ?? 'pdf'
    try {
      const guardado = await almacenamiento.consolidarPendiente({
        origen: filePath,
        negocioId,
        subcarpeta: driveSubfolder ?? null,
        nombre: `${slotLabel}.${ext}`,
        mime: mimeTypeFromUrl(partes.path),
        tipoBloque: 'documentos',
      })
      url = guardado.referencia
    } catch (e) {
      return { success: false, error: e instanceof Error ? e.message : String(e) }
    }
    const anterior = currentDocs[slug]
    if (esReferenciaExterna(anterior) && anterior !== url) {
      await almacenamiento.borrar(anterior).catch(err => {
        console.warn('[ve-documentos] no se pudo borrar el archivo anterior:', err instanceof Error ? err.message : err)
      })
    }
  } else if (driveSubfolder) {
    const negocio = bloqueRaw.negocios as { codigo: string | null; carpeta_url: string | null }
    const folderIdMatch = negocio.carpeta_url?.match(/folders\/([-\w]+)/)
    const negocioFolderId = folderIdMatch?.[1]
    if (!negocioFolderId) {
      return { success: false, error: 'Negocio sin carpeta Drive — no se puede mover archivo' }
    }

    // Resolver label del slot desde configExtra.documentos[slug]
    const docsConfig = (configExtra.documentos ?? []) as Array<{ slug: string; label: string }>
    const slotConfig = docsConfig.find(d => d.slug === slug)
    const slotLabel = slotConfig?.label ?? slug

    // Descargar archivo del bucket
    const { data: fileData, error: dlError } = await admin.storage.from(BUCKET).download(filePath)
    if (dlError || !fileData) {
      return { success: false, error: `Error descargando archivo temporal: ${dlError?.message ?? 'no data'}` }
    }
    const arrayBuf = await fileData.arrayBuffer()
    const buffer = Buffer.from(arrayBuf)
    const mimeType = fileData.type || mimeTypeFromUrl(filePath)
    const ext = filePath.split('.').pop()?.toLowerCase() ?? 'pdf'

    // Crear cadena de subcarpetas y subir
    const targetFolderId = await createSubfolderPath(driveSubfolder, negocioFolderId, workspaceId)
    const fileName = `${slotLabel}.${ext}`
    const up = await uploadFileToDrive(buffer, fileName, mimeType, targetFolderId, workspaceId)
    await setFilePublicByLink(up.fileId, workspaceId)
    url = up.webViewLink

    // Borrar archivo temporal de Storage
    await admin.storage.from(BUCKET).remove([filePath]).catch(err => {
      console.warn(`[ve-documentos] no se pudo borrar archivo temporal Storage:`, err)
    })
  } else {
    // Sin subcarpeta de Drive: el archivo se queda en `ve-documentos` y lo que se guarda
    // es la REFERENCIA. El bucket deja de ser público, así que una URL `object/public`
    // sería un enlace muerto.
    url = construirReferenciaOne(BUCKET_DOCUMENTOS_ONE, filePath)
  }

  const { error: updateError } = await db(supabase)
    .from('negocio_bloques')
    .update({
      data: { ...currentData, docs: { ...currentDocs, [slug]: url } },
      updated_at: new Date().toISOString(),
    })
    .eq('id', negocioBloqueId)

  if (updateError) return { success: false, error: updateError.message }
  return { success: true, url }
}

// ── 3. Procesar documento con IA ──────────────────────────────────────────────

function mimeTypeFromUrl(url: string): string {
  const p = url.split('?')[0].toLowerCase()
  if (p.endsWith('.pdf')) return 'application/pdf'
  if (p.endsWith('.png')) return 'image/png'
  if (p.endsWith('.webp')) return 'image/webp'
  if (p.endsWith('.jpg') || p.endsWith('.jpeg')) return 'image/jpeg'
  return 'application/pdf'
}

export async function procesarDocumentoNegocio(
  negocioBloqueId: string,
  slug: string,
): Promise<{ success: boolean; data?: CamposExtraidos; error?: string }> {
  if (!SLUGS_CON_AI.includes(slug)) {
    return { success: false, error: `'${slug}' no requiere procesamiento AI` }
  }

  const { supabase, role, error } = await getWorkspace()
  if (error) return { success: false, error: 'No autenticado' }

  const permiso = await guardDocumentoNegocio(negocioBloqueId, role)
  if (!permiso.ok) return { success: false, error: permiso.error }

  const { data: bloque } = await db(supabase)
    .from('negocio_bloques')
    .select('data')
    .eq('id', negocioBloqueId)
    .single()

  const currentData = (bloque?.data as Record<string, unknown>) ?? {}
  const docs = (currentData.docs as Record<string, string>) ?? {}
  const url = docs[slug]
  if (!url) return { success: false, error: `Documento '${slug}' no cargado` }

  const apiKey = getServerKey('gemini')
  if (!apiKey) return { success: false, error: 'GEMINI_API_KEY no configurada' }

  let buffer: ArrayBuffer
  let mimeType: string
  if (esReferenciaOne(url)) {
    // Bucket de ONE: se lee con el cliente de servicio. Un `fetch` a la URL pública
    // dejaría de funcionar en cuanto el bucket se cierre.
    try {
      const leido = await descargarDeOne(url)
      const copia = new Uint8Array(leido.buffer.length)
      copia.set(leido.buffer)
      buffer = copia.buffer
      mimeType = leido.mime || mimeTypeFromUrl(url)
    } catch (err) {
      return { success: false, error: `Error descargando: ${String(err).slice(0, 80)}` }
    }
  } else if (esReferenciaExterna(url)) {
    // Una referencia externa no se puede pedir por `fetch`: se lee con la llave del workspace.
    try {
      const { workspaceId } = await getWorkspace()
      const almacenamiento = workspaceId ? await almacenamientoExternoDe(workspaceId) : null
      if (!almacenamiento) return { success: false, error: 'Archivo en almacenamiento externo no disponible' }
      const leido = await almacenamiento.descargar(url)
      const copia = new Uint8Array(leido.buffer.length)
      copia.set(leido.buffer)
      buffer = copia.buffer
      mimeType = leido.mime || mimeTypeFromUrl(url)
    } catch (err) {
      return { success: false, error: `Error descargando: ${String(err).slice(0, 80)}` }
    }
  } else {
    try {
      const res = await fetch(url)
      if (!res.ok) return { success: false, error: `Error descargando (HTTP ${res.status})` }
      buffer = await res.arrayBuffer()
      const ct = res.headers.get('content-type') || ''
      mimeType = ct.split(';')[0].trim() || mimeTypeFromUrl(url)
    } catch (err) {
      return { success: false, error: `Error descargando: ${String(err).slice(0, 80)}` }
    }
  }

  const campos: CamposExtraidos = {}

  // ── RUT: parser especializado ─────────────────────────────────────────────
  if (slug === 'rut') {
    const { data: rutData, error: parseError } = await parseRut(buffer, mimeType, apiKey)
    if (parseError || !rutData) {
      return { success: false, error: parseError ?? 'Error procesando RUT' }
    }

    const applyStr = (
      key: keyof CamposExtraidos,
      field: { value: string | null; confidence: number },
    ) => {
      if (field.value && field.confidence >= 0.6) campos[key] = field.value
    }

    // razon_social → nombre_propietario
    applyStr('nombre_propietario', rutData.razon_social)
    // nit → numero_identificacion (si no hay ya valor de cédula)
    if (rutData.nit.value && rutData.nit.confidence >= 0.6 && !currentData.numero_identificacion) {
      campos.numero_identificacion = rutData.nit.value
    }
    applyStr('regimen_tributario_cliente', rutData.regimen_tributario)
    applyStr('tipo_persona_cliente', rutData.tipo_persona)
    applyStr('telefono_propietario', rutData.telefono)
    applyStr('municipio_propietario', rutData.municipio)
    applyStr('correo_propietario', rutData.email_fiscal)
    applyStr('direccion_propietario', rutData.direccion_fiscal)
  }

  // ── Factura, cédula, soporte UPME: parser vehicular ───────────────────────
  else {
    const { data: veData, error: parseError } = await parseVeDocuments(
      [{ buffer, mimeType, slug }],
      apiKey,
    )
    if (parseError || !veData) {
      return { success: false, error: parseError ?? 'Error procesando documento' }
    }

    const apply = (
      key: keyof CamposExtraidos,
      field: { value: string | null; confidence: number },
    ) => {
      if (field.value && field.confidence >= 0.6) campos[key] = field.value
    }

    apply('nombre_propietario', veData.nombre_propietario)
    apply('numero_identificacion', veData.numero_identificacion)
    apply('marca', veData.marca_vehiculo)
    apply('linea', veData.linea_vehiculo)
    apply('modelo', veData.modelo_ano)
    apply('tecnologia', veData.tecnologia)
    apply('tipo', veData.tipo_vehiculo)
    apply('numero_cus', veData.numero_cus)
  }

  // ── Persistir campos en bloque data ──────────────────────────────────────
  if (Object.keys(campos).length > 0) {
    const { data: fresh } = await db(supabase)
      .from('negocio_bloques')
      .select('data')
      .eq('id', negocioBloqueId)
      .single()
    const freshData = (fresh?.data as Record<string, unknown>) ?? {}
    await db(supabase)
      .from('negocio_bloques')
      .update({ data: { ...freshData, ...campos }, updated_at: new Date().toISOString() })
      .eq('id', negocioBloqueId)
  }

  return { success: true, data: campos }
}

// ── 4. Guardar campos editados manualmente ────────────────────────────────────

export async function actualizarCamposNegocioBloque(
  negocioBloqueId: string,
  campos: CamposExtraidos,
): Promise<{ success: boolean; error?: string }> {
  const { supabase, role, error } = await getWorkspace()
  if (error) return { success: false, error: 'No autenticado' }

  const permiso = await guardDocumentoNegocio(negocioBloqueId, role)
  if (!permiso.ok) return { success: false, error: permiso.error }

  const { data: bloque } = await db(supabase)
    .from('negocio_bloques')
    .select('data')
    .eq('id', negocioBloqueId)
    .single()

  const currentData = (bloque?.data as Record<string, unknown>) ?? {}

  const { error: updateError } = await db(supabase)
    .from('negocio_bloques')
    .update({ data: { ...currentData, ...campos }, updated_at: new Date().toISOString() })
    .eq('id', negocioBloqueId)

  if (updateError) return { success: false, error: updateError.message }
  return { success: true }
}
