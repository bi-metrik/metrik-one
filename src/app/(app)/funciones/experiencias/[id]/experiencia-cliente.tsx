'use client'

import Link from 'next/link'
import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import type { CampanaResumen, Experiencia } from '@/lib/funciones/datos'
import { ETIQUETA_ESTADO_CAMPANA } from '@/lib/funciones/reglas'
import { guardarExperienciaAction } from '../../actions'
import { FichaExperiencia, type ValoresFicha } from '../../ficha-experiencia'
import { BotonFijo, Insignia } from '../../panel-ui'

/** La ficha de la película y sus campañas. Solo los campos que ya tiene la experiencia: la ficha nueva espera P11. */
export function ExperienciaCliente({ experiencia: e, campanas, puedeEditar }: { experiencia: Experiencia; campanas: CampanaResumen[]; puedeEditar: boolean }) {
  const router = useRouter()
  const [pendiente, empezar] = useTransition()
  const [v, setV] = useState<ValoresFicha>({ nombre: e.nombre, historia: e.historia, que_incluye: e.que_incluye, edad_minima: e.edad_minima, info_general: e.info_general })
  const guardar = () =>
    empezar(async () => {
      const r = await guardarExperienciaAction({ id: e.id, ...v })
      if (!r.ok) return void toast.error(r.error)
      toast.success('Ficha guardada.')
      router.refresh()
    })
  return (
    <div className="mx-auto max-w-3xl space-y-4 p-4 pb-24 md:p-6">
      <div>
        <Link href="/funciones?pestana=experiencias" className="text-xs text-[#6B7280] hover:underline">← Experiencias</Link>
        <h1 className="text-xl font-semibold text-[#1A1A1A]">{e.nombre}</h1>
      </div>
      {puedeEditar ? (
        <FichaExperiencia valores={v} onCambio={setV} />
      ) : (
        <div className="space-y-2 rounded-lg border border-[#E5E7EB] bg-white p-3 text-sm">
          <p>{e.historia ?? 'Sin intro.'}</p>
          <p className="text-[#6B7280]">{e.que_incluye ?? ''}</p>
        </div>
      )}
      <section className="space-y-2">
        <h2 className="text-sm font-medium text-[#1A1A1A]">Campañas</h2>
        {campanas.length === 0 && <p className="text-sm text-[#6B7280]">Todavía no tiene campañas.</p>}
        {campanas.map((c) => (
          <Link key={c.campana_id} href={`/funciones/campanas/${c.campana_id}`} className="flex items-center justify-between rounded-lg border border-[#E5E7EB] bg-white px-4 py-3 hover:bg-gray-50">
            <span className="font-medium">{c.nombre}</span>
            <Insignia texto={ETIQUETA_ESTADO_CAMPANA[c.estado] ?? c.estado} />
          </Link>
        ))}
      </section>
      {puedeEditar && (
        <BotonFijo>
          <button type="button" disabled={pendiente || !v.nombre.trim()} onClick={guardar} className="h-12 flex-1 rounded-md bg-[#10B981] font-medium text-white disabled:opacity-50">
            Guardar ficha
          </button>
        </BotonFijo>
      )}
    </div>
  )
}
