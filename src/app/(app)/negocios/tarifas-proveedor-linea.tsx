'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { AlertTriangle, Check, ChevronDown, ChevronRight, ExternalLink, Loader2, Search, X } from 'lucide-react'
import { toast } from 'sonner'

import { useTransitionTolerante } from '@/hooks/use-transition-tolerante'
import {
  buscarFichasParaLinea,
  buscarProveedoresParaCotizacion,
  crearLineaConTarifa,
  elegirTarifasDeLinea,
  tarifasDeLinea,
  tarifasParaLineaNueva,
  type FichaParaLinea,
  type ResultadoLineaNueva,
  type TarifasDeLinea,
} from '@/app/(app)/negocios/tarifas-proveedor-actions'
import { describirOcupacion, formatoMonto, NOMBRE_TIPO, TIPOS_PASAJERO, type TipoPasajero } from '@/lib/cotizaciones/tarifa-pasajero'
import {
  calcularEleccion,
  IVA_POR_DEFECTO,
  TEXTO_CANAL,
  TEXTO_FUERA,
  textoTemporada,
  type AjustesDeCosto,
  type CanalCosto,
  type FilaElegida,
  type OpcionTarifa,
} from '@/lib/proveedores/oferta-tarifas'
import { alternarFila, gruposDeTarifas, preseleccion, totalDeFila } from '@/lib/proveedores/preseleccion-tarifas'
import { fechaCorta } from '@/lib/proveedores/vigencia'
import { parseMontoCop } from '@/lib/negocios/monto-cop'

/**
 * Las tarifas del proveedor en la cotización: UN solo componente (brief del 2026-10-21, punto 6) para
 *
 *   · «Usar tarifa de proveedor» (`UsarTarifaDeProveedor`): el tercer camino para agregar una línea,
 *     al lado de pegar un pantallazo y de «Escríbelo a mano». Busco el proveedor → elijo la tarifa →
 *     listo: la línea nace con el costo confirmado (`crearLineaConTarifa`);
 *   · el costo de una línea que ya existe (`TarifasProveedorLinea`): sin costo, «Usar tarifa de
 *     proveedor»; con costo, «Cambiar el costo», con «La que usas hoy» señalada y el costo de antes
 *     y el nuevo.
 *
 * Es una hoja: a pantalla completa en el celular (buscador enfocado, filas de 44 px, precio a la
 * derecha, pie fijo «Usar · $total») y centrada en escritorio. Un solo scroll: el de la hoja.
 *
 * El buscador solo trae proveedores CITABLES (con extracción revisada); los que tienen revisada
 * vencida para las fechas del viaje salen en gris con «pide el tarifario nuevo». Al elegir uno, la
 * tarifa de cada tipo de pasajero viene marcada (si hay una, esa; si hay varias, la más barata) y se
 * cambia con un toque: marcar otra reemplaza la del mismo puesto, nunca quedan dos. Canal, comisión,
 * IVA, «no paga» y cantidades van en «Detalles del costo», cerrado salvo que falte un dato. Nada se
 * guarda sin «Usar», y el precio lo vuelve a calcular el servidor.
 */

type Modo =
  | { tipo: 'nueva'; cotizacionId: string }
  | { tipo: 'linea'; itemId: string; costoActual: number | null }

const numero = (t: string): number | null => {
  const n = parseMontoCop(t)
  return n === null || !Number.isFinite(n) ? null : n
}

/** La llave de un «Usar» (un reintento no crea otra línea). */
const nuevaLlave = () => `tarifa-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`

// ── La línea que ya existe ───────────────────────────────────────────────────

export default function TarifasProveedorLinea({
  itemId,
  onCambio,
  inicial = null,
  titulo,
  costoActual = null,
}: {
  itemId: string
  onCambio: () => void
  /** Para verla ya abierta (pruebas y capturas). En la cotización se pide al abrir. */
  inicial?: TarifasDeLinea | null
  /** Lo que dice el botón. Por defecto: «Cambiar el costo» con costo, «Usar tarifa de proveedor» sin él. */
  titulo?: string
  /**
   * El costo que la línea tiene hoy, en pesos y sin IVA. Con él la persona ve el actual y el nuevo
   * antes de «Usar», y el botón dice que lo reemplaza. `null` = la línea todavía no tiene costo.
   */
  costoActual?: number | null
}) {
  const [abierta, setAbierta] = useState(!!inicial)
  const reemplaza = costoActual !== null && costoActual > 0
  return (
    <div data-tarifas-proveedor>
      <button
        type="button"
        onClick={() => setAbierta(true)}
        className="flex min-h-9 w-full items-center gap-1.5 rounded-md border border-dashed bg-background px-2 py-1.5 text-left text-xs font-medium text-[#1A1A1A] hover:bg-accent"
        data-abrir-tarifas
      >
        <Search className="h-3.5 w-3.5 text-muted-foreground" />
        {titulo ?? (reemplaza ? 'Cambiar el costo por una tarifa del proveedor' : 'Usar tarifa de proveedor')}
      </button>
      {abierta && (
        <HojaDeTarifas
          modo={{ tipo: 'linea', itemId, costoActual }}
          inicial={inicial}
          onCerrar={() => setAbierta(false)}
          onListo={() => {
            setAbierta(false)
            onCambio()
          }}
        />
      )}
    </div>
  )
}

