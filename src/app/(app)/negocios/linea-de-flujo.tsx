'use client'
import { useEffect, useMemo, useRef } from 'react'
import { Clock, CornerDownRight, CornerRightUp } from 'lucide-react'
import {
  distribuirLinea,
  nivelDeAtraso,
  secuenciaDeLinea,
  type EtapaDelSegmentador,
  type NivelDeAtraso,
} from '@/lib/negocios/linea-de-flujo'
import type { ConteoDeEtapa } from '@/lib/negocios/segmentador'
import { STAGE_LABEL } from '@/lib/negocios/stage-label'

/**
 * Las etapas de la línea como línea de flujo: el recorrido real (tronco + ramas), no el
 * `orden`. La secuencia y la posición de cada etapa las decide `linea-de-flujo.ts`; aquí
 * solo se pintan.
 *
 * - Se ven TODAS las etapas en cualquier fase. Las de la fase puesta van resaltadas y las
 *   demás tenues; con «Todos» se resalta todo.
 * - El color de cada etapa lo deciden sus atrasados (`nivelDeAtraso`), no su volumen.
 * - Celular primero: la línea se desplaza en horizontal dentro de su contenedor, así que no
 *   empuja la lista hacia abajo, y la etapa elegida se trae a la vista.
 */
const CLASE_NIVEL: Record<NivelDeAtraso, string> = {
  sin_sla: 'border-[#E5E7EB] bg-white',
  al_dia: 'border-[#E5E7EB] bg-white',
  algunos: 'border-alerta/40 bg-alerta/5',
  mayoria: 'border-alerta bg-alerta/10',
}

const plural = (n: number, uno: string, varios: string) => `${n} ${n === 1 ? uno : varios}`

