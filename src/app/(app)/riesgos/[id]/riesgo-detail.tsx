'use client'

import { useState, useTransition } from 'react'
import Link from 'next/link'
import { ArrowLeft, Save, Trash2, ShieldCheck } from 'lucide-react'
import { actualizarRiesgo, eliminarRiesgo } from '@/lib/actions/riesgos'
import type { Riesgo } from '@/lib/actions/riesgos'
import { toast } from 'sonner'

const NIVEL_COLORS: Record<string, string> = {
  BAJO: 'bg-green-100 text-green-800',
  MEDIO: 'bg-yellow-100 text-yellow-800',
  ALTO: 'bg-orange-100 text-orange-800',
  CRITICO: 'bg-red-100 text-red-800',
}

const CATEGORIA_COLORS: Record<string, string> = {
  LA: 'bg-blue-100 text-blue-800',
  FT: 'bg-purple-100 text-purple-800',
  FPADM: 'bg-amber-100 text-amber-800',
  PTEE: 'bg-red-100 text-red-800',
}

const CATEGORIA_LABELS: Record<string, string> = {
  LA: 'Lavado de Activos',
  FT: 'Financiacion del Terrorismo',
  FPADM: 'Financiacion Proliferacion ADM',
  PTEE: 'Personas Exp. Politicamente',
}

const ESTADOS = [
  { value: 'ABIERTO', label: 'Abierto' },
  { value: 'BAJO_CONTROL', label: 'Bajo control' },
  { value: 'MONITOREADO', label: 'Monitoreado' },
  { value: 'MITIGADO', label: 'Mitigado' },
  { value: 'REPORTADO', label: 'Reportado' },
  { value: 'CERRADO', label: 'Cerrado' },
]

const PROB_LABELS: Record<number, string> = {
  1: 'Raro',
  2: 'Improbable',
  3: 'Posible',
  4: 'Probable',
  5: 'Casi seguro',
}

const IMPACTO_LABELS: Record<number, string> = {
  1: 'Insignificante',
  2: 'Menor',
  3: 'Moderado',
  4: 'Mayor',
  5: 'Catastrofico',
}

const FACTORES = [
  { value: 'clientes', label: 'Clientes' },
  { value: 'proveedores', label: 'Proveedores' },
  { value: 'empleados', label: 'Empleados' },
  { value: 'canales', label: 'Canales' },
  { value: 'jurisdicciones', label: 'Jurisdicciones' },
  { value: 'productos', label: 'Productos' },
  { value: 'operaciones', label: 'Operaciones' },
]

const FUENTES = [
  { value: '', label: 'Sin especificar' },
  { value: 'cliente_nuevo', label: 'Cliente nuevo' },
  { value: 'transaccion_atipica', label: 'Transaccion atipica' },
  { value: 'lista_internacional', label: 'Lista internacional' },
  { value: 'reporte_interno', label: 'Reporte interno' },
  { value: 'auditoria', label: 'Auditoria' },
  { value: 'otro', label: 'Otro' },
]

function calcNivel(prob: number, imp: number): { label: string; color: string } {
  const score = prob * imp
  if (score >= 20) return { label: 'CRITICO', color: 'bg-red-100 text-red-800' }
  if (score >= 12) return { label: 'ALTO', color: 'bg-orange-100 text-orange-800' }
  if (score >= 6) return { label: 'MEDIO', color: 'bg-yellow-100 text-yellow-800' }
  return { label: 'BAJO', color: 'bg-green-100 text-green-800' }
}

interface Props {
  riesgo: Riesgo
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  controles: any[]
  equipo: { id: string; full_name: string; role: string | null }[]
}

