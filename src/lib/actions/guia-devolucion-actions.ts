'use server'

// ============================================================
// Server actions del bloque guia_devolucion
// ============================================================
// Genera la Guia de Devolucion de IVA DIAN personalizada con datos del
// negocio (nombre/razon social + NIT del RUT, ciudad de la factura, fecha
// de cita si la seccional la requiere). Versiona PDFs en Drive del negocio.
// ============================================================

import { getWorkspace } from '@/lib/actions/get-workspace'
import { guardEditarBloque } from '@/lib/permissions/guard-negocio'
import { revalidatePath } from 'next/cache'
import { renderGuiaDevolucion } from '@/lib/pdf/pdf-render-client'
import { createSubfolderPath, uploadFileToDrive } from '@/lib/google-drive'
import {
  seccionalDesdeRut,
  getSeccionalBySlug,
  type SeccionalDIAN,
} from '@/lib/dian/seccionales'
import type { GuiaVersion, GuiaData, GenerarGuiaInput } from './guia-devolucion-types'
import { fechaHoraEnLetras } from '@/lib/negocios/fecha-hora-campo'

// ── Helpers ──────────────────────────────────────────────────────────────────

const MESES_ES = [
  'enero','febrero','marzo','abril','mayo','junio',
  'julio','agosto','septiembre','octubre','noviembre','diciembre',
]

// La cita puede venir con hora ('2026-09-26T09:30') o heredada sin ella
// ('2026-09-26'). `fechaHoraEnLetras` cubre los dos casos; concatenar 'T00:00:00'
// como antes rompía el valor con hora y dejaba la Guía sin fecha de cita.
const fechaEnLetras = (iso: string | null): string => fechaHoraEnLetras(iso)

function fechaGeneracion(d: Date): string {
  return `Generada el ${d.getDate()} de ${MESES_ES[d.getMonth()]} de ${d.getFullYear()}`
}

// ── Acciones ─────────────────────────────────────────────────────────────────

