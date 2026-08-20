'use client'

import { useEffect } from 'react'

/**
 * Ultimo recurso: se activa cuando el error revienta el layout raiz, asi que
 * este archivo REEMPLAZA el `<html>`/`<body>` de la app. No hay ThemeProvider,
 * no hay fuentes y no hay Tailwind cargado — de ahi los estilos en linea. Si
 * dependiera de la hoja de estilos, el caso en que hace falta (bundle roto) es
 * justo el caso en que no cargaria.
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    console.error('[global] error no capturado:', error)
  }, [error])

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
          color: '#1A1A1A',
          fontFamily: 'system-ui, -apple-system, Segoe UI, sans-serif',
        }}
      >
        <h2 style={{ margin: 0, fontSize: '18px', fontWeight: 600 }}>
          MéTRIK one no pudo cargar
        </h2>
        <p style={{ margin: 0, maxWidth: '32rem', fontSize: '14px', color: '#525252' }}>
          Casi siempre es una pestaña que llevaba mucho tiempo abierta. Recargar
          la deja al día y suele bastar.
        </p>
        <div style={{ display: 'flex', gap: '8px' }}>
          <button
            type="button"
            onClick={() => window.location.reload()}
            style={{
              padding: '8px 16px',
              borderRadius: '6px',
              border: 'none',
              background: '#10B981',
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
              color: '#1A1A1A',
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
      </body>
    </html>
  )
}
