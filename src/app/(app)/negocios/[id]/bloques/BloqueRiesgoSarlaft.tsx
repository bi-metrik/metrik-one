'use client'

import { useState, useTransition } from 'react'
import Link from 'next/link'
import { Scale, ChevronRight, LayoutGrid, Save, ExternalLink, AlertTriangle } from 'lucide-react'
import {
  type DatosSarlaftInput,
  type DatosSarlaftNegocio,
  type ScoreNegocioItem,
  guardarDatosSarlaft,
  recalcularScoreNegocio,
} from '@/lib/actions/valida-score'

interface Props {
  negocioId: string
  datosIniciales: DatosSarlaftNegocio | null
  scoreInicial: ScoreNegocioItem | null
}

const NIVEL_CLASS: Record<'alto' | 'medio' | 'bajo', string> = {
  alto: 'bg-[#EF4444] text-white',
  medio: 'bg-[#F59E0B] text-[#1A1A1A]',
  bajo: 'bg-[#10B981] text-white',
}
const NIVEL_LABEL: Record<'alto' | 'medio' | 'bajo', string> = {
  alto: 'Alto',
  medio: 'Medio',
  bajo: 'Bajo',
}

export default function BloqueRiesgoSarlaft({ negocioId, datosIniciales, scoreInicial }: Props) {
  const [expanded, setExpanded] = useState(false)
  const [datos, setDatos] = useState<DatosSarlaftInput>(() => ({
    universo: datosIniciales?.universo ?? 'contraparte',
    pais_codigo_iso: datosIniciales?.pais_codigo_iso ?? '',
    municipio_divipola: datosIniciales?.municipio_divipola ?? '',
    ciiu_codigo: datosIniciales?.ciiu_codigo ?? '',
    calidad_verificado: datosIniciales?.calidad_verificado ?? '',
    forma_operacion: datosIniciales?.forma_operacion ?? '',
    tipo_contrato: datosIniciales?.tipo_contrato ?? '',
    criticidad_cargo: datosIniciales?.criticidad_cargo ?? '',
    endeudamiento: datosIniciales?.endeudamiento ?? '',
    notas: datosIniciales?.notas ?? '',
  }))
  const [score, setScore] = useState<ScoreNegocioItem | null>(scoreInicial)
  const [error, setError] = useState<string | null>(null)
  const [info, setInfo] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  function guardar() {
    setError(null)
    setInfo(null)
    startTransition(async () => {
      const r = await guardarDatosSarlaft(negocioId, normalizar(datos))
      if (!r.ok) {
        setError(r.error)
        return
      }
      setScore(r.score)
      setInfo('Datos guardados. Score recalculado.')
    })
  }

  function recalcular() {
    setError(null)
    setInfo(null)
    startTransition(async () => {
      const r = await recalcularScoreNegocio(negocioId)
      if (!r.ok) {
        setError(r.error)
        return
      }
      setScore(r.score)
      setInfo('Score recalculado.')
    })
  }

  const niveltxt = score ? NIVEL_LABEL[score.nivel] : null

  return (
    <div className="rounded-xl border border-border bg-card transition-colors">
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex w-full items-start gap-3 p-3 text-left"
      >
        <div className="shrink-0 mt-0.5">
          <LayoutGrid className="h-4 w-4 text-muted-foreground/40" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="flex items-center gap-1.5 text-sm font-medium leading-tight text-foreground flex-wrap">
            <Scale className="h-3.5 w-3.5 text-[#10B981]" />
            Riesgo SARLAFT
            {score && (
              <>
                <span className={`${NIVEL_CLASS[score.nivel]} text-[10px] font-bold px-2 py-0.5 rounded uppercase tracking-wider`}>
                  {niveltxt} · {score.puntaje.toFixed(2)} pts
                </span>
                {score.proxima_revision && (
                  <span className="text-[10px] text-[#6B7280]">
                    Próxima revisión: {new Date(score.proxima_revision).toLocaleDateString('es-CO', { year: 'numeric', month: 'short', day: 'numeric' })}
                  </span>
                )}
              </>
            )}
            {!score && (
              <span className="text-[10px] text-[#9CA3AF]">Sin calcular</span>
            )}
          </p>
          <div className="mt-0.5 flex flex-wrap items-center gap-1.5">
            <span className="text-[10px] text-muted-foreground/60 uppercase tracking-wide">
              riesgo_sarlaft
            </span>
            <span className="inline-flex items-center rounded-full bg-slate-100 px-1.5 py-0.5 text-[10px] font-medium text-slate-500 dark:bg-slate-800">
              {datos.universo === 'contraparte' ? 'Contraparte' : 'Empleado'}
            </span>
          </div>
        </div>
        <ChevronRight className={`h-3.5 w-3.5 text-muted-foreground/40 transition-transform ${expanded ? 'rotate-90' : ''}`} />
      </button>

      {expanded && (
        <div className="border-t border-border/50 px-3 py-3 space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Campo etiqueta="Universo">
              <select
                value={datos.universo}
                onChange={e => setDatos({ ...datos, universo: e.target.value as 'contraparte' | 'empleado' })}
                className="w-full h-9 px-2 rounded border border-[#E5E7EB] bg-white text-sm"
              >
                <option value="contraparte">Contraparte (proveedor / cliente)</option>
                <option value="empleado">Empleado interno</option>
              </select>
            </Campo>
            <Campo etiqueta="País" hint="Código ISO 2 letras (ej. CO, US)">
              <input
                type="text"
                maxLength={2}
                value={datos.pais_codigo_iso ?? ''}
                onChange={e => setDatos({ ...datos, pais_codigo_iso: e.target.value.toUpperCase() })}
                placeholder="CO"
                className="w-full h-9 px-2 rounded border border-[#E5E7EB] bg-white text-sm uppercase font-mono"
              />
            </Campo>

            {datos.universo === 'contraparte' ? (
              <>
                <Campo etiqueta="Código CIIU" hint="Ej. 0122, 4923">
                  <input
                    type="text"
                    maxLength={4}
                    value={datos.ciiu_codigo ?? ''}
                    onChange={e => setDatos({ ...datos, ciiu_codigo: e.target.value })}
                    placeholder="4923"
                    className="w-full h-9 px-2 rounded border border-[#E5E7EB] bg-white text-sm font-mono"
                  />
                </Campo>
                <Campo etiqueta="Calidad del verificado">
                  <select
                    value={datos.calidad_verificado ?? ''}
                    onChange={e => setDatos({ ...datos, calidad_verificado: e.target.value })}
                    className="w-full h-9 px-2 rounded border border-[#E5E7EB] bg-white text-sm"
                  >
                    <option value="">—</option>
                    <option value="representante_legal">Representante legal</option>
                    <option value="accionista">Accionista</option>
                    <option value="apoderado">Apoderado</option>
                    <option value="revisor_fiscal">Revisor fiscal</option>
                    <option value="miembro_junta">Miembro de junta</option>
                    <option value="beneficiario_final">Beneficiario final</option>
                    <option value="proveedor">Proveedor</option>
                    <option value="contratista">Contratista</option>
                  </select>
                </Campo>
                <Campo etiqueta="Forma de operación / pago">
                  <select
                    value={datos.forma_operacion ?? ''}
                    onChange={e => setDatos({ ...datos, forma_operacion: e.target.value })}
                    className="w-full h-9 px-2 rounded border border-[#E5E7EB] bg-white text-sm"
                  >
                    <option value="">—</option>
                    <option value="credito">Crédito</option>
                    <option value="contado">Contado</option>
                    <option value="anticipado">Anticipado</option>
                    <option value="no_aplica">No aplica</option>
                  </select>
                </Campo>
              </>
            ) : (
              <>
                <Campo etiqueta="Municipio (DIVIPOLA)" hint="Código DANE 5 dígitos">
                  <input
                    type="text"
                    maxLength={5}
                    value={datos.municipio_divipola ?? ''}
                    onChange={e => setDatos({ ...datos, municipio_divipola: e.target.value })}
                    placeholder="11001"
                    className="w-full h-9 px-2 rounded border border-[#E5E7EB] bg-white text-sm font-mono"
                  />
                </Campo>
                <Campo etiqueta="Tipo de contrato">
                  <select
                    value={datos.tipo_contrato ?? ''}
                    onChange={e => setDatos({ ...datos, tipo_contrato: e.target.value })}
                    className="w-full h-9 px-2 rounded border border-[#E5E7EB] bg-white text-sm"
                  >
                    <option value="">—</option>
                    <option value="indefinido">Indefinido</option>
                    <option value="fijo">Fijo</option>
                    <option value="temporal">Temporal</option>
                    <option value="labor_obra">Labor / obra</option>
                    <option value="aprendizaje">Aprendizaje / práctica</option>
                  </select>
                </Campo>
                <Campo etiqueta="Criticidad del cargo">
                  <select
                    value={datos.criticidad_cargo ?? ''}
                    onChange={e => setDatos({ ...datos, criticidad_cargo: e.target.value })}
                    className="w-full h-9 px-2 rounded border border-[#E5E7EB] bg-white text-sm"
                  >
                    <option value="">—</option>
                    <option value="lider">Líder</option>
                    <option value="tactico">Táctico</option>
                    <option value="operativo">Operativo</option>
                  </select>
                </Campo>
                <Campo etiqueta="Endeudamiento con la empresa">
                  <select
                    value={datos.endeudamiento ?? ''}
                    onChange={e => setDatos({ ...datos, endeudamiento: e.target.value })}
                    className="w-full h-9 px-2 rounded border border-[#E5E7EB] bg-white text-sm"
                  >
                    <option value="">—</option>
                    <option value="alto">Alto</option>
                    <option value="medio">Medio</option>
                    <option value="bajo">Bajo</option>
                    <option value="no_aplica">No aplica</option>
                  </select>
                </Campo>
              </>
            )}
          </div>

          <div>
            <button
              type="button"
              onClick={guardar}
              disabled={pending}
              className="inline-flex items-center gap-1.5 h-9 px-3 rounded bg-[#10B981] text-white font-semibold text-xs hover:bg-[#059669] disabled:opacity-50 transition-colors"
            >
              <Save className="h-3.5 w-3.5" />
              {pending ? 'Guardando…' : 'Guardar y recalcular'}
            </button>
            {score && (
              <button
                type="button"
                onClick={recalcular}
                disabled={pending}
                className="ml-2 inline-flex items-center gap-1.5 h-9 px-3 rounded border border-[#E5E7EB] text-xs font-semibold text-[#1A1A1A] hover:bg-[#F5F4F2] transition-colors"
              >
                Recalcular sin cambios
              </button>
            )}
            <Link
              href="/compliance/segmentacion"
              className="ml-2 inline-flex items-center gap-1 text-xs font-semibold text-[#10B981] hover:text-[#059669]"
            >
              Configurar segmentación
              <ExternalLink className="h-3 w-3" />
            </Link>
          </div>

          {info && (
            <div className="text-xs text-[#059669] flex items-center gap-1">
              ✓ {info}
            </div>
          )}
          {error && (
            <div className="text-xs text-[#B91C1C] flex items-center gap-1">
              <AlertTriangle className="h-3 w-3" />
              {error === 'datos_sarlaft_no_configurados' ? 'Guarda los datos antes de recalcular.' : error}
            </div>
          )}

          {score && (
            <DetalleFactores score={score} />
          )}
        </div>
      )}
    </div>
  )
}

