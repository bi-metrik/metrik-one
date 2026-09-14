'use client'

import { useEffect, useState, useTransition } from 'react'
import { Download, Loader2, X } from 'lucide-react'
import { toast } from 'sonner'
import {
  generarCronogramaPDF,
  leerGanttCronograma,
  type GanttCronograma,
} from '../../cronograma-gantt-actions'
import {
  ETIQUETA_ESTADO,
  fechaCorta,
  fechaCortaAno,
  posicionTramo,
  textoDesfase,
  diasEntre,
  type EstadoPaso,
} from '@/lib/cronograma/gantt'

const COLOR_ESTADO: Record<EstadoPaso, string> = {
  completado: 'text-green-700',
  en_curso: 'text-blue-700',
  atrasado: 'text-red-600',
  pendiente: 'text-tinta-suave',
  sin_fecha: 'text-tinta-suave/60',
}

/**
 * El Gantt del proyecto a pantalla completa: lo mismo que recibe el cliente en PDF.
 *
 * Se abre desde el bloque de cronograma y NO edita nada. La tabla del bloque es donde
 * se planea y se marca el avance; esto es la lectura que se comparte, y mezclar las dos
 * cosas en una misma vista haría que cualquier arrastre por accidente moviera el plan
 * y publicara una versión.
 */
