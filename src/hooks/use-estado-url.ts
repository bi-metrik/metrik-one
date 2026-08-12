'use client'

import { useCallback, useState } from 'react'
import { aplicarFiltroEnQuery, parsearFiltro, type ValorFiltro } from '@/lib/filtros/url-estado'

/**
 * Valor vigente de un filtro según la URL. En el servidor no hay URL que leer y
 * forzarlo produciría un desajuste de hidratación, así que allí manda el default.
 */
function leerDeUrl<T extends ValorFiltro>(
  clave: string,
  porDefecto: T,
  admisibles?: readonly T[],
): T {
  if (typeof window === 'undefined') return porDefecto
  const texto = new URLSearchParams(window.location.search).get(clave)
  const parseado = parsearFiltro(texto, porDefecto) as T
  if (admisibles && !admisibles.includes(parseado)) return porDefecto
  return parseado
}

/**
 * `useState` que además recuerda el valor en la query string.
 *
 * Nació para los filtros de las listas de negocios y contactos: vivían solo en estado
 * de React, así que filtrar, entrar a un caso y volver los borraba. Al volver atrás el
 * navegador restaura la URL con sus parámetros y el componente monta leyéndolos.
 *
 * Misma firma que `useState` a propósito, forma funcional incluida: adoptar un filtro
 * es cambiar su línea de declaración, sin tocar los sitios donde se usa el setter.
 *
 * ⚠️ Escribe con `history.replaceState`, NO con el router de Next. Un `router.replace`
 * de la misma ruta vuelve a ejecutar el server component y refetchea la lista entera
 * en cada tecla del buscador. Aquí la lista ya está en memoria y el filtrado es
 * cliente: la URL solo tiene que reflejar lo elegido, no provocar una navegación.
 * `replaceState` tampoco acumula entradas de historial, así que el botón atrás sigue
 * llevando a la pantalla anterior y no a los estados intermedios del filtro.
 */
export function useEstadoUrl<T extends ValorFiltro>(
  clave: string,
  porDefecto: T,
  opciones?: {
    /**
     * Valores admisibles, para filtros con un conjunto cerrado (fase, orden, motivo de
     * cierre). Sin esto, `?fase=basura` deja la lista vacía sin que se entienda por qué.
     */
    admisibles?: readonly T[]
    /**
     * Valor que el SERVIDOR ya resolvió desde `searchParams`.
     *
     * ⚠️ Sin esto hay desajuste de hidratación, y se ve: el servidor pinta el default
     * (buscador vacío, 253 casos) y el cliente hidrata con lo que dice la URL (1 caso).
     * React descarta ese subárbol y lo vuelve a renderizar, con parpadeo y un error en
     * consola en cada carga con filtros. Medido en `/negocios?q=abogal` el 2026-08-12:
     * el HTML del servidor traía `value=""` y el cliente `"abogal"`.
     */
    inicial?: T
  },
): [T, (valor: T | ((anterior: T) => T)) => void] {
  const admisibles = opciones?.admisibles
  const inicial = opciones?.inicial
  const [valor, setValorState] = useState<T>(
    () => inicial !== undefined ? inicial : leerDeUrl(clave, porDefecto, admisibles),
  )

  const setValor = useCallback(
    (nuevo: T | ((anterior: T) => T)) => {
      // Para la forma funcional, el "anterior" se lee de la URL: es la fuente de verdad
      // del filtro y la escribimos en cada cambio. Así el efecto (escribir la URL) queda
      // fuera del updater de `setState`, que React puede invocar dos veces, y no hace
      // falta un ref leído durante el render.
      const resuelto = typeof nuevo === 'function'
        ? (nuevo as (anterior: T) => T)(leerDeUrl(clave, porDefecto, admisibles))
        : nuevo
      setValorState(resuelto)
      if (typeof window === 'undefined') return
      const query = aplicarFiltroEnQuery(window.location.search, clave, resuelto, porDefecto)
      const url = query ? `${window.location.pathname}?${query}` : window.location.pathname
      window.history.replaceState(window.history.state, '', url)
    },
    [clave, porDefecto, admisibles],
  )

  return [valor, setValor]
}
