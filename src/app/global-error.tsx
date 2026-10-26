'use client'

import type { CSSProperties } from 'react'
import AnimacionMarca from '@/components/marca/animacion-marca'
import { useRecuperacionDeRed } from '@/hooks/use-recuperacion-de-red'
import { olvidarRecargas, sessionStorageSeguro } from '@/lib/red/auto-recarga'
import { TEXTO_SIN_INTERNET, textoPantallaDeError } from '@/lib/red/error-de-red'
import { PALETA } from '@/lib/marca/paleta'
import { AVISO_CONEXION } from '@/lib/red/aviso-conexion'

/**
 * Ultimo recurso: se activa cuando el error revienta el layout raiz, asi que
 * este archivo REEMPLAZA el `<html>`/`<body>` de la app. No hay ThemeProvider,
 * no hay fuentes y no hay Tailwind cargado — de ahi los estilos en linea. Si
 * dependiera de la hoja de estilos, el caso en que hace falta (bundle roto) es
 * justo el caso en que no cargaria.
 *
 * Como `(app)/error.tsx`: un error de red o de chunk se recupera solo
 * (`useRecuperacionDeRed`) y mientras tanto se ve la animacion de marca. `AnimacionMarca`
 * no arrastra el layout: es un componente sin estado con su propio CSS module. Las
 * variables que lee (`--tinta`, `--acento`) las define `globals.css`, que aqui puede no
 * estar: se declaran en el `<body>` desde `PALETA`. Si ni el CSS module llegara, quedaria
 * el texto "MéTRIK one" quieto, que tambien sirve.
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  const estado = useRecuperacionDeRed(error, reset, 'global')
  const intentando = estado === 'recuperando' || estado === 'sin-internet'
  const recargar = () => {
    // Un clic de la persona no es un bucle: la carga siguiente vuelve a tener la escalera.
    olvidarRecargas(window.location.pathname, sessionStorageSeguro())
    window.location.reload()
  }

  const texto = textoPantallaDeError(error, 'MéTRIK one no pudo cargar')

  return (
    <html lang="es">
      <body
        style={{
          margin: 0,
          minHeight: '100vh',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          gap: '16px',
          padding: '24px',
          textAlign: 'center',
          background: '#ffffff',
          color: PALETA.tinta,
          fontFamily: 'system-ui, -apple-system, Segoe UI, sans-serif',
          ['--tinta' as string]: PALETA.tinta,
          ['--acento' as string]: PALETA.acento,
        } as CSSProperties}
      >
        {intentando ? (
          <>
            <AnimacionMarca variante="liviana" tamano="clamp(1.6rem, 4vw, 2.2rem)" />
            {estado === 'sin-internet' && (
              <p style={{ margin: 0, fontSize: '14px', color: '#525252' }}>{TEXTO_SIN_INTERNET}</p>
            )}
          </>
        ) : (
          <>
        <h2 style={{ margin: 0, fontSize: '18px', fontWeight: 600 }}>{texto.titulo}</h2>
        <p style={{ margin: 0, maxWidth: '32rem', fontSize: '14px', color: '#525252' }}>
          {texto.cuerpo}
        </p>
        <div style={{ display: 'flex', gap: '8px' }}>
          <button
            type="button"
            onClick={recargar}
            style={{
              padding: '8px 16px',
              borderRadius: '6px',
              border: 'none',
              background: PALETA.acento,
              color: '#ffffff',
              fontSize: '14px',
              fontWeight: 500,
              cursor: 'pointer',
            }}
          >
            {estado === 'agotado' ? AVISO_CONEXION.boton : 'Recargar'}
          </button>
          {estado === 'error' && (
            <button
              type="button"
              onClick={reset}
              style={{
                padding: '8px 16px',
                borderRadius: '6px',
                border: '1px solid #E5E7EB',
                background: '#ffffff',
                color: PALETA.tinta,
                fontSize: '14px',
                fontWeight: 500,
                cursor: 'pointer',
              }}
            >
              Reintentar
            </button>
          )}
        </div>
        {error.digest && (
          <p style={{ margin: 0, fontFamily: 'monospace', fontSize: '12px', color: '#737373' }}>
            Código de error: {error.digest}
          </p>
        )}
          </>
        )}
      </body>
    </html>
  )
}
