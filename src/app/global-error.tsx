'use client'

import { useEffect, useRef, useState } from 'react'
import { reportarErrorCliente } from '@/lib/errores-cliente/enviar'
import { intentarAutoRecarga, puedeAutoRecargar } from '@/lib/red/auto-recarga'
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
  // El render solo CONSULTA la guarda (no escribe): decide si se pinta "Recargando…". La
  // marca la reclama el efecto, que corre una sola vez por boundary montado. Reclamarla al
  // renderizar la gastaba en un render que React descarta (ver `intentarAutoRecarga`). En el
  // servidor no hay `window` y da `false` (un error de servidor nunca es de red del telefono).
  const [recargar, setRecargar] = useState(() => puedeAutoRecargar(error))
  // En dev, StrictMode corre el efecto dos veces sobre el mismo boundary: el segundo no
  // vuelve a reclamar (ya hay una recarga en curso) ni repinta la pantalla de error.
  const yaRecargo = useRef(false)

  useEffect(() => {
    if (yaRecargo.current) return
    console.error('[global] error no capturado:', error)
    const reclamo = intentarAutoRecarga(error)
    // Deja rastro en los logs de Vercel (`[error-cliente]`) con lo que de verdad paso: el
    // reclamo, no la consulta del render. Nunca lanza ni espera.
    reportarErrorCliente(error, 'global', reclamo)
    if (reclamo) {
      yaRecargo.current = true
      window.location.reload()
    } else {
      // La guarda no dejo (marca vigente o `sessionStorage` que no guarda): pantalla normal.
      setRecargar(false)
    }
  }, [error])

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
