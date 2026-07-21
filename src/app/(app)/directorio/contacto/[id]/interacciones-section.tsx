'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { Megaphone, MessageCircle, Globe, User, ArrowRight, CheckCircle2, XCircle, Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import {
  crearNegocioDesdeInteraccion,
  marcarInteraccionContactada,
  descartarInteraccion,
} from '../../../negocios/negocio-v2-actions'
import type { InteraccionContacto } from '../../actions'

// ── Presentación por fuente / estado ────────────────────────────────
const FUENTE_META: Record<string, { label: string; icon: typeof Megaphone; class: string }> = {
  meta: { label: 'Meta', icon: Megaphone, class: 'bg-blue-50 text-blue-700' },
  whatsapp: { label: 'WhatsApp', icon: MessageCircle, class: 'bg-green-50 text-green-700' },
  web: { label: 'Web', icon: Globe, class: 'bg-purple-50 text-purple-700' },
  manual: { label: 'Manual', icon: User, class: 'bg-slate-100 text-slate-700' },
}

const ESTADO_META: Record<string, { label: string; class: string }> = {
  nueva: { label: 'Nueva', class: 'bg-amber-50 text-amber-700' },
  contactada: { label: 'Contactada', class: 'bg-blue-50 text-blue-700' },
  descartada: { label: 'Descartada', class: 'bg-slate-100 text-slate-500' },
  convertida: { label: 'Convertida', class: 'bg-green-50 text-green-700' },
  posible_duplicado: { label: 'Posible duplicado', class: 'bg-red-50 text-red-700' },
}

// Campos del field_data que resumimos (nombre candidato → etiqueta). Tolerante:
// si el campo no está o llega sin values, simplemente no se muestra.
const CAMPOS_RESUMEN: Array<{ names: string[]; label: string }> = [
  { names: ['¿qué_tipo_de_vehículo_adquiriste?', 'tipo_vehiculo', 'tipo_de_vehiculo'], label: 'Vehículo' },
  { names: ['marca_-línea_-modelo__(_byd_-yuan_-2026)', 'marca_linea_modelo', 'marca'], label: 'Marca/modelo' },
  { names: ['precio', 'precio_declarado', 'valor'], label: 'Precio declarado' },
  { names: ['persona_natural_o_jurídica', 'tipo_persona'], label: 'Tipo persona' },
]

type FieldDatum = { name?: string; values?: string[] }

function leer(fieldData: FieldDatum[], names: string[]): string | null {
  for (const n of names) {
    const f = fieldData.find((fd) => fd.name?.toLowerCase() === n.toLowerCase())
    // Tolerar campos sin `values` o vacíos.
    if (f?.values?.length && f.values[0]?.trim()) return f.values[0].trim()
  }
  return null
}

// Limpia un valor declarado: quita relleno con guiones bajos y capitaliza enums.
function limpiar(v: string): string {
  const t = v.replace(/_+$/g, '').replace(/_/g, ' ').trim()
  return t.charAt(0).toUpperCase() + t.slice(1)
}

function detectarTipoPersona(fieldData: FieldDatum[]): 'natural' | 'juridica' | null {
  const raw = leer(fieldData, ['persona_natural_o_jurídica', 'tipo_persona'])
  if (!raw) return null
  const norm = raw.trim().toLowerCase().replace(/_+$/, '')
  if (norm.startsWith('natural')) return 'natural'
  if (norm.startsWith('jur')) return 'juridica'
  return null
}

function formatFecha(iso: string | null): string {
  if (!iso) return ''
  try {
    return new Date(iso).toLocaleDateString('es-CO', { day: '2-digit', month: 'short', year: 'numeric' })
  } catch {
    return ''
  }
}

interface Props {
  interacciones: InteraccionContacto[]
}

export default function InteraccionesSection({ interacciones }: Props) {
  if (interacciones.length === 0) {
    return (
      <div className="space-y-3 rounded-lg border p-4">
        <h2 className="text-sm font-semibold">Interacciones</h2>
        <p className="py-4 text-center text-xs text-muted-foreground">Sin interacciones registradas</p>
      </div>
    )
  }

  return (
    <div className="space-y-3 rounded-lg border p-4">
      <h2 className="text-sm font-semibold">Interacciones ({interacciones.length})</h2>
      <div className="space-y-3">
        {interacciones.map((it) => (
          <InteraccionRow key={it.id} it={it} />
        ))}
      </div>
    </div>
  )
}

