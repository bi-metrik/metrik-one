'use client'

/**
 * <WorkflowRutas> — "¿cómo avanza un caso?"
 *
 * Alternativa al diagrama de rombos. En vez de dibujar un grafo con bifurcaciones y
 * llenarlo de aclaraciones condicionales, se elige ARRIBA el tipo de caso y debajo se
 * ve su recorrido completo, de principio a fin, sin condicionales que resolver.
 *
 * Las rutas se declaran en `lineas_negocio.config_extra.rutas` por sus RESPUESTAS a las
 * decisiones, no por una lista de etapas: el recorrido se simula sobre el routing real,
 * evaluando las condiciones igual que el motor. Cambiar el proceso actualiza las rutas
 * solo, sin tocar config aparte.
 */

import { AlertTriangle, Clock, Eye, GitBranch, ShieldCheck } from 'lucide-react'
import { useState } from 'react'
import type { WorkflowEtapa, WorkflowBloque } from './types'
import { STAGE_LABELS } from './types'

const CARBON = '#1A1A1A'
const GRIS = '#6B7280'
const BORDE = '#E5E7EB'

const STAGE_COLOR: Record<string, string> = {
  venta: '#10B981',
  ejecucion: '#F59E0B',
  cobro: '#3B82F6',
}

const READONLY_TIPOS = new Set([
  'cobros',
  'historial',
  'historial_valida',
  'resumen_financiero',
  'ejecucion',
])

export interface RutaDeclarada {
  nombre: string
  detalle?: string
  respuestas: Record<string, string>
}

function num(e: WorkflowEtapa): number {
  return typeof e.numero === 'number' ? e.numero : e.orden
}

/**
 * Recorre el proceso con un juego de respuestas y devuelve las etapas que atraviesa.
 *
 * Evalúa el routing igual que el motor: primero las condiciones (la primera que coincide
 * gana), si ninguna coincide el camino por defecto, y si no hay routing la siguiente
 * etapa por orden ascendente. Un routing que se apunta a sí mismo cierra el recorrido.
 */
function recorrer(etapas: WorkflowEtapa[], respuestas: Record<string, string>): WorkflowEtapa[] {
  const porOrden = [...etapas].sort((a, b) => a.orden - b.orden)
  if (porOrden.length === 0) return []

  const camino: WorkflowEtapa[] = []
  const visitadas = new Set<number>()
  let actual: WorkflowEtapa | undefined = porOrden[0]

  while (actual && !visitadas.has(actual.orden) && camino.length < 60) {
    visitadas.add(actual.orden)
    camino.push(actual)

    const routing: WorkflowEtapa['routing'] = actual.routing
    let siguienteOrden: number | null = null

    if (routing) {
      if (routing.default_etapa_orden === actual.orden) break // cierra aquí
      for (const regla of routing.conditional ?? []) {
        const dado = respuestas[regla.condition.field]
        if (dado !== undefined && dado === String(regla.condition.value ?? '')) {
          siguienteOrden = regla.etapa_orden
          break
        }
      }
      if (siguienteOrden === null) siguienteOrden = routing.default_etapa_orden
    } else {
      const sig: WorkflowEtapa | undefined = porOrden.find(e => e.orden > actual!.orden)
      siguienteOrden = sig?.orden ?? null
    }

    if (siguienteOrden === null) break
    actual = porOrden.find(e => e.orden === siguienteOrden)
  }

  return camino
}

