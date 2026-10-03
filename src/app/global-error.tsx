'use client'

import { useEffect, useState } from 'react'
import { reportarErrorCliente } from '@/lib/errores-cliente/enviar'
import { intentarAutoRecarga } from '@/lib/red/auto-recarga'
import { textoPantallaDeError } from '@/lib/red/error-de-red'
import { PALETA } from '@/lib/marca/paleta'

/**
 * Ultimo recurso: se activa cuando el error revienta el layout raiz, asi que
 * este archivo REEMPLAZA el `<html>`/`<body>` de la app. No hay ThemeProvider,
 * no hay fuentes y no hay Tailwind cargado — de ahi los estilos en linea. Si
 * dependiera de la hoja de estilos, el caso en que hace falta (bundle roto) es
 * justo el caso en que no cargaria.
 *
 * Como `(app)/error.tsx`: si fue la red o un chunk, recarga sola una vez por ruta cada 60 s;
 * si la guarda ya se gasto, dice "Se perdió la conexión" (`textoPantallaDeError`).
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  // Se decide UNA vez, al montar: la guarda deja su marca en `sessionStorage` al decir
  // que si, asi que consultarla en cada render la gastaria. En el servidor no hay
  // `window` y da `false` (un error de servidor nunca es de red del telefono).
  const [recargar] = useState(() => intentarAutoRecarga(error))

  useEffect(() => {
    console.error('[global] error no capturado:', error)
    // Deja rastro en los logs de Vercel (`[error-cliente]`); nunca lanza ni espera.
    reportarErrorCliente(error, 'global', recargar)
    if (recargar) window.location.reload()
  }, [error, recargar])

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
        }}
      >
        {recargar ? (
          <p style={{ margin: 0, fontSize: '14px', color: '#525252' }}>
            Se perdió la conexión. Recargando…
          </p>
        ) : (
          <>
        <h2 style={{ margin: 0, fontSize: '18px', fontWeight: 600 }}>{texto.titulo}</h2>
        <p style={{ margin: 0, maxWidth: '32rem', fontSize: '14px', color: '#525252' }}>
          {texto.cuerpo}
        </p>
        <div style={{ display: 'flex', gap: '8px' }}>
          <button
            type="button"
            onClick={() => window.location.reload()}
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
            Recargar
          </button>
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