export async function generarVersionGuia(
  input: GenerarGuiaInput,
): Promise<{ ok: true; warning?: string } | { ok: false; error: string }> {
  const { supabase, workspaceId, staffId, error } = await getWorkspace()
  if (error || !workspaceId) return { ok: false, error: 'No autenticado' }

  const guard = await guardEditarBloque(input.bloqueId)
  if (!guard.ok) return { ok: false, error: guard.error ?? 'Sin permiso' }

  // 1. Cargar bloque + config + negocio
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: bloqueRaw } = await (supabase as any)
    .from('negocio_bloques')
    .select(`
      id, negocio_id, data,
      bloque_configs!inner(config_extra)
    `)
    .eq('id', input.bloqueId)
    .single()

  if (!bloqueRaw) return { ok: false, error: 'Bloque no encontrado' }

  const negocioId = bloqueRaw.negocio_id as string
  const data = ((bloqueRaw.data ?? {}) as GuiaData) ?? { versiones: [] }
  const configExtra = ((bloqueRaw.bloque_configs as { config_extra?: Record<string, unknown> }).config_extra ?? {})
  const templateSlug = (configExtra.template_slug as string) ?? 'soena/guia-devolucion'

  // 2. Resolver datos del RUT, Factura y Fecha cita por IDENTIDAD DE BLOQUE.
  // Vía preferida: slug ESTABLE del bloque (robusto a renames — "Factura de venta"
  // → "Factura Venta Vehículo" no rompe). Fallback: nombre normalizado, para líneas
  // aún no migradas. Se ignoran heredados readonly (config_extra.source_etapa_orden),
  // que no persisten campos propios, para leer siempre del bloque origen.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: bloquesNeg } = await (supabase as any)
    .from('negocio_bloques')
    .select('data, bloque_configs!inner(nombre, slug, config_extra)')
    .eq('negocio_id', negocioId)

  let razonSocial = ''
  let nit = ''
  let dv = ''
  let tipoPersona = ''
  let fechaCitaIso: string | null = null

  // Identifica cada bloque fuente por slug (preferido) o nombre (fallback legacy).
  const esRut = (slug: string, nombre: string) => slug === 'rut' || nombre === 'rut'
  const esFechaCita = (slug: string, nombre: string) =>
    slug === 'fecha_cita_dian' || nombre === 'fecha cita dian'

  for (const bn of ((bloquesNeg ?? []) as Record<string, unknown>[])) {
    const cfg = bn.bloque_configs as { nombre?: string; slug?: string | null; config_extra?: Record<string, unknown> | null }
    // Saltar heredados readonly (sin campos propios persistidos)
    if ((cfg?.config_extra as { source_etapa_orden?: unknown } | null)?.source_etapa_orden !== undefined) continue
    const nombre = (cfg?.nombre ?? '').toLowerCase().trim()
    const slug = (cfg?.slug ?? '').trim()
    const bnData = (bn.data ?? {}) as Record<string, unknown>
    if (esRut(slug, nombre)) {
      const campos = (bnData.campos ?? {}) as Record<string, { value?: unknown }>
      razonSocial = String(campos.razon_social?.value ?? '')
      nit = String(campos.nit?.value ?? '')
      dv = String(campos.dv?.value ?? '')
      tipoPersona = String(campos.tipo_persona?.value ?? '')
    } else if (esFechaCita(slug, nombre)) {
      // El bloque de fecha existe en DOS etapas: agendamiento directo (la registra
      // operaciones) y confirmación por PQR (la registra el comercial con la fecha
      // que el cliente eligió). Solo una de las dos trae valor según la vía, así que
      // se conserva la primera con dato y no se sobrescribe con la instancia vacía.
      fechaCitaIso = fechaCitaIso ?? ((bnData.fecha_cita_dian as string | null) || null)
    }
  }

  // 3. Resolver seccional. Precedencia:
  //   override manual (en la Guía)  >  seccional del negocio (negocios.metadata.seccional)
  //
  // ⚠️ NO cae a la ciudad de la factura. La seccional es la del SOLICITANTE (la que
  // vive en el RUT y quedó canonizada en `metadata.seccional`), no la de la ciudad
  // donde compró el vehículo: son distintas cada vez que compra fuera de su ciudad, y
  // ahí la Guía mandaba al cliente a una seccional mientras el 010 llevaba la otra.
  // Sin seccional se PIDE, que es honesto; adivinarla con la ciudad acertaba a veces y
  // el resto mandaba al cliente a hacer una fila a la ciudad equivocada.
  // El selector del bloque ofrece las 35, así que siempre hay salida.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: negRow } = await (supabase as any)
    .from('negocios').select('metadata').eq('id', negocioId).maybeSingle()
  const seccional010Label = (negRow?.metadata as Record<string, unknown> | null)?.seccional as string | undefined

  let seccional: SeccionalDIAN | null = null
  if (input.seccional_slug_override) {
    seccional = getSeccionalBySlug(input.seccional_slug_override)
  }
  if (!seccional && seccional010Label) {
    seccional = seccionalDesdeRut(seccional010Label, tipoPersona)
  }
  if (!seccional) {
    return {
      ok: false,
      error:
        'Este negocio todavía no tiene seccional DIAN registrada. Selecciónala en el ' +
        'campo "Seccional DIAN" de este bloque y vuelve a generar.',
    }
  }

  // 4. Validar datos minimos
  if (!razonSocial || !nit) {
    return { ok: false, error: 'Falta nombre/razón social o NIT extraído del RUT (DC5).' }
  }
  if (seccional.cita && !fechaCitaIso) {
    return {
      ok: false,
      error: `La seccional ${seccional.label} requiere cita previa. Llena el bloque "Fecha cita DIAN" antes de generar.`,
    }
  }

  // 5. Construir payload
  const nitFmt = dv ? `${nit}-${dv}` : nit
  const ahora = new Date()
  const versionesActuales = (data.versiones ?? []) as GuiaVersion[]
  const nuevaN = versionesActuales.length > 0
    ? Math.max(...versionesActuales.map(v => v.n)) + 1
    : 1

  const numRadicar = seccional.cita ? '3' : '2'
  const numSeguimiento = seccional.cita ? '4' : '3'
  const numRespuesta = seccional.cita ? '5' : '4'
  const tituloRadicar = seccional.cita
    ? 'Envía los documentos el día y hora de tu cita por correo electrónico'
    : 'Envía los documentos al buzón de tu Dirección Seccional'
  const descRadicar = seccional.cita
    ? 'En la fecha y hora exacta de tu cita, envía el correo al buzón de tu seccional con todos los documentos en PDF.'
    : 'Sin necesidad de cita, envía el correo al buzón de tu seccional con todos los documentos adjuntos en PDF.'

  // 6. Render PDF
  let pdfBuffer: Buffer | null = null
  let renderError: string | null = null
  try {
    pdfBuffer = await renderGuiaDevolucion(templateSlug, {
      body_class: seccional.cita ? 'con-cita' : 'sin-cita',
      ciudad_label: seccional.label,
      ciudad_email: seccional.email,
      nombre: razonSocial,
      nit: nitFmt,
      fecha_cita_humano: fechaEnLetras(fechaCitaIso),
      num_paso_radicar: numRadicar,
      num_paso_seguimiento: numSeguimiento,
      num_paso_respuesta: numRespuesta,
      titulo_radicar: tituloRadicar,
      desc_radicar: descRadicar,
      fecha_envio_label: seccional.cita ? '[día y hora exacta de tu cita]' : '[fecha del envío]',
      fecha_generacion: fechaGeneracion(ahora),
      version: nuevaN,
    })
  } catch (e) {
    renderError = e instanceof Error ? e.message : String(e)
    console.warn(`[guia-devolucion] render PDF fallo:`, renderError)
  }

  // 7. Subir a Drive
  let pdfDriveId: string | null = null
  let pdfUrl: string | null = null
  if (pdfBuffer) {
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data: negocio } = await (supabase as any)
        .from('negocios')
        .select('codigo, carpeta_url')
        .eq('id', negocioId)
        .single()

      const folderIdMatch = (negocio?.carpeta_url as string | null)?.match(/folders\/([-\w]+)/)
      const negocioFolderId = folderIdMatch?.[1]
      if (negocioFolderId) {
        // Subfolder canónico (config_extra.drive_subfolder en SOENA: "4. DIAN/Guía Devolución")
        const subfolderPath = (configExtra.drive_subfolder as string | undefined) ?? '4. DIAN/Guía Devolución'
        const targetFolderId = await createSubfolderPath(subfolderPath, negocioFolderId, workspaceId)
        const fileName = `Guia Devolucion v${nuevaN} - ${seccional.label}.pdf`
        const up = await uploadFileToDrive(
          pdfBuffer,
          fileName,
          'application/pdf',
          targetFolderId,
          workspaceId,
        )
        pdfDriveId = up.fileId
        pdfUrl = up.webViewLink
      }
    } catch (e) {
      console.error(`[guia-devolucion] error subiendo PDF a Drive:`, e)
    }
  }

  // 8. Persistir version
  const nuevaVersion: GuiaVersion = {
    n: nuevaN,
    seccional_slug: seccional.slug,
    seccional_label: seccional.label,
    fecha_cita: fechaCitaIso,
    pdf_drive_id: pdfDriveId,
    pdf_url: pdfUrl,
    generated_at: ahora.toISOString(),
    generated_by: staffId ?? null,
  }

  const nuevoData: GuiaData = {
    versiones: [...versionesActuales, nuevaVersion],
    version_activa: nuevaN,
    aprobado_at: data.aprobado_at ?? null,
    aprobado_por: data.aprobado_por ?? null,
    aprobado_version: data.aprobado_version ?? null,
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error: errUpd } = await (supabase as any)
    .from('negocio_bloques')
    .update({ data: nuevoData })
    .eq('id', input.bloqueId)

  if (errUpd) return { ok: false, error: errUpd.message }

  revalidatePath(`/negocios/${negocioId}`)

  if (renderError) {
    return { ok: true, warning: `Versión guardada sin PDF: ${renderError}` }
  }
  return { ok: true }
}