export function WorkflowRutas({
  etapas,
  rutas,
}: {
  etapas: WorkflowEtapa[]
  rutas: RutaDeclarada[]
}) {
  const activas = etapas.filter(e => e.is_active !== false)
  const [rutaSel, setRutaSel] = useState(0)

  if (activas.length === 0) {
    return (
      <div className="rounded-xl border border-dashed p-8 text-center" style={{ borderColor: BORDE }}>
        <p className="text-sm" style={{ color: GRIS }}>
          Esta línea aún no tiene etapas configuradas.
        </p>
      </div>
    )
  }

  // Sin rutas declaradas: el proceso completo en su orden real.
  const rutaActual = rutas[rutaSel]
  const camino = rutaActual
    ? recorrer(activas, rutaActual.respuestas)
    : [...activas].sort((a, b) => num(a) - num(b))

  const maxAbiertos = camino.reduce((m, e) => Math.max(m, e.abiertos ?? 0), 0)
  const totalAbiertos = camino.reduce((s, e) => s + (e.abiertos ?? 0), 0)

  return (
    <div>
      {rutas.length > 0 && (
        <div className="mb-4">
          <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide" style={{ color: GRIS }}>
            ¿Qué tipo de caso?
          </p>
          <div className="flex flex-wrap gap-2">
            {rutas.map((r, i) => (
              <button
                key={r.nombre}
                type="button"
                onClick={() => setRutaSel(i)}
                className="rounded-lg border px-3 py-2 text-left transition-all"
                style={{
                  borderColor: i === rutaSel ? '#10B981' : BORDE,
                  backgroundColor: i === rutaSel ? '#F0FDF4' : '#FFFFFF',
                }}
              >
                <span
                  className="block text-xs font-bold"
                  style={{ color: i === rutaSel ? '#059669' : CARBON }}
                >
                  {r.nombre}
                </span>
                {r.detalle && (
                  <span className="mt-0.5 block text-[10px]" style={{ color: GRIS }}>
                    {r.detalle}
                  </span>
                )}
              </button>
            ))}
          </div>
        </div>
      )}

      <p className="mb-3 text-xs" style={{ color: GRIS }}>
        <strong style={{ color: CARBON }}>{camino.length} etapas</strong> · {totalAbiertos} negocios
        abiertos en este recorrido
      </p>

      <div className="space-y-2">
        {camino.map((etapa, i) => {
          const color = STAGE_COLOR[etapa.stage] ?? '#10B981'
          const anterior = camino[i - 1]
          const cambiaArea = !anterior || anterior.stage !== etapa.stage
          return (
            <div key={etapa.id}>
              {cambiaArea && (
                <div className="mb-1.5 mt-4 flex items-center gap-2">
                  <span
                    className="inline-block h-2 w-2 rounded-full"
                    style={{ backgroundColor: color }}
                    aria-hidden
                  />
                  <span className="text-[10px] font-bold uppercase tracking-wider" style={{ color }}>
                    {STAGE_LABELS[etapa.stage as keyof typeof STAGE_LABELS] ?? etapa.stage}
                  </span>
                </div>
              )}
              <EtapaFila etapa={etapa} numero={num(etapa)} color={color} maxAbiertos={maxAbiertos} />
            </div>
          )
        })}
      </div>

      <div
        className="mt-4 flex items-center gap-2 rounded-lg border px-3 py-2"
        style={{ borderColor: BORDE }}
      >
        <span className="inline-block h-2 w-2 rounded-full" style={{ backgroundColor: CARBON }} aria-hidden />
        <span className="text-xs font-semibold" style={{ color: CARBON }}>
          Cierre del negocio
        </span>
      </div>
    </div>
  )
}

/**
 * Fila de etapa con posiciones FIJAS: cada dato en su columna, siempre en el mismo
 * sitio. Antes iban en una tira donde el tiempo máximo, la carga y los atrasados
 * aparecían y desaparecían según el caso, y no se sabía qué era cada número.
 */
