'use client'

import { EXPLICADOR_HTML } from './explicador-html'

/**
 * Explicador "Cómo funciona el cerebro" en un iframe aislado (sandbox sin
 * allow-same-origin: no toca la sesión ni el DOM de ONE). El iframe lleva su
 * propio scroll porque el menú de capítulos es sticky dentro del documento.
 *
 * Alto: el shell mide h-dvh; el header es h-14 (3.5rem) y en móvil además
 * está la barra inferior h-14 + safe-area. Los márgenes negativos anulan el
 * padding del contenedor de contenido (p-6, y pb-24 en móvil).
 */
export default function CerebroClient() {
  return (
    <div className="-mx-6 -mt-6 -mb-24 md:-mb-6">
      <iframe
        srcDoc={EXPLICADOR_HTML}
        sandbox="allow-scripts"
        title="Cómo funciona el cerebro"
        className="block w-full border-0 h-[calc(100dvh-7rem-env(safe-area-inset-bottom))] md:h-[calc(100dvh-3.5rem)]"
      />
    </div>
  )
}
