/**
 * Grupo de un workspace en los listados donde MéTRIK escoge o recorre workspaces
 * (el selector del platform admin, el desplegable de `/admin/workflows`). La marca es
 * `workspaces.config_extra.grupo` (texto en jsonb, sin columna ni migración).
 *
 * ⚠️ NO es `workspaces.tipo`. `tipo` ('nativo' | 'clarity') decide comportamiento del
 * producto (por ejemplo, la pestaña "Mi flujo" de mi-negocio); `grupo` solo decide en
 * qué encabezado aparece el workspace. Son ejes distintos: un CDA de Valida es `tipo`
 * nativo y `grupo` valida.
 *
 * Nunca esconde nada: un grupo ausente, vacío o desconocido cae en "Sin clasificar",
 * que va al final. Estricto a propósito, igual que `archivado`: solo la clave exacta en
 * minúsculas cuenta. Un `"Valida"` con mayúscula queda a la vista en "Sin clasificar"
 * (se nota y se corrige) en vez de adivinarse.
 */

/** Orden de los encabezados. MéTRIK siempre primero, "Sin clasificar" siempre al final. */
export const GRUPOS_DE_WORKSPACE = [
  { clave: 'metrik', etiqueta: 'MéTRIK' },
  { clave: 'valida', etiqueta: 'Valida' },
  { clave: 'clarity', etiqueta: 'Clarity' },
  { clave: 'sustenta', etiqueta: 'Sustenta' },
  { clave: 'demo', etiqueta: 'Demo' },
  { clave: 'sin_clasificar', etiqueta: 'Sin clasificar' },
] as const

export type GrupoDeWorkspace = (typeof GRUPOS_DE_WORKSPACE)[number]['clave']

const CLAVES_CONOCIDAS: ReadonlySet<string> = new Set(
  GRUPOS_DE_WORKSPACE.map(g => g.clave).filter(c => c !== 'sin_clasificar'),
)

/**
 * `valor` es lo que devuelve PostgREST para `grupo:config_extra->grupo` o una clave ya
 * normalizada (la función es idempotente).
 */
export function grupoDeWorkspace(valor: unknown): GrupoDeWorkspace {
  if (typeof valor === 'string' && CLAVES_CONOCIDAS.has(valor)) {
    return valor as GrupoDeWorkspace
  }
  return 'sin_clasificar'
}

export type GrupoDelSelector<T> = {
  clave: GrupoDeWorkspace
  etiqueta: string
  workspaces: T[]
}

type Agrupable = { name: string | null; slug?: string | null; grupo?: unknown }

function compararPorNombre(a: Agrupable, b: Agrupable): number {
  const porNombre = (a.name ?? '').localeCompare(b.name ?? '', 'es', { sensitivity: 'base' })
  if (porNombre !== 0) return porNombre
  // Desempate estable para que dos nombres "iguales" no bailen entre renders.
  return (a.slug ?? '').localeCompare(b.slug ?? '', 'es')
}

/**
 * Agrupa en el orden de `GRUPOS_DE_WORKSPACE`, ordena por nombre dentro de cada grupo y
 * descarta los grupos vacíos (por ejemplo, tras filtrar por la búsqueda).
 */
export function agruparWorkspaces<T extends Agrupable>(workspaces: readonly T[]): GrupoDelSelector<T>[] {
  const porClave = new Map<GrupoDeWorkspace, T[]>()
  for (const w of workspaces) {
    const clave = grupoDeWorkspace(w.grupo)
    const lista = porClave.get(clave)
    if (lista) lista.push(w)
    else porClave.set(clave, [w])
  }

  return GRUPOS_DE_WORKSPACE.flatMap(({ clave, etiqueta }) => {
    const lista = porClave.get(clave)
    if (!lista || lista.length === 0) return []
    return [{ clave, etiqueta, workspaces: [...lista].sort(compararPorNombre) }]
  })
}
