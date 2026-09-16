/**
 * Workspaces archivados: muestras comerciales que ya no se trabajan y que no se
 * borran. La marca es `workspaces.config_extra.archivado = true` (jsonb, sin columna
 * ni migración).
 *
 * Archivar solo los SACA DE LOS LISTADOS donde alguien escoge o recorre workspaces
 * (el selector del platform admin, la biblioteca de `/admin/workflows`). No apaga
 * nada: el subdominio sigue abriendo, los crons lo siguen recorriendo y
 * `switchWorkspace` sigue aceptando su id. Si algún día archivar tiene que significar
 * "apagado", eso es otra decisión y otro cambio.
 *
 * Estricto a propósito, igual que `modo_vitrina` en `vitrina.ts`: solo el booleano
 * JSON `true` archiva. Un `"true"` en texto, un `1` o una clave ausente NO archivan,
 * para que un dato mal escrito deje el workspace a la vista (se nota) en vez de
 * esconderlo (no se nota).
 */

/**
 * `valor` es lo que devuelve PostgREST para `archivado:config_extra->archivado`
 * (flecha simple: conserva el tipo JSON), o el `config_extra.archivado` ya leído.
 */
export function estaArchivado(valor: unknown): boolean {
  return valor === true
}

export type WorkspaceConMarca = {
  id: string
  slug: string
  name: string
  archivado?: unknown
}

export type WorkspaceDelSelector = {
  id: string
  slug: string
  name: string
}

export type SelectorDeWorkspaces = {
  /** Lo que se ofrece para escoger: sin archivados. */
  workspaces: WorkspaceDelSelector[]
  /** Resuelto contra la lista COMPLETA: puede ser un archivado. */
  currentWorkspace: WorkspaceDelSelector | null
  /** Resuelto contra la lista COMPLETA: puede ser un archivado. */
  homeWorkspace: WorkspaceDelSelector | null
}

function resumen(w: WorkspaceConMarca): WorkspaceDelSelector {
  return { id: w.id, slug: w.slug, name: w.name }
}

/**
 * Arma el estado del selector del platform admin.
 *
 * ⚠️ El actual y el home se buscan en la lista COMPLETA, no en la filtrada. Si el
 * admin está parado dentro de un workspace archivado (entró antes de archivarlo, o
 * por URL), la barra tiene que seguir diciendo dónde está y cómo volver: resolverlo
 * contra la lista filtrada lo pintaría como "(desconocido)" y dejaría el botón de
 * regreso sin nombre.
 */
export function armarSelectorDeWorkspaces(
  todos: WorkspaceConMarca[],
  workspaceActualId: string | null,
  homeWorkspaceId: string | null,
): SelectorDeWorkspaces {
  const actual = workspaceActualId ? todos.find(w => w.id === workspaceActualId) : undefined
  const home = homeWorkspaceId ? todos.find(w => w.id === homeWorkspaceId) : undefined

  return {
    workspaces: todos.filter(w => !estaArchivado(w.archivado)).map(resumen),
    currentWorkspace: actual ? resumen(actual) : null,
    homeWorkspace: home ? resumen(home) : null,
  }
}
