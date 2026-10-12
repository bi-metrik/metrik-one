'use client'

import { useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { Camera, Check, ChevronDown, FileText, Paperclip } from 'lucide-react'
import { useTransitionTolerante } from '@/hooks/use-transition-tolerante'
import { formatCOP } from '@/lib/cobros/format'
import { todayBogotaISO } from '@/lib/dates/bogota'
import { hrefArchivo } from '@/lib/almacenamiento/referencia'
import { ETIQUETA_ESTADO, puedeAdjuntarVoucher, puedeEditarServicios, puedeTraerServicios, type EstadoServicio } from '@/lib/viaje/estado-servicio'
import {
  fechaLimiteEnPalabras,
  filasVista,
  resumenDelTablero,
  totalesDelTablero,
  type DatosBloqueServicios,
  type FilaVista,
} from '@/lib/viaje/bloque-servicios'
import {
  actualizarServicio,
  adjuntarArchivoServicio,
  traerServiciosDeCotizacion,
  type CambiosServicio,
} from '../../servicios-viaje-actions'

/**
 * Bloque «Servicios del viaje» (F0): una fila por servicio de la tarifa aceptada, en el orden
 * del viaje. Aquí se reserva (proveedor, localizador, fecha límite), se marca «No va» y se
 * adjuntan el voucher y la confirmación del proveedor final como archivo. Pagar al proveedor
 * llega con F3.
 *
 * Los datos los resuelve el servidor y viajan en `config_extra._servicios` (no por props: un
 * solo tipo de bloque no justifica hilar dos props por cuatro sitios de llamada).
 *
 * Celular: tarjetas apiladas; un toque abre la fila debajo, con botones de 44 px.
 */

const COLOR_TIPO: Record<string, string> = {
  vuelo: 'border-l-sky-500',
  hotel: 'border-l-violet-500',
  traslado: 'border-l-amber-500',
  actividad: 'border-l-emerald-500',
  asistencia: 'border-l-rose-500',
  otro: 'border-l-gray-400',
}

const ETIQUETA_TIPO: Record<string, string> = {
  vuelo: 'Vuelo',
  hotel: 'Hotel',
  traslado: 'Traslado',
  actividad: 'Actividad',
  asistencia: 'Asistencia',
  otro: 'Otro',
}

const PILDORA: Record<EstadoServicio, string> = {
  por_reservar: 'bg-gray-100 text-gray-700',
  reservado: 'bg-blue-100 text-blue-700',
  esperando: 'bg-purple-100 text-purple-700',
  no_aprobado: 'bg-red-100 text-red-700',
  pagado: 'bg-green-100 text-green-700',
  confirmado: 'bg-green-600 text-white',
  cancelado: 'bg-gray-100 text-gray-400 line-through',
}

const COLOR_FECHA = { verde: 'text-green-700', ambar: 'text-amber-600', rojo: 'text-red-600' } as const

interface BloqueServiciosProps {
  negocioId: string
  modo: 'editable' | 'visible'
  datos: DatosBloqueServicios | null | undefined
  esResponsable: boolean
}

export default function BloqueServicios({ negocioId, modo, datos, esResponsable }: BloqueServiciosProps) {
  const router = useRouter()
  const [abierta, setAbierta] = useState<string | null>(null)
  const [isPending, startTransition] = useTransitionTolerante()

  if (!datos) {
    return <p className="text-xs text-muted-foreground">Los servicios del viaje se ven en la etapa donde se trabajan.</p>
  }

  const quien = { ...datos.quien, esResponsable }
  const editable = modo === 'editable' && datos.activo
  const puedeEditar = editable && puedeEditarServicios(quien)
  const puedeVoucher = editable && puedeAdjuntarVoucher(quien)
  const hoy = todayBogotaISO()
  const vista = filasVista(datos.filas)

  function traer() {
    startTransition(async () => {
      const r = await traerServiciosDeCotizacion(negocioId)
      if (!r.ok) {
        toast.error(r.error)
        return
      }
      toast.success(r.creadas === 1 ? 'Se trajo 1 servicio de la cotización.' : `Se trajeron ${r.creadas} servicios de la cotización.`)
      router.refresh()
    })
  }

  if (vista.length === 0) {
    return (
      <div className="space-y-2 text-sm">
        <p className="text-muted-foreground">
          {datos.hayCotizacionAceptada
            ? 'Este viaje no tiene servicios todavía.'
            : 'Los servicios del viaje salen de la cotización aceptada. Todavía no hay una.'}
        </p>
        {datos.hayCotizacionAceptada && editable && puedeTraerServicios(quien) && (
          <button
            type="button"
            onClick={traer}
            disabled={isPending}
            className="min-h-11 rounded-md bg-primary px-3 text-sm font-medium text-primary-foreground disabled:opacity-60"
          >
            {isPending ? 'Trayendo…' : 'Traer los servicios de la cotización aceptada'}
          </button>
        )}
      </div>
    )
  }

  const totales = totalesDelTablero(vista)
  return (
    <div className="space-y-3">
      <p className="text-xs font-medium text-muted-foreground">{resumenDelTablero(vista, hoy)}</p>
      <ul className="space-y-2">
        {vista.map(v => (
          <FilaServicio
            key={v.servicio.id}
            v={v}
            hoy={hoy}
            abierta={abierta === v.servicio.id}
            alternar={() => setAbierta(a => (a === v.servicio.id ? null : v.servicio.id))}
            puedeEditar={puedeEditar}
            puedeVoucher={puedeVoucher}
            alGuardar={() => router.refresh()}
          />
        ))}
      </ul>
      <div className="flex flex-wrap justify-between gap-2 border-t pt-2 text-xs">
        <span className="text-muted-foreground">Cotizado {formatCOP(totales.cotizado)}</span>
        <span className="font-medium">Costo real hasta hoy {formatCOP(totales.pagado)}</span>
      </div>
      {!datos.activo && (
        <p className="text-[11px] text-muted-foreground">Los servicios del viaje están apagados en esta línea: se ven, no se editan.</p>
      )}
    </div>
  )
}

function FilaServicio({
  v,
  hoy,
  abierta,
  alternar,
  puedeEditar,
  puedeVoucher,
  alGuardar,
}: {
  v: FilaVista
  hoy: string
  abierta: boolean
  alternar: () => void
  puedeEditar: boolean
  puedeVoucher: boolean
  alGuardar: () => void
}) {
  const s = v.servicio
  const fecha = fechaLimiteEnPalabras(s.fecha_limite_pago, v.estado, hoy)
  const detalle = [s.proveedor_nombre ?? 'Falta el proveedor', s.localizador ? `loc. ${s.localizador}` : null]
    .filter(Boolean)
    .join(' · ')
  return (
    <li className={`rounded-md border border-l-4 ${COLOR_TIPO[s.tipo] ?? COLOR_TIPO.otro} bg-card`}>
      <button
        type="button"
        onClick={alternar}
        aria-expanded={abierta}
        className="flex w-full min-h-11 items-start gap-2 p-2.5 text-left"
      >
        <div className="min-w-0 flex-1 space-y-0.5">
          <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">{ETIQUETA_TIPO[s.tipo] ?? 'Otro'}</p>
          <p className={`break-words text-sm font-medium ${v.estado === 'cancelado' ? 'line-through text-muted-foreground' : ''}`}>{s.nombre}</p>
          <p className="break-words text-xs text-muted-foreground">{detalle}</p>
          <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-xs">
            {fecha && <span className={COLOR_FECHA[fecha.color]}>{fecha.texto}</span>}
            <span className="tabular-nums text-muted-foreground">
              Cotizado {formatCOP(s.costo_cotizado)} · Pagado {formatCOP(v.pagado)}
              {v.sobrecosto > 0 && <span className="text-amber-600"> +{formatCOP(v.sobrecosto)}</span>}
            </span>
          </div>
          <p className="text-[11px] text-muted-foreground">
            {s.gastos.some(g => g.soporte_url) ? '◉' : '○'} soporte · {s.voucher_ref ? '◉' : '○'} voucher · {s.confirmacion_ref ? '◉' : '○'} confirmado
          </p>
        </div>
        <span className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium ${PILDORA[v.estado]}`}>{ETIQUETA_ESTADO[v.estado]}</span>
        <ChevronDown className={`mt-0.5 h-4 w-4 shrink-0 text-muted-foreground transition-transform ${abierta ? 'rotate-180' : ''}`} />
      </button>
      {abierta && (
        <HojaServicio v={v} puedeEditar={puedeEditar} puedeVoucher={puedeVoucher} alGuardar={alGuardar} />
      )}
    </li>
  )
}

function HojaServicio({
  v,
  puedeEditar,
  puedeVoucher,
  alGuardar,
}: {
  v: FilaVista
  puedeEditar: boolean
  puedeVoucher: boolean
  alGuardar: () => void
}) {
  const s = v.servicio
  const [isPending, startTransition] = useTransitionTolerante()

  function guardar(cambios: CambiosServicio, aviso?: string) {
    startTransition(async () => {
      const r = await actualizarServicio(s.id, cambios)
      if (!r.ok) {
        toast.error(r.error)
        return
      }
      if (aviso) toast.success(aviso)
      alGuardar()
    })
  }

  const campoTexto = (
    etiqueta: string,
    clave: 'proveedor_nombre' | 'localizador',
    valor: string | null,
    placeholder?: string,
  ) => (
    <label className="block space-y-1">
      <span className="text-xs font-medium">{etiqueta}</span>
      <input
        type="text"
        defaultValue={valor ?? ''}
        placeholder={placeholder}
        disabled={!puedeEditar || isPending}
        onBlur={e => {
          const nuevo = e.target.value.trim()
          if (nuevo !== (valor ?? '')) guardar({ [clave]: nuevo })
        }}
        className="h-11 w-full rounded-md border px-2 text-sm disabled:bg-muted"
      />
    </label>
  )

  return (
    <div className="space-y-3 border-t p-2.5">
      <p className="text-xs font-semibold">1 Reserva</p>
      {campoTexto('Proveedor', 'proveedor_nombre', s.proveedor_nombre, '¿Con quién lo reservaste?')}
      {campoTexto('Localizador', 'localizador', s.localizador)}
      <label className="block space-y-1">
        <span className="text-xs font-medium">Fecha límite de pago</span>
        <input
          type="date"
          defaultValue={s.fecha_limite_pago ?? ''}
          disabled={!puedeEditar || isPending}
          onBlur={e => {
            if (e.target.value !== (s.fecha_limite_pago ?? '')) guardar({ fecha_limite_pago: e.target.value })
          }}
          className="h-11 w-full rounded-md border px-2 text-sm disabled:bg-muted"
        />
      </label>

      <p className="text-xs font-semibold">2 Pago</p>
      <p className="text-xs text-muted-foreground">
        Por pagar {formatCOP(v.aPagar)} · Pagado {formatCOP(v.pagado)}. El pago con su soporte se registra aquí cuando se active el registro de pagos a proveedores.
      </p>

      <p className="text-xs font-semibold">3 Confirmación del proveedor final</p>
      <Adjunto servicioId={s.id} campo="confirmacion" referencia={s.confirmacion_ref} habilitado={puedeEditar} alGuardar={alGuardar} />

      <p className="text-xs font-semibold">4 Voucher</p>
      <Adjunto servicioId={s.id} campo="voucher" referencia={s.voucher_ref} habilitado={puedeVoucher} alGuardar={alGuardar} />

      {puedeEditar && (
        <div className="flex flex-wrap gap-2 pt-1">
          {s.estado === 'por_reservar' && (
            <button type="button" disabled={isPending} onClick={() => guardar({ estado: 'reservado' }, 'Marcado como reservado.')}
              className="min-h-11 rounded-md bg-primary px-3 text-sm font-medium text-primary-foreground disabled:opacity-60">
              Marcar como reservado
            </button>
          )}
          {s.estado !== 'cancelado' ? (
            <button type="button" disabled={isPending} onClick={() => guardar({ estado: 'cancelado' }, 'Sacado del viaje.')}
              className="min-h-11 rounded-md border px-3 text-sm disabled:opacity-60">
              Sacar del viaje
            </button>
          ) : (
            <button type="button" disabled={isPending} onClick={() => guardar({ estado: 'por_reservar' }, 'Volvió al viaje.')}
              className="min-h-11 rounded-md border px-3 text-sm disabled:opacity-60">
              Volver al viaje
            </button>
          )}
        </div>
      )}
    </div>
  )
}

/** Pegar, tomar foto o subir: el archivo queda en Storage (`one://`), nunca como link pegado. */
function Adjunto({
  servicioId,
  campo,
  referencia,
  habilitado,
  alGuardar,
}: {
  servicioId: string
  campo: 'voucher' | 'confirmacion'
  referencia: string | null
  habilitado: boolean
  alGuardar: () => void
}) {
  const archivoRef = useRef<HTMLInputElement>(null)
  const camaraRef = useRef<HTMLInputElement>(null)
  const [isPending, startTransition] = useTransitionTolerante()
  const nombre = campo === 'voucher' ? 'voucher' : 'confirmación'
  const href = hrefArchivo(referencia)

  function subir(file: File | null | undefined) {
    if (!file) return
    const fd = new FormData()
    fd.set('servicioId', servicioId)
    fd.set('campo', campo)
    fd.set('file', file)
    startTransition(async () => {
      const r = await adjuntarArchivoServicio(fd)
      if (!r.ok) {
        toast.error(r.error)
        return
      }
      toast.success(campo === 'voucher' ? 'Voucher guardado.' : 'Confirmación guardada.')
      alGuardar()
    })
  }

  return (
    <div className="space-y-2">
      {href ? (
        <a href={href} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-xs text-primary underline">
          <Check className="h-3.5 w-3.5" /> Ver {nombre}
        </a>
      ) : (
        <p className="text-xs text-muted-foreground">Sin {nombre} todavía.</p>
      )}
      {habilitado && (
        <div
          className="flex flex-wrap gap-2"
          onPaste={e => {
            const file = Array.from(e.clipboardData.files)[0]
            if (file) {
              e.preventDefault()
              subir(file)
            }
          }}
        >
          <button type="button" disabled={isPending} className="inline-flex min-h-11 items-center gap-1 rounded-md border px-3 text-xs disabled:opacity-60"
            title={`Pega aquí el ${nombre} (Ctrl+V)`}>
            <Paperclip className="h-3.5 w-3.5" /> {isPending ? 'Guardando…' : `Pegar ${nombre}`}
          </button>
          <button type="button" disabled={isPending} onClick={() => camaraRef.current?.click()}
            className="inline-flex min-h-11 items-center gap-1 rounded-md border px-3 text-xs disabled:opacity-60">
            <Camera className="h-3.5 w-3.5" /> Tomar foto
          </button>
          <button type="button" disabled={isPending} onClick={() => archivoRef.current?.click()}
            className="inline-flex min-h-11 items-center gap-1 rounded-md border px-3 text-xs disabled:opacity-60">
            <FileText className="h-3.5 w-3.5" /> Subir archivo
          </button>
          <input ref={camaraRef} type="file" accept="image/*" capture="environment" className="hidden"
            onChange={e => { subir(e.target.files?.[0]); e.target.value = '' }} />
          <input ref={archivoRef} type="file" accept="image/*,application/pdf" className="hidden"
            onChange={e => { subir(e.target.files?.[0]); e.target.value = '' }} />
        </div>
      )}
    </div>
  )
}
