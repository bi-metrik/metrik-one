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
import { clausulasAHtml, normalizarTerminos } from '@/lib/propuesta/terminos'
import { createSubfolderPath, uploadFileToDrive } from '@/lib/google-drive'
import { createServiceClient } from '@/lib/supabase/server'
import { calcularTarifaUpmeDetalle, type TarifaUpmeDetalle } from '@/lib/upme/tarifa'
import { tarifaConfirmadaPorNegocio, niegaCertificacionUpme, type FilaBloqueTarifa } from '@/lib/upme/modelo-dinero'
import { fuenteDeLaTarifa, faltaConfirmarTarifa } from '@/lib/upme/tarifa-propuesta'
import { descuentoImplicito, motivoDescuentoRechazado } from '@/lib/propuesta/gate-descuento'
import {
  bloqueTieneRespuesta,
  faltanRequisitos,
  nombresDeRequisitos,
  type RequisitoBloque,
} from '@/lib/negocios/requisitos-bloque'
import { uvtDelAnio } from '@/lib/upme/uvt'
import { registrarActividad } from '@/lib/activity/registrar-actividad'

// ── Tipos ────────────────────────────────────────────────────────────────────

export type PropuestaVersion = {
  n: number
  descuento_pct_plan1: number
  descuento_pct_plan2: number
  valor_final_plan1: number       // HONORARIO plan 1
  valor_final_plan2: number       // HONORARIO plan 2
  tarifa_upme?: number            // tarifa (pasante) vigente al generar la versión
  /**
   * Servicio contratado con el que se EMITIÓ esta versión (`completo`, `solo_upme`,
   * `solo_iva`). No es contexto: el documento promete alcance distinto según el
   * servicio y cobra o no la tarifa UPME por él, así que forma parte de lo que se le
   * mandó al cliente. `null` en versiones anteriores a 2026-09-01.
   */
  servicio?: string | null
  pdf_drive_id: string | null
  pdf_url: string | null
  generated_at: string
  generated_by: string | null  /** Version de los terminos vigentes al generar este PDF. `null` = los del render.
   *  Sin esto, una propuesta firmada no se puede rastrear al texto que la regia. */
  terminos_version: number | null
}

