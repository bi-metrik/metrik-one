'use server'

// ============================================================
// Server actions del bloque propuesta_economica
// ============================================================
// Bloque generico para clientes Clarity que emiten propuestas con
// descuento variable (caso canonico: SOENA — GIT EV/HEV).
//
// Mecanica:
//  - Inputs: descuento_pct o valor_final_con_iva (auto-sincronizados)
//  - Plan 1 = servicio.precio_estandar * (1 + IVA) — snapshot al crear bloque
//  - Plan 2 = Plan 1 * (1 - descuento_pct/100)
//  - Cap descuento (config_extra.cap_descuento_pct, default 50)
//  - Versionado: cada generacion incrementa version y persiste PDF en Drive
//  - Aprobacion: marca bloque completo + setea negocios.precio_aprobado
// ============================================================

import { getWorkspace } from '@/lib/actions/get-workspace'
import { revalidatePath } from 'next/cache'
import { renderPropuestaEconomica } from '@/lib/pdf/pdf-render-client'
import { createSubfolderPath, uploadFileToDrive } from '@/lib/google-drive'
import { createServiceClient } from '@/lib/supabase/server'

// ── Tipos ────────────────────────────────────────────────────────────────────

export type PropuestaVersion = {
  n: number
  descuento_pct: number
  valor_final: number
  pdf_drive_id: string | null
  pdf_url: string | null
  generated_at: string
  generated_by: string | null
}

export type PropuestaData = {
  precio_base_con_iva: number       // snapshot al crear bloque
  iva_pct: number                   // snapshot (0.19 default)
  descuento_pct: number             // valor actual del input
  valor_final: number               // valor actual del input
  versiones: PropuestaVersion[]
  version_activa: number | null
  aprobado_at: string | null
  aprobado_por: string | null
  aprobado_version: number | null
}

// ── Helpers de calculo ──────────────────────────────────────────────────────

export type CalculoPropuesta = {
  plan1_valor: number       // precio base con IVA
  plan1_anticipo: number    // 50% Plan 1
  plan1_exito_iva: number   // 50% Plan 1
  plan2_valor: number       // Plan 1 * (1 - desc)
  ahorro: number            // Plan 1 - Plan 2
  descuento_pct: number
  valor_final: number       // = plan2_valor
}

// NOTA: no exportada — Next.js exige que TODOS los exports de archivos
// `'use server'` sean async. Como calcularPropuesta es pura (sync), queda
// como helper interno del modulo. Si fuera necesario consumirla externamente,
// moverla a un archivo aparte sin `'use server'`.
function calcularPropuesta(
  precioBaseConIva: number,
  descuentoPct: number,
): CalculoPropuesta {
  const plan1 = Math.round(precioBaseConIva)
  const plan2 = Math.round(plan1 * (1 - descuentoPct / 100))
  return {
    plan1_valor: plan1,
    plan1_anticipo: Math.round(plan1 / 2),
    plan1_exito_iva: Math.round(plan1 / 2),
    plan2_valor: plan2,
    ahorro: plan1 - plan2,
    descuento_pct: descuentoPct,
    valor_final: plan2,
  }
}

function descuentoDesdeValorFinal(precioBaseConIva: number, valorFinal: number): number {
  if (precioBaseConIva <= 0) return 0
  const pct = (1 - valorFinal / precioBaseConIva) * 100
  return Math.round(pct * 100) / 100 // 2 decimales
}

// ── Helpers de formato (para PDF) ───────────────────────────────────────────

function formatCOP(n: number): string {
  return new Intl.NumberFormat('es-CO', {
    style: 'currency',
    currency: 'COP',
    maximumFractionDigits: 0,
  }).format(n)
}

function fechaCorta(d: Date): string {
  const dd = String(d.getDate()).padStart(2, '0')
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  const yyyy = d.getFullYear()
  return `${dd}/${mm}/${yyyy}`
}

function fechaEnLetras(d: Date): string {
  const meses = [
    'enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio',
    'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre',
  ]
  return `${d.getDate()} de ${meses[d.getMonth()]} de ${d.getFullYear()}`
}

// ── Lectura del bloque + servicio asociado ──────────────────────────────────

