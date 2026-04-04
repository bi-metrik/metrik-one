'use server'

import { getWorkspace } from '@/lib/actions/get-workspace'
import { createServiceClient } from '@/lib/supabase/server'
import { getServerKey } from '@/lib/server-keys'
import { parseVeDocuments } from '@/lib/ve/parse-ve-docs'
import { parseRut } from '@/lib/rut/parse-rut'

// ── Tipos ──────────────────────────────────────────────────

export type DocumentoSlug =
  | 'cedula'
  | 'factura'
  | 'rut'
  | 'soporte_upme'
  | 'ficha_tecnica'
  | 'cert_emisiones'

export interface VeDocumentoState {
  slug: DocumentoSlug
  url: string
  subido_en: string
}

export interface CamposVehiculo {
  marca?: string
  linea?: string
  modelo?: string
  tecnologia?: string
  tipo?: string
  nombre_propietario?: string
  numero_identificacion?: string
  // Datos fiscales del cliente (extraidos del RUT)
  regimen_tributario_cliente?: string
  tipo_persona_cliente?: string
  // Datos de contacto del propietario (extraidos del RUT)
  telefono_propietario?: string
  municipio_propietario?: string
  correo_propietario?: string
  direccion_propietario?: string
  // Tramite UPME
  numero_cus?: string
}

// ── Constantes ─────────────────────────────────────────────

const BUCKET = 've-documentos'

// ── Leer documentos actuales de custom_data ────────────────

export async function getVeDocumentos(
  oportunidadId: string,
): Promise<{ docs: VeDocumentoState[]; vehiculoEnUpme: boolean | null; camposVehiculo: CamposVehiculo | null }> {
  const { supabase, error } = await getWorkspace()
  if (error) return { docs: [], vehiculoEnUpme: null, camposVehiculo: null }

  const { data } = await supabase
    .from('oportunidades')
    .select('custom_data')
    .eq('id', oportunidadId)
    .single()

  if (!data?.custom_data) return { docs: [], vehiculoEnUpme: null, camposVehiculo: null }

  const cd = data.custom_data as Record<string, unknown>
  const docsRaw = (cd.docs as Record<string, string>) ?? {}
  const docs: VeDocumentoState[] = Object.entries(docsRaw).map(([slug, url]) => ({
    slug: slug as DocumentoSlug,
    url,
    subido_en: '',
  }))

  const vehiculoEnUpme = typeof cd.vehiculo_en_upme === 'boolean' ? cd.vehiculo_en_upme : null

  const camposVehiculo: CamposVehiculo = {}
  if (cd.marca_vehiculo) camposVehiculo.marca = cd.marca_vehiculo as string
  if (cd.linea_vehiculo) camposVehiculo.linea = cd.linea_vehiculo as string
  if (cd.modelo_ano) camposVehiculo.modelo = cd.modelo_ano as string
  if (cd.tecnologia) camposVehiculo.tecnologia = cd.tecnologia as string
  if (cd.tipo_vehiculo) camposVehiculo.tipo = cd.tipo_vehiculo as string
  if (cd.nombre_propietario) camposVehiculo.nombre_propietario = cd.nombre_propietario as string
  if (cd.numero_identificacion) camposVehiculo.numero_identificacion = cd.numero_identificacion as string
  if (cd.regimen_tributario_cliente) camposVehiculo.regimen_tributario_cliente = cd.regimen_tributario_cliente as string
  if (cd.tipo_persona_cliente) camposVehiculo.tipo_persona_cliente = cd.tipo_persona_cliente as string
  if (cd.telefono_propietario) camposVehiculo.telefono_propietario = cd.telefono_propietario as string
  if (cd.municipio_propietario) camposVehiculo.municipio_propietario = cd.municipio_propietario as string
  if (cd.correo_propietario) camposVehiculo.correo_propietario = cd.correo_propietario as string
  if (cd.direccion_propietario) camposVehiculo.direccion_propietario = cd.direccion_propietario as string
  if (cd.numero_cus) camposVehiculo.numero_cus = cd.numero_cus as string

  const hasCampos = Object.keys(camposVehiculo).length > 0

  return { docs, vehiculoEnUpme, camposVehiculo: hasCampos ? camposVehiculo : null }
}

// ── Paso 1: Generar URL firmada de upload ──────────────────

