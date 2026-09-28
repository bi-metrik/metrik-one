/**
 * La biblioteca de temas del Radar: 97 temas en 14 grupos y 8 perfiles de fábrica.
 *
 * Vive en código (`biblioteca.json`, copia fiel de `metrik-data/temas.json`) y NO en la base, por
 * la misma razón que `src/lib/modulos/catalogo.ts`: es vocabulario versionado, se calibra con
 * pruebas y un cambio suyo mueve todos los puntajes a la vez. Lo que sí vive en la base es qué
 * temas mira cada workspace, con qué pesos y qué excluye (`radar_perfiles`, `radar_temas`), que es
 * lo que hasta hoy vivía en el `localStorage` del navegador y se perdía al cambiar de máquina.
 *
 * Es **multisector a propósito**: MeTRIK es uno de los perfiles, no «el bueno». Las exclusiones
 * dejaron de ser globales el 2026-09-28 porque lo que para MeTRIK es ruido (OBRA, ASEO, VIAL) para
 * una constructora es exactamente su negocio.
 *
 * Puro: lo importan el cron, el servidor y la pantalla.
 */
import crudo from './biblioteca.json'
import type { Exclusiones, Tema } from './puntuar'

export interface GrupoTema {
  id: string
  nombre: string
}

/** Un perfil de fábrica: qué temas mira un sector, con qué pesos y qué excluye. */
export interface PerfilDeFabrica {
  nombre: string
  temas: readonly string[]
  /** Peso que pisa el de fábrica del tema, por id. */
  pesos: Readonly<Record<string, number>>
  exclusiones: Exclusiones
}

export interface Biblioteca {
  version: number
  actualizado: string
  grupos: readonly GrupoTema[]
  temas: readonly Tema[]
  /** Umbral de señal fuerte: un tema positivo de este peso o más topa el castigo de compra. */
  senalFuerte: number
  perfiles: Readonly<Record<string, PerfilDeFabrica>>
  /** Por qué hay que descartar leyendo el pliego. Es el aviso de la pantalla, no una regla. */
  descartesDePliego: readonly string[]
  /** Modalidades que no exigen RUP inscrito. */
  sinRup: readonly string[]
  /** Tipos de contrato que son compra de bienes (no servicio). */
  tiposCompra: readonly string[]
}

interface Crudo {
  version: number
  actualizado: string
  grupos: GrupoTema[]
  temas: Tema[]
  senal_fuerte: number
  perfiles: Record<string, { nombre: string; temas: string[]; pesos?: Record<string, number>; exclusiones?: Exclusiones }>
  descartes_de_pliego: string[]
  sin_rup: string[]
  tipos_compra: string[]
}

const c = crudo as unknown as Crudo

export const BIBLIOTECA: Biblioteca = {
  version: c.version,
  actualizado: c.actualizado,
  grupos: c.grupos,
  temas: c.temas,
  senalFuerte: c.senal_fuerte,
  perfiles: Object.fromEntries(
    Object.entries(c.perfiles).map(([k, p]) => [
      k,
      { nombre: p.nombre, temas: p.temas, pesos: p.pesos ?? {}, exclusiones: p.exclusiones ?? {} },
    ]),
  ),
  descartesDePliego: c.descartes_de_pliego,
  sinRup: c.sin_rup,
  tiposCompra: c.tipos_compra,
}

/** Perfiles de fábrica, por clave. `vacio` es empezar en blanco. */
export const PRESETS = BIBLIOTECA.perfiles
export type ClavePreset = keyof typeof PRESETS

export function esPreset(clave: string): boolean {
  return Object.prototype.hasOwnProperty.call(PRESETS, clave)
}

/**
 * Qué mira este workspace: los temas de la biblioteca más los suyos, con el peso que el perfil
 * haya ajustado, filtrados a los seleccionados. Es lo que se le pasa a `puntuar`.
 *
 * Un tema propio con el mismo id que uno de la biblioteca **pisa** al de la biblioteca: así un
 * cliente puede recalibrar los términos de un tema sin que nadie le edite el JSON.
 */
export function temasActivos(p: {
  seleccionados: readonly string[]
  pesos?: Readonly<Record<string, number>>
  propios?: readonly Tema[]
}): Tema[] {
  const porId = new Map<string, Tema>()
  for (const t of BIBLIOTECA.temas) porId.set(t.id, t)
  for (const t of p.propios ?? []) porId.set(t.id, t)
  const sel = new Set(p.seleccionados)
  return [...porId.values()]
    .filter((t) => sel.has(t.id))
    .map((t) => ({ ...t, peso: p.pesos?.[t.id] ?? t.peso }))
}

/** El perfil de fábrica como estado inicial de un workspace nuevo. */
export function perfilDesdePreset(clave: string): {
  preset: string
  nombre: string
  seleccionados: string[]
  pesos: Record<string, number>
  exclusiones: string[]
} {
  const base = esPreset(clave) ? PRESETS[clave] : PRESETS.vacio
  return {
    preset: esPreset(clave) ? clave : 'vacio',
    nombre: base.nombre,
    seleccionados: [...base.temas],
    // Las exclusiones se guardan aplanadas en `radar_perfiles.exclusiones` (una lista de texto,
    // que es lo que el cliente edita), pero se APLICAN con la distinción stem/palabra: ver
    // `exclusionesDeLista`.
    pesos: { ...base.pesos },
    exclusiones: [...(base.exclusiones.stems ?? []), ...(base.exclusiones.palabras ?? [])],
  }
}

/**
 * Reconstruye `Exclusiones` desde la lista plana que guarda `radar_perfiles`.
 *
 * Una entrada es **stem** (substring) si la biblioteca la declara como stem en algún perfil de
 * fábrica; si no, es **palabra** (palabra completa). Sin esta tabla, todo sería substring y
 * `VIGILANCIA` volvería a excluir `VIDEOVIGILANCIA` — los 4 procesos de más que se midieron el
 * 2026-09-28 (ver la cabecera de `puntuar.ts`).
 */
const STEMS_CONOCIDOS: ReadonlySet<string> = new Set(
  Object.values(PRESETS).flatMap((p) => (p.exclusiones.stems ?? []).map((s) => s.trim().toUpperCase())),
)

export function exclusionesDeLista(lista: readonly string[]): Exclusiones {
  const stems: string[] = []
  const palabras: string[] = []
  for (const e of lista) {
    const limpia = e.trim()
    if (!limpia) continue
    if (STEMS_CONOCIDOS.has(limpia.toUpperCase())) stems.push(limpia)
    else palabras.push(limpia)
  }
  return { stems, palabras }
}
