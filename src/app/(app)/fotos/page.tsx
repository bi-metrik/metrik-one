import { notFound } from 'next/navigation'

import { leerHotelesYTours } from './actions'
import HotelesYToursVista from './hoteles-y-tours'

/**
 * «Hoteles y tours» (Mauricio, 2026-10-16): los perfiles de hotel y de tour del espacio con sus
 * fotos. Solo en espacios con propuesta de viaje; en los demás la ruta no existe.
 */
export default async function FotosPage() {
  const r = await leerHotelesYTours()
  if (!r.ok) {
    if (/no tiene/.test(r.error)) notFound()
    return (
      <div className="mx-auto max-w-5xl px-4 py-6">
        <h1 className="text-lg font-semibold">Hoteles y tours</h1>
        <p className="text-sm text-muted-foreground">{r.error}</p>
      </div>
    )
  }
  return <HotelesYToursVista inicial={r.elementos} editable={r.editable} />
}
