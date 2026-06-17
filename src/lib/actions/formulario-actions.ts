'use server'

import { revalidatePath } from 'next/cache'
import { getWorkspace } from '@/lib/actions/get-workspace'
import { guardEditarBloque } from '@/lib/permissions/guard-negocio'
import { createServiceClient } from '@/lib/supabase/server'
import { uploadFileToDrive, setFilePublicByLink, createSubfolderPath } from '@/lib/google-drive'
import { renderToBuffer } from '@react-pdf/renderer'
import { generarFormulario010, type Formulario010Datos, type Formulario010Constantes } from '@/lib/pdf/formulario-010'
import { generarFormulario1668, type Formulario1668Datos, type Formulario1668Constantes } from '@/lib/pdf/formulario-1668'
import DeclaracionJuramentadaPDF from '@/lib/pdf/declaracion-juramentada-pdf'
import RelacionFacturasPDF from '@/lib/pdf/relacion-facturas-pdf'
import { getCasillasMeta, metaDeCasilla } from '@/lib/pdf/formulario-casillas'
import { createElement } from 'react'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function db(client: unknown): any { return client }

// ── Types ────────────────────────────────────────────────────────────────────

interface FuenteCampo {
  // Referencia ESTABLE al bloque fuente por slug. Prioritaria sobre el par
  // (etapa_orden, bloque_orden), que se rompe al reordenar etapas/bloques y queda
  // como fallback legacy. Ver docs/specs/2026-05-26_block-references-by-slug.md
  bloque_slug?: string
  etapa_orden: number
  bloque_orden: number
  campo_slug?: string // un campo
  campos_slug?: string[] // varios campos concatenados (ej. marca + línea/modelo del certificado)
  join?: string // separador para campos_slug (default " ")
  tipo: string // 'ai' | 'field'
}

