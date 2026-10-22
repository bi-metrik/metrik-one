'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import type { ExperienciaCatalogo } from '@/lib/funciones/datos'
import { crearFuncionesAction } from '../actions'
import { AltaExperiencia } from '../formulario-comun'

interface Inicio {
  clave: string
  fecha: string
  hora: string
}

let siguiente = 0
const nuevo = (fecha = '', hora = ''): Inicio => ({ clave: `i${++siguiente}`, fecha, hora })

/**
 * Formulario de funciones (§4.3): experiencia, cupo (la capacidad de la función), estado, cierre de venta y una o
 * varias fechas y horas (hora de Bogotá). La ficha se crea aquí: nada la pre-llena
 * (Mauricio, 2026-10-22).
 */
export function FormularioFunciones({ experiencias: iniciales }: { experiencias: ExperienciaCatalogo[] }) {
  const router = useRouter()
  const [pendiente, empezar] = useTransition()
  const [experiencias, setExperiencias] = useState(iniciales)
  const [experienciaId, setExperienciaId] = useState(iniciales[0]?.id ?? '')
  const [alta, setAlta] = useState(iniciales.length === 0)
  const [cupo, setCupo] = useState('')
  const [estado, setEstado] = useState<'abierta' | 'cerrada'>('abierta')
  const [cierre, setCierre] = useState('')
  const [inicios, setInicios] = useState<Inicio[]>([nuevo()])

  const cupoN = Number(cupo)
  const experiencia = experiencias.find((e) => e.id === experienciaId)

  const incompletos = inicios.filter((i) => !i.fecha || !i.hora)
  const guardar = () =>
    empezar(async () => {
      if (!experienciaId) return void toast.error('Elige o crea la experiencia.')
      if (!(cupoN >= 1)) return void toast.error('Escribe el cupo total.')
      if (incompletos.length > 0) return void toast.error('Cada función necesita fecha y hora.')
      const r = await crearFuncionesAction({
        experiencia_id: experienciaId,
        cupo_total: cupoN,
        estado,
        cierre_minutos_antes: cierre.trim() ? Math.round(Number(cierre) * 60) : null,
        inicios: inicios.map(({ fecha, hora }) => ({ fecha, hora })),
      })
      if (!r.ok) return void toast.error(r.error)
      toast.success(`${r.dato?.length ?? 0} función(es) creadas.`)
      router.push('/funciones')
      router.refresh()
    })

  return (
    <div className="mx-auto max-w-3xl space-y-4 p-4 md:p-6 text-sm">
      <h1 className="text-xl font-semibold text-[#1A1A1A]">Nuevas funciones</h1>

      <label className="block">
        <span className="text-xs text-[#6B7280]">
          Experiencia
        </span>
        <div className="flex gap-2">
          <select
            value={experienciaId}
            onChange={(e) => {
              setExperienciaId(e.target.value)
            }}
            className="mt-0.5 flex-1 rounded border border-[#E5E7EB] px-2 py-1"
          >
            {experiencias.length === 0 && <option value="">(crea una primero)</option>}
            {experiencias.map((e) => (
              <option key={e.id} value={e.id}>
                {e.nombre}
              </option>
            ))}
          </select>
          <button type="button" onClick={() => setAlta(!alta)} className="rounded border px-2 text-xs">
            + Nueva
          </button>
        </div>
      </label>
      {experiencia && experiencia.minutos_apartado === null && (
        <p className="text-xs text-amber-700">Esta experiencia no tiene definido cuánto dura un apartado sin pago: se puede crear la función, pero todavía no se puede apartar.</p>
      )}
      {alta && (
        <AltaExperiencia
          onCreada={(e) => {
            setExperiencias((xs) => [...xs, e])
            setExperienciaId(e.id)
            setAlta(false)
          }}
        />
      )}

      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block">
          <span className="text-xs text-[#6B7280]">
            Cupo total por función
          </span>
          <input
            type="number"
            min={1}
            value={cupo}
            onChange={(e) => {
              setCupo(e.target.value)
            }}
            className="mt-0.5 w-full rounded border border-[#E5E7EB] px-2 py-1"
          />
        </label>
        <label className="block">
          <span className="text-xs text-[#6B7280]">Estado</span>
          <select value={estado} onChange={(e) => setEstado(e.target.value as 'abierta' | 'cerrada')} className="mt-0.5 w-full rounded border border-[#E5E7EB] px-2 py-1">
            <option value="abierta">Abierta (se vende)</option>
            <option value="cerrada">Venta cerrada</option>
          </select>
        </label>
        <label className="block">
          <span className="text-xs text-[#6B7280]">Cerrar la venta cuántas horas antes (vacío = hasta el inicio)</span>
          <input type="number" min={0} step="0.5" value={cierre} onChange={(e) => setCierre(e.target.value)} className="mt-0.5 w-full rounded border border-[#E5E7EB] px-2 py-1" />
        </label>
      </div>

      <div className="space-y-2 rounded-lg border border-[#E5E7EB] bg-white p-3">
        <p className="text-xs text-[#6B7280]">Fechas y horas (hora de Bogotá)</p>
        {inicios.map((i) => (
          <div key={i.clave} className="flex flex-wrap items-center gap-2">
            <input
              type="date"
              value={i.fecha}
              onChange={(e) => setInicios((xs) => xs.map((x) => (x.clave === i.clave ? { ...x, fecha: e.target.value } : x)))}
              className="rounded border border-[#E5E7EB] px-2 py-1"
            />
            <input
              type="time"
              value={i.hora}
              onChange={(e) => setInicios((xs) => xs.map((x) => (x.clave === i.clave ? { ...x, hora: e.target.value } : x)))}
              className="rounded border border-[#E5E7EB] px-2 py-1"
            />
            <button type="button" onClick={() => setInicios((xs) => (xs.length > 1 ? xs.filter((x) => x.clave !== i.clave) : xs))} className="text-xs text-[#6B7280] hover:text-red-600">
              Quitar
            </button>
          </div>
        ))}
        <button type="button" onClick={() => setInicios((xs) => [...xs, nuevo()])} className="rounded border px-3 py-1 text-xs">
          + Fecha
        </button>
      </div>

      <div className="flex items-center gap-3">
        <button type="button" disabled={pendiente} onClick={guardar} className="rounded-md bg-[#10B981] px-4 py-2 font-medium text-white hover:bg-[#059669] disabled:opacity-50">
          {pendiente ? 'Guardando…' : `Crear ${inicios.length} función(es)`}
        </button>
        {incompletos.length > 0 && <span className="text-xs text-amber-700">{incompletos.length} sin fecha u hora.</span>}
      </div>
    </div>
  )
}
