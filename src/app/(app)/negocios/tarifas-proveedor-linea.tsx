'use client'

import { useMemo, useState } from 'react'
import { AlertTriangle, ChevronDown, ChevronRight, ExternalLink, Loader2, Search } from 'lucide-react'
import { toast } from 'sonner'

import { useTransitionTolerante } from '@/hooks/use-transition-tolerante'
import {
  buscarFichasParaLinea,
  elegirTarifasDeLinea,
  fijarProveedorDeLinea,
  tarifasDeLinea,
  type FichaParaLinea,
  type TarifasDeLinea,
} from '@/app/(app)/negocios/tarifas-proveedor-actions'
import { describirOcupacion, formatoMonto, NOMBRE_TIPO, TIPOS_PASAJERO, type TipoPasajero } from '@/lib/cotizaciones/tarifa-pasajero'
import {
  calcularEleccion,
  propuestaDeFila,
  TEXTO_CANAL,
  TEXTO_FUERA,
  textoTemporada,
  type AjustesDeCosto,
  type CanalCosto,
  type FilaElegida,
  type OpcionTarifa,
} from '@/lib/proveedores/oferta-tarifas'
import { fechaCorta } from '@/lib/proveedores/vigencia'
import { parseMontoCop } from '@/lib/negocios/monto-cop'

/**
 * Las tarifas del proveedor en la línea de la cotización (Mauricio, 2026-10-19: «ONE ofrece las
 * tarifas y la persona elige»). Un clic desde la línea, sin salir de la cotización:
 *
 *   · sin proveedor, el buscador de fichas (la línea lo guarda aunque no haya pantallazo);
 *   · con proveedor, sus tarifas de la extracción REVISADA, con el filtro a la vista (fechas,
 *     temporada, pasajeros) y la opción de quitarlo; cada una dice precio, moneda, base en llano,
 *     canal y de qué archivo y página sale;
 *   · la persona marca una o varias (una por pasajero, por habitación o por temporada), ve el
 *     cálculo antes de usarlo, ajusta canal, comisión e IVA, y la tarifa entra al costo por la
 *     confirmación de siempre. Nada se elige solo: sin el clic en «Usar», la línea no cambia.
 *
 * El pantallazo y el costo a mano siguen igual: esto es un camino más, al lado.
 */
