'use client'

import { useEffect, useState } from 'react'

import { BTN } from '@/components/viaje/estilo'

/**
 * EL DOCUMENTO en «Revisar y enviar» (H4 de la verificación D, criterio D7 de Vera; diseño de Noor,
 * Paso 3): lo que recibe el cliente, tal cual, dentro de la pantalla. Es el MISMO PDF de «Descargar
 * PDF» (`/api/cotizaciones/{id}/vista-previa`, que no guarda ni registra nada), así que sus
 * secciones y sus cifras son las del PDF por construcción: portada, vuelos, hoteles, actividades,
 * opcionales, cargos en destino, «A tener en cuenta» e Inversión con el precio por pasajero.
 *
 * No hace esperar a Revisar (V7): la pantalla se pinta y el documento llega detrás. Se vuelve a
 * pedir cuando cambia `clave` (un servicio, una tarifa, el margen o el texto).
 */
export function DocumentoEnRevisar({ cotizacionId, clave }: { cotizacionId: string; clave: string }) {
  // La clave que se está mostrando: el iframe solo se reemplaza cuando cambia, y nunca bloquea.
  const [vigente, setVigente] = useState(clave)
  const [cargando, setCargando] = useState(true)
  useEffect(() => {
    if (clave === vigente) return
    // Un cambio seguido de otro (deshacer, tocar dos opciones) pide un solo documento.
    const t = setTimeout(() => { setVigente(clave); setCargando(true) }, 600)
    return () => clearTimeout(t)
  }, [clave, vigente])
  const url = `/api/cotizaciones/${encodeURIComponent(cotizacionId)}/vista-previa?v=${encodeURIComponent(vigente)}`
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
      {cargando && <p className="m-0 text-xs text-[#6E6A62]" data-documento-cargando>Armando el documento…</p>}
      <iframe
        key={vigente}
        src={url}
        title="El documento que recibe el cliente"
        className="h-[80vh] min-h-[520px] w-full rounded-lg border border-[#E2DED5] bg-[#F8F7F3]"
        onLoad={() => setCargando(false)}
        data-documento-pdf={url}
      />
    </section>
  )
}
