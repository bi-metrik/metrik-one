'use server'

import { revalidatePath } from 'next/cache'
import { getWorkspace } from '@/lib/actions/get-workspace'
import { guardEditarBloque } from '@/lib/permissions/guard-negocio'
import { createServiceClient } from '@/lib/supabase/server'
import type { SupabaseClient } from '@supabase/supabase-js'
import { uploadFileToDrive, setFilePublicByLink, createSubfolderPath } from '@/lib/google-drive'
import { renderToBuffer } from '@react-pdf/renderer'
import { generarFormulario010, type Formulario010Datos, type Formulario010Constantes } from '@/lib/pdf/formulario-010'
import { generarFormulario1668, type Formulario1668Datos, type Formulario1668Constantes } from '@/lib/pdf/formulario-1668'
import DeclaracionJuramentadaPDF from '@/lib/pdf/declaracion-juramentada-pdf'
import RelacionFacturasPDF from '@/lib/pdf/relacion-facturas-pdf'
import { getCasillasMeta, metaDeCasilla } from '@/lib/pdf/formulario-casillas'
import { calcularDvNit } from '@/lib/dian/nit'
import { resolverCodigosUbicacion } from '@/lib/dian/divipola'
import { resolverSeccionalOficial } from '@/lib/dian/seccionales'
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

// ── Seccional DIAN (010) ──────────────────────────────────────────────────────
function normSeccional(s: string | null | undefined): string {
  return (s ?? '').normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().trim()
}
/** Sugiere la seccional por match LITERAL de la ciudad de la factura; fallback "Otras seccionales". */
function sugerirSeccional(ciudad: string | null, seccionales: string[]): string {
  const c = normSeccional(ciudad)
  if (c) {
    const hit = seccionales.find((s) => normSeccional(s) === c)
    if (hit) return hit
  }
  return seccionales.find((s) => normSeccional(s) === 'otras seccionales') ?? seccionales[seccionales.length - 1] ?? ''
}
/** Lee la ciudad de venta extraída del bloque Factura del vehículo (slug estable). */
async function leerCiudadVentaFactura(supabase: unknown, negocioId: string): Promise<string | null> {
  const { data } = await db(supabase)
    .from('negocio_bloques')
    .select('data, bloque_configs!inner(slug)')
    .eq('negocio_id', negocioId)
    .eq('bloque_configs.slug', 'factura_venta_vehiculo')
    .limit(1)
    .maybeSingle()
  const campos = ((data as { data?: { campos?: Record<string, { value?: string | null }> } } | null)?.data?.campos) ?? {}
  return campos.ciudad_venta?.value ?? null
}

/**
 * Aplica el preset de la seccional DIAN (config_extra.seccionales) sobre datosFinal/
 * constantesFinal del 010. MUTA ambos. Precedencia: override manual > preset > fuente.
 * Fuente única usada por generación y por la capa editable (display ⟺ generación).
 */