export default function RiesgoDetail({ riesgo, controles, equipo }: Props) {
  const [isPending, startTransition] = useTransition()
  const [prob, setProb] = useState(riesgo.probabilidad)
  const [imp, setImp] = useState(riesgo.impacto)
  const [estado, setEstado] = useState(riesgo.estado)
  const [responsableId, setResponsableId] = useState(riesgo.responsable_id ?? '')
  const [notas, setNotas] = useState(riesgo.notas ?? '')
  const [factorRiesgo, setFactorRiesgo] = useState(riesgo.factor_riesgo)
  const [fuente, setFuente] = useState(riesgo.fuente_identificacion ?? '')
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)

  const nivel = calcNivel(prob, imp)

  function handleSave() {
    startTransition(async () => {
      const fd = new FormData()
      fd.set('estado', estado)
      fd.set('probabilidad', String(prob))
      fd.set('impacto', String(imp))
      fd.set('responsable_id', responsableId)
      fd.set('notas', notas)
      fd.set('factor_riesgo', factorRiesgo)
      fd.set('fuente_identificacion', fuente)

      const result = await actualizarRiesgo(riesgo.id, fd)
      if (result.success) {
        toast.success('Riesgo actualizado')
      } else {
        toast.error(result.error ?? 'Error al actualizar')
      }
    })
  }

  function handleDelete() {
    startTransition(async () => {
      // eliminarRiesgo redirects on success
      await eliminarRiesgo(riesgo.id)
    })
  }

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Link
            href="/riesgos"
            className="flex h-8 w-8 items-center justify-center rounded-md border border-[#E5E7EB] transition-colors hover:bg-gray-50"
          >
            <ArrowLeft className="h-4 w-4 text-[#6B7280]" />
          </Link>
          <div>
            <div className="flex items-center gap-2">
              <span className="font-mono text-sm font-bold text-[#10B981]">{riesgo.codigo}</span>
              <span className={`inline-flex rounded-full px-2 py-0.5 text-[10px] font-bold ${CATEGORIA_COLORS[riesgo.categoria]}`}>
                {riesgo.categoria}
              </span>
              <span className={`inline-flex rounded-full px-2 py-0.5 text-[10px] font-bold ${NIVEL_COLORS[riesgo.nivel_riesgo]}`}>
                {riesgo.nivel_riesgo}
              </span>
            </div>
            <p className="text-xs text-[#6B7280]">{CATEGORIA_LABELS[riesgo.categoria]}</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={handleSave}
            disabled={isPending}
            className="inline-flex items-center gap-2 rounded-lg bg-[#10B981] px-4 py-2 text-sm font-medium text-white shadow-sm transition-colors hover:bg-[#059669] disabled:opacity-50"
          >
            <Save className="h-4 w-4" />
            {isPending ? 'Guardando...' : 'Guardar'}
          </button>
          <button
            onClick={() => setShowDeleteConfirm(true)}
            className="inline-flex items-center gap-1 rounded-lg border border-red-200 px-3 py-2 text-sm font-medium text-red-600 transition-colors hover:bg-red-50"
          >
            <Trash2 className="h-4 w-4" />
          </button>
        </div>
      </div>

      {/* Delete confirmation */}
      {showDeleteConfirm && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-4">
          <p className="text-sm font-medium text-red-800">Eliminar este riesgo permanentemente?</p>
          <div className="mt-3 flex gap-2">
            <button
              onClick={handleDelete}
              disabled={isPending}
              className="rounded-lg bg-red-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-50"
            >
              Si, eliminar
            </button>
            <button
              onClick={() => setShowDeleteConfirm(false)}
              className="rounded-lg border border-[#E5E7EB] px-4 py-1.5 text-sm font-medium text-[#6B7280] hover:bg-gray-50"
            >
              Cancelar
            </button>
          </div>
        </div>
      )}

      {/* Descripcion */}
      <div className="rounded-lg border border-[#E5E7EB] bg-white p-5 space-y-4">
        <h2 className="text-sm font-semibold text-[#1A1A1A]">Descripcion del riesgo</h2>
        <p className="text-sm text-[#1A1A1A] leading-relaxed">{riesgo.descripcion}</p>
      </div>

      {/* Editable fields */}
      <div className="rounded-lg border border-[#E5E7EB] bg-white p-5 space-y-5">
        <h2 className="text-sm font-semibold text-[#1A1A1A]">Evaluacion</h2>

        <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
          {/* Estado */}
          <div className="space-y-1.5">
            <label className="block text-xs font-medium text-[#6B7280]">Estado</label>
            <select
              value={estado}
              onChange={e => setEstado(e.target.value)}
              className="w-full rounded-lg border border-[#E5E7EB] bg-white px-3 py-2 text-sm focus:border-[#10B981] focus:outline-none focus:ring-2 focus:ring-[rgba(16,185,129,0.15)]"
            >
              {ESTADOS.map(e => (
                <option key={e.value} value={e.value}>{e.label}</option>
              ))}
            </select>
          </div>

          {/* Responsable */}
          <div className="space-y-1.5">
            <label className="block text-xs font-medium text-[#6B7280]">Responsable</label>
            <select
              value={responsableId}
              onChange={e => setResponsableId(e.target.value)}
              className="w-full rounded-lg border border-[#E5E7EB] bg-white px-3 py-2 text-sm focus:border-[#10B981] focus:outline-none focus:ring-2 focus:ring-[rgba(16,185,129,0.15)]"
            >
              <option value="">Sin asignar</option>
              {equipo.map(m => (
                <option key={m.id} value={m.id}>{m.full_name}</option>
              ))}
            </select>
          </div>

          {/* Probabilidad */}
          <div className="space-y-1.5">
            <label className="block text-xs font-medium text-[#6B7280]">Probabilidad</label>
            <select
              value={prob}
              onChange={e => setProb(parseInt(e.target.value))}
              className="w-full rounded-lg border border-[#E5E7EB] bg-white px-3 py-2 text-sm focus:border-[#10B981] focus:outline-none focus:ring-2 focus:ring-[rgba(16,185,129,0.15)]"
            >
              {[1, 2, 3, 4, 5].map(v => (
                <option key={v} value={v}>{v} — {PROB_LABELS[v]}</option>
              ))}
            </select>
          </div>

          {/* Impacto */}
          <div className="space-y-1.5">
            <label className="block text-xs font-medium text-[#6B7280]">Impacto</label>
            <select
              value={imp}
              onChange={e => setImp(parseInt(e.target.value))}
              className="w-full rounded-lg border border-[#E5E7EB] bg-white px-3 py-2 text-sm focus:border-[#10B981] focus:outline-none focus:ring-2 focus:ring-[rgba(16,185,129,0.15)]"
            >
              {[1, 2, 3, 4, 5].map(v => (
                <option key={v} value={v}>{v} — {IMPACTO_LABELS[v]}</option>
              ))}
            </select>
          </div>

          {/* Factor */}
          <div className="space-y-1.5">
            <label className="block text-xs font-medium text-[#6B7280]">Factor de riesgo</label>
            <select
              value={factorRiesgo}
              onChange={e => setFactorRiesgo(e.target.value)}
              className="w-full rounded-lg border border-[#E5E7EB] bg-white px-3 py-2 text-sm focus:border-[#10B981] focus:outline-none focus:ring-2 focus:ring-[rgba(16,185,129,0.15)]"
            >
              {FACTORES.map(f => (
                <option key={f.value} value={f.value}>{f.label}</option>
              ))}
            </select>
          </div>

          {/* Fuente */}
          <div className="space-y-1.5">
            <label className="block text-xs font-medium text-[#6B7280]">Fuente de identificacion</label>
            <select
              value={fuente}
              onChange={e => setFuente(e.target.value)}
              className="w-full rounded-lg border border-[#E5E7EB] bg-white px-3 py-2 text-sm focus:border-[#10B981] focus:outline-none focus:ring-2 focus:ring-[rgba(16,185,129,0.15)]"
            >
              {FUENTES.map(f => (
                <option key={f.value} value={f.value}>{f.label}</option>
              ))}
            </select>
          </div>
        </div>

        {/* Nivel preview */}
        <div className="flex items-center gap-3 rounded-lg border border-[#E5E7EB] bg-gray-50 px-4 py-3">
          <span className="text-sm font-medium text-[#6B7280]">Nivel calculado:</span>
          <span className={`inline-flex rounded-full px-3 py-1 text-xs font-bold ${nivel.color}`}>
            {nivel.label}
          </span>
          <span className="text-xs text-[#6B7280]">({prob} x {imp} = {prob * imp})</span>
        </div>

        {/* Notas */}
        <div className="space-y-1.5">
          <label className="block text-xs font-medium text-[#6B7280]">Notas</label>
          <textarea
            value={notas}
            onChange={e => setNotas(e.target.value)}
            rows={3}
            placeholder="Observaciones adicionales..."
            className="w-full rounded-lg border border-[#E5E7EB] bg-white px-3 py-2 text-sm placeholder:text-[#6B7280] focus:border-[#10B981] focus:outline-none focus:ring-2 focus:ring-[rgba(16,185,129,0.15)]"
          />
        </div>
      </div>

      {/* Metadata */}
      <div className="rounded-lg border border-[#E5E7EB] bg-white p-5 space-y-2">
        <h2 className="text-sm font-semibold text-[#1A1A1A]">Informacion</h2>
        <div className="grid grid-cols-2 gap-x-8 gap-y-2 text-xs">
          <div>
            <span className="text-[#6B7280]">Fecha identificacion:</span>{' '}
            <span className="text-[#1A1A1A] font-medium">{riesgo.fecha_identificacion ?? '—'}</span>
          </div>
          <div>
            <span className="text-[#6B7280]">Fecha evaluacion:</span>{' '}
            <span className="text-[#1A1A1A] font-medium">{riesgo.fecha_evaluacion ?? '—'}</span>
          </div>
          <div>
            <span className="text-[#6B7280]">Creado:</span>{' '}
            <span className="text-[#1A1A1A] font-medium">{new Date(riesgo.created_at).toLocaleDateString('es-CO')}</span>
          </div>
          <div>
            <span className="text-[#6B7280]">Actualizado:</span>{' '}
            <span className="text-[#1A1A1A] font-medium">{new Date(riesgo.updated_at).toLocaleDateString('es-CO')}</span>
          </div>
        </div>
      </div>

      {/* Controles asociados */}
      <div className="rounded-lg border border-[#E5E7EB] bg-white p-5 space-y-3">
        <div className="flex items-center gap-2">
          <ShieldCheck className="h-4 w-4 text-[#10B981]" />
          <h2 className="text-sm font-semibold text-[#1A1A1A]">Controles asociados</h2>
        </div>
        {controles.length === 0 ? (
          <div className="rounded-lg border border-dashed border-[#E5E7EB] bg-gray-50 p-6 text-center">
            <p className="text-xs text-[#6B7280]">
              Sin controles asignados. Los controles se configuran en una fase posterior.
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 text-left text-xs font-medium uppercase tracking-wider text-[#6B7280]">
                <tr>
                  <th className="px-3 py-2">Control</th>
                  <th className="px-3 py-2">Tipo</th>
                  <th className="px-3 py-2">Estado</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#E5E7EB]">
                {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
                {controles.map((c: any) => (
                  <tr key={c.id}>
                    <td className="px-3 py-2 text-[#1A1A1A]">{c.nombre_control}</td>
                    <td className="px-3 py-2 text-xs text-[#6B7280]">{c.tipo_control}</td>
                    <td className="px-3 py-2 text-xs text-[#6B7280]">{c.estado}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}
