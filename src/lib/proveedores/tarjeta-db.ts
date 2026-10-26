import 'server-only'

/**
 * El proveedor de cada hotel o tour de una cotización, con sus tarifarios y los de su mayorista,
 * para el aviso de vigencia de la tarjeta (Mauricio, 2026-10-18). Tres lecturas para TODAS las
 * tarjetas juntas, después de que `fotosParaTarjetas` resolvió los perfiles.
 *
 * Una sola vigencia (2026-10-19, punto 6): si el proveedor (o la ficha de la que toma el tarifario
 * de cadena) tiene una extracción REVISADA, el aviso usa su vigencia confirmada; las fechas de
 * `proveedor_tarifarios` quedan solo como respaldo para quien no la tiene.
 *
 * Nunca rompe la tarjeta: si la migración `20261018150000` no está (o algo falla), devuelve un
 * mapa vacío y la tarjeta queda sin aviso.
 */
import { createServiceClient } from '@/lib/supabase/server'
import { faltasDeFicha } from './completitud'
import { vigenciasConfirmadas } from './extraccion-para-cotizar'
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
  tarifario_de_id?: string | null
}

/** Las fichas con sus tarifarios (o la vigencia confirmada de su extracción), por id de ficha. */
async function armar(supabase: Cliente, workspaceId: string, fichas: readonly Fila[]): Promise<Map<string, ProveedorDeTarjeta>> {
  const salida = new Map<string, ProveedorDeTarjeta>()
  if (fichas.length === 0) return salida
  const viaIds = [...new Set(fichas.map((f) => f.comprado_via_id).filter((x): x is string => !!x))]
  const ids = [...new Set([...fichas.map((f) => f.id), ...viaIds])]
  const [t, v] = await Promise.all([
    supabase.from('proveedor_tarifarios').select('proveedor_id, vigente_desde, vigente_hasta').eq('workspace_id', workspaceId).in('proveedor_id', ids),
    viaIds.length > 0
      ? supabase.from('fotos_perfiles').select('*').eq('workspace_id', workspaceId).in('id', viaIds)
      : Promise.resolve({ data: [], error: null }),
  ])
  if (t.error || v.error) return salida
  const vias = (v.data ?? []) as Fila[]
  // De qué ficha sale la extracción de cada una: la suya o la de la cadena.
  const fuente = (f: Fila) => f.tarifario_de_id ?? f.id
  const confirmadas = await vigenciasConfirmadas(createServiceClient(), workspaceId, [...fichas, ...vias].map(fuente))
  const porProveedor = new Map<string, VigenciaTarifario[]>()
  for (const r of (t.data ?? []) as { proveedor_id: string; vigente_desde: string | null; vigente_hasta: string | null }[]) {
    porProveedor.set(r.proveedor_id, [...(porProveedor.get(r.proveedor_id) ?? []), { desde: r.vigente_desde, hasta: r.vigente_hasta }])
  }
  const tarifarios = (f: Fila): VigenciaTarifario[] => {
    const c = confirmadas.get(fuente(f))
    return c ? [{ desde: c.desde, hasta: c.hasta }] : porProveedor.get(f.id) ?? []
  }
  const viaPorId = new Map(vias.map((x) => [x.id, x]))
  for (const f of fichas) {
    const via = f.comprado_via_id ? viaPorId.get(f.comprado_via_id) : undefined
    salida.set(f.id, {
      id: f.id,
      nombre: f.nombre,
      tarifarios: tarifarios(f),
      via: via ? { id: via.id, nombre: via.nombre, tarifarios: tarifarios(via) } : null,
      faltas: faltasDeFicha({ tipo_proveedor: f.tipo_proveedor ?? 'otro', ciudad: f.ciudad ?? null, pais: f.pais ?? null, departamento: f.departamento ?? null, notas: f.notas ?? null }).map((x) => x.texto),
      ivaDeclarado: f.iva_declarado ?? null,
    })
  }
  return salida
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
    // `select('*')`: `tarifario_de_id` la agrega `20261019203000`; nombrarla rompería sin ella.
    const { data: filas, error } = await supabase.from('fotos_perfiles').select('*').eq('workspace_id', workspaceId).in('clave', claves)
    if (error || !filas) return salida
    const pedidos = new Set(perfiles.map((p) => `${p.tipo}:${p.clave}`))
    const mias = (filas as Fila[]).filter((f) => pedidos.has(`${f.tipo}:${f.clave}`))
    const porId = await armar(supabase, workspaceId, mias)
    for (const f of mias) {
      const p = porId.get(f.id)
      if (p) salida.set(`${f.tipo}:${f.clave}`, p)
    }
  } catch {
    // Sin aviso: la tarjeta sigue igual.
  }
  return salida
}

/**
 * Las fichas que la línea FIJÓ (`items.proveedor_id`, 2026-10-19): el aviso de la tarjeta sale de
 * ellas y no del nombre leído. Por id de ficha.
 */
export async function proveedoresPorId(supabase: Cliente, workspaceId: string, ids: readonly string[]): Promise<Map<string, ProveedorDeTarjeta>> {
  const unicos = [...new Set(ids.filter((x) => typeof x === 'string' && x))].slice(0, 200)
  if (unicos.length === 0) return new Map()
  try {
    const { data: filas, error } = await supabase.from('fotos_perfiles').select('*').eq('workspace_id', workspaceId).in('id', unicos)
    if (error || !filas) return new Map()
    return await armar(supabase, workspaceId, filas as Fila[])
  } catch {
    return new Map()
  }
}
