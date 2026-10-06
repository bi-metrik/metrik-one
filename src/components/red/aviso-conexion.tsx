import type { CSSProperties, ReactNode } from 'react'
import { RefreshCw } from 'lucide-react'
import AnimacionMarca from '@/components/marca/animacion-marca'
import {
  ATRIBUTO_CAUSA,
  ATRIBUTO_REINTENTAR,
  AVISO_CONEXION,
  LIMITE_ESPERA_RUTA_MS,
  animacionAparecer,
  animacionOcultar,
  type CausaAvisoConexion,
} from '@/lib/red/aviso-conexion'

/**
 * El aviso "No pudimos conectar con ONE" (ver `lib/red/aviso-conexion.ts`).
 *
 * Sin `'use client'` a propósito: lo pinta el `loading.tsx` de `(app)` desde el servidor, y
 * tiene que funcionar aunque React nunca hidrate ese fallback (el stream de la página se
 * cortó y el Suspense queda deshidratado). Por eso el botón no lleva `onClick`: lleva
 * `data-one-reintentar`, y el clic lo atiende el script en línea del layout raíz, que corre
 * sin chunks. `destino` = a dónde recargar (vacío = la página actual).
 */
export function AvisoConexion({
  destino,
  onReintentar,
  className,
}: {
  destino?: string | null
  /** Solo para pantallas ya hidratadas (`error.tsx`); sin él, el script atiende el clic. */
  onReintentar?: () => void
  className?: string
}) {
  return (
    <div
      role="alert"
      className={['flex flex-col items-center justify-center gap-4 px-6 text-center', className]
        .filter(Boolean)
        .join(' ')}
    >
      <h2 className="text-lg font-semibold text-foreground">{AVISO_CONEXION.titulo}</h2>
      <p className="max-w-md text-sm text-muted-foreground">{AVISO_CONEXION.cuerpo}</p>
      <button
        type="button"
        {...(onReintentar ? { onClick: onReintentar } : { [ATRIBUTO_REINTENTAR]: destino ?? '' })}
        className="inline-flex items-center gap-2 rounded-md bg-acento px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-acento"
      >
        <RefreshCw className="h-4 w-4" aria-hidden />
        {AVISO_CONEXION.boton}
      </button>
    </div>
  )
}

/**
 * Una espera con tope: `children` (la animación de carga) mientras dura, y el aviso cuando
 * pasan `limiteMs` sin que la espera se vaya. El cambio lo hace una animación CSS con
 * retardo (`ESTILO_AVISO_CONEXION`, en línea en el layout raíz), no un temporizador de JS:
 * sirve aunque el fallback nunca hidrate, y se cancela solo cuando React lo reemplaza por la
 * página. El estado inicial (aviso oculto) va en el `style` en línea, así que tampoco
 * depende de que baje la hoja de estilos.
 *
 * Los dos ocupan la misma celda de una grilla: el aviso no empuja la animación.
 */
export function EsperaConLimite({
  children,
  causa,
  destino,
  limiteMs = LIMITE_ESPERA_RUTA_MS,
  className,
  style,
}: {
  children: ReactNode
  causa: CausaAvisoConexion
  destino?: string | null
  limiteMs?: number
  className?: string
  style?: CSSProperties
}) {
  const celda: CSSProperties = { gridArea: '1 / 1' }
  return (
    <div
      className={['grid place-items-center', className].filter(Boolean).join(' ')}
      style={style}
      data-espera-con-limite=""
    >
      <div style={{ ...celda, animation: animacionOcultar(limiteMs) }}>{children}</div>
      <div
        {...{ [ATRIBUTO_CAUSA]: causa }}
        style={{ ...celda, visibility: 'hidden', animation: animacionAparecer(limiteMs) }}
      >
        <AvisoConexion destino={destino} />
      </div>
    </div>
  )
}

/** El `loading.tsx` de `(app)`: la animación de marca y, a los 25 s, el aviso. */
export function EsperaDeRuta({ className }: { className?: string }) {
  return (
    <EsperaConLimite causa="espera-ruta" className={className}>
      <AnimacionMarca variante="liviana" tamano="clamp(1.6rem, 4vw, 2.2rem)" />
    </EsperaConLimite>
  )
}
