import 'server-only'

/**
 * La extracción con la que se cotiza un proveedor (Mauricio, 2026-10-19, punto 5): la ÚLTIMA
 * `revisada` (carga cerrada, no descartada). Un borrador posterior (otra corrida del motor que nadie
 * ha revisado) NO le quita los precios a la cotización: se avisa en la ficha como «hay una extracción
 * nueva por revisar».
 *
 * `proveedor_extracciones` es server-only: se lee con el cliente de servicio y SIEMPRE filtrando por
 * workspace. Sin la migración del motor v13 (sin `estado = 'revisada'` posible) devuelve `null`.
 */
import type { AjustesMoneda } from './tarifas-extraidas'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Cliente = any

export interface ExtraccionRevisadaFila {
  id: string
  proveedor_id: string
  created_at: string
  estado: 'revisada'
  tarifario: Record<string, unknown> | null
  vigencia_desde: string | null
  vigencia_hasta: string | null
  monedas: AjustesMoneda | null
}

export interface ExtraccionParaCotizar {
  revisada: ExtraccionRevisadaFila | null
  /** Hay un borrador más nuevo que la revisada (o, sin revisada, cualquier borrador). */
  nuevaPorRevisar: boolean
  error: { code?: string; message?: string } | null
}

export async function extraccionParaCotizar(servicio: Cliente, workspaceId: string, proveedorId: string): Promise<ExtraccionParaCotizar> {
  const { data, error } = await servicio
    .from('proveedor_extracciones')
    .select('*')
    .eq('workspace_id', workspaceId)
    .eq('proveedor_id', proveedorId)
    .eq('estado', 'revisada')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (error) return { revisada: null, nuevaPorRevisar: false, error }
  const revisada = (data as ExtraccionRevisadaFila | null) ?? null
  const { data: borradores } = await servicio
    .from('proveedor_extracciones')
    .select('id, created_at')
    .eq('workspace_id', workspaceId)
    .eq('proveedor_id', proveedorId)
    .eq('estado', 'borrador')
    .order('created_at', { ascending: false })
    .limit(1)
  const ultimoBorrador = ((borradores ?? []) as { created_at: string }[])[0] ?? null
  const nuevaPorRevisar = !!ultimoBorrador && (!revisada || ultimoBorrador.created_at > revisada.created_at)
  return { revisada, nuevaPorRevisar, error: null }
}

/** La vigencia confirmada de la extracción con la que se cotiza cada proveedor (para el aviso de la tarjeta). */
export async function vigenciasConfirmadas(servicio: Cliente, workspaceId: string, proveedorIds: readonly string[]): Promise<Map<string, { desde: string; hasta: string }>> {
  const salida = new Map<string, { desde: string; hasta: string }>()
  if (proveedorIds.length === 0) return salida
  try {
    const { data, error } = await servicio
      .from('proveedor_extracciones')
      .select('proveedor_id, created_at, vigencia_desde, vigencia_hasta')
      .eq('workspace_id', workspaceId)
      .eq('estado', 'revisada')
      .in('proveedor_id', [...new Set(proveedorIds)].slice(0, 300))
      .order('created_at', { ascending: false })
    if (error) return salida
    for (const r of (data ?? []) as { proveedor_id: string; vigencia_desde: string | null; vigencia_hasta: string | null }[]) {
      // Ordenadas de la más nueva a la más vieja: la primera de cada proveedor es la que cuenta.
      if (salida.has(r.proveedor_id) || !r.vigencia_desde || !r.vigencia_hasta) continue
      salida.set(r.proveedor_id, { desde: r.vigencia_desde, hasta: r.vigencia_hasta })
    }
  } catch {
    // Sin aviso por extracción: queda el de los tarifarios.
  }
  return salida
}