function DetalleFactores({ score }: { score: ScoreNegocioItem }) {
  const f = score.factores_aplicados
  const filas = Object.entries(f).filter(([, v]) => v && typeof v === 'object')

  return (
    <div className="border border-[#E5E7EB] rounded p-3 bg-[#F5F4F2]/50">
      <p className="text-[10px] uppercase tracking-wider text-[#6B7280] font-semibold mb-2">
        Detalle de factores aplicados
      </p>
      <table className="w-full text-[11px]">
        <thead>
          <tr className="text-[#6B7280] text-left">
            <th className="font-semibold py-1">Factor</th>
            <th className="font-semibold text-center">Score</th>
            <th className="font-semibold text-center">Peso</th>
            <th className="font-semibold text-right">Aporte</th>
          </tr>
        </thead>
        <tbody>
          {filas.map(([key, val]) => {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const v = val as any
            const label = FACTOR_LABEL[key] ?? key
            return (
              <tr key={key} className="border-t border-[#E5E7EB]">
                <td className="py-1">{label}</td>
                <td className="text-center font-mono">{v.score}</td>
                <td className="text-center font-mono">{(v.peso * 100).toFixed(0)}%</td>
                <td className="text-right font-mono">{v.aporte.toFixed(2)}</td>
              </tr>
            )
          })}
          <tr className="border-t border-[#1A1A1A] font-bold">
            <td colSpan={3} className="py-1 text-right">Puntaje total</td>
            <td className="text-right font-mono">{score.puntaje.toFixed(2)}</td>
          </tr>
        </tbody>
      </table>
      {f.pep_listas?.bandera && (
        <div className="mt-2 text-[10px] text-[#B91C1C] font-semibold">
          ⚠ Bandera: {BANDERA_LABEL[f.pep_listas.bandera] ?? f.pep_listas.bandera}
        </div>
      )}
    </div>
  )
}