export default function GanttCronogramaModal({
  negocioBloqueId,
  onClose,
}: {
  negocioBloqueId: string
  onClose: () => void
}) {
  const [gantt, setGantt] = useState<GanttCronograma | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [descargando, startDescarga] = useTransition()

  useEffect(() => {
    let vigente = true
    void leerGanttCronograma(negocioBloqueId).then(res => {
      if (!vigente) return
      if (res.gantt) setGantt(res.gantt)
      else setError(res.error ?? 'No se pudo leer el cronograma')
    })
    return () => { vigente = false }
  }, [negocioBloqueId])

  useEffect(() => {
    const alTeclear = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', alTeclear)
    return () => window.removeEventListener('keydown', alTeclear)
  }, [onClose])

  function descargar() {
    startDescarga(async () => {
      const res = await generarCronogramaPDF(negocioBloqueId)
      if (!res.pdf) {
        toast.error(res.error ?? 'No se pudo generar el PDF')
        return
      }
      const bytes = Uint8Array.from(atob(res.pdf), c => c.charCodeAt(0))
      const url = URL.createObjectURL(new Blob([bytes], { type: 'application/pdf' }))
      const a = document.createElement('a')
      a.href = url
      a.download = res.filename ?? 'Cronograma.pdf'
      document.body.appendChild(a)
      a.click()
      a.remove()
      URL.revokeObjectURL(url)
    })
  }

  const modelo = gantt?.modelo
  const kpis = modelo?.kpis
  const atrasado = (kpis?.desfaseDias ?? 0) > 0
  const corrida = !!(kpis?.entregaPlan && kpis.entregaProyectada && kpis.entregaProyectada > kpis.entregaPlan)
  const xHoy = modelo?.desde && modelo.hasta && modelo.hoy >= modelo.desde && modelo.hoy <= modelo.hasta
    ? ((diasEntre(modelo.desde, modelo.hoy) + 0.5) / modelo.totalDias) * 100
    : null

  return (
    <div
      className="fixed inset-0 z-50 flex items-stretch justify-center bg-black/40 sm:items-center sm:p-4"
      role="dialog"
      aria-modal="true"
      aria-label="Cronograma del proyecto"
      onClick={onClose}
    >
      <div
        className="flex max-h-full w-full max-w-6xl flex-col overflow-hidden bg-white sm:rounded-xl"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between gap-2 border-b border-[#E5E7EB] px-4 py-3">
          <p className="text-sm font-semibold text-tinta">Cronograma del proyecto</p>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={descargar}
              disabled={!gantt || descargando}
              className="flex items-center gap-1.5 rounded-full bg-acento px-3 py-1.5 text-xs font-medium text-papel disabled:opacity-50"
            >
              {descargando ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5" />}
              Descargar PDF
            </button>
            <button type="button" onClick={onClose} aria-label="Cerrar" className="rounded-full p-1.5 text-tinta-suave hover:bg-black/[0.04]">
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        <div className="overflow-y-auto p-4 sm:p-6">
          {error && <p className="text-sm text-red-600">{error}</p>}
          {!gantt && !error && (
            <p className="flex items-center gap-2 text-sm text-tinta-suave">
              <Loader2 className="h-4 w-4 animate-spin" /> Armando el cronograma
            </p>
          )}

          {gantt && modelo && kpis && (
            <div className="space-y-5">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-[10px] font-medium uppercase tracking-wider text-tinta-suave">
                    {gantt.encabezado.empresaEmisora}
                    {gantt.encabezado.negocioCodigo && ` · ${gantt.encabezado.negocioCodigo}`}
                  </p>
                  <p className="mt-0.5 break-words text-lg font-bold text-tinta">{gantt.encabezado.negocioNombre}</p>
                  {gantt.encabezado.cliente && (
                    <p className="text-xs text-tinta-suave">Cliente: {gantt.encabezado.cliente}</p>
                  )}
                </div>
                <div className="text-right">
                  <span
                    className={`inline-block rounded-full px-2.5 py-1 text-[11px] font-semibold ${
                      gantt.version ? 'bg-acento/10 text-acento' : 'bg-black/[0.04] text-tinta-suave'
                    }`}
                  >
                    {gantt.version ? `Versión ${gantt.version.numero} · publicada` : 'Borrador · sin versión publicada'}
                  </span>
                  {gantt.version && (
                    <p className="mt-1 text-[10px] text-tinta-suave">
                      Publicada el {fechaCortaAno(gantt.version.publicada.slice(0, 10))}
                    </p>
                  )}
                </div>
              </div>

              <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
                <div className="rounded-lg border border-[#E5E7EB] p-3">
                  <p className="text-[10px] font-medium uppercase text-tinta-suave">Avance</p>
                  <p className="text-xl font-bold tabular-nums text-acento">{kpis.avancePct}%</p>
                  <div className="mt-1 h-1 rounded-full bg-black/[0.06]">
                    <div className="h-1 rounded-full bg-acento" style={{ width: `${kpis.avancePct}%` }} />
                  </div>
                  <p className="mt-1 text-[10px] text-tinta-suave">{kpis.completados} de {kpis.total} terminadas</p>
                </div>
                <div className="rounded-lg border border-[#E5E7EB] p-3">
                  <p className="text-[10px] font-medium uppercase text-tinta-suave">Entrega planeada</p>
                  <p className="text-base font-bold text-tinta">{kpis.entregaPlan ? fechaCortaAno(kpis.entregaPlan) : 'Sin fecha'}</p>
                </div>
                <div className="rounded-lg border border-[#E5E7EB] p-3">
                  <p className="text-[10px] font-medium uppercase text-tinta-suave">Entrega proyectada</p>
                  <p className={`text-base font-bold ${corrida ? 'text-amber-700' : 'text-tinta'}`}>
                    {kpis.entregaProyectada ? fechaCortaAno(kpis.entregaProyectada) : 'Sin fecha'}
                  </p>
                  <p className="text-[10px] text-tinta-suave">{corrida ? 'Corrida por el avance real' : 'En línea con el plan'}</p>
                </div>
                <div className="rounded-lg border border-[#E5E7EB] p-3">
                  <p className="text-[10px] font-medium uppercase text-tinta-suave">Desfase</p>
                  <p className={`text-base font-bold ${atrasado ? 'text-red-600' : 'text-green-700'}`}>
                    {textoDesfase(kpis.desfaseDias)}
                  </p>
                  <p className="text-[10px] text-tinta-suave">{atrasado ? 'De la actividad más atrasada' : 'Ninguna actividad atrasada'}</p>
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[10px] text-tinta-suave">
                <span className="flex items-center gap-1"><span className="h-1.5 w-4 rounded-full bg-slate-300" /> Planeado</span>
                <span className="flex items-center gap-1"><span className="h-2 w-4 rounded-full bg-acento" /> Real</span>
                <span className="flex items-center gap-1"><span className="h-2 w-4 rounded-full bg-amber-600" /> Fuera de plan</span>
                <span className="flex items-center gap-1"><span className="h-3 w-px bg-red-600" /> Hoy</span>
              </div>

              {modelo.filas.length === 0 ? (
                <p className="text-sm text-tinta-suave">Este cronograma todavía no tiene actividades.</p>
              ) : (
                // En el celular el eje no cabe: la tabla se desplaza sola y la página no.
                <div className="overflow-x-auto">
                  <div className="min-w-[720px]">
                    <div className="flex items-end border-b border-tinta pb-1 text-[10px] uppercase text-tinta-suave">
                      <span className="w-56 shrink-0">Actividad</span>
                      <span className="w-20 shrink-0">Estado</span>
                      <div className="relative h-4 flex-1">
                        {modelo.semanas.map((s, i) => (
                          <span
                            key={s.inicio}
                            className="absolute top-0 whitespace-nowrap normal-case"
                            style={{ left: `${(i * 7 * 100) / modelo.totalDias}%` }}
                          >
                            {modelo.semanas.length <= 14 || i % Math.ceil(modelo.semanas.length / 14) === 0 ? s.etiqueta : ''}
                          </span>
                        ))}
                      </div>
                    </div>

                    {modelo.filas.map(fila => {
                      const plan = fila.plan ? posicionTramo(fila.plan, modelo) : null
                      const real = fila.real ? posicionTramo(fila.real, modelo) : null
                      const fuera = fila.fueraDePlan ? posicionTramo(fila.fueraDePlan, modelo) : null
                      return (
                        <div key={fila.id} className="flex items-center border-b border-[#F0EFEA] py-1.5">
                          <div className="w-56 shrink-0 pr-3">
                            <p className="truncate text-xs font-medium text-tinta" title={fila.label}>{fila.label}</p>
                            <p className="truncate text-[10px] text-tinta-suave">
                              {fila.plan ? `${fechaCorta(fila.plan.inicio)} a ${fechaCorta(fila.plan.fin)}` : 'Sin fechas planeadas'}
                              {fila.responsable && ` · ${fila.responsable}`}
                            </p>
                          </div>
                          <div className="w-20 shrink-0">
                            <p className={`text-[10px] font-semibold ${COLOR_ESTADO[fila.estado]}`}>{ETIQUETA_ESTADO[fila.estado]}</p>
                            {fila.desfaseDias !== null && fila.desfaseDias > 0 && fila.estado !== 'pendiente' && (
                              <p className="text-[10px] text-red-600">+{fila.desfaseDias} d</p>
                            )}
                          </div>
                          <div className="relative h-7 flex-1">
                            {modelo.semanas.map((s, i) => (
                              <span
                                key={s.inicio}
                                className="absolute inset-y-0 w-px bg-[#F0EFEA]"
                                style={{ left: `${(i * 7 * 100) / modelo.totalDias}%` }}
                              />
                            ))}
                            {plan && (
                              <span className="absolute top-1 h-1.5 rounded-full bg-slate-300" style={{ left: `${plan.izquierda}%`, width: `${plan.ancho}%` }} />
                            )}
                            {real && (
                              <span className="absolute top-3.5 h-2 rounded-full bg-acento" style={{ left: `${real.izquierda}%`, width: `${real.ancho}%` }} />
                            )}
                            {fuera && (
                              <span className="absolute top-3.5 h-2 rounded-full bg-amber-600" style={{ left: `${fuera.izquierda}%`, width: `${fuera.ancho}%` }} />
                            )}
                            {xHoy !== null && (
                              <span className="absolute inset-y-0 w-px bg-red-600" style={{ left: `${xHoy}%` }} />
                            )}
                          </div>
                        </div>
                      )
                    })}
                  </div>
                </div>
              )}

              {gantt.version && gantt.version.numero > 1 && gantt.version.cambios.length > 0 && (
                <div className="border-l-2 border-acento pl-3">
                  <p className="text-xs font-semibold text-tinta">Qué cambió frente a la versión {gantt.version.numero - 1}</p>
                  <ul className="mt-1 space-y-0.5">
                    {gantt.version.cambios.map((c, i) => (
                      <li key={i} className="text-[11px] text-tinta-suave">· {c}</li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