export type PropuestaData = {
  precio_base_con_iva: number       // snapshot al crear bloque (HONORARIO base con IVA)
  iva_pct: number                   // snapshot (0.19 default)
  descuento_pct_plan1: number       // valor actual input plan 1
  descuento_pct_plan2: number       // valor actual input plan 2
  valor_final_plan1: number         // valor calculado plan 1 (HONORARIO)
  valor_final_plan2: number         // valor calculado plan 2 (HONORARIO)
  // ── Tarifa UPME (pasante) ──────────────────────────────────────────────────
  // OPT-IN SOENA. Se auto-calcula desde el valor del vehículo sin IVA (Factura)
  // y el UVT del año. INFORMATIVA y editable — NUNCA gate ni bloqueo (el valor
  // final lo tiene la plataforma UPME). Snapshot de auditoría en tarifa_upme_detalle.
  // Ausente/0 en workspaces sin tarifa → composición de precio = solo honorario
  // (comportamiento previo intacto).
  tarifa_upme?: number
  tarifa_upme_editada?: boolean     // true si el operador la sobrescribió a mano
  tarifa_upme_detalle?: TarifaUpmeDetalle | null  // snapshot del cálculo (auditoría)
  versiones: PropuestaVersion[]
  version_activa: number | null
  aprobado_at: string | null
  aprobado_por: string | null
  aprobado_version: number | null
  aprobado_plan: 1 | 2 | null       // plan elegido al aprobar (1 = 50/50, 2 = único)
  // Desglose congelado al aprobar: honorario del plan elegido + tarifa (pasante).
  //
  // ⚠️ `precio_aprobado` del negocio = SOLO `aprobado_honorario`. La tarifa NO se le
  // suma: es plata de terceros y `precio_aprobado` es la señal de ingreso de todo el
  // sistema (ver la regla cardinal en `lib/upme/modelo-dinero.ts`). Lo que el cliente
  // paga es `valorARecaudar()` = honorario + tarifa confirmada, derivado y no
  // almacenado.
  //
  // `aprobado_tarifa_upme` quedó como registro histórico del diseño "Ola 2"
  // (reemplazado el 2026-07-16): la tarifa vigente se CONFIRMA en Validación y vive
  // en el bloque de confirmación, no aquí. Que valga 0 es lo esperado, NO un dato
  // faltante — el comentario anterior decía lo contrario e indujo un diagnóstico
  // errado el 2026-08-03 que estuvo a punto de sumarle la tarifa al precio (habría
  // inflado ingresos, margen y EBITDA).
  aprobado_honorario?: number | null
  aprobado_tarifa_upme?: number | null
  /**
   * Servicio congelado al aprobar, al lado de `aprobado_plan`.
   *
   * ⚠️ `servicio_contratado` sigue siendo editable después de que la propuesta se
   * aprueba. Sin este snapshot, cambiarlo deja el PDF firmado y el precio sin
   * respaldo de QUÉ se contrató, y nadie se entera: el bloque de la propuesta no
   * guardaba el dato en ninguna parte (medido el 2026-09-01, `aprobado_servicio` no
   * existía en el código y ninguna versión lo registraba).
   *
   * Que difiera de `servicio_contratado` NO es un error a corregir en silencio: es la
   * señal de que la propuesta se emitió prometiendo una cosa y hoy el caso declara
   * otra. Se muestra, y re-congelarlo es una corrección deliberada.
   */
  aprobado_servicio?: string | null
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

// Descuento mostrado (PDF): redondeado a 2 decimales. El descuento ALMACENADO
// conserva precisión completa para que el precio quede exacto (el precio manda).
function pctMostrado(n: number): number {
  return Math.round(n * 100) / 100
}

// ── Lectura del bloque + servicio asociado ──────────────────────────────────

/**
 * Resuelve un `negocioBloqueId` a la fila ORIGEN cuando lo que se abrió es una copia
 * readonly heredada (`config_extra.readonly=true` + `source_bloque_slug`).
 *
 * La propuesta económica vive nativamente en una etapa (Propuesta) y aparece heredada
 * de solo lectura en las siguientes (Negociación, Documentación…) — cada una con su
 * propia fila en `negocio_bloques`, poblada una única vez por copia al crearse (ver
 * `cambiarEtapaNegocio`), nunca vuelta a sincronizar. Todo el resto del producto (las
 * demás copias readonly, los gates de saldo, `anticipoCubiertoPorSaldo`) lee el estado
 * vigente de la propuesta por el SLUG del bloque origen (`propuestaDataPorSlug` en
 * `getNegocioDetalle`), no por la fila que el usuario tenga abierta.
 *
 * Sin esto, generar/aprobar/revertir desde la copia (que es justo donde el equipo
 * renegocia — ver `revertirAprobacionPropuesta`) escribe en una fila que nadie más lee:
 * el resto del sistema sigue viendo el estado viejo del origen, y la fila corregida en
 * la copia se pierde en el próximo re-render (que la vuelve a pisar con el dato del
 * origen). Resolver siempre al origen mantiene una sola fuente de verdad.
 */
async function resolverOrigenPropuesta(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  bloqueId: string,
): Promise<string> {
  const { data: actual } = await supabase
    .from('negocio_bloques')
    .select('negocio_id, bloque_configs!inner(config_extra)')
    .eq('id', bloqueId)
    .maybeSingle()
  if (!actual) return bloqueId

  const cfg = (actual as Record<string, unknown>).bloque_configs as Record<string, unknown> | null
  const ce = (cfg?.config_extra ?? {}) as Record<string, unknown>
  if (ce.readonly !== true) return bloqueId

  const srcSlug = ce.source_bloque_slug as string | undefined
  if (!srcSlug) return bloqueId

  const { data: origen } = await supabase
    .from('negocio_bloques')
    .select('id, bloque_configs!inner(slug)')
    .eq('negocio_id', (actual as { negocio_id: string }).negocio_id)
    .eq('bloque_configs.slug', srcSlug)
    .maybeSingle()

  return (origen as { id?: string } | null)?.id ?? bloqueId
}

async function loadBloqueContext(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  workspaceId: string,
  bloqueIdAbierto: string,
) {
  // El permiso ya se validó (guardEditarBloque) contra el bloque que el usuario tiene
  // ABIERTO — la etapa donde está trabajando. A partir de aquí, toda lectura/escritura
  // va contra el origen: es la misma fila que ven las demás copias y el resto del motor.
  const bloqueId = await resolverOrigenPropuesta(supabase, bloqueIdAbierto)

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

  // Terminos y condiciones editables por el cliente desde /mi-negocio. Se arman
  // AQUI, escapados: el servicio de render hace reemplazo literal de cadenas y no
  // tiene como defenderse de marcado roto. Si la linea no los ha configurado, no
  // se manda nada y el render cae a su listado por defecto — nunca sale una
  // propuesta sin terminos.
  const terminosCfg = normalizarTerminos(configExtra.propuesta)
  const terminosHtml = terminosCfg ? clausulasAHtml(terminosCfg.clausulas) : null
  const cierreTexto = terminosCfg?.cierre || null
  const terminosVersion = terminosCfg?.version ?? null

  // ── Tarifa UPME (pasante) ─────────────────────────────────────────────────
  // ⚠️ La FUENTE DE VERDAD es la tarifa CONFIRMADA en Validación, la misma que el
  // resto del sistema le cobra al cliente vía `valorARecaudar`. Antes esto solo se
  // auto-calculaba desde la Factura cuando `config_extra.tarifa_upme.enabled` estaba
  // activo, y en SOENA esa clave NUNCA se activó: medido el 2026-08-12, las 103
  // instancias de propuesta con el campo lo tenían en **cero**, sin excepción. El PDF
  // no salía incompleto, salía AFIRMANDO "Tarifa UPME $0" y un total que no es lo que
  // se le cobra. Una propuesta que miente sobre el precio es peor que una sin la línea.
  //
  // La decisión NO se reimplementa aquí: se reusa `tarifaConfirmadaPorNegocio`, el
  // mismo helper puro que usan el panel de conciliación y la cola de facturación. De
  // ahí sale gratis la regla de que un negocio que no contrató la certificación UPME
  // no lleva tarifa.
  const tarifaCfg = (configExtra.tarifa_upme ?? null) as
    | { enabled?: boolean; factura_slug?: string; valor_field?: string; anio?: number }
    | null
  const tarifaEnabled = tarifaCfg?.enabled === true
  const facturaSlug = tarifaCfg?.factura_slug ?? 'factura_venta_vehiculo'
  const valorField = tarifaCfg?.valor_field ?? 'valor_unitario_sin_iva'
  const tarifaAnio = tarifaCfg?.anio  // undefined → uvtDelAnio cae al año más reciente

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

  // Resolver la tarifa UPME. Precedencia:
  //   1) la CONFIRMADA en Validación → manda siempre, es la que se cobra
  //   2) editada a mano en la propuesta (`tarifa_upme_editada`) → vía legacy, 0 usos hoy
  //   3) config legacy `tarifa_upme.enabled` → auto-calcular desde la Factura
  //   4) si no → 0, y el PDF OMITE la línea en vez de pintarla en cero
  //
  // La confirmada gana sobre la edición manual a propósito: si difieren, el PDF diría
  // una cifra y la cartera cobraría otra, que es exactamente el defecto que esto cierra.
  let tarifaUpme = 0
  let tarifaDetalle: TarifaUpmeDetalle | null = null
  const tarifaEditada = data.tarifa_upme_editada === true

  // Bloques que deben estar respondidos ANTES de emitir. Se declaran en la config del
  // bloque de propuesta (`requiere_bloques`), el mismo vocabulario que ya usan los
  // formularios; aquí el caso es "Servicio contratado", que decide si la tarifa UPME
  // entra al documento y bajo qué cláusulas de alcance.
  const requiereBloques = (configExtra.requiere_bloques ?? []) as RequisitoBloque[]

  const [confRes, certRes, reqRes] = await Promise.all([
    supabase
      .from('negocio_bloques')
      .select('negocio_id, data, bloque_configs!inner(config_extra)')
      .eq('negocio_id', b.negocio_id)
      .eq('bloque_configs.config_extra->tarifa_confirmacion->>enabled', 'true'),
    supabase
      .from('negocio_bloques')
      .select('negocio_id, data, bloque_configs!inner(slug)')
      .eq('negocio_id', b.negocio_id)
      .eq('bloque_configs.slug', 'servicio_contratado'),
    requiereBloques.length > 0
      ? supabase
          .from('negocio_bloques')
          .select('data, bloque_configs!inner(slug)')
          .eq('negocio_id', b.negocio_id)
          .in('bloque_configs.slug', requiereBloques.map(r => r.slug))
      : Promise.resolve({ data: [] as unknown[] }),
  ])

  // Un slug puede traer varias filas (las copias readonly heredadas viajan con el
  // negocio entre etapas): gana la que tenga respuesta, no la primera que llegue.
  const presentes = new Map<string, Record<string, unknown> | null>()
  for (const fila of ((reqRes.data ?? []) as Array<{
    data: Record<string, unknown> | null
    bloque_configs: { slug: string } | null
  }>)) {
    const slug = fila.bloque_configs?.slug
    if (!slug) continue
    const previo = presentes.get(slug)
    if (previo && bloqueTieneRespuesta(previo)) continue
    presentes.set(slug, fila.data)
  }
  const requisitosFaltantes = faltanRequisitos(requiereBloques, presentes)
  const tarifaConfirmada = tarifaConfirmadaPorNegocio(
    (confRes.data ?? []) as FilaBloqueTarifa[],
    (certRes.data ?? []) as FilaBloqueTarifa[],
  ).get(b.negocio_id as string) ?? 0

  // ⚠️ Una tarifa en 0 tiene DOS causas que no son lo mismo: que todavía no se haya
  // confirmado en Validación, o que este servicio no la lleve. Al primero hay que
  // frenarlo; al segundo hay que emitirle su propuesta, sin línea de tarifa. Antes no
  // había que distinguirlas porque `servicio_contratado` vivía DESPUÉS de esta etapa y
  // siempre llegaba vacío; al subirlo a Propuesta, un "solo IVA" da 0 legítimamente.
  // La fuente es `servicio_contratado`, no el campo derivado, y la regla se reusa —
  // `niegaCertificacionUpme` es la misma que aplican la conciliación y la facturación.
  const servicioNiegaTarifa = ((certRes.data ?? []) as FilaBloqueTarifa[]).some(f =>
    niegaCertificacionUpme(f.data),
  )

  // El servicio en sí, no solo su efecto sobre la tarifa. La consulta ya está hecha
  // arriba; lo único que faltaba era exponerlo para poder congelarlo al aprobar.
  // Un negocio puede traer varias filas del bloque (las copias readonly heredadas
  // viajan con él entre etapas): gana la que tenga respuesta, no la primera que llegue.
  const servicioContratado = ((certRes.data ?? []) as FilaBloqueTarifa[])
    .map(f => (f.data as Record<string, unknown> | null)?.servicio)
    .find(v => typeof v === 'string' && v !== '') as string | undefined ?? null

  const fuenteTarifa = fuenteDeLaTarifa({
    confirmada: tarifaConfirmada,
    editadaAMano: tarifaEditada && typeof data.tarifa_upme === 'number' ? data.tarifa_upme : null,
    autoCalculoHabilitado: tarifaEnabled,
  })

  if (fuenteTarifa === 'confirmada') {
    tarifaUpme = tarifaConfirmada
  } else if (fuenteTarifa === 'editada') {
    tarifaUpme = data.tarifa_upme as number
  } else if (fuenteTarifa === 'auto') {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: facturaBloque } = await (supabase as any)
      .from('negocio_bloques')
      .select('data, bloque_configs!inner(slug)')
      .eq('negocio_id', b.negocio_id)
      .eq('bloque_configs.slug', facturaSlug)
      .limit(1)
      .maybeSingle()
    const campos = (facturaBloque?.data?.campos ?? {}) as Record<string, { value?: unknown }>
    const raw = campos[valorField]?.value
    const valorSinIva = parsearNumeroCop(raw)
    if (valorSinIva != null && valorSinIva > 0) {
      // Cálculo INFORMATIVO. Nunca lanza; nunca bloquea.
      tarifaDetalle = calcularTarifaUpmeDetalle(valorSinIva, uvtDelAnio(tarifaAnio))
      tarifaUpme = tarifaDetalle.tarifaCop
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
    terminosHtml,
    cierreTexto,
    terminosVersion,
    tarifaEnabled,
    tarifaEditada,
    tarifaUpme,
    tarifaDetalle,
    /** true si la tarifa salió de la confirmación de Validación (la que se cobra). */
    tarifaVieneDeConfirmacion: tarifaConfirmada > 0,
    /**
     * true si este negocio opera bajo el modelo de tarifa (existe el bloque de
     * confirmación). Un workspace sin ese bloque no cambia en nada: su propuesta
     * nunca habló de tarifa y se sigue generando igual.
     */
    usaModeloTarifa: (confRes.data ?? []).length > 0,
    /**
     * true si el SERVICIO contratado declara que este caso no lleva tarifa UPME
     * (hoy: `solo_iva`). Su tarifa en 0 es correcta, no un dato faltante.
     */
    servicioNiegaTarifa,
    /** Servicio contratado declarado hoy (`completo` | `solo_upme` | `solo_iva`). */
    servicioContratado,
    /** Bloques declarados en `requiere_bloques` que aún no tienen respuesta. */
    requisitosFaltantes,
  }
}

/** Parsea un valor COP que puede venir número o string ("$ 120.000.000"). */
function parsearNumeroCop(raw: unknown): number | null {
  if (raw === null || raw === undefined || raw === '') return null
  if (typeof raw === 'number') return Number.isFinite(raw) ? raw : null
  const limpio = String(raw).replace(/[^\d.-]/g, '').replace(/\.(?=\d{3}(\D|$))/g, '')
  const n = Number(limpio)
  return Number.isFinite(n) ? n : null
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
  // ⚠️ Sin saber QUÉ contrató el cliente no se emite. El documento no solo imprime un
  // precio: decide con el servicio si la línea de tarifa UPME entra y qué alcance
  // promete. Mientras `servicio_contratado` vivió en Negociación —una etapa DESPUÉS de
  // esta— la consulta volvía siempre vacía y toda propuesta salía asumiendo el paquete
  // completo, así que a un cliente de solo IVA se le cobraba la tarifa igual.
  if (ctx.requisitosFaltantes.length > 0) {
    return {
      ok: false,
      error: `Falta declarar antes: ${nombresDeRequisitos(ctx.requisitosFaltantes)}. La propuesta cobra y promete distinto según lo que el cliente haya contratado.`,
    }
  }

  // ⚠️ Sin tarifa NO se genera, y no es una decisión de formato: el documento habla de
  // la tarifa en CINCO puntos más allá del cuadro de precio, incluidos los términos
  // legales (mandato de recaudo, desistimiento). Una propuesta que en la letra dice
  // que el cliente paga la tarifa UPME pero no dice cuánto es peor que no emitirla.
  // Solo aplica a negocios que operan bajo el modelo de tarifa: un workspace sin el
  // bloque de confirmación nunca habló de tarifa y no cambia en nada.
  //
  // ⚠️ Y tampoco aplica cuando el SERVICIO declara que este caso no lleva tarifa
  // (`solo_iva`): ahí el 0 es la respuesta correcta, no un dato que falte. Frenarlo
  // con "falta confirmar la tarifa" sería mandar a corregir algo que ya está bien.
  if (faltaConfirmarTarifa({
    usaModeloTarifa: ctx.usaModeloTarifa,
    servicioNiegaTarifa: ctx.servicioNiegaTarifa,
    tarifaUpme: ctx.tarifaUpme,
  })) {
    return {
      ok: false,
      error: 'Falta confirmar la tarifa UPME en Validación. La propuesta la cobra en sus términos, así que no puede emitirse sin ese valor.',
    }
  }

  // Se conserva precisión (hasta 6 decimales, solo para matar ruido de float):
  // así el precio final tecleado por el equipo queda EXACTO al peso. El % se
  // redondea a 2 decimales únicamente al mostrarlo (PDF / UI).
  const desc1 = Math.round((input.descuento_pct_plan1 ?? 0) * 1e6) / 1e6
  const desc2 = Math.round((input.descuento_pct_plan2 ?? 0) * 1e6) / 1e6

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
      ? `<p class="plan-detail">Descuento aplicado: ${pctMostrado(desc1)}%</p>`
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
      plan1_descuento_pct: `${pctMostrado(desc1)}%`,
      plan1_descuento_linea: plan1DescuentoLinea,
      plan1_ahorro: formatCOP(calc.ahorro_plan1),
      plan2_valor: formatCOP(calc.plan2_valor),
      plan2_descuento_pct: `${pctMostrado(desc2)}%`,
      plan2_ahorro: formatCOP(calc.ahorro_plan2),
      // Tarifa UPME (pasante) + total a pagar por plan = honorario + tarifa.
      tarifa_upme: formatCOP(ctx.tarifaUpme),
      tarifa_upme_valor: ctx.tarifaUpme,
      plan1_total_con_tarifa: formatCOP(calc.plan1_valor + ctx.tarifaUpme),
      plan2_total_con_tarifa: formatCOP(calc.plan2_valor + ctx.tarifaUpme),
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
      // Solo se mandan si la linea los configuro; `undefined` deja que el
      // servicio use su texto por defecto en vez de imprimir un hueco.
      ...(ctx.terminosHtml ? { terminos_html: ctx.terminosHtml } : {}),
      ...(ctx.cierreTexto ? { cierre_texto: ctx.cierreTexto } : {}),
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
    tarifa_upme: ctx.tarifaUpme,
    servicio: ctx.servicioContratado,
    pdf_drive_id: pdfDriveId,
    pdf_url: pdfUrl,
    generated_at: ahora.toISOString(),
    generated_by: staffId ?? null,
    terminos_version: ctx.terminosVersion,
  }

  const nuevoData: PropuestaData = {
    precio_base_con_iva: ctx.precioBase,
    iva_pct: ctx.ivaPct,
    descuento_pct_plan1: desc1,
    descuento_pct_plan2: desc2,
    valor_final_plan1: calc.plan1_valor,
    valor_final_plan2: calc.plan2_valor,
    tarifa_upme: ctx.tarifaUpme,
    tarifa_upme_editada: ctx.tarifaEditada,
    tarifa_upme_detalle: ctx.tarifaDetalle,
    versiones: [...versionesActuales, nuevaVersion],
    version_activa: nuevaN,
    aprobado_at: ctx.data.aprobado_at ?? null,
    aprobado_por: ctx.data.aprobado_por ?? null,
    aprobado_version: ctx.data.aprobado_version ?? null,
    aprobado_plan: ctx.data.aprobado_plan ?? null,
    aprobado_honorario: ctx.data.aprobado_honorario ?? null,
    aprobado_tarifa_upme: ctx.data.aprobado_tarifa_upme ?? null,
    aprobado_servicio: ctx.data.aprobado_servicio ?? null,
  }

  // Escribe siempre en la fila ORIGEN (`ctx.bloque.id`), nunca en `bloqueId` tal cual
  // llegó: si se abrió desde una copia readonly heredada (Negociación...), `bloqueId`
  // es esa copia, y `loadBloqueContext` ya la resolvió al origen en `ctx`.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error: errUpd } = await (supabase as any)
    .from('negocio_bloques')
    .update({ data: nuevoData })
    .eq('id', ctx.bloque.id)

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

  // Gate de aprobación: descuentos sobre el umbral requieren rol gerencial. La regla
  // vive en `gate-descuento` porque `corregirAprobacion` fija el mismo honorario por
  // otra puerta y tiene que exigir exactamente lo mismo — dos copias se desincronizan.
  const rechazo = motivoDescuentoRechazado({
    descuentoPct: descPlan,
    cap: ctx.capDescuento,
    umbral: ctx.umbralAprobacion,
    role,
    etiqueta: `El Plan ${plan}`,
  })
  if (rechazo) return { ok: false, error: rechazo }

  // Honorario del plan elegido (los planes 50/50 vs único aplican al HONORARIO).
  const honorarioElegido = plan === 1 ? version.valor_final_plan1 : version.valor_final_plan2
  // Tarifa (pasante) congelada al aprobar: la de la versión (snapshot) con fallback
  // a la vigente en ctx (compat con versiones viejas sin tarifa persistida).
  const tarifaElegida = version.tarifa_upme ?? ctx.tarifaUpme ?? 0
  // Servicio congelado al aprobar: el de la versión (lo que el PDF prometió) con
  // fallback al vigente, para las versiones anteriores a que se persistiera.
  const servicioElegido = version.servicio ?? ctx.servicioContratado ?? null
  // precio_aprobado = HONORARIO (ingreso). La tarifa UPME (pasante) NO entra al
  // precio del negocio: se confirma aparte en Validación y solo compone el
  // valor_a_recaudar (honorario + tarifa) aguas abajo. Rediseño 2026-07-16 (GO Vera),
  // reemplaza la composición "Ola 2" precio = honorario + tarifa.
  const valorElegido = honorarioElegido

  const ahora = new Date().toISOString()
  const nuevoData: PropuestaData = {
    precio_base_con_iva: ctx.precioBase,
    iva_pct: ctx.ivaPct,
    descuento_pct_plan1: version.descuento_pct_plan1,
    descuento_pct_plan2: version.descuento_pct_plan2,
    valor_final_plan1: version.valor_final_plan1,
    valor_final_plan2: version.valor_final_plan2,
    tarifa_upme: tarifaElegida,
    tarifa_upme_editada: ctx.tarifaEditada,
    tarifa_upme_detalle: ctx.tarifaDetalle,
    versiones,
    version_activa: versionN,
    aprobado_at: ahora,
    aprobado_por: staffId ?? null,
    aprobado_version: versionN,
    aprobado_plan: plan,
    aprobado_honorario: honorarioElegido,
    aprobado_tarifa_upme: tarifaElegida,
    aprobado_servicio: servicioElegido,
  }

  // Marcar bloque completo + setear precio_aprobado del negocio (en transaccion ligera)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = supabase as any
  const { error: errBlq } = await sb
    .from('negocio_bloques')
    .update({ data: nuevoData, estado: 'completo', completado_at: ahora })
    .eq('id', ctx.bloque.id)
  if (errBlq) return { ok: false, error: errBlq.message }

  await sb
    .from('negocios')
    .update({ precio_aprobado: valorElegido, updated_at: ahora })
    .eq('id', ctx.negocioId)

  // Activity log — desglosa honorario + tarifa cuando hay tarifa (pasante).
  const contenidoLog = tarifaElegida > 0
    ? `Propuesta económica v${versionN} aprobada — Plan ${plan}: honorario ${formatCOP(honorarioElegido)} (precio) + tarifa UPME ref. ${formatCOP(tarifaElegida)} → valor a recaudar ${formatCOP(honorarioElegido + tarifaElegida)}`
    : `Propuesta económica v${versionN} aprobada — Plan ${plan} — honorario ${formatCOP(valorElegido)}`
  await registrarActividad(sb, {
    workspace_id: workspaceId,
    entidad_tipo: 'negocio',
    entidad_id: ctx.negocioId,
    tipo: 'propuesta_aprobada',
    autor_id: staffId,
    contenido: contenidoLog,
  }, 'aprobarVersionPropuesta')

  revalidatePath(`/negocios/${ctx.negocioId}`)
  return { ok: true }
}

