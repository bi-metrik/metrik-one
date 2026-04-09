'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { ArrowLeft } from 'lucide-react'
import { toast } from 'sonner'
import { addHorasDestino } from './horas-action'

const VINCULO_LABEL: Record<string, string> = {
  empleado: 'Empleado',
  contratista: 'Contratista',
  freelance: 'Freelance',
}

interface Props {
  destinos: {
    negocios: { id: string; nombre: string; codigo: string }[]
    proyectos: { id: string; nombre: string; tipo: string; codigo: string }[]
  }
  staff: { id: string; full_name: string; tipo_vinculo: string | null; es_principal: boolean | null }[]
  defaultProyectoId?: string
  defaultNegocioId?: string
}

export default function NuevoHorasForm({ destinos, staff, defaultProyectoId, defaultNegocioId }: Props) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()

  // Compute default destinoKey from search params
  function getDefaultDestino(): string {
    if (defaultNegocioId && destinos.negocios.some(n => n.id === defaultNegocioId)) {
      return `negocio:${defaultNegocioId}`
    }
    if (defaultProyectoId && destinos.proyectos.some(p => p.id === defaultProyectoId)) {
      return `proyecto:${defaultProyectoId}`
    }
    return ''
  }

  const [destinoKey, setDestinoKey] = useState<string>(getDefaultDestino())
  const [staffId, setStaffId] = useState<string>(
    staff.find(s => s.es_principal)?.id ?? staff[0]?.id ?? ''
  )
  const [horas, setHoras] = useState('1')
  const [fecha, setFecha] = useState(new Date().toISOString().split('T')[0])
  const [descripcion, setDescripcion] = useState('')

  // Parse destinoKey
  const isNegocio = destinoKey.startsWith('negocio:')
  const isProyecto = destinoKey.startsWith('proyecto:')
  const destinoId = isNegocio ? destinoKey.slice(8) : isProyecto ? destinoKey.slice(9) : null
  const destinoTipo: 'negocio' | 'proyecto' | null = isNegocio ? 'negocio' : isProyecto ? 'proyecto' : null

  const hasNegocios = destinos.negocios.length > 0
  const hasProyectos = destinos.proyectos.length > 0

  const handleSubmit = () => {
    if (!destinoId || !destinoTipo) {
      toast.error('Selecciona un destino')
      return
    }
    const horasNum = parseFloat(horas)
    if (!horasNum || horasNum <= 0) {
      toast.error('Ingresa horas validas')
      return
    }
    startTransition(async () => {
      const res = await addHorasDestino(destinoId, destinoTipo, {
        fecha,
        horas: horasNum,
        descripcion: descripcion.trim() || undefined,
        staff_id: staffId || undefined,
      })
      if (res.success) {
        toast.success(`${horasNum}h registradas`)
        router.back()
      } else {
        toast.error(res.error)
      }
    })
  }

  return (
    <div className="mx-auto max-w-lg space-y-6 px-4 py-6">
      <div className="flex items-center gap-3">
        <button
          onClick={() => router.back()}
          className="rounded-md p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground"
        >
          <ArrowLeft className="h-5 w-5" />
        </button>
        <div>
          <h1 className="text-lg font-bold">Registrar horas</h1>
          <p className="text-xs text-muted-foreground">Registro rapido</p>
        </div>
      </div>

      <div className="space-y-4 rounded-lg border p-4">
        {/* Destino */}
        <div>
          <label className="mb-1 block text-xs font-medium text-muted-foreground">Destino *</label>
          <select
            value={destinoKey}
            onChange={e => setDestinoKey(e.target.value)}
            className="w-full rounded-md border bg-background px-3 py-2.5 text-sm"
          >
            <option value="">Seleccionar...</option>
            {hasNegocios && (
              <optgroup label="Negocios activos">
                {destinos.negocios.map(n => (
                  <option key={n.id} value={`negocio:${n.id}`}>
                    {n.codigo ? `${n.codigo} — ${n.nombre}` : n.nombre}
                  </option>
                ))}
              </optgroup>
            )}
            {hasProyectos && (
              <optgroup label="Proyectos activos">
                {destinos.proyectos.map(p => (
                  <option key={p.id} value={`proyecto:${p.id}`}>
                    {p.codigo} — {p.nombre}{p.tipo === 'interno' ? ' · Interno' : ''}
                  </option>
                ))}
              </optgroup>
            )}
          </select>
        </div>

        {/* Persona — solo si hay mas de 1 staff */}
        {staff.length > 1 && (
          <div>
            <label className="mb-1 block text-xs font-medium text-muted-foreground">Persona *</label>
            <select
              value={staffId}
              onChange={e => setStaffId(e.target.value)}
              className="w-full rounded-md border bg-background px-3 py-2.5 text-sm"
            >
              {staff.map(s => (
                <option key={s.id} value={s.id}>
                  {s.full_name}
                  {s.tipo_vinculo ? ` (${VINCULO_LABEL[s.tipo_vinculo] ?? s.tipo_vinculo})` : ''}
                  {s.es_principal ? ' *' : ''}
                </option>
              ))}
            </select>
          </div>
        )}

        {/* Staff unico: indicador */}
        {staff.length === 1 && (
          <p className="text-xs text-muted-foreground">
            Persona: <span className="font-medium text-foreground">{staff[0].full_name}</span>
          </p>
        )}

        {/* Horas */}
        <div>
          <label className="mb-1 block text-xs font-medium text-muted-foreground">Horas *</label>
          <input
            type="number"
            value={horas}
            onChange={e => setHoras(e.target.value)}
            step="0.5"
            min="0.5"
            autoFocus
            className="w-full rounded-md border bg-background px-3 py-2.5 text-sm"
          />
        </div>

        {/* Fecha */}
        <div>
          <label className="mb-1 block text-xs font-medium text-muted-foreground">Fecha</label>
          <input
            type="date"
            value={fecha}
            onChange={e => setFecha(e.target.value)}
            className="w-full rounded-md border bg-background px-3 py-2.5 text-sm"
          />
        </div>

        {/* Descripcion */}
        <div>
          <label className="mb-1 block text-xs font-medium text-muted-foreground">Descripcion</label>
          <input
            type="text"
            value={descripcion}
            onChange={e => setDescripcion(e.target.value)}
            placeholder="Que hiciste?"
            className="w-full rounded-md border bg-background px-3 py-2.5 text-sm"
          />
        </div>

        <button
          onClick={handleSubmit}
          disabled={isPending || !destinoKey || !horas}
          className="w-full rounded-lg bg-primary py-2.5 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
        >
          {isPending ? 'Registrando...' : 'Registrar horas'}
        </button>
      </div>
    </div>
  )
}