export default function TarifasProveedorLinea({
  itemId,
  onCambio,
  inicial = null,
}: {
  itemId: string
  onCambio: () => void
  /** Para verla ya abierta (pruebas y capturas). En la cotización se pide al abrir. */
  inicial?: TarifasDeLinea | null
}) {
  const [abierta, setAbierta] = useState(!!inicial)
  const [vista, setVista] = useState<TarifasDeLinea | null>(inicial)
  const [error, setError] = useState<string | null>(null)
  const [isPending, startTransition] = useTransitionTolerante()

  function cargar() {
    startTransition(async () => {
      const r = await tarifasDeLinea(itemId)
      if (!r.ok) { setError(r.error); return }
      setError(null)
      setVista(r)
    })
  }

  return (
    <div className="rounded-md border border-dashed bg-background text-xs" data-tarifas-proveedor>
      <button
        type="button"
        className="flex w-full items-center gap-1 px-2 py-1.5 text-left font-medium text-[#1A1A1A] hover:bg-accent"
        aria-expanded={abierta}
        onClick={() => {
          const siguiente = !abierta
          setAbierta(siguiente)
          if (siguiente && !vista) cargar()
        }}
      >
        {abierta ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
        Tarifas del proveedor
        {vista?.proveedor && <span className="font-normal text-muted-foreground">· {vista.proveedor.nombre}</span>}
        {isPending && <Loader2 className="ml-auto h-3.5 w-3.5 animate-spin" />}
      </button>
      {abierta && (
        <div className="space-y-2 border-t px-2 py-2">
          {error && <p className="m-0 text-red-700">{error}</p>}
          {!vista && !error && <p className="m-0 text-muted-foreground">Buscando las tarifas…</p>}
          {vista && (
            <Contenido
              itemId={itemId}
              vista={vista}
              ocupado={isPending}
              recargar={cargar}
              onCambio={() => {
                onCambio()
                cargar()
              }}
            />
          )}
        </div>
      )}
    </div>
  )
}

function Contenido({ itemId, vista, ocupado, recargar, onCambio }: { itemId: string; vista: TarifasDeLinea; ocupado: boolean; recargar: () => void; onCambio: () => void }) {
  const [buscando, setBuscando] = useState(!vista.proveedor)
  const p = vista.proveedor
  return (
    <>
      {p && !buscando && (
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span>
            Proveedor: <strong>{p.nombre}</strong>
            {p.ciudad ? ` · ${p.ciudad}` : ''}
            {p.por === 'nombre' && <span className="text-muted-foreground"> (reconocido por el nombre del pantallazo)</span>}
          </span>
          <a href={p.enlace} target="_blank" rel="noreferrer" className="inline-flex items-center gap-0.5 text-[#059669] hover:underline">
            Abrir ficha <ExternalLink className="h-3 w-3" />
          </a>
          {vista.editable && (
            <button type="button" className="text-muted-foreground underline hover:text-[#1A1A1A]" onClick={() => setBuscando(true)}>
              {p.por === 'nombre' ? 'Es otro proveedor' : 'Cambiar'}
            </button>
          )}
        </div>
      )}
      {(buscando || !p) && (
        <Buscador
          itemId={itemId}
          editable={vista.editable}
          alElegir={() => {
            setBuscando(false)
            recargar()
          }}
          onCancelar={p ? () => setBuscando(false) : null}
        />
      )}
      {p && !buscando && (
        <>
          {vista.aviso && !vista.motivo && (
            <p className={`m-0 ${vista.aviso.tono === 'ambar' ? 'text-amber-700' : 'text-muted-foreground'}`} data-aviso-vigencia>
              {vista.aviso.texto}. {vista.aviso.accion}.
            </p>
          )}
          {vista.nuevaPorRevisar && !vista.motivo && (
            <p className="m-0 text-muted-foreground">
              Hay una extracción nueva por revisar en la ficha; estas tarifas son de la última revisada.
            </p>
          )}
          {vista.motivo ? (
            <p className="m-0 flex items-start gap-1 text-amber-700" data-motivo-sin-tarifas>
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              <span>
                {vista.motivo}{' '}
                <a href={p.enlace} target="_blank" rel="noreferrer" className="underline">Ir a la ficha</a>
                . Puedes seguir con el pantallazo o el costo a mano.
              </span>
            </p>
          ) : vista.conHabitaciones ? (
            <p className="m-0 text-amber-700">Esta opción ya tiene habitaciones de pantallazo: para usar la tarifa del proveedor, agrega otra opción.</p>
          ) : (
            <Eleccion itemId={itemId} vista={vista} ocupado={ocupado} onCambio={onCambio} />
          )}
        </>
      )}
    </>
  )
}

function Buscador({ itemId, editable, alElegir, onCancelar }: { itemId: string; editable: boolean; alElegir: () => void; onCancelar: (() => void) | null }) {
  const [texto, setTexto] = useState('')
  const [fichas, setFichas] = useState<FichaParaLinea[] | null>(null)
  const [isPending, startTransition] = useTransitionTolerante()
  function buscar() {
    startTransition(async () => {
      const r = await buscarFichasParaLinea(itemId, texto)
      if (!r.ok) { toast.error(r.error); return }
      setFichas(r.fichas)
    })
  }
  function usar(id: string) {
    startTransition(async () => {
      const r = await fijarProveedorDeLinea(itemId, id)
      if (!r.ok) { toast.error(r.error); return }
      toast.success('Proveedor guardado en la línea.')
      alElegir()
    })
  }
  if (!editable) return <p className="m-0 text-muted-foreground">La línea no tiene proveedor.</p>
  return (
    <div className="space-y-1.5" data-buscador-fichas>
      <p className="m-0 text-muted-foreground">¿De qué proveedor es esta línea? Búscalo por el nombre de su ficha.</p>
      <div className="flex gap-1">
        <input
          type="search"
          value={texto}
          onChange={(e) => setTexto(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); buscar() } }}
          placeholder="Nombre del hotel, operador, transporte…"
          aria-label="Buscar la ficha del proveedor"
          className="w-full min-w-0 rounded border bg-background px-2 py-1 text-xs"
        />
        <button type="button" onClick={buscar} disabled={isPending || texto.trim().length < 2} className="inline-flex items-center gap-1 rounded border px-2 py-1 font-medium hover:bg-accent disabled:opacity-50">
          {isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <Search className="h-3 w-3" />} Buscar
        </button>
        {onCancelar && <button type="button" onClick={onCancelar} className="px-1 text-muted-foreground underline">Cancelar</button>}
      </div>
      {fichas && fichas.length === 0 && <p className="m-0 text-muted-foreground">Ninguna ficha con ese nombre. Créala en Proveedores.</p>}
      {fichas && fichas.length > 0 && (
        <ul className="m-0 list-none space-y-0.5 p-0">
          {fichas.map((f) => (
            <li key={f.id} className="flex items-center justify-between gap-2 rounded px-1 py-0.5 hover:bg-accent">
              <span>{f.nombre}<span className="text-muted-foreground">{[f.ciudad, f.tipoProveedor].filter(Boolean).map((x) => ` · ${x}`).join('')}</span></span>
              <button type="button" onClick={() => usar(f.id)} disabled={isPending} className="rounded border px-1.5 py-0.5 font-medium hover:bg-background disabled:opacity-50">Usar</button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

const numero = (t: string): number | null => {
  const n = parseMontoCop(t)
  return n === null || !Number.isFinite(n) ? null : n
}

function Eleccion({ itemId, vista, ocupado, onCambio }: { itemId: string; vista: TarifasDeLinea; ocupado: boolean; onCambio: () => void }) {
  const c = vista.composicion
  const cal = vista.calendario
  const [sinFiltro, setSinFiltro] = useState(false)
  const [marcadas, setMarcadas] = useState<Record<number, FilaElegida>>(() =>
    Object.fromEntries((vista.elegida?.filas ?? []).map((f) => [f.indice_fila, { indice: f.indice_fila, cantidad: f.cantidad, noches: f.noches, tipo: f.tipo }])),
  )
  const [noPagan, setNoPagan] = useState<TipoPasajero[]>(vista.elegida?.noPagan ?? [])
  const [ajustes, setAjustes] = useState<AjustesDeCosto>(
    vista.elegida
      ? { canal: vista.elegida.canal, comisionPct: vista.elegida.comision_pct, ivaIncluido: vista.elegida.iva_incluido, ivaPct: vista.elegida.iva_pct }
      : (vista.ajustes as AjustesDeCosto),
  )
  const [tasa, setTasa] = useState('')
  const [isPending, startTransition] = useTransitionTolerante()

  const visibles = vista.opciones.filter((o) => sinFiltro || o.fueraPor.length === 0 || marcadas[o.indice])
  const ocultas = vista.opciones.length - vista.opciones.filter((o) => o.fueraPor.length === 0).length
  const eleccion = { filas: Object.values(marcadas), noPagan }
  const calculo = useMemo(
    () => (c && cal && eleccion.filas.length > 0 ? calcularEleccion({ opciones: vista.opciones, eleccion, composicion: c, calendario: cal, ajustes }) : null),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [JSON.stringify(eleccion), ajustes, vista.opciones, c, cal],
  )
  const moneda = calculo?.ok ? calculo.calculo.moneda : null
  const menores = c ? TIPOS_PASAJERO.filter((t) => t !== 'adulto' && (t === 'nino' ? c.ninos : c.infantes) > 0) : []

  function alternar(o: OpcionTarifa) {
    setMarcadas((m) => {
      const n = { ...m }
      if (n[o.indice]) delete n[o.indice]
      else n[o.indice] = { indice: o.indice, ...(c && cal ? propuestaDeFila(o, c, cal) : {}) }
      return n
    })
  }
  function cambiar(indice: number, cambio: Partial<FilaElegida>) {
    setMarcadas((m) => ({ ...m, [indice]: { ...m[indice], ...cambio } }))
  }
  function usar() {
    const t = moneda && moneda !== 'COP' ? numero(tasa) : null
    startTransition(async () => {
      const r = await elegirTarifasDeLinea(itemId, eleccion, ajustes, t)
      if (!r.ok) { toast.error(r.error); return }
      if (r.confirmada) toast.success(`Tarifa del proveedor en la línea: ${formatoMonto(r.aPagarAgencia ?? r.total, r.moneda)} de costo.`)
      else toast.warning(r.pendiente ?? 'Falta un dato para confirmar el costo.')
      onCambio()
    })
  }

  return (
    <div className="space-y-2">
      {/* El filtro a la vista: qué se usó para filtrar y cómo quitarlo. */}
      <div className="flex flex-wrap items-center gap-1 text-[11px]" data-filtro-tarifas>
        <span className="rounded bg-muted px-1.5 py-0.5">
          {vista.fechas.entrada
            ? `${fechaCorta(vista.fechas.entrada)}${vista.fechas.salida ? ` – ${fechaCorta(vista.fechas.salida)}` : ''}${cal?.noches && vista.opciones.some((o) => o.porNoche) ? ` · ${cal.noches} ${cal.noches === 1 ? 'noche' : 'noches'}` : ''}${vista.fechas.deLaLinea ? '' : ' (del viaje)'}`
            : 'Sin fechas'}
        </span>
        {cal && Object.values(cal.temporadas).filter((t) => (t.dias ?? 0) > 0).map((t) => (
          <span key={t.id} className="rounded bg-muted px-1.5 py-0.5">Temporada {t.nombre}</span>
        ))}
        {c && <span className="rounded bg-muted px-1.5 py-0.5">{describirOcupacion(c)}</span>}
        {ocultas > 0 && (
          <button type="button" className="text-muted-foreground underline" onClick={() => setSinFiltro((v) => !v)} data-quitar-filtro>
            {sinFiltro ? 'Volver a filtrar' : `Quitar filtro (${ocultas} ${ocultas === 1 ? 'oculta' : 'ocultas'})`}
          </button>
        )}
      </div>
      {vista.avisos.map((a) => <p key={a} className="m-0 text-amber-700">{a}</p>)}
      {vista.elegida && (
        <p className="m-0 text-muted-foreground" data-tarifa-elegida>
          El costo de la línea salió de {vista.elegida.filas.length === 1 ? 'la fila' : 'las filas'} {vista.elegida.filas.map((f) => f.indice_fila + 1).join(', ')}
          {vista.elegida.archivo ? ` de «${vista.elegida.archivo}»` : ''}{vista.elegida.por ? `, elegida por ${vista.elegida.por}` : ''}.
        </p>
      )}

      <ul className="m-0 max-h-80 list-none space-y-1 overflow-y-auto p-0" data-opciones-tarifa>
        {visibles.map((o) => {
          const m = marcadas[o.indice]
          const deshabilitada = !o.base
          return (
            <li key={o.indice} className={`rounded border px-2 py-1.5 ${m ? 'border-[#10B981] bg-[rgba(16,185,129,0.06)]' : ''} ${o.fueraPor.length ? 'opacity-70' : ''}`} data-opcion-tarifa={o.indice}>
              <label className="flex cursor-pointer items-start gap-2">
                <input type="checkbox" className="mt-0.5" checked={!!m} disabled={deshabilitada || !vista.editable} onChange={() => alternar(o)} aria-label={`Elegir la fila ${o.indice + 1}`} />
                <span className="min-w-0 flex-1">
                  <span className="flex flex-wrap items-baseline justify-between gap-x-2">
                    <span className="font-medium text-[#1A1A1A]">
                      {[o.categoria, o.plan, o.ocupacion, o.pasajero].filter(Boolean).join(' · ') || `Fila ${o.indice + 1}`}
                    </span>
                    <span className="tabular-nums font-semibold">{formatoMonto(o.precio, o.moneda)}{o.moneda === 'COP' && <span className="font-normal text-muted-foreground"> COP</span>}</span>
                  </span>
                  <span className="block text-muted-foreground">
                    {o.baseTexto}
                    {o.temporada ? ` · ${textoTemporada(o, vista.fechas)}` : ''}
                    {o.pax ? ` · ${o.pax} pax` : ''}
                    {o.precioTipo ? ` · precio ${o.precioTipo}` : ''}
                  </span>
                  <span className="block text-[10px] text-muted-foreground">
                    Fila {o.indice + 1}{o.archivo ? ` de «${o.archivo}»` : ''}{o.pagina ? `, pág. ${o.pagina}` : ''}{o.establecimiento ? ` · ${o.establecimiento}` : ''}
                  </span>
                  {o.nota && <span className="block text-[10px] italic text-muted-foreground">{o.nota}</span>}
                  {o.fueraPor.length > 0 && <span className="block text-[10px] text-amber-700">{o.fueraPor.map((f) => TEXTO_FUERA[f]).join(' · ')}</span>}
                  {deshabilitada && <span className="block text-[10px] text-amber-700">Sin base de precio: escribe este costo a mano.</span>}
                </span>
              </label>
              {m && (
                <div className="mt-1 flex flex-wrap items-center gap-2 pl-5 text-[11px]">
                  {o.unidad === 'persona' && c && (
                    <label className="flex items-center gap-1">
                      Para
                      <select value={m.tipo ?? 'adulto'} onChange={(e) => cambiar(o.indice, { tipo: e.target.value as TipoPasajero })} className="rounded border bg-background px-1 py-0.5">
                        {TIPOS_PASAJERO.filter((t) => (t === 'adulto' ? c.adultos : t === 'nino' ? c.ninos : c.infantes) > 0).map((t) => <option key={t} value={t}>{NOMBRE_TIPO[t]}</option>)}
                      </select>
                    </label>
                  )}
                  {o.unidad && o.unidad !== 'grupo' && (
                    <label className="flex items-center gap-1">
                      {o.unidad === 'persona' ? 'Cuántos' : o.unidad === 'habitacion' ? 'Habitaciones' : 'Vehículos'}
                      <input type="number" min={1} max={50} value={m.cantidad ?? ''} onChange={(e) => cambiar(o.indice, { cantidad: e.target.value === '' ? null : Number(e.target.value) })} className="w-12 rounded border bg-background px-1 py-0.5 tabular-nums" />
                    </label>
                  )}
                  {o.porNoche && (
                    <label className="flex items-center gap-1">
                      Noches
                      <input type="number" min={1} max={365} value={m.noches ?? ''} onChange={(e) => cambiar(o.indice, { noches: e.target.value === '' ? null : Number(e.target.value) })} className="w-12 rounded border bg-background px-1 py-0.5 tabular-nums" />
                    </label>
                  )}
                </div>
              )}
            </li>
          )
        })}
      </ul>

      {Object.keys(marcadas).length > 0 && vista.editable && (
        <div className="space-y-2 rounded border bg-muted/30 p-2" data-calculo-tarifa>
          {menores.length > 0 && (
            <div className="flex flex-wrap gap-3">
              {menores.map((t) => (
                <label key={t} className="flex items-center gap-1">
                  <input type="checkbox" checked={noPagan.includes(t)} onChange={(e) => setNoPagan((x) => (e.target.checked ? [...x, t] : x.filter((y) => y !== t)))} />
                  {NOMBRE_TIPO[t]} no paga en este proveedor
                </label>
              ))}
            </div>
          )}
          <div className="flex flex-wrap items-center gap-2">
            <label className="flex items-center gap-1">
              Canal
              <select value={ajustes.canal} onChange={(e) => setAjustes((a) => ({ ...a, canal: e.target.value as CanalCosto }))} className="rounded border bg-background px-1 py-0.5" aria-label="Canal de la tarifa">
                <option value="neta">Neta</option>
                <option value="comisionable">Comisionable</option>
                <option value="publica">Al público</option>
                <option value="sin_dato">No se sabe</option>
              </select>
            </label>
            {ajustes.canal === 'comisionable' && (
              <label className="flex items-center gap-1">
                Comisión
                <input type="number" min={0} max={99} step="0.5" value={ajustes.comisionPct ?? ''} onChange={(e) => setAjustes((a) => ({ ...a, comisionPct: e.target.value === '' ? null : Number(e.target.value) }))} className="w-14 rounded border bg-background px-1 py-0.5 tabular-nums" aria-label="Porcentaje de comisión" />
                %
              </label>
            )}
            <label className="flex items-center gap-1">
              <input type="checkbox" checked={ajustes.ivaIncluido} onChange={(e) => setAjustes((a) => ({ ...a, ivaIncluido: e.target.checked }))} />
              El precio ya trae IVA ({ajustes.ivaPct} %)
            </label>
          </div>
          <p className="m-0 text-[10px] text-muted-foreground">
            {TEXTO_CANAL[ajustes.canal]}. El costo se guarda sin IVA{vista.ivaDeclarado ? '; la casilla «Calcular con IVA» de la cotización se lo suma porque el proveedor cobra IVA' : ''}.
          </p>
          {calculo && !calculo.ok && <p className="m-0 text-amber-700" data-error-calculo>{calculo.error}</p>}
          {calculo?.ok && (
            <div className="space-y-0.5">
              {calculo.calculo.filas.map((f) => <p key={f.indice} className="m-0 tabular-nums">Fila {f.indice + 1}: {f.texto}</p>)}
              {calculo.calculo.ajustes.ivaIncluido && <p className="m-0 tabular-nums text-muted-foreground">Sin IVA: {formatoMonto(calculo.calculo.total, calculo.calculo.moneda)}</p>}
              <p className="m-0 font-semibold tabular-nums">
                Costo para la agencia: {formatoMonto(calculo.calculo.aPagarAgencia ?? calculo.calculo.total, calculo.calculo.moneda)}
                {calculo.calculo.aPagarAgencia !== null && <span className="font-normal text-muted-foreground"> (precio {formatoMonto(calculo.calculo.total, calculo.calculo.moneda)} menos {calculo.calculo.ajustes.comisionPct} %)</span>}
              </p>
              {calculo.calculo.avisos.map((a) => <p key={a} className="m-0 text-[10px] text-muted-foreground">{a}</p>)}
            </div>
          )}
          {moneda && moneda !== 'COP' && (
            <label className="flex items-center gap-1">
              Tasa {moneda} → COP
              <input type="text" inputMode="decimal" placeholder="ej. 4150" value={tasa} onChange={(e) => setTasa(e.target.value)} className="w-20 rounded border bg-background px-1 py-0.5 tabular-nums" />
              <span className="text-[10px] text-muted-foreground">El sistema no consulta la TRM. Sin tasa, el costo queda pendiente.</span>
            </label>
          )}
          <button
            type="button"
            onClick={usar}
            disabled={isPending || ocupado || !calculo?.ok}
            className="inline-flex items-center gap-1 rounded-md bg-[#10B981] px-3 py-1.5 font-semibold text-white hover:bg-[#059669] disabled:opacity-50"
            data-usar-tarifa
          >
            {isPending && <Loader2 className="h-3 w-3 animate-spin" />} Usar {Object.keys(marcadas).length === 1 ? 'esta tarifa' : 'estas tarifas'} en la línea
          </button>
        </div>
      )}
    </div>
  )
}
