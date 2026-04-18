'use server'

import { revalidatePath } from 'next/cache'
import { getWorkspace } from '@/lib/actions/get-workspace'
import { createServiceClient } from '@/lib/supabase/server'
import { uploadFileToDrive, setFilePublicByLink, createDriveFolder } from '@/lib/google-drive'
import { renderToBuffer } from '@react-pdf/renderer'
import { generarFormulario010, type Formulario010Datos, type Formulario010Constantes } from '@/lib/pdf/formulario-010'
import DeclaracionJuramentadaPDF from '@/lib/pdf/declaracion-juramentada-pdf'
import RelacionFacturasPDF from '@/lib/pdf/relacion-facturas-pdf'
import { createElement } from 'react'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function db(client: unknown): any { return client }

// ── Types ────────────────────────────────────────────────────────────────────

interface CampoFuente {
  slug: string
  source: {
    etapa_orden: number
    bloque_orden: number
    campo_slug: string
    tipo: string // 'ai' | 'field'
  }
}

// ── Resolve source campos ────────────────────────────────────────────────────

async function resolverCamposFuente(
  supabase: unknown,
  negocioId: string,
  lineaId: string,
  camposFuente: CampoFuente[],
): Promise<{ datos: Record<string, string | null>; faltantes: string[] }> {
  // Get all negocio_bloques with their config context
  const { data: bloques } = await db(supabase)
    .from('negocio_bloques')
    .select(`
      data,
      bloque_configs!inner(
        orden,
        config_extra,
        etapa_id,
        etapas_negocio!inner(orden, linea_id)
      )
    `)
    .eq('negocio_id', negocioId)

  if (!bloques || bloques.length === 0) {
    return { datos: {}, faltantes: camposFuente.map(c => c.slug) }
  }

  // Build lookup: { "etapaOrden:bloqueOrden" → negocio_bloque }
  const lookup = new Map<string, { data: Record<string, unknown> }>()
  for (const b of bloques) {
    const bc = b.bloque_configs as {
      orden: number
      config_extra: Record<string, unknown>
      etapas_negocio: { orden: number; linea_id: string }
    }
    if (bc.etapas_negocio.linea_id !== lineaId) continue
    const key = `${bc.etapas_negocio.orden}:${bc.orden}`
    lookup.set(key, { data: (b.data as Record<string, unknown>) ?? {} })
  }

  const datos: Record<string, string | null> = {}
  const faltantes: string[] = []

  for (const campo of camposFuente) {
    const key = `${campo.source.etapa_orden}:${campo.source.bloque_orden}`
    const bloque = lookup.get(key)

    if (!bloque) {
      datos[campo.slug] = null
      faltantes.push(campo.slug)
      continue
    }

    let value: string | null = null

    if (campo.source.tipo === 'ai') {
      // Read from data.campos[slug].value
      const campos = bloque.data.campos as Record<string, { value: string | null; confidence: number }> | undefined
      const campo_data = campos?.[campo.source.campo_slug]
      if (campo_data?.value && campo_data.confidence >= 0.70) {
        value = campo_data.value
      }
    } else {
      // Read from data[slug] directly (BloqueDatos)
      const raw = bloque.data[campo.source.campo_slug]
      if (raw !== null && raw !== undefined && raw !== '') {
        value = String(raw)
      }
    }

    datos[campo.slug] = value
    if (!value) faltantes.push(campo.slug)
  }

  return { datos, faltantes }
}

// ── Template registry ────────────────────────────────────────────────────────

function getTemplateComponent(
  template: string,
  datos: Record<string, string | null>,
  constantes: Record<string, string>,
  fechaGeneracion: string,
  codigoNegocio: string,
// eslint-disable-next-line @typescript-eslint/no-explicit-any
): React.ReactElement<any> | null {
  switch (template) {
    case 'declaracion-juramentada':
      return createElement(DeclaracionJuramentadaPDF, {
        datos: datos as {
          nombre_solicitante: string | null
          numero_identificacion: string | null
          tipo_vehiculo: string | null
          email: string | null
          telefono: string | null
          municipio: string | null
        },
        fechaGeneracion,
        codigoNegocio,
      })
    case 'relacion-facturas':
      return createElement(RelacionFacturasPDF, {
        datos: datos as {
          numero_factura: string | null
          nit_proveedor: string | null
          nombre_proveedor: string | null
          marca: string | null
          linea: string | null
          tipo_vehiculo: string | null
          valor_unitario_sin_iva: string | null
          valor_iva: string | null
          nombre_solicitante: string | null
          numero_identificacion: string | null
          municipio: string | null
          email: string | null
          telefono: string | null
        },
        fechaGeneracion,
        codigoNegocio,
      })
    default:
      return null
  }
}

