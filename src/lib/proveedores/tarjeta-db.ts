import 'server-only'

/**
 * El proveedor de cada hotel o tour de una cotización, con sus tarifarios y los de su mayorista,
 * para el aviso de vigencia de la tarjeta (Mauricio, 2026-10-18). Tres lecturas para TODAS las
 * tarjetas juntas, después de que `fotosParaTarjetas` resolvió los perfiles.
 *
 * Nunca rompe la tarjeta: si la migración `20261018150000` no está (o algo falla), devuelve un
 * mapa vacío y la tarjeta queda sin aviso.
 */
import { faltasDeFicha } from './completitud'
import type { ProveedorDeTarjeta, VigenciaTarifario } from './vigencia'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Cliente = any

interface Fila {
  id: string
  tipo: string
  clave: string
  nombre: string
  comprado_via_id?: string | null
  tipo_proveedor?: string | null
  ciudad?: string | null
  pais?: string | null
  departamento?: string | null
  notas?: string | null
  iva_declarado?: boolean | null
}

export async function proveedoresDeTarjetas(
  supabase: Cliente,
  workspaceId: string,
  perfiles: readonly { tipo: string; clave: string }[],
): Promise<Map<string, ProveedorDeTarjeta>> {
  const salida = new Map<string, ProveedorDeTarjeta>()
  const claves = [...new Set(perfiles.map((p) => p.clave))]
  if (claves.length === 0) return salida
  try {
    const { data: filas, error } = await supabase
      .from('fotos_perfiles')
      .select('id, tipo, clave, nombre, comprado_via_id, tipo_proveedor, ciudad, pais, departamento, notas, iva_declarado')
      .eq('workspace_id', workspaceId)
      .in('clave', claves)
    if (error || !filas) return salida
    const pedidos = new Set(perfiles.map((p) => `${p.tipo}:${p.clave}`))
    const mias = (filas as Fila[]).filter((f) => pedidos.has(`${f.tipo}:${f.clave}`))
    if (mias.length === 0) return salida
    const viaIds = [...new Set(mias.map((f) => f.comprado_via_id).filter((x): x is string => !!x))]
    const ids = [...new Set([...mias.map((f) => f.id), ...viaIds])]
    const [t, v] = await Promise.all([
      supabase.from('proveedor_tarifarios').select('proveedor_id, vigente_desde, vigente_hasta').eq('workspace_id', workspaceId).in('proveedor_id', ids),
      viaIds.length > 0
        ? supabase.from('fotos_perfiles').select('id, nombre').eq('workspace_id', workspaceId).in('id', viaIds)
        : Promise.resolve({ data: [], error: null }),
    ])
    if (t.error || v.error) return salida
    const porProveedor = new Map<string, VigenciaTarifario[]>()
    for (const r of (t.data ?? []) as { proveedor_id: string; vigente_desde: string | null; vigente_hasta: string | null }[]) {
      porProveedor.set(r.proveedor_id, [...(porProveedor.get(r.proveedor_id) ?? []), { desde: r.vigente_desde, hasta: r.vigente_hasta }])
    }
    const nombreVia = new Map(((v.data ?? []) as { id: string; nombre: string }[]).map((x) => [x.id, x.nombre]))
    for (const f of mias) {
      const via = f.comprado_via_id && nombreVia.has(f.comprado_via_id)
        ? { id: f.comprado_via_id, nombre: nombreVia.get(f.comprado_via_id) as string, tarifarios: porProveedor.get(f.comprado_via_id) ?? [] }
        : null
      salida.set(`${f.tipo}:${f.clave}`, {
        id: f.id,
        nombre: f.nombre,
        tarifarios: porProveedor.get(f.id) ?? [],
        via,
        faltas: faltasDeFicha({ tipo_proveedor: f.tipo_proveedor ?? 'otro', ciudad: f.ciudad ?? null, pais: f.pais ?? null, departamento: f.departamento ?? null, notas: f.notas ?? null }).map((x) => x.texto),
        ivaDeclarado: f.iva_declarado ?? null,
      })
    }
  } catch {
    // Sin aviso: la tarjeta sigue igual.
  }
  return salida
}
