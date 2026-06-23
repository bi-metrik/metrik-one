'use server'

import { getWorkspace } from '@/lib/actions/get-workspace'
import { getAreasEfectivas, type Area, type Role } from '@/lib/permissions/can-edit'
import {
  registrarPagoEnNegocio,
  type AgregarPagoInput,
} from '@/lib/actions/conciliacion-actions'

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

async function ctxFabPago(): Promise<
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
export async function getNegociosParaPagoFab(): Promise<{
  negocios: NegocioParaPagoFab[]
  error?: string
}> {
  const ctx = await ctxFabPago()
  if (!ctx.ok) return { negocios: [], error: ctx.error }
  const { supabase, workspaceId } = ctx

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

  return { negocios }
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
  input: AgregarPagoInput,
): Promise<
  | { success: true }
  | { success: false; error: string; code?: 'epayco_no_aprobada' | 'referencia_duplicada'; negocio_existente?: { codigo: string | null } }
> {
  const ctx = await ctxFabPago()
  if (!ctx.ok) return { success: false, error: ctx.error }
  const { supabase, workspaceId, staffId } = ctx
  return registrarPagoEnNegocio(supabase, workspaceId, staffId, input, 'fab')
}
