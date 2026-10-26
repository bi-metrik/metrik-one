import { notFound } from 'next/navigation'

import { leerProveedores } from './actions'
import ListaProveedores from './lista-proveedores'

/**
 * «Proveedores» (Mauricio, 2026-10-18): antes «Hoteles y tours» (`/fotos` redirige aquí). Solo en
 * espacios con propuesta de viaje; en los demás la ruta no existe.
 */
export default async function ProveedoresPage({ searchParams }: { searchParams?: Promise<{ por?: string }> }) {
  const porClasificar = (await searchParams)?.por === 'clasificar'
  const r = await leerProveedores()
  if (!r.ok) {
    if (/no tiene/.test(r.error)) notFound()
    return (
      <div className="mx-auto max-w-5xl px-4 py-6">
        <h1 className="text-lg font-semibold">Proveedores</h1>
        <p className="text-sm text-muted-foreground">{r.error}</p>
      </div>
    )
  }
  return <ListaProveedores proveedores={r.proveedores} equipo={r.equipo} yo={r.yo} editable={r.editable} sinClasificar={r.sinClasificar ?? []} porClasificarDeEntrada={porClasificar} />
}
