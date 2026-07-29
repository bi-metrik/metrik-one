'use client'

/**
 * <WorkflowRutas> — vista de "¿cómo avanza un caso?"
 *
 * Alternativa al diagrama de rombos. Propuesta de Hana + Noor tras cinco correcciones
 * seguidas sobre el diagrama: el problema no eran las etiquetas, era la forma. Un
 * proceso con 4 decisiones, 2 entradas a la misma fase y un tramo que salta 5 etapas
 * no cabe en "columna con rombos y una rama lateral".
 *
 * La idea: el proceso NO se lee como un grafo, se lee como una lista. Todas las etapas
 * en su orden real, agrupadas por área responsable, y los tramos que a veces se omiten
 * marcados con la condición que los omite. Sin rombos, sin ramas, sin combinatoria.
 *
 * Se deriva de la MISMA config que el diagrama (etapas + routing), así que cambiar el
 * proceso actualiza las dos vistas por igual.
 */

import { AlertTriangle, Clock } from 'lucide-react'
import type { WorkflowEtapa } from './types'
import { STAGE_LABELS } from './types'

const VERDE = '#10B981'
const CARBON = '#1A1A1A'
const GRIS = '#6B7280'
const BORDE = '#E5E7EB'
const AMBAR = '#F59E0B'

const STAGE_COLOR: Record<string, string> = {
  venta: '#10B981',
  ejecucion: '#F59E0B',
  cobro: '#3B82F6',
}

/** Etapa con su posición real en el proceso y por qué podría omitirse. */
interface EtapaEnRuta {
  etapa: WorkflowEtapa
  numero: number
  /** Textos del tipo "si no contrató certificación UPME". Vacío = siempre se recorre. */
  omitidaSi: string[]
}

function num(e: WorkflowEtapa): number {
  return typeof e.numero === 'number' ? e.numero : e.orden
}

function etiquetaRespuesta(value: string): string {
  const v = String(value ?? '').trim().toLowerCase()
  if (v === 'true' || v === 'si' || v === 'sí') return 'Sí'
  if (v === 'false' || v === 'no') return 'No'
  return String(value)
}

/**
 * Detecta qué etapas se saltan y bajo qué respuesta.
 *
 * Regla: si una salida de una etapa E apunta a un destino D que está más de una
 * posición adelante, todas las etapas entre medias se omiten cuando se toma esa salida.
 * Es lo que convierte el grafo en anotaciones sobre una lista.
 */
