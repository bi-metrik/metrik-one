'use client'

import { useState } from 'react'
import type { EtapaRow, Bloque, InputOutput, Gate } from './actions'

interface Props {
  etapas: EtapaRow[]
}

const FASE_ORDER = ['venta', 'ejecucion', 'cobro']
const FASE_LABELS: Record<string, string> = {
  venta:    'Venta',
  ejecucion: 'Ejecución',
  cobro:    'Cobro',
}
const FASE_COLORS: Record<string, string> = {
  venta:    'bg-blue-50 border-blue-200 text-blue-800',
  ejecucion:'bg-violet-50 border-violet-200 text-violet-800',
  cobro:    'bg-amber-50 border-amber-200 text-amber-800',
}

const SKILL_ESTADO_STYLES: Record<string, string> = {
  listo:            'bg-emerald-100 text-emerald-700',
  en_construccion:  'bg-amber-100 text-amber-700',
  pendiente:        'bg-gray-100 text-gray-500',
}

const TIPO_BLOQUE_DOT: Record<string, string> = {
  lectura:      'bg-blue-400',
  recopilacion: 'bg-purple-400',
  analisis:     'bg-orange-400',
  generacion:   'bg-teal-400',
  calculo:      'bg-cyan-400',
  evaluacion:   'bg-yellow-400',
  aprobacion:   'bg-rose-400',
  efecto:       'bg-emerald-400',
  validacion:   'bg-red-400',
  decision:     'bg-indigo-400',
  sesion:       'bg-pink-400',
  seguimiento:  'bg-slate-400',
}

