'use client'

import { useState } from 'react'
import { toast } from 'sonner'
import { useTransitionTolerante } from '@/hooks/use-transition-tolerante'
import {
  FALTA_LA_FECHA,
  MAX_TRAMOS,
  fechaEnPalabras,
  fechasDeFila,
  resumenDeFechas,
  validarFechasEditadas,
  type FechasEditadas,
  type TramoEditado,
} from '@/lib/viaje/fechas-servicio'
import type { ServicioDelNegocio } from '@/lib/viaje/servicios-viaje-datos'
import { actualizarFechasServicio } from '../../servicios-viaje-actions'

/**
 * «Fechas» de la hoja de la fila: inicio, fin y horas; en un vuelo, cada tramo (fecha, horas,
 * ruta, aerolínea y número). Lo leído de la cotización llega puesto; lo que se corrige aquí queda
 * «Corregido a mano» y ninguna regeneración lo pisa. Campos nativos de fecha y hora, de 44 px.
 */

const CAMPO = 'h-11 w-full min-w-0 rounded-md border px-2 text-sm disabled:bg-muted'

const tramoVacio = (): TramoEditado => ({ fecha: '', hora_salida: '', hora_llegada: '', origen: '', destino: '', aerolinea: '', numero_vuelo: '' })

/** La línea de fechas de la fila cerrada: «lun 10 nov · 06:10 → sáb 15 nov» o «Falta la fecha». */
export function LineaDeFechas({ s }: { s: ServicioDelNegocio }) {
  const resumen = resumenDeFechas(fechasDeFila(s))
  return resumen
    ? <span className="tabular-nums text-foreground">{resumen}</span>
    : <span className="text-amber-600">{FALTA_LA_FECHA}</span>
}

