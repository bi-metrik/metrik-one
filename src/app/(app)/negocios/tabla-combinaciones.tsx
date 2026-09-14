'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Loader2, Sparkles, Star, Trash2 } from 'lucide-react'
import { toast } from 'sonner'

import {
  cambiarOpcionDeItinerario,
  eliminarItinerario,
  generarCombinaciones,
  marcarEnPropuesta,
  marcarPrincipal,
  renombrarItinerario,
  type EstadoItinerarios,
} from '@/app/(app)/negocios/itinerario-actions'
import { nombreDeItinerario } from '@/lib/cotizaciones/itinerarios'
import { nivelDeMargen } from '@/lib/cotizaciones/convencion-margen'
import { claseNivelMargen, formatMargenPct } from '@/lib/cotizaciones/margen-vista'
import { formatCOP } from '@/lib/contacts/constants'

/**
 * La tabla de combinaciones: dónde se decide qué ve el cliente.
 *
 * Filas = itinerarios. Columnas = grupos. Celdas = desplegable con las opciones de
 * ese grupo. Al final de cada fila: costo, precio, margen y el interruptor «va en
 * propuesta».
 *
 * ## R6 en la pantalla
 *
 * **Esta sección no existe para una cotización sin opciones.** Sin ranuras y sin
 * itinerarios no se pinta nada: Termotech, Arca y WMC abren su cotización exactamente
 * igual que antes, sin una sección nueva que explicar. El corte es el mismo que
 * sostiene R6 en el servidor, no un flag aparte que alguien pueda encender.
 *
 * ## Por qué vive aparte del editor
 *
 * `cotizacion-editor.tsx` ya son 1.600 líneas y su estado es el de los ítems. Esta
 * tabla tiene su propio ciclo (leer, generar, marcar) y se puede renderizar sola en
 * una prueba, que es lo único que fija que el JSX obedezca las reglas — una prueba del
 * helper sigue en verde con el botón mal pintado.
 */