interface CampoFuente {
  slug: string
  // Si `optional`, no se reporta como faltante cuando no hay valor (queda null y
  // la casilla del overlay se dibuja vacía). Ej.: fecha de expedición del 1668,
  // que el banco puede completar a mano.
  optional?: boolean
  source: FuenteCampo
  // Fuentes alternativas: se prueban en orden si la principal no da valor. Útil
  // cuando el dato vive en un bloque condicional (ej. el valor del IVA sale del
  // Contrato de leasing si existe, y si no, de la Factura).
  source_alternatives?: FuenteCampo[]
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
        slug,
        config_extra,
        etapa_id,
        etapas_negocio!inner(orden, linea_id)
      )
    `)
    .eq('negocio_id', negocioId)

  if (!bloques || bloques.length === 0) {
    return { datos: {}, faltantes: camposFuente.map(c => c.slug) }
  }

  // Dos índices: por (etapaOrden:bloqueOrden) legacy y por slug estable.
  const lookup = new Map<string, { data: Record<string, unknown> }>()
  const lookupPorSlug = new Map<string, { data: Record<string, unknown> }>()
  for (const b of bloques) {
    const bc = b.bloque_configs as {
      orden: number
      slug: string | null
      config_extra: Record<string, unknown>
      etapas_negocio: { orden: number; linea_id: string }
    }
    if (bc.etapas_negocio.linea_id !== lineaId) continue
    const entry = { data: (b.data as Record<string, unknown>) ?? {} }
    lookup.set(`${bc.etapas_negocio.orden}:${bc.orden}`, entry)
    if (bc.slug) lookupPorSlug.set(bc.slug, entry)
  }

  // Resuelve el valor de UNA fuente (bloque + campo, o varios concatenados).
  // Vía preferida: slug estable. Fallback legacy: (etapa_orden:bloque_orden).
  const resolverUna = (src: FuenteCampo): string | null => {
    const bloque =
      (src.bloque_slug ? lookupPorSlug.get(src.bloque_slug) : undefined) ??
      lookup.get(`${src.etapa_orden}:${src.bloque_orden}`)
    if (!bloque) return null
    const readOne = (slug: string): string | null => {
      if (src.tipo === 'ai') {
        const campos = bloque.data.campos as Record<string, { value: string | null; confidence: number }> | undefined
        const cd = campos?.[slug]
        return (cd?.value && cd.confidence >= 0.70) ? cd.value : null
      }
      const raw = bloque.data[slug]
      return (raw !== null && raw !== undefined && raw !== '') ? String(raw) : null
    }
    if (src.campos_slug && src.campos_slug.length > 0) {
      const parts = src.campos_slug.map(readOne).filter((v): v is string => !!v)
      return parts.length > 0 ? parts.join(src.join ?? ' ') : null
    }
    return src.campo_slug ? readOne(src.campo_slug) : null
  }

  const datos: Record<string, string | null> = {}
  const faltantes: string[] = []

  for (const campo of camposFuente) {
    // Probar la fuente principal y luego las alternativas; usar la primera con valor.
    let value: string | null = null
    for (const src of [campo.source, ...(campo.source_alternatives ?? [])]) {
      value = resolverUna(src)
      if (value) break
    }
    datos[campo.slug] = value
    if (!value && !campo.optional) faltantes.push(campo.slug)
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
  version_n?: number
  error?: string
}> {
  const { supabase, workspaceId, userId, error } = await getWorkspace()
  if (error || !workspaceId) return { success: false, error: 'No autenticado' }

  const guard = await guardEditarBloque(negocioBloqueId)
  if (!guard.ok) return { success: false, error: guard.error ?? 'Sin permiso' }

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

    // Capa editable: el operador puede sobreescribir/llenar cualquier casilla desde
    // la plataforma (data.campos_override). Los overrides tienen prioridad sobre el
    // autollenado y sobre las constantes, y pueden SATISFACER un faltante.
    const overrides = ((bloqueData.data as Record<string, unknown>)?.campos_override ?? {}) as Record<string, string | null>
    const datosFinal: Record<string, string | null> = { ...datos }
    const constantesFinal: Record<string, string> = { ...constantes }
    for (const [k, v] of Object.entries(overrides)) {
      if (k in constantesFinal) constantesFinal[k] = (v ?? '') as string
      else datosFinal[k] = v
    }
    const tieneValor = (v: string | null | undefined) => v !== null && v !== undefined && v !== ''
    const faltantesReales = faltantes.filter((f) => !tieneValor(overrides[f]) && !tieneValor(datosFinal[f]))

    if (faltantesReales.length > 0) {
      return {
        success: false,
        faltantes: faltantesReales,
        campos_usados: datosFinal,
        error: `Faltan ${faltantesReales.length} campos: ${faltantesReales.join(', ')}`,
      }
    }

    // 3. Get negocio info
    const { data: negocio } = await db(supabase)
      .from('negocios')
      .select('codigo, carpeta_url')
      .eq('id', negocioId)
      .single()

    const codigoNegocio = (negocio?.codigo as string) ?? negocioId.slice(0, 8)
    const fechaGeneracion = new Date().toISOString()

    // 4. Render PDF
    let buffer: Buffer
    if (template === 'formulario-010') {
      // Overlay sobre el PDF oficial de la DIAN (no se modifica el fondo).
      const f010Datos = datosFinal as unknown as Formulario010Datos
      const f010Constantes = constantesFinal as unknown as Formulario010Constantes
      const bytes = await generarFormulario010(f010Datos, f010Constantes)
      buffer = Buffer.from(bytes)
    } else if (template === 'formulario-1668') {
      // Overlay sobre el PDF oficial DIAN 1668 (Constancia de Titularidad de
      // Cuenta Bancaria). Mismo patrón que el 010.
      const f1668Datos = datosFinal as unknown as Formulario1668Datos
      const f1668Constantes = constantesFinal as unknown as Formulario1668Constantes
      const bytes = await generarFormulario1668(f1668Datos, f1668Constantes)
      buffer = Buffer.from(bytes)
    } else {
      const element = getTemplateComponent(template, datosFinal, constantesFinal, fechaGeneracion, codigoNegocio)
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
    // Carpeta CANONICA del negocio desde carpeta_url (igual que propuesta y
    // documentos). Antes se re-creaba por `codigo` a secas bajo el root → carpeta
    // huerfana distinta a la del resto de archivos del negocio.
    const negocioFolderId = ((negocio?.carpeta_url as string | null)?.match(/folders\/([-\w]+)/)?.[1]) ?? null
    let driveUrl: string | null = null

    if (wsDriveFolderId && negocioFolderId) {
      // Resolver subfolder canonico (config_extra.drive_subfolder, ej. "4. DIAN/Formularios")
      const subfolderPath = (configExtra.drive_subfolder as string | undefined) ?? null
      const targetFolderId = await createSubfolderPath(subfolderPath, negocioFolderId, workspaceId)

      const fileName = `${label}.pdf`
      const result = await uploadFileToDrive(buffer, fileName, 'application/pdf', targetFolderId, workspaceId)
      await setFilePublicByLink(result.fileId, workspaceId)
      driveUrl = result.webViewLink
    }

    // 6. Versionado: cada generación deja una versión con snapshot + fecha + autor.
    const { data: ultimaVer } = await db(supabase)
      .from('formulario_versiones')
      .select('version_n')
      .eq('negocio_bloque_id', negocioBloqueId)
      .order('version_n', { ascending: false })
      .limit(1)
      .maybeSingle()
    const versionN = ((ultimaVer?.version_n as number | undefined) ?? 0) + 1

    await db(supabase)
      .from('formulario_versiones')
      .insert({
        workspace_id: workspaceId,
        negocio_bloque_id: negocioBloqueId,
        version_n: versionN,
        drive_url: driveUrl,
        datos_snapshot: { ...datosFinal, ...constantesFinal },
        generated_by: userId ?? null,
        generated_at: fechaGeneracion,
      })

    // 7. Save data and mark complete (conserva campos_override; usa los valores finales)
    const newData = {
      ...((bloqueData.data as Record<string, unknown>) ?? {}),
      drive_url: driveUrl,
      campos_usados: datosFinal,
      template,
      generated_at: fechaGeneracion,
      version_actual: versionN,
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

    // 8. Revalidate
    revalidatePath(`/negocios/${negocioId}`)

    return {
      success: true,
      drive_url: driveUrl ?? undefined,
      campos_usados: datosFinal,
      version_n: versionN,
    }
  } catch (err) {
    console.error('[formulario-actions] Error:', err)
    return { success: false, error: `Error: ${String(err).slice(0, 200)}` }
  }
}

// ── Capa editable de casillas ────────────────────────────────────────────────

export interface CasillaEditable {
  slug: string
  label: string
  grupo: string
  casilla?: string
  value: string
  es_constante: boolean
  faltante: boolean
  editado: boolean
}

export interface FormularioVersionItem {
  version_n: number
  drive_url: string | null
  generated_at: string
  autor: string | null
}

/**
 * Resuelve TODAS las casillas de un formulario (autollenado desde campos_fuente +
 * constantes), aplicando los overrides ya editados, para que el bloque las muestre
 * editables ANTES de generar el PDF. Devuelve también el historial de versiones.
 */
export async function resolverFormularioParaEdicion(
  negocioBloqueId: string,
  negocioId: string,
): Promise<{
  casillas: CasillaEditable[]
  versiones: FormularioVersionItem[]
  error?: string
}> {
  const { supabase, workspaceId, error } = await getWorkspace()
  if (error || !workspaceId) return { casillas: [], versiones: [], error: 'No autenticado' }

  const { data: bloqueData } = await db(supabase)
    .from('negocio_bloques')
    .select('data, bloque_configs(config_extra, etapas_negocio(linea_id))')
    .eq('id', negocioBloqueId)
    .single()
  if (!bloqueData) return { casillas: [], versiones: [], error: 'Bloque no encontrado' }

  const bc = bloqueData.bloque_configs as {
    config_extra: Record<string, unknown>
    etapas_negocio: { linea_id: string }
  }
  const configExtra = bc.config_extra
  const template = (configExtra.template as string) ?? ''
  const camposFuente = (configExtra.campos_fuente ?? []) as CampoFuente[]
  const constantes = (configExtra.campos_constantes ?? {}) as Record<string, string>
  const overrides = ((bloqueData.data as Record<string, unknown>)?.campos_override ?? {}) as Record<string, string | null>

  const { datos, faltantes } = await resolverCamposFuente(
    supabase, negocioId, bc.etapas_negocio.linea_id, camposFuente,
  )

  // Valor base por casilla: campos_fuente (autollenado) + constantes.
  const valorBase: Record<string, string> = {}
  const esConstante: Record<string, boolean> = {}
  for (const c of camposFuente) { valorBase[c.slug] = datos[c.slug] ?? ''; esConstante[c.slug] = false }
  for (const [k, v] of Object.entries(constantes)) { valorBase[k] = v ?? ''; esConstante[k] = true }

  // Ordenar por el orden del mapa de metadata (lo no mapeado va al final).
  const meta = getCasillasMeta(template)
  const ordenMeta = new Map(meta.map((m, i) => [m.slug, i]))
  const slugs = Object.keys(valorBase).sort(
    (a, b) => (ordenMeta.get(a) ?? 999) - (ordenMeta.get(b) ?? 999),
  )

  const casillas: CasillaEditable[] = slugs.map((slug) => {
    const m = metaDeCasilla(template, slug)
    const editado = Object.prototype.hasOwnProperty.call(overrides, slug)
    const value = editado ? (overrides[slug] ?? '') : valorBase[slug]
    return {
      slug,
      label: m.label,
      grupo: m.grupo,
      casilla: m.casilla,
      value,
      es_constante: esConstante[slug],
      faltante: !esConstante[slug] && !value && faltantes.includes(slug),
      editado,
    }
  })

  // Historial de versiones + nombres de autor (consulta separada de profiles para
  // no depender de embeds frágiles).
  const { data: vers } = await db(supabase)
    .from('formulario_versiones')
    .select('version_n, drive_url, generated_at, generated_by')
    .eq('negocio_bloque_id', negocioBloqueId)
    .order('version_n', { ascending: false })
  const verRows = (vers ?? []) as Array<{ version_n: number; drive_url: string | null; generated_at: string; generated_by: string | null }>
  const autorIds = [...new Set(verRows.map((v) => v.generated_by).filter(Boolean))] as string[]
  const nombrePorId: Record<string, string> = {}
  if (autorIds.length > 0) {
    const { data: profs } = await db(supabase).from('profiles').select('id, full_name').in('id', autorIds)
    for (const p of ((profs ?? []) as Array<{ id: string; full_name: string | null }>)) {
      nombrePorId[p.id] = p.full_name ?? '—'
    }
  }
  const versiones: FormularioVersionItem[] = verRows.map((v) => ({
    version_n: v.version_n,
    drive_url: v.drive_url,
    generated_at: v.generated_at,
    autor: v.generated_by ? (nombrePorId[v.generated_by] ?? null) : null,
  }))

  return { casillas, versiones }
}

/** Guarda los valores editados de las casillas (solo lo sobreescrito). */
export async function guardarFormularioOverrides(
  negocioBloqueId: string,
  overrides: Record<string, string | null>,
): Promise<{ error: string | null }> {
  const { supabase, error } = await getWorkspace()
  if (error) return { error: 'No autenticado' }

  const guard = await guardEditarBloque(negocioBloqueId)
  if (!guard.ok) return { error: guard.error ?? 'Sin permiso' }

  const { data: row } = await db(supabase)
    .from('negocio_bloques')
    .select('data, negocio_id')
    .eq('id', negocioBloqueId)
    .single()
  const current = (row?.data as Record<string, unknown>) ?? {}
  const newData = { ...current, campos_override: overrides }

  const { error: upErr } = await db(supabase)
    .from('negocio_bloques')
    .update({ data: newData, updated_at: new Date().toISOString() })
    .eq('id', negocioBloqueId)
  if (upErr) return { error: (upErr as { message: string }).message }

  const nid = row?.negocio_id as string | undefined
  if (nid) revalidatePath(`/negocios/${nid}`)
  return { error: null }
}
