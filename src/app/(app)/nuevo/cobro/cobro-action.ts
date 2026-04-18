'use server'

import { getWorkspace } from '@/lib/actions/get-workspace'

// ── Get pending facturas across all projects ─────────────────

export async function getFacturasPendientes() {
  const { supabase, workspaceId, error } = await getWorkspace()
  if (error || !workspaceId) return []

  // Get all facturas with their projects
  const { data: facturas } = await supabase
    .from('facturas')
    .select('id, monto, numero_factura, fecha_emision, proyecto_id, proyectos(nombre)')
    .eq('workspace_id', workspaceId)
    .order('fecha_emision', { ascending: false })

  if (!facturas || facturas.length === 0) return []

  // Get all cobros to calculate pending balances
  const { data: cobros } = await supabase
    .from('cobros')
    .select('monto, factura_id')
    .eq('workspace_id', workspaceId)

  const cobrosPorFactura = new Map<string, number>()
  ;(cobros ?? []).forEach(c => {
    const fid = c.factura_id
    if (!fid) return
    cobrosPorFactura.set(fid, (cobrosPorFactura.get(fid) ?? 0) + Number(c.monto))
  })

  // Return only facturas with pending balance
  return facturas
    .map(f => {
      const cobrado = cobrosPorFactura.get(f.id) ?? 0
      const saldo = Number(f.monto) - cobrado
      return {
        id: f.id,
        numero_factura: f.numero_factura ?? 'Sin numero',
        proyecto_nombre: (f.proyectos as unknown as { nombre: string })?.nombre ?? 'Sin proyecto',
        monto_total: Number(f.monto),
        saldo_pendiente: saldo,
      }
    })
    .filter(f => f.saldo_pendiente > 0.01)
    .sort((a, b) => b.saldo_pendiente - a.saldo_pendiente)
}