export async function getUploadUrlDocumentoVe(
  oportunidadId: string,
  slug: DocumentoSlug,
  fileExtension: string,
): Promise<{ success: boolean; path?: string; token?: string; error?: string }> {
  const { workspaceId, error } = await getWorkspace()
  if (error || !workspaceId) return { success: false, error: 'No autenticado' }

  const ext = fileExtension.toLowerCase().replace(/^\./, '') || 'pdf'
  const filePath = `${workspaceId}/${oportunidadId}/${slug}.${ext}`

  const admin = createServiceClient()
  const { data, error: signError } = await admin.storage
    .from(BUCKET)
    .createSignedUploadUrl(filePath, { upsert: true })

  if (signError || !data) {
    return { success: false, error: signError?.message ?? 'Error generando URL de subida' }
  }

  return { success: true, path: filePath, token: data.token }
}

// ── Paso 3: Confirmar upload y guardar URL en custom_data ──

export async function confirmarUploadDocumentoVe(
  oportunidadId: string,
  slug: DocumentoSlug,
  filePath: string,
): Promise<{ success: boolean; url?: string; error?: string }> {
  const { supabase, error } = await getWorkspace()
  if (error) return { success: false, error: 'No autenticado' }

  const admin = createServiceClient()
  const { data: publicData } = admin.storage.from(BUCKET).getPublicUrl(filePath)
  const url = publicData.publicUrl

  const { data: opp } = await supabase
    .from('oportunidades')
    .select('custom_data')
    .eq('id', oportunidadId)
    .single()

  const currentCustomData = (opp?.custom_data as Record<string, unknown>) ?? {}
  const currentDocs = (currentCustomData.docs as Record<string, string>) ?? {}

  const { error: updateError } = await supabase
    .from('oportunidades')
    .update({
      custom_data: {
        ...currentCustomData,
        docs: { ...currentDocs, [slug]: url },
      } as unknown as Record<string, never>,
    })
    .eq('id', oportunidadId)

  if (updateError) return { success: false, error: `Error guardando: ${updateError.message}` }

  return { success: true, url }
}

// ── Actualizar vehiculo_en_upme en custom_data ─────────────

export async function actualizarVehiculoEnUpme(
  oportunidadId: string,
  vehiculoEnUpme: boolean,
): Promise<{ success: boolean; error?: string }> {
  const { supabase, error } = await getWorkspace()
  if (error) return { success: false, error: 'No autenticado' }

  const { data: opp } = await supabase
    .from('oportunidades')
    .select('custom_data')
    .eq('id', oportunidadId)
    .single()

  const currentCustomData = (opp?.custom_data as Record<string, unknown>) ?? {}

  const { error: updateError } = await supabase
    .from('oportunidades')
    .update({
      custom_data: {
        ...currentCustomData,
        vehiculo_en_upme: vehiculoEnUpme,
      } as unknown as Record<string, never>,
    })
    .eq('id', oportunidadId)

  if (updateError) return { success: false, error: updateError.message }
  return { success: true }
}

// ── Actualizar campos del vehiculo en custom_data ──────────

export async function actualizarCamposVehiculo(
  oportunidadId: string,
  campos: CamposVehiculo,
): Promise<{ success: boolean; error?: string }> {
  const { supabase, error } = await getWorkspace()
  if (error) return { success: false, error: 'No autenticado' }

  const { data: opp } = await supabase
    .from('oportunidades')
    .select('custom_data')
    .eq('id', oportunidadId)
    .single()

  const currentCustomData = (opp?.custom_data as Record<string, unknown>) ?? {}

  const updates: Record<string, unknown> = { ...currentCustomData }
  if (campos.marca !== undefined) updates.marca_vehiculo = campos.marca
  if (campos.linea !== undefined) updates.linea_vehiculo = campos.linea
  if (campos.modelo !== undefined) updates.modelo_ano = campos.modelo
  if (campos.tecnologia !== undefined) updates.tecnologia = campos.tecnologia
  if (campos.tipo !== undefined) updates.tipo_vehiculo = campos.tipo
  if (campos.nombre_propietario !== undefined) updates.nombre_propietario = campos.nombre_propietario
  if (campos.numero_identificacion !== undefined) updates.numero_identificacion = campos.numero_identificacion
  if (campos.regimen_tributario_cliente !== undefined) updates.regimen_tributario_cliente = campos.regimen_tributario_cliente
  if (campos.tipo_persona_cliente !== undefined) updates.tipo_persona_cliente = campos.tipo_persona_cliente
  if (campos.telefono_propietario !== undefined) updates.telefono_propietario = campos.telefono_propietario
  if (campos.municipio_propietario !== undefined) updates.municipio_propietario = campos.municipio_propietario
  if (campos.correo_propietario !== undefined) updates.correo_propietario = campos.correo_propietario
  if (campos.direccion_propietario !== undefined) updates.direccion_propietario = campos.direccion_propietario
  if (campos.numero_cus !== undefined) updates.numero_cus = campos.numero_cus

  const { error: updateError } = await supabase
    .from('oportunidades')
    .update({ custom_data: updates as unknown as Record<string, never> })
    .eq('id', oportunidadId)

  if (updateError) return { success: false, error: updateError.message }
  return { success: true }
}