// ── El tercer camino: una línea nueva desde la tarifa ────────────────────────

/**
 * El aviso al crear la línea: nombra el servicio («Playa Blanca con almuerzo agregada…»), no el
 * grupo genérico «Actividad en Santa Marta» (brief del 2026-10-22, menor). Sin servicio (hotel,
 * vuelo), dice dónde quedó, como antes.
 */
export function avisoDeLineaAgregada(r: Extract<ResultadoLineaNueva, { ok: true }>): string {
  const que = r.servicio ? `«${r.servicio}» agregada` : `Línea agregada en ${r.donde}`
  if (r.confirmada) return `${que}: ${formatoMonto(r.aPagarAgencia ?? r.total, r.moneda)} de costo.`
  return `${que}. ${r.pendiente ?? 'Falta un dato para confirmar el costo.'}`
}

export function UsarTarifaDeProveedor({ cotizacionId, onCreada, className }: { cotizacionId: string; onCreada: (itemId: string) => void; className?: string }) {
  const [abierta, setAbierta] = useState(false)
  return (
    <>
      <button type="button" onClick={() => setAbierta(true)} className={className} data-usar-tarifa-proveedor>
        Usar tarifa de proveedor
      </button>
      {abierta && (
        <HojaDeTarifas
          modo={{ tipo: 'nueva', cotizacionId }}
          onCerrar={() => setAbierta(false)}
          onListo={(itemId) => {
            setAbierta(false)
            if (itemId) onCreada(itemId)
          }}
        />
      )}
    </>
  )
}

// ── La hoja ──────────────────────────────────────────────────────────────────