function EtapaFila({
  etapa,
  numero,
  color,
  maxAbiertos,
}: {
  etapa: WorkflowEtapa
  numero: number
  color: string
  maxAbiertos: number
}) {
  const [abierto, setAbierto] = useState(false)
  const abiertos = etapa.abiertos ?? 0
  const vencidos = etapa.vencidos ?? 0
  const pct = maxAbiertos > 0 ? (abiertos / maxAbiertos) * 100 : 0
  const gates = etapa.bloques.filter(b => b.es_gate).length

  return (
    <div
      className="rounded-xl border bg-white"
      style={{ borderColor: BORDE, borderTop: `3px solid ${color}` }}
    >
      <button
        type="button"
        onClick={() => setAbierto(v => !v)}
        className="flex w-full items-center gap-3 px-3 py-2.5 text-left"
      >
        {/* 1. Identidad */}
        <span
          className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[11px] font-bold tabular-nums"
          style={{ border: `2px solid ${color}`, color: CARBON }}
        >
          {numero}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-bold" style={{ color: CARBON }}>
            {etapa.nombre}
          </span>
          <span className="block text-[10px]" style={{ color: GRIS }}>
            {etapa.bloques.length} bloque{etapa.bloques.length === 1 ? '' : 's'}
            {gates > 0 && ` · ${gates} gate${gates === 1 ? '' : 's'}`}
          </span>
        </span>

        {/* 2. Tiempo máximo */}
        <span
          className="hidden w-16 shrink-0 items-center justify-end gap-1 text-[11px] sm:flex"
          style={{ color: etapa.sla_horas ? GRIS : BORDE }}
          title={etapa.sla_horas ? `Tiempo máximo: ${etapa.sla_horas} horas hábiles` : 'Sin tiempo máximo configurado'}
        >
          <Clock className="h-3 w-3" />
          {etapa.sla_horas ? `${etapa.sla_horas}h` : '—'}
        </span>

        {/* 3. Carga actual */}
        <span
          className="flex w-24 shrink-0 items-center gap-1.5"
          title={`${abiertos} negocio(s) abierto(s) en esta etapa`}
        >
          <span className="h-1.5 flex-1 rounded-full" style={{ backgroundColor: BORDE }}>
            <span
              className="block h-1.5 rounded-full"
              style={{ width: `${pct}%`, backgroundColor: color }}
            />
          </span>
          <span
            className="w-5 text-right text-[11px] font-semibold tabular-nums"
            style={{ color: abiertos > 0 ? CARBON : BORDE }}
          >
            {abiertos}
          </span>
        </span>

        {/* 4. Atrasados */}
        <span className="w-12 shrink-0 text-right">
          {vencidos > 0 ? (
            <span
              className="inline-flex items-center gap-0.5 rounded px-1.5 py-0.5 text-[10px] font-semibold"
              style={{ backgroundColor: '#FEE2E2', color: '#B91C1C' }}
              title={`${vencidos} negocio(s) por encima del tiempo máximo`}
            >
              <AlertTriangle className="h-3 w-3" />
              {vencidos}
            </span>
          ) : (
            <span className="text-[10px]" style={{ color: BORDE }}>
              —
            </span>
          )}
        </span>
      </button>

      {abierto && (
        <div className="border-t px-3 py-2" style={{ borderColor: BORDE }}>
          {etapa.bloques.length === 0 ? (
            <p className="text-[11px] italic" style={{ color: GRIS }}>
              Sin bloques configurados.
            </p>
          ) : (
            <ul className="space-y-1">
              {etapa.bloques.map(b => (
                <BloqueFila key={b.config_id} bloque={b} />
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  )
}

/** Misma información que el diagrama: identificador, gate, solo lectura y condicionalidad. */
function BloqueFila({ bloque }: { bloque: WorkflowBloque }) {
  const isReadOnly =
    bloque.readonly === true || bloque.estado === 'visible' || READONLY_TIPOS.has(bloque.tipo)
  const isCondicional = Boolean(bloque.condition_field)
  return (
    <li className="flex items-center gap-2 text-[12px]" style={{ color: isReadOnly ? GRIS : CARBON }}>
      <span
        className="inline-block w-10 shrink-0 truncate rounded-md px-1 py-[1px] text-center text-[9px] font-mono font-semibold tracking-wider text-white"
        style={{ backgroundColor: CARBON }}
        title={bloque.block_id ? `ID del bloque: ${bloque.block_id}` : undefined}
      >
        {bloque.block_id ?? ''}
      </span>
      <span className="inline-flex h-3 w-3 shrink-0 items-center justify-center">
        {isReadOnly ? (
          <Eye className="h-3 w-3" style={{ color: GRIS }} aria-hidden />
        ) : (
          <span
            className="inline-block h-1.5 w-1.5 rounded-full"
            style={{ backgroundColor: bloque.es_gate ? '#10B981' : GRIS }}
            title={bloque.es_gate ? 'Gate: bloquea el avance' : 'Bloque normal'}
          />
        )}
      </span>
      <span className="flex-1 truncate">{bloque.nombre}</span>
      {isCondicional && (
        <span title={`Aparece si ${bloque.condition_field} = ${bloque.condition_value}`}>
          <GitBranch className="h-3 w-3" style={{ color: GRIS }} />
        </span>
      )}
      {!isReadOnly && bloque.es_gate && (
        <span title="Gate: bloquea el avance">
          <ShieldCheck className="h-3 w-3" style={{ color: '#10B981' }} />
        </span>
      )}
    </li>
  )
}