// ── Main action ──────────────────────────────────────────────────────────────

export async function generarFormulario(
  negocioBloqueId: string,
  negocioId: string,
): Promise<{
  success: boolean
  drive_url?: string
  campos_usados?: Record<string, string | null>
  faltantes?: string[]
  error?: string
}> {
  const { supabase, workspaceId, error } = await getWorkspace()
  if (error || !workspaceId) return { success: false, error: 'No autenticado' }

  const admin = createServiceClient()

  try {
    // 1. Read bloque config
    const { data: bloqueData } = await db(supabase)
      .from('negocio_bloques')
      .select(`
        data,
        bloque_config_id,
        bloque_configs(config_extra, etapa_id, etapas_negocio(linea_id))
      `)
      .eq('id', negocioBloqueId)
      .single()

    if (!bloqueData) return { success: false, error: 'Bloque no encontrado' }

    const bc = bloqueData.bloque_configs as {
      config_extra: Record<string, unknown>
      etapas_negocio: { linea_id: string }
    }
    const configExtra = bc.config_extra
    const lineaId = bc.etapas_negocio.linea_id

    const template = configExtra.template as string
    const label = (configExtra.label as string) ?? 'Formulario'
    const camposFuente = (configExtra.campos_fuente ?? []) as CampoFuente[]
    const constantes = (configExtra.campos_constantes ?? {}) as Record<string, string>

    if (!template) return { success: false, error: 'Template no configurado' }

    // 2. Resolve source campos
    const { datos, faltantes } = await resolverCamposFuente(
      supabase, negocioId, lineaId, camposFuente,
    )

    if (faltantes.length > 0) {
      return {
        success: false,
        faltantes,
        campos_usados: datos,
        error: `Faltan ${faltantes.length} campos: ${faltantes.join(', ')}`,
      }
    }

    // 3. Get negocio info
    const { data: negocio } = await db(supabase)
      .from('negocios')
      .select('codigo')
      .eq('id', negocioId)
      .single()

    const codigoNegocio = (negocio?.codigo as string) ?? negocioId.slice(0, 8)
    const fechaGeneracion = new Date().toISOString()

    // 4. Render PDF
    let buffer: Buffer
    if (template === 'formulario-010') {
      // Overlay sobre el PDF oficial de la DIAN (no se modifica el fondo).
      const f010Datos = datos as unknown as Formulario010Datos
      const f010Constantes = constantes as unknown as Formulario010Constantes
      const bytes = await generarFormulario010(f010Datos, f010Constantes)
      buffer = Buffer.from(bytes)
    } else {
      const element = getTemplateComponent(template, datos, constantes, fechaGeneracion, codigoNegocio)
      if (!element) return { success: false, error: `Template "${template}" no soportado` }
      const pdfBuffer = await renderToBuffer(element)
      buffer = Buffer.from(pdfBuffer)
    }

    // 5. Upload to Drive
    const { data: workspace } = await db(admin)
      .from('workspaces')
      .select('drive_folder_id')
      .eq('id', workspaceId)
      .single()

    const wsDriveFolderId = workspace?.drive_folder_id as string | null
    let driveUrl: string | null = null

    if (wsDriveFolderId) {
      // Get or create negocio folder
      const negocioFolderId = await createDriveFolder(codigoNegocio, wsDriveFolderId)

      const fileName = `${label}.pdf`
      const result = await uploadFileToDrive(buffer, fileName, 'application/pdf', negocioFolderId)
      await setFilePublicByLink(result.fileId)
      driveUrl = result.webViewLink
    }

    // 6. Save data and mark complete
    const newData = {
      ...((bloqueData.data as Record<string, unknown>) ?? {}),
      drive_url: driveUrl,
      campos_usados: datos,
      template,
      generated_at: fechaGeneracion,
    }

    await db(supabase)
      .from('negocio_bloques')
      .update({
        data: newData,
        estado: 'completo',
        completado_at: fechaGeneracion,
        updated_at: fechaGeneracion,
      })
      .eq('id', negocioBloqueId)

    // 7. Revalidate
    revalidatePath(`/negocios/${negocioId}`)

    return {
      success: true,
      drive_url: driveUrl ?? undefined,
      campos_usados: datos,
    }
  } catch (err) {
    console.error('[formulario-actions] Error:', err)
    return { success: false, error: `Error: ${String(err).slice(0, 200)}` }
  }
}
