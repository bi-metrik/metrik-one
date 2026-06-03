/**
 * Resuelve created_by (uuid) -> nombre del usuario, en lote (evita N+1).
 * Usado por los historiales de consultas de listas para trazabilidad:
 * mostrar SIEMPRE quien realizo cada consulta.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function resolverNombresUsuarios(svc: any, ids: Array<string | null | undefined>): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  const unicos = Array.from(new Set(ids.filter(Boolean))) as string[];
  if (unicos.length === 0) return map;
  const { data } = await svc.from('profiles').select('id, full_name').in('id', unicos);
  for (const p of (data ?? []) as Array<{ id: string; full_name: string | null }>) {
    if (p.full_name) map.set(p.id, p.full_name);
  }
  return map;
}
