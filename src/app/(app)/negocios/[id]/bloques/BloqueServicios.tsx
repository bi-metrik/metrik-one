'use client'

import { diferenciaDeCambio, diferenciaDeCambioDelServicio, montoEnMoneda, tasaPagoValida, textoDiferenciaDeCambio, textoPagoEnMoneda } from '@/lib/viaje/moneda-servicio'
import { tasaComoTexto } from '@/lib/cotizaciones/tasa-cotizacion'
import { parseMontoCop } from '@/lib/negocios/monto-cop'
import { useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { Camera, Check, ChevronDown, FileText, Paperclip } from 'lucide-react'
import { useTransitionTolerante } from '@/hooks/use-transition-tolerante'
import { useIntencion } from '@/hooks/use-intencion'
import { formatCOP } from '@/lib/cobros/format'
import { todayBogotaISO } from '@/lib/dates/bogota'
import { hrefArchivo } from '@/lib/almacenamiento/referencia'
import {
  ETIQUETA_ESTADO,
  esDireccion,
  puedeAdjuntarVoucher,
  puedeEditarServicios,
  puedeTraerServicios,
  viajeParaReglas,
  type EstadoServicio,
} from '@/lib/viaje/estado-servicio'
import {
  ETIQUETA_FILTRO,
  colorDeLaEtapa,
  fechaLimiteEnPalabras,
  filasVista,
  filtrarTablero,
  porcentajePersonal,
  resumenDelTablero,
  sigueDelTablero,
  pildorasDeHitos,
  type ColorPildora,
  totalesDelTablero,
  type DatosBloqueServicios,
  type FilaVista,
  type FiltroTablero,
} from '@/lib/viaje/bloque-servicios'
import {
  baseDesviacion,
  configReglasPago,
  desviacion,
  desviacionDelViaje,
  reglasQueRompe,
  reglasSinAprobar,
  totalTrasPago,
  type AprobacionLeida,
  type MedioPagoProveedor,
} from '@/lib/viaje/reglas-pago'
import { confirmacionFueraDeLoPactado } from '@/lib/viaje/pago-fuera-de-lo-pactado'
import { confirmacionCambioLocalizador, confirmacionSacarDelViaje } from '@/lib/viaje/sacar-del-viaje'
import {
  actualizarServicio,
  adjuntarArchivoServicio,
  decidirAprobacionServicio,
  pedirAprobacionServicio,
  registrarPagoServicio,
  subirSoporteServicio,
  traerServiciosDeCotizacion,
  type CambiosServicio,
} from '../../servicios-viaje-actions'
import FechasServicio, { LineaDeFechas } from './FechasServicio'
import { claseDeServicio, etiquetaTipoServicio } from '@/lib/viaje/etiqueta-servicio'

/**
 * Bloque «Servicios del viaje»: el tablero de Reservas y pagos (F0 + F3). Una fila por servicio
 * de la tarifa aceptada, en el orden del viaje. Aquí se reserva, se paga al proveedor con su
 * soporte (medio y titular), se pide y se da la aprobación de Edgar, y se adjuntan el voucher y la
 * confirmación del proveedor final como archivo.
 *
 * Los datos los resuelve el servidor y viajan en `config_extra._servicios` (no por props).
 * El estado «Pagado», «Confirmado» y «Esperando a Edgar» sale de la plata (Vera C6). Las reglas
 * del pago son las mismas del servidor y del bot (`lib/viaje/reglas-pago.ts`): aquí solo se
 * anticipan para escoger el botón; quien decide es el servidor.
 *
 * Celular: tarjetas apiladas; un toque abre la fila debajo, con botones de 44 px.
 */

const COLOR_TIPO: Record<string, string> = {
  vuelo: 'border-l-sky-500',
  hotel: 'border-l-violet-500',
  traslado: 'border-l-amber-500',
  tren: 'border-l-amber-500',
  actividad: 'border-l-emerald-500',
  asistencia: 'border-l-rose-500',
  otro: 'border-l-gray-400',
  paquete: 'border-l-teal-500',
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
const PUNTO_ETAPA = { verde: 'bg-green-500', ambar: 'bg-amber-500', rojo: 'bg-red-500', gris: 'bg-muted-foreground/40' } as const
const FILTROS: FiltroTablero[] = ['todos', 'por_pagar', 'esperando', 'falta_confirmar']
/** Píldoras de hito (Noor §3.2): el color nunca va solo, el texto dice el estado. */
const COLOR_PILDORA_HITO: Record<ColorPildora, string> = {
  gris: 'border-border bg-muted text-muted-foreground',
  ambar: 'border-amber-300 bg-amber-50 text-amber-800',
  rojo: 'border-red-300 bg-red-50 text-red-700',
  verde: 'border-green-300 bg-green-50 text-green-800',
}

interface BloqueServiciosProps {
  negocioId: string
  modo: 'editable' | 'visible'
  datos: DatosBloqueServicios | null | undefined
  esResponsable: boolean
  /** Fila abierta al montar (las pruebas de pantalla y el enlace desde el gate). */
  abiertaInicial?: string | null
}

export default function BloqueServicios({ negocioId, modo, datos, esResponsable, abiertaInicial = null }: BloqueServiciosProps) {
  const router = useRouter()
  const [abierta, setAbierta] = useState<string | null>(abiertaInicial)
  const [filtro, setFiltro] = useState<FiltroTablero>('todos')
  const [isPending, startTransition] = useTransitionTolerante()

  if (!datos) {
    return <p className="text-xs text-muted-foreground">Los servicios del viaje se ven en la etapa donde se trabajan.</p>
  }

  const quien = { ...datos.quien, esResponsable }
  const editable = modo === 'editable' && datos.activo
  const puedeEditar = editable && puedeEditarServicios(quien)
  const puedeVoucher = editable && puedeAdjuntarVoucher(quien)
  const direccion = editable && esDireccion(quien)
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
  const personal = porcentajePersonal(vista)
  // El punto y el «Sigue:» con la regla del gate `servicios_listos` (barrido 2026-10-22).
  const exige = datos.reglas?.exigeConfirmacion ?? true
  const sigue = sigueDelTablero(vista, hoy, datos.hitos ?? [], exige)
  const color = colorDeLaEtapa(vista, hoy, exige)
  const visibles = filtrarTablero(vista, filtro)
  return (
    <div className="space-y-3">
      <p className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
        <span className={`inline-block h-2 w-2 shrink-0 rounded-full ${PUNTO_ETAPA[color]}`} aria-hidden />
        {resumenDelTablero(vista, hoy)}
      </p>
      {sigue && (
        <button
          type="button"
          onClick={() => { setFiltro('todos'); setAbierta(sigue.servicioId) }}
          className="block min-h-11 w-full rounded-md bg-muted/60 px-3 py-2 text-left text-sm"
        >
          <span className="font-medium">Sigue:</span> {sigue.texto} <span className="text-primary underline">Abrir</span>
        </button>
      )}
      <div className="flex flex-wrap gap-1.5" role="group" aria-label="Filtrar servicios">
        {FILTROS.map(f => (
          <button
            key={f}
            type="button"
            onClick={() => setFiltro(f)}
            aria-pressed={filtro === f}
            className={`min-h-11 rounded-full border px-3 text-xs ${filtro === f ? 'border-primary bg-primary/10 font-medium text-primary' : 'text-muted-foreground'}`}
          >
            {ETIQUETA_FILTRO[f]}
          </button>
        ))}
      </div>
      <ul className="space-y-2">
        {visibles.map(v => (
          <FilaServicio
            key={v.servicio.id}
            v={v}
            hoy={hoy}
            datos={datos}
            abierta={abierta === v.servicio.id}
            alternar={() => setAbierta(a => (a === v.servicio.id ? null : v.servicio.id))}
            puedeEditar={puedeEditar}
            puedeVoucher={puedeVoucher}
            direccion={direccion}
            alGuardar={() => router.refresh()}
          />
        ))}
        {visibles.length === 0 && <li className="text-xs text-muted-foreground">Ningún servicio en este filtro.</li>}
      </ul>
      <div className="flex flex-wrap justify-between gap-2 border-t pt-2 text-xs">
        <span className="text-muted-foreground">Cotizado {formatCOP(totales.cotizado)}</span>
        <span className="font-medium">Costo real hasta hoy {formatCOP(totales.pagado)}</span>
        <span className="w-full text-muted-foreground sm:w-auto">Pagado con tarjetas personales: {personal.toLocaleString('es-CO')} %</span>
      </div>
      {!datos.activo && (
        <p className="text-[11px] text-muted-foreground">Los servicios del viaje están apagados en esta línea: se ven, no se editan.</p>
      )}
    </div>
  )
}

/** ¿Este pago pediría a Edgar? Lo mismo que decide el servidor (`reglas-pago`). */
function pideAEdgar(v: FilaVista, datos: DatosBloqueServicios, monto: number, medio: MedioPagoProveedor | null, diferenciaCambio = 0): string[] {
  if (!medio || !(monto > 0)) return []
  const rotas = reglasQueRompe({
    monto,
    pagadoAntes: v.pagado,
    costoCotizado: v.servicio.costo_cotizado,
    valorPorPagar: v.servicio.valor_por_pagar,
    viaje: viajeParaReglas(datos.filas, v.servicio.id),
    diferenciaCambio,
    medio,
    cobradoCliente: datos.cobradoCliente ?? 0,
    precioAprobado: datos.precioAprobado ?? 0,
    config: datos.reglas ?? configReglasPago(null),
  })
  const aprob: AprobacionLeida[] = v.servicio.aprobaciones
    .filter(a => a.id && a.tipo && a.huella)
    .map(a => ({ id: a.id!, tipo: a.tipo!, estado: a.estado, huella: a.huella! }))
  return reglasSinAprobar(rotas, aprob).map(r => r.texto)
}

function FilaServicio({
  v,
  hoy,
  datos,
  abierta,
  alternar,
  puedeEditar,
  puedeVoucher,
  direccion,
  alGuardar,
}: {
  v: FilaVista
  hoy: string
  datos: DatosBloqueServicios
  abierta: boolean
  alternar: () => void
  puedeEditar: boolean
  puedeVoucher: boolean
  direccion: boolean
  alGuardar: () => void
}) {
  const s = v.servicio
  const fecha = fechaLimiteEnPalabras(s.fecha_limite_pago, v.estado, hoy)
  const detalle = [s.proveedor_nombre ?? 'Falta el proveedor', s.localizador ? `loc. ${s.localizador}` : null]
    .filter(Boolean)
    .join(' · ')
  // H6-3 · lo que movió la TRM no es sobrecosto del proveedor: se dice aparte.
  const cambio = diferenciaDeCambioDelServicio(s.moneda, s.gastos)
  const d = desviacion(v.pagado, Math.max(0, s.costo_cotizado + cambio.pesos))
  const umbral = (datos.reglas ?? configReglasPago(null)).umbralPct
  const pctTexto = Number.isFinite(d.pct) ? ` +${(Math.round(d.pct * 10) / 10).toLocaleString('es-CO')} %` : ''
  // M3-4: lo que el proveedor cobró de menos queda a la vista (no se «pierde» en lo cotizado).
  const aFavor = s.valor_por_pagar !== null && s.valor_por_pagar < s.costo_cotizado ? s.costo_cotizado - s.valor_por_pagar : 0
  return (
    <li className={`rounded-md border border-l-4 ${COLOR_TIPO[claseDeServicio(s)] ?? COLOR_TIPO.otro} bg-card`}>
      <button
        type="button"
        onClick={alternar}
        aria-expanded={abierta}
        className="flex w-full min-h-11 items-start gap-2 p-2.5 text-left"
      >
        <div className="min-w-0 flex-1 space-y-0.5">
          <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">{etiquetaTipoServicio(s)}</p>
          <p className={`break-words text-sm font-medium ${v.estado === 'cancelado' ? 'line-through text-muted-foreground' : ''}`}>{s.nombre}</p>
          <p className="break-words text-xs text-muted-foreground">{detalle}</p>
          <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-xs">
            {v.estado !== 'cancelado' && <LineaDeFechas s={s} />}
            {fecha && <span className={COLOR_FECHA[fecha.color]}>{fecha.texto}</span>}
            <span className="tabular-nums text-muted-foreground">
              Cotizado {formatCOP(s.costo_cotizado)}{s.moneda ? ` (${montoEnMoneda(s.moneda.monto, s.moneda.moneda)} a ${tasaComoTexto(s.moneda.tasa)})` : ''} · Pagado {formatCOP(v.pagado)}
              {s.moneda && cambio.pesos !== 0 && (
                <span className="text-muted-foreground"> · {cambio.pesos > 0 ? '+' : '−'}{formatCOP(Math.abs(cambio.pesos))} de {textoDiferenciaDeCambio(s.moneda, cambio.tasas)}</span>
              )}
              {d.pesos > 0 && (
                <span className={d.pct > umbral ? 'text-red-600' : 'text-amber-600'}> +{formatCOP(d.pesos)}{pctTexto}</span>
              )}
              {aFavor > 0 && (
                <span className="text-green-700"> · Cobró {formatCOP(v.aPagar)}: {formatCOP(aFavor)} a favor</span>
              )}
            </span>
          </div>
          <p className="text-[11px] text-muted-foreground">
            {s.gastos.some(g => g.soporte_url) ? '◉' : '○'} soporte · {s.voucher_ref ? '◉' : '○'} voucher · {s.confirmacion_ref ? '◉' : '○'} confirmado
          </p>
          {datos.hitos && datos.hitos.length > 0 && v.estado !== 'cancelado' && (
            <span className="flex flex-wrap gap-1" data-pildoras-hito>
              {pildorasDeHitos(datos.hitos, s.id, hoy, datos.nombres ?? {}).map(p => (
                <span key={p.clave} title={p.detalle} className={`rounded-full border px-2 py-0.5 text-[11px] ${COLOR_PILDORA_HITO[p.color]}`} data-color={p.color}>
                  {p.texto}
                </span>
              ))}
            </span>
          )}
        </div>
        <span className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium ${PILDORA[v.estado]}`}>{ETIQUETA_ESTADO[v.estado]}</span>
        <ChevronDown className={`mt-0.5 h-4 w-4 shrink-0 text-muted-foreground transition-transform ${abierta ? 'rotate-180' : ''}`} />
      </button>
      {abierta && (
        <HojaServicio v={v} datos={datos} puedeEditar={puedeEditar} puedeVoucher={puedeVoucher} direccion={direccion} alGuardar={alGuardar} />
      )}
    </li>
  )
}

function HojaServicio({
  v,
  datos,
  puedeEditar,
  puedeVoucher,
  direccion,
  alGuardar,
}: {
  v: FilaVista
  datos: DatosBloqueServicios
  puedeEditar: boolean
  puedeVoucher: boolean
  direccion: boolean
  alGuardar: () => void
}) {
  const s = v.servicio
  const [isPending, startTransition] = useTransitionTolerante()

  /**
   * Guarda al salir del campo (o al tocar el botón) y ofrece «Deshacer» 8 s (Noor §6, Vera F3-9):
   * deshacer vuelve a escribir lo que había, por la misma acción del servidor y con sus permisos.
   */
  function guardar(cambios: CambiosServicio, anterior: CambiosServicio, aviso = 'Guardado.') {
    startTransition(async () => {
      const r = await actualizarServicio(s.id, cambios)
      if (!r.ok) {
        toast.error(r.error)
        return
      }
      alGuardar()
      toast.success(aviso, {
        duration: 8000,
        action: {
          label: 'Deshacer',
          onClick: () => {
            void actualizarServicio(s.id, anterior).then((d) => {
              if (d.ok) toast.message('Deshecho.')
              else toast.error(d.error)
              alGuardar()
            })
          },
        },
      })
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
        // Con la llave atada al valor guardado, deshacer o un cambio de otra persona repinta el campo.
        key={`${clave}:${valor ?? ''}`}
        type="text"
        defaultValue={valor ?? ''}
        placeholder={placeholder}
        // Sin `isPending`: deshabilitar el campo con el foco dentro lo saca del foco y lo que se
        // escribe después cae en otro campo (QA 2026-10-29, N1-1).
        disabled={!puedeEditar}
        onBlur={e => {
          const nuevo = e.target.value.trim()
          if (nuevo === (valor ?? '')) return
          // H9-4: un localizador ya guardado no se pisa sin decirlo.
          const seguro = clave === 'localizador' ? confirmacionCambioLocalizador(valor, nuevo) : null
          if (seguro && !window.confirm(seguro)) {
            e.target.value = valor ?? ''
            return
          }
          guardar({ [clave]: nuevo }, { [clave]: valor ?? '' }, `${etiqueta}: guardado.`)
        }}
        className="h-11 w-full rounded-md border px-2 text-sm disabled:bg-muted"
      />
    </label>
  )

  const pasos: Array<{ id: EstadoServicio; texto: string }> = [
    { id: 'por_reservar', texto: 'Por reservar' },
    { id: 'reservado', texto: 'Reservado' },
    { id: 'pagado', texto: 'Pagado' },
    { id: 'confirmado', texto: 'Confirmado' },
  ]
  const pasoActual = v.estado === 'esperando' || v.estado === 'no_aprobado' ? 'reservado' : v.estado

  return (
    <div className="space-y-3 border-t p-2.5">
      <p className="text-[11px] text-muted-foreground">
        {pasos.map((p, i) => (
          <span key={p.id}>
            {i > 0 && ' · '}
            <span className={p.id === pasoActual ? 'font-semibold text-foreground' : ''}>{p.texto}</span>
          </span>
        ))}
      </p>

      <Aprobaciones v={v} datos={datos} direccion={direccion} alGuardar={alGuardar} />

      <FechasServicio key={`fechas:${s.fechas_corregidas_at ?? ''}:${s.fecha_servicio ?? ''}:${s.fecha_fin ?? ''}`} s={s} puedeEditar={puedeEditar} nombres={datos.nombres} alGuardar={alGuardar} />

      <p className="text-xs font-semibold">1 Reserva</p>
      {campoTexto('Proveedor', 'proveedor_nombre', s.proveedor_nombre, '¿Con quién lo reservaste?')}
      {campoTexto('Localizador', 'localizador', s.localizador)}
      <label className="block space-y-1">
        <span className="text-xs font-medium">Fecha límite de pago</span>
        <input
          key={`limite:${s.fecha_limite_pago ?? ''}`}
          type="date"
          defaultValue={s.fecha_limite_pago ?? ''}
          // Sin `isPending`: si otro campo guardaba mientras se escribía la fecha, el campo se
          // deshabilitaba sin «blur» y la fecha no se guardaba (QA 2026-10-29, M1-2).
          disabled={!puedeEditar}
          onBlur={e => {
            if (e.target.value !== (s.fecha_limite_pago ?? '')) {
              guardar({ fecha_limite_pago: e.target.value }, { fecha_limite_pago: s.fecha_limite_pago ?? '' }, 'Fecha límite: guardada.')
            }
          }}
          className="h-11 w-full rounded-md border px-2 text-sm disabled:bg-muted"
        />
      </label>

      <p className="text-xs font-semibold">2 Pago</p>
      <PagosHechos
        v={v}
        medios={datos.medios ?? []}
        // M3-4: el proveedor cobró menos de lo cotizado. Se dice con un toque, sin inventar un pago.
        alCobrarMenos={puedeEditar && v.estado !== 'cancelado' && v.estado !== 'esperando'
          ? () => guardar({ valor_por_pagar: v.pagado }, { valor_por_pagar: s.valor_por_pagar }, `${s.proveedor_nombre?.trim() || 'El proveedor'} cobró ${formatCOP(v.pagado)}: ${formatCOP(s.costo_cotizado - v.pagado)} a favor.`)
          : null}
      />
      {puedeEditar && v.estado !== 'cancelado' && (
        <label className="block space-y-1">
          <span className="text-xs font-medium">Lo que cobra el proveedor</span>
          <input
            key={`cobra:${s.valor_por_pagar ?? ''}`}
            type="text"
            inputMode="numeric"
            defaultValue={s.valor_por_pagar ?? ''}
            placeholder={`Lo cotizado: ${formatCOP(s.costo_cotizado)}`}
            onBlur={e => {
              const limpio = e.target.value.replace(/[^\d]/g, '')
              const nuevo = limpio === '' ? null : Number(limpio)
              if (nuevo !== (s.valor_por_pagar ?? null)) {
                guardar({ valor_por_pagar: nuevo }, { valor_por_pagar: s.valor_por_pagar }, nuevo === null ? 'Vuelve a lo cotizado.' : 'Lo que cobra el proveedor: guardado.')
              }
            }}
            className="h-11 w-full rounded-md border px-2 text-sm tabular-nums"
          />
          <span className="block text-[11px] text-muted-foreground">Solo si cobra menos de lo cotizado. Vacío = lo cotizado.</span>
        </label>
      )}
      {v.estado !== 'cancelado' && v.estado !== 'confirmado' && v.estado !== 'pagado' && v.estado !== 'esperando' && (
        puedeEditar
          // La llave con lo pagado: tras un pago el valor sugerido es lo que falta, no el pago anterior (M3-4).
          ? <FormularioPago key={`pago:${v.pagado}:${v.aPagar}`} v={v} datos={datos} alGuardar={alGuardar} />
          : <p className="text-xs text-muted-foreground">Por pagar {formatCOP(Math.max(0, v.aPagar - v.pagado))}.</p>
      )}
      {v.estado === 'esperando' && (
        <p className="text-xs text-purple-700">Esperando a Edgar: el pago no cuenta hasta que lo apruebe.</p>
      )}

      <p className="text-xs font-semibold">3 Confirmación del proveedor final</p>
      <Adjunto servicioId={s.id} campo="confirmacion" referencia={s.confirmacion_ref} habilitado={puedeEditar} alGuardar={alGuardar} />

      <p className="text-xs font-semibold">4 Voucher</p>
      <Adjunto servicioId={s.id} campo="voucher" referencia={s.voucher_ref} habilitado={puedeVoucher} alGuardar={alGuardar} />

      {puedeEditar && (
        <div className="flex flex-wrap gap-2 pt-1">
          {s.estado === 'por_reservar' && v.estado === 'por_reservar' && (
            <button type="button" disabled={isPending} onClick={() => guardar({ estado: 'reservado' }, { estado: s.estado }, 'Marcado como reservado.')}
              className="min-h-11 rounded-md bg-primary px-3 text-sm font-medium text-primary-foreground disabled:opacity-60">
              Marcar como reservado
            </button>
          )}
          {s.estado !== 'cancelado' ? (
            <button type="button" disabled={isPending} onClick={() => {
              // N9-9 / H9-3: se confirma, con lo que pasa con la plata del servicio.
              if (!window.confirm(confirmacionSacarDelViaje({ nombre: s.nombre, costoCotizado: s.costo_cotizado, pagadoProveedor: v.pagado }))) return
              guardar({ estado: 'cancelado' }, { estado: s.estado }, 'Sacado del viaje.')
            }}
              className="min-h-11 rounded-md px-3 text-xs text-muted-foreground underline disabled:opacity-60">
              Sacar del viaje
            </button>
          ) : (
            <button type="button" disabled={isPending} onClick={() => guardar({ estado: 'por_reservar' }, { estado: 'cancelado' }, 'Volvió al viaje.')}
              className="min-h-11 rounded-md border px-3 text-sm disabled:opacity-60">
              Volver al viaje
            </button>
          )}
        </div>
      )}
    </div>
  )
}

/** Los pagos ya registrados de la fila, cada uno con su medio y su soporte. */
function PagosHechos({ v, medios, alCobrarMenos }: { v: FilaVista; medios: readonly MedioPagoProveedor[]; alCobrarMenos: (() => void) | null }) {
  const gastos = v.servicio.gastos
  if (gastos.length === 0) {
    return <p className="text-xs text-muted-foreground">Por pagar {formatCOP(v.aPagar)}. Todavía no hay pagos.</p>
  }
  return (
    <ul className="space-y-1 text-xs">
      {gastos.map((g, i) => {
        const medio = medios.find(m => m.id === g.medio_pago)
        const href = hrefArchivo(g.soporte_url)
        return (
          <li key={g.id ?? i} className="flex flex-wrap items-center gap-x-2">
            <span className="tabular-nums font-medium">{formatCOP(g.monto)}</span>
            {g.fecha && <span className="text-muted-foreground">{g.fecha}</span>}
            <span className="text-muted-foreground">
              {medio?.label ?? (g.medio_pago ? g.medio_pago : 'Falta el medio')}
              {g.titular_medio ? ` · ${g.titular_medio === 'personal' ? 'Personal' : 'Empresa'}` : ''}
            </span>
            {href
              ? <a href={href} target="_blank" rel="noopener noreferrer" className="text-primary underline">Ver soporte</a>
              : <span className="text-amber-600">Falta el soporte</span>}
          </li>
        )
      })}
      {v.aPagar - v.pagado > 0 && (
        <li className="space-y-1 text-muted-foreground">
          <span className="block">Falta pagar {formatCOP(v.aPagar - v.pagado)}.</span>
          {alCobrarMenos && (
            <button type="button" onClick={alCobrarMenos}
              className="min-h-11 rounded-md border px-3 text-xs text-foreground">
              El proveedor cobró {formatCOP(v.pagado)}: no falta nada
            </button>
          )}
        </li>
      )}
    </ul>
  )
}

/**
 * Valor, medio (el titular sale de él), fecha y soporte. Pegar el soporte NO registra el pago:
 * cuenta cuando se toca «Registrar pago» (Noor §3.3). Si el pago rompe una regla sin aprobación,
 * el botón es «Pedir a Edgar» (antes de pagar) y abajo queda «El pago ya salió: registrarlo»
 * (Vera C5: los dos caminos existen y se distinguen).
 */
function FormularioPago({ v, datos, alGuardar }: { v: FilaVista; datos: DatosBloqueServicios; alGuardar: () => void }) {
  const medios = datos.medios ?? []
  const falta = Math.max(0, v.aPagar - v.pagado)
  const [montoTexto, setMontoTexto] = useState(falta > 0 ? String(Math.round(falta)) : '')
  const [trmTexto, setTrmTexto] = useState('')
  const [medioId, setMedioId] = useState(medios.length === 1 ? medios[0].id : '')
  const [fecha, setFecha] = useState(todayBogotaISO())
  const [soporte, setSoporte] = useState<string | null>(null)
  const [isPending, startTransition] = useTransitionTolerante()
  const intencion = useIntencion()
  const archivoRef = useRef<HTMLInputElement>(null)
  const camaraRef = useRef<HTMLInputElement>(null)

  if (medios.length === 0) {
    return <p className="text-xs text-amber-700">Falta configurar los medios de pago a proveedores de la agencia. Pídeselo a MéTRIK.</p>
  }

  const monto = Math.round(Number(montoTexto.replace(/[^\d]/g, '')) || 0)
  const medio = medios.find(m => m.id === medioId) ?? null
  // H6-3 · servicio cotizado en otra moneda: la TRM del pago separa la diferencia de cambio.
  const enMoneda = v.servicio.moneda ?? null
  const tasaPago = parseMontoCop(trmTexto)
  const tasaPagoOk = !!enMoneda && tasaPagoValida(tasaPago, enMoneda.tasa)
  const cambioPrevio = diferenciaDeCambioDelServicio(enMoneda, v.servicio.gastos).pesos
  const cambioTotal = cambioPrevio + (enMoneda && tasaPagoOk ? diferenciaDeCambio(monto, enMoneda.tasa, tasaPago as number) : 0)
  const motivos = pideAEdgar(v, datos, monto, medio, cambioTotal)
  const total = totalTrasPago({ monto, pagadoAntes: v.pagado })
  const base = baseDesviacion(v.servicio.costo_cotizado, v.servicio.valor_por_pagar)
  const d = desviacion(total, Math.max(0, base + cambioTotal))
  const sobreViaje = desviacionDelViaje(total, { costoCotizado: v.servicio.costo_cotizado, valorPorPagar: v.servicio.valor_por_pagar }, viajeParaReglas(datos.filas, v.servicio.id))
  const listo = monto > 0 && !!medio && !!soporte

  function subir(file: File | null | undefined) {
    if (!file) return
    const fd = new FormData()
    fd.set('servicioId', v.servicio.id)
    fd.set('file', file)
    startTransition(async () => {
      const r = await subirSoporteServicio(fd)
      if (!r.ok) {
        toast.error(r.error)
        return
      }
      setSoporte(r.referencia)
      toast.success('Soporte listo. Revisa el valor y toca «Registrar pago».')
    })
  }

  function registrar() {
    if (!listo || !medio || !soporte) return
    // Fuera de lo pactado (Mauricio 2026-10-29): se pregunta en pantalla antes de registrar.
    const fuera = confirmacionFueraDeLoPactado({
      monto,
      pagadoAntesServicio: v.pagado,
      costoCotizado: v.servicio.costo_cotizado,
      pagadoProveedores: totalesDelTablero(filasVista(datos.filas)).pagado,
      cobradoCliente: datos.cobradoCliente ?? 0,
    })
    if (fuera && !window.confirm(fuera)) return
    startTransition(async () => {
      const r = await registrarPagoServicio({ servicioId: v.servicio.id, monto, fecha, medioId: medio.id, soporteRef: soporte, tasaPago: tasaPagoOk ? tasaPago : null }, intencion.clave())
      intencion.cerrar()
      if (!r.ok) {
        toast.error(r.error)
        return
      }
      if (r.esperando.length > 0) toast.success(`Pago registrado. Quedó esperando a Edgar: ${r.esperando.join(' ')}`)
      else toast.success('Pago registrado.')
      setSoporte(null)
      alGuardar()
    })
  }

  function pedir() {
    if (!medio || !(monto > 0)) return
    startTransition(async () => {
      const r = await pedirAprobacionServicio({ servicioId: v.servicio.id, monto, medioId: medio.id, tasaPago: tasaPagoOk ? tasaPago : null }, intencion.clave())
      intencion.cerrar()
      if (!r.ok) {
        toast.error(r.error)
        return
      }
      toast.success('Le pedimos a Edgar que lo apruebe. Te avisamos cuando decida.')
      alGuardar()
    })
  }

  return (
    <div className="space-y-2 rounded-md border bg-muted/30 p-2">
      {enMoneda && (
        <div className="space-y-1" data-pago-en-moneda>
          <p className="text-xs text-muted-foreground">{textoPagoEnMoneda(enMoneda)}</p>
          <label className="block space-y-1">
            <span className="text-xs font-medium">TRM del pago ({enMoneda.moneda} → COP)</span>
            <input
              type="text"
              inputMode="decimal"
              value={trmTexto}
              placeholder={`ej. ${tasaComoTexto(enMoneda.tasa)}`}
              onChange={e => {
                setTrmTexto(e.target.value)
                // Con la TRM, el valor en pesos de lo que falta pagar en la moneda (editable).
                const t = parseMontoCop(e.target.value)
                if (falta > 0 && tasaPagoValida(t, enMoneda.tasa)) setMontoTexto(String(Math.round((falta / enMoneda.tasa) * (t as number))))
              }}
              disabled={isPending}
              className="h-11 w-full rounded-md border px-2 text-sm tabular-nums sm:w-48"
            />
          </label>
          {trmTexto.trim() !== '' && !tasaPagoOk && (
            <p className="text-xs text-amber-700">Esa TRM está muy lejos de la cotizada ({tasaComoTexto(enMoneda.tasa)}): revísala.</p>
          )}
        </div>
      )}
      <div className="grid gap-2 sm:grid-cols-2">
        <label className="block space-y-1">
          <span className="text-xs font-medium">Valor pagado</span>
          <input
            type="text"
            inputMode="numeric"
            value={montoTexto}
            onChange={e => setMontoTexto(e.target.value)}
            disabled={isPending}
            className="h-11 w-full rounded-md border px-2 text-sm tabular-nums"
          />
        </label>
        <label className="block space-y-1">
          <span className="text-xs font-medium">Fecha del pago</span>
          <input type="date" value={fecha} max={todayBogotaISO()} onChange={e => setFecha(e.target.value)} disabled={isPending}
            className="h-11 w-full rounded-md border px-2 text-sm" />
        </label>
      </div>
      <label className="block space-y-1">
        <span className="text-xs font-medium">Medio de pago</span>
        <select value={medioId} onChange={e => setMedioId(e.target.value)} disabled={isPending} className="h-11 w-full rounded-md border bg-background px-2 text-sm">
          <option value="">Elige con qué se pagó</option>
          {medios.map(m => <option key={m.id} value={m.id}>{m.label}</option>)}
        </select>
      </label>
      {medio && <p className="text-xs text-muted-foreground">Titular: {medio.titular === 'personal' ? 'Personal' : 'Empresa'}</p>}
      {enMoneda && cambioTotal !== 0 && monto > 0 && (
        <p className="text-xs text-muted-foreground">
          {cambioTotal > 0 ? '+' : '−'}{formatCOP(Math.abs(cambioTotal))} de diferencia de cambio: no es sobrecosto del proveedor.
        </p>
      )}
      {d.pesos > 0 && monto > 0 && (
        <p className={`text-xs ${motivos.length > 0 ? 'text-red-600' : 'text-amber-600'}`}>
          +{formatCOP(d.pesos)} sobre {base < v.servicio.costo_cotizado ? 'lo que cobra el proveedor' : 'lo cotizado'}{Number.isFinite(d.pct) ? ` (+${(Math.round(d.pct * 10) / 10).toLocaleString('es-CO')} %)` : ''}
          {sobreViaje === 0 ? '. El viaje entero no se pasa de lo cotizado.' : ''}
        </p>
      )}

      <div
        className="flex flex-wrap items-center gap-2"
        onPaste={e => {
          const file = Array.from(e.clipboardData.files)[0]
          if (file) {
            e.preventDefault()
            subir(file)
          }
        }}
      >
        {soporte
          ? <span className="inline-flex items-center gap-1 text-xs text-green-700"><Check className="h-3.5 w-3.5" /> Soporte listo</span>
          : <span className="text-xs text-muted-foreground">Falta el soporte:</span>}
        <button type="button" disabled={isPending} title="Pega aquí el soporte (Ctrl+V)"
          className="inline-flex min-h-11 items-center gap-1 rounded-md border px-3 text-xs disabled:opacity-60">
          <Paperclip className="h-3.5 w-3.5" /> Pegar soporte
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

      {motivos.length > 0 ? (
        <div className="space-y-1">
          <p className="text-xs text-purple-700">{motivos.join(' ')}</p>
          <button type="button" disabled={isPending || !medio || !(monto > 0)} onClick={pedir}
            className="min-h-11 w-full rounded-md bg-purple-600 px-3 text-sm font-medium text-white disabled:opacity-60 sm:w-auto">
            Pedir a Edgar
          </button>
          <button type="button" disabled={isPending || !listo} onClick={registrar}
            className="block min-h-11 px-1 text-xs text-muted-foreground underline disabled:opacity-60">
            El pago ya salió: registrarlo y que Edgar lo revise
          </button>
        </div>
      ) : (
        <button type="button" disabled={isPending || !listo} onClick={registrar}
          className="min-h-11 w-full rounded-md bg-primary px-3 text-sm font-medium text-primary-foreground disabled:opacity-60 sm:w-auto">
          {isPending ? 'Guardando…' : 'Registrar pago'}
        </button>
      )}
    </div>
  )
}

/**
 * Lo pedido a Edgar en la misma fila (Noor §3.5). Edgar ve «Aprobar» y «No aprobar» (con motivo);
 * los demás ven quién pidió qué y, si Edgar no aprobó, su motivo.
 */
function Aprobaciones({ v, datos, direccion, alGuardar }: { v: FilaVista; datos: DatosBloqueServicios; direccion: boolean; alGuardar: () => void }) {
  const abiertas = v.servicio.aprobaciones.filter(a => a.estado === 'solicitada' || a.estado === 'rechazada')
  const [motivo, setMotivo] = useState('')
  const [rechazando, setRechazando] = useState<string | null>(null)
  const [isPending, startTransition] = useTransitionTolerante()
  const intencion = useIntencion()
  if (abiertas.length === 0) return null

  function decidir(id: string, decision: 'aprobada' | 'rechazada') {
    startTransition(async () => {
      const r = await decidirAprobacionServicio(v.servicio.id, id, decision, decision === 'rechazada' ? motivo : null, intencion.clave())
      intencion.cerrar()
      if (!r.ok) {
        toast.error(r.error)
        return
      }
      toast.success(decision === 'aprobada' ? 'Aprobado.' : 'No aprobado. Le avisamos a quien lo pidió.')
      setRechazando(null)
      setMotivo('')
      alGuardar()
    })
  }

  return (
    <div className="space-y-2">
      {abiertas.map(a => {
        const det = (a.detalle ?? {}) as Record<string, unknown>
        const quien = (a.solicitada_por && datos.nombres?.[a.solicitada_por]) || 'Operaciones'
        const monto = Number(det.monto ?? 0)
        const proveedor = (typeof det.proveedor === 'string' && det.proveedor) || v.servicio.nombre
        const texto = typeof det.texto === 'string' ? det.texto : ''
        return (
          <div key={a.id ?? a.tipo} className={`space-y-1.5 rounded-md border p-2 text-xs ${a.estado === 'rechazada' ? 'border-red-200 bg-red-50' : 'border-purple-200 bg-purple-50'}`}>
            <p className={a.estado === 'rechazada' ? 'text-red-700' : 'text-purple-800'}>
              {a.estado === 'rechazada'
                ? `No aprobado por Edgar: ${a.motivo ?? ''}`
                : `${quien} pide pagar ${formatCOP(monto)} a ${proveedor}: ${texto}`}
            </p>
            {direccion && a.id && (
              rechazando === a.id ? (
                <div className="space-y-1.5">
                  <input value={motivo} onChange={e => setMotivo(e.target.value)} placeholder="¿Por qué no lo apruebas?"
                    className="h-11 w-full rounded-md border bg-background px-2 text-sm" />
                  <div className="flex gap-2">
                    <button type="button" disabled={isPending || motivo.trim().length < 3} onClick={() => decidir(a.id!, 'rechazada')}
                      className="min-h-11 rounded-md bg-red-600 px-3 text-sm font-medium text-white disabled:opacity-60">No aprobar</button>
                    <button type="button" disabled={isPending} onClick={() => setRechazando(null)}
                      className="min-h-11 rounded-md border px-3 text-sm">Volver</button>
                  </div>
                </div>
              ) : (
                <div className="flex gap-2">
                  <button type="button" disabled={isPending} onClick={() => decidir(a.id!, 'aprobada')}
                    className="min-h-11 rounded-md bg-green-600 px-3 text-sm font-medium text-white disabled:opacity-60">Aprobar</button>
                  {a.estado === 'solicitada' && (
                    <button type="button" disabled={isPending} onClick={() => setRechazando(a.id!)}
                      className="min-h-11 rounded-md border px-3 text-sm">No aprobar</button>
                  )}
                </div>
              )
            )}
          </div>
        )
      })}
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
