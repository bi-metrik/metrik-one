'use server'

// Orquestador Fase B — genera paquete documental para un negocio AFI.
// Flujo:
//  1. Lee datos del negocio: productos, RUT extraido, logo, oficial
//  2. Determina templates a generar segun productos
//  3. Descarga cada template de Storage `afi-templates`
//  4. Reemplaza placeholders + inserta logo
//  5. Sube resultado a Drive (carpeta del negocio)
//  6. Actualiza bloques "Documentos generados" y "Upload a Drive" del negocio
//  7. Registra en generaciones_log

import { createServiceClient } from '@/lib/supabase/server'
import { createDriveFolder, uploadFileToDrive } from '@/lib/google-drive'
import { generateDocx } from './docx-engine'
import {
  templatesAGenerar, buildContext,
  type RutExtraction, type OficialData, type ProductosContratados,
} from './template-mapping'

interface BloqueInstance {
  id: string
  bloque_config_id: string
  data: Record<string, unknown> | null
}

interface Result {
  ok: boolean
  error?: string
  docs_generados?: number
  drive_folder_url?: string
}

export async function disparararGeneracionAFI(negocio_id: string): Promise<Result> {
  const started = Date.now()
  const svc = createServiceClient()

  // 1. Cargar negocio + empresa + bloques
  const sb = svc as unknown as {
    from: (t: string) => {
      select: (s: string) => { eq: (c: string, v: string) => { single: () => Promise<{ data: Record<string, unknown> | null; error: unknown }>, maybeSingle: () => Promise<{ data: Record<string, unknown> | null }> } }
      update: (v: Record<string, unknown>) => { eq: (c: string, v: string) => Promise<{ error: unknown }> }
      insert: (v: Record<string, unknown>) => Promise<{ error: unknown }>
    }
  }

  const { data: negocio, error: negocioErr } = await sb.from('negocios').select(
    'id, codigo, carpeta_url, linea_id'
  ).eq('id', negocio_id).single()
  if (negocioErr || !negocio) return { ok: false, error: 'Negocio no encontrado' }

  // 2. Leer bloques: productos, RUT, logo, oficial
  // Cada bloque_instance tiene data JSONB con los campos llenados
  const instances: BloqueInstance[] = []
  const { data: instRows } = await svc
    .from('negocio_bloques')
    .select('id, bloque_config_id, data, bloque_configs!inner(nombre, bloque_definitions(tipo))')
    .eq('negocio_id', negocio_id)
  if (!instRows || instRows.length === 0) {
    return { ok: false, error: 'Negocio sin bloques instanciados' }
  }
  for (const row of instRows as unknown as { id: string; bloque_config_id: string; data: Record<string, unknown> | null; bloque_configs: { nombre: string } }[]) {
    instances.push({ id: row.id, bloque_config_id: row.bloque_config_id, data: row.data })
  }

  // 3. Extraer datos de los bloques por nombre
  function findData(nombre: string): Record<string, unknown> | null {
    const row = (instRows as unknown as { data: Record<string, unknown> | null; bloque_configs: { nombre: string } }[])
      .find(r => r.bloque_configs?.nombre === nombre)
    return row?.data ?? null
  }

  const productosData = (findData('Producto contratado') as unknown as ProductosContratados) || {}
  const rutRaw = findData('RUT') as { campos?: Record<string, { value?: string }> } | null
  // El bloque RUT guarda campos extraidos con AI en data.campos.{slug}.value
  const rutData: RutExtraction = {}
  if (rutRaw?.campos) {
    for (const [k, v] of Object.entries(rutRaw.campos)) {
      if (v && typeof v.value === 'string') {
        (rutData as Record<string, string>)[k] = v.value
      }
    }
  }
  const logoRaw = findData('Logo') as { drive_url?: string; archivo_url?: string; url?: string } | null
  const logoData = { archivo_url: logoRaw?.drive_url || logoRaw?.archivo_url || logoRaw?.url }
  const oficialData = (findData('Oficial de Cumplimiento') as unknown as OficialData) || {}

  const codes = templatesAGenerar(productosData)
  if (codes.length === 0) {
    return { ok: false, error: 'Ningun producto seleccionado' }
  }

  // 4. Descargar logo (si hay)
  let logoBuffer: ArrayBuffer | null = null
  const logoUrl = logoData.archivo_url || logoData.url
  if (logoUrl) {
    try {
      const res = await fetch(logoUrl)
      if (res.ok) logoBuffer = await res.arrayBuffer()
    } catch {
      // continuar sin logo
    }
  }

  // 5. Asegurar carpeta Drive del negocio (si el crearNegocio no la creo, la creamos ahora)
  let driveFolderUrl = (negocio.carpeta_url as string) || ''
  let driveFolderId = ''
  if (driveFolderUrl) {
    const m = driveFolderUrl.match(/folders\/([^/?]+)/)
    if (m) driveFolderId = m[1]
  }
  if (!driveFolderId) {
    // Obtener linea.drive_folder_id
    const { data: linea } = await svc
      .from('lineas_negocio').select('drive_folder_id').eq('id', negocio.linea_id as string).single()
    const parentId = (linea as { drive_folder_id: string | null } | null)?.drive_folder_id
    if (!parentId) return { ok: false, error: 'Linea sin drive_folder_id' }
    const folderName = `${negocio.codigo} - GEN`
    driveFolderId = await createDriveFolder(folderName, parentId)
    driveFolderUrl = `https://drive.google.com/drive/folders/${driveFolderId}`
    await svc.from('negocios').update({ carpeta_url: driveFolderUrl }).eq('id', negocio_id)
  }

  // 6. Generar cada doc y subir a Drive
  const docs_generados: { codigo: string; filename: string; drive_file_id: string; drive_url: string }[] = []
  const errors: string[] = []

  for (const codigo of codes) {
    try {
      // Descargar template
      const { data: tplBlob, error: dlErr } = await svc.storage
        .from('afi-templates').download(`${codigo}.docx`)
      if (dlErr || !tplBlob) { errors.push(`${codigo}: template no disponible`); continue }
      const tplBuffer = await tplBlob.arrayBuffer()

      // Generar
      const ctx = buildContext({ rut: rutData, oficial: oficialData, codigo_doc: codigo })
      const outBuffer = generateDocx({ templateBuffer: tplBuffer, context: ctx, logoBuffer })

      // Subir a Drive
      const razon = (rutData.razon_social || 'CDA').replace(/[^\w\s-]/g, '').substring(0, 30)
      const filename = `${codigo} - ${razon}.docx`
      const { fileId, webViewLink } = await uploadFileToDrive(
        outBuffer,
        filename,
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        driveFolderId,
      )
      docs_generados.push({
        codigo, filename,
        drive_file_id: fileId,
        drive_url: webViewLink || `https://drive.google.com/file/d/${fileId}/view`,
      })
    } catch (e) {
      errors.push(`${codigo}: ${(e as Error).message}`)
    }
  }

  // 7. Actualizar bloques de la etapa Generacion
  const docsResumen = docs_generados.map(d => `${d.codigo}: ${d.filename}`).join('\n')
  const instDocs = (instRows as unknown as { id: string; bloque_configs: { nombre: string } }[])
    .find(r => r.bloque_configs?.nombre === 'Documentos generados')
  if (instDocs) {
    await svc.from('negocio_bloques').update({
      data: { docs_count: docs_generados.length, docs_lista: docsResumen, docs_json: docs_generados },
      estado: 'completado',
    }).eq('id', instDocs.id)
  }
  const instDrive = (instRows as unknown as { id: string; bloque_configs: { nombre: string } }[])
    .find(r => r.bloque_configs?.nombre === 'Upload a Drive')
  if (instDrive) {
    await svc.from('negocio_bloques').update({
      data: { drive_folder_url: driveFolderUrl, drive_status: errors.length === 0 ? 'ok' : `${docs_generados.length} ok, ${errors.length} con errores` },
      estado: 'completado',
    }).eq('id', instDrive.id)
  }
  const instGen = (instRows as unknown as { id: string; bloque_configs: { nombre: string } }[])
    .find(r => r.bloque_configs?.nombre === 'Generar paquete')
  if (instGen) {
    await svc.from('negocio_bloques').update({
      data: { generacion_ejecutada_at: new Date().toISOString() },
      estado: 'completado',
    }).eq('id', instGen.id)
  }

  // 8. Registrar en generaciones_log (tabla no en types aun — migration 20260423000003)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await ((svc as any).from('generaciones_log')).insert({
    negocio_id,
    productos_contratados: productosData,
    rut_extraction: rutData,
    logo_storage_path: logoUrl ?? null,
    oficial_data: oficialData,
    docs_generados,
    drive_folder_url: driveFolderUrl,
    status: errors.length === 0 ? 'success' : (docs_generados.length > 0 ? 'partial' : 'failed'),
    error_message: errors.length > 0 ? errors.join(' | ') : null,
    duration_ms: Date.now() - started,
  })

  return {
    ok: errors.length === 0,
    error: errors.length > 0 ? errors.join(' | ') : undefined,
    docs_generados: docs_generados.length,
    drive_folder_url: driveFolderUrl,
  }
}