// ── Action: revertir la aprobacion ──────────────────────────────────────────

/**
 * Deshace la aprobación de la propuesta para que se pueda generar una versión nueva
 * y volver a elegir plan. Pedido por el equipo comercial (2026-08-04): un plan mal
 * elegido al avanzar de etapa no tenía cómo deshacerse, y la única vía era pedirle a
 * Mauricio que lo corrigiera por SQL.
 *
 * Tres límites, y cada uno responde a un riesgo distinto:
 *
 * 1. **Solo mientras el negocio siga en la etapa del bloque.** Aprobar fija el precio
 *    del negocio, y ese precio alimenta el valor a recaudar, el saldo y el gate de
 *    handoff a operaciones. Deshacerlo cuando el caso ya avanzó es cambiarle el piso
 *    a decisiones que ya se tomaron aguas abajo.
 *
 * 2. **Solo mientras no haya un pago CONFIRMADO** (`cobros.fecha IS NOT NULL`). Un
 *    cobro registrado sin fecha no es plata recibida — es la misma definición que ya
 *    usa el resto del producto para contar ingresos. Con plata recibida, revertir
 *    dejaría el cobro apuntando a un precio que dejó de existir, y eso reaparece como
 *    descuadre en conciliación.
 *
 * 3. **Las versiones NO se borran.** El PDF que el cliente ya recibió queda en el
 *    historial: se revierte la decisión, no la evidencia de lo que se le envió.
 *
 * El cap de descuento no necesita nada especial: `aprobarVersionPropuesta` lo evalúa
 * en CADA aprobación, así que al volver a aprobar se vuelve a exigir rol gerencial si
 * el descuento nuevo supera el umbral. Sin esto, revertir sería la puerta para
 * saltarse el tope (aprobar bajo, revertir, aprobar alto).
 */