export default function TablaCombinaciones({
  cotizacionId,
  estado,
  editable,
}: {
  cotizacionId: string
  estado: EstadoItinerarios
  editable: boolean
}) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [nombres, setNombres] = useState<Record<string, string>>({})

  const { ranuras, itinerarios, umbrales, tablasAusentes } = estado

  // R6 · sin opciones y sin itinerarios no hay nada que decidir: la sección no se
  // pinta. Una cotización que ya existía no gana una sección al abrirla.
  if (ranuras.length === 0 && itinerarios.length === 0) return null

  function correr(accion: () => Promise<{ success: boolean; error?: string }>, exito?: string) {
    startTransition(async () => {
      const r = await accion()
      if (!r.success) {
        // El motivo del servidor se muestra ENTERO. Es la única explicación de por qué
        // no se pudo, y resumirlo a «no se pudo» deja al usuario sin saber si le falta
        // elegir un hotel o subir un precio.
        toast.error(r.error ?? 'No se pudo completar la acción')
        return
      }
      if (exito) toast.success(exito)
      router.refresh()
    })
  }

  return (
    <div className="rounded-lg border">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b px-4 py-3">
        <div>
          <h3 className="text-sm font-semibold">Combinaciones</h3>
          <p className="text-[11px] text-muted-foreground">
            Cada fila es un itinerario completo con su propio costo y su propio margen.
            {' '}Solo las marcadas «va en propuesta» salen en el PDF.
          </p>
        </div>
        {editable && ranuras.length > 0 && !tablasAusentes && (
          <button
            type="button"
            disabled={isPending}
            onClick={() =>
              startTransition(async () => {
                const r = await generarCombinaciones(cotizacionId)
                if (!r.success) {
                  toast.error(r.error ?? 'No se pudieron generar')
                  return
                }
                // Se dice cuántas se crearon Y cuántas ya estaban: regenerar tras
                // agregar un hotel conserva lo revisado, y sin el conteo eso se lee
                // como que el botón no hizo nada.
                const partes = [`${r.creadas} combinación${r.creadas === 1 ? '' : 'es'} nueva${r.creadas === 1 ? '' : 's'}`]
                if (r.yaExistian) partes.push(`${r.yaExistian} ya estaban`)
                toast.success(partes.join(', '))
                if (r.aviso) toast.warning(r.aviso)
                router.refresh()
              })
            }
            className="flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50"
          >
            {isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
            Generar combinaciones
          </button>
        )}
      </div>

      {tablasAusentes && (
        <div className="border-b bg-amber-50 px-4 py-3 text-xs text-amber-800 dark:bg-amber-950/20 dark:text-amber-300">
          Los itinerarios todavía no están disponibles en esta base de datos: falta aplicar
          la migración <code>20260914200000_cotizacion_itinerarios.sql</code>. La cotización
          funciona como siempre mientras tanto.
        </div>
      )}

      {!tablasAusentes && itinerarios.length === 0 && (
        <div className="px-4 py-6 text-center text-xs text-muted-foreground">
          Hay {ranuras.length === 1 ? 'un grupo' : `${ranuras.length} grupos`} con alternativas
          {' '}({ranuras.map(r => r.grupo).join(', ')}).
          {' '}Genera las combinaciones para ver el margen de cada una.
        </div>
      )}

      {itinerarios.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b bg-muted/40 text-left">
                <th className="px-3 py-2 font-medium">Itinerario</th>
                {ranuras.map(r => (
                  <th key={r.grupo} className="px-3 py-2 font-medium capitalize">{r.grupo}</th>
                ))}
                <th className="px-3 py-2 text-right font-medium">Costo</th>
                <th className="px-3 py-2 text-right font-medium">Precio</th>
                <th className="px-3 py-2 text-right font-medium">Margen</th>
                <th className="px-3 py-2 text-center font-medium">Va en propuesta</th>
                <th className="px-3 py-2" />
              </tr>
            </thead>
            <tbody>
              {itinerarios.map((it, i) => {
                const nivel = nivelDeMargen(it.margenRealPct, umbrales)
                const margenTexto = formatMargenPct(it.margenRealPct)
                return (
                  <tr
                    key={it.id}
                    // T4 · la fila bajo el piso se marca, igual que la línea del paso 1.
                    className={`border-b last:border-0 ${nivel === 'bajo_piso' ? 'bg-red-50/60 dark:bg-red-950/10' : ''}`}
                  >
                    <td className="px-3 py-2">
                      <div className="flex items-center gap-1.5">
                        {it.esPrincipal && (
                          <Star
                            className="h-3.5 w-3.5 shrink-0 fill-amber-400 text-amber-500"
                            aria-label="Principal"
                          />
                        )}
                        {editable ? (
                          <input
                            // T6 · nombre libre, viaja al PDF. Vacío: el PDF numera, y
                            // el marcador de posición dice cuál número le tocaría.
                            value={nombres[it.id] ?? it.nombre ?? ''}
                            placeholder={nombreDeItinerario(null, i + 1)}
                            onChange={e => setNombres(n => ({ ...n, [it.id]: e.target.value }))}
                            onBlur={e => {
                              if ((e.target.value.trim() || null) === (it.nombre ?? null)) return
                              correr(() => renombrarItinerario(it.id, e.target.value))
                            }}
                            className="w-32 rounded border-0 bg-transparent px-1 py-0.5 text-xs font-medium focus:bg-background focus:ring-1"
                          />
                        ) : (
                          <span className="font-medium">{nombreDeItinerario(it.nombre, i + 1)}</span>
                        )}
                      </div>
                      {it.ranurasFaltantes.length > 0 && (
                        <span className="text-[10px] text-red-600">
                          Falta elegir: {it.ranurasFaltantes.join(', ')}
                        </span>
                      )}
                    </td>

                    {ranuras.map(r => {
                      const elegido = r.candidatos.find(c => it.seleccion.includes(c.id))
                      return (
                        <td key={r.grupo} className="px-3 py-2">
                          <select
                            value={elegido?.id ?? ''}
                            disabled={!editable || isPending}
                            // T3 · cambiar una celda recalcula ESA fila. El servidor
                            // decide; aquí solo se manda el cambio y se relee.
                            onChange={e =>
                              startTransition(async () => {
                                const res = await cambiarOpcionDeItinerario(it.id, r.grupo, e.target.value)
                                if (!res.success) {
                                  toast.error(res.error ?? 'No se pudo cambiar')
                                  return
                                }
                                for (const d of res.desmarcados ?? []) {
                                  toast.warning(
                                    `«${nombreDeItinerario(d.nombre, 0)}» salió de la propuesta: ${d.motivo}`,
                                  )
                                }
                                router.refresh()
                              })
                            }
                            className="w-full max-w-[12rem] rounded border bg-background px-1.5 py-1 text-xs disabled:opacity-60"
                          >
                            <option value="" disabled>Elegir…</option>
                            {r.candidatos.map(c => (
                              <option key={c.id} value={c.id}>{c.nombre || 'Sin nombre'}</option>
                            ))}
                          </select>
                        </td>
                      )
                    })}

                    <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">
                      {formatCOP(it.costo)}
                    </td>
                    <td className="px-3 py-2 text-right font-medium tabular-nums">
                      {formatCOP(it.precio)}
                    </td>
                    <td className={`px-3 py-2 text-right tabular-nums ${claseNivelMargen(nivel)}`}>
                      {/* Sin margen medible se pinta una raya, no un 0%: un cero ahí
                          afirma que se vende a costo, y lo único cierto es que todavía
                          no hay con qué medirlo. */}
                      {margenTexto ?? '—'}
                    </td>

                    <td className="px-3 py-2 text-center">
                      <label className="inline-flex cursor-pointer items-center gap-1">
                        <input
                          type="checkbox"
                          checked={it.vaEnPropuesta}
                          disabled={!editable || isPending || (!it.vaEnPropuesta && it.bloqueo !== null)}
                          // El interruptor se deshabilita cuando hay bloqueo, pero el
                          // servidor RECHAZA igual: el candado no es este atributo.
                          title={it.bloqueo ?? undefined}
                          onChange={e =>
                            correr(
                              () => marcarEnPropuesta(it.id, e.target.checked),
                              e.target.checked ? 'Va en la propuesta' : 'Fuera de la propuesta',
                            )
                          }
                          className="h-3.5 w-3.5"
                        />
                      </label>
                      {it.bloqueo && !it.vaEnPropuesta && (
                        <div className="mt-0.5 text-[10px] leading-tight text-red-600">{it.bloqueo}</div>
                      )}
                    </td>

                    <td className="px-3 py-2">
                      <div className="flex items-center justify-end gap-1">
                        {editable && !it.esPrincipal && (
                          <button
                            type="button"
                            disabled={isPending || it.bloqueo !== null}
                            title={
                              it.bloqueo ??
                              'Marcar como principal: su total pasa a ser el valor de la cotización'
                            }
                            onClick={() => correr(() => marcarPrincipal(it.id), 'Principal actualizado')}
                            className="rounded p-1 text-muted-foreground hover:bg-accent disabled:opacity-40"
                          >
                            <Star className="h-3.5 w-3.5" />
                          </button>
                        )}
                        {editable && (
                          <button
                            type="button"
                            disabled={isPending}
                            title="Eliminar itinerario"
                            onClick={() => correr(() => eliminarItinerario(it.id), 'Itinerario eliminado')}
                            className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-red-600 disabled:opacity-40"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {itinerarios.length > 0 && (
        <div className="border-t px-4 py-2 text-[11px] text-muted-foreground">
          El itinerario con <Star className="inline h-3 w-3 fill-amber-400 text-amber-500" /> es el
          {' '}<strong>principal</strong>: su total es el valor de la cotización y el costeo con el
          {' '}que sigue el negocio. Bajo el piso de {formatMargenPct(umbrales.pisoPct)} no se puede
          {' '}marcar para propuesta.
        </div>
      )}
    </div>
  )
}