function HojaDeTarifas({ modo, inicial = null, onCerrar, onListo }: { modo: Modo; inicial?: TarifasDeLinea | null; onCerrar: () => void; onListo: (itemId: string | null) => void }) {
  const [vista, setVista] = useState<TarifasDeLinea | null>(inicial)
  const [buscando, setBuscando] = useState(inicial ? !inicial.proveedor : modo.tipo === 'nueva')
  const [elegido, setElegido] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [isPending, startTransition] = useTransitionTolerante()
  const abiertaEn = useRef(Date.now())

  // Una línea pide sus tarifas al abrir (con su proveedor, o el buscador si no tiene).
  const pedida = useRef(false)
  useEffect(() => {
    if (modo.tipo !== 'linea' || inicial || pedida.current) return
    pedida.current = true
    cargar(null)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Escape cierra la hoja.
  useEffect(() => {
    const alTeclear = (e: KeyboardEvent) => { if (e.key === 'Escape') onCerrar() }
    document.addEventListener('keydown', alTeclear)
    return () => document.removeEventListener('keydown', alTeclear)
  }, [onCerrar])

  function cargar(proveedorId: string | null) {
    startTransition(async () => {
      const r = modo.tipo === 'nueva'
        ? await tarifasParaLineaNueva(modo.cotizacionId, proveedorId as string)
        : await tarifasDeLinea(modo.itemId, proveedorId)
      if (!r.ok) { setError(r.error); return }
      setError(null)
      setVista(r)
      setBuscando(!r.proveedor)
    })
  }

  const p = vista?.proveedor ?? null
  const titulo = modo.tipo === 'nueva' ? 'Usar tarifa de proveedor' : modo.costoActual && modo.costoActual > 0 ? 'Cambiar el costo' : 'Usar tarifa de proveedor'

  return (
    <div className="fixed inset-0 z-50 flex items-stretch justify-center bg-black/40 sm:items-center sm:p-4" role="dialog" aria-modal="true" aria-label={titulo} data-hoja-tarifas>
      <div className="flex h-full w-full flex-col bg-background text-xs sm:h-auto sm:max-h-[88vh] sm:max-w-2xl sm:rounded-xl sm:shadow-xl">
        <header className="flex items-center gap-2 border-b px-3 py-2.5">
          <h2 className="m-0 min-w-0 flex-1 truncate text-sm font-semibold text-[#1A1A1A]">
            {titulo}
            {p && !buscando && <span className="font-normal text-muted-foreground"> · {p.nombre}</span>}
          </h2>
          {isPending && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
          <button type="button" onClick={onCerrar} className="inline-flex h-11 w-11 items-center justify-center rounded-md hover:bg-accent sm:h-8 sm:w-8" aria-label="Cerrar" data-cerrar-hoja>
            <X className="h-4 w-4" />
          </button>
        </header>
        {error && <p className="m-0 border-b px-3 py-2 text-red-700">{error}</p>}
        {buscando || (!vista && modo.tipo === 'nueva') || (vista && !p) ? (
          <Buscador
            modo={modo}
            editable={vista?.editable ?? true}
            onElegir={(id) => {
              setElegido(id)
              cargar(id)
            }}
            onCancelar={p ? () => setBuscando(false) : null}
          />
        ) : !vista ? (
          <p className="m-0 px-3 py-4 text-muted-foreground">Buscando las tarifas…</p>
        ) : (
          <Contenido
            key={`${p?.id ?? ''}:${vista.opciones.length}`}
            modo={modo}
            vista={vista}
            elegido={elegido}
            ocupado={isPending}
            abiertaEn={abiertaEn.current}
            onCambiarProveedor={() => setBuscando(true)}
            onListo={onListo}
          />
        )}
      </div>
    </div>
  )
}

function Buscador({ modo, editable, onElegir, onCancelar }: { modo: Modo; editable: boolean; onElegir: (id: string) => void; onCancelar: (() => void) | null }) {
  const [texto, setTexto] = useState('')
  const [fichas, setFichas] = useState<FichaParaLinea[] | null>(null)
  const [cargando, setCargando] = useState(false)
  const entrada = useRef<HTMLInputElement>(null)
  const turno = useRef(0)
  const donde = modo.tipo === 'nueva' ? modo.cotizacionId : modo.itemId

  // Busca mientras se escribe (sin botón): espera a que la persona pare 250 ms. Sin texto, todas
  // las citables. La respuesta de una búsqueda vieja se descarta.
  useEffect(() => {
    const t = ++turno.current
    const espera = setTimeout(async () => {
      setCargando(true)
      try {
        const r = modo.tipo === 'nueva' ? await buscarProveedoresParaCotizacion(donde, texto) : await buscarFichasParaLinea(donde, texto)
        if (t !== turno.current) return
        if (!r.ok) { toast.error(r.error); return }
        setFichas(r.fichas)
      } catch {
        if (t === turno.current) toast.error('No se pudieron buscar los proveedores. Vuelve a intentarlo.')
      } finally {
        if (t === turno.current) setCargando(false)
      }
    }, texto ? 250 : 0)
    return () => clearTimeout(espera)
  }, [texto, modo.tipo, donde])

  useEffect(() => { entrada.current?.focus() }, [])

  if (!editable) return <p className="m-0 px-3 py-4 text-muted-foreground">La línea no tiene proveedor.</p>
  return (
    <div className="flex min-h-0 flex-1 flex-col" data-buscador-fichas>
      <div className="flex items-center gap-2 border-b px-3 py-2">
        <label className="relative min-w-0 flex-1">
          <span className="sr-only">Proveedor</span>
          <Search className="pointer-events-none absolute top-1/2 left-2.5 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <input
            ref={entrada}
            type="search"
            value={texto}
            onChange={(e) => setTexto(e.target.value)}
            placeholder="Proveedor: hotel, operador, transporte…"
            aria-label="Proveedor"
            className="h-11 w-full min-w-0 rounded-md border bg-background pr-2 pl-8 text-sm sm:h-9"
            data-buscar-proveedor
          />
        </label>
        {onCancelar && <button type="button" onClick={onCancelar} className="h-11 px-1 text-muted-foreground underline sm:h-9">Cancelar</button>}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-3 py-2">
        {cargando && !fichas && <p className="m-0 text-muted-foreground">Buscando…</p>}
        {fichas && fichas.length === 0 && (
          <p className="m-0 text-muted-foreground" data-sin-proveedores>
            {texto.trim().length >= 2
              ? 'Ningún proveedor con tarifas revisadas tiene ese nombre. Si no tiene tarifas, escríbelo a mano.'
              : 'Todavía no hay proveedores con tarifas revisadas. Se revisan en la ficha de cada proveedor.'}
          </p>
        )}
        {fichas && fichas.length > 0 && (
          <ul className="m-0 list-none space-y-1 p-0" data-fichas>
            {fichas.map((f) => (
              <li key={f.id}>
                {f.cubre ? (
                  <button
                    type="button"
                    onClick={() => onElegir(f.id)}
                    className="flex min-h-11 w-full items-center gap-2 rounded-md border bg-background px-3 py-2 text-left hover:border-[#10B981] hover:bg-[rgba(16,185,129,0.06)]"
                    data-ficha={f.id}
                  >
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium text-[#1A1A1A]">{f.nombre}</span>
                      <span className="block truncate text-[11px] text-muted-foreground">
                        {[f.ciudad, f.tipoProveedor, f.vigencia?.hasta ? `tarifas hasta ${fechaCorta(f.vigencia.hasta)}` : null].filter(Boolean).join(' · ')}
                        {f.porRevisar ? ' · hay una extracción nueva por revisar' : ''}
                      </span>
                    </span>
                    <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
                  </button>
                ) : (
                  // Revisada pero vencida para las fechas del viaje: se ve en gris, no se usa.
                  <div className="flex min-h-11 w-full items-center gap-2 rounded-md border border-dashed bg-muted/40 px-3 py-2 text-muted-foreground" data-ficha-vencida={f.id}>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm">{f.nombre}</span>
                      <span className="block text-[11px]">
                        Sus tarifas {f.vigencia?.hasta ? `valen hasta ${fechaCorta(f.vigencia.hasta)}` : 'no cubren el viaje'}: pide el tarifario nuevo.
                      </span>
                    </span>
                    <a href={`/proveedores/${f.id}`} target="_blank" rel="noreferrer" className="inline-flex items-center gap-0.5 whitespace-nowrap underline">
                      Ficha <ExternalLink className="h-3 w-3" />
                    </a>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}

function Contenido({
  modo,
  vista,
  elegido,
  ocupado,
  abiertaEn,
  onCambiarProveedor,
  onListo,
}: {
  modo: Modo
  vista: TarifasDeLinea
  elegido: string | null
  ocupado: boolean
  abiertaEn: number
  onCambiarProveedor: () => void
  onListo: (itemId: string | null) => void
}) {
  const p = vista.proveedor!
  return (
    <>
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 border-b px-3 py-2">
        <span className="min-w-0">
          <strong className="text-[#1A1A1A]">{p.nombre}</strong>
          {p.ciudad ? ` · ${p.ciudad}` : ''}
          {p.por === 'nombre' && <span className="text-muted-foreground"> (reconocido por el nombre del pantallazo)</span>}
        </span>
        <a href={p.enlace} target="_blank" rel="noreferrer" className="inline-flex items-center gap-0.5 text-[#059669] hover:underline">
          Ficha <ExternalLink className="h-3 w-3" />
        </a>
        {vista.editable && (
          <button type="button" className="ml-auto min-h-9 text-muted-foreground underline hover:text-[#1A1A1A]" onClick={onCambiarProveedor} data-cambiar-proveedor>
            {p.por === 'nombre' ? 'Es otro proveedor' : 'Otro proveedor'}
          </button>
        )}
      </div>
      {vista.motivo ? (
        <div className="flex-1 px-3 py-3">
          <p className="m-0 flex items-start gap-1 text-amber-700" data-motivo-sin-tarifas>
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <span>
              {vista.motivo}{' '}
              <a href={p.enlace} target="_blank" rel="noreferrer" className="underline">Ir a la ficha</a>
              .
            </span>
          </p>
        </div>
      ) : vista.conHabitaciones ? (
        <p className="m-0 flex-1 px-3 py-3 text-amber-700">Esta opción ya tiene habitaciones de pantallazo: para usar la tarifa del proveedor, agrega otra opción.</p>
      ) : (
        <Eleccion modo={modo} vista={vista} elegido={elegido} ocupado={ocupado} abiertaEn={abiertaEn} onListo={onListo} />
      )}
    </>
  )
}

function Eleccion({ modo, vista, elegido, ocupado, abiertaEn, onListo }: { modo: Modo; vista: TarifasDeLinea; elegido: string | null; ocupado: boolean; abiertaEn: number; onListo: (itemId: string | null) => void }) {
  const c = vista.composicion
  const cal = vista.calendario
  const costoActual = modo.tipo === 'linea' ? modo.costoActual : null
  const [sinFiltro, setSinFiltro] = useState(false)
  // Reemplazar un costo que ya existe («Cambiar el costo»): la fila de hoy se SEÑALA («La que usas
  // hoy») pero no viene marcada, y nada se preselecciona: la persona elige la nueva. Sin costo
  // confirmado (p. ej. faltó la tasa), la elección de antes vuelve marcada; sin elección de antes,
  // la de cada pasajero viene marcada (`preseleccion`).
  const reemplaza = costoActual !== null && costoActual > 0
  const actuales = new Set((vista.elegida?.filas ?? []).map((f) => f.indice_fila))
  const inicio = useMemo(() => {
    if (reemplaza) return { marcadas: {} as Record<number, FilaElegida>, como: null }
    if (vista.elegida) return { marcadas: Object.fromEntries(vista.elegida.filas.map((f) => [f.indice_fila, { indice: f.indice_fila, cantidad: f.cantidad, noches: f.noches, tipo: f.tipo }])) as Record<number, FilaElegida>, como: null }
    return preseleccion(vista.opciones, c, cal)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  const [marcadas, setMarcadas] = useState<Record<number, FilaElegida>>(inicio.marcadas)
  const [noPagan, setNoPagan] = useState<TipoPasajero[]>(vista.elegida?.noPagan ?? [])
  const [ajustes, setAjustes] = useState<AjustesDeCosto>(
    vista.elegida
      ? { canal: vista.elegida.canal, comisionPct: vista.elegida.comision_pct, ivaIncluido: vista.elegida.iva_incluido, ivaPct: vista.elegida.iva_pct }
      : (vista.ajustes as AjustesDeCosto),
  )
  const [tasa, setTasa] = useState('')
  const [isPending, startTransition] = useTransitionTolerante()
  const llave = useRef(nuevaLlave())

  const visibles = vista.opciones.filter((o) => sinFiltro || o.fueraPor.length === 0 || marcadas[o.indice] || actuales.has(o.indice))
  const ocultas = vista.opciones.length - vista.opciones.filter((o) => o.fueraPor.length === 0).length
  const eleccion = { filas: Object.values(marcadas), noPagan }
  const calculo = useMemo(
    () => (c && cal && eleccion.filas.length > 0 ? calcularEleccion({ opciones: vista.opciones, eleccion, composicion: c, calendario: cal, ajustes }) : null),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [JSON.stringify(eleccion), ajustes, vista.opciones, c, cal],
  )
  const moneda = calculo?.ok ? calculo.calculo.moneda : null
  const costoNuevo = calculo?.ok ? calculo.calculo.aPagarAgencia ?? calculo.calculo.total : null
  // Reemplazar un costo que ya existe es de una vez: en otra moneda, con la tasa escrita. Una línea
  // nueva sí entra sin tasa (con el aviso de tasa pendiente): no se bloquea.
  const faltaTasa = reemplaza && !!moneda && moneda !== 'COP' && numero(tasa) === null
  const menores = c ? TIPOS_PASAJERO.filter((t) => t !== 'adulto' && (t === 'nino' ? c.ninos : c.infantes) > 0) : []
  // «Detalles del costo» se abre solo cuando falta un dato: el cálculo no cierra (p. ej. falta el
  // infante: ¿paga o no?), el tarifario no dice el canal, o es comisionable sin el %.
  const faltaDato = (!!calculo && !calculo.ok) || ajustes.canal === 'sin_dato' || (ajustes.canal === 'comisionable' && ajustes.comisionPct === null)
  const [detalles, setDetalles] = useState(faltaDato)
  useEffect(() => { if (faltaDato) setDetalles(true) }, [faltaDato])

  function alternar(o: OpcionTarifa) {
    setMarcadas((m) => alternarFila(m, o, vista.opciones, c, cal))
  }
  function cambiar(indice: number, cambio: Partial<FilaElegida>) {
    setMarcadas((m) => ({ ...m, [indice]: { ...m[indice], ...cambio } }))
  }
  function usar() {
    const t = moneda && moneda !== 'COP' ? numero(tasa) : null
    const medida = { segundos: (Date.now() - abiertaEn) / 1000 }
    startTransition(async () => {
      if (modo.tipo === 'nueva') {
        const r = await crearLineaConTarifa(modo.cotizacionId, (elegido ?? vista.proveedor?.id) as string, eleccion, ajustes, t, { idAceptacion: llave.current, medida })
        if (!r.ok) { toast.error(r.error); return }
        if (r.confirmada) toast.success(avisoDeLineaAgregada(r))
        else toast.warning(avisoDeLineaAgregada(r))
        onListo(r.itemId)
        return
      }
      const r = await elegirTarifasDeLinea(modo.itemId, eleccion, ajustes, t, elegido, medida)
      if (!r.ok) { toast.error(r.error); return }
      if (r.confirmada) toast.success(`Tarifa del proveedor en la línea: ${formatoMonto(r.aPagarAgencia ?? r.total, r.moneda)} de costo.`)
      else toast.warning(r.pendiente ?? 'Falta un dato para confirmar el costo.')
      onListo(null)
    })
  }

  const n = Object.keys(marcadas).length
  const textoBoton = !calculo?.ok || costoNuevo === null
    ? reemplaza ? 'Usar y reemplazar el costo' : 'Usar'
    : `${reemplaza ? 'Usar y reemplazar' : 'Usar'} · ${formatoMonto(costoNuevo, calculo.calculo.moneda)}`

  return (
    <>
      <div className="min-h-0 flex-1 space-y-2 overflow-y-auto px-3 py-2" data-lista-tarifas>
        {/* El filtro a la vista: qué se usó para filtrar y cómo quitarlo. */}
        <div className="flex flex-wrap items-center gap-1 text-[11px]" data-filtro-tarifas>
          <span className="rounded bg-muted px-1.5 py-0.5">
            {vista.fechas.entrada
              ? `${fechaCorta(vista.fechas.entrada)}${vista.fechas.salida ? ` – ${fechaCorta(vista.fechas.salida)}` : ''}${cal?.noches && vista.opciones.some((o) => o.porNoche) ? ` · ${cal.noches} ${cal.noches === 1 ? 'noche' : 'noches'}` : ''}${vista.fechas.deLaLinea ? ' (de la línea)' : ' (del viaje)'}`
              : 'Sin fechas'}
          </span>
          {cal && Object.values(cal.temporadas).filter((t) => (t.dias ?? 0) > 0).map((t) => (
            <span key={t.id} className="rounded bg-muted px-1.5 py-0.5">Temporada {t.nombre}</span>
          ))}
          {c && <span className="rounded bg-muted px-1.5 py-0.5">{describirOcupacion(c)}{vista.composicionDelViaje === false ? ' (de la línea)' : ' (del viaje)'}</span>}
          {ocultas > 0 && (
            <button type="button" className="min-h-8 text-muted-foreground underline" onClick={() => setSinFiltro((v) => !v)} data-quitar-filtro>
              {sinFiltro ? 'Volver a filtrar' : `Quitar filtro (${ocultas} ${ocultas === 1 ? 'oculta' : 'ocultas'})`}
            </button>
          )}
        </div>
        {vista.aviso && (
          <p className={`m-0 ${vista.aviso.tono === 'ambar' ? 'text-amber-700' : 'text-muted-foreground'}`} data-aviso-vigencia>
            {vista.aviso.texto}. {vista.aviso.accion}.
          </p>
        )}
        {vista.nuevaPorRevisar && <p className="m-0 text-muted-foreground">Hay una extracción nueva por revisar en la ficha; estas tarifas son de la última revisada.</p>}
        {vista.avisos.map((a) => <p key={a} className="m-0 text-amber-700">{a}</p>)}
        {/* De dónde salió el costo de hoy: en su propia caja, arriba de las tarifas. */}
        {vista.elegida && (
          <p className="m-0 rounded bg-muted/50 px-2 py-1 text-muted-foreground" data-tarifa-elegida>
            El costo de la línea salió de {vista.elegida.filas.length === 1 ? 'la fila' : 'las filas'} {vista.elegida.filas.map((f) => f.indice_fila + 1).join(', ')}
            {vista.elegida.archivo ? ` de «${vista.elegida.archivo}»` : ''}{vista.elegida.por ? `, elegida por ${vista.elegida.por}` : ''}.
          </p>
        )}
        {inicio.como && inicio.como !== 'varios_servicios' && n > 0 && (
          <p className="m-0 text-muted-foreground" data-preseleccion={inicio.como}>
            {inicio.como === 'unica' ? 'Marcamos la tarifa de cada pasajero.' : 'Marcamos la más barata de cada pasajero. Toca otra para cambiarla.'}
          </p>
        )}
        {/* Servicios distintos (un operador con varias actividades): ONE no elige por precio. */}
        {inicio.como === 'varios_servicios' && n === 0 && (
          <p className="m-0 font-medium text-[#1A1A1A]" data-preseleccion="varios_servicios">
            Este proveedor tiene {inicio.servicios} servicios distintos: toca el que va en la cotización.
          </p>
        )}

        <div className="space-y-2" data-opciones-tarifa>
          {gruposDeTarifas(visibles).map((g) => (
            <section key={g.titulo} className="space-y-1">
              <h3 className="m-0 text-xs font-semibold text-[#1A1A1A]" data-grupo-tarifas>{g.titulo}</h3>
              <ul className="m-0 list-none space-y-1 p-0">
                {g.opciones.map((o) => {
                  const m = marcadas[o.indice]
                  const deshabilitada = !o.base
                  const total = totalDeFila(o, c, cal, m)
                  const quien = [o.ocupacion, o.pasajero, o.temporada ? textoTemporada(o, vista.fechas) : null, o.pax].filter(Boolean).join(' · ')
                  return (
                    <li key={o.indice} className={`rounded-md border ${m ? 'border-[#10B981] bg-[rgba(16,185,129,0.06)]' : 'bg-background'} ${o.fueraPor.length ? 'opacity-70' : ''}`} data-opcion-tarifa={o.indice}>
                      <label className="flex min-h-11 cursor-pointer items-center gap-2 px-2.5 py-2">
                        <input type="checkbox" className="sr-only" checked={!!m} disabled={deshabilitada || !vista.editable} onChange={() => alternar(o)} aria-label={`Elegir la fila ${o.indice + 1}`} />
                        <span className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full border ${m ? 'border-[#10B981] bg-[#10B981] text-white' : 'bg-background'}`} aria-hidden>
                          {m && <Check className="h-3 w-3" />}
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block font-medium text-[#1A1A1A]">
                            {quien || o.baseTexto}
                            {reemplaza && actuales.has(o.indice) && (
                              <span className="ml-1.5 whitespace-nowrap rounded bg-muted px-1 py-px text-[10px] font-medium text-muted-foreground" data-tarifa-actual>
                                La que usas hoy
                              </span>
                            )}
                          </span>
                          <span className="block text-[11px] text-muted-foreground">
                            {formatoMonto(o.precio, o.moneda)}{o.moneda === 'COP' ? ' COP' : ''} {o.baseTexto}
                            {o.precioTipo ? ` · precio ${o.precioTipo}` : ''}
                          </span>
                          <span className="block text-[10px] text-muted-foreground">
                            Fila {o.indice + 1}{o.archivo ? ` de «${o.archivo}»` : ''}{o.pagina ? `, pág. ${o.pagina}` : ''}{o.establecimiento ? ` · ${o.establecimiento}` : ''}
                          </span>
                          {o.nota && <span className="block text-[10px] italic text-muted-foreground">{o.nota}</span>}
                          {o.fueraPor.length > 0 && <span className="block text-[10px] text-amber-700">{o.fueraPor.map((f) => TEXTO_FUERA[f]).join(' · ')}</span>}
                          {deshabilitada && <span className="block text-[10px] text-amber-700">Sin base de precio: escribe este costo a mano.</span>}
                        </span>
                        {/* El total de la tarifa, a la derecha: «2 × $105.000 = $210.000». */}
                        <span className="shrink-0 text-right tabular-nums" data-total-fila>
                          {total ? (
                            <>
                              <span className="block font-semibold text-[#1A1A1A]">{formatoMonto(total.subtotal, o.moneda)}</span>
                              {total.texto.includes('=') && <span className="block text-[10px] text-muted-foreground">{total.texto.split(' = ')[0]}</span>}
                            </>
                          ) : (
                            <span className="font-semibold">{formatoMonto(o.precio, o.moneda)}</span>
                          )}
                        </span>
                      </label>
                    </li>
                  )
                })}
              </ul>
            </section>
          ))}
        </div>

        {n > 0 && vista.editable && (
          <div className="rounded-md border" data-detalles-costo>
            <button type="button" className="flex min-h-11 w-full items-center gap-1 px-2.5 text-left font-medium" aria-expanded={detalles} onClick={() => setDetalles((d) => !d)} data-abrir-detalles>
              {detalles ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
              Detalles del costo
              <span className="ml-1 truncate font-normal text-muted-foreground">
                · {TEXTO_CANAL[ajustes.canal].split(':')[0]}{ajustes.ivaIncluido ? ' · trae IVA' : ''}{noPagan.length ? ` · ${noPagan.map((t) => NOMBRE_TIPO[t].toLowerCase()).join(', ')} no paga` : ''}
              </span>
            </button>
            {detalles && (
              <div className="space-y-2 border-t px-2.5 py-2" data-calculo-tarifa>
                {Object.values(marcadas).map((m) => {
                  const o = vista.opciones.find((x) => x.indice === m.indice)
                  if (!o || (!o.porNoche && o.unidad === 'grupo')) return null
                  return (
                    <div key={o.indice} className="flex flex-wrap items-center gap-2 text-[11px]">
                      <span className="font-medium">Fila {o.indice + 1}</span>
                      {o.unidad === 'persona' && c && (
                        <label className="flex items-center gap-1">
                          Para
                          <select value={m.tipo ?? 'adulto'} onChange={(e) => cambiar(o.indice, { tipo: e.target.value as TipoPasajero })} className="h-8 rounded border bg-background px-1">
                            {TIPOS_PASAJERO.filter((t) => (t === 'adulto' ? c.adultos : t === 'nino' ? c.ninos : c.infantes) > 0).map((t) => <option key={t} value={t}>{NOMBRE_TIPO[t]}</option>)}
                          </select>
                        </label>
                      )}
                      {o.unidad && o.unidad !== 'grupo' && (
                        <label className="flex items-center gap-1">
                          {o.unidad === 'persona' ? 'Cuántos' : o.unidad === 'habitacion' ? 'Habitaciones' : 'Vehículos'}
                          <input type="number" min={1} max={50} value={m.cantidad ?? ''} onChange={(e) => cambiar(o.indice, { cantidad: e.target.value === '' ? null : Number(e.target.value) })} className="h-8 w-14 rounded border bg-background px-1 tabular-nums" />
                        </label>
                      )}
                      {o.porNoche && (
                        <label className="flex items-center gap-1">
                          Noches
                          <input type="number" min={1} max={365} value={m.noches ?? ''} onChange={(e) => cambiar(o.indice, { noches: e.target.value === '' ? null : Number(e.target.value) })} className="h-8 w-14 rounded border bg-background px-1 tabular-nums" />
                        </label>
                      )}
                    </div>
                  )
                })}
                {menores.length > 0 && (
                  <div className="flex flex-wrap gap-3">
                    {menores.map((t) => (
                      <label key={t} className="flex min-h-8 items-center gap-1">
                        <input type="checkbox" checked={noPagan.includes(t)} onChange={(e) => setNoPagan((x) => (e.target.checked ? [...x, t] : x.filter((y) => y !== t)))} data-no-paga={t} />
                        {NOMBRE_TIPO[t]} no paga en este proveedor
                      </label>
                    ))}
                  </div>
                )}
                <div className="flex flex-wrap items-center gap-2">
                  <label className="flex items-center gap-1">
                    Canal
                    <select value={ajustes.canal} onChange={(e) => setAjustes((a) => ({ ...a, canal: e.target.value as CanalCosto }))} className="h-8 rounded border bg-background px-1" aria-label="Canal de la tarifa">
                      <option value="neta">Neta</option>
                      <option value="comisionable">Comisionable</option>
                      <option value="publica">Al público</option>
                      <option value="sin_dato">No se sabe</option>
                    </select>
                  </label>
                  {ajustes.canal === 'comisionable' && (
                    <label className="flex items-center gap-1">
                      Comisión
                      <input type="number" min={0} max={99} step="0.5" value={ajustes.comisionPct ?? ''} onChange={(e) => setAjustes((a) => ({ ...a, comisionPct: e.target.value === '' ? null : Number(e.target.value) }))} className="h-8 w-16 rounded border bg-background px-1 tabular-nums" aria-label="Porcentaje de comisión" />
                      %
                    </label>
                  )}
                  <label className="flex min-h-8 items-center gap-1">
                    <input type="checkbox" checked={ajustes.ivaIncluido} onChange={(e) => setAjustes((a) => ({ ...a, ivaIncluido: e.target.checked }))} />
                    El precio ya trae IVA ({ajustes.ivaPct ?? IVA_POR_DEFECTO} %)
                  </label>
                </div>
                <p className="m-0 text-[10px] text-muted-foreground">
                  {TEXTO_CANAL[ajustes.canal]}. El costo se guarda sin IVA
                  {ajustes.ivaPct === null
                    ? '; el tarifario no declara IVA, así que «Calcular con IVA» no le suma nada'
                    : '; la casilla «Calcular con IVA» de la cotización se lo suma porque el proveedor cobra IVA'}.
                </p>
                {calculo?.ok && (
                  <div className="space-y-0.5">
                    {calculo.calculo.filas.map((f) => <p key={f.indice} className="m-0 tabular-nums">Fila {f.indice + 1}: {f.texto}</p>)}
                    {calculo.calculo.ajustes.ivaIncluido && <p className="m-0 tabular-nums text-muted-foreground">Sin IVA: {formatoMonto(calculo.calculo.total, calculo.calculo.moneda)}</p>}
                    {calculo.calculo.aPagarAgencia !== null && (
                      <p className="m-0 tabular-nums text-muted-foreground">Precio {formatoMonto(calculo.calculo.total, calculo.calculo.moneda)} menos {calculo.calculo.ajustes.comisionPct} % de comisión</p>
                    )}
                    {calculo.calculo.avisos.map((a) => <p key={a} className="m-0 text-[10px] text-muted-foreground">{a}</p>)}
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </div>

      {/* El pie, fijo: lo que va a costar y el botón. */}
      {vista.editable && (
        <footer className="space-y-1.5 border-t bg-background px-3 py-2.5" data-pie-tarifas>
          {calculo && !calculo.ok && <p className="m-0 text-amber-700" data-error-calculo>{calculo.error}</p>}
          {reemplaza && calculo?.ok && (
            <p className="m-0 rounded bg-amber-50 px-1.5 py-1 tabular-nums text-amber-900" data-costo-actual-y-nuevo>
              Costo actual de la línea: <strong>{formatoMonto(costoActual ?? 0, 'COP')}</strong>. Con {n === 1 ? 'esta tarifa' : 'estas tarifas'}:{' '}
              <strong>
                {calculo.calculo.moneda === 'COP'
                  ? formatoMonto(costoNuevo ?? 0, 'COP')
                  : numero(tasa) !== null
                    ? formatoMonto(Math.round((costoNuevo ?? 0) * (numero(tasa) as number)), 'COP')
                    : `${formatoMonto(costoNuevo ?? 0, calculo.calculo.moneda)} (falta la tasa)`}
              </strong>
              . Nada cambia hasta que toques el botón.
            </p>
          )}
          {moneda && moneda !== 'COP' && (
            <label className="flex flex-wrap items-center gap-1">
              Tasa {moneda} → COP
              <input type="text" inputMode="decimal" placeholder="ej. 4150" value={tasa} onChange={(e) => setTasa(e.target.value)} className="h-9 w-24 rounded border bg-background px-1.5 tabular-nums" data-tasa />
              <span className="text-[10px] text-muted-foreground">
                El sistema no consulta la TRM. {reemplaza ? 'Para reemplazar el costo hace falta la tasa.' : 'Sin tasa, la línea entra con la tasa pendiente.'}
              </span>
            </label>
          )}
          <button
            type="button"
            onClick={usar}
            disabled={isPending || ocupado || !calculo?.ok || faltaTasa}
            className="inline-flex min-h-11 w-full items-center justify-center gap-1.5 rounded-md bg-[#10B981] px-3 py-2 text-sm font-semibold text-white hover:bg-[#059669] disabled:opacity-50 sm:min-h-9"
            data-usar-tarifa
          >
            {isPending && <Loader2 className="h-4 w-4 animate-spin" />}
            {n === 0 ? 'Elige una tarifa' : textoBoton}
          </button>
        </footer>
      )}
    </>
  )
}
