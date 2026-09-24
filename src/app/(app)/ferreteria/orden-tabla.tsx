'use client'

import { useState } from 'react'
import { ArrowDown, ArrowUp, ArrowUpDown } from 'lucide-react'
import { ordenarFilas, type DireccionOrden, type ValorOrden } from '@/lib/ferreteria/orden'

/**
 * Orden por columna de las tablas de Ferretería. Primer clic en una columna: ascendente;
 * el siguiente: descendente (y así alterna). Cambiar de columna vuelve a ascendente.
 * `clave` null = la tabla conserva el orden en que llegan las filas.
 */
export interface EstadoOrden<K extends string> {
  clave: K | null
  dir: DireccionOrden
  alternar: (k: K) => void
}

export function useOrden<K extends string>(inicial: { clave: K | null; dir: DireccionOrden } = { clave: null, dir: 'asc' }): EstadoOrden<K> {
  const [estado, setEstado] = useState(inicial)
  return {
    clave: estado.clave,
    dir: estado.dir,
    alternar: (k) =>
      setEstado((e) => (e.clave === k ? { clave: k, dir: e.dir === 'asc' ? 'desc' : 'asc' } : { clave: k, dir: 'asc' })),
  }
}

/** Aplica el orden vigente. `columnas` dice, por clave, qué valor de la fila se compara. */
export function aplicarOrden<T, K extends string>(
  filas: readonly T[],
  orden: Pick<EstadoOrden<K>, 'clave' | 'dir'>,
  columnas: Record<K, (fila: T) => ValorOrden>,
): readonly T[] {
  return orden.clave ? ordenarFilas(filas, columnas[orden.clave], orden.dir) : filas
}

export function Th<K extends string>({
  orden,
  clave,
  children,
  derecha,
  className = '',
}: {
  orden: EstadoOrden<K>
  clave: K
  children: React.ReactNode
  derecha?: boolean
  className?: string
}) {
  const activa = orden.clave === clave
  const Icono = !activa ? ArrowUpDown : orden.dir === 'asc' ? ArrowUp : ArrowDown
  return (
    <th
      className={`whitespace-nowrap ${derecha ? 'text-right' : ''} ${className}`}
      aria-sort={activa ? (orden.dir === 'asc' ? 'ascending' : 'descending') : 'none'}
    >
      <button
        type="button"
        onClick={() => orden.alternar(clave)}
        className={`inline-flex items-center gap-1 hover:text-foreground ${activa ? 'text-foreground' : ''}`}
      >
        {children}
        <Icono className={`h-3 w-3 shrink-0 ${activa ? '' : 'opacity-40'}`} aria-hidden />
      </button>
    </th>
  )
}