export default function LineaDeFlujo({
  etapas,
  conteos,
  fase,
  etapaNum,
  onElegir,
}: {
  etapas: EtapaDelSegmentador[]
  /** Por `numero` de etapa. Ver `contarLineaDeFlujo`. */
  conteos: Map<number, ConteoDeEtapa>
  /** 'todos' o un stage. En 'cerrados' la línea no se pinta (lo decide quien la monta). */
  fase: string
  etapaNum: number | null
  onElegir: (etapa: EtapaDelSegmentador) => void
}) {
  const nodos = useMemo(() => distribuirLinea(secuenciaDeLinea(etapas)), [etapas])

  // La columna anterior de cada fila, para los tramos de línea que cruzan columnas vacías
  // (de Entrega a Facturación, por encima de la rama).
  const tramos = useMemo(
    () =>
      nodos
        .filter((n) => n.columnaAnterior !== null && n.columnaAnterior < n.columna - 1)
        .map((n) => ({ fila: n.fila, desde: n.columnaAnterior! + 1, hasta: n.columna })),
    [nodos],
  )

  const enFase = (e: EtapaDelSegmentador) => fase === 'todos' || e.stage === fase

  // La etapa que hay que dejar a la vista: la elegida o, si no hay, la primera de la fase.
  const objetivo =
    etapaNum ?? (fase === 'todos' ? null : (nodos.find((n) => n.etapa.stage === fase)?.etapa.numero ?? null))

  const contenedor = useRef<HTMLDivElement>(null)
  const botones = useRef(new Map<number, HTMLButtonElement>())

  useEffect(() => {
    const c = contenedor.current
    const el = objetivo === null ? null : botones.current.get(objetivo)
    if (!c || !el) return
    const caja = c.getBoundingClientRect()
    const boton = el.getBoundingClientRect()
    const izquierda = c.scrollLeft + (boton.left - caja.left) - (c.clientWidth - boton.width) / 2
    c.scrollTo({ left: Math.max(0, izquierda), behavior: 'smooth' })
  }, [objetivo])

  if (nodos.length === 0) return null

  return (
    <nav aria-label="Etapas del flujo">
      <div ref={contenedor} className="-mx-1 overflow-x-auto px-1 pb-1.5 [scrollbar-width:thin]">
        <div className="grid w-max items-center gap-y-1.5" style={{ gridAutoColumns: 'max-content' }}>
          {tramos.map((t) => (
            <div
              key={`tramo-${t.fila}-${t.desde}`}
              aria-hidden="true"
              className="flex items-center self-stretch"
              style={{ gridRow: t.fila, gridColumn: `${t.desde} / ${t.hasta}` }}
            >
              <span className="h-px w-full bg-tinta/20" />
            </div>
          ))}

          {nodos.map((n, i) => {
            const e = n.etapa
            const conteo = conteos.get(e.numero) ?? { total: 0, atrasados: 0 }
            const tieneSla = e.sla_horas !== null
            const nivel = nivelDeAtraso(conteo, tieneSla)
            const resaltada = enFase(e)
            const seleccionada = etapaNum === e.numero
            const primeraFuera = n.tipo === 'fuera' && nodos.findIndex((x) => x.tipo === 'fuera') === i

            const titulo = [
              e.nombre,
              plural(conteo.total, 'caso', 'casos'),
              tieneSla ? plural(conteo.atrasados, 'atrasado', 'atrasados') : 'sin SLA',
              n.condicional ? 'solo algunos casos pasan por aquí' : null,
              resaltada ? null : `fase ${STAGE_LABEL[e.stage] ?? e.stage}`,
            ]
              .filter(Boolean)
              .join(' · ')

            return (
              <div
                key={e.numero}
                className="flex items-center"
                style={{ gridRow: n.fila, gridColumn: n.columna }}
                data-fila={n.fila}
              >
                {primeraFuera && (
                  <span className="mr-2 whitespace-nowrap text-[10px] text-tinta-suave">Fuera del flujo</span>
                )}
                {n.columnaAnterior !== null && <span aria-hidden="true" className="h-px w-3 shrink-0 bg-tinta/20" />}
                {n.abreRama && (
                  <CornerDownRight aria-hidden="true" className="mr-0.5 h-3.5 w-3.5 shrink-0 text-tinta-suave/60" />
                )}
                {n.tipo === 'fuera' && !primeraFuera && <span aria-hidden="true" className="w-1.5 shrink-0" />}
                <button
                  ref={(el) => {
                    if (el) botones.current.set(e.numero, el)
                    else botones.current.delete(e.numero)
                  }}
                  type="button"
                  onClick={() => onElegir(e)}
                  aria-pressed={seleccionada}
                  title={titulo}
                  data-etapa={e.numero}
                  data-en-fase={resaltada ? 'si' : 'no'}
                  data-nivel={nivel}
                  className={`shrink-0 rounded-lg border px-2.5 py-1.5 text-left transition ${CLASE_NIVEL[nivel]} ${
                    n.condicional ? 'border-dashed' : ''
                  } ${seleccionada ? 'ring-2 ring-tinta/40 ring-offset-1' : ''} ${
                    resaltada ? '' : 'opacity-40 hover:opacity-80'
                  } hover:border-tinta/40`}
                >
                  <span
                    className={`block max-w-[8.5rem] truncate text-[11px] font-medium leading-tight ${
                      conteo.total === 0 ? 'text-tinta-suave' : 'text-tinta'
                    }`}
                  >
                    {e.nombre}
                  </span>
                  <span className="mt-0.5 flex items-center gap-1.5 text-[10px] leading-none tabular-nums">
                    <span className={`font-bold ${conteo.total === 0 ? 'text-tinta-suave' : 'text-tinta'}`}>
                      {conteo.total}
                    </span>
                    {conteo.atrasados > 0 && (
                      <span className="inline-flex items-center gap-0.5 font-semibold text-alerta">
                        <Clock aria-hidden="true" className="h-2.5 w-2.5" />
                        {conteo.atrasados}
                        <span className="sr-only"> atrasados</span>
                      </span>
                    )}
                  </span>
                </button>
                {n.cierraRama && (
                  <CornerRightUp aria-hidden="true" className="ml-0.5 h-3.5 w-3.5 shrink-0 text-tinta-suave/60" />
                )}
              </div>
            )
          })}
        </div>
      </div>
    </nav>
  )
}