async function aplicarSeccionalPreset(
  configExtra: Record<string, unknown>,
  template: string,
  supabase: unknown,
  negocioId: string,
  data: Record<string, unknown>,
  overrides: Record<string, string | null>,
  datosFinal: Record<string, string | null>,
  constantesFinal: Record<string, string>,
): Promise<{ seleccion: string | null; sugerida: boolean; seccionales: string[]; seccionalExtra: Record<string, unknown> }> {
  const seccionalExtra: Record<string, unknown> = {}
  if (template !== 'formulario-010' || !configExtra.seccionales) return { seleccion: null, sugerida: false, seccionales: [], seccionalExtra }
  const seccionales = configExtra.seccionales as Record<string, Record<string, unknown>>
  const keys = Object.keys(seccionales)
  // Seccional a nivel de NEGOCIO: fuente única compartida por las 2 copias del 010
  // (generación y envío). Antes vivía por-bloque en data.seccional y se
  // desincronizaba (una copia quedaba en "Otras" mientras la otra decía "Cali").
  // Precedencia: override manual del campo > seccional del negocio > legacy bloque > sugerida.
  const { data: negRow } = await db(supabase)
    .from('negocios').select('metadata').eq('id', negocioId).maybeSingle()
  const negocioSeccional = (negRow?.metadata as Record<string, unknown> | null)?.seccional
  const explicit =
    (typeof overrides.seccional === 'string' && overrides.seccional) ||
    (typeof negocioSeccional === 'string' && negocioSeccional) ||
    (data?.seccional as string | undefined)
  const seleccion = explicit || sugerirSeccional(await leerCiudadVentaFactura(supabase, negocioId), keys)
  const preset = seccionales[seleccion]
  if (preset) {
    // El preset SOLO sobreescribe una constante cuando trae esa clave explícita.
    // Si la clave NO está en el preset, se conserva el valor GENERAL de
    // `campos_constantes` (antes se forzaba a '' con `?? ''`, borrando el general).
    // Esto permite que una seccional (ej. Cali) herede las constantes generales
    // nuevas quitando esas claves de su preset, y solo aporte sus particularidades.
    if (!('tipo_obligacion' in overrides) && preset.tipo_obligacion != null) constantesFinal.tipo_obligacion = String(preset.tipo_obligacion)
    if (!('concepto_saldo' in overrides) && preset.concepto_saldo != null) constantesFinal.concepto_saldo = String(preset.concepto_saldo)
    if (!('nombre_documento' in overrides) && preset.nombre_documento != null) constantesFinal.nombre_documento = String(preset.nombre_documento)
    // Casilla 12 — nombre oficial + CÓDIGO auto-resueltos del catálogo oficial
    // (SECCIONALES_DIAN, Resolución 000064/2021) a partir del preset. Así el
    // operador NO teclea el código: elige la seccional y el código sale solo.
    // El nombre oficial completo ("Dirección Seccional de Impuestos de Cali")
    // reemplaza el nombre corto del preset ("Cali") — es lo que exige la DIAN.
    // Fallback: si no hay match en el catálogo (ej. "Otras seccionales"), se usa
    // el `direccion_seccional` del preset tal cual y el código queda editable.
    const oficial = resolverSeccionalOficial(String(preset.direccion_seccional ?? seleccion), null)
    if (!('direccion_seccional' in overrides)) {
      datosFinal.direccion_seccional = oficial?.nombre_oficial ?? String(preset.direccion_seccional ?? '')
    }
    if (!('codigo_seccional' in overrides)) {
      datosFinal.codigo_seccional = oficial?.codigo ?? null
    }
    seccionalExtra.seccional_literal = true
    if (preset.razon_social_cali) {
      seccionalExtra.mostrar_razon_social = true
      const nombreCompleto =
        [datosFinal.primer_nombre, datosFinal.otros_nombres, datosFinal.primer_apellido, datosFinal.segundo_apellido]
          .filter(Boolean).join(' ') || datosFinal.razon_social || ''
      if (preset.casilla_1006_nombre_completo) seccionalExtra.organizacion_1006 = nombreCompleto
    }
    if (preset.cod_representacion) seccionalExtra.cod_representacion_1005 = String(preset.cod_representacion)
  }
  return { seleccion, sugerida: !explicit, seccionales: keys, seccionalExtra }
}

/**
 * Aplica los valores DETERMINISTAS que no deben confiarse a la extracción, MUTANDO
 * datosFinal. Respeta cualquier override del operador.
 *  - DV (010/1668): el dígito de verificación es función del nº de identificación
 *    (módulo 11 DIAN). La extracción del RUT lo trae mal a veces (ej. Echeverry:
 *    trajo "1", el real es "0"). Se recalcula siempre desde la cédula base.
 *  - Códigos DANE país/depto/municipio (010): se resuelven por NOMBRE (que se
 *    extrae bien) y no por el código extraído (poco fiable; se vio el código del
 *    departamento "76" copiado en el del municipio).
 */
