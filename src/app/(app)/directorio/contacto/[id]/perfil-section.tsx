'use client'

import { useState } from 'react'
import { toast } from 'sonner'
import { Check, Plus, X } from 'lucide-react'
import { useTransitionTolerante } from '@/hooks/use-transition-tolerante'
import { conReintentoDeRed } from '@/lib/red/con-reintento'
import { agruparPerfil, lineaOrigen, OPCIONES_DIMENSION } from '@/lib/perfil-contacto/vista'
import {
  agregarHechoPerfil,
  cargarPerfilDeContacto,
  confirmarHechoPerfil,
  descartarHechoPerfil,
  type PerfilDeContacto,
} from './perfil-actions'

/**
 * «Perfil» en la ficha del contacto: lo que se sabe de la persona para atenderla mejor en sus
 * próximos viajes, agrupado por dimensión. Lo confirmado con su origen y fecha; lo sugerido (lo que
 * el bot separó de una conversación) con Confirmar y Descartar; «Agregar» a mano. Sin autorización
 * de datos vigente no se agrega ni se confirma nada (la base tampoco lo deja).
 */
export default function PerfilSection({ contactoId, inicial }: { contactoId: string; inicial: PerfilDeContacto }) {
  const [perfil, setPerfil] = useState(inicial)
  const [dimension, setDimension] = useState('')
  const [texto, setTexto] = useState('')
  const [pendiente, startTransition] = useTransitionTolerante()

  const grupos = agruparPerfil(perfil.hechos)
  const puedeEscribir = perfil.puedeEditar && perfil.autorizado === true

  const recargar = () => conReintentoDeRed(() => cargarPerfilDeContacto(contactoId)).then(r => {
    if (r.error) toast.error(r.error)
    if (r.perfil) setPerfil(r.perfil)
  })

  const accion = (f: () => Promise<{ error: string | null }>, ok: string, despues?: () => void) => startTransition(async () => {
    const r = await f()
    if (r.error) { toast.error(r.error); return }
    toast.success(ok)
    despues?.()
    await recargar()
  })

  return (
    <div className="space-y-3 rounded-lg border p-4">
      <div>
        <h2 className="text-sm font-semibold">Perfil</h2>
        <p className="text-[11px] text-tinta-suave">Lo que sirve para atender a {perfil.nombre} en sus próximos viajes.</p>
      </div>

      {perfil.autorizado === false && (
        <p className="rounded-md border border-alerta/30 bg-alerta/5 px-3 py-2 text-xs text-alerta">
          {perfil.nombre} todavía no autoriza el uso de sus datos: no se puede guardar ni confirmar nada en su perfil.
        </p>
      )}

      {grupos.length === 0 ? (
        <p className="text-xs italic text-tinta-suave">Todavía no hay nada en su perfil.</p>
      ) : (
        <div className="space-y-3">
          {grupos.map(g => (
            <div key={g.dimension}>
              <p className="mb-1 text-[11px] font-medium uppercase tracking-wide text-tinta-suave">{g.titulo}</p>
              <ul className="space-y-1.5">
                {g.hechos.map(h => (
                  <li key={h.id} className="flex items-start gap-2">
                    <div className="min-w-0 flex-1">
                      <p className="text-xs text-tinta">
                        {h.texto}
                        {h.estado === 'sugerido' && (
                          <span className="ml-1.5 rounded bg-amber-50 px-1.5 py-0.5 text-[10px] font-medium text-amber-800">Sugerido, sin confirmar</span>
                        )}
                      </p>
                      <p className="text-[10px] text-tinta-suave">{lineaOrigen(h)}</p>
                    </div>
                    {perfil.puedeEditar && (
                      <div className="flex shrink-0 gap-1">
                        {h.estado === 'sugerido' && (
                          <button
                            type="button"
                            disabled={pendiente || !puedeEscribir}
                            onClick={() => accion(() => confirmarHechoPerfil(contactoId, h.id), 'Confirmado en el perfil')}
                            className="inline-flex items-center gap-1 rounded-md bg-acento px-2 py-1 text-[11px] font-medium text-white hover:bg-acento-hover disabled:opacity-50"
                          >
                            <Check className="h-3 w-3" /> Confirmar
                          </button>
                        )}
                        <button
                          type="button"
                          disabled={pendiente}
                          onClick={() => accion(() => descartarHechoPerfil(contactoId, h.id), 'Descartado del perfil')}
                          className="inline-flex items-center gap-1 rounded-md border border-[#E5E7EB] bg-white px-2 py-1 text-[11px] text-tinta hover:bg-slate-50 disabled:opacity-50"
                        >
                          <X className="h-3 w-3" /> Descartar
                        </button>
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      )}

      {puedeEscribir && (
        <form
          className="space-y-2 border-t pt-3"
          onSubmit={e => {
            e.preventDefault()
            accion(() => agregarHechoPerfil(contactoId, dimension, texto), 'Agregado al perfil', () => { setTexto(''); setDimension('') })
          }}
        >
          <div className="flex flex-col gap-2 sm:flex-row">
            <select
              value={dimension}
              onChange={e => setDimension(e.target.value)}
              className="rounded-md border bg-background px-2 py-1.5 text-xs"
              aria-label="De qué se trata"
            >
              <option value="">De qué se trata…</option>
              {OPCIONES_DIMENSION.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
            <input
              value={texto}
              onChange={e => setTexto(e.target.value)}
              maxLength={280}
              placeholder="Ej.: le gusta la comida italiana"
              className="min-w-0 flex-1 rounded-md border bg-background px-2 py-1.5 text-xs"
              aria-label="Qué se recuerda"
            />
            <button
              type="submit"
              disabled={pendiente || !dimension || !texto.trim()}
              className="inline-flex items-center justify-center gap-1 rounded-md bg-acento px-3 py-1.5 text-xs font-medium text-white hover:bg-acento-hover disabled:opacity-50"
            >
              <Plus className="h-3.5 w-3.5" /> Agregar
            </button>
          </div>
          <p className="text-[10px] text-tinta-suave">
            No anotes salud, creencias ni opiniones sobre la persona. De los menores, solo cuántos y de qué edades.
          </p>
        </form>
      )}
    </div>
  )
}
