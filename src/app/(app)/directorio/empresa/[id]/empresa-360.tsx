'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { ArrowLeft, Save, Flame, FolderKanban, ShieldCheck, ShieldAlert, User } from 'lucide-react'
import { toast } from 'sonner'
import { updateEmpresa } from '../../actions'
import { SECTORES_EMPRESA, TIPOS_PERSONA, REGIMENES_TRIBUTARIOS, TIPOS_DOCUMENTO, ETAPA_CONFIG, ESTADO_PROYECTO_CONFIG } from '@/lib/pipeline/constants'
import { formatNit, formatCOP } from '@/lib/contacts/constants'
import type { Empresa } from '@/types/database'
import type { EtapaPipeline, EstadoProyecto } from '@/lib/pipeline/constants'
import NotesSection from '@/components/notes-section'

interface OportunidadRow {
  id: string
  descripcion: string | null
  etapa: string | null
  valor_estimado: number | null
  created_at: string | null
  contactos: { nombre: string } | null
}

interface ProyectoRow {
  id: string
  nombre: string | null
  estado: string | null
  presupuesto_total: number | null
  avance_porcentaje: number | null
  created_at: string | null
}

interface Props {
  empresa: Empresa
  oportunidades: OportunidadRow[]
  proyectos: ProyectoRow[]
}