function aplicarDeterministas(
  template: string,
  datosFinal: Record<string, string | null>,
  overrides: Record<string, string | null>,
): void {
  const usaDv = template === 'formulario-010' || template === 'formulario-1668'
  // Solo un override con VALOR (no vacío) gana; un override "" no debe dejar el DV
  // en blanco, se recalcula. El DV se calcula sobre la cédula base completa (módulo
  // 11); no se usa separarNitDv aquí a propósito: la identificación del solicitante
  // es una cédula limpia (sin DV pegado), separarla podría cortar un dígito real.
  const dvOverride = overrides.dv
  const dvManual = 'dv' in overrides && dvOverride != null && dvOverride.trim() !== ''
  if (usaDv && !dvManual) {
    const base = datosFinal.nit ?? datosFinal.numero_identificacion ?? null
    const dvCalc = calcularDvNit(base)
    if (dvCalc != null) datosFinal.dv = dvCalc
  }
  if (template === 'formulario-010') {
    const codes = resolverCodigosUbicacion(
      datosFinal.pais, datosFinal.departamento, datosFinal.municipio,
      {
        codigo_pais: datosFinal.codigo_pais ?? null,
        codigo_departamento: datosFinal.codigo_departamento ?? null,
        codigo_municipio: datosFinal.codigo_municipio ?? null,
      },
    )
    if (!('codigo_pais' in overrides)) datosFinal.codigo_pais = codes.codigo_pais
    if (!('codigo_departamento' in overrides)) datosFinal.codigo_departamento = codes.codigo_departamento
    if (!('codigo_municipio' in overrides)) datosFinal.codigo_municipio = codes.codigo_municipio
  }
}

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

type GenerarFormularioResult = {
  success: boolean
  drive_url?: string
  campos_usados?: Record<string, string | null>
  faltantes?: string[]
  version_n?: number
  error?: string
}

export async function generarFormulario(
  negocioBloqueId: string,
  negocioId: string,
): Promise<GenerarFormularioResult> {
  const { supabase, workspaceId, userId, error } = await getWorkspace()
  if (error || !workspaceId) return { success: false, error: 'No autenticado' }

  const guard = await guardEditarBloque(negocioBloqueId)
  if (!guard.ok) return { success: false, error: guard.error ?? 'Sin permiso' }

  return generarFormularioCore(
    supabase as unknown as SupabaseClient,
    workspaceId,
    userId ?? null,
    negocioBloqueId,
    negocioId,
  )
}

/**
 * Núcleo de generación SIN auth. Lo invocan el server action `generarFormulario`
 * (tras getWorkspace + guardEditarBloque) y los scripts de cargue masivo (con
 * service client). Misma lógica de producción: resuelve casillas, arma el PDF con
 * el template oficial, lo sube a la carpeta canónica del negocio en Drive y deja
 * una versión en `formulario_versiones`. → una sola vía de generación, sin drift.
 */
