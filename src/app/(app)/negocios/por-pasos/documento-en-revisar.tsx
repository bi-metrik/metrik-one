'use client'

import { useEffect, useState } from 'react'

import { BTN } from '@/components/viaje/estilo'
import { CABECERA_AVISOS_FOTOS, leerAvisosFotos } from '@/lib/fotos/forma'

/**
 * EL DOCUMENTO en «Revisar y enviar» (H4 de la verificación D, criterio D7 de Vera; diseño de Noor,
 * Paso 3): lo que recibe el cliente, tal cual, dentro de la pantalla. Es el MISMO PDF de «Descargar
 * PDF» (`/api/cotizaciones/{id}/vista-previa`, que no guarda ni registra nada), así que sus
 * secciones y sus cifras son las del PDF por construcción: portada, vuelos, hoteles, actividades,
 * opcionales, cargos en destino, «A tener en cuenta» e Inversión con el precio por pasajero.
 *
 * No hace esperar a Revisar (V7): la pantalla se pinta y el documento llega detrás. Se vuelve a
 * pedir cuando cambia `clave` (un servicio, una tarifa, el margen o el texto).
 *
 * Regla de fotos (2026-10-29): el documento se pide con `fetch` para leer, junto con el PDF, a qué
 * hoteles les faltan fotos para su ficha (`x-avisos-fotos`). El aviso no bloquea el envío.
 */
export function DocumentoEnRevisar({ cotizacionId, clave }: { cotizacionId: string; clave: string }) {
  // La clave que se está mostrando: el documento solo se reemplaza cuando cambia, y nunca bloquea.
  const [vigente, setVigente] = useState(clave)
  const [cargando, setCargando] = useState(true)
  const [pdf, setPdf] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [avisosFotos, setAvisosFotos] = useState<string[]>([])
  useEffect(() => {
    if (clave === vigente) return
    // Un cambio seguido de otro (deshacer, tocar dos opciones) pide un solo documento.
    const t = setTimeout(() => { setVigente(clave); setCargando(true) }, 600)
    return () => clearTimeout(t)
  }, [clave, vigente])
  const url = `/api/cotizaciones/${encodeURIComponent(cotizacionId)}/vista-previa?v=${encodeURIComponent(vigente)}`
  useEffect(() => {
    let vivo = true
    let enlace: string | null = null
    fetch(url)
      .then(async (r) => {
        if (!vivo) return
        if (!r.ok) {
          const cuerpo = (await r.json().catch(() => null)) as { mensaje?: string } | null
          setError(cuerpo?.mensaje ?? 'No se pudo armar el documento.')
          setPdf(null)
          setAvisosFotos([])
          return
        }
        setAvisosFotos(leerAvisosFotos(r.headers.get(CABECERA_AVISOS_FOTOS)))
        const blob = await r.blob()
        if (!vivo) return
        enlace = URL.createObjectURL(blob)
        setPdf(enlace)
        setError(null)
      })
      .catch(() => { if (vivo) setError('No se pudo armar el documento.') })
      .finally(() => { if (vivo) setCargando(false) })
    return () => {
      vivo = false
      if (enlace) URL.revokeObjectURL(enlace)
    }
  }, [url])
  return (
    <section className="flex flex-col gap-2 rounded-xl border border-[#E2DED5] bg-white p-3" aria-label="El documento que recibe el cliente" data-documento-revisar>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <h3 className="m-0 text-sm font-bold">El documento que recibe el cliente</h3>
          <p className="m-0 text-xs text-[#6E6A62]">
            Es el mismo PDF de «Descargar PDF», con sus secciones y sus cifras. Si algo impide enviar, sale con la marca de borrador.
          </p>
        </div>
        <a className={BTN} href={url} target="_blank" rel="noreferrer" data-documento-abrir>Abrir en otra pestaña</a>
      </div>
      {avisosFotos.length > 0 && (
        <section className="rounded-xl border border-[#EBD9B5] bg-[#FBF5EA] px-3 py-2" aria-label="Fotos de los hoteles (no bloquea)" data-avisos-fotos>
          <h4 className="m-0 text-[13px] font-bold text-[#9A5F0C]">Fotos de los hoteles (no bloquea)</h4>
          <ul className="m-0 list-none p-0">
            {avisosFotos.map((t) => (
              <li key={t} className="py-1 text-[13px]" data-aviso-fotos>{t}</li>
            ))}
          </ul>
        </section>
      )}
      {cargando && <p className="m-0 text-xs text-[#6E6A62]" data-documento-cargando>Armando el documento…</p>}
      {error && !cargando && <p className="m-0 text-xs text-[#B3382C]" data-documento-error>{error}</p>}
      {pdf && (
        <iframe
          key={pdf}
          src={pdf}
          title="El documento que recibe el cliente"
          className="h-[80vh] min-h-[520px] w-full rounded-lg border border-[#E2DED5] bg-[#F8F7F3]"
          data-documento-pdf={url}
        />
      )}
    </section>
  )
}