export default function FechasServicio({
  s,
  puedeEditar,
  nombres,
  alGuardar,
}: {
  s: ServicioDelNegocio
  puedeEditar: boolean
  nombres?: Record<string, string>
  alGuardar: () => void
}) {
  const f = fechasDeFila(s)
  const esVuelo = s.tipo === 'vuelo'
  const [tramos, setTramos] = useState<TramoEditado[]>(() =>
    f.tramos && f.tramos.length > 0
      ? f.tramos.map(t => ({ ...t }))
      : f.fecha_servicio ? [{ ...tramoVacio(), fecha: f.fecha_servicio, hora_salida: f.hora_inicio ?? '' }] : [tramoVacio()])
  const [campos, setCampos] = useState<FechasEditadas>({
    fecha_servicio: f.fecha_servicio ?? '',
    hora_inicio: f.hora_inicio ?? '',
    fecha_fin: f.fecha_fin ?? '',
    hora_fin: f.hora_fin ?? '',
  })
  const [error, setError] = useState<string | null>(null)
  const [isPending, startTransition] = useTransitionTolerante()
  const deshabilitado = !puedeEditar || isPending

  const quien = s.fechas_corregidas_por ? nombres?.[s.fechas_corregidas_por] : null
  const corregida = s.fechas_corregidas_at
    ? `Corregida a mano${quien ? ` por ${quien}` : ''} el ${fechaEnPalabras(s.fechas_corregidas_at.slice(0, 10))}.`
    : null

  function guardar() {
    // Los tramos que quedaron del todo vacíos no se guardan (el «Agregar tramo» de más).
    const entrada: FechasEditadas = esVuelo
      ? { tramos: tramos.filter(t => Object.values(t).some(x => (x ?? '').toString().trim() !== '')) }
      : campos
    const v = validarFechasEditadas(s.tipo, entrada)
    if (!v.ok) {
      setError(v.error)
      return
    }
    setError(null)
    startTransition(async () => {
      const r = await actualizarFechasServicio(s.id, entrada)
      if (!r.ok) {
        setError(r.error)
        toast.error(r.error)
        return
      }
      toast.success('Fechas guardadas.')
      alGuardar()
    })
  }

  const cambiarTramo = (i: number, clave: keyof TramoEditado, valor: string) =>
    setTramos(ts => ts.map((t, j) => (j === i ? { ...t, [clave]: valor } : t)))

  return (
    <div className="space-y-2" data-fechas-servicio>
      <div className="flex flex-wrap items-baseline justify-between gap-x-2">
        <p className="text-xs font-semibold">Fechas</p>
        {corregida
          ? <p className="text-[11px] text-muted-foreground">{corregida}</p>
          : !f.fecha_servicio && <p className="text-[11px] text-amber-600">{FALTA_LA_FECHA}: ponla aquí.</p>}
      </div>

      {esVuelo ? (
        <ol className="space-y-2">
          {tramos.map((t, i) => (
            <li key={i} className="space-y-2 rounded-md border p-2">
              <div className="flex items-center justify-between">
                <p className="text-xs font-medium">{tramos.length === 1 ? 'Ida' : tramos.length === 2 ? (i === 0 ? 'Ida' : 'Regreso') : `Tramo ${i + 1}`}</p>
                {puedeEditar && tramos.length > 1 && (
                  <button type="button" disabled={deshabilitado} onClick={() => setTramos(ts => ts.filter((_, j) => j !== i))}
                    className="min-h-11 px-2 text-xs text-muted-foreground underline disabled:opacity-60">
                    Quitar
                  </button>
                )}
              </div>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                <label className="col-span-2 block space-y-1 sm:col-span-1">
                  <span className="text-xs">Fecha</span>
                  <input type="date" value={t.fecha ?? ''} disabled={deshabilitado} onChange={e => cambiarTramo(i, 'fecha', e.target.value)} className={CAMPO} />
                </label>
                <label className="block space-y-1">
                  <span className="text-xs">Sale</span>
                  <input type="time" value={t.hora_salida ?? ''} disabled={deshabilitado} onChange={e => cambiarTramo(i, 'hora_salida', e.target.value)} className={CAMPO} />
                </label>
                <label className="block space-y-1">
                  <span className="text-xs">Llega</span>
                  <input type="time" value={t.hora_llegada ?? ''} disabled={deshabilitado} onChange={e => cambiarTramo(i, 'hora_llegada', e.target.value)} className={CAMPO} />
                </label>
                <label className="block space-y-1">
                  <span className="text-xs">Desde</span>
                  <input type="text" value={t.origen ?? ''} disabled={deshabilitado} onChange={e => cambiarTramo(i, 'origen', e.target.value)} placeholder="BOG" className={CAMPO} />
                </label>
                <label className="block space-y-1">
                  <span className="text-xs">Hasta</span>
                  <input type="text" value={t.destino ?? ''} disabled={deshabilitado} onChange={e => cambiarTramo(i, 'destino', e.target.value)} className={CAMPO} />
                </label>
                <label className="block space-y-1">
                  <span className="text-xs">Aerolínea</span>
                  <input type="text" value={t.aerolinea ?? ''} disabled={deshabilitado} onChange={e => cambiarTramo(i, 'aerolinea', e.target.value)} className={CAMPO} />
                </label>
                <label className="block space-y-1">
                  <span className="text-xs">Nº de vuelo</span>
                  <input type="text" value={t.numero_vuelo ?? ''} disabled={deshabilitado} onChange={e => cambiarTramo(i, 'numero_vuelo', e.target.value)} className={CAMPO} />
                </label>
              </div>
            </li>
          ))}
        </ol>
      ) : (
        <div className="grid grid-cols-2 gap-2">
          <label className="block space-y-1">
            <span className="text-xs">{s.tipo === 'hotel' ? 'Check-in' : 'Inicio'}</span>
            <input type="date" value={campos.fecha_servicio ?? ''} disabled={deshabilitado}
              onChange={e => setCampos(c => ({ ...c, fecha_servicio: e.target.value }))} className={CAMPO} />
          </label>
          <label className="block space-y-1">
            <span className="text-xs">Hora</span>
            <input type="time" value={campos.hora_inicio ?? ''} disabled={deshabilitado}
              onChange={e => setCampos(c => ({ ...c, hora_inicio: e.target.value }))} className={CAMPO} />
          </label>
          <label className="block space-y-1">
            <span className="text-xs">{s.tipo === 'hotel' ? 'Check-out' : 'Fin'}</span>
            <input type="date" value={campos.fecha_fin ?? ''} min={campos.fecha_servicio || undefined} disabled={deshabilitado}
              onChange={e => setCampos(c => ({ ...c, fecha_fin: e.target.value }))} className={CAMPO} />
          </label>
          <label className="block space-y-1">
            <span className="text-xs">Hora</span>
            <input type="time" value={campos.hora_fin ?? ''} disabled={deshabilitado}
              onChange={e => setCampos(c => ({ ...c, hora_fin: e.target.value }))} className={CAMPO} />
          </label>
        </div>
      )}

      {error && <p role="alert" className="text-xs text-red-600">{error}</p>}

      {puedeEditar && (
        <div className="flex flex-wrap gap-2">
          <button type="button" disabled={deshabilitado} onClick={guardar}
            className="min-h-11 rounded-md bg-primary px-3 text-sm font-medium text-primary-foreground disabled:opacity-60">
            {isPending ? 'Guardando…' : 'Guardar fechas'}
          </button>
          {esVuelo && tramos.length < MAX_TRAMOS && (
            <button type="button" disabled={deshabilitado} onClick={() => setTramos(ts => [...ts, tramoVacio()])}
              className="min-h-11 rounded-md border px-3 text-sm disabled:opacity-60">
              Agregar tramo
            </button>
          )}
        </div>
      )}
    </div>
  )
}