function calcularRuta(etapas: WorkflowEtapa[]): EtapaEnRuta[] {
  const ordenadas = [...etapas].sort((a, b) => num(a) - num(b))
  const omitidaPor = new Map<number, string[]>()
  // Motivos por (etapa saltada, etapa origen). Si un origen salta una etapa por TODAS
  // sus respuestas condicionales, el motivo no es una respuesta concreta: es que el
  // caso no tomó el camino por defecto. Sin esto, Entrega sale con un texto que se
  // contradice ("Sí en ¿requiere cita? · No en ¿requiere cita?"), porque desde Cobro
  // ambas respuestas la saltan.
  const motivosPorOrigen = new Map<string, { total: number; motivos: string[]; defaultLabel: string }>()

  for (const e of ordenadas) {
    if (!e.routing) continue
    const salidas: Array<{ destinoOrden: number; respuesta: string }> = [
      ...(e.routing.conditional ?? []).map(r => ({
        destinoOrden: r.etapa_orden,
        respuesta: etiquetaRespuesta(r.condition.value),
      })),
      {
        destinoOrden: e.routing.default_etapa_orden,
        respuesta:
          (e.routing as { label_default?: string }).label_default ??
          ((e.routing.conditional ?? []).length === 1
            ? etiquetaRespuesta((e.routing.conditional ?? [])[0].condition.value) === 'Sí'
              ? 'No'
              : 'Sí'
            : 'en otro caso'),
      },
    ]

    const pregunta = (e.config_extra as { label_pregunta?: string } | undefined)?.label_pregunta

    const defaultLabel = salidas[salidas.length - 1].respuesta

    for (const [i, s] of salidas.entries()) {
      const destino = ordenadas.find(x => x.orden === s.destinoOrden)
      if (!destino) continue
      const desde = num(e)
      const hasta = num(destino)
      // Solo hacia adelante y saltando algo. Un destino hacia atrás es un reproceso,
      // no una omisión, y meterlo aquí ensuciaría la lectura.
      if (hasta <= desde + 1) continue
      const esDefault = i === salidas.length - 1
      const motivo = pregunta
        ? `${s.respuesta} en "${pregunta}"`
        : `respuesta "${s.respuesta}" en ${e.nombre}`
      for (const saltada of ordenadas) {
        const n = num(saltada)
        if (n > desde && n < hasta) {
          const lista = omitidaPor.get(n) ?? []
          if (!lista.includes(motivo)) lista.push(motivo)
          omitidaPor.set(n, lista)
          if (!esDefault) {
            const k = `${n}::${e.id}`
            const acc = motivosPorOrigen.get(k) ?? { total: 0, motivos: [], defaultLabel }
            acc.total += 1
            acc.motivos.push(motivo)
            motivosPorOrigen.set(k, acc)
          }
        }
      }
    }
  }

  // Colapsar: si un origen salta la etapa por todas sus respuestas condicionales, el
  // motivo real es "no se tomó el camino por defecto", no una respuesta concreta.
  for (const [k, acc] of motivosPorOrigen) {
    const [nStr, origenId] = k.split('::')
    const n = Number(nStr)
    const origen = ordenadas.find(x => x.id === origenId)
    if (!origen || acc.total < (origen.routing?.conditional ?? []).length || acc.total < 2) continue
    const lista = (omitidaPor.get(n) ?? []).filter(m => !acc.motivos.includes(m))
    const texto = acc.defaultLabel.toLowerCase().startsWith('si ')
      ? `no se cumple: ${acc.defaultLabel.replace(/^si\s+/i, '')}`
      : `el caso no sigue por "${acc.defaultLabel}"`
    if (!lista.includes(texto)) lista.push(texto)
    omitidaPor.set(n, lista)
  }

  return ordenadas.map(e => ({
    etapa: e,
    numero: num(e),
    omitidaSi: omitidaPor.get(num(e)) ?? [],
  }))
}

/** Tramos contiguos que comparten el mismo motivo de omisión (o ninguno). */
interface Tramo {
  stage: string
  motivo: string | null
  etapas: EtapaEnRuta[]
}

function agruparEnTramos(ruta: EtapaEnRuta[]): Tramo[] {
  const tramos: Tramo[] = []
  for (const item of ruta) {
    const motivo = item.omitidaSi.length > 0 ? item.omitidaSi.join(' · ') : null
    const ultimo = tramos[tramos.length - 1]
    if (ultimo && ultimo.stage === item.etapa.stage && ultimo.motivo === motivo) {
      ultimo.etapas.push(item)
    } else {
      tramos.push({ stage: item.etapa.stage, motivo, etapas: [item] })
    }
  }
  return tramos
}

