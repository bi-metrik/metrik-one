import { redirect } from 'next/navigation'

/**
 * La gestion de equipo (ficha + areas + responsables por defecto) se unifico
 * en la seccion "Mi equipo" de /mi-negocio (2026-06-04). Esta ruta se conserva
 * solo para no romper enlaces/bookmarks antiguos.
 */
export default function EquipoAreasRedirect() {
  redirect('/mi-negocio')
}