export async function revertirAprobacionPropuesta(
  bloqueId: string,
  motivo: string,
): Promise<{ ok: boolean; error?: string }> {
  const { supabase, workspaceId, staffId, error: errWs } = await getWorkspace()
  if (errWs || !workspaceId) return { ok: false, error: 'No autenticado' }

  const razon = (motivo ?? '').trim()
  if (!razon) return { ok: false, error: 'Escribe por qué se revierte la aprobación' }

  const guard = await guardEditarBloque(bloqueId)
  if (!guard.ok) return { ok: false, error: guard.error ?? 'Sin permiso' }

  const ctx = await loadBloqueContext(supabase, workspaceId, bloqueId)
  if (ctx.error) return { ok: false, error: ctx.error }

  if (!ctx.data.aprobado_at) {
    return { ok: false, error: 'Esta propuesta no está aprobada' }
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = supabase as any

  // Límite 1: la ventana la declara la configuración del bloque, NO la etapa donde el
  // bloque vive. La propuesta se aprueba en una etapa y se renegocia en la siguiente,
  // donde el bloque ya es copia de solo lectura; medir contra la etapa propia dejaba
  // esto inalcanzable justo donde se pidió (detectado en V0267, 2026-08-04).
  const bloqueConfigId = (ctx.bloque as { bloque_config_id?: string }).bloque_config_id
  const { data: ventanaRow } = await sb
    .from('bloque_configs')
    .select('config_extra, etapas_negocio!inner(orden)')
    .eq('id', bloqueConfigId)
    .maybeSingle()
  const cfgVentana = ventanaRow as {
    config_extra?: { revertir_hasta_etapa_orden?: number } | null
    etapas_negocio?: { orden?: number } | null
  } | null
  const hastaOrden = cfgVentana?.config_extra?.revertir_hasta_etapa_orden
    ?? cfgVentana?.etapas_negocio?.orden
    ?? null

  // Se resuelve en dos pasos en vez de por join: el nombre de la FK a la etapa actual
  // no es estable y un join mal nombrado devolvería vacío en silencio, que aquí
  // significaría dejar pasar una reversión fuera de ventana.
  const { data: negRow } = await sb
    .from('negocios')
    .select('etapa_actual_id')
    .eq('id', ctx.negocioId)
    .maybeSingle()
  const etapaActualId = (negRow as { etapa_actual_id?: string | null } | null)?.etapa_actual_id ?? null
  let ordenActual: number | null = null
  let nombreActual: string | null = null
  if (etapaActualId) {
    const { data: etRow } = await sb
      .from('etapas_negocio')
      .select('orden, nombre')
      .eq('id', etapaActualId)
      .maybeSingle()
    ordenActual = (etRow as { orden?: number } | null)?.orden ?? null
    nombreActual = (etRow as { nombre?: string } | null)?.nombre ?? null
  }

  if (hastaOrden != null && ordenActual != null && ordenActual > hastaOrden) {
    return {
      ok: false,
      error: `El negocio ya está en ${nombreActual ?? 'una etapa posterior'} y la aprobación solo se revierte antes de eso. Devuélvelo primero, o corrige el valor aprobado.`,
    }
  }

  // Límite 2: sin pagos confirmados. Se cuenta la plata recibida, no el registro.
  const { data: pagos } = await sb
    .from('cobros')
    .select('id, monto, fecha')
    .eq('negocio_id', ctx.negocioId)
    .not('fecha', 'is', null)
    .limit(5)
  const confirmados = (pagos ?? []) as Array<{ monto: number | null }>
  if (confirmados.length > 0) {
    const total = confirmados.reduce((s, c) => s + Number(c.monto ?? 0), 0)
    return {
      ok: false,
      error: `El negocio ya tiene pagos registrados por ${formatCOP(total)}. Con plata recibida, el precio se corrige, no se revierte.`,
    }
  }

  const precioAnterior = ctx.data.aprobado_honorario ?? null
  const planAnterior = ctx.data.aprobado_plan ?? null
  const versionAnterior = ctx.data.aprobado_version ?? null
  const ahora = new Date().toISOString()

  // Se limpian SOLO las marcas de aprobación. `versiones` queda intacto: es el
  // registro de lo que se le mandó al cliente.
  const nuevoData: PropuestaData = {
    ...ctx.data,
    // Los campos base se reafirman desde el contexto: `ctx.data` es lo persistido y
    // puede venir incompleto en instancias viejas, y este objeto reemplaza la fila
    // entera. Sin esto, revertir podría dejar el bloque sin su precio base.
    precio_base_con_iva: ctx.data.precio_base_con_iva ?? ctx.precioBase,
    iva_pct: ctx.data.iva_pct ?? ctx.ivaPct,
    descuento_pct_plan1: ctx.data.descuento_pct_plan1 ?? 0,
    descuento_pct_plan2: ctx.data.descuento_pct_plan2 ?? 0,
    valor_final_plan1: ctx.data.valor_final_plan1 ?? 0,
    valor_final_plan2: ctx.data.valor_final_plan2 ?? 0,
    versiones: ctx.data.versiones ?? [],
    version_activa: ctx.data.version_activa ?? null,
    aprobado_at: null,
    aprobado_por: null,
    aprobado_version: null,
    aprobado_plan: null,
    aprobado_honorario: null,
    aprobado_tarifa_upme: null,
    aprobado_servicio: null,
  }

  const { error: errBlq } = await sb
    .from('negocio_bloques')
    .update({ data: nuevoData, estado: 'pendiente', completado_at: null, updated_at: ahora })
    .eq('id', ctx.bloque.id)
  if (errBlq) return { ok: false, error: (errBlq as { message: string }).message }

  // El precio del negocio se suelta con la aprobación: dejarlo puesto sin aprobación
  // vigente haría que el valor a recaudar siguiera calculándose sobre un acuerdo que
  // ya no existe.
  await sb
    .from('negocios')
    .update({ precio_aprobado: null, updated_at: ahora })
    .eq('id', ctx.negocioId)

  // `autor_id` es FK → staff(id), NO profiles. Un id equivocado hace fallar el insert
  // en silencio y la reversión quedaría sin rastro.
  await registrarActividad(sb, {
    workspace_id: workspaceId,
    entidad_tipo: 'negocio',
    entidad_id: ctx.negocioId,
    tipo: 'cambio',
    autor_id: staffId ?? null,
    campo_modificado: 'precio_aprobado',
    valor_anterior: precioAnterior != null ? String(precioAnterior) : null,
    valor_nuevo: null,
    contenido: `Aprobación revertida (v${versionAnterior ?? '?'}, Plan ${planAnterior ?? '?'}, ${precioAnterior != null ? formatCOP(Number(precioAnterior)) : 'sin valor'}). ${razon}`.slice(0, 280),
  }, 'revertirAprobacionPropuesta')

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
    // Tarifa se computa al generar la 1ª versión (necesita la Factura del negocio).
    tarifa_upme: 0,
    tarifa_upme_editada: false,
    tarifa_upme_detalle: null,
    versiones: [],
    version_activa: null,
    aprobado_at: null,
    aprobado_por: null,
    aprobado_version: null,
    aprobado_plan: null,
    aprobado_honorario: null,
    aprobado_tarifa_upme: null,
    aprobado_servicio: null,
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await (sb as any)
    .from('negocio_bloques')
    .update({ data: dataInicial })
    .eq('id', bloqueId)

  console.log(`[propuesta] v1 base inicializada para bloque ${bloqueId} (ws=${workspaceId})`)
  return { ok: true }
}

// ── Action: editar la tarifa UPME (informativa, editable) ───────────────────
//
// La tarifa auto-calculada es SOLO una referencia; el valor final lo tiene la
// plataforma UPME. Este action deja que el operador la sobrescriba a mano (marca
// tarifa_upme_editada=true para que loadBloqueContext respete el valor manual y
// no lo recompute). Pasar null "des-edita" (vuelve a auto-calcular). NUNCA gate.
export async function actualizarTarifaUpmePropuesta(
  bloqueId: string,
  tarifa: number | null,
): Promise<{ ok: boolean; error?: string; tarifa_upme?: number }> {
  const { supabase, workspaceId, error: errWs } = await getWorkspace()
  if (errWs || !workspaceId) return { ok: false, error: 'No autenticado' }

  const guard = await guardEditarBloque(bloqueId)
  if (!guard.ok) return { ok: false, error: guard.error ?? 'Sin permiso' }

  const ctx = await loadBloqueContext(supabase, workspaceId, bloqueId)
  if (ctx.error) return { ok: false, error: ctx.error }

  if (ctx.bloque.estado === 'completo') {
    return { ok: false, error: 'Bloque aprobado — no se puede editar la tarifa' }
  }

  let nuevaTarifa: number
  let editada: boolean
  let detalle = ctx.tarifaDetalle
  if (tarifa === null) {
    // Des-editar → recomputar desde la Factura. Como loadBloqueContext respeta el
    // flag `tarifa_upme_editada` guardado, primero lo bajamos a false en DB y luego
    // recargamos, para que el auto-cálculo (desde el valor sin IVA) vuelva a correr.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (supabase as any)
      .from('negocio_bloques')
      .update({ data: { ...ctx.data, tarifa_upme_editada: false } })
      .eq('id', ctx.bloque.id)
    const recomputado = await loadBloqueContext(supabase, workspaceId, ctx.bloque.id)
    editada = false
    nuevaTarifa = recomputado.error ? 0 : recomputado.tarifaUpme
    detalle = recomputado.error ? null : recomputado.tarifaDetalle
  } else {
    const n = Number(tarifa)
    if (!Number.isFinite(n) || n < 0) return { ok: false, error: 'La tarifa debe ser un número ≥ 0' }
    nuevaTarifa = Math.round(n)
    editada = true
    detalle = null  // valor manual → sin detalle de fórmula
  }

  const nuevoData: PropuestaData = {
    ...ctx.data,
    precio_base_con_iva: ctx.precioBase,
    iva_pct: ctx.ivaPct,
    descuento_pct_plan1: ctx.data.descuento_pct_plan1 ?? 0,
    descuento_pct_plan2: ctx.data.descuento_pct_plan2 ?? 0,
    valor_final_plan1: ctx.data.valor_final_plan1 ?? 0,
    valor_final_plan2: ctx.data.valor_final_plan2 ?? 0,
    tarifa_upme: nuevaTarifa,
    tarifa_upme_editada: editada,
    tarifa_upme_detalle: detalle,
    versiones: ctx.data.versiones ?? [],
    version_activa: ctx.data.version_activa ?? null,
    aprobado_at: ctx.data.aprobado_at ?? null,
    aprobado_por: ctx.data.aprobado_por ?? null,
    aprobado_version: ctx.data.aprobado_version ?? null,
    aprobado_plan: ctx.data.aprobado_plan ?? null,
    aprobado_honorario: ctx.data.aprobado_honorario ?? null,
    aprobado_tarifa_upme: ctx.data.aprobado_tarifa_upme ?? null,
    aprobado_servicio: ctx.data.aprobado_servicio ?? null,
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error: errUpd } = await (supabase as any)
    .from('negocio_bloques')
    .update({ data: nuevoData })
    .eq('id', ctx.bloque.id)
  if (errUpd) return { ok: false, error: errUpd.message }

  revalidatePath(`/negocios/${ctx.negocioId}`)
  return { ok: true, tarifa_upme: nuevaTarifa }
}

// ── Corrección de la aprobación (valor y/o plan) ────────────────────────────
//
// Camino APARTE del flujo de aprobación: no genera versión ni PDF, no toca lo que
// se le envió al cliente. Solo corrige lo que quedó mal registrado (caso
// canónico: V0048, cargue histórico que puso el precio estándar 637.500 cuando lo
// pactado y cobrado eran 634.500, dejando $3.000 de saldo que iban a trabar el
// gate de cierre en Cobro).
//
// **También corrige el PLAN** (2026-08-20). Antes solo movía el honorario, y el
// plan decide cuánto recaudo exige el gate de handoff a operaciones: Plan 1 pide
// tarifa + 50% del honorario, Plan 2 lo pide completo. Un plan mal elegido después
// de que se cierra la ventana de "Revertir aprobación" (etapa posterior o pago ya
// recibido) no tenía forma de arreglarse desde la aplicación: quedaba el plan viejo
// mandando sobre un valor nuevo, y la única salida era SQL. Caso que lo pidió:
// V0318, aprobado en Plan 2 mientras el cliente paga 50/50, frenado en Documentación
// por $425.000 que no debe.
//
// Plan y honorario NO son independientes: la versión aprobada declara un valor por
// plan. Al cambiar el plan sin dar un valor explícito, el honorario se deriva de
// `valor_final_plan{N}` de esa versión — así el bloque sigue diciendo lo mismo que
// el PDF que recibió el cliente. Un valor explícito gana (es el caso "quedó mal
// cargado", que por definición no coincide con la versión).
//
// PERMISO PROPIO, declarado por persona (decisión de Mauricio, 2026-07-29):
//   workspaces.config_extra.correccion_precio.staff_ids = ["<staff_id>", ...]
//
// No se ancla al rol. Un `admin` no puede por ser admin, ni un supervisor del área
// financiera por serlo: si mañana alguien se vuelve admin por otra razón, heredaría
// en silencio el permiso de cambiar plata. El owner sí pasa siempre, por ser el
// dueño del workspace. FAIL-CLOSED: sin lista, no puede nadie.
//
// Es el mismo criterio que ya separa `ROLES_MARCAS_NEGOCIO` de
// `ROLES_CORRECCION_DOCUMENTOS` en src/lib/roles.ts: afirmar algo sobre la plata
// del negocio es otra decisión que corregir un dato mal leído.

// Helpers SIN export: en un archivo `'use server'` todo export tiene que ser una
// función async, así que un helper sync exportado rompe el build entero del módulo
// (y el error apunta al importador, no aquí).
function nombrePlan(plan: 1 | 2 | undefined): string {
  if (plan === 1) return 'Plan 1 (50/50)'
  if (plan === 2) return 'Plan 2 (pago anticipado)'
  return 'sin plan'
}

function nombreServicio(servicio: string | null | undefined): string {
  if (servicio === 'completo') return 'Certificación UPME + devolución de IVA'
  if (servicio === 'solo_upme') return 'Solo certificación UPME'
  if (servicio === 'solo_iva') return 'Solo devolución de IVA'
  return servicio || 'sin servicio'
}

function resumenCorreccion(x: {
  cambiaHonorario: boolean
  cambiaPlan: boolean
  cambiaServicio: boolean
  nuevo: number
  planNuevo: 1 | 2 | undefined
  servicioNuevo: string | null
}): string {
  const partes: string[] = []
  if (x.cambiaHonorario) partes.push(`el valor aprobado cambió a ${formatCOP(x.nuevo)}`)
  if (x.cambiaPlan) partes.push(`el plan cambió a ${nombrePlan(x.planNuevo)}`)
  if (x.cambiaServicio) partes.push(`el servicio quedó en ${nombreServicio(x.servicioNuevo)}`)
  return partes.join(' y ')
}

export interface CambiosAprobacion {
  /** Honorario correcto. Si se omite y el plan cambia, se deriva de la versión aprobada. */
  honorario?: number
  /** Plan correcto: 1 (tarifa plena, 50/50) o 2 (pago anticipado). */
  plan?: 1 | 2
  /**
   * Servicio a re-congelar en `aprobado_servicio`.
   *
   * ⚠️ Solo se acepta el valor que `servicio_contratado` declara HOY. La propuesta
   * congela una decisión que se toma en otro bloque; dejar que se escriba otra cosa
   * aquí abriría una segunda verdad sobre qué contrató el cliente, y la que decide
   * el enrutamiento del caso seguiría siendo la otra. El servicio se corrige donde
   * se declara; esto solo vuelve a fotografiarlo.
   */
  servicio?: string
}

export async function corregirAprobacion(
  negocioId: string,
  cambios: CambiosAprobacion,
  motivo: string,
): Promise<{ ok: boolean; error?: string }> {
  const { supabase, workspaceId, role, staffId, userId, error } = await getWorkspace()
  if (error || !workspaceId) return { ok: false, error: 'No autenticado' }

  const razon = (motivo ?? '').trim()
  if (!razon) return { ok: false, error: 'Escribe por qué se corrige' }

  const pidePlan = cambios?.plan !== undefined
  const pideHonorario = cambios?.honorario !== undefined
  const pideServicio = cambios?.servicio !== undefined
  if (!pidePlan && !pideHonorario && !pideServicio) {
    return { ok: false, error: 'Indica qué se corrige: el valor, el plan o el servicio' }
  }
  if (pidePlan && cambios.plan !== 1 && cambios.plan !== 2) {
    return { ok: false, error: 'El plan debe ser 1 o 2' }
  }
  if (pideHonorario && (!Number.isFinite(cambios.honorario!) || cambios.honorario! <= 0)) {
    return { ok: false, error: 'El valor debe ser un número mayor que cero' }
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = supabase as any

  // Permiso: owner, o staff declarado en la lista del workspace. Sin lista, nadie.
  const { data: ws } = await sb
    .from('workspaces')
    .select('config_extra')
    .eq('id', workspaceId)
    .single()
  const permitidos = ((ws?.config_extra as { correccion_precio?: { staff_ids?: unknown } } | null)
    ?.correccion_precio?.staff_ids ?? []) as string[]
  const autorizado = role === 'owner' || (!!staffId && permitidos.includes(staffId))
  if (!autorizado) {
    return { ok: false, error: 'Solo quien tiene autorización para cambios de valor puede corregir este dato' }
  }

  const { data: negocio } = await sb
    .from('negocios')
    .select('id, codigo, nombre, precio_aprobado')
    .eq('id', negocioId)
    .eq('workspace_id', workspaceId)
    .single()
  if (!negocio) return { ok: false, error: 'Negocio no encontrado' }

  // El honorario y el plan aprobados viven en el bloque origen Y en sus copias
  // heredadas: si solo se corrigiera el origen, las etapas siguientes seguirían
  // mostrando lo viejo y nadie sabría cuál creer. Peor con el plan: el motor lo
  // resuelve recorriendo las instancias y quedándose con la PRIMERA que traiga un
  // plan válido (`anticipoCubiertoPorSaldo`), así que dejar copias divergentes hace
  // que el gate dependa del orden en que vuelvan las filas. Las `versiones[]` NO se
  // tocan: son el registro de lo que se le mandó al cliente.
  const [{ data: instancias }, { data: filasServicio }] = await Promise.all([
    sb
      .from('negocio_bloques')
      .select('id, data, bloque_configs!inner(config_extra, bloque_definitions!inner(tipo))')
      .eq('negocio_id', negocioId),
    // El servicio vigente, para poder re-congelarlo. Se lee su bloque, no el reflejo
    // derivado: la misma regla que aplica `niegaCertificacionUpme`.
    sb
      .from('negocio_bloques')
      .select('data, bloque_configs!inner(slug)')
      .eq('negocio_id', negocioId)
      .eq('bloque_configs.slug', 'servicio_contratado'),
  ])

  type FilaPropuesta = {
    id: string
    data: Record<string, unknown>
    bloque_configs?: {
      config_extra?: Record<string, unknown> | null
      bloque_definitions?: { tipo?: string }
    }
  }
  const dePropuesta = ((instancias ?? []) as FilaPropuesta[]).filter(
    inst => inst.bloque_configs?.bloque_definitions?.tipo === 'propuesta_economica',
  )
  const filas = dePropuesta.filter(inst =>
    Object.prototype.hasOwnProperty.call(inst.data ?? {}, 'aprobado_honorario'),
  )

  // Cap y umbral salen de la config del bloque ORIGEN (el que no es copia readonly).
  // Las copias heredan la misma config hoy, pero leer el origen es lo que hace el
  // resto del motor y no depende de que sigan sincronizadas.
  const cfgOrigen = (dePropuesta.find(f => f.bloque_configs?.config_extra?.readonly !== true)
    ?? dePropuesta[0])?.bloque_configs?.config_extra ?? {}
  const capDescuento = Number(cfgOrigen.cap_descuento_pct ?? 50)
  const umbralAprobacion = cfgOrigen.umbral_aprobacion_pct != null
    ? Number(cfgOrigen.umbral_aprobacion_pct)
    : null

  const servicioVigente = ((filasServicio ?? []) as Array<{ data: Record<string, unknown> | null }>)
    .map(f => f.data?.servicio)
    .find(v => typeof v === 'string' && v !== '') as string | undefined ?? null

  if (pideServicio && cambios.servicio !== servicioVigente) {
    return {
      ok: false,
      error: servicioVigente
        ? `El servicio se corrige en el bloque "Servicio contratado", no aquí. Hoy declara: ${nombreServicio(servicioVigente)}.`
        : 'Este negocio todavía no declara qué contrató el cliente. Respóndelo en el bloque "Servicio contratado" y vuelve.',
    }
  }

  // Estado vigente. El plan se lee con el MISMO criterio que el motor (primera
  // instancia con un plan válido) para no corregir contra una lectura distinta de
  // la que decide el gate.
  const planAnterior =
    filas.map(f => f.data?.aprobado_plan).find(p => p === 1 || p === 2) as 1 | 2 | undefined
  const planNuevo = (cambios.plan ?? planAnterior) as 1 | 2 | undefined

  const anterior = Number(negocio.precio_aprobado ?? 0)
  let nuevo = anterior
  if (pideHonorario) {
    nuevo = Math.round(cambios.honorario!)
  } else if (pidePlan && planNuevo !== planAnterior) {
    // Sin valor explícito, el honorario sale de la versión aprobada: cada plan trae
    // el suyo, y con descuentos distintos cambiar de plan cambia lo que se cobra.
    // Si la versión no se puede leer, se conserva el valor actual antes que inventar.
    const conVersiones = filas.find(f => Array.isArray(f.data?.versiones))
    const versiones = (conVersiones?.data?.versiones ?? []) as PropuestaVersion[]
    const nVersion = conVersiones?.data?.aprobado_version
    const version = versiones.find(v => v.n === nVersion)
    const derivado = planNuevo === 1 ? version?.valor_final_plan1 : version?.valor_final_plan2
    if (Number.isFinite(derivado) && (derivado as number) > 0) nuevo = Math.round(derivado as number)
  }

  const servicioAnterior =
    filas.map(f => f.data?.aprobado_servicio).find(v => typeof v === 'string' && v !== '') as
      | string
      | undefined ?? null
  const servicioNuevo = pideServicio ? (cambios.servicio as string) : servicioAnterior

  const cambiaHonorario = nuevo !== anterior
  const cambiaPlan = pidePlan && planNuevo !== planAnterior
  const cambiaServicio = pideServicio && servicioNuevo !== servicioAnterior
  if (!cambiaHonorario && !cambiaPlan && !cambiaServicio) {
    return { ok: false, error: 'Los valores son los mismos que ya están registrados' }
  }

  // ⚠️ El MISMO gate que exige la aprobación. Corregir un dato mal registrado y regalar
  // un descuento se escriben igual en la base: sin esto, quien está en
  // `correccion_precio.staff_ids` podía dejar el honorario en cualquier cifra saltándose
  // el umbral que sí lo frena al aprobar. La base viene de la instancia origen; si la
  // propuesta no la trae (bloques viejos), `descuentoImplicito` devuelve null y el gate
  // no frena, porque ahí falta configuración, no falta una decisión de precio.
  if (cambiaHonorario) {
    let precioBase = Number(
      filas.map(f => f.data?.precio_base_con_iva).find(v => Number(v) > 0) ?? 0,
    )
    // ⚠️ 184 de las 302 propuestas aprobadas de SOENA no traen `precio_base_con_iva`
    // (medido el 2026-09-01): son las del cargue historico, que nacieron aprobadas sin
    // pasar por `generarVersionPropuesta`. Sin base no hay descuento que medir y el gate
    // se quedaria mudo justo en la mayoria de los casos. Se deriva del servicio de la
    // linea, que es EXACTAMENTE el mismo fallback que aplica `loadBloqueContext` al
    // generar: no se inventa una base, se usa la misma que usaria la creacion.
    if (precioBase <= 0) {
      const autoPropuesta = (cfgOrigen.auto_propuesta ?? null) as { servicio_id?: string } | null
      const servicioId = (cfgOrigen.servicio_id as string | undefined) ?? autoPropuesta?.servicio_id
      if (servicioId) {
        const { data: servicio } = await sb
          .from('servicios')
          .select('precio_estandar, tarifa_iva')
          .eq('id', servicioId)
          .single()
        if (servicio) {
          const iva = Number(servicio.tarifa_iva ?? 0.19)
          precioBase = Math.round(Number(servicio.precio_estandar ?? 0) * (1 + iva))
        }
      }
    }
    const rechazo = motivoDescuentoRechazado({
      descuentoPct: descuentoImplicito(nuevo, precioBase),
      cap: capDescuento,
      umbral: umbralAprobacion,
      role,
      etiqueta: `El valor corregido (${formatCOP(nuevo)})`,
    })
    if (rechazo) return { ok: false, error: rechazo }
  }

  for (const inst of filas) {
    const data = { ...inst.data }
    if (cambiaHonorario) data.aprobado_honorario = nuevo
    if (cambiaPlan) data.aprobado_plan = planNuevo
    if (cambiaServicio) data.aprobado_servicio = servicioNuevo
    await sb
      .from('negocio_bloques')
      .update({ data, updated_at: new Date().toISOString() })
      .eq('id', inst.id)
  }

  if (cambiaHonorario) {
    await sb
      .from('negocios')
      .update({ precio_aprobado: nuevo, updated_at: new Date().toISOString() })
      .eq('id', negocioId)
  }

  // Rastro. `tipo` debe existir en el CHECK de activity_log (solo admite
  // comentario|cambio|sistema|cambio_etapa|cambio_estado|solicitud_conciliacion|
  // conciliacion_atendida): se usa 'cambio', no un tipo nuevo — un tipo fuera del
  // CHECK hace fallar el insert EN SILENCIO, y eso ya costó tres incidentes.
  // `contenido` tiene tope de 280 caracteres por CHECK.
  // Una fila POR CAMPO: el timeline se lee por `campo_modificado`, y un evento que
  // mezclara los dos dejaría el cambio de plan invisible para quien filtre por él.
  const eventos: Array<Record<string, unknown>> = []
  if (cambiaHonorario) {
    eventos.push({
      campo_modificado: 'precio_aprobado',
      valor_anterior: String(anterior),
      valor_nuevo: String(nuevo),
      contenido: `Valor aprobado corregido: ${formatCOP(anterior)} → ${formatCOP(nuevo)}. ${razon}`.slice(0, 280),
    })
  }
  if (cambiaPlan) {
    eventos.push({
      campo_modificado: 'aprobado_plan',
      valor_anterior: planAnterior ? String(planAnterior) : '',
      valor_nuevo: String(planNuevo),
      contenido: `Plan aprobado corregido: ${nombrePlan(planAnterior)} → ${nombrePlan(planNuevo)}. ${razon}`.slice(0, 280),
    })
  }
  if (cambiaServicio) {
    eventos.push({
      campo_modificado: 'aprobado_servicio',
      valor_anterior: servicioAnterior ?? '',
      valor_nuevo: String(servicioNuevo),
      contenido: `Servicio de la propuesta actualizado: ${nombreServicio(servicioAnterior)} → ${nombreServicio(servicioNuevo)}. ${razon}`.slice(0, 280),
    })
  }
  for (const evento of eventos) {
    await registrarActividad(sb, {
      workspace_id: workspaceId,
      entidad_tipo: 'negocio',
      entidad_id: negocioId,
      tipo: 'cambio',
      autor_id: staffId,
      ...evento,
    }, 'corregirAprobacion')
  }

  // Aviso al comercial responsable: le cambió la aprobación de SU negocio y no fue
  // él. No se avisa al área financiera porque quien corrige ya es de esa área.
  const { data: resp } = await sb
    .from('negocio_responsables')
    .select('staff_id, rol')
    .eq('negocio_id', negocioId)
    .eq('rol', 'comercial')
    .maybeSingle()
  if (resp?.staff_id) {
    const { data: st } = await sb.from('staff').select('profile_id').eq('id', resp.staff_id).single()
    if (st?.profile_id && st.profile_id !== userId) {
      await sb.rpc('crear_notificacion', {
        p_workspace_id: workspaceId,
        p_destinatario_id: st.profile_id,
        p_tipo: 'precio_corregido',
        p_contenido: `${negocio.codigo ?? 'Negocio'}: ${resumenCorreccion({
          cambiaHonorario,
          cambiaPlan,
          cambiaServicio,
          nuevo,
          planNuevo,
          servicioNuevo,
        })}`.slice(0, 280),
        p_entidad_tipo: 'negocio',
        p_entidad_id: negocioId,
        p_deep_link: `/negocios/${negocioId}`,
        p_metadata: {
          anterior,
          nuevo,
          plan_anterior: planAnterior ?? null,
          plan_nuevo: planNuevo ?? null,
          servicio_anterior: servicioAnterior,
          servicio_nuevo: servicioNuevo,
          motivo: razon,
        },
        p_permitir_repetidas: true,
      })
    }
  }

  revalidatePath(`/negocios/${negocioId}`)
  return { ok: true }
}