export default function Empresa360({ empresa, oportunidades, proyectos }: Props) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [form, setForm] = useState({
    nombre: empresa.nombre,
    sector: empresa.sector ?? '',
    numero_documento: empresa.numero_documento ?? '',
    tipo_documento: empresa.tipo_documento ?? '',
    tipo_persona: empresa.tipo_persona ?? '',
    regimen_tributario: empresa.regimen_tributario ?? '',
    gran_contribuyente: empresa.gran_contribuyente ?? false,
    agente_retenedor: empresa.agente_retenedor ?? false,
  })

  // Track if the boolean fields have been explicitly set (not null in DB)
  const granContribuyenteSet = empresa.gran_contribuyente !== null
  const agenteRetenedorSet = empresa.agente_retenedor !== null

  const [granTouched, setGranTouched] = useState(granContribuyenteSet)
  const [agenteTouched, setAgenteTouched] = useState(agenteRetenedorSet)

  const perfilCompleto = !!(form.numero_documento && form.tipo_documento && form.tipo_persona && form.regimen_tributario &&
    granTouched && agenteTouched)

  const handleSave = () => {
    const fd = new FormData()
    fd.set('nombre', form.nombre)
    fd.set('sector', form.sector)
    fd.set('numero_documento', form.numero_documento)
    fd.set('tipo_documento', form.tipo_documento)
    fd.set('tipo_persona', form.tipo_persona)
    fd.set('regimen_tributario', form.regimen_tributario)
    if (granTouched) fd.set('gran_contribuyente', form.gran_contribuyente.toString())
    if (agenteTouched) fd.set('agente_retenedor', form.agente_retenedor.toString())
    startTransition(async () => {
      const res = await updateEmpresa(empresa.id, fd)
      if (res.success) {
        toast.success('Empresa actualizada')
        router.refresh()
      } else {
        toast.error(res.error)
      }
    })
  }

  return (
    <div className="mx-auto max-w-2xl space-y-6 px-4 py-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <Link
          href="/directorio/empresas"
          className="rounded-md p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground"
        >
          <ArrowLeft className="h-5 w-5" />
        </Link>
        <div className="flex-1">
          <h1 className="text-lg font-bold">{empresa.nombre}</h1>
          <div className="flex items-center gap-2">
            <p className="text-xs text-muted-foreground">Vista 360 de la empresa</p>
            {perfilCompleto ? (
              <span className="inline-flex items-center gap-1 rounded-full bg-green-100 px-2 py-0.5 text-[10px] font-medium text-green-700">
                <ShieldCheck className="h-3 w-3" /> Fiscal completo
              </span>
            ) : (
              <span className="inline-flex items-center gap-1 rounded-full bg-red-100 px-2 py-0.5 text-[10px] font-medium text-red-700">
                <ShieldAlert className="h-3 w-3" /> Fiscal incompleto
              </span>
            )}
          </div>
        </div>
        <button
          onClick={handleSave}
          disabled={isPending}
          className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-3 py-2 text-xs font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
        >
          <Save className="h-3.5 w-3.5" />
          Guardar
        </button>
      </div>

      {/* Datos generales */}
      <div className="space-y-3 rounded-lg border p-4">
        <h2 className="text-sm font-semibold">Datos generales</h2>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div>
            <label className="mb-1 block text-xs font-medium text-muted-foreground">Nombre *</label>
            <input
              value={form.nombre}
              onChange={e => setForm(p => ({ ...p, nombre: e.target.value }))}
              className="w-full rounded-md border bg-background px-3 py-2 text-sm"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-muted-foreground">Sector</label>
            <select
              value={form.sector}
              onChange={e => setForm(p => ({ ...p, sector: e.target.value }))}
              className="w-full rounded-md border bg-background px-3 py-2 text-sm"
            >
              <option value="">Seleccionar sector</option>
              {SECTORES_EMPRESA.map(s => (
                <option key={s} value={s}>{s}</option>
              ))}
            </select>
          </div>
        </div>
      </div>

      {/* Perfil fiscal */}
      <div className={`space-y-3 rounded-lg border p-4 ${!perfilCompleto ? 'border-red-200 bg-red-50/30' : ''}`}>
        <div className="flex items-center gap-2 flex-wrap">
          <h2 className="text-sm font-semibold">Perfil fiscal</h2>
          {!perfilCompleto && (
            <span className="text-[10px] text-red-600">Completa este perfil para poder cerrar negocios</span>
          )}
          {empresa.contacto_id && (
            <Link href={`/directorio/contacto/${empresa.contacto_id}`} className="inline-flex items-center gap-1 rounded-full bg-purple-100 px-2 py-0.5 text-[10px] font-medium text-purple-700 hover:bg-purple-200">
              <User className="h-3 w-3" /> Persona natural vinculada
            </Link>
          )}
        </div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div>
            <label className="mb-1 block text-xs font-medium text-muted-foreground">Tipo documento</label>
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
          <div>
            <label className="mb-1 block text-xs font-medium text-muted-foreground">
              {form.tipo_documento === 'NIT' ? 'NIT' : form.tipo_documento || 'Numero documento'}
            </label>
            <input
              value={form.numero_documento}
              onChange={e => setForm(p => ({ ...p, numero_documento: e.target.value }))}
              placeholder={form.tipo_documento === 'NIT' ? '900.123.456' : '1.020.456.789'}
              className="w-full rounded-md border bg-background px-3 py-2 text-sm"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-muted-foreground">Tipo persona</label>
            <select
              value={form.tipo_persona}
              onChange={e => setForm(p => ({ ...p, tipo_persona: e.target.value }))}
              className="w-full rounded-md border bg-background px-3 py-2 text-sm"
            >
              <option value="">Seleccionar</option>
              {TIPOS_PERSONA.map(t => (
                <option key={t.value} value={t.value}>{t.label}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-muted-foreground">Regimen tributario</label>
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
          <label className="flex items-center gap-3 rounded-md border bg-background px-3 py-2.5 cursor-pointer hover:bg-accent/50 transition-colors">
            <input
              type="checkbox"
              checked={form.gran_contribuyente}
              onChange={e => { setForm(p => ({ ...p, gran_contribuyente: e.target.checked })); setGranTouched(true) }}
              className="h-4 w-4 rounded border-gray-300 text-primary focus:ring-primary"
            />
            <div>
              <span className="text-sm font-medium">Gran contribuyente</span>
              {!granTouched && <span className="ml-2 text-[10px] text-amber-600">Sin definir</span>}
            </div>
          </label>
          <label className="flex items-center gap-3 rounded-md border bg-background px-3 py-2.5 cursor-pointer hover:bg-accent/50 transition-colors">
            <input
              type="checkbox"
              checked={form.agente_retenedor}
              onChange={e => { setForm(p => ({ ...p, agente_retenedor: e.target.checked })); setAgenteTouched(true) }}
              className="h-4 w-4 rounded border-gray-300 text-primary focus:ring-primary"
            />
            <div>
              <span className="text-sm font-medium">Agente retenedor</span>
              {!agenteTouched && <span className="ml-2 text-[10px] text-amber-600">Sin definir</span>}
            </div>
          </label>
        </div>
      </div>

      {/* Oportunidades */}
      <div className="space-y-3 rounded-lg border p-4">
        <h2 className="text-sm font-semibold">Oportunidades ({oportunidades.length})</h2>
        {oportunidades.length === 0 ? (
          <p className="py-4 text-center text-xs text-muted-foreground">Sin oportunidades</p>
        ) : (
          <div className="space-y-2">
            {oportunidades.map(o => {
              const ec = ETAPA_CONFIG[o.etapa as EtapaPipeline]
              return (
                <Link
                  key={o.id}
                  href={`/pipeline/${o.id}`}
                  className="flex items-center justify-between rounded-md border p-3 transition-colors hover:bg-accent/50"
                >
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <Flame className="h-3.5 w-3.5 text-orange-500 shrink-0" />
                      <span className="truncate text-sm font-medium">{o.descripcion || 'Sin descripcion'}</span>
                    </div>
                    {o.contactos && (
                      <p className="ml-5.5 text-xs text-muted-foreground">{(o.contactos as { nombre: string }).nombre}</p>
                    )}
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    {o.valor_estimado && <span className="text-xs font-medium">{formatCOP(o.valor_estimado)}</span>}
                    {ec && <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${ec.chipClass}`}>{ec.label}</span>}
                  </div>
                </Link>
              )
            })}
          </div>
        )}
      </div>

      {/* Proyectos */}
      <div className="space-y-3 rounded-lg border p-4">
        <h2 className="text-sm font-semibold">Proyectos ({proyectos.length})</h2>
        {proyectos.length === 0 ? (
          <p className="py-4 text-center text-xs text-muted-foreground">Sin proyectos</p>
        ) : (
          <div className="space-y-2">
            {proyectos.map(p => {
              const ec = ESTADO_PROYECTO_CONFIG[p.estado as EstadoProyecto]
              return (
                <Link
                  key={p.id}
                  href={`/proyectos/${p.id}`}
                  className="flex items-center justify-between rounded-md border p-3 transition-colors hover:bg-accent/50"
                >
                  <div className="flex items-center gap-2">
                    <FolderKanban className="h-3.5 w-3.5 text-blue-500 shrink-0" />
                    <span className="text-sm font-medium">{p.nombre || 'Sin nombre'}</span>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    {p.presupuesto_total && <span className="text-xs font-medium">{formatCOP(p.presupuesto_total)}</span>}
                    {ec && <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${ec.chipClass}`}>{ec.label}</span>}
                  </div>
                </Link>
              )
            })}
          </div>
        )}
      </div>

      {/* Notas */}
      <div className="space-y-3 rounded-lg border p-4">
        <h2 className="text-sm font-semibold">Notas</h2>
        <NotesSection entityType="empresa" entityId={empresa.id} />
      </div>
    </div>
  )
}
