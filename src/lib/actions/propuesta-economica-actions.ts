'use server'

// ============================================================
// Server actions del bloque propuesta_economica
// ============================================================
// Bloque generico para clientes Clarity que emiten propuestas con
// descuento variable (caso canonico: SOENA — GIT EV/HEV).
//
// Mecanica:
//  - Tarifa base = servicio.precio_estandar * (1 + IVA) — snapshot al crear bloque
//  - Plan 1 (tarifa plena, pago 50%/50%): valor = base * (1 - descuento_pct_plan1/100)
//  - Plan 2 (pago 100% anticipado): valor = base * (1 - descuento_pct_plan2/100)
//  - Cap descuento (config_extra.cap_descuento_pct, default 50) — aplica
//    individualmente a cada plan (ninguno puede superar el cap sobre la base)
//  - Versionado: cada generacion incrementa version y persiste PDF en Drive
//  - Aprobacion: el operador elige plan (1 o 2) — setea negocios.precio_aprobado
//    con el valor del plan elegido y persiste aprobado_plan
// ============================================================

import { getWorkspace } from '@/lib/actions/get-workspace'
import { getCachedUser } from '@/lib/supabase/auth-user'
import { guardEditarBloque } from '@/lib/permissions/guard-negocio'
import { revalidatePath } from 'next/cache'
import { renderPropuestaEconomica } from '@/lib/pdf/pdf-render-client'
import { createSubfolderPath, uploadFileToDrive } from '@/lib/google-drive'
import { createServiceClient } from '@/lib/supabase/server'

// ── Tipos ────────────────────────────────────────────────────────────────────

export type PropuestaVersion = {
  n: number
  descuento_pct_plan1: number
  descuento_pct_plan2: number
  valor_final_plan1: number
  valor_final_plan2: number
  pdf_drive_id: string | null
  pdf_url: string | null
  generated_at: string
  generated_by: string | null
}

export type PropuestaData = {
  precio_base_con_iva: number       // snapshot al crear bloque
  iva_pct: number                   // snapshot (0.19 default)
  descuento_pct_plan1: number       // valor actual input plan 1
  descuento_pct_plan2: number       // valor actual input plan 2
  valor_final_plan1: number         // valor calculado plan 1
  valor_final_plan2: number         // valor calculado plan 2
  versiones: PropuestaVersion[]
  version_activa: number | null
  aprobado_at: string | null
  aprobado_por: string | null
  aprobado_version: number | null
  aprobado_plan: 1 | 2 | null       // plan elegido al aprobar
}

// ── Helpers de calculo ──────────────────────────────────────────────────────

export type CalculoPropuesta = {
  base: number
  plan1_valor: number       // base * (1 - desc1)
  plan1_anticipo: number    // 50% Plan 1
  plan1_exito_iva: number   // 50% Plan 1
  plan2_valor: number       // base * (1 - desc2)
  ahorro_plan1: number      // base - plan1 (vs tarifa plena)
  ahorro_plan2: number      // base - plan2 (vs tarifa plena)
  descuento_pct_plan1: number
  descuento_pct_plan2: number
}

// NOTA: no exportada — Next.js exige que TODOS los exports de archivos
// `'use server'` sean async. Como calcularPropuesta es pura (sync), queda
// como helper interno del modulo.
function calcularPropuesta(
  precioBaseConIva: number,
  descuentoPctPlan1: number,
  descuentoPctPlan2: number,
): CalculoPropuesta {
  const base = Math.round(precioBaseConIva)
  const plan1 = Math.round(base * (1 - descuentoPctPlan1 / 100))
  const plan2 = Math.round(base * (1 - descuentoPctPlan2 / 100))
  return {
    base,
    plan1_valor: plan1,
    plan1_anticipo: Math.round(plan1 / 2),
    plan1_exito_iva: Math.round(plan1 / 2),
    plan2_valor: plan2,
    ahorro_plan1: base - plan1,
    ahorro_plan2: base - plan2,
    descuento_pct_plan1: descuentoPctPlan1,
    descuento_pct_plan2: descuentoPctPlan2,
  }
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
  // Umbral sobre el cual aprobar requiere rol gerencial. null = sin gate (default).
  const umbralAprobacion = configExtra.umbral_aprobacion_pct != null
    ? Number(configExtra.umbral_aprobacion_pct)
    : null
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
    umbralAprobacion,
    templateSlug,
    driveSubfolder,
  }
}

