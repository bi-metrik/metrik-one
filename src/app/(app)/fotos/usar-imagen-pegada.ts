'use client'

import { useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'

import { esDeAgenciaDeViajes, MENSAJE_AGENCIA } from '@/lib/fotos/agencias'
import { blobDeDataUrl, imagenDelPortapapeles, type Pegado } from '@/lib/fotos/portapapeles'
import type { ImagenPegada } from './actions'

/**
 * Ctrl+V de una imagen mientras el selector está abierto (Mauricio, 2026-10-16). Escucha en el
 * DOCUMENTO y no en el contenido del diálogo: al abrirlo el foco puede seguir en el botón que lo
 * abrió (fuera del portal), y un `onPaste` de React en el diálogo no se enteraba.
 *
 * La imagen sale del archivo del portapapeles, de un `data:` URL o, si solo llegó el HTML con
 * `<img src="https://…">`, se baja en el servidor (`traerPegada`). En los tres casos termina en
 * `onImagen(blob)`, que abre la casilla de autorización: nada se guarda sin ella.
 * Un texto pegado que nombra una agencia en línea se frena con su aviso; otro texto pasa.
 *
 * Escucha en CAPTURA y, si la toma, corta la propagación: la ficha del negocio tiene su propio
 * «pegar en cualquier parte» (el comprobante del riel de cobro) que, con el foco fuera del
 * diálogo, abriría además «pago del viajero» con la misma foto.
 */
export function useImagenPegada(opts: {
  abierto: boolean
  ocupado: boolean
  onImagen: (blob: Blob) => void
  traerPegada?: (url: string) => Promise<ImagenPegada>
}): { trayendo: boolean } {
  const [trayendo, setTrayendo] = useState(false)
  const ultimo = useRef(opts)
  useEffect(() => {
    ultimo.current = opts
  })

  useEffect(() => {
    if (!opts.abierto) return
    const resolver = async (pegado: Pegado) => {
      const { onImagen, traerPegada } = ultimo.current
      if (pegado.tipo === 'archivo') return onImagen(pegado.archivo)
      if (pegado.tipo === 'data') {
        const blob = blobDeDataUrl(pegado.dataUrl)
        return blob ? onImagen(blob) : void toast.error('Lo que pegaste no es una foto.')
      }
      if (esDeAgenciaDeViajes(pegado.url)) return void toast.error(MENSAJE_AGENCIA)
      if (!traerPegada) return void toast.error('Copia la imagen (clic derecho › Copiar imagen) y pégala otra vez.')
      setTrayendo(true)
      try {
        const r = await traerPegada(pegado.url)
        if (!r.ok) return void toast.error(r.error)
        const blob = blobDeDataUrl(r.dataUrl)
        if (blob) onImagen(blob)
        else toast.error('Lo que pegaste no es una foto.')
      } catch {
        toast.error('No pudimos traer esa imagen. Intenta de nuevo o súbela con «Subir la mía».')
      } finally {
        setTrayendo(false)
      }
    }
    const alPegar = (e: ClipboardEvent) => {
      const pegado = imagenDelPortapapeles(e.clipboardData)
      if (pegado) {
        e.preventDefault()
        e.stopPropagation()
        if (!ultimo.current.ocupado) void resolver(pegado)
        return
      }
      const texto = e.clipboardData?.getData('text') ?? ''
      if (texto && esDeAgenciaDeViajes(texto)) {
        e.preventDefault()
        e.stopPropagation()
        toast.error(MENSAJE_AGENCIA)
      }
    }
    document.addEventListener('paste', alPegar, true)
    return () => document.removeEventListener('paste', alPegar, true)
  }, [opts.abierto])

  return { trayendo }
}