export async function generarFormularioCore(
  supabase: SupabaseClient,
  workspaceId: string,
  userId: string | null,
  negocioBloqueId: string,
  negocioId: string,
): Promise<GenerarFormularioResult> {
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

    // ── Seccional DIAN (010): preset config-driven vía helper compartido con la
    //    capa editable (display ⟺ generación). Override manual > preset > fuente.
    const { seccionalExtra } = await aplicarSeccionalPreset(
      configExtra, template, supabase, negocioId,
      (bloqueData.data as Record<string, unknown>) ?? {}, overrides, datosFinal, constantesFinal,
    )

    // Valores deterministas (DV módulo 11 + códigos DANE por nombre), respetando overrides.
    aplicarDeterministas(template, datosFinal, overrides)

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
      const f010Constantes = { ...constantesFinal, ...seccionalExtra } as unknown as Formulario010Constantes
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
        datos_snapshot: { ...datosFinal, ...constantesFinal, ...seccionalExtra },
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

    // 8. Revalidate (no-op fuera de un request: scripts de cargue masivo)
    try { revalidatePath(`/negocios/${negocioId}`) } catch { /* sin request context */ }

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
  /** Seccionales disponibles (010). Vacío si el bloque no usa seccionales. */
  seccionales?: string[]
  /** Seccional vigente (seleccionada o sugerida). */
  seccional?: string | null
  /** true si es sugerida (no confirmada por el operador). */
  seccional_sugerida?: boolean
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

  // Seccional (010): aplicar el preset (mismo helper que la generación) para que las
  // casillas mostradas reflejen lo que se generará. Vuelca al valorBase.
  const datosEd: Record<string, string | null> = { ...datos }
  const constantesEd: Record<string, string> = { ...constantes }
  for (const [k, v] of Object.entries(overrides)) { if (k in constantesEd) constantesEd[k] = (v ?? '') as string; else datosEd[k] = v }
  const secc = await aplicarSeccionalPreset(
    configExtra, template, supabase, negocioId,
    (bloqueData.data as Record<string, unknown>) ?? {}, overrides, datosEd, constantesEd,
  )
  if (secc.seleccion) {
    valorBase.tipo_obligacion = constantesEd.tipo_obligacion ?? valorBase.tipo_obligacion
    valorBase.concepto_saldo = constantesEd.concepto_saldo ?? valorBase.concepto_saldo
    valorBase.nombre_documento = constantesEd.nombre_documento ?? valorBase.nombre_documento
    valorBase.direccion_seccional = (datosEd.direccion_seccional ?? valorBase.direccion_seccional) as string
    // Código de la seccional (casilla 12 "Cód.") — autocompletado desde el catálogo
    // oficial al elegir la seccional; se muestra en la UI para revisión/edición.
    valorBase.codigo_seccional = (datosEd.codigo_seccional ?? valorBase.codigo_seccional ?? '') as string
  }

  // Deterministas (DV recalculado + códigos DANE) para que la UI muestre lo que se
  // generará (misma lógica que la generación real).
  aplicarDeterministas(template, datosEd, overrides)
  valorBase.dv = datosEd.dv ?? valorBase.dv
  valorBase.codigo_pais = datosEd.codigo_pais ?? valorBase.codigo_pais
  valorBase.codigo_departamento = datosEd.codigo_departamento ?? valorBase.codigo_departamento
  valorBase.codigo_municipio = datosEd.codigo_municipio ?? valorBase.codigo_municipio

  // Mostrar TODAS las casillas del template (no solo las autollenadas): las
  // casillas vacías del 010/1668 deben verse para poder llenarlas a mano cuando
  // la DIAN lo solicite. Une las casillas del meta del template con las que ya
  // tienen valor base (campos_fuente + constantes), ordenadas por el meta.
  const meta = getCasillasMeta(template)
  const ordenMeta = new Map(meta.map((m, i) => [m.slug, i]))
  const slugs = Array.from(
    new Set([...meta.map((m) => m.slug), ...Object.keys(valorBase)]),
  ).sort((a, b) => (ordenMeta.get(a) ?? 999) - (ordenMeta.get(b) ?? 999))

  const casillas: CasillaEditable[] = slugs.map((slug) => {
    const m = metaDeCasilla(template, slug)
    const rawOverride = overrides[slug]
    // Un override vacío de 'dv' NO se muestra en blanco: el DV es determinista y la
    // generación lo recalcula, así que la UI debe reflejar el calculado (evita el
    // drift display⟺generación). Mismo criterio que aplicarDeterministas.
    const editado = Object.prototype.hasOwnProperty.call(overrides, slug)
      && !(slug === 'dv' && (rawOverride ?? '').trim() === '')
    const value = editado ? (rawOverride ?? '') : (valorBase[slug] ?? '')
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

  return {
    casillas, versiones,
    seccionales: secc.seccionales.length ? secc.seccionales : undefined,
    seccional: secc.seleccion,
    seccional_sugerida: secc.sugerida,
  }
}

/** Persiste la seccional seleccionada por el operador en data.seccional (010). */
export async function guardarSeccional(
  negocioBloqueId: string,
  seccional: string,
): Promise<{ error: string | null }> {
  const { supabase, error } = await getWorkspace()
  if (error) return { error: 'No autenticado' }
  const guard = await guardEditarBloque(negocioBloqueId)
  if (!guard.ok) return { error: guard.error ?? 'Sin permiso' }
  const { data: row } = await db(supabase).from('negocio_bloques').select('data, negocio_id').eq('id', negocioBloqueId).single()
  const current = (row?.data as Record<string, unknown>) ?? {}
  const { error: upErr } = await db(supabase)
    .from('negocio_bloques')
    .update({ data: { ...current, seccional }, updated_at: new Date().toISOString() })
    .eq('id', negocioBloqueId)
  if (upErr) return { error: (upErr as { message: string }).message }
  const nid = row?.negocio_id as string | undefined
  // Persistir la seccional a nivel de NEGOCIO (fuente única): así una sola
  // selección aplica a las 2 copias del 010 (generación y envío) y no vuelve a
  // desincronizarse. El data.seccional del bloque queda como eco inmediato para la UI.
  if (nid) {
    const { data: neg } = await db(supabase).from('negocios').select('metadata').eq('id', nid).maybeSingle()
    const meta = (neg?.metadata as Record<string, unknown>) ?? {}
    await db(supabase).from('negocios').update({ metadata: { ...meta, seccional } }).eq('id', nid)
    revalidatePath(`/negocios/${nid}`)
  }
  return { error: null }
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