// ── Action: generar nueva version ───────────────────────────────────────────

export async function generarVersionPropuesta(
  bloqueId: string,
  input: { descuento_pct_plan1: number; descuento_pct_plan2: number },
): Promise<{ ok: boolean; error?: string; version?: PropuestaVersion; warning?: string }> {
  const { supabase, workspaceId, staffId, error: errWs } = await getWorkspace()
  if (errWs || !workspaceId) return { ok: false, error: 'No autenticado' }

  const guard = await guardEditarBloque(bloqueId)
  if (!guard.ok) return { ok: false, error: guard.error ?? 'Sin permiso' }

  const ctx = await loadBloqueContext(supabase, workspaceId, bloqueId)
  if (ctx.error) return { ok: false, error: ctx.error }

  if (ctx.bloque.estado === 'completo') {
    return { ok: false, error: 'Bloque aprobado — no se pueden generar nuevas versiones' }
  }
  if (!ctx.precioBase || ctx.precioBase <= 0) {
    return { ok: false, error: 'Precio base no disponible — verifica el servicio asociado' }
  }

  const desc1 = Math.round((input.descuento_pct_plan1 ?? 0) * 100) / 100
  const desc2 = Math.round((input.descuento_pct_plan2 ?? 0) * 100) / 100

  for (const [label, pct] of [['Plan 1', desc1], ['Plan 2', desc2]] as const) {
    if (pct < 0) return { ok: false, error: `Descuento ${label} no puede ser negativo` }
    if (pct > ctx.capDescuento) {
      return { ok: false, error: `Descuento ${label} excede el cap de ${ctx.capDescuento}%` }
    }
  }

  const calc = calcularPropuesta(ctx.precioBase, desc1, desc2)

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

  // ── Personalización: firma del generador + vehículo (de la Factura) ──────────
  // Generador = usuario que genera esta versión (staff + profiles.avatar_url + email auth).
  // La foto es opcional: si no hay avatar_url, el template deja el espacio en blanco.
  let generadorNombre = ''
  let generadorCargo = ''
  let generadorTel = ''
  let generadorEmail = ''
  let generadorFotoImg = ''
  if (staffId) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: staffRow } = await (supabase as any)
      .from('staff')
      .select('full_name, position, phone_whatsapp, profile_id')
      .eq('id', staffId)
      .single()
    if (staffRow) {
      generadorNombre = staffRow.full_name ?? ''
      generadorCargo = staffRow.position ?? ''
      generadorTel = staffRow.phone_whatsapp ?? ''
      if (staffRow.profile_id) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const { data: prof } = await (supabase as any)
          .from('profiles').select('avatar_url').eq('id', staffRow.profile_id).single()
        const avatarUrl = prof?.avatar_url as string | null | undefined
        if (avatarUrl) generadorFotoImg = `<img src="${avatarUrl}">`
      }
    }
  }
  try {
    const { user } = await getCachedUser()
    generadorEmail = user?.email ?? ''
  } catch { /* email opcional */ }

  // Vehículo = campos extraídos de la Factura (bloque source slug 'factura_venta_vehiculo').
  let vehiculoTipo = ''
  let vehiculoMarca = ''
  let vehiculoLinea = ''
  let vehiculoAnio = ''
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: facturaBloque } = await (supabase as any)
    .from('negocio_bloques')
    .select('data, bloque_configs!inner(slug)')
    .eq('negocio_id', ctx.negocioId)
    .eq('bloque_configs.slug', 'factura_venta_vehiculo')
    .limit(1)
    .maybeSingle()
  {
    const campos = (facturaBloque?.data?.campos ?? {}) as Record<string, { value?: unknown }>
    const val = (slug: string) => String(campos[slug]?.value ?? '').trim()
    vehiculoTipo = val('tipo_vehiculo')
    vehiculoMarca = val('marca')
    vehiculoLinea = val('linea')
    vehiculoAnio = val('modelo')
  }
  // Imagen genérica por tipo (default eléctrico) + label normalizado a "Eléctrico"/"Híbrido"
  // (el valor extraído viene variado: "Híbrido" / "ELECTRICO" / a veces null).
  const tipoLower = vehiculoTipo.toLowerCase()
  const vehiculoImg = /h[íi]brid/.test(tipoLower) ? 'carro-hibrido.jpg' : 'carro-electrico.jpg'
  const vehiculoTipoLabel = /h[íi]brid/.test(tipoLower) ? 'Híbrido'
    : /el[eé]ctric/.test(tipoLower) ? 'Eléctrico'
    : (vehiculoTipo ? vehiculoTipo.charAt(0).toUpperCase() + vehiculoTipo.slice(1).toLowerCase() : '')

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
    // Linea condicional plan 1: solo si tiene descuento > 0
    const plan1DescuentoLinea = desc1 > 0
      ? `<p class="plan-detail">Descuento aplicado: ${desc1}%</p>`
      : ''
    pdfBuffer = await renderPropuestaEconomica(ctx.templateSlug, {
      cliente_nombre: clienteNombre,
      cliente_documento: clienteDoc,
      fecha_emision: fechaCorta(ahora),
      validez_desde: fechaEnLetras(validezDesde),
      validez_hasta: fechaEnLetras(validezHasta),
      base_valor: formatCOP(calc.base),
      plan1_valor: formatCOP(calc.plan1_valor),
      plan1_anticipo: formatCOP(calc.plan1_anticipo),
      plan1_exito_iva: formatCOP(calc.plan1_exito_iva),
      plan1_descuento_pct: `${desc1}%`,
      plan1_descuento_linea: plan1DescuentoLinea,
      plan1_ahorro: formatCOP(calc.ahorro_plan1),
      plan2_valor: formatCOP(calc.plan2_valor),
      plan2_descuento_pct: `${desc2}%`,
      plan2_ahorro: formatCOP(calc.ahorro_plan2),
      version: nuevaN,
      // Personalización (SOENA): firma del generador + vehículo de la factura
      generador_nombre: generadorNombre,
      generador_cargo: generadorCargo,
      generador_tel: generadorTel,
      generador_email: generadorEmail,
      generador_foto_img: generadorFotoImg,
      vehiculo_tipo: vehiculoTipoLabel,
      vehiculo_marca: vehiculoMarca,
      vehiculo_linea: vehiculoLinea,
      vehiculo_anio: vehiculoAnio,
      vehiculo_img: vehiculoImg,
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
    descuento_pct_plan1: desc1,
    descuento_pct_plan2: desc2,
    valor_final_plan1: calc.plan1_valor,
    valor_final_plan2: calc.plan2_valor,
    pdf_drive_id: pdfDriveId,
    pdf_url: pdfUrl,
    generated_at: ahora.toISOString(),
    generated_by: staffId ?? null,
  }

  const nuevoData: PropuestaData = {
    precio_base_con_iva: ctx.precioBase,
    iva_pct: ctx.ivaPct,
    descuento_pct_plan1: desc1,
    descuento_pct_plan2: desc2,
    valor_final_plan1: calc.plan1_valor,
    valor_final_plan2: calc.plan2_valor,
    versiones: [...versionesActuales, nuevaVersion],
    version_activa: nuevaN,
    aprobado_at: ctx.data.aprobado_at ?? null,
    aprobado_por: ctx.data.aprobado_por ?? null,
    aprobado_version: ctx.data.aprobado_version ?? null,
    aprobado_plan: ctx.data.aprobado_plan ?? null,
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
  plan: 1 | 2,
): Promise<{ ok: boolean; error?: string }> {
  const { supabase, workspaceId, staffId, role, error: errWs } = await getWorkspace()
  if (errWs || !workspaceId) return { ok: false, error: 'No autenticado' }

  const guard = await guardEditarBloque(bloqueId)
  if (!guard.ok) return { ok: false, error: guard.error ?? 'Sin permiso' }

  if (plan !== 1 && plan !== 2) {
    return { ok: false, error: 'Plan invalido — debe ser 1 o 2' }
  }

  const ctx = await loadBloqueContext(supabase, workspaceId, bloqueId)
  if (ctx.error) return { ok: false, error: ctx.error }

  const versiones = (ctx.data.versiones ?? []) as PropuestaVersion[]
  const version = versiones.find(v => v.n === versionN)
  if (!version) return { ok: false, error: `Versión ${versionN} no encontrada` }

  const descPlan = plan === 1 ? version.descuento_pct_plan1 : version.descuento_pct_plan2

  // Gate de aprobación: descuentos sobre el umbral requieren rol gerencial.
  const APRUEBAN_DESCUENTO_ALTO = ['owner', 'admin', 'supervisor']
  if (ctx.umbralAprobacion != null && descPlan > ctx.umbralAprobacion
      && !APRUEBAN_DESCUENTO_ALTO.includes(role ?? '')) {
    return {
      ok: false,
      error: `El descuento del Plan ${plan} (${descPlan}%) supera ${ctx.umbralAprobacion}% — requiere aprobación de un supervisor, administrador o dueño.`,
    }
  }

  const valorElegido = plan === 1 ? version.valor_final_plan1 : version.valor_final_plan2

  const ahora = new Date().toISOString()
  const nuevoData: PropuestaData = {
    precio_base_con_iva: ctx.precioBase,
    iva_pct: ctx.ivaPct,
    descuento_pct_plan1: version.descuento_pct_plan1,
    descuento_pct_plan2: version.descuento_pct_plan2,
    valor_final_plan1: version.valor_final_plan1,
    valor_final_plan2: version.valor_final_plan2,
    versiones,
    version_activa: versionN,
    aprobado_at: ahora,
    aprobado_por: staffId ?? null,
    aprobado_version: versionN,
    aprobado_plan: plan,
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
    .update({ precio_aprobado: valorElegido, updated_at: ahora })
    .eq('id', ctx.negocioId)

  // Activity log
  await sb.from('activity_log').insert({
    workspace_id: workspaceId,
    entidad_tipo: 'negocio',
    entidad_id: ctx.negocioId,
    tipo: 'propuesta_aprobada',
    autor_id: staffId,
    contenido: `Propuesta económica v${versionN} aprobada — Plan ${plan} ${formatCOP(valorElegido)}`,
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
  const calc = calcularPropuesta(precioBase, 0, 0)

  // Inicializar data con ambos descuentos en 0, SIN generar PDF
  // (PDF se genera cuando el usuario edite o explicitamente lo pida)
  const dataInicial: PropuestaData = {
    precio_base_con_iva: precioBase,
    iva_pct: ivaPct,
    descuento_pct_plan1: 0,
    descuento_pct_plan2: 0,
    valor_final_plan1: calc.plan1_valor,
    valor_final_plan2: calc.plan2_valor,
    versiones: [],
    version_activa: null,
    aprobado_at: null,
    aprobado_por: null,
    aprobado_version: null,
    aprobado_plan: null,
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await (sb as any)
    .from('negocio_bloques')
    .update({ data: dataInicial })
    .eq('id', bloqueId)

  console.log(`[propuesta] v1 base inicializada para bloque ${bloqueId} (ws=${workspaceId})`)
  return { ok: true }
}
