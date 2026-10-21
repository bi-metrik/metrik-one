import Link from 'next/link'
import { redirect } from 'next/navigation'
import type { SupabaseClient } from '@supabase/supabase-js'
import { getWorkspace } from '@/lib/actions/get-workspace'
import { exigirModulo, REQUISITO } from '@/lib/modulos/exigir-modulo'
import { leerCatalogo } from '@/lib/funciones/datos'
import { puedeEditarFunciones } from '@/lib/funciones/reglas'

export const dynamic = 'force-dynamic'

/** `/funciones/montajes`: los planos del salón por experiencia. */
export default async function MontajesPage() {
  const { workspaceId, role, supabase, error } = await getWorkspace()
  if (error || !workspaceId) redirect('/')
  if (!(await exigirModulo(REQUISITO.funciones)).ok) redirect('/')

  const { experiencias, montajes } = await leerCatalogo(supabase as unknown as SupabaseClient, workspaceId)
  const editar = puedeEditarFunciones(role)
  const nombre = new Map(experiencias.map((e) => [e.id, e.nombre]))

  return (
    <div className="mx-auto max-w-4xl space-y-4 p-4 md:p-6">
      <div className="flex items-center justify-between">
        <div>
          <Link href="/funciones" className="text-xs text-[#6B7280] hover:underline">
            ← Funciones
          </Link>
          <h1 className="text-xl font-semibold text-[#1A1A1A]">Montajes</h1>
        </div>
        {editar && (
          <Link href="/funciones/montajes/nuevo" className="rounded-md bg-[#10B981] px-3 py-1.5 text-sm font-medium text-white hover:bg-[#059669]">
            Nuevo montaje
          </Link>
        )}
      </div>
      {montajes.length === 0 ? (
        <p className="rounded-lg border border-dashed border-[#E5E7EB] p-6 text-sm text-[#6B7280]">Todavía no hay planos del salón. Sin plano, las funciones salen sin mapa.</p>
      ) : (
        <ul className="divide-y divide-[#E5E7EB] rounded-lg border border-[#E5E7EB] bg-white">
          {montajes.map((m) => (
            <li key={m.id} className="flex items-center justify-between px-4 py-3 text-sm">
              <span>
                <span className="font-medium text-[#1A1A1A]">{m.nombre}</span>
                <span className="ml-2 text-[#6B7280]">{nombre.get(m.experiencia_id)}</span>
              </span>
              <span className="flex items-center gap-3 text-xs text-[#6B7280]">
                {m.mesas.length} mesas · {m.mesas.reduce((s, x) => s + x.puestos, 0)} puestos
                {editar && (
                  <Link href={`/funciones/montajes/${m.id}`} className="text-[#059669] hover:underline">
                    Editar
                  </Link>
                )}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