export function WorkflowRutas({ etapas }: { etapas: WorkflowEtapa[] }) {
  const ruta = calcularRuta(etapas.filter(e => e.is_active !== false))
  const tramos = agruparEnTramos(ruta)

  if (ruta.length === 0) {
    return (
      <div className="rounded-xl border border-dashed p-8 text-center" style={{ borderColor: BORDE }}>
        <p className="text-sm" style={{ color: GRIS }}>Esta línea aún no tiene etapas configuradas.</p>
      </div>
    )
  }

  const maxAbiertos = ruta.reduce((m, r) => Math.max(m, r.etapa.abiertos ?? 0), 0)

  return (
    <div className="space-y-1">
      <p className="mb-4 text-xs" style={{ color: GRIS }}>
        El proceso completo, en orden. Los tramos con borde punteado solo se recorren en
        algunos casos: al lado dice cuándo se omiten.
      </p>

      {tramos.map((tramo, ti) => {
        const color = STAGE_COLOR[tramo.stage] ?? VERDE
        const anterior = tramos[ti - 1]
        const cambiaArea = !anterior || anterior.stage !== tramo.stage

        return (
          <div key={`${tramo.stage}-${ti}`}>
            {cambiaArea && (
              <div className="mb-1.5 mt-4 flex items-center gap-2">
                <span
                  className="inline-block h-2 w-2 rounded-full"
                  style={{ backgroundColor: color }}
                  aria-hidden
                />
                <span
                  className="text-[10px] font-bold uppercase tracking-wider"
                  style={{ color }}
                >
                  {STAGE_LABELS[tramo.stage as keyof typeof STAGE_LABELS] ?? tramo.stage}
                </span>
              </div>
            )}

            <div
              className={tramo.motivo ? 'rounded-lg py-1.5 pl-3' : ''}
              style={
                tramo.motivo
                  ? { borderLeft: `2px dashed ${AMBAR}`, backgroundColor: '#FFFBEB' }
                  : undefined
              }
            >
              {tramo.motivo && (
                <p className="mb-1 flex items-start gap-1 pr-2 text-[11px]" style={{ color: '#92400E' }}>
                  <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />
                  <span>Se omite si: {tramo.motivo}</span>
                </p>
              )}

              {tramo.etapas.map(({ etapa, numero }) => {
                const abiertos = etapa.abiertos ?? 0
                const vencidos = etapa.vencidos ?? 0
                const pct = maxAbiertos > 0 ? (abiertos / maxAbiertos) * 100 : 0
                return (
                  <div
                    key={etapa.id}
                    className="flex items-center gap-3 rounded-lg px-2 py-1.5 hover:bg-[#F9FAFB]"
                  >
                    <span
                      className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[11px] font-bold tabular-nums"
                      style={{ border: `2px solid ${color}`, color: CARBON }}
                    >
                      {numero}
                    </span>
                    <span className="min-w-0 flex-1 truncate text-sm font-medium" style={{ color: CARBON }}>
                      {etapa.nombre}
                    </span>

                    {etapa.sla_horas ? (
                      <span
                        className="hidden shrink-0 items-center gap-1 text-[10px] sm:flex"
                        style={{ color: GRIS }}
                      >
                        <Clock className="h-3 w-3" />
                        {etapa.sla_horas}h
                      </span>
                    ) : null}

                    {/* Volumen: convierte el mapa del proceso en una foto de dónde está el trabajo. */}
                    <div className="flex w-24 shrink-0 items-center gap-1.5">
                      <div className="h-1 flex-1 rounded-full" style={{ backgroundColor: BORDE }}>
                        <div
                          className="h-1 rounded-full"
                          style={{ width: `${pct}%`, backgroundColor: color }}
                        />
                      </div>
                      <span
                        className="w-6 text-right text-[11px] tabular-nums"
                        style={{ color: abiertos > 0 ? CARBON : BORDE }}
                      >
                        {abiertos}
                      </span>
                    </div>

                    {vencidos > 0 && (
                      <span
                        className="shrink-0 rounded px-1.5 py-0.5 text-[10px] font-semibold"
                        style={{ backgroundColor: '#FEF2F2', color: '#DC2626' }}
                      >
                        {vencidos} vencidos
                      </span>
                    )}
                  </div>
                )
              })}
            </div>
          </div>
        )
      })}

      <div className="mt-6 flex items-center gap-2 rounded-lg border px-3 py-2" style={{ borderColor: BORDE }}>
        <span
          className="inline-block h-2 w-2 rounded-full"
          style={{ backgroundColor: CARBON }}
          aria-hidden
        />
        <span className="text-xs font-semibold" style={{ color: CARBON }}>
          Cierre del negocio
        </span>
      </div>
    </div>
  )
}
