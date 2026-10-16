import { notFound } from 'next/navigation'

import { leerBibliotecaDeFotos } from './actions'
import BibliotecaFotosVista from './biblioteca-fotos'

/** Buscar fotos en una página oficial baja varias imágenes: más que el tope por defecto. */
export const maxDuration = 60

/**
 * La biblioteca de fotos del espacio (decisión de Mauricio del 2026-10-16). Solo en espacios con
 * propuesta de viaje html; en los demás la ruta no existe.
 */
export default async function FotosPage() {
  const r = await leerBibliotecaDeFotos()
  if (!r.ok) {
    if (/no tiene/.test(r.error)) notFound()
    return (
      <div className="mx-auto max-w-5xl px-4 py-6">
        <h1 className="text-lg font-semibold">Biblioteca de fotos</h1>
        <p className="text-sm text-muted-foreground">{r.error}</p>
      </div>
    )
  }
  return <BibliotecaFotosVista inicial={r.elementos} editable={r.editable} sitioOficial={r.sitioOficial} />
}
