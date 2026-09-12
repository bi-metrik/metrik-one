'use server'

import { getWorkspace } from '@/lib/actions/get-workspace'
import { getAreasEfectivas, type Area, type Role } from '@/lib/permissions/can-edit'
import {
  registrarPagoEnNegocio,
  type AgregarPagoInput,
} from '@/lib/actions/conciliacion-actions'
import { archivarSoporte, type SoporteSubidoInput } from '@/lib/cobros/soporte-pago'
import { PREFIJO_REF_AUTOGENERADA } from '@/lib/cobros/referencia-externa'
import { todayBogotaISO } from '@/lib/dates/bogota'
import { randomUUID } from 'crypto'

// Cast a untyped para columnas no presentes en database.ts (config_extra).
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function db(client: unknown): any {
  return client
}

/**
 * Guard del FAB "Registrar pago" — DESACOPLADO de STAGE_TO_AREA.
 *
 * Principio: "el cobro lo lidera el comercial". Registrar un pago vía FAB NO debe
 * exigir que el área del usuario coincida con el stage actual del negocio (a
 * diferencia de `guardEditarBloque`, que valida el área de la etapa). Por eso este
 * guard valida SOLO el ROL + excluye a operaciones pura:
 *
 *   - owner / admin            → habilitados (lideran todo)
 *   - supervisor / operator    → habilitados, SALVO que su única área sea operaciones
 *   - contador / read_only     → nunca (fuera del manejo de dinero)
 *
 * "Operaciones pura" = tiene área(s) asignada(s) y TODAS son 'operaciones' (sin
 * comercial/financiera/direccion). Si no tiene áreas, queda habilitado (el comercial
 * por defecto lidera el cobro). El negocio debe existir y ser del workspace — eso lo
 * valida `registrarPagoEnNegocio` al recibir el negocio_id.
 */
function rolHabilitadoParaPagoFab(role: Role, areas: Area[]): boolean {
  if (role === 'read_only' || role === 'contador') return false
  if (role === 'owner' || role === 'admin') return true
  if (role === 'supervisor' || role === 'operator') {
    if (areas.length === 0) return true // sin segmentación → lidera el cobro
    const efectivas = getAreasEfectivas({ id: '', role, areas })
    // Habilitado si tiene comercial o financiera (directa o vía dirección).
    // Excluido si su único alcance efectivo es operaciones.
    return efectivas.has('comercial') || efectivas.has('financiera')
  }
  return false
}

/**
 * ¿Este workspace cobra por ePayco?
 *
 * Es una capacidad del workspace, no una verdad del producto. SOENA cobra por la
 * pasarela y toda su operación de cobro se apoya en verificar la referencia contra
 * ePayco. Termotech cobra por transferencia y consignación: pedirle una `ref_payco`
 * dejaba el módulo de pagos inservible, con cero cobros registrados desde que se
 * activó.
 *
 * Lee `modules.fab_pago_epayco`. Ausente = no, que es lo correcto para todo
 * workspace nuevo: la pasarela se habilita cuando existe, no por defecto.
 */
export async function workspaceCobraPorEpayco(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  workspaceId: string,
): Promise<boolean> {
  const { data } = await supabase
    .from('workspaces').select('modules').eq('id', workspaceId).maybeSingle()
  const modules = (data?.modules ?? {}) as Record<string, boolean>
  return modules.fab_pago_epayco === true
}

export async function ctxFabPago(): Promise<
  | { ok: true; supabase: unknown; workspaceId: string; staffId: string | null }
  | { ok: false; error: string }
> {
  const { supabase, workspaceId, staffId, role, areas, error } = await getWorkspace()
  if (error || !workspaceId) return { ok: false, error: error ?? 'No autenticado' }
  const r = (role ?? 'read_only') as Role
  const a = (areas ?? []) as Area[]
  if (!rolHabilitadoParaPagoFab(r, a)) {
    return { ok: false, error: 'Tu rol no puede registrar pagos.' }
  }
  return { ok: true, supabase, workspaceId, staffId }
}

/**
 * Lo que el modal de pago necesita saber del workspace antes de pintar el
 * formulario: los negocios, y si hay pasarela contra la cual verificar.
 *
 * Va en la misma llamada que ya hacía el modal para traer los negocios. Una
 * consulta aparte solo para un booleano abriría la ventana en la que el
 * formulario se pinta con la fuente equivocada.
 */
export interface ContextoPagoFab {
  negocios: NegocioParaPagoFab[]
  cobraPorEpayco: boolean
  /** El modal lo necesita para el path del comprobante en Storage: la policy del
   *  bucket exige que la primera carpeta sea el workspace. */
  workspaceId: string | null
  error?: string
}

/** Negocio elegible para registrar un pago desde el FAB. */
export interface NegocioParaPagoFab {
  negocio_id: string
  codigo: string | null
  nombre: string | null
  empresa: string | null
}

/**
 * Lista los negocios del workspace para el selector del FAB de pago. Incluye TODOS
 * los abiertos (sin filtrar por etapa/área ni por responsable) — el comercial que
 * recibe el pago puede registrarlo aunque el negocio esté en ejecución/cobro de
 * otra área. Guard por rol vía `ctxFabPago`.
 */