function InteraccionRow({ it }: { it: InteraccionContacto }) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [showForm, setShowForm] = useState(false)

  const fuente = FUENTE_META[it.fuente] ?? FUENTE_META.manual
  const FuenteIcon = fuente.icon
  const estado = ESTADO_META[it.estado] ?? ESTADO_META.nueva
  const fieldData = ((it.payload?.field_data ?? []) as FieldDatum[])
  const tipoDetectado = detectarTipoPersona(fieldData)

  const resumen = CAMPOS_RESUMEN
    .map((c) => {
      const v = leer(fieldData, c.names)
      return v ? { label: c.label, value: limpiar(v) } : null
    })
    .filter((x): x is { label: string; value: string } => x !== null)

  const yaConvertida = it.estado === 'convertida'
  const cerrada = it.estado === 'descartada'

  const accion = (fn: () => Promise<{ success?: boolean; error?: string; negocio_id?: string | null }>, okMsg: string) => {
    startTransition(async () => {
      const res = await fn()
      if (res.error) {
        toast.error(res.error)
      } else {
        toast.success(okMsg)
        router.refresh()
      }
    })
  }

  return (
    <div className="rounded-md border p-3">
      {/* Cabecera: fuente + fecha + estado */}
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium ${fuente.class}`}>
            <FuenteIcon className="h-3 w-3" /> {fuente.label}
          </span>
          <span className="text-[11px] text-muted-foreground">{formatFecha(it.ocurrida_at ?? it.created_at)}</span>
        </div>
        <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${estado.class}`}>{estado.label}</span>
      </div>

      {/* Resumen del payload */}
      {resumen.length > 0 && (
        <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1">
          {resumen.map((r) => (
            <div key={r.label} className="min-w-0">
              <dt className="text-[10px] uppercase tracking-wide text-muted-foreground">{r.label}</dt>
              <dd className="truncate text-xs font-medium">{r.value}</dd>
            </div>
          ))}
        </dl>
      )}

      {/* Negocio ya creado */}
      {yaConvertida && it.negocio_id && (
        <Link
          href={`/negocios/${it.negocio_id}`}
          className="mt-2 inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline"
        >
          Ver negocio <ArrowRight className="h-3 w-3" />
        </Link>
      )}

      {/* Acciones */}
      {!yaConvertida && !cerrada && (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          {!showForm && (
            <button
              onClick={() => setShowForm(true)}
              disabled={isPending}
              className="inline-flex items-center gap-1 rounded-lg bg-primary px-2.5 py-1.5 text-[11px] font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
            >
              <CheckCircle2 className="h-3.5 w-3.5" /> Crear negocio
            </button>
          )}
          {it.estado !== 'contactada' && (
            <button
              onClick={() => accion(() => marcarInteraccionContactada(it.id), 'Marcada como contactada')}
              disabled={isPending}
              className="inline-flex items-center gap-1 rounded-lg border px-2.5 py-1.5 text-[11px] font-medium hover:bg-accent disabled:opacity-50"
            >
              Marcar contactada
            </button>
          )}
          <button
            onClick={() => accion(() => descartarInteraccion(it.id), 'Interacción descartada')}
            disabled={isPending}
            className="inline-flex items-center gap-1 rounded-lg border px-2.5 py-1.5 text-[11px] font-medium text-muted-foreground hover:bg-accent disabled:opacity-50"
          >
            <XCircle className="h-3.5 w-3.5" /> Descartar
          </button>
          {isPending && <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />}
        </div>
      )}

      {/* Mini-form de conversión */}
      {showForm && !yaConvertida && (
        <CrearNegocioForm
          interaccionId={it.id}
          tipoSugerido={tipoDetectado}
          onCancel={() => setShowForm(false)}
          onDone={() => {
            setShowForm(false)
            router.refresh()
          }}
        />
      )}
    </div>
  )
}

function CrearNegocioForm({
  interaccionId,
  tipoSugerido,
  onCancel,
  onDone,
}: {
  interaccionId: string
  tipoSugerido: 'natural' | 'juridica' | null
  onCancel: () => void
  onDone: () => void
}) {
  const [tipo, setTipo] = useState<'natural' | 'juridica'>(tipoSugerido ?? 'natural')
  const [empresaNombre, setEmpresaNombre] = useState('')
  const [empresaNit, setEmpresaNit] = useState('')
  const [isPending, startTransition] = useTransition()

  const submit = () => {
    if (tipo === 'juridica' && !empresaNombre.trim()) {
      toast.error('Ingresa el nombre de la empresa')
      return
    }
    startTransition(async () => {
      const res = await crearNegocioDesdeInteraccion({
        interaccion_id: interaccionId,
        tipo_persona: tipo,
        empresa_nombre: tipo === 'juridica' ? empresaNombre.trim() : undefined,
        empresa_nit: tipo === 'juridica' ? empresaNit.trim() || undefined : undefined,
      })
      if (res.error) {
        toast.error(res.error)
      } else {
        toast.success('Negocio creado')
        onDone()
      }
    })
  }

  return (
    <div className="mt-3 space-y-3 rounded-md border bg-muted/30 p-3">
      <div>
        <label className="mb-1 block text-[10px] font-medium uppercase tracking-wide text-muted-foreground">Tipo de persona</label>
        <div className="flex gap-2">
          {(['natural', 'juridica'] as const).map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => setTipo(t)}
              className={`rounded-lg border px-3 py-1.5 text-xs font-medium capitalize ${
                tipo === t ? 'border-primary bg-primary text-primary-foreground' : 'hover:bg-accent'
              }`}
            >
              {t === 'juridica' ? 'Empresa' : 'Natural'}
            </button>
          ))}
        </div>
      </div>

      {tipo === 'juridica' && (
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          <div>
            <label className="mb-1 block text-[10px] font-medium uppercase tracking-wide text-muted-foreground">Nombre empresa *</label>
            <input
              value={empresaNombre}
              onChange={(e) => setEmpresaNombre(e.target.value)}
              className="w-full rounded-md border bg-background px-3 py-2 text-sm"
              placeholder="Razón social"
            />
          </div>
          <div>
            <label className="mb-1 block text-[10px] font-medium uppercase tracking-wide text-muted-foreground">NIT</label>
            <input
              value={empresaNit}
              onChange={(e) => setEmpresaNit(e.target.value)}
              className="w-full rounded-md border bg-background px-3 py-2 text-sm"
              placeholder="Opcional"
            />
          </div>
        </div>
      )}

      <div className="flex items-center gap-2">
        <button
          onClick={submit}
          disabled={isPending}
          className="inline-flex items-center gap-1 rounded-lg bg-primary px-3 py-2 text-xs font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
        >
          {isPending && <Loader2 className="h-3.5 w-3.5 animate-spin" />} Crear negocio
        </button>
        <button
          onClick={onCancel}
          disabled={isPending}
          className="rounded-lg border px-3 py-2 text-xs font-medium hover:bg-accent disabled:opacity-50"
        >
          Cancelar
        </button>
      </div>
    </div>
  )
}