// ── Helpers de deteccion de MIME por extension ────────────

function mimeTypeFromUrl(url: string): string {
  const path = url.split('?')[0].toLowerCase()
  if (path.endsWith('.pdf')) return 'application/pdf'
  if (path.endsWith('.png')) return 'image/png'
  if (path.endsWith('.webp')) return 'image/webp'
  if (path.endsWith('.jpg') || path.endsWith('.jpeg')) return 'image/jpeg'
  // Fallback: intentar con PDF (documentos colombianos suelen ser PDF)
  return 'application/pdf'
}

// ── Procesar un documento individual con Gemini Vision ────

// Slugs que tienen datos relevantes para extraccion AI
const DOCS_AI_RELEVANTES: DocumentoSlug[] = ['factura', 'ficha_tecnica', 'cedula', 'rut', 'soporte_upme']

export async function procesarDocumentoVe(
  oportunidadId: string,
  slug: DocumentoSlug,
): Promise<{ success: boolean; data?: CamposVehiculo; error?: string }> {
  if (!DOCS_AI_RELEVANTES.includes(slug)) {
    return { success: false, error: `El documento '${slug}' no requiere procesamiento AI` }
  }

  const { supabase, workspaceId, error } = await getWorkspace()
  if (error || !workspaceId) return { success: false, error: 'No autenticado' }

  const admin = createServiceClient()

  const { data: opp } = await supabase
    .from('oportunidades')
    .select('custom_data')
    .eq('id', oportunidadId)
    .single()

  if (!opp?.custom_data) return { success: false, error: 'Oportunidad no encontrada' }

  const cd = opp.custom_data as Record<string, unknown>
  const docsUrls = (cd.docs as Record<string, string>) ?? {}
  const url = docsUrls[slug]

  if (!url) return { success: false, error: `Documento '${slug}' no ha sido cargado` }

  const apiKey = getServerKey('gemini')
  if (!apiKey) return { success: false, error: 'GEMINI_API_KEY no configurada' }

  let buffer: ArrayBuffer
  let mimeType: string
  try {
    const res = await fetch(url)
    if (!res.ok) return { success: false, error: `Error descargando documento (HTTP ${res.status})` }
    buffer = await res.arrayBuffer()
    const ct = res.headers.get('content-type') || ''
    mimeType = ct.split(';')[0].trim() || mimeTypeFromUrl(url)
  } catch (fetchErr) {
    return { success: false, error: `Error descargando: ${String(fetchErr).slice(0, 80)}` }
  }

  // ── RUT del cliente: parseRut especializado para 18 campos fiscales ──
  if (slug === 'rut') {
    const { data: rutData, error: parseError } = await parseRut(buffer, mimeType, apiKey)

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (admin as any).from('ve_procesamiento_log').insert({
      workspace_id: workspaceId,
      oportunidad_id: oportunidadId,
      documentos_procesados: ['rut'],
      campos_extraidos: rutData ? {
        nit: rutData.nit,
        razon_social: rutData.razon_social,
        regimen_tributario: rutData.regimen_tributario,
        tipo_persona: rutData.tipo_persona,
        overall_confidence: rutData.overall_confidence,
      } : null,
      exitoso: !parseError && !!rutData,
    })

    if (parseError || !rutData) {
      return { success: false, error: parseError ?? 'Error desconocido procesando RUT' }
    }

    const camposMerge: CamposVehiculo = {}
    const applyStr = (
      key: keyof CamposVehiculo,
      currentVal: unknown,
      field: { value: string | null; confidence: number },
    ) => {
      if (!field.value) return
      if (!currentVal || field.confidence >= 0.7) {
        camposMerge[key] = field.value
      }
    }

    // Nombre del cliente desde razon_social del RUT
    applyStr('nombre_propietario', cd.nombre_propietario, rutData.razon_social)
    // Numero de identificacion: solo si no hay valor (NIT puede diferir de cedula)
    if (rutData.nit.value && !cd.numero_identificacion) {
      camposMerge.numero_identificacion = rutData.nit.value
    }
    // Datos fiscales del cliente
    applyStr('regimen_tributario_cliente', cd.regimen_tributario_cliente, rutData.regimen_tributario)
    applyStr('tipo_persona_cliente', cd.tipo_persona_cliente, rutData.tipo_persona)
    // Datos de contacto del propietario
    applyStr('telefono_propietario', cd.telefono_propietario, rutData.telefono)
    applyStr('municipio_propietario', cd.municipio_propietario, rutData.municipio)
    applyStr('correo_propietario', cd.correo_propietario, rutData.email_fiscal)
    applyStr('direccion_propietario', cd.direccion_propietario, rutData.direccion_fiscal)

    if (Object.keys(camposMerge).length > 0) {
      await actualizarCamposVehiculo(oportunidadId, camposMerge)
    }

    return { success: true, data: camposMerge }
  }

  // ── Documentos vehiculares: factura, ficha_tecnica, cedula ──
  const { data: veData, error: parseError } = await parseVeDocuments(
    [{ buffer, mimeType, slug }],
    apiKey,
  )

  // Registrar resultado en log (exitoso o fallido)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await (admin as any).from('ve_procesamiento_log').insert({
    workspace_id: workspaceId,
    oportunidad_id: oportunidadId,
    documentos_procesados: [slug],
    campos_extraidos: veData ? {
      marca_vehiculo: veData.marca_vehiculo,
      linea_vehiculo: veData.linea_vehiculo,
      modelo_ano: veData.modelo_ano,
      tecnologia: veData.tecnologia,
      tipo_vehiculo: veData.tipo_vehiculo,
      overall_confidence: veData.overall_confidence,
    } : null,
    exitoso: !parseError && !!veData,
  })

  if (parseError || !veData) {
    return { success: false, error: parseError ?? 'Error desconocido procesando documento' }
  }

  // Merge inteligente: sobreescribir solo si confidence >= 0.7 o si no hay valor actual
  const camposMerge: CamposVehiculo = {}
  const apply = (
    key: keyof CamposVehiculo,
    currentVal: unknown,
    field: { value: string | null; confidence: number },
  ) => {
    if (!field.value) return
    if (!currentVal || field.confidence >= 0.7) {
      camposMerge[key] = field.value
    }
  }

  apply('marca', cd.marca_vehiculo, veData.marca_vehiculo)
  apply('linea', cd.linea_vehiculo, veData.linea_vehiculo)
  apply('modelo', cd.modelo_ano, veData.modelo_ano)
  apply('tecnologia', cd.tecnologia, veData.tecnologia)
  apply('tipo', cd.tipo_vehiculo, veData.tipo_vehiculo)
  apply('nombre_propietario', cd.nombre_propietario, veData.nombre_propietario)
  apply('numero_identificacion', cd.numero_identificacion, veData.numero_identificacion)
  apply('numero_cus', cd.numero_cus, veData.numero_cus)

  if (Object.keys(camposMerge).length > 0) {
    await actualizarCamposVehiculo(oportunidadId, camposMerge)
  }

  return { success: true, data: camposMerge }
}

