'use client'

import { useState, useTransition } from 'react'
import { ShieldCheck } from 'lucide-react'
import { toast } from 'sonner'
import { ganarOportunidad } from '../actions-v2'
import { TIPOS_PERSONA, REGIMENES_TRIBUTARIOS, TIPOS_DOCUMENTO } from '@/lib/pipeline/constants'

interface EmpresaData {
  id: string
  nombre: string
  numero_documento: string | null
  tipo_documento: string | null
  tipo_persona: string | null
  regimen_tributario: string | null
  gran_contribuyente: boolean | null
  agente_retenedor: boolean | null
}

interface Props {
  oportunidadId: string
  empresa: EmpresaData
  onComplete: () => void
  onCancel: () => void
}

export default function FiscalGateForm({ oportunidadId, empresa, onComplete, onCancel }: Props) {
  const [isPending, startTransition] = useTransition()
  const [form, setForm] = useState({
    numero_documento: empresa.numero_documento ?? '',
    tipo_documento: empresa.tipo_documento ?? '',
    tipo_persona: empresa.tipo_persona ?? '',
    regimen_tributario: empresa.regimen_tributario ?? '',
    gran_contribuyente: empresa.gran_contribuyente?.toString() ?? '',
    agente_retenedor: empresa.agente_retenedor?.toString() ?? '',
  })

  // Show only the missing fields
  const missing = {
    numero_documento: !empresa.numero_documento,
    tipo_documento: !empresa.tipo_documento,
    tipo_persona: !empresa.tipo_persona,
    regimen_tributario: !empresa.regimen_tributario,
    gran_contribuyente: empresa.gran_contribuyente === null,
    agente_retenedor: empresa.agente_retenedor === null,
  }

  // Auto-suggest tipo_documento when tipo_persona changes
  const handleTipoPersonaChange = (value: string) => {
    setForm(p => ({
      ...p,
      tipo_persona: value,
      ...(missing.tipo_documento && value === 'natural' && !p.tipo_documento ? { tipo_documento: 'CC' } : {}),
      ...(missing.tipo_documento && value === 'juridica' && !p.tipo_documento ? { tipo_documento: 'NIT' } : {}),
    }))
  }

  const handleSubmit = () => {
    startTransition(async () => {
      const res = await ganarOportunidad(oportunidadId, {
        empresa_id: empresa.id,
        numero_documento: form.numero_documento || undefined,
        tipo_documento: form.tipo_documento || undefined,
        tipo_persona: form.tipo_persona || undefined,
        regimen_tributario: form.regimen_tributario || undefined,
        gran_contribuyente: form.gran_contribuyente ? form.gran_contribuyente === 'true' : undefined,
        agente_retenedor: form.agente_retenedor ? form.agente_retenedor === 'true' : undefined,
      })
      if (res.success) {
        toast.success('Oportunidad ganada! Proyecto creado.')
        onComplete()
      } else {
        toast.error(res.error)
      }
    })
  }

  return (
    <div className="rounded-lg border-2 border-green-200 bg-green-50/30 p-5">
      <div className="flex items-center gap-2">
        <ShieldCheck className="h-5 w-5 text-green-600" />
        <h3 className="text-sm font-bold text-green-800">Un paso mas para cerrar este negocio</h3>
      </div>
      <p className="mt-1 text-xs text-green-700">
        Completa el perfil fiscal de <strong>{empresa.nombre}</strong> para poder cerrar la oportunidad.
      </p>

      <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
        {missing.tipo_persona && (
          <div>
            <label className="mb-1 block text-xs font-medium">Tipo persona</label>
            <select
              value={form.tipo_persona}
              onChange={e => handleTipoPersonaChange(e.target.value)}
              className="w-full rounded-md border bg-background px-3 py-2 text-sm"
            >
              <option value="">Seleccionar</option>
              {TIPOS_PERSONA.map(t => (
                <option key={t.value} value={t.value}>{t.label}</option>
              ))}
            </select>
          </div>
        )}
        {missing.tipo_documento && (
          <div>
            <label className="mb-1 block text-xs font-medium">Tipo documento</label>
            <select
              value={form.tipo_documento}
              onChange={e => setForm(p => ({ ...p, tipo_documento: e.target.value }))}
              className="w-full rounded-md border bg-background px-3 py-2 text-sm"
            >
              <option value="">Seleccionar</option>
              {TIPOS_DOCUMENTO.map(t => (
                <option key={t.value} value={t.value}>{t.label}</option>
              ))}
            </select>
          </div>
        )}
        {missing.numero_documento && (
          <div>
            <label className="mb-1 block text-xs font-medium">
              {form.tipo_documento === 'NIT' ? 'NIT' : form.tipo_documento || 'Documento'}
            </label>
            <input
              value={form.numero_documento}
              onChange={e => setForm(p => ({ ...p, numero_documento: e.target.value }))}
              placeholder={form.tipo_documento === 'NIT' ? '900.123.456' : '1.020.456.789'}
              className="w-full rounded-md border bg-background px-3 py-2 text-sm"
            />
          </div>
        )}
        {missing.regimen_tributario && (
          <div>
            <label className="mb-1 block text-xs font-medium">Regimen tributario</label>
            <select
              value={form.regimen_tributario}
              onChange={e => setForm(p => ({ ...p, regimen_tributario: e.target.value }))}
              className="w-full rounded-md border bg-background px-3 py-2 text-sm"
            >
              <option value="">Seleccionar</option>
              {REGIMENES_TRIBUTARIOS.map(r => (
                <option key={r.value} value={r.value}>{r.label}</option>
              ))}
            </select>
          </div>
        )}
        {missing.gran_contribuyente && (
          <div>
            <label className="mb-1 block text-xs font-medium">Gran contribuyente</label>
            <select
              value={form.gran_contribuyente}
              onChange={e => setForm(p => ({ ...p, gran_contribuyente: e.target.value }))}
              className="w-full rounded-md border bg-background px-3 py-2 text-sm"
            >
              <option value="">Seleccionar</option>
              <option value="true">Si</option>
              <option value="false">No</option>
            </select>
          </div>
        )}
        {missing.agente_retenedor && (
          <div>
            <label className="mb-1 block text-xs font-medium">Agente retenedor</label>
            <select
              value={form.agente_retenedor}
              onChange={e => setForm(p => ({ ...p, agente_retenedor: e.target.value }))}
              className="w-full rounded-md border bg-background px-3 py-2 text-sm"
            >
              <option value="">Seleccionar</option>
              <option value="true">Si</option>
              <option value="false">No</option>
            </select>
          </div>
        )}
      </div>

      <div className="mt-4 flex gap-2">
        <button
          onClick={onCancel}
          className="flex-1 rounded-lg border py-2 text-sm font-medium hover:bg-accent"
        >
          Cancelar
        </button>
        <button
          onClick={handleSubmit}
          disabled={isPending}
          className="flex-1 rounded-lg bg-green-600 py-2 text-sm font-medium text-white hover:bg-green-700 disabled:opacity-50"
        >
          {isPending ? 'Procesando...' : 'Completar y cerrar negocio'}
        </button>
      </div>
    </div>
  )
}