async function loadBloqueContext(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  workspaceId: string,
  bloqueId: string,
) {
  const { data: bloque, error: errB } = await supabase
    .from('negocio_bloques')
    .select(`
      id, data, estado, negocio_id,
      bloque_config_id,
      bloque_configs (
        config_extra,
        bloque_definitions ( tipo )
      )
    `)
    .eq('id', bloqueId)
    .single()

  if (errB || !bloque) {
    return { error: 'Bloque no encontrado' as const }
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const b = bloque as any
  if (b.bloque_configs?.bloque_definitions?.tipo !== 'propuesta_economica') {
    return { error: 'Bloque no es de tipo propuesta_economica' as const }
  }

  const data = (b.data ?? {}) as Partial<PropuestaData>
  const configExtra = (b.bloque_configs?.config_extra ?? {}) as Record<string, unknown>
  const capDescuento = Number(configExtra.cap_descuento_pct ?? 50)
  // servicio_id puede venir directo o anidado en auto_propuesta (config canonica)
  const autoPropuesta = (configExtra.auto_propuesta ?? null) as { servicio_id?: string } | null
  const servicioId = (configExtra.servicio_id as string | undefined)
    ?? autoPropuesta?.servicio_id
  const templateSlug = (configExtra.template_slug as string) ?? 'soena/propuesta-economica'
  const driveSubfolder = (configExtra.drive_subfolder as string | undefined) ?? null

  // Si data esta vacio o no tiene precio_base, lo derivamos del servicio
  let precioBase = data.precio_base_con_iva ?? 0
  let ivaPct = data.iva_pct ?? 0.19

  if ((!precioBase || precioBase === 0) && servicioId) {
    const { data: servicio } = await supabase
      .from('servicios')
      .select('precio_estandar, tarifa_iva')
      .eq('id', servicioId)
      .single()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const s = servicio as any
    if (s) {
      ivaPct = Number(s.tarifa_iva ?? 0.19)
      precioBase = Math.round(Number(s.precio_estandar ?? 0) * (1 + ivaPct))
    }
  }

  return {
    error: null as null,
    bloque: b,
    workspaceId,
    negocioId: b.negocio_id as string,
    data,
    precioBase,
    ivaPct,
    capDescuento,
    templateSlug,
    driveSubfolder,
  }
}

// ── Action: generar nueva version ───────────────────────────────────────────

export async function generarVersionPropuesta(
  bloqueId: string,
  input: { descuento_pct?: number; valor_final?: number },
): Promise<{ ok: boolean; error?: string; version?: PropuestaVersion; warning?: string }> {
  const { supabase, workspaceId, staffId, error: errWs } = await getWorkspace()
  if (errWs || !workspaceId) return { ok: false, error: 'No autenticado' }

  const ctx = await loadBloqueContext(supabase, workspaceId, bloqueId)
  if (ctx.error) return { ok: false, error: ctx.error }

  if (ctx.bloque.estado === 'completo') {
    return { ok: false, error: 'Bloque aprobado — no se pueden generar nuevas versiones' }
  }
  if (!ctx.precioBase || ctx.precioBase <= 0) {
    return { ok: false, error: 'Precio base no disponible — verifica el servicio asociado' }
  }

  // Resolver inputs
  let descuento_pct: number
  if (input.descuento_pct !== undefined) {
    descuento_pct = Math.round(input.descuento_pct * 100) / 100
  } else if (input.valor_final !== undefined) {
    descuento_pct = descuentoDesdeValorFinal(ctx.precioBase, input.valor_final)
  } else {
    return { ok: false, error: 'Debe enviar descuento_pct o valor_final' }
  }

  if (descuento_pct < 0) {
    return { ok: false, error: 'El descuento no puede ser negativo' }
  }
  if (descuento_pct > ctx.capDescuento) {
    return { ok: false, error: `Descuento máximo permitido: ${ctx.capDescuento}%` }
  }

  const calc = calcularPropuesta(ctx.precioBase, descuento_pct)

  // Datos cliente desde negocio
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: negocio, error: errNeg } = await (supabase as any)
    .from('negocios')
    .select('codigo, carpeta_url, empresas(nombre, numero_documento), contactos(nombre)')
    .eq('id', ctx.negocioId)
    .single()
  if (errNeg) {
    console.error(`[propuesta] error lookup negocio ${ctx.negocioId}:`, errNeg.message)
  }
  const clienteNombre =
    negocio?.empresas?.nombre ?? negocio?.contactos?.nombre ?? 'Cliente'
  const clienteDoc = negocio?.empresas?.numero_documento ?? ''

  // Versionado
  const versionesActuales = (ctx.data.versiones ?? []) as PropuestaVersion[]
  const nuevaN = versionesActuales.length > 0
    ? Math.max(...versionesActuales.map(v => v.n)) + 1
    : 1

  const ahora = new Date()
  const validezDesde = new Date(ahora.getFullYear(), ahora.getMonth(), 1)
  const validezHasta = new Date(ahora.getFullYear(), ahora.getMonth() + 1, 0)

  // Renderizar PDF (graceful: si falla, version queda registrada sin PDF)
  let pdfBuffer: Buffer | null = null
  let renderError: string | null = null
  try {
    pdfBuffer = await renderPropuestaEconomica(ctx.templateSlug, {
      cliente_nombre: clienteNombre,
      cliente_documento: clienteDoc,
      fecha_emision: fechaCorta(ahora),
      validez_desde: fechaEnLetras(validezDesde),
      validez_hasta: fechaEnLetras(validezHasta),
      plan1_valor: formatCOP(calc.plan1_valor),
      plan1_anticipo: formatCOP(calc.plan1_anticipo),
      plan1_exito_iva: formatCOP(calc.plan1_exito_iva),
      plan2_valor: formatCOP(calc.plan2_valor),
      descuento_pct: `${descuento_pct}%`,
      ahorro: formatCOP(calc.ahorro),
      version: nuevaN,
    })
  } catch (e) {
    renderError = e instanceof Error ? e.message : String(e)
    console.warn(`[propuesta] render PDF fallo (continuando sin PDF):`, renderError)
  }

  // Subir a Drive: subcarpeta declarada en config_extra.drive_subfolder
  // (canonico "1. Legal/Propuestas" en SOENA). Si no esta seteada, fallback
  // al path historico para compat.
  let pdfDriveId: string | null = null
  let pdfUrl: string | null = null
  if (pdfBuffer) {
    try {
      if (!negocio?.carpeta_url) {
        console.warn(`[propuesta] negocio ${ctx.negocioId} sin carpeta_url — PDF no se sube a Drive`)
      } else {
        const folderIdMatch = (negocio.carpeta_url as string).match(/folders\/([-\w]+)/)
        const negocioFolderId = folderIdMatch?.[1]
        if (negocioFolderId) {
          const subfolderPath = (ctx.driveSubfolder ?? '1. Legal/Propuestas') as string
          const targetFolderId = await createSubfolderPath(subfolderPath, negocioFolderId, workspaceId)
          const fileName = `Propuesta Economica v${nuevaN} - ${fechaCorta(ahora)}.pdf`
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
      }
    } catch (e) {
      console.error(`[propuesta] error subiendo PDF a Drive:`, e)
    }
  }

  const nuevaVersion: PropuestaVersion = {
    n: nuevaN,
    descuento_pct,
    valor_final: calc.valor_final,
    pdf_drive_id: pdfDriveId,
    pdf_url: pdfUrl,
    generated_at: ahora.toISOString(),
    generated_by: staffId ?? null,
  }

  const nuevoData: PropuestaData = {
    precio_base_con_iva: ctx.precioBase,
    iva_pct: ctx.ivaPct,
    descuento_pct,
    valor_final: calc.valor_final,
    versiones: [...versionesActuales, nuevaVersion],
    version_activa: nuevaN,
    aprobado_at: ctx.data.aprobado_at ?? null,
    aprobado_por: ctx.data.aprobado_por ?? null,
    aprobado_version: ctx.data.aprobado_version ?? null,
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error: errUpd } = await (supabase as any)
    .from('negocio_bloques')
    .update({ data: nuevoData })
    .eq('id', bloqueId)

  if (errUpd) return { ok: false, error: errUpd.message }

  revalidatePath(`/negocios/${ctx.negocioId}`)
  // Si render fallo, devolvemos ok=true pero con warning para que el UI lo muestre
  return {
    ok: true,
    version: nuevaVersion,
    ...(renderError ? { warning: `Versión guardada sin PDF — ${renderError.slice(0, 200)}` } : {}),
  }
}

// ── Action: aprobar version activa ──────────────────────────────────────────

export async function aprobarVersionPropuesta(
  bloqueId: string,
  versionN: number,
): Promise<{ ok: boolean; error?: string }> {
  const { supabase, workspaceId, staffId, error: errWs } = await getWorkspace()
  if (errWs || !workspaceId) return { ok: false, error: 'No autenticado' }

  const ctx = await loadBloqueContext(supabase, workspaceId, bloqueId)
  if (ctx.error) return { ok: false, error: ctx.error }

  const versiones = (ctx.data.versiones ?? []) as PropuestaVersion[]
  const version = versiones.find(v => v.n === versionN)
  if (!version) return { ok: false, error: `Versión ${versionN} no encontrada` }

  const ahora = new Date().toISOString()
  const nuevoData: PropuestaData = {
    precio_base_con_iva: ctx.precioBase,
    iva_pct: ctx.ivaPct,
    descuento_pct: version.descuento_pct,
    valor_final: version.valor_final,
    versiones,
    version_activa: versionN,
    aprobado_at: ahora,
    aprobado_por: staffId ?? null,
    aprobado_version: versionN,
  }

  // Marcar bloque completo + setear precio_aprobado del negocio (en transaccion ligera)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = supabase as any
  const { error: errBlq } = await sb
    .from('negocio_bloques')
    .update({ data: nuevoData, estado: 'completo', completado_at: ahora })
    .eq('id', bloqueId)
  if (errBlq) return { ok: false, error: errBlq.message }

  await sb
    .from('negocios')
    .update({ precio_aprobado: version.valor_final, updated_at: ahora })
    .eq('id', ctx.negocioId)

  // Activity log
  await sb.from('activity_log').insert({
    workspace_id: workspaceId,
    entidad_tipo: 'negocio',
    entidad_id: ctx.negocioId,
    tipo: 'propuesta_aprobada',
    autor_id: staffId,
    contenido: `Propuesta económica v${versionN} aprobada — valor final ${formatCOP(version.valor_final)}`,
  })

  revalidatePath(`/negocios/${ctx.negocioId}`)
  return { ok: true }
}

// ── Action: crear v1 automatica (llamada desde crearNegocio) ────────────────

export async function crearV1Automatica(
  bloqueId: string,
  servicioId: string,
): Promise<{ ok: boolean; error?: string }> {
  // Esta funcion se llama desde crearNegocio con service client
  // (no podemos usar getWorkspace porque la creacion del negocio ya ocurrio
  //  pero el usuario no necesariamente está autenticado en el contexto)
  const sb = createServiceClient()

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: bloque } = await (sb as any)
    .from('negocio_bloques')
    .select(`
      id, data, negocio_id,
      bloque_configs ( config_extra, workspace_id, bloque_definitions(tipo) )
    `)
    .eq('id', bloqueId)
    .single()
  if (!bloque) return { ok: false, error: 'Bloque no encontrado' }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const b = bloque as any
  if (b.bloque_configs?.bloque_definitions?.tipo !== 'propuesta_economica') {
    return { ok: false, error: 'Bloque no es propuesta_economica' }
  }

  const workspaceId = b.bloque_configs.workspace_id as string

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: servicio } = await (sb as any)
    .from('servicios')
    .select('precio_estandar, tarifa_iva')
    .eq('id', servicioId)
    .single()
  if (!servicio) return { ok: false, error: 'Servicio no encontrado' }

  const ivaPct = Number(servicio.tarifa_iva ?? 0.19)
  const precioBase = Math.round(Number(servicio.precio_estandar ?? 0) * (1 + ivaPct))
  const calc = calcularPropuesta(precioBase, 0)

  // Inicializar data con descuento 0 (Plan 1 — tarifa plena), SIN generar PDF
  // (PDF se genera cuando el usuario edite o explicitamente lo pida)
  const dataInicial: PropuestaData = {
    precio_base_con_iva: precioBase,
    iva_pct: ivaPct,
    descuento_pct: 0,
    valor_final: calc.valor_final,
    versiones: [],
    version_activa: null,
    aprobado_at: null,
    aprobado_por: null,
    aprobado_version: null,
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await (sb as any)
    .from('negocio_bloques')
    .update({ data: dataInicial })
    .eq('id', bloqueId)

  console.log(`[propuesta] v1 base inicializada para bloque ${bloqueId} (ws=${workspaceId})`)
  return { ok: true }
}
