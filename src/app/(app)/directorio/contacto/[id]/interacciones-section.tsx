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
  type NegocioDelMismoContacto,
} from '../../../negocios/negocio-v2-actions'
import { DialogoNegocioDuplicado } from '@/components/negocios/dialogo-negocio-duplicado'
import { formatCOP } from '@/lib/contacts/constants'
import { origenDesdeFuenteInteraccion } from '@/lib/negocios/constants'
import { origenNegocioConfig } from '@/lib/catalogos/constants'
import type { InteraccionContacto, OrigenContacto } from '../../actions'
import { formatFecha } from '@/lib/dates/bogota'

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
// si el campo no está o llega sin values, simplemente no se muestra. `money`
// formatea el valor como COP.
const CAMPOS_RESUMEN: Array<{ names: string[]; label: string; money?: boolean }> = [
  { names: ['¿qué_tipo_de_vehículo_adquiriste?', 'tipo_vehiculo', 'tipo_de_vehiculo'], label: 'Vehículo' },
  { names: ['marca_-línea_-modelo__(_byd_-yuan_-2026)', 'marca_linea_modelo', 'marca'], label: 'Marca/modelo' },
  {
    names: ['precio_de_el(los)_vehículo(s)._pesos_colombianos', 'precio', 'precio_declarado', 'valor'],
    label: 'Precio declarado',
    money: true,
  },
  { names: ['persona_natural_o_jurídica', 'tipo_persona'], label: 'Tipo persona' },
]

// Formatea un valor de precio declarado. Tolera "$", puntos y comas de miles.
// Si extrae un número, lo formatea como COP; si no, deja el texto limpio.
function formatPrecio(v: string): string {
  const digits = v.replace(/[^\d]/g, '')
  if (digits.length > 0) {
    const n = Number(digits)
    if (Number.isFinite(n) && n > 0) return formatCOP(n)
  }
  return limpiar(v)
}

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

function formatFechaInteraccion(iso: string | null): string {
  return formatFecha(iso, { day: '2-digit', month: 'short', year: 'numeric' }) ?? ''
}

// Lee un texto del payload de la interaccion. El payload de Meta trae
// `campaign_name` y `ad_name` en las 703 de 703 interacciones medidas, pero el
// tipo es `Record<string, unknown>`: se lee defensivo y sin placeholder, igual
// que hace `leer()` con `field_data`.
function textoPayload(it: InteraccionContacto, key: string): string | null {
  const v = it.payload?.[key]
  return typeof v === 'string' && v.trim() ? v.trim() : null
}

interface Props {
  interacciones: InteraccionContacto[]
  origen?: OrigenContacto | null
}

// Resumen de campanas del contacto. Responde las tres preguntas que Daniela
// (supervisora comercial de SOENA) hace sobre un lead: cual campana lo trajo la
// primera vez, cual fue la ultima, y cuantos formularios ha llenado.
//
// La PRIMERA sale de `custom_data.origen`, no del `min()` de las interacciones:
// ese campo es first-touch inmutable grabado por el webhook, y es el que se usa
// para atribuir un cierre. Solo cuando el contacto no lo tiene (leads previos al
// webhook) se cae a la interaccion mas vieja con campana.
function ResumenCampanas({
  interacciones,
  origen,
}: {
  interacciones: InteraccionContacto[]
  origen?: OrigenContacto | null
}) {
  // `getInteraccionesPorContacto` devuelve recientes primero.
  const conCampana = interacciones.filter((it) => textoPayload(it, 'campaign_name') !== null)
  const masNueva = conCampana[0] ?? null
  const masVieja = conCampana[conCampana.length - 1] ?? null

  // Nombre y fecha salen SIEMPRE de la misma fuente. Medido el 2026-09-02: 333
  // contactos del workspace tienen `origen.first_at` con `origen.campaign_name`
  // en null (la llave existe, el valor no). Tomar el nombre de la interaccion mas
  // vieja y la fecha de `origen` mezclaria dos origenes y podria fechar mal la
  // primera campana, que es justo el dato con el que se atribuye un cierre.
  const origenNombre = origen?.campaign_name?.trim() || null
  const primeraNombre = origenNombre ?? (masVieja ? textoPayload(masVieja, 'campaign_name') : null)
  const primeraFecha = origenNombre
    ? origen?.first_at ?? null
    : masVieja?.ocurrida_at ?? masVieja?.created_at ?? null

  if (!primeraNombre) return null

  const ultimaNombre = masNueva ? textoPayload(masNueva, 'campaign_name') : null
  const ultimaFecha = masNueva?.ocurrida_at ?? masNueva?.created_at ?? null

  // Con un solo formulario, primera y ultima son la misma fila: se colapsa.
  const hayVarias = conCampana.length > 1 && ultimaNombre !== null

  return (
    <div className="rounded-md border border-dashed p-3">
      <div className="flex items-center gap-2">
        <Megaphone className="h-3.5 w-3.5 shrink-0 text-blue-600" />
        <h3 className="text-xs font-semibold">Campañas</h3>
        {conCampana.length > 0 && (
          <span className="text-[11px] text-muted-foreground">
            {conCampana.length} formulario{conCampana.length !== 1 ? 's' : ''}
          </span>
        )}
      </div>
      <dl className="mt-2 space-y-1">
        <div className="flex items-baseline justify-between gap-3">
          <dt className="shrink-0 text-[10px] uppercase tracking-wide text-muted-foreground">
            {hayVarias ? 'Primera' : 'Origen'}
          </dt>
          <dd className="min-w-0 flex-1 truncate text-right text-xs font-semibold">{primeraNombre}</dd>
          {primeraFecha && (
            <dd className="shrink-0 text-[11px] tabular-nums text-muted-foreground">
              {formatFechaInteraccion(primeraFecha)}
            </dd>
          )}
        </div>
        {hayVarias && (
          <div className="flex items-baseline justify-between gap-3">
            <dt className="shrink-0 text-[10px] uppercase tracking-wide text-muted-foreground">Última</dt>
            <dd className="min-w-0 flex-1 truncate text-right text-xs font-medium">{ultimaNombre}</dd>
            {ultimaFecha && (
              <dd className="shrink-0 text-[11px] tabular-nums text-muted-foreground">
                {formatFechaInteraccion(ultimaFecha)}
              </dd>
            )}
          </div>
        )}
      </dl>
    </div>
  )
}

