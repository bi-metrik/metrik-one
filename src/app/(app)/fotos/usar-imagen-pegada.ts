'use client'

import { useEffect, useRef } from 'react'
import { toast } from 'sonner'

import { blobDeDataUrl, imagenDelPortapapeles, type Pegado } from '@/lib/fotos/portapapeles'

export const MENSAJE_COPIAR_IMAGEN = 'Copia la imagen (clic derecho › Copiar imagen) y pégala otra vez.'

/**
 * Ctrl+V de una imagen mientras un perfil está abierto (Mauricio, 2026-10-16). Escucha en el
 * DOCUMENTO y no en el contenido del diálogo: al abrirlo el foco puede seguir en el botón que lo
 * abrió (fuera del portal), y un `onPaste` de React en el diálogo no se enteraba.
 *
 * La imagen sale del archivo del portapapeles o de un `data:` URL. Si solo llegó el HTML con
 * `<img src="https://…">` (copiar un pedazo de página), se pide copiar la imagen misma: ONE ya no
 * baja imágenes de otras páginas. Lo que llega termina en `onImagen(blob)`, que abre la casilla de
 * autorización: nada se guarda sin ella. Un texto pegado sigue su camino.
 *
 * Escucha en CAPTURA y, si la toma, corta la propagación: la ficha del negocio tiene su propio
 * «pegar en cualquier parte» (el comprobante del riel de cobro) que, con el foco fuera del
 * diálogo, abriría además «pago del viajero» con la misma foto.
 */
export function useImagenPegada(opts: { abierto: boolean; ocupado: boolean; onImagen: (blob: Blob) => void }): void {
  const ultimo = useRef(opts)
  useEffect(() => {
    ultimo.current = opts
  })

  useEffect(() => {
    if (!opts.abierto) return
    const resolver = (pegado: Pegado) => {
      const { onImagen } = ultimo.current
      if (pegado.tipo === 'archivo') return onImagen(pegado.archivo)
      if (pegado.tipo === 'data') {
        const blob = blobDeDataUrl(pegado.dataUrl)
        return blob ? onImagen(blob) : void toast.error('Lo que pegaste no es una foto.')
      }
      toast.error(MENSAJE_COPIAR_IMAGEN)
    }
    const alPegar = (e: ClipboardEvent) => {
      const pegado = imagenDelPortapapeles(e.clipboardData)
      if (!pegado) return
      e.preventDefault()
      e.stopPropagation()
      if (!ultimo.current.ocupado) resolver(pegado)
    }
    document.addEventListener('paste', alPegar, true)
    return () => document.removeEventListener('paste', alPegar, true)
  }, [opts.abierto])
}
