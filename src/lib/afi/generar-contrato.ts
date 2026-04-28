'use server'

// Orquestador para generacion del contrato AFI ↔ Cliente.
// Flujo:
//   1. Lee bloque "Producto contratado" del negocio (etapa Venta)
//   2. Lee bloque "RUT" para datos del cliente
//   3. Descarga plantilla maestra del bucket
//   4. Compone contrato con motor modular
//   5. Sube DOCX a Drive del negocio
//   6. Registra log

import { createServiceClient } from '@/lib/supabase/server'
import { uploadFileToDrive, createDriveFolder } from '@/lib/google-drive'
import { generarContratoDocx, type ClienteData } from './contrato-engine'
import type { ProductosContratados } from './template-mapping'

interface Result {
  ok: boolean
  error?: string
  drive_file_id?: string
  drive_url?: string
  filename?: string
}

export async function generarContratoAFI(negocio_id: string): Promise<Result> {
  const svc = createServiceClient()

  // 1. Cargar negocio
  const { data: negocio, error: negocioErr } = await svc.from('negocios')
    .select('id, codigo, carpeta_url, linea_id')
    .eq('id', negocio_id)
    .single()
  if (negocioErr || !negocio) return { ok: false, error: 'Negocio no encontrado' }

  // 2. Cargar bloques del negocio con sus configs
  const { data: instRows, error: instErr } = await svc
    .from('negocio_bloques')
    .select('id, bloque_config_id, data, bloque_configs!inner(nombre)')
    .eq('negocio_id', negocio_id)
  if (instErr || !instRows || instRows.length === 0) {
    return { ok: false, error: 'Negocio sin bloques instanciados' }
  }

  function findData(nombre: string): Record<string, unknown> | null {
    const row = (instRows as unknown as { data: Record<string, unknown> | null; bloque_configs: { nombre: string } }[])
      .find(r => r.bloque_configs?.nombre === nombre)
    return row?.data ?? null
  }

  const productosData = (findData('Producto contratado') as ProductosContratados | null) || {}
  const rutRaw = findData('RUT') as { campos?: Record<string, { value?: string }> } | null

  if (!productosData || (!productosData.sarlaft_regimen && !productosData.ptee && !productosData.oficial)) {
    // Backwards-compat: schema viejo
    if (!productosData.sarlaft_simplificado && !productosData.sarlaft_ampliado && !productosData.ptee) {
      return { ok: false, error: 'No hay productos seleccionados en el bloque Producto contratado' }
    }
  }

  // Datos del cliente desde RUT (si existe) — si no, usar placeholders
  const rutCampos = rutRaw?.campos ?? {}
  const cliente: ClienteData = {
    empresa_nombre: (rutCampos.razon_social?.value as string) || '{{EMPRESA_NOMBRE}}',
    empresa_nit: ((rutCampos.nit?.value as string) || '{{EMPRESA_NIT}}') + (rutCampos.dv?.value ? `-${rutCampos.dv.value}` : ''),
    rep_legal_nombre: (rutCampos.representante_legal?.value as string) || '{{REP_LEGAL_NOMBRE}}',
    rep_legal_cc: (rutCampos.representante_legal_cc?.value as string) || '{{REP_LEGAL_CC}}',
    ciudad_firma: (rutCampos.ciudad?.value as string) || 'Bogotá D.C.',
  }

  // 3. Descargar plantilla maestra
  const { data: tplBlob, error: dlErr } = await svc.storage
    .from('afi-templates').download('CT-AFI-CLIENTE-MASTER.docx')
  if (dlErr || !tplBlob) return { ok: false, error: 'Plantilla maestra no disponible en bucket' }
  const tplBuffer = await tplBlob.arrayBuffer()

  // 4. Generar contrato
  let docxBuffer: Buffer
  try {
    docxBuffer = generarContratoDocx({
      templateBuffer: tplBuffer,
      productos: productosData,
      cliente,
    })
  } catch (e) {
    return { ok: false, error: `Error componiendo contrato: ${(e as Error).message}` }
  }

  // 5. Resolver carpeta Drive del negocio (crear si no existe)
  let driveFolderId: string | null = null
  if (negocio.carpeta_url) {
    const m = negocio.carpeta_url.match(/folders\/([a-zA-Z0-9_-]+)/)
    if (m) driveFolderId = m[1]
  }
  if (!driveFolderId) {
    // Resolver carpeta raiz de la linea (donde se cuelgan negocios AFI)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: linea } = await (svc as any).from('lineas_negocio')
      .select('drive_folder_id').eq('id', negocio.linea_id).single()
    if (!linea?.drive_folder_id) {
      return { ok: false, error: 'Linea de negocio sin drive_folder_id configurado' }
    }
    const folderName = `${negocio.codigo} - ${cliente.empresa_nombre}`
    driveFolderId = await createDriveFolder(folderName, linea.drive_folder_id)
    await svc.from('negocios').update({ carpeta_url: `https://drive.google.com/drive/folders/${driveFolderId}` }).eq('id', negocio_id)
  }

  const filename = `Contrato AFI - ${cliente.empresa_nombre} - ${new Date().toISOString().split('T')[0]}.docx`
  const upload = await uploadFileToDrive(
    docxBuffer,
    filename,
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    driveFolderId,
  )

  // 6. Log (reusa tabla generaciones_log si existe, si no skip)
  await svc.from('generaciones_log').insert({
    negocio_id,
    tipo: 'contrato_afi',
    productos: productosData as never,
    drive_file_id: upload.fileId,
    drive_url: upload.webViewLink,
    filename,
  } as never).then(() => {}, () => {})  // silencioso si la tabla no acepta

  return {
    ok: true,
    drive_file_id: upload.fileId,
    drive_url: upload.webViewLink,
    filename,
  }
}
