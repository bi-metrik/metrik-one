/**
 * Buscar un usuario de Auth por correo SIN listar `auth.users` entero.
 *
 * Por qué no `sb.auth.admin.listUsers()`: en producción hay una fila de otro cliente con
 * `banned_until = 'infinity'`, que GoTrue no sabe leer («Scan error on column index 1, name
 * "banned_until": unsupported Scan, storing driver.Value type string into type *time.Time»).
 * Cualquier página que la incluya devuelve «Database error finding users», y como el orden no
 * se controla, el listado falla siempre. Ese dato no se toca (decisión de Mauricio, 2026-10-14).
 *
 * La vía: el mismo endpoint admin (`GET /auth/v1/admin/users`) con su parámetro `filter`, que
 * GoTrue convierte en `email LIKE '%<filtro>%' OR full_name ILIKE '%<filtro>%'` ANTES de leer
 * las filas. Con el correo completo como filtro solo se escanean las filas de ese correo y la
 * fila rota queda fuera. El SDK no expone `filter`, por eso va por `fetch`. Sin migración y de
 * solo lectura.
 *
 * El `LIKE` trae coincidencias parciales (`_` es comodín, y `a@x.co` está dentro de
 * `ba@x.co`): se compara el correo exacto después. Si el endpoint falla, se para: crear a ciegas
 * un usuario que ya existe deja un perfil sin dueño.
 */

const POR_PAGINA = 1000

export async function buscarIdDeAuthPorCorreo(
  url: string,
  llave: string,
  correo: string,
  f: typeof fetch = fetch,
): Promise<string | null> {
  const buscado = correo.trim().toLowerCase()
  const q = new URLSearchParams({ page: '1', per_page: String(POR_PAGINA), filter: buscado })
  const r = await f(`${url.replace(/\/$/, '')}/auth/v1/admin/users?${q}`, {
    headers: { apikey: llave, Authorization: `Bearer ${llave}` },
  })
  if (!r.ok) {
    const cuerpo = await r.text().catch(() => '')
    throw new Error(`Buscar ${buscado} en Auth (filtro por correo): ${r.status} ${cuerpo.slice(0, 200)}`)
  }
  const data = (await r.json()) as { users?: { id: string; email?: string | null }[] }
  const usuarios = data.users ?? []
  const u = usuarios.find(x => (x.email ?? '').toLowerCase() === buscado)
  if (u) return u.id
  if (usuarios.length >= POR_PAGINA) {
    throw new Error(`El filtro por ${buscado} trajo ${usuarios.length} usuarios sin el exacto: búsqueda cortada.`)
  }
  return null
}
