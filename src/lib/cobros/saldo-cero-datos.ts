/**
 * El saldo del gate `saldo_cero`, leído de la base. Lo usan el gate de `cambiarEtapa` y el panel
 * de Cierre económico, para que la pantalla diga el mismo número que frena.
 *
 * Falla CERRADO: si algo no se puede leer, devuelve `error` y quien llama retiene.
 */

import { calcularSaldoCero, COLUMNAS_COBRO_SALDO_CERO, precioParaSaldoCero, type CobroSaldoCero, type SaldoCero } from './saldo-cero'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = any

export async function leerSaldoCero(
  db: Db,
  args: { workspaceId: string; negocioId: string },
): Promise<{ ok: true; saldo: SaldoCero } | { ok: false; error: string }> {
  const [negRes, cobrosRes, concRes] = await Promise.all([
    db.from('negocios').select('precio_aprobado, precio_estimado').eq('id', args.negocioId).eq('workspace_id', args.workspaceId).maybeSingle(),
    db.from('cobros').select(COLUMNAS_COBRO_SALDO_CERO).eq('negocio_id', args.negocioId).eq('workspace_id', args.workspaceId),
    db.from('negocio_conciliacion').select('conciliado').eq('negocio_id', args.negocioId).eq('workspace_id', args.workspaceId).maybeSingle(),
  ])
  if (negRes.error || !negRes.data || cobrosRes.error || concRes.error) {
    const msg = negRes.error?.message ?? cobrosRes.error?.message ?? concRes.error?.message ?? 'negocio no encontrado'
    console.error('[saldo_cero] no se pudo leer el saldo:', msg)
    return { ok: false, error: 'No se pudo revisar el saldo del negocio. Intenta de nuevo.' }
  }
  return {
    ok: true,
    saldo: calcularSaldoCero({
      precio: precioParaSaldoCero(negRes.data as { precio_aprobado?: number | null; precio_estimado?: number | null }),
      cobros: (cobrosRes.data ?? []) as CobroSaldoCero[],
      conciliado: (concRes.data as { conciliado?: boolean } | null)?.conciliado === true,
    }),
  }
}
