'use server'

import { getWorkspace } from '@/lib/actions/get-workspace'
import { canEditBloque, type UserContext, type Role, type Area } from '@/lib/permissions/can-edit'

// Cast para tablas/columnas nuevas no en database.ts
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function db(client: unknown): any {
  return client
}

// ── Permiso: misma lógica que ctxFinanciero en conciliacion-actions ──────────

async function ctxFinanciero(): Promise<
  | { ok: true; supabase: unknown; workspaceId: string }
  | { ok: false; error: string }
> {
  const { supabase, workspaceId, staffId, role, areas, error } = await getWorkspace()
  if (error || !workspaceId) return { ok: false, error: error ?? 'No autenticado' }
  const user: UserContext = {
    id: staffId ?? '',
    role: (role ?? 'read_only') as Role,
    areas: (areas ?? []) as Area[],
  }
  if (!canEditBloque(user, { stage: 'cobro' }, [])) {
    return { ok: false, error: 'Solo el área financiera puede ver el panel ePayco' }
  }
  return { ok: true, supabase, workspaceId }
}

// ── Tipos públicos ────────────────────────────────────────────────────────────

export interface CobroEpayco {
  id: string
  external_ref: string
  monto: number
  fecha: string
  tipo_cobro: string
  negocio_codigo: string | null
  negocio_nombre: string | null
  /** Comisión estimada: monto * 2.9% */
  comision_estimada: number
  /** IVA sobre la comisión: comision * 19% */
  iva_estimado: number
  /** Neto estimado: monto - comision - iva */
  neto_estimado: number
}

export interface ResumenEpayco {
  total_bruto: number
  total_comision: number
  total_iva: number
  total_neto: number
  total_cobros: number
}

export interface ConciliacionEpaycoData {
  cobros: CobroEpayco[]
  resumen: ResumenEpayco
  /** Meses disponibles en formato "YYYY-MM", orden DESC. */
  meses_disponibles: string[]
}

// ── Constantes ePayco (tarifas estándar 2.9% + IVA 19%) ─────────────────────

const COMISION_RATE = 0.029
const IVA_RATE = 0.19

function calcularCostosEpayco(monto: number): {
  comision_estimada: number
  iva_estimado: number
  neto_estimado: number
} {
  const comision_estimada = Math.round(monto * COMISION_RATE)
  const iva_estimado = Math.round(comision_estimada * IVA_RATE)
  const neto_estimado = monto - comision_estimada - iva_estimado
  return { comision_estimada, iva_estimado, neto_estimado }
}

// ── Inferir si un cobro es ePayco ────────────────────────────────────────────
// Dos señales: (1) fuente='epayco', (2) fuente IS NULL y external_ref solo dígitos.
// Mismo criterio que inferirFuente() en conciliacion-actions.ts.

function esCobroEpayco(fuente: string | null, externalRef: string | null): boolean {
  if (!externalRef) return false
  if (fuente === 'epayco') return true
  if (fuente === null && /^\d+$/.test(externalRef)) return true
  return false
}

// ── getConciliacionEpayco ─────────────────────────────────────────────────────

/**
 * Retorna los cobros con referencia ePayco del workspace, opcionalmente
 * filtrados por mes ("YYYY-MM"). Calcula estimados de comisión e IVA a
 * tarifas estándar ePayco (2.9% + IVA 19% sobre la comisión).
 *
 * Acceso: mismo guard que el panel de conciliación (área financiera).
 */
export async function getConciliacionEpayco(
  mes?: string,
): Promise<{ data: ConciliacionEpaycoData | null; error?: string }> {
  const ctx = await ctxFinanciero()
  if (!ctx.ok) return { data: null, error: ctx.error }
  const { supabase, workspaceId } = ctx

  // Query todos los cobros con external_ref no nulo del workspace
  const { data: cobrosRaw, error: qErr } = await db(supabase)
    .from('cobros')
    .select(`
      id,
      external_ref,
      monto,
      fecha,
      tipo_cobro,
      fuente,
      negocios:negocio_id (
        codigo,
        nombre
      )
    `)
    .eq('workspace_id', workspaceId)
    .not('external_ref', 'is', null)
    .order('fecha', { ascending: false })

  if (qErr) return { data: null, error: (qErr as { message: string }).message }

  type RawRow = {
    id: string
    external_ref: string | null
    monto: number | string
    fecha: string | null
    tipo_cobro: string | null
    fuente: string | null
    negocios: { codigo: string | null; nombre: string | null } | null
  }

  const todos = (cobrosRaw ?? []) as RawRow[]

  // Filtrar solo los que son ePayco
  const soloEpayco = todos.filter((c) => esCobroEpayco(c.fuente, c.external_ref))

  // Calcular meses disponibles
  const mesesSet = new Set<string>()
  for (const c of soloEpayco) {
    if (c.fecha) mesesSet.add(c.fecha.substring(0, 7))
  }
  const meses_disponibles = Array.from(mesesSet).sort((a, b) => b.localeCompare(a))

  // Filtrar por mes si se especificó
  const cobrosParaPanel =
    mes && /^\d{4}-\d{2}$/.test(mes)
      ? soloEpayco.filter((c) => c.fecha?.startsWith(mes))
      : soloEpayco

  // Construir filas con estimados
  const cobros: CobroEpayco[] = cobrosParaPanel.map((c) => {
    const monto = Number(c.monto) || 0
    const { comision_estimada, iva_estimado, neto_estimado } = calcularCostosEpayco(monto)
    return {
      id: c.id,
      external_ref: c.external_ref ?? '',
      monto,
      fecha: c.fecha ?? '',
      tipo_cobro: c.tipo_cobro ?? '',
      negocio_codigo: c.negocios?.codigo ?? null,
      negocio_nombre: c.negocios?.nombre ?? null,
      comision_estimada,
      iva_estimado,
      neto_estimado,
    }
  })

  // Calcular resumen agregado
  const resumen: ResumenEpayco = cobros.reduce(
    (acc, c) => ({
      total_bruto: acc.total_bruto + c.monto,
      total_comision: acc.total_comision + c.comision_estimada,
      total_iva: acc.total_iva + c.iva_estimado,
      total_neto: acc.total_neto + c.neto_estimado,
      total_cobros: acc.total_cobros + 1,
    }),
    { total_bruto: 0, total_comision: 0, total_iva: 0, total_neto: 0, total_cobros: 0 },
  )

  return {
    data: { cobros, resumen, meses_disponibles },
  }
}
