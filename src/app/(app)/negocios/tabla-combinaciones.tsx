'use client'

import { Fragment, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Loader2, Sparkles, Star, Trash2 } from 'lucide-react'
import { toast } from 'sonner'

import {
  armarTarifas,
  cambiarOpcionDeItinerario,
  eliminarItinerario,
  guardarMotivoDeTarifa,
  marcarEnPropuesta,
  marcarPrincipal,
  renombrarItinerario,
  renombrarRanura,
  type EstadoItinerarios,
} from '@/app/(app)/negocios/itinerario-actions'
import { nombreDeItinerario } from '@/lib/cotizaciones/itinerarios'
import { etiquetaDeMotivo, MOTIVOS_COMBINACION } from '@/lib/cotizaciones/motivo-combinacion'
import { esTarifaConNombre, NOMBRES_TARIFA, tarifasQueFaltan } from '@/lib/cotizaciones/tarifas'
import { nivelDeMargen } from '@/lib/cotizaciones/convencion-margen'
import { claseNivelMargen, formatMargenPct } from '@/lib/cotizaciones/margen-vista'
import { formatCOP } from '@/lib/contacts/constants'

/**
 * La tabla de combinaciones: dónde se ARMAN las tres tarifas que ve el cliente.
 *
 * Filas = tarifas (Económica, Recomendada, Premium). Columnas = ranuras. Celdas =
 * desplegable con las variantes de esa ranura. Al final de cada fila: costo, precio,
 * margen y el interruptor «va en propuesta».
 *
 * ## Deja de enumerar el producto completo (2026-09-21)
 *
 * Antes el botón generaba **todas** las combinaciones posibles. Con el viaje a
 * Providencia —dos vuelos y un hotel, dos opciones cada uno— eran ocho filas, y lo que se
 * le manda al cliente son tres. Ahora el botón crea exactamente las tres, vacías, y se
 * arman eligiendo una variante por ranura. El motor que propondrá esa elección inicial no
 * entra todavía: el hueco está en `armarTarifas`.
 *
 * ## Varias ranuras del mismo tipo SUMAN
 *
 * «Vuelo» y «Vuelo 2» son dos columnas y una tarifa lleva una variante de cada una: los
 * dos tramos van en lo que recibe el cliente. Las variantes DENTRO de una columna siguen
 * compitiendo. El encabezado de cada columna es editable y renombra la ranura entera.
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
  explicarVacio = false,
}: {
  cotizacionId: string
  estado: EstadoItinerarios
  editable: boolean
  /**
   * ¿Se dice POR QUÉ no hay tabla, en vez de no pintar nada?
   *
   * Sin alternativas cargadas no hay nada que combinar y la sección desaparecía entera:
   * quien espera ver combinaciones no tiene forma de saber si faltan datos, si el módulo
   * no está, o si la pantalla está rota. Medido el 2026-09-17 en la cotización de prueba
   * de Trappvel: COT-2026-0002 tiene un vuelo y un hotel, **uno de cada**, así que no hay
   * ranura que cruzar — y la pantalla no lo decía en ninguna parte.
   *
   * Opt-in, y por eso ausente vale `false`: en una cotización que no es de viaje
   * (Termotech, WMC, Arca) la frase no significa nada y R6 sigue mandando — esa
   * cotización no gana una sección al abrirla.
   */
  explicarVacio?: boolean
}) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [nombres, setNombres] = useState<Record<string, string>>({})
  const [nombresRanura, setNombresRanura] = useState<Record<string, string>>({})
  const [motivos, setMotivos] = useState<Record<string, string>>({})

  const {
    ranuras,
    fijosConAlternativas,
    itinerarios,
    umbrales,
    tablasAusentes,
    motivoDisponible,
  } = estado
  // Cuáles de las tres faltan, con el MISMO helper que usa la acción: escrito dos veces,
  // el botón diría que no hay nada que crear y el servidor crearía, o al revés.
  const faltanTarifas = tarifasQueFaltan(itinerarios.map(i => i.nombre))

  // R6 · sin opciones y sin itinerarios no hay nada que decidir: la sección no se
  // pinta. Una cotización que ya existía no gana una sección al abrirla.
  const vacia = ranuras.length === 0 && itinerarios.length === 0
  if (vacia && !explicarVacio) return null

  // Lo que falta, dicho donde iría la tabla. No es un error ni un aviso: es la
  // instrucción de una línea que convierte «aquí no hay nada» en «esto es lo que hay
  // que hacer». La acción vive en cada línea («Agregar otra opción de vuelo»), así
  // que aquí no se repite un botón que no podría saber sobre cuál línea actuar.
  // ⚠️ El nombre del botón se cita TAL CUAL: si el botón se renombra y esta frase no,
  // la pantalla manda a buscar algo que ya no existe.
  if (vacia) {
    return (
      <div className="rounded-lg border border-dashed px-4 py-5 text-center">
        <h3 className="text-sm font-semibold">Las tres tarifas</h3>
        <p className="mt-1 text-[11px] text-muted-foreground">
          Todavía no hay entre qué elegir: cada componente tiene una sola opción, así que
          {' '}Económica, Recomendada y Premium saldrían idénticas.
        </p>
        <p className="mt-1 text-[11px] text-muted-foreground">
          Agrega otra opción a una línea de <strong>vuelo</strong> o de <strong>hotel</strong>
          {' '}(botón «Agregar otra opción de vuelo», dentro de la línea) y aquí aparece la
          {' '}tabla para armar las tres, con el costo y el margen de cada una.
        </p>
        {/* La confusión que costó el tramo perdido de Providencia, dicha antes de que
            alguien use el botón equivocado: un SEGUNDO TRAMO no es una opción. */}
        <p className="mt-1 text-[11px] text-muted-foreground">
          Si lo que falta es <strong>otro tramo</strong> del viaje (el segundo vuelo), no es una
          {' '}opción: es otra ranura. Se agrega con «+ Vuelo» y suma aparte.
        </p>
        {/* La otra vía, y es la que destrabó el caso real: dos líneas sueltas que compiten
            por lo mismo no se cruzan hasta que comparten grupo. En la cotización de prueba
            había dos hoteles y uno estaba sin grupo, así que no eran alternativas de nada. */}
        <p className="mt-1 text-[11px] text-muted-foreground">
          Si ya tienes dos líneas que compiten, basta con darles el <strong>mismo grupo</strong>
          {' '}en «Grupo de la línea».
        </p>
      </div>
    )
  }

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

  /**
   * El motivo de §3.3, guardado donde se elige.
   *
   * No usa `correr` porque tiene que LIMPIAR el borrador local al terminar: la casilla
   * vuelve a pintar lo que quedó guardado. Si se dejara lo tecleado, un texto que el
   * servidor recorta a nulo (solo espacios) seguiría en pantalla y la base diría otra
   * cosa — la pantalla sana que miente que este repo ya pagó con el nombre de la línea.
   *
   * Sin toast de éxito a propósito: el motivo se escribe mientras se compara, y un
   * aviso por cada tecleo de campo es ruido sobre una acción que no decide nada.
   */
  function guardarMotivo(id: string, codigo: string | null, texto: string | null) {
    startTransition(async () => {
      const r = await guardarMotivoDeTarifa(id, codigo, texto)
      if (!r.success) {
        toast.error(r.error ?? 'No se pudo guardar el motivo')
        return
      }
      setMotivos(m => {
        const siguiente = { ...m }
        delete siguiente[id]
        return siguiente
      })
      router.refresh()
    })
  }

  return (
    <div className="rounded-lg border">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b px-4 py-3">
        <div>
          <h3 className="text-sm font-semibold">Las tres tarifas</h3>
          <p className="text-[11px] text-muted-foreground">
            {NOMBRES_TARIFA.join(', ')}. Cada una es <strong>una opción por ranura</strong> y su
            {' '}precio es la suma de todas. Solo las marcadas «va en propuesta» salen en el PDF.
          </p>
          {/* Lo que más cuesta entender del modelo, dicho donde se usa: las COLUMNAS
              suman entre sí y las OPCIONES de una columna compiten. Sin esta línea,
              «¿por qué el segundo vuelo no aparece en el total?» no tiene respuesta en
              pantalla — y era el defecto que abrió este frente. */}
          <p className="mt-0.5 text-[11px] text-muted-foreground">
            Cada columna es una ranura y <strong>todas suman</strong>: dos vuelos van los dos en
            {' '}el viaje. Dentro de una columna las opciones <strong>compiten</strong> y solo una
            {' '}entra. Tours, traslados y planes no abren columna: suman igual en las tres.
          </p>
        </div>
        {editable && ranuras.length > 0 && !tablasAusentes && faltanTarifas.length > 0 && (
          <button
            type="button"
            disabled={isPending}
            onClick={() =>
              startTransition(async () => {
                const r = await armarTarifas(cotizacionId)
                if (!r.success) {
                  toast.error(r.error ?? 'No se pudieron armar')
                  return
                }
                // Se dice cuántas se crearon Y cuántas ya estaban: volver a pulsarlo tras
                // agregar un hotel conserva lo revisado, y sin el conteo eso se lee como
                // que el botón no hizo nada.
                const partes = [`${r.creadas} tarifa${r.creadas === 1 ? '' : 's'} nueva${r.creadas === 1 ? '' : 's'}`]
                if (r.yaExistian) partes.push(`${r.yaExistian} ya estaban`)
                toast.success(`${partes.join(', ')}. Elige una opción por ranura en cada una.`)
                router.refresh()
              })
            }
            className="flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50"
          >
            {isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
            {faltanTarifas.length === 3 ? 'Armar las tres tarifas' : `Crear ${faltanTarifas.join(' y ')}`}
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

      {/* ⚠️ Desde R-A1 el total NO suma las dos aerolíneas: cada ranura aporta una vez y
          la que aporta se toma por supuesto (el primero por orden). Lo que falta
          mientras no haya principal es la DECISIÓN, no la suma — y el aviso que nombra
          cuál se tomó vive en el editor, arriba de la cascada, que es donde está el
          número que explica. Aquí solo se invita a armarlas. */}
      {!tablasAusentes && itinerarios.length === 0 && ranuras.length > 0 && (
        <div className="px-4 py-5 text-center text-xs">
          <p className="text-muted-foreground">
            Hay {ranuras.length === 1 ? 'una ranura' : `${ranuras.length} ranuras`} con opciones
            {' '}({ranuras.map(r => r.etiqueta).join(', ')}).
            {ranuras.length > 1 && ' Todas suman: una tarifa lleva una opción de cada una.'}
          </p>
          <p className="mt-1 font-medium text-amber-700 dark:text-amber-400">
            Todavía nadie eligió: el total toma una opción por supuesto en cada ranura.
          </p>
          <p className="mt-1 text-muted-foreground">Arma las tres tarifas para ver el margen de cada una.</p>
        </div>
      )}

      {/* Lo que NO se cruza, dicho con nombre propio. Un traslado con dos alternativas
          aporta una sola; callar cuál deja un total que nadie puede reconciliar. */}
      {!tablasAusentes && fijosConAlternativas.length > 0 && (
        <div className="border-b bg-muted/30 px-4 py-2 text-[11px] text-muted-foreground">
          {fijosConAlternativas.map(f => (
            <p key={f.grupo}>
              <span className="font-medium capitalize">{f.grupo}</span> no se cruza: suma
              {' '}<span className="font-medium">«{f.aporta ?? 'Sin nombre'}»</span> en todos los
              {' '}tarifas{f.fuera.length > 0 && <> y deja fuera del total a {f.fuera.map(n => `«${n}»`).join(', ')}</>}.
            </p>
          ))}
        </div>
      )}

      {itinerarios.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b bg-muted/40 text-left">
                <th className="px-3 py-2 font-medium">Tarifa</th>
                {ranuras.map(r => (
                  <th key={r.grupo} className="px-3 py-2 font-medium align-bottom">
                    {/* EL NOMBRE DE LA RANURA, editable donde se ve. Con dos vuelos,
                        «Vuelo» y «Vuelo 2» no dicen cuál es cuál: el nombre («Bogotá a
                        San Andrés») es lo único que los distingue en pantalla y en el
                        documento.
                        ⚠️ Solo se edita la parte LIBRE. El tipo y el ordinal («Vuelo 2»)
                        los decide el catálogo: dejarlos escribir fundiría dos ranuras.
                        ⚠️ Renombra la ranura ENTERA, no la línea: cambiar el grupo de una
                        sola variante la partiría en dos y el total se duplicaría. */}
                    <div className="whitespace-nowrap">{r.prefijo}</div>
                    {editable && r.renombrable ? (
                      <input
                        value={nombresRanura[r.grupo] ?? r.nombre}
                        placeholder="ponle nombre…"
                        aria-label={`Nombre de la ranura ${r.prefijo}`}
                        title={`Renombra «${r.prefijo}» completa: sus ${r.candidatos.length} opciones`}
                        onChange={e => setNombresRanura(n => ({ ...n, [r.grupo]: e.target.value }))}
                        onBlur={e => {
                          if (e.target.value.trim() === r.nombre) return
                          correr(
                            () => renombrarRanura(cotizacionId, r.grupo, e.target.value),
                            'Ranura renombrada',
                          )
                        }}
                        className="mt-0.5 w-32 rounded border-0 bg-transparent px-1 py-0.5 text-[11px] font-normal text-muted-foreground focus:bg-background focus:ring-1"
                      />
                    ) : (
                      r.nombre !== '' && (
                        <div className="text-[11px] font-normal text-muted-foreground">{r.nombre}</div>
                      )
                    )}
                  </th>
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
                const fondoBajoPiso = nivel === 'bajo_piso' ? 'bg-red-50/60 dark:bg-red-950/10' : ''
                return (
                  <Fragment key={it.id}>
                  <tr
                    // T4 · la fila bajo el piso se marca, igual que la línea del paso 1.
                    // El borde baja a la sub-fila del motivo cuando existe: una línea
                    // entre la tarifa y su propio motivo los leería como dos cosas.
                    className={`${motivoDisponible ? '' : 'border-b last:border-0'} ${fondoBajoPiso}`}
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
                      {/* Una fila que NO es una de las tres. Pasa en las cotizaciones que
                          venían del enumerado cartesiano —no se borran, que sería perder
                          en silencio lo que alguien revisó— y en las que alguien crea a
                          mano. Se marca para que no se confunda con lo que va al cliente. */}
                      {!esTarifaConNombre(it.nombre) && (
                        <div className="text-[10px] leading-tight text-muted-foreground">
                          No es una de las tres tarifas
                        </div>
                      )}
                      {/* UNA TARIFA INCOMPLETA SE VE INCOMPLETA Y DICE QUÉ LE FALTA.
                          Se nombra la ranura como se llama en su columna, no el grupo
                          crudo: «vuelo 2: san andrés a providencia» manda a buscar algo
                          que en la tabla no se llama así. El candado de que no se imprima
                          a medias vive en el servidor (`motivoDeRechazo`), no aquí. */}
                      {it.ranurasFaltantes.length > 0 && (
                        <div className="mt-0.5 text-[10px] font-medium leading-tight text-red-600">
                          Incompleta: falta elegir{' '}
                          {it.ranurasFaltantes
                            .map(g => ranuras.find(r => r.grupo === g)?.etiqueta ?? g)
                            .join(', ')}
                        </div>
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
                      {/* Donde el piso se exige en la salida, bajo el mínimo SÍ se puede
                          marcar: el candado está en el PDF, «Enviar» y «Aprobar», y el dueño
                          puede autorizarla. Aquí solo se avisa. */}
                      {!it.bloqueo && it.bajoPiso && (
                        <div className="mt-0.5 text-[10px] leading-tight text-red-600">{it.bajoPiso}</div>
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
                            title="Eliminar esta tarifa"
                            onClick={() => correr(() => eliminarItinerario(it.id), 'Tarifa eliminada')}
                            className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-red-600 disabled:opacity-40"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>

                  {/* §3.3 · POR QUÉ esta combinación y no otra.
                      Va aquí, pegado a la tarifa, porque R5 lo pide donde se elige y
                      no en un modal al emitir: «un campo obligatorio en el instante de
                      más afán produce veinte motivos basura, que es peor que veinte
                      vacíos». No bloquea nada, no valida nada y se puede dejar en
                      blanco — ninguna acción de esta tabla depende de él.
                      Solo aparece cuando la base ya tiene las columnas: ofrecerlo antes
                      de aplicar el SQL sería un control que siempre falla. */}
                  {motivoDisponible && (
                    <tr className={`border-b last:border-0 ${fondoBajoPiso}`}>
                      <td colSpan={ranuras.length + 6} className="px-3 pb-2 pt-0">
                        <div className="flex flex-wrap items-center gap-2">
                          {/* El rótulo dice de qué es el motivo. «Por qué esta» a secas
                              se lee truncado: se vio en la captura, no en una prueba. */}
                          <span className="shrink-0 text-[10px] uppercase tracking-wide text-muted-foreground">
                            Por qué esta combinación
                          </span>
                          {editable ? (
                            <>
                              <select
                                value={it.motivoCodigo ?? ''}
                                disabled={isPending}
                                aria-label={`Motivo de ${nombreDeItinerario(it.nombre, i + 1)}`}
                                onChange={e =>
                                  guardarMotivo(
                                    it.id,
                                    e.target.value === '' ? null : e.target.value,
                                    // El texto que haya, tecleado o guardado: elegir de la
                                    // lista no puede borrar lo que alguien escribió.
                                    motivos[it.id] ?? it.motivoTexto ?? null,
                                  )
                                }
                                className="rounded border bg-background px-1.5 py-0.5 text-[11px] disabled:opacity-60"
                              >
                                {/* «Sin motivo» y no «no especificado»: es la ausencia de
                                    respuesta, y se guarda como NULL. */}
                                <option value="">Sin motivo</option>
                                {MOTIVOS_COMBINACION.map(m => (
                                  <option key={m.codigo} value={m.codigo}>{m.etiqueta}</option>
                                ))}
                              </select>
                              <input
                                value={motivos[it.id] ?? it.motivoTexto ?? ''}
                                placeholder="…y en tus palabras (opcional)"
                                disabled={isPending}
                                aria-label={`Motivo en palabras de ${nombreDeItinerario(it.nombre, i + 1)}`}
                                onChange={e => setMotivos(m => ({ ...m, [it.id]: e.target.value }))}
                                onBlur={e => {
                                  if ((e.target.value.trim() || null) === (it.motivoTexto ?? null)) return
                                  guardarMotivo(it.id, it.motivoCodigo, e.target.value)
                                }}
                                className="min-w-[14rem] flex-1 rounded border bg-background px-1.5 py-0.5 text-[11px] disabled:opacity-60"
                              />
                            </>
                          ) : (
                            <span className="text-[11px] text-muted-foreground">
                              {[etiquetaDeMotivo(it.motivoCodigo), it.motivoTexto]
                                .filter(Boolean)
                                .join(' · ') || 'Sin motivo'}
                            </span>
                          )}
                        </div>
                      </td>
                    </tr>
                  )}
                  </Fragment>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Mismo aviso cuando hay combinaciones pero ninguna es principal: el precio de
          la cotización sale de un supuesto y no de una decisión, y la causa está a un
          clic de distancia. */}
      {itinerarios.length > 0 && !itinerarios.some(i => i.esPrincipal) && (
        <div className="border-t bg-amber-50 px-4 py-2 text-[11px] font-medium text-amber-800 dark:bg-amber-950/20 dark:text-amber-300">
          Ninguna tarifa está marcada como principal: el valor de la cotización sale de
          una opción tomada por supuesto, no de esta tabla. Marca una con la estrella.
        </div>
      )}

      {itinerarios.length > 0 && (
        <div className="border-t px-4 py-2 text-[11px] text-muted-foreground">
          La tarifa con <Star className="inline h-3 w-3 fill-amber-400 text-amber-500" /> es la
          {' '}<strong>principal</strong>: su total es el valor de la cotización y el costeo con el
          {' '}que sigue el negocio. Bajo el margen mínimo de {formatMargenPct(umbrales.pisoPct)} no se puede
          {' '}marcar para propuesta, y una tarifa incompleta tampoco.
        </div>
      )}
    </div>
  )
}
