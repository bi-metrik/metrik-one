import { redirect } from 'next/navigation'
import { Package } from 'lucide-react'
import EmptyState from '@/components/empty-state'
import { getWorkspace } from '@/lib/actions/get-workspace'

export const dynamic = 'force-dynamic'

/**
 * `/servicios`: donde cada workspace va a ver los servicios que tiene contratados, su
 * estado de pago y la próxima renovación (spec de módulos y cobro, §2.4).
 *
 * Entrega A1: la ruta existe y está vacía. Es ruta COMÚN (`RUTAS_COMUNES` en
 * `lib/modulos/catalogo.ts`), así que abre con cualquier módulo y también en modo vitrina.
 * Todavía no está en el menú: un enlace a una pantalla vacía no le sirve a nadie. Los datos
 * llegan con A3 (servicios contratados) y el menú con ellos.
 */
export default async function ServiciosPage() {
  const { workspaceId, role, error } = await getWorkspace()
  if (error || !workspaceId) redirect('/login')
  // Solo owner y admin: aquí va a vivir el precio, el medio de pago y la cancelación.
  if (role !== 'owner' && role !== 'admin') redirect('/')

  return (
    <div className="mx-auto max-w-3xl space-y-6 p-4 sm:p-6">
      <div className="flex items-center gap-3">
        <Package className="h-6 w-6 text-acento" />
        <div>
          <h1 className="text-xl font-bold text-tinta">Servicios</h1>
          <p className="text-sm text-tinta-suave">
            Los módulos de tu espacio, el servicio que cubre cada uno y su estado.
          </p>
        </div>
      </div>

      <EmptyState
        title="Aún no hay servicios para mostrar"
        description="Cuando tu espacio tenga servicios registrados, aquí vas a ver cada uno con su estado y su próxima renovación."
      />
    </div>
  )
}