export default function ProcesoClient({ etapas }: Props) {
  const [selected, setSelected] = useState<EtapaRow | null>(null)

  const fases = FASE_ORDER.filter(f => etapas.some(e => e.fase === f))
  const byFase = Object.fromEntries(
    fases.map(f => [f, etapas.filter(e => e.fase === f)])
  )
  const totalListo = etapas.filter(e => e.skill_estado === 'listo').length
  const totalConstruccion = etapas.filter(e => e.skill_estado === 'en_construccion').length

  return (
    <div className="flex h-[calc(100vh-88px)] gap-4 overflow-hidden">

      {/* ── Panel izquierdo: timeline ─────────────────────────────── */}
      <div className="flex w-[340px] shrink-0 flex-col overflow-y-auto">
        <div className="mb-4 flex gap-3">
          <span className="rounded-md border border-gray-200 bg-white px-2.5 py-1 text-xs text-gray-500">
            {etapas.length} etapas
          </span>
          <span className="rounded-md border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-xs text-emerald-700">
            {totalListo} listas
          </span>
          {totalConstruccion > 0 && (
            <span className="rounded-md border border-amber-200 bg-amber-50 px-2.5 py-1 text-xs text-amber-700">
              {totalConstruccion} en construcción
            </span>
          )}
        </div>

        <div className="space-y-5">
          {fases.map(fase => (
            <div key={fase}>
              {/* Fase header */}
              <div className={`mb-2 rounded-md border px-3 py-1.5 text-[11px] font-bold uppercase tracking-wider ${FASE_COLORS[fase]}`}>
                {FASE_LABELS[fase]}
              </div>

              {/* Etapas */}
              <div className="relative space-y-1 pl-4">
                {/* Línea vertical */}
                <div className="absolute left-1.5 top-2 bottom-2 w-px bg-gray-200" />

                {byFase[fase].map((etapa) => {
                  const isActive = selected?.id === etapa.id
                  return (
                    <button
                      key={etapa.id}
                      onClick={() => setSelected(isActive ? null : etapa)}
                      className={`relative w-full rounded-lg border px-3 py-2.5 text-left transition-all ${
                        isActive
                          ? 'border-[#10B981] bg-emerald-50 shadow-sm'
                          : 'border-gray-200 bg-white hover:border-gray-300 hover:shadow-sm'
                      }`}
                    >
                      {/* Dot en la línea */}
                      <div className={`absolute -left-[11px] top-1/2 -translate-y-1/2 h-2.5 w-2.5 rounded-full border-2 border-white ${
                        etapa.skill_estado === 'listo' ? 'bg-emerald-500' :
                        etapa.skill_estado === 'en_construccion' ? 'bg-amber-400' :
                        'bg-gray-300'
                      }`} />

                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="text-[11px] font-medium text-gray-400">
                              {etapa.orden}.
                            </span>
                            <span className="text-[13px] font-semibold text-[#1A1A1A]">
                              {etapa.nombre}
                            </span>
                          </div>
                          {etapa.skill_name && (
                            <span className="mt-0.5 inline-block rounded bg-gray-100 px-1.5 py-0.5 font-mono text-[10px] text-gray-500">
                              /{etapa.skill_name}
                            </span>
                          )}
                          {etapa.paralelo_con && etapa.paralelo_con.length > 0 && (
                            <span className="ml-1 mt-0.5 inline-block text-[9px] text-gray-400">
                              ∥ /{etapa.paralelo_con.join(', /')}
                            </span>
                          )}
                        </div>
                        <span className={`shrink-0 rounded-full px-2 py-0.5 text-[9px] font-semibold uppercase tracking-wider ${SKILL_ESTADO_STYLES[etapa.skill_estado]}`}>
                          {etapa.skill_estado === 'en_construccion' ? 'en curso' : etapa.skill_estado}
                        </span>
                      </div>
                    </button>
                  )
                })}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* ── Panel derecho: detalle ────────────────────────────────── */}
      <div className="flex-1 overflow-y-auto">
        {!selected ? (
          <div className="flex h-full items-center justify-center text-sm text-gray-400">
            Selecciona una etapa para ver los detalles
          </div>
        ) : (
          <DetailPanel etapa={selected} />
        )}
      </div>
    </div>
  )
}

function DetailPanel({ etapa }: { etapa: EtapaRow }) {
  return (
    <div className="rounded-xl border border-gray-200 bg-white p-5">
      {/* Header */}
      <div className="mb-4 flex items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <h2 className="text-lg font-bold text-[#1A1A1A]">{etapa.nombre}</h2>
            <span className={`rounded-full px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider ${SKILL_ESTADO_STYLES[etapa.skill_estado]}`}>
              {etapa.skill_estado === 'en_construccion' ? 'en construcción' : etapa.skill_estado}
            </span>
          </div>
          <div className="mt-1 flex items-center gap-3 text-xs text-gray-400">
            <span className="capitalize">{etapa.fase}</span>
            <span>·</span>
            <span>Etapa {etapa.orden}</span>
            {etapa.skill_name && (
              <>
                <span>·</span>
                <code className="rounded bg-gray-100 px-1.5 py-0.5 font-mono text-[11px] text-gray-600">
                  /{etapa.skill_name}
                </code>
              </>
            )}
          </div>
        </div>
      </div>

      {etapa.descripcion && (
        <p className="mb-5 text-sm text-gray-600">{etapa.descripcion}</p>
      )}

      {/* Paralelo con */}
      {etapa.paralelo_con && etapa.paralelo_con.length > 0 && (
        <div className="mb-4 rounded-md border border-blue-100 bg-blue-50 px-3 py-2 text-xs text-blue-700">
          Corre en paralelo con: <strong>{etapa.paralelo_con.map(s => `/${s}`).join(', ')}</strong>
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {/* Gates de entrada */}
        {etapa.gates_entrada.length > 0 && (
          <Section title="Gates de entrada" color="rose">
            {etapa.gates_entrada.map((g: Gate, i) => (
              <div key={i} className="text-sm">
                <p className="font-medium text-gray-700">{g.condicion}</p>
                <p className="text-gray-500">{g.descripcion}</p>
              </div>
            ))}
          </Section>
        )}

        {/* Inputs */}
        {etapa.inputs.length > 0 && (
          <Section title="Inputs" color="blue">
            <div className="space-y-1.5">
              {etapa.inputs.map((inp: InputOutput, i) => (
                <div key={i} className="flex items-start justify-between gap-2 text-sm">
                  <div>
                    <span className="font-medium text-gray-700">{inp.nombre}</span>
                    {inp.fuente && <span className="ml-1 text-gray-400 text-[11px]">← {inp.fuente}</span>}
                  </div>
                  <div className="flex items-center gap-1">
                    <span className="rounded bg-gray-100 px-1.5 py-0.5 font-mono text-[10px] text-gray-500">{inp.tipo}</span>
                    {inp.requerido === false && (
                      <span className="text-[9px] text-gray-400">opcional</span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </Section>
        )}

        {/* Outputs */}
        {etapa.outputs.length > 0 && (
          <Section title="Outputs" color="emerald">
            <div className="space-y-1.5">
              {etapa.outputs.map((out: InputOutput, i) => (
                <div key={i} className="flex items-start justify-between gap-2 text-sm">
                  <div>
                    <span className="font-medium text-gray-700">{out.nombre}</span>
                    {out.destino && <span className="ml-1 text-gray-400 text-[11px]">→ {out.destino}</span>}
                  </div>
                  <span className="rounded bg-gray-100 px-1.5 py-0.5 font-mono text-[10px] text-gray-500">{out.tipo}</span>
                </div>
              ))}
            </div>
          </Section>
        )}
      </div>

      {/* Bloques */}
      {etapa.bloques.length > 0 && (
        <div className="mt-4">
          <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-gray-400">
            Bloques del skill ({etapa.bloques.length})
          </h3>
          <div className="space-y-2">
            {etapa.bloques.map((b: Bloque, i) => {
              const dot = TIPO_BLOQUE_DOT[b.tipo] ?? 'bg-gray-300'
              return (
                <div key={i} className="flex items-start gap-3 rounded-lg border border-gray-100 bg-gray-50 px-3 py-2.5">
                  <div className="mt-1.5 flex items-center gap-1.5">
                    <span className="text-[11px] font-medium text-gray-400 w-4 text-right">{i + 1}</span>
                    <span className={`h-2 w-2 shrink-0 rounded-full ${dot}`} />
                  </div>
                  <div className="min-w-0">
                    <p className="text-[13px] font-medium text-[#1A1A1A]">{b.nombre}</p>
                    <p className="text-[11px] text-gray-500">{b.descripcion}</p>
                  </div>
                  <span className="shrink-0 rounded bg-white border border-gray-200 px-1.5 py-0.5 text-[9px] text-gray-400 capitalize">
                    {b.tipo}
                  </span>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* Notas */}
      {etapa.notas && (
        <div className="mt-4 rounded-md border border-amber-100 bg-amber-50 px-3 py-2 text-xs text-amber-700">
          <strong>Nota:</strong> {etapa.notas}
        </div>
      )}
    </div>
  )
}

function Section({ title, color, children }: {
  title: string
  color: 'blue' | 'emerald' | 'rose'
  children: React.ReactNode
}) {
  const header = {
    blue:    'text-blue-700 border-blue-200 bg-blue-50',
    emerald: 'text-emerald-700 border-emerald-200 bg-emerald-50',
    rose:    'text-rose-700 border-rose-200 bg-rose-50',
  }[color]

  return (
    <div className="rounded-lg border border-gray-200 bg-white overflow-hidden">
      <div className={`border-b px-3 py-2 text-[11px] font-semibold uppercase tracking-wider ${header}`}>
        {title}
      </div>
      <div className="space-y-2 p-3">
        {children}
      </div>
    </div>
  )
}