// ── Procesar documentos con Gemini Vision ─────────────────

export async function procesarDocumentosVe(
  oportunidadId: string,
): Promise<{ success: boolean; data?: CamposVehiculo; error?: string }> {
  const { supabase, workspaceId, error } = await getWorkspace()
  if (error || !workspaceId) return { success: false, error: 'No autenticado' }

  const admin = createServiceClient()

  // Leer URLs de documentos actuales
  const { data: opp } = await supabase
    .from('oportunidades')
    .select('custom_data')
    .eq('id', oportunidadId)
    .single()

  if (!opp?.custom_data) return { success: false, error: 'Oportunidad no encontrada' }

  const cd = opp.custom_data as Record<string, unknown>
  const docsUrls = (cd.docs as Record<string, string>) ?? {}

  // Requiere al menos factura o ficha_tecnica
  const urlFactura = docsUrls.factura
  const urlFicha = docsUrls.ficha_tecnica

  if (!urlFactura && !urlFicha) {
    return { success: false, error: 'Se necesita al menos la Factura o la Ficha Tecnica para procesar' }
  }

  const apiKey = getServerKey('gemini')
  if (!apiKey) {
    return { success: false, error: 'GEMINI_API_KEY no configurada en el servidor' }
  }

  // Construir lista de documentos relevantes para extraccion VE
  // (factura primero — prioridad para datos de identificacion del vehiculo)
  const docEntries: { url: string; slug: string }[] = []
  if (urlFactura) docEntries.push({ url: urlFactura, slug: 'factura' })
  if (urlFicha) docEntries.push({ url: urlFicha, slug: 'ficha_tecnica' })

  const slugsProcesados = docEntries.map(d => d.slug)

  // Fetch + convertir cada documento a ArrayBuffer para envio inline a Gemini
  const docsPayload: Array<{ buffer: ArrayBuffer; mimeType: string; slug: string }> = []
  for (const entry of docEntries) {
    try {
      const res = await fetch(entry.url)
      if (!res.ok) {
        console.warn(`[procesarDocumentosVe] No se pudo descargar ${entry.slug}: HTTP ${res.status}`)
        continue
      }
      const buffer = await res.arrayBuffer()
      // Preferir content-type del servidor; fallback por extension de URL
      const contentType = res.headers.get('content-type') || ''
      const mimeType = contentType.split(';')[0].trim() || mimeTypeFromUrl(entry.url)
      docsPayload.push({ buffer, mimeType, slug: entry.slug })
    } catch (fetchErr) {
      console.warn(`[procesarDocumentosVe] Error descargando ${entry.slug}:`, fetchErr)
    }
  }

  if (docsPayload.length === 0) {
    return { success: false, error: 'No se pudieron descargar los documentos para procesar' }
  }

  // Llamar al parser con el patron identico a parse-rut.ts
  const { data: veData, error: parseError } = await parseVeDocuments(docsPayload, apiKey)

  if (parseError || !veData) {
    // Registrar intento fallido en log
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (admin as any).from('ve_procesamiento_log').insert({
      workspace_id: workspaceId,
      oportunidad_id: oportunidadId,
      documentos_procesados: slugsProcesados,
      campos_extraidos: null,
      exitoso: false,
    })
    return { success: false, error: parseError ?? 'Error desconocido al procesar documentos' }
  }

  // Mapear VeVehicleData → CamposVehiculo (estructura legacy del action)
  const extracted: CamposVehiculo = {
    marca: veData.marca_vehiculo.value ?? undefined,
    linea: veData.linea_vehiculo.value ?? undefined,
    modelo: veData.modelo_ano.value ?? undefined,
    tecnologia: veData.tecnologia.value ?? undefined,
    tipo: veData.tipo_vehiculo.value ?? undefined,
    nombre_propietario: veData.nombre_propietario.value ?? undefined,
    numero_identificacion: veData.numero_identificacion.value ?? undefined,
  }

  // Persistir campos extraidos en custom_data de la oportunidad
  await actualizarCamposVehiculo(oportunidadId, extracted)

  // Registrar extraccion exitosa en log
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await (admin as any).from('ve_procesamiento_log').insert({
    workspace_id: workspaceId,
    oportunidad_id: oportunidadId,
    documentos_procesados: slugsProcesados,
    campos_extraidos: {
      marca_vehiculo: veData.marca_vehiculo,
      linea_vehiculo: veData.linea_vehiculo,
      modelo_ano: veData.modelo_ano,
      tecnologia: veData.tecnologia,
      tipo_vehiculo: veData.tipo_vehiculo,
      overall_confidence: veData.overall_confidence,
    } as unknown as Record<string, unknown>,
    exitoso: true,
  })

  return { success: true, data: extracted }
}
