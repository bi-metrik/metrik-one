'use client'

import Link from 'next/link'
import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import type { CampanaResumen, Experiencia } from '@/lib/funciones/datos'
import { pesos } from '@/lib/funciones/reglas'
import { crearCampanaAction, guardarExperienciaAction, publicarCampanaAction, type LineaAgenda } from '../../actions'
import { AgendaEditor } from '../../agenda-editor'
import { FichaExperiencia, fichaVacia, type ValoresFicha } from '../../ficha-experiencia'
import { BotonFijo, Hoja } from '../../panel-ui'

const AVISO_POST = 'El texto del post se activa cuando se apruebe la ficha.'

/**
 * Crear una campaña en 3 pasos (§4.3), con el botón fijo abajo:
 *   1. Experiencia: una reciente o una nueva, con los campos que ya tiene la experiencia (la ficha nueva espera P11).
 *   2. Agenda y precios: una función por línea (P3), cupos y precios (como la campaña anterior, o los 4 precios).
 *      «Seguir» guarda el borrador: esa es la confirmación.
 *   3. Publicar (P7): un solo botón «Publicar y copiar post» con una confirmación. Hoy solo publica y lo dice: el texto
 *      del post se activa con la ficha (P11).
 */
export function NuevaCampanaCliente({ experiencias, anterior, ahoraMs }: { experiencias: Experiencia[]; anterior: CampanaResumen | null; ahoraMs: number }) {
  const router = useRouter()
  const [pendiente, empezar] = useTransition()
  const [paso, setPaso] = useState<1 | 2 | 3>(1)

  // Paso 1
  const [experienciaId, setExperienciaId] = useState<string | null>(experiencias[0]?.id ?? null)
  const [nueva, setNueva] = useState<ValoresFicha | null>(experiencias.length === 0 ? fichaVacia(null) : null)

  // Paso 2
  const [lineas, setLineas] = useState<LineaAgenda[] | null>(null)
  const [capacidad, setCapacidad] = useState(String(anterior?.ultima_capacidad ?? ''))
  const [cupoAsistente, setCupoAsistente] = useState(String(anterior?.ultima_cupo_asistente ?? ''))
  const [cambiarCupos, setCambiarCupos] = useState(!anterior?.ultima_capacidad)
  const [cambiarPrecios, setCambiarPrecios] = useState(!anterior)
  const [precio, setPrecio] = useState(String(anterior?.precio_persona ?? ''))
  const [preventa, setPreventa] = useState(String(anterior?.precio_preventa_persona ?? ''))
  const [abono, setAbono] = useState(String(anterior?.abono_persona ?? ''))
  const [pagoTotal, setPagoTotal] = useState(anterior?.permite_pago_total ?? true)
  const [minutos, setMinutos] = useState(String(anterior?.minutos_apartado ?? ''))

  // Paso 3
  const [campanaId, setCampanaId] = useState<string | null>(null)
  const [confirmar, setConfirmar] = useState(false)

  const numero = (s: string) => (s.trim() ? Math.round(Number(s.replace(/[.$\s]/g, ''))) : null)
  const cap = numero(capacidad)
  const asist = numero(cupoAsistente)
  const preventaUsada = !!lineas?.some((l) => l.es_preventa)
  const erroresPaso2 = [
    !lineas && 'La agenda tiene líneas en rojo o está vacía.',
    !(cap && cap >= 1) && 'Escribe el cupo de cada función.',
    !(asist && asist >= 1 && cap && asist <= cap) && 'El cupo del asistente va de 1 al cupo de la función.',
    !(numero(precio) && numero(precio)! > 0) && 'Escribe el precio por persona.',
    preventaUsada && !numero(preventa) && 'Hay funciones de preventa: escribe el precio de preventa.',
    numero(abono) !== null && numero(precio) !== null && numero(abono)! > numero(precio)! && 'El abono no puede pasar el precio por persona.',
    numero(abono) === null && !pagoTotal && 'Sin abono, permite el pago total.',
  ].filter(Boolean) as string[]

  const seguirPaso1 = () =>
    empezar(async () => {
      if (nueva) {
        const r = await guardarExperienciaAction({ id: null, ...nueva })
        if (!r.ok) return void toast.error(r.error)
        setExperienciaId(r.dato!)
        setNueva(null)
      }
      if (!nueva && !experienciaId) return void toast.error('Elige la experiencia.')
      setPaso(2)
    })

  const seguirPaso2 = () =>
    empezar(async () => {
      if (erroresPaso2.length > 0 || !lineas || !experienciaId) return void toast.error(erroresPaso2[0] ?? 'Revisa los datos.')
      const r = await crearCampanaAction({
        experiencia_id: experienciaId,
        lineas,
        capacidad: cap!,
        cupo_asistente: asist!,
        minutos_apartado: numero(minutos),
        precios: {
          precio_persona: numero(precio), precio_preventa_persona: numero(preventa), abono_persona: numero(abono),
          permite_pago_total: pagoTotal, tope_sobreventa: anterior?.tope_sobreventa ?? null,
        },
      })
      if (!r.ok) return void toast.error(r.error)
      setCampanaId(r.dato!)
      toast.success('Borrador guardado.')
      setPaso(3)
    })

  const publicar = () =>
    empezar(async () => {
      if (!campanaId) return
      const r = await publicarCampanaAction(campanaId)
      setConfirmar(false)
      if (!r.ok) return void toast.error(r.error)
      toast.success(`Publicada: ${r.dato?.funciones ?? ''} funciones disponibles para el asistente. ${AVISO_POST}`)
      router.push(`/funciones/campanas/${campanaId}`)
    })

  const campo = 'mt-1 h-11 w-full rounded-md border border-[#E5E7EB] px-3 text-base'

  return (
    <div className="mx-auto max-w-3xl space-y-4 p-4 pb-28 md:p-6">
      <div>
        <Link href="/funciones" className="text-xs text-[#6B7280] hover:underline">← Funciones</Link>
        <h1 className="text-xl font-semibold text-[#1A1A1A]">Nueva campaña</h1>
        <ol className="mt-2 flex gap-2 text-xs" aria-label="Pasos">
          {['Experiencia', 'Agenda y precios', 'Publicar'].map((t, i) => (
            <li key={t} className={`flex-1 rounded-full px-2 py-1 text-center ${paso === i + 1 ? 'bg-[#10B981] text-white' : paso > i + 1 ? 'bg-emerald-50 text-[#059669]' : 'bg-gray-100 text-[#6B7280]'}`}>
              {i + 1}. {t}
            </li>
          ))}
        </ol>
      </div>

      {paso === 1 && (
        <section className="space-y-3">
          {!nueva && experiencias.length > 0 && (
            <ul className="space-y-2">
              {experiencias.slice(0, 8).map((e) => (
                <li key={e.id}>
                  <button
                    type="button"
                    onClick={() => setExperienciaId(e.id)}
                    className={`flex h-14 w-full items-center justify-between rounded-lg border px-4 text-left ${experienciaId === e.id ? 'border-[#10B981] bg-emerald-50' : 'border-[#E5E7EB] bg-white'}`}
                  >
                    <span className="font-medium text-[#1A1A1A]">{e.nombre}</span>
                    {experienciaId === e.id && <span className="text-sm text-[#059669]">Elegida</span>}
                  </button>
                </li>
              ))}
            </ul>
          )}
          {nueva ? (
            <FichaExperiencia valores={nueva} onCambio={setNueva} />
          ) : (
            <button type="button" onClick={() => setNueva(fichaVacia(experiencias[0]?.info_general ?? null))} className="h-11 w-full rounded-md border border-dashed border-[#E5E7EB] text-sm">
              + Nueva experiencia
            </button>
          )}
          {nueva && experiencias.length > 0 && (
            <button type="button" onClick={() => setNueva(null)} className="text-sm text-[#6B7280] underline">
              Elegir una existente
            </button>
          )}
        </section>
      )}

      {paso === 2 && (
        <section className="space-y-4">
          <AgendaEditor onCambio={setLineas} ahoraMs={ahoraMs} />

          <div className="rounded-lg border border-[#E5E7EB] bg-white p-3 text-sm">
            {!cambiarCupos ? (
              <div className="flex items-center justify-between">
                <span>Cupo {capacidad} · asistente {cupoAsistente}</span>
                <button type="button" onClick={() => setCambiarCupos(true)} className="text-[#059669] underline">Cambiar</button>
              </div>
            ) : (
              <div className="grid grid-cols-2 gap-3">
                <label>Cupo por función<input inputMode="numeric" value={capacidad} onChange={(e) => setCapacidad(e.target.value)} className={campo} /></label>
                <label>Cupo del asistente<input inputMode="numeric" value={cupoAsistente} onChange={(e) => setCupoAsistente(e.target.value)} className={campo} /></label>
                <p className="col-span-2 text-xs text-[#6B7280]">El asistente aparta hasta su cupo; los últimos puestos los agenda el equipo.</p>
              </div>
            )}
          </div>

          <div className="rounded-lg border border-[#E5E7EB] bg-white p-3 text-sm">
            {!cambiarPrecios ? (
              <div className="flex items-center justify-between gap-2">
                <span>
                  Precios como la campaña anterior: {pesos(numero(precio))}
                  {numero(preventa) ? ` · prev ${pesos(numero(preventa))}` : ''}
                  {numero(abono) ? ` · abono ${pesos(numero(abono))}` : ''}
                </span>
                <button type="button" onClick={() => setCambiarPrecios(true)} className="text-[#059669] underline">Cambiar</button>
              </div>
            ) : (
              <div className="grid grid-cols-2 gap-3">
                <label>Por persona<input inputMode="numeric" value={precio} onChange={(e) => setPrecio(e.target.value)} className={campo} placeholder="180000" /></label>
                <label>Preventa por persona<input inputMode="numeric" value={preventa} onChange={(e) => setPreventa(e.target.value)} className={campo} placeholder="Opcional" /></label>
                <label>Abono por persona<input inputMode="numeric" value={abono} onChange={(e) => setAbono(e.target.value)} className={campo} placeholder="Opcional" /></label>
                <label className="flex items-end gap-2 pb-3"><input type="checkbox" checked={pagoTotal} onChange={(e) => setPagoTotal(e.target.checked)} className="size-5" /> Permite pago total</label>
                <label className="col-span-2">Minutos que aguanta un apartado sin pago<input inputMode="numeric" value={minutos} onChange={(e) => setMinutos(e.target.value)} className={campo} placeholder="Si aún no se sabe, vacío: no se podrá apartar" /></label>
              </div>
            )}
          </div>

          {erroresPaso2.length > 0 && lineas && <p className="text-xs text-red-600">{erroresPaso2[0]}</p>}
        </section>
      )}

      {paso === 3 && (
        <section className="space-y-3">
          <div className="rounded-lg border border-dashed border-[#E5E7EB] bg-white p-4 text-sm text-[#6B7280]">{AVISO_POST}</div>
          <p className="text-sm text-[#1A1A1A]">El borrador quedó guardado. Al publicar, sus funciones quedan disponibles para el asistente.</p>
        </section>
      )}

      <BotonFijo>
        {paso === 1 && (
          <button type="button" disabled={pendiente || (!nueva && !experienciaId) || (!!nueva && !nueva.nombre.trim())} onClick={seguirPaso1} className="h-12 flex-1 rounded-md bg-[#10B981] font-medium text-white disabled:opacity-50">
            Seguir
          </button>
        )}
        {paso === 2 && (
          <>
            <button type="button" onClick={() => setPaso(1)} className="h-12 rounded-md border border-[#E5E7EB] px-4">Atrás</button>
            <button type="button" disabled={pendiente || erroresPaso2.length > 0} onClick={seguirPaso2} className="h-12 flex-1 rounded-md bg-[#10B981] font-medium text-white disabled:opacity-50">
              {pendiente ? 'Guardando…' : `Seguir (${lineas?.length ?? 0} funciones)`}
            </button>
          </>
        )}
        {paso === 3 && (
          <>
            <button type="button" onClick={() => router.push(`/funciones/campanas/${campanaId}`)} className="h-12 rounded-md border border-[#E5E7EB] px-4 text-sm">Guardar sin publicar</button>
            <button type="button" disabled={pendiente} onClick={() => setConfirmar(true)} className="h-12 flex-1 rounded-md bg-[#10B981] font-medium text-white disabled:opacity-50">
              Publicar y copiar post
            </button>
          </>
        )}
      </BotonFijo>

      <Hoja
        abierta={confirmar}
        onCerrar={() => setConfirmar(false)}
        titulo="Publicar la campaña"
        efecto={`Las ${lineas?.length ?? 0} funciones quedan disponibles para el asistente desde ya. Hoy solo se publica: ${AVISO_POST.toLowerCase()}`}
        confirmar={{ texto: 'Publicar', onConfirmar: publicar, pendiente }}
      />
    </div>
  )
}