export default function InteraccionesSection({ interacciones, origen }: Props) {
  if (interacciones.length === 0) {
    return (
      <div className="space-y-3 rounded-lg border p-4">
        <h2 className="text-sm font-semibold">Interacciones</h2>
        {/* El origen puede existir sin interacciones vivas (todas descartadas o
            convertidas antes de que se guardara el historial): se muestra igual. */}
        <ResumenCampanas interacciones={interacciones} origen={origen} />
        <p className="py-4 text-center text-xs text-muted-foreground">Sin interacciones registradas</p>
      </div>
    )
  }

  return (
    <div className="space-y-3 rounded-lg border p-4">
      <h2 className="text-sm font-semibold">Interacciones ({interacciones.length})</h2>
      <ResumenCampanas interacciones={interacciones} origen={origen} />
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
  const campana = textoPayload(it, 'campaign_name')
  const anuncio = textoPayload(it, 'ad_name')

  const resumen = CAMPOS_RESUMEN
    .map((c) => {
      const v = leer(fieldData, c.names)
      if (!v) return null
      return { label: c.label, value: c.money ? formatPrecio(v) : limpiar(v) }
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
          <span className="text-[11px] text-muted-foreground">{formatFechaInteraccion(it.ocurrida_at ?? it.created_at)}</span>
        </div>
        <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${estado.class}`}>{estado.label}</span>
      </div>

      {/* Campana y anuncio. Sin esto la fila dice de que FUENTE viene el lead pero
          no de que campana, que es justo lo que el equipo comercial necesita para
          atribuir el cierre. Ausencia tolerada: no se pinta nada. */}
      {campana && (
        <div className="mt-1.5 min-w-0">
          <p className="truncate text-xs font-medium">{campana}</p>
          {anuncio && <p className="truncate text-[11px] text-muted-foreground">{anuncio}</p>}
        </div>
      )}

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
          fuente={it.fuente}
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
  fuente,
  tipoSugerido,
  onCancel,
  onDone,
}: {
  interaccionId: string
  /** Canal de la interacción: determina el origen del negocio (no se pregunta). */
  fuente: string
  tipoSugerido: 'natural' | 'juridica' | null
  onCancel: () => void
  onDone: () => void
}) {
  const [tipo, setTipo] = useState<'natural' | 'juridica'>(tipoSugerido ?? 'natural')
  const [empresaNombre, setEmpresaNombre] = useState('')
  const [empresaNit, setEmpresaNit] = useState('')
  const [isPending, startTransition] = useTransition()
  /** Negocios que este contacto ya tiene. null = no hay que preguntar. */
  const [duplicados, setDuplicados] = useState<NegocioDelMismoContacto[] | null>(null)

  const enviar = (confirmarDuplicado: boolean) => {
    startTransition(async () => {
      const res = await crearNegocioDesdeInteraccion({
        interaccion_id: interaccionId,
        tipo_persona: tipo,
        empresa_nombre: tipo === 'juridica' ? empresaNombre.trim() : undefined,
        empresa_nit: tipo === 'juridica' ? empresaNit.trim() || undefined : undefined,
        confirmar_duplicado: confirmarDuplicado,
      })

      // Sin error y sin id = el contacto ya tiene negocios y falta la decisión.
      if (!res.error && !res.negocio_id && res.duplicados?.length) {
        setDuplicados(res.duplicados)
        return
      }

      setDuplicados(null)

      if (res.error) {
        toast.error(res.error)
      } else {
        toast.success('Negocio creado')
        onDone()
      }
    })
  }

  const submit = () => {
    if (tipo === 'juridica' && !empresaNombre.trim()) {
      toast.error('Ingresa el nombre de la empresa')
      return
    }
    enviar(false)
  }

  // El origen NO se pregunta: lo determina el canal de la interacción. Se
  // muestra resuelto para que quede a la vista con qué origen nace el negocio.
  const origenResuelto = origenDesdeFuenteInteraccion(fuente)
  const origenCfg = origenNegocioConfig(origenResuelto)

  return (
    <div className="mt-3 space-y-3 rounded-md border bg-muted/30 p-3">
      <div>
        <label className="mb-1 block text-[10px] font-medium uppercase tracking-wide text-muted-foreground">Origen del negocio</label>
        <div className="flex items-center gap-2">
          <span
            className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium ${origenCfg?.chipClass ?? 'bg-[#F5F4F2] text-[#6B7280]'}`}
          >
            {origenCfg?.label ?? origenResuelto}
          </span>
          <span className="text-[10px] text-muted-foreground">Se toma del canal de la interacción</span>
        </div>
      </div>

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

      {duplicados && (
        <DialogoNegocioDuplicado
          duplicados={duplicados}
          creando={isPending}
          onCancelar={() => setDuplicados(null)}
          onCrearIgual={() => enviar(true)}
        />
      )}
    </div>
  )
}
