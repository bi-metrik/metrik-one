'use server'

import { getWorkspace } from '@/lib/actions/get-workspace'

export type Movimiento = {
  id: string
  tipo: 'ingreso' | 'egreso'
  fecha: string
  monto: number
  descripcion: string
  categoria: string | null
  proyecto: string | null
  deducible: boolean
  soporte_url: string | null
  tipo_gasto: 'directo' | 'empresa' | 'fijo' | null
  canal_registro: 'app' | 'whatsapp' | null
}

// D142: Categorías deducibles para régimen ordinario
const CATEGORIAS_DEDUCIBLES = ['materiales', 'transporte', 'servicios_profesionales', 'viaticos', 'software', 'impuestos_seguros', 'mano_de_obra']

function esCategoriaDeducible(categoria: string | null): boolean {
  if (!categoria) return false
  return CATEGORIAS_DEDUCIBLES.includes(categoria)
}

export async function getMovimientos(filters?: {
  tipo?: 'todos' | 'ingresos' | 'egresos'
  mes?: string // YYYY-MM
}) {
  const { supabase, workspaceId, error } = await getWorkspace()
  if (error || !workspaceId) return { movimientos: [], totales: { ingresos: 0, egresos: 0, deducible: 0 }, regimenFiscal: null as string | null }

  const tipoFilter = filters?.tipo ?? 'todos'
  const mes = filters?.mes ?? new Date().toISOString().slice(0, 7) // default current month

  const startDate = `${mes}-01`
  const [y, m] = mes.split('-').map(Number)
  const endDate = new Date(y, m, 0).toISOString().split('T')[0] // last day of month

  const results: Movimiento[] = []

  // ── Egresos (gastos table) ──────────────────────────
  if (tipoFilter === 'todos' || tipoFilter === 'egresos') {
    const { data: gastos } = await supabase
      .from('gastos')
      .select('id, fecha, monto, descripcion, categoria, deducible, soporte_url, tipo, canal_registro, proyecto_id, proyectos(nombre)')
      .eq('workspace_id', workspaceId)
      .gte('fecha', startDate)
      .lte('fecha', endDate)
      .order('fecha', { ascending: false })

    for (const g of gastos ?? []) {
      const proy = g.proyectos as { nombre: string } | null
      results.push({
        id: g.id,
        tipo: 'egreso',
        fecha: g.fecha,
        monto: Number(g.monto),
        descripcion: g.descripcion ?? g.categoria ?? 'Gasto',
        categoria: g.categoria,
        proyecto: proy?.nombre ?? null,
        deducible: g.deducible ?? false,
        soporte_url: g.soporte_url ?? null,
        tipo_gasto: (g.tipo as Movimiento['tipo_gasto']) ?? null,
        canal_registro: (g.canal_registro as Movimiento['canal_registro']) ?? null,
      })
    }
  }

  // ── Ingresos (cobros table) ─────────────────────────
  if (tipoFilter === 'todos' || tipoFilter === 'ingresos') {
    const { data: cobros } = await supabase
      .from('cobros')
      .select('id, fecha, monto, notas, proyecto_id, proyectos(nombre)')
      .eq('workspace_id', workspaceId)
      .gte('fecha', startDate)
      .lte('fecha', endDate)
      .order('fecha', { ascending: false })

    for (const c of cobros ?? []) {
      const proy = c.proyectos as { nombre: string } | null
      results.push({
        id: c.id,
        tipo: 'ingreso',
        fecha: c.fecha,
        monto: Number(c.monto),
        descripcion: c.notas ?? 'Cobro',
        categoria: null,
        proyecto: proy?.nombre ?? null,
        deducible: false,
        soporte_url: null,
        tipo_gasto: null,
        canal_registro: null,
      })
    }
  }

  // Sort by date descending
  results.sort((a, b) => b.fecha.localeCompare(a.fecha))

  // Totals
  const ingresos = results.filter(m => m.tipo === 'ingreso').reduce((s, m) => s + m.monto, 0)
  const egresos = results.filter(m => m.tipo === 'egreso').reduce((s, m) => s + m.monto, 0)

  // D142: Deducible total (category-based + soporte)
  const deducible = results
    .filter(m => m.tipo === 'egreso' && esCategoriaDeducible(m.categoria) && m.soporte_url)
    .reduce((s, m) => s + m.monto, 0)

  // D141: Fiscal regime
  const { data: fiscalProfile } = await supabase
    .from('fiscal_profiles')
    .select('tax_regime')
    .eq('workspace_id', workspaceId)
    .maybeSingle()

  const regimenFiscal = (fiscalProfile?.tax_regime as string | null) ?? null

  return { movimientos: results, totales: { ingresos, egresos, deducible }, regimenFiscal }
}
