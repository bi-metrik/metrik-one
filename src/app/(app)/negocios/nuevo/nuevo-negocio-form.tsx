'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Building2, User, FileText, Loader2, ChevronLeft } from 'lucide-react'
import { toast } from 'sonner'
import type { LineaNegocio } from '../negocio-v2-actions'
import { crearNegocio } from '../negocio-v2-actions'

interface Datos {
  empresas: { id: string; nombre: string }[]
  contactos: { id: string; nombre: string }[]
  lineas: LineaNegocio[]
}

// Separar líneas globales (plantillas) de líneas Clarity del workspace
function separarLineas(lineas: LineaNegocio[]): {
  plantillas: LineaNegocio[]
  clarity: LineaNegocio[]
} {
  return {
    plantillas: lineas.filter(l => l.tipo === 'plantilla'),
    clarity: lineas.filter(l => l.tipo === 'clarity'),
  }
}

export default function NuevoNegocioForm({ datos }: { datos: Datos }) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()

  // Campos del formulario
  const [nombre, setNombre] = useState('')
  const [lineaId, setLineaId] = useState('')
  const [clienteTipo, setClienteTipo] = useState<'empresa' | 'contacto'>('empresa')
  const [empresaId, setEmpresaId] = useState('')
  const [contactoId, setContactoId] = useState('')
  const [precioEstimado, setPrecioEstimado] = useState('')

  const { plantillas, clarity } = separarLineas(datos.lineas)
  const tieneClarity = clarity.length > 0
  const todasLineas = tieneClarity ? clarity : plantillas

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()

    if (!nombre.trim()) {
      toast.error('El nombre del negocio es requerido')
      return
    }
    if (!lineaId) {
      toast.error('Selecciona una línea de negocio')
      return
    }

    const precioNum = precioEstimado.trim()
      ? Number(precioEstimado.replace(/\D/g, ''))
      : undefined

    startTransition(async () => {
      const result = await crearNegocio({
        nombre: nombre.trim(),
        linea_id: lineaId,
        empresa_id: clienteTipo === 'empresa' && empresaId ? empresaId : undefined,
        contacto_id: clienteTipo === 'contacto' && contactoId ? contactoId : undefined,
        precio_estimado: precioNum,
      })

      if (result.error) {
        toast.error('Error al crear negocio: ' + result.error)
      } else {
        toast.success('Negocio creado')
        router.push(`/negocios/${result.negocio_id}`)
      }
    })
  }

  return (
    <div className="mx-auto max-w-lg px-4 py-6">
      {/* Header */}
      <div className="mb-6 flex items-center gap-3">
        <button
          type="button"
          onClick={() => router.back()}
          className="rounded-lg p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground transition-colors"
        >
          <ChevronLeft className="h-4 w-4" />
        </button>
        <div>
          <h1 className="text-base font-bold">Nuevo negocio</h1>
          <p className="text-xs text-muted-foreground">Completa los datos para crear el negocio</p>
        </div>
      </div>

      <form onSubmit={handleSubmit} className="space-y-5">
        {/* 1. Nombre */}
        <div className="rounded-xl border border-border bg-card p-4 shadow-sm">
          <div className="flex items-center gap-2 mb-3">
            <FileText className="h-4 w-4 text-muted-foreground" />
            <label className="text-sm font-semibold">Nombre del negocio</label>
            <span className="text-[10px] text-red-500 font-medium">Requerido</span>
          </div>
          <input
            type="text"
            value={nombre}
            onChange={e => setNombre(e.target.value)}
            placeholder="Ej: Implementación CRM ACME S.A.S"
            className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-colors"
            autoFocus
            maxLength={200}
          />
        </div>

        {/* 2. Línea de negocio */}
        <div className="rounded-xl border border-border bg-card p-4 shadow-sm">
          <div className="flex items-center justify-between mb-3">
            <label className="text-sm font-semibold">Línea de negocio</label>
            <span className="text-[10px] text-red-500 font-medium">Requerido</span>
          </div>

          {tieneClarity && (
            <p className="mb-2 text-[11px] text-muted-foreground">
              Líneas Clarity configuradas para tu workspace:
            </p>
          )}

          <div className="space-y-2">
            {todasLineas.map(linea => (
              <label
                key={linea.id}
                className={`flex cursor-pointer items-center gap-3 rounded-lg border p-3 transition-colors ${
                  lineaId === linea.id
                    ? 'border-primary bg-primary/5'
                    : 'border-border hover:border-primary/40 hover:bg-accent/50'
                }`}
              >
                <input
                  type="radio"
                  name="linea"
                  value={linea.id}
                  checked={lineaId === linea.id}
                  onChange={() => setLineaId(linea.id)}
                  className="accent-primary"
                />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium">{linea.nombre}</p>
                  <p className="text-[10px] text-muted-foreground capitalize">{linea.tipo}</p>
                </div>
              </label>
            ))}

            {todasLineas.length === 0 && (
              <p className="py-4 text-center text-xs text-muted-foreground">
                No hay líneas de negocio configuradas.
                <br />
                Contacta a MéTRIK para configurar tu proceso.
              </p>
            )}
          </div>
        </div>

        {/* 3. Cliente (empresa o contacto) */}
        <div className="rounded-xl border border-border bg-card p-4 shadow-sm">
          <p className="mb-3 text-sm font-semibold">Cliente</p>

          {/* Toggle empresa / contacto */}
          <div className="mb-3 flex rounded-lg border border-border bg-muted/30 p-1 gap-1">
            <button
              type="button"
              onClick={() => setClienteTipo('empresa')}
              className={`flex flex-1 items-center justify-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
                clienteTipo === 'empresa'
                  ? 'bg-background text-foreground shadow-sm'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              <Building2 className="h-3.5 w-3.5" />
              Empresa
            </button>
            <button
              type="button"
              onClick={() => setClienteTipo('contacto')}
              className={`flex flex-1 items-center justify-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
                clienteTipo === 'contacto'
                  ? 'bg-background text-foreground shadow-sm'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              <User className="h-3.5 w-3.5" />
              Contacto
            </button>
          </div>

          {clienteTipo === 'empresa' ? (
            <select
              value={empresaId}
              onChange={e => setEmpresaId(e.target.value)}
              className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-colors"
            >
              <option value="">Seleccionar empresa (opcional)</option>
              {datos.empresas.map(e => (
                <option key={e.id} value={e.id}>{e.nombre}</option>
              ))}
            </select>
          ) : (
            <select
              value={contactoId}
              onChange={e => setContactoId(e.target.value)}
              className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-colors"
            >
              <option value="">Seleccionar contacto (opcional)</option>
              {datos.contactos.map(c => (
                <option key={c.id} value={c.id}>{c.nombre}</option>
              ))}
            </select>
          )}
        </div>

        {/* 4. Precio estimado */}
        <div className="rounded-xl border border-border bg-card p-4 shadow-sm">
          <label className="block text-sm font-semibold mb-3">
            Precio estimado
            <span className="ml-2 text-[10px] font-normal text-muted-foreground">Opcional</span>
          </label>
          <div className="relative">
            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">$</span>
            <input
              type="text"
              inputMode="numeric"
              value={precioEstimado}
              onChange={e => {
                // Solo números
                const raw = e.target.value.replace(/\D/g, '')
                setPrecioEstimado(raw ? Number(raw).toLocaleString('es-CO') : '')
              }}
              placeholder="0"
              className="w-full rounded-lg border border-border bg-background pl-7 pr-3 py-2 text-sm text-right tabular-nums placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-colors"
            />
          </div>
          <p className="mt-1 text-[10px] text-muted-foreground">COP — sin IVA</p>
        </div>

        {/* Submit */}
        <button
          type="submit"
          disabled={isPending || !nombre.trim() || !lineaId}
          className="w-full rounded-xl bg-primary px-4 py-3 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {isPending ? (
            <span className="inline-flex items-center justify-center gap-2">
              <Loader2 className="h-4 w-4 animate-spin" />
              Creando negocio...
            </span>
          ) : (
            'Crear negocio'
          )}
        </button>
      </form>
    </div>
  )
}