export async function getNegociosParaPagoFab(): Promise<ContextoPagoFab> {
  const ctx = await ctxFabPago()
  if (!ctx.ok) return { negocios: [], cobraPorEpayco: false, workspaceId: null, error: ctx.error }
  const { supabase, workspaceId } = ctx
  const cobraPorEpayco = await workspaceCobraPorEpayco(supabase, workspaceId)

  const { data: raw } = await db(supabase)
    .from('negocios')
    .select('id, codigo, nombre, estado, empresas:empresa_id ( nombre )')
    .eq('workspace_id', workspaceId)
    .eq('estado', 'abierto')
    .order('created_at', { ascending: false })

  const negocios: NegocioParaPagoFab[] = ((raw ?? []) as Array<{
    id: string
    codigo: string | null
    nombre: string | null
    empresas: { nombre: string | null } | null
  }>).map((n) => ({
    negocio_id: n.id,
    codigo: n.codigo,
    nombre: n.nombre,
    empresa: n.empresas?.nombre ?? null,
  }))

  return { negocios, cobraPorEpayco, workspaceId }
}

/**
 * ¿Este negocio puede recibir un cobro hoy? Se pregunta al ELEGIR el negocio en
 * el modal, antes de teclear referencia y valor.
 *
 * Aquí el flag no puede viajar precomputado como en el detalle: el FAB elige el
 * negocio desde una lista de todos los abiertos (223 en SOENA), y resolverlo para
 * cada uno costaría una llamada por fila. Por eso pregunta una sola vez, cuando
 * ya se sabe por cuál.
 *
 * El criterio NO se reimplementa: lo responde `negocio_puede_recibir_cobro`, la
 * misma función que sostiene el trigger de `cobros`. Ante `null` (negocio de otro
 * workspace) o error se deja pasar: el trigger sigue siendo la barrera dura, y un
 * aviso que aparece por no poder leer el estado enseña a ignorarlo.
 */
export async function negocioPuedeRecibirCobro(
  negocioId: string,
): Promise<{ puede: boolean }> {
  const ctx = await ctxFabPago()
  if (!ctx.ok) return { puede: true }
  const { data, error } = await db(ctx.supabase).rpc('negocio_puede_recibir_cobro', {
    p_negocio_id: negocioId,
  })
  if (error || data == null) return { puede: true }
  return { puede: data === true }
}

/**
 * Registra un pago desde el FAB global. Guard por ROL (no por área de etapa) +
 * REUSA la vía única `registrarPagoEnNegocio` (misma validación ePayco/duplicado,
 * mismo saldo, mismo des-conciliar). Etiqueta el origen 'fab' en activity_log.
 *
 * NO abre el editor de la etapa: es un formulario aislado de captura. NO bypasea
 * ninguna barrera de control — solo desacopla el PERMISO de STAGE_TO_AREA.
 */
export async function agregarPagoFab(
  input: AgregarPagoInput & { soporte_subido?: SoporteSubidoInput },
): Promise<
  | { success: true }
  | { success: false; error: string; code?: 'epayco_no_aprobada' | 'referencia_duplicada'; negocio_existente?: { codigo: string | null } }
> {
  const ctx = await ctxFabPago()
  if (!ctx.ok) return { success: false, error: ctx.error }
  const { supabase, workspaceId, staffId } = ctx

  // El comprobante es OPCIONAL aquí, al revés que en el panel de pagos externos: este
  // modal registra ingresos que entran por transferencia, efectivo o cheque, y exigir
  // el pantallazo para poder anotar la plata deja el ingreso sin registrar, que es
  // peor que registrarlo sin foto. Si viene, viaja en el mismo INSERT que el cobro.
  const { soporte_subido, ...pago } = input

  // `external_ref` es la llave del registro de pagos y no puede ir vacía, pero pedirla
  // solo tiene sentido donde hay pasarela: ahí se teclea del comprobante de ePayco y
  // sostiene el control de duplicados. En un workspace que cobra por transferencia no
  // hay nada que teclear, así que la referencia se genera, igual que en el panel de
  // pagos externos. Lo que dice de dónde entró la plata es el comprobante adjunto.
  if (!pago.referencia?.trim()) {
    if (await workspaceCobraPorEpayco(supabase, workspaceId)) {
      return { success: false, error: 'Ingresa la referencia del pago' }
    }
    const dia = (pago.fecha || todayBogotaISO()).replace(/-/g, '')
    pago.referencia = `${PREFIJO_REF_AUTOGENERADA}${dia}-${randomUUID().slice(0, 6).toUpperCase()}`
  }
  let soporte: Record<string, unknown> | null = null
  if (soporte_subido?.storage_path) {
    soporte = await archivarSoporte(
      supabase, workspaceId, input.negocio_id, soporte_subido, null, staffId ?? '',
    )
    // Si el archivado falla, el pago igual se registra: perder el ingreso porque el
    // adjunto no se pudo guardar sería cambiar un problema chico por uno grande.
    if (!soporte) console.warn('[fab-pago] el comprobante no se pudo archivar')
  }

  return registrarPagoEnNegocio(
    supabase, workspaceId, staffId, { ...pago, soporte: soporte ?? pago.soporte }, 'fab',
  )
}
