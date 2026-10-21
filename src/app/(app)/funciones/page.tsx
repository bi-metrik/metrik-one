import Link from 'next/link'
import { redirect } from 'next/navigation'
import type { SupabaseClient } from '@supabase/supabase-js'
import { getWorkspace } from '@/lib/actions/get-workspace'
import { exigirModulo, REQUISITO } from '@/lib/modulos/exigir-modulo'
import { leerProximas } from '@/lib/funciones/datos'
import { ETIQUETA_ESTADO_FUNCION, fechaBogota, horaBogota, puedeEditarFunciones } from '@/lib/funciones/reglas'
import { todayBogotaISO } from '@/lib/dates/bogota'

export const dynamic = 'force-dynamic'

/** `/funciones`: las próximas funciones, con la entrada al mapa de cada una, a la lista del día y al formulario. */
export default async function FuncionesPage() {
  const { workspaceId, role, supabase, error } = await getWorkspace()
  if (error || !workspaceId) redirect('/')
  if (!(await exigirModulo(REQUISITO.funciones)).ok) redirect('/')

  const proximas = await leerProximas(supabase as unknown as SupabaseClient, workspaceId)
  const editar = puedeEditarFunciones(role)

  return (
    <div className="mx-auto max-w-4xl space-y-6 p-4 md:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-xl font-semibold text-[#1A1A1A]">Funciones</h1>
        <div className="flex flex-wrap gap-2 text-sm">
          <Link href={`/funciones/dia?fecha=${todayBogotaISO()}`} className="rounded-md border border-[#E5E7EB] px-3 py-1.5 hover:bg-gray-50">
            Lista de hoy
          </Link>
          <Link href="/funciones/montajes" className="rounded-md border border-[#E5E7EB] px-3 py-1.5 hover:bg-gray-50">
            Montajes
          </Link>
          {editar && (
            <Link href="/funciones/nueva" className="rounded-md bg-[#10B981] px-3 py-1.5 font-medium text-white hover:bg-[#059669]">
              Nuevas funciones
            </Link>
          )}
        </div>
      </div>

      {proximas.length === 0 ? (
        <p className="rounded-lg border border-dashed border-[#E5E7EB] p-6 text-sm text-[#6B7280]">
          No hay funciones en los próximos días.{editar ? ' Créalas desde «Nuevas funciones».' : ''}
        </p>
      ) : (
        <ul className="divide-y divide-[#E5E7EB] rounded-lg border border-[#E5E7EB] bg-white">
          {proximas.map((f) => (
            <li key={f.id}>
              <Link href={`/funciones/${f.id}`} className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 hover:bg-gray-50">
                <span>
                  <span className="font-medium text-[#1A1A1A]">{f.experiencia}</span>
                  <span className="ml-2 text-sm text-[#6B7280] first-letter:uppercase">
                    {fechaBogota(f.inicia_at)} · {horaBogota(f.inicia_at)}
                  </span>
                </span>
                <span className="text-xs text-[#6B7280]">
                  Cupo {f.cupo_total} · {ETIQUETA_ESTADO_FUNCION[f.estado]} · {f.montaje ? `Plano: ${f.montaje}` : 'Sin plano'}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
