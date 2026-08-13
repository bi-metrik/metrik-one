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
import type { GuiaEtapa } from '@/lib/negocios/guia-etapa'
import { EtapaGuia } from './etapa-guia'
import { STAGE_LABELS } from './types'
import { SlaConfig } from './workflow-diagram'

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
 * La guía viaja dentro de `config_extra` de la etapa, que el server action ya manda
 * completo. No hace falta un campo propio en `WorkflowEtapa`: el mismo objeto alimenta
 * `label_pregunta`, `routing` y `gates`.
 */
function guiaDeEtapa(e: WorkflowEtapa): GuiaEtapa | null {
  return (e.config_extra as { guia?: GuiaEtapa } | null | undefined)?.guia ?? null
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

/**
 * Decisiones que la ruta elegida NO fija. Se ofrecen como interruptores para armar el
 * caso concreto que se quiere ver.
 *
 * Lo motivó la etapa Inclusión: solo se recorre cuando el vehículo NO está en UPME, que
 * es una variante menor y no justifica una ruta propia. Sin el interruptor, esa etapa no
 * aparecía en ninguna ruta y parecía haberse perdido.
 */
interface DecisionLibre {
  campo: string
  pregunta: string
  /** Valor que activa la rama: es lo que responde "sí" al interruptor. */
  valorRama: string
}

function decisionesLibres(
  etapas: WorkflowEtapa[],
  fijadas: Record<string, string>,
): DecisionLibre[] {
  const vistos = new Set<string>()
  const libres: DecisionLibre[] = []
  for (const e of [...etapas].sort((a, b) => a.orden - b.orden)) {
    for (const regla of e.routing?.conditional ?? []) {
      const campo = regla.condition.field
      if (fijadas[campo] !== undefined || vistos.has(campo)) continue
      vistos.add(campo)
      libres.push({
        campo,
        pregunta:
          (e.config_extra as { label_pregunta?: string } | undefined)?.label_pregunta ?? `¿${campo}?`,
        valorRama: String(regla.condition.value ?? ''),
      })
    }
  }
  return libres
}

export function WorkflowRutas({
  etapas,
  rutas,
  canConfigSla,
  onUpdateSla,
  onGuardarSlaLote,
}: {
  etapas: WorkflowEtapa[]
  rutas: RutaDeclarada[]
  canConfigSla?: boolean
  onUpdateSla?: (etapaId: string, slaHoras: number | null) => Promise<{ ok: boolean; error?: string }>
  onGuardarSlaLote?: (
    cambios: { etapaId: string; slaHoras: number | null }[]
  ) => Promise<{ ok: boolean; guardados: number; error?: string }>
}) {
  const activas = etapas.filter(e => e.is_active !== false)
  const [rutaSel, setRutaSel] = useState(0)
  // Respuestas elegidas a mano para las decisiones que la ruta no fija.
  const [extras, setExtras] = useState<Record<string, string>>({})
  // "Qué quedó en cada etapa" es el uso principal de esta pantalla, así que los bloques
  // se pueden abrir todos de una vez en vez de etapa por etapa.
  const [verBloques, setVerBloques] = useState(false)
  // Definir los tiempos máximos es una tarea de LOTE: se hace de corrido con el equipo,
  // no etapa por etapa. En este modo toda la lista queda editable y se guarda de una.
  const [modoSla, setModoSla] = useState(false)
  const [borradorSla, setBorradorSla] = useState<Record<string, string>>({})
  const [guardandoSla, setGuardandoSla] = useState(false)
  const [errorSla, setErrorSla] = useState<string | null>(null)

  const abrirModoSla = () => {
    // El borrador arranca con lo que ya está configurado: quien edita ve los valores
    // vigentes, no campos vacíos que parecen "sin tiempo".
    const inicial: Record<string, string> = {}
    for (const e of activas) inicial[e.id] = e.sla_horas != null ? String(e.sla_horas) : ''
    setBorradorSla(inicial)
    setErrorSla(null)
    setModoSla(true)
  }

  // Solo viaja lo que de verdad cambió. Un campo vacío significa "sin tiempo máximo"
  // (null), que es distinto de no haberlo tocado.
  const cambiosSla = activas
    .map(e => {
      const crudo = borradorSla[e.id]
      if (crudo === undefined) return null
      const limpio = crudo.trim()
      const nuevo = limpio === '' ? null : Number(limpio)
      if (nuevo !== null && (!Number.isInteger(nuevo) || nuevo < 0 || nuevo > 9999)) return 'invalido'
      const actual = e.sla_horas ?? null
      return nuevo === actual ? null : { etapaId: e.id, slaHoras: nuevo }
    })
    .filter(c => c !== null)

  const hayInvalidos = cambiosSla.some(c => c === 'invalido')
  const cambiosValidos = cambiosSla.filter(
    (c): c is { etapaId: string; slaHoras: number | null } => c !== 'invalido'
  )

  const guardarSla = async () => {
    if (!onGuardarSlaLote || hayInvalidos || cambiosValidos.length === 0) return
    setGuardandoSla(true)
    setErrorSla(null)
    const r = await onGuardarSlaLote(cambiosValidos)
    setGuardandoSla(false)
    if (r.ok) {
      setModoSla(false)
      return
    }
    // Se reporta el parcial: si se guardaron algunos, el modo sigue abierto para
    // que se vea qué quedó pendiente en vez de cerrar como si todo hubiera salido.
    setErrorSla(r.error ?? 'No se pudieron guardar los tiempos')
  }

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
  const fijadas = rutaActual?.respuestas ?? {}
  const libres = decisionesLibres(activas, fijadas)
  const respuestas = { ...fijadas, ...extras }
  const camino = rutaActual
    ? recorrer(activas, respuestas)
    : [...activas].sort((a, b) => num(a) - num(b))

  const maxAbiertos = camino.reduce((m, e) => Math.max(m, e.abiertos ?? 0), 0)
  const totalAbiertos = camino.reduce((s, e) => s + (e.abiertos ?? 0), 0)

  return (
    // Ancho acotado y centrado: a ancho completo el nombre de la etapa y sus cifras
    // quedaban a lado y lado de un desierto de ~1000 px, y por proximidad se leían
    // como datos sin relación. Recomendación de Noor, 2026-08-12.
    <div className="mx-auto w-full max-w-[720px]">
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

      {libres.length > 0 && (
        <div className="mb-4 flex flex-wrap items-center gap-x-4 gap-y-2">
          {libres.map(d => {
            const activo = extras[d.campo] === d.valorRama
            return (
              <label key={d.campo} className="flex cursor-pointer items-center gap-2 text-xs">
                <input
                  type="checkbox"
                  checked={activo}
                  onChange={e =>
                    setExtras(prev => {
                      const next = { ...prev }
                      if (e.target.checked) next[d.campo] = d.valorRama
                      else delete next[d.campo]
                      return next
                    })
                  }
                  className="h-3.5 w-3.5 accent-[#10B981]"
                />
                <span style={{ color: activo ? CARBON : GRIS }}>{d.pregunta}</span>
              </label>
            )
          })}
        </div>
      )}

      <div className="mb-3 flex items-center justify-between gap-3">
        <p className="text-xs" style={{ color: GRIS }}>
          <strong style={{ color: CARBON }}>{camino.length} etapas</strong> · {totalAbiertos} negocios
          abiertos en este recorrido
        </p>
        <div className="flex shrink-0 items-center gap-1">
          {canConfigSla && onGuardarSlaLote && !modoSla && (
            <button
              type="button"
              onClick={abrirModoSla}
              className="rounded-md px-2 py-1 text-[11px] font-semibold transition-colors hover:bg-[#F5F4F2]"
              style={{ color: GRIS }}
            >
              Configurar tiempos
            </button>
          )}
          <button
            type="button"
            onClick={() => setVerBloques(v => !v)}
            className="rounded-md px-2 py-1 text-[11px] font-semibold transition-colors hover:bg-[#F5F4F2]"
            style={{ color: '#10B981' }}
          >
            {verBloques ? 'Ocultar bloques' : 'Ver qué hay en cada etapa'}
          </button>
        </div>
      </div>

      {modoSla && (
        <div
          className="mb-3 flex flex-wrap items-center justify-between gap-2 rounded-lg border px-3 py-2"
          style={{ borderColor: '#10B981', backgroundColor: '#F0FDF4' }}
        >
          <p className="text-[11px]" style={{ color: CARBON }}>
            Escribe el tiempo máximo de cada etapa en <strong>horas hábiles</strong>. Déjalo vacío
            para que la etapa no tenga tiempo máximo.
            {errorSla && (
              <span className="mt-1 block font-semibold" style={{ color: '#B91C1C' }}>
                {errorSla}
              </span>
            )}
            {hayInvalidos && !errorSla && (
              <span className="mt-1 block font-semibold" style={{ color: '#B91C1C' }}>
                Hay valores inválidos: usa números enteros de 0 a 9999.
              </span>
            )}
          </p>
          <div className="flex shrink-0 items-center gap-2">
            <button
              type="button"
              onClick={() => {
                setModoSla(false)
                setErrorSla(null)
              }}
              disabled={guardandoSla}
              className="rounded-md px-2 py-1 text-[11px] font-semibold transition-colors hover:bg-white disabled:opacity-50"
              style={{ color: GRIS }}
            >
              Cancelar
            </button>
            <button
              type="button"
              onClick={guardarSla}
              disabled={guardandoSla || hayInvalidos || cambiosValidos.length === 0}
              className="rounded-md px-3 py-1.5 text-[11px] font-semibold text-white transition-colors disabled:opacity-50"
              style={{ backgroundColor: '#10B981' }}
            >
              {guardandoSla
                ? 'Guardando…'
                : cambiosValidos.length === 0
                  ? 'Sin cambios'
                  : `Guardar ${cambiosValidos.length} cambio${cambiosValidos.length === 1 ? '' : 's'}`}
            </button>
          </div>
        </div>
      )}

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
              <EtapaFila
                etapa={etapa}
                numero={num(etapa)}
                color={color}
                maxAbiertos={maxAbiertos}
                abrirBloques={verBloques}
                canConfigSla={canConfigSla}
                onUpdateSla={onUpdateSla}
                modoSla={modoSla}
                valorSla={borradorSla[etapa.id] ?? ''}
                onChangeSla={v => setBorradorSla(prev => ({ ...prev, [etapa.id]: v }))}
              />
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
 *
 * Las tres métricas van AGRUPADAS a la derecha (no repartidas a lo ancho): sueltas
 * se leían como datos sin relación entre sí. La fila tiene además un modo de
 * configuración de tiempos, que la convierte en un campo editable.
 */
function EtapaFila({
  etapa,
  numero,
  color,
  maxAbiertos,
  abrirBloques,
  canConfigSla,
  onUpdateSla,
  modoSla,
  valorSla,
  onChangeSla,
}: {
  etapa: WorkflowEtapa
  numero: number
  color: string
  maxAbiertos: number
  abrirBloques: boolean
  canConfigSla?: boolean
  onUpdateSla?: (etapaId: string, slaHoras: number | null) => Promise<{ ok: boolean; error?: string }>
  modoSla?: boolean
  valorSla?: string
  onChangeSla?: (valor: string) => void
}) {
  const [abiertoLocal, setAbiertoLocal] = useState(false)
  const abierto = abrirBloques || abiertoLocal
  const abiertos = etapa.abiertos ?? 0
  const vencidos = etapa.vencidos ?? 0
  const pct = maxAbiertos > 0 ? (abiertos / maxAbiertos) * 100 : 0
  const gates = etapa.bloques.filter(b => b.es_gate).length

  // La identidad de la etapa se pinta igual en los dos modos.
  const identidad = (
    <>
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
    </>
  )

  // En modo configuración la fila NO puede ser un <button>: un <input> dentro de un
  // botón es HTML inválido y el contenedor se roba los clics del campo (gotcha ya
  // documentado con <label>). Por eso esta variante es un <div> sin colapsar.
  if (modoSla) {
    return (
      <div
        className="flex items-center gap-3 rounded-xl border bg-white px-3 py-2.5"
        style={{ borderColor: BORDE, borderTop: `3px solid ${color}` }}
      >
        {identidad}
        <label className="flex shrink-0 items-center gap-1.5">
          <span className="sr-only">Tiempo máximo de {etapa.nombre} en horas hábiles</span>
          <Clock className="h-3 w-3" style={{ color: GRIS }} aria-hidden />
          <input
            type="number"
            min={0}
            max={9999}
            step={1}
            inputMode="numeric"
            value={valorSla ?? ''}
            onChange={e => onChangeSla?.(e.target.value)}
            placeholder="—"
            className="w-16 rounded-md border px-2 py-1 text-right text-[12px] tabular-nums focus:outline-none focus:ring-2"
            style={{ borderColor: BORDE, color: CARBON }}
          />
          <span className="text-[11px]" style={{ color: GRIS }}>
            h
          </span>
        </label>
      </div>
    )
  }

  return (
    <div
      className="rounded-xl border bg-white"
      style={{ borderColor: BORDE, borderTop: `3px solid ${color}` }}
    >
      <button
        type="button"
        onClick={() => setAbiertoLocal(v => !v)}
        className="flex w-full items-center gap-3 px-3 py-2.5 text-left"
      >
        {/* 1. Identidad */}
        {identidad}

        {/* 2. Métricas, agrupadas. Antes eran tres columnas sueltas con su propio
            ancho fijo, repartidas a lo ancho de la fila: el ojo las leía como datos
            sin relación entre sí. Juntas y pegadas a la derecha se leen como el
            estado de ESTA etapa (proximidad de Gestalt). */}
        <span className="flex shrink-0 items-center gap-2.5">
          {/* Tiempo máximo */}
          <span
            className="hidden w-12 items-center justify-end gap-1 text-[11px] sm:flex"
            style={{ color: etapa.sla_horas ? GRIS : BORDE }}
            title={etapa.sla_horas ? `Tiempo máximo: ${etapa.sla_horas} horas hábiles` : 'Sin tiempo máximo configurado'}
          >
            <Clock className="h-3 w-3" />
            {etapa.sla_horas ? `${etapa.sla_horas}h` : '—'}
          </span>

          {/* Carga actual */}
          <span
            className="flex w-20 items-center gap-1.5"
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

          {/* Atrasados */}
          <span className="w-10 text-right">
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
        </span>
      </button>

      {abierto && (
        <div className="border-t" style={{ borderColor: BORDE }}>
          {/* Editor de tiempo maximo: mismo componente que el diagrama, para que las dos
              vistas no diverjan en como se configura. */}
          <SlaConfig
            etapaId={etapa.id}
            slaHoras={etapa.sla_horas}
            canEdit={Boolean(canConfigSla)}
            onUpdateSla={onUpdateSla}
          />
          <div className="px-3 py-2">
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
          {/* La ayuda de la etapa va DESPUÉS de los bloques: primero qué hay que llenar,
              después qué significa la etapa y qué la retiene. Es el mismo texto que ve
              quien trabaja el caso dentro del negocio. */}
          <EtapaGuia guia={guiaDeEtapa(etapa)} />
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
