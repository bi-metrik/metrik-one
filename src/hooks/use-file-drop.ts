'use client'

/**
 * Hook useFileDrop — zona de drop de archivos reutilizable.
 *
 * Soltar un archivo sobre la zona dispara el mismo callback que el file picker
 * (`onFiles`). Maneja el estado visual de `dragover` y bloquea el comportamiento
 * por defecto del navegador (abrir el archivo en la pestaña al soltarlo fuera de
 * un input). Diseñado para envolver cualquier zona de carga (BloqueDocumento,
 * DocUploadSlot, RutUploadCard, soportes de gasto, logo, PILA, etc.) sin repetir
 * lógica de dnd por bloque.
 *
 * Uso:
 *   const drop = useFileDrop({ onFiles: f => handleFileSelected(f[0]), disabled })
 *   <div {...drop.dropProps} className={drop.isDragging ? '...' : '...'}>
 *
 * `dragenter`/`dragleave` se cuentan con un contador (no un booleano) porque el
 * navegador emite `dragleave` al cruzar entre hijos de la zona; sin el contador
 * el estado visual parpadea. El contador garantiza un solo estado estable
 * mientras el cursor esté dentro.
 */

import { useCallback, useRef, useState } from 'react'

interface UseFileDropOptions {
  /** Se invoca con los archivos soltados (lista no vacía). */
  onFiles: (files: File[]) => void
  /** Si true, la zona ignora el drop (no muestra estado activo ni dispara onFiles). */
  disabled?: boolean
  /** Permitir múltiples archivos. Default false → solo el primero. */
  multiple?: boolean
}

interface UseFileDropApi {
  isDragging: boolean
  dropProps: {
    onDragEnter: (e: React.DragEvent) => void
    onDragOver: (e: React.DragEvent) => void
    onDragLeave: (e: React.DragEvent) => void
    onDrop: (e: React.DragEvent) => void
  }
}

/** ¿El arrastre trae archivos? (vs. texto, links, drag interno de @dnd-kit, etc.) */
function dragHasFiles(e: React.DragEvent): boolean {
  const types = e.dataTransfer?.types
  if (!types) return false
  // types es DOMStringList o array según navegador
  return Array.from(types).includes('Files')
}

export function useFileDrop({ onFiles, disabled = false, multiple = false }: UseFileDropOptions): UseFileDropApi {
  const [isDragging, setIsDragging] = useState(false)
  // Contador de enter/leave para no parpadear al cruzar entre hijos de la zona.
  const dragDepth = useRef(0)

  const reset = useCallback(() => {
    dragDepth.current = 0
    setIsDragging(false)
  }, [])

  const onDragEnter = useCallback(
    (e: React.DragEvent) => {
      if (disabled || !dragHasFiles(e)) return
      e.preventDefault()
      e.stopPropagation()
      dragDepth.current += 1
      setIsDragging(true)
    },
    [disabled],
  )

  const onDragOver = useCallback(
    (e: React.DragEvent) => {
      if (disabled || !dragHasFiles(e)) return
      // preventDefault es obligatorio en dragover para habilitar el drop;
      // sin esto el navegador rechaza el drop y abre el archivo en la pestaña.
      e.preventDefault()
      e.stopPropagation()
      if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy'
      if (!isDragging) setIsDragging(true)
    },
    [disabled, isDragging],
  )

  const onDragLeave = useCallback(
    (e: React.DragEvent) => {
      if (disabled || !dragHasFiles(e)) return
      e.preventDefault()
      e.stopPropagation()
      dragDepth.current -= 1
      if (dragDepth.current <= 0) reset()
    },
    [disabled, reset],
  )

  const onDrop = useCallback(
    (e: React.DragEvent) => {
      if (disabled || !dragHasFiles(e)) return
      e.preventDefault()
      e.stopPropagation()
      reset()
      const dropped = Array.from(e.dataTransfer?.files ?? [])
      if (dropped.length === 0) return
      onFiles(multiple ? dropped : [dropped[0]])
    },
    [disabled, multiple, onFiles, reset],
  )

  return {
    isDragging,
    dropProps: { onDragEnter, onDragOver, onDragLeave, onDrop },
  }
}