const FACTOR_LABEL: Record<string, string> = {
  pais: 'País',
  municipio: 'Ubicación (municipio)',
  ciiu: 'Actividad económica (CIIU)',
  calidad_verificado: 'Calidad del verificado',
  forma_operacion: 'Forma de operación',
  tipo_contrato: 'Tipo de contrato',
  criticidad_cargo: 'Criticidad del cargo',
  endeudamiento: 'Endeudamiento',
  pep_listas: 'PEP + Listas (Valida)',
}

const BANDERA_LABEL: Record<string, string> = {
  bloqueo_ros: 'Bloqueo + reporte ROS UIAF (Ley 1121/2006 Art. 20)',
  diligencia_ampliada: 'Debida diligencia ampliada (Decreto 830/2021)',
  politica_interna: 'Revisar política interna de listas no vinculantes',
}

function Campo({ etiqueta, hint, children }: { etiqueta: string; hint?: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-[10px] uppercase tracking-wider text-[#6B7280] font-semibold mb-1">
        {etiqueta}
        {hint && <span className="ml-1 normal-case tracking-normal font-normal text-[#9CA3AF]">— {hint}</span>}
      </label>
      {children}
    </div>
  )
}

function normalizar(d: DatosSarlaftInput): DatosSarlaftInput {
  const out: DatosSarlaftInput = {
    universo: d.universo,
    pais_codigo_iso: d.pais_codigo_iso?.trim() || null,
    municipio_divipola: d.municipio_divipola?.trim() || null,
    ciiu_codigo: d.ciiu_codigo?.trim() || null,
    calidad_verificado: d.calidad_verificado?.trim() || null,
    forma_operacion: d.forma_operacion?.trim() || null,
    tipo_contrato: d.tipo_contrato?.trim() || null,
    criticidad_cargo: d.criticidad_cargo?.trim() || null,
    endeudamiento: d.endeudamiento?.trim() || null,
    notas: d.notas?.trim() || null,
  }
  return out
}
