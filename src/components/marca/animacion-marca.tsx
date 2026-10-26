import type { CSSProperties } from 'react'
import estilos from './animacion-marca.module.css'

/**
 * La animacion de marca de ONE, para pintar DENTRO de una espera real.
 *
 * Sin `'use client'` a proposito: es CSS puro, sin estado ni temporizadores, asi que
 * el estado de carga de `(app)` la sirve desde el servidor y no le suma JavaScript a
 * ninguna pagina. Quien elige la variante (la intro una vez por sesion) es
 * `useIntroDeMarca`, del lado del cliente.
 *
 * No es un overlay: ocupa el hueco de lo que todavia no llego y se va cuando el
 * contenido lo reemplaza. Aparece con retardo para que una espera corta no parpadee.
 */
export type VarianteMarca = 'intro' | 'liviana'

/** Cuando el haz pasa por cada letra, en ms desde que se monta (curva del splash original). */
export const LETRAS_MARCA = [
  { ch: 'M', ms: 300 },
  { ch: 'é', ms: 362 },
  { ch: 'T', ms: 415 },
  { ch: 'R', ms: 473 },
  { ch: 'I', ms: 528 },
  { ch: 'K', ms: 572 },
] as const

interface AnimacionMarcaProps {
  variante?: VarianteMarca
  /** Texto para lectores de pantalla. */
  etiqueta?: string
  /** Tamaño de la letra (CSS). Por defecto escala entre 2,2 y 3,2 rem. */
  tamano?: string
  /** Cuanto espera antes de mostrarse. Por defecto 300 ms. */
  retardoMs?: number
  className?: string
}

export default function AnimacionMarca({
  variante = 'liviana',
  etiqueta = 'Cargando',
  tamano,
  retardoMs = 300,
  className,
}: AnimacionMarcaProps) {
  const vars = {
    '--retardo': `${retardoMs}ms`,
    ...(tamano ? { '--tamano': tamano } : {}),
  } as CSSProperties

  return (
    <div
      role="status"
      aria-live="polite"
      data-animacion-marca={variante}
      className={[estilos.raiz, estilos[variante], className].filter(Boolean).join(' ')}
      style={vars}
    >
      <span className={estilos.oculto}>{etiqueta}</span>
      <div className={estilos.lockup} aria-hidden="true">
        <div className={estilos.fila}>
          {LETRAS_MARCA.map((l) => (
            <span
              key={l.ch}
              className={estilos.letra}
              style={{ '--d': `${l.ms}ms` } as CSSProperties}
            >
              {l.ch}
            </span>
          ))}
          <span className={estilos.unoWrap}>
            <span className={estilos.destello} />
            <span className={estilos.one}>one</span>
          </span>
        </div>
        <div className={estilos.pista}>
          <div className={estilos.estela} />
          <div className={estilos.orbe} />
          <div className={estilos.brillo} />
        </div>
      </div>
    </div>
  )
}