export async function aprobarVersionGuia(
  bloqueId: string,
  n: number,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const { supabase, userId, staffId, error } = await getWorkspace()
  if (error) return { ok: false, error: 'No autenticado' }

  const guard = await guardEditarBloque(bloqueId)
  if (!guard.ok) return { ok: false, error: guard.error ?? 'Sin permiso' }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: bloque } = await (supabase as any)
    .from('negocio_bloques')
    .select('data, negocio_id')
    .eq('id', bloqueId)
    .single()
  if (!bloque) return { ok: false, error: 'Bloque no encontrado' }

  const data = (bloque.data ?? {}) as GuiaData
  const version = (data.versiones ?? []).find(v => v.n === n)
  if (!version) return { ok: false, error: `Versión v${n} no existe` }

  const now = new Date().toISOString()
  const nuevoData: GuiaData = {
    ...data,
    version_activa: n,
    aprobado_at: now,
    aprobado_por: staffId ?? null,
    aprobado_version: n,
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error: errUpd } = await (supabase as any)
    .from('negocio_bloques')
    .update({
      data: nuevoData,
      estado: 'completo',
      completado_at: now,
      // FK → profiles(id): debe ser profile.id (userId), no staff.id.
      completado_por: userId ?? null,
    })
    .eq('id', bloqueId)

  if (errUpd) return { ok: false, error: errUpd.message }

  revalidatePath(`/negocios/${bloque.negocio_id}`)
  return { ok: true }
}
