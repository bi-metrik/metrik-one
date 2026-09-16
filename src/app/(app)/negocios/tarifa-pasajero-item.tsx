'use client'

import { useState, useTransition } from 'react'
import { AlertTriangle, Check, ChevronDown, ChevronRight, Image as ImageIcon, Loader2, Pencil, X } from 'lucide-react'
import { toast } from 'sonner'

import {
  actualizarComposicionDeItem,
  confirmarMenorNoPaga,
  confirmarTarifaPorPasajero,
  leerCasillaDeItem,
  quitarCasillaDeItem,
} from '@/app/(app)/negocios/tarifa-pax-actions'
import { descartarPropuestaDePantallazo } from '@/app/(app)/negocios/pantallazo-actions'
import type { DefinicionRanura } from '@/lib/cotizaciones/ranuras-pantallazo'
import {
  casillasDe,
  composicionDeLinea,
  confirmadaVigente,
  describirOcupacion,
  formatoMonto,
  leerTarifaPax,
  lineaPorPasajero,
  ocupacionObservada,
  resolverTarifa,
  traeDesgloseCompleto,
  type CasillaDef,
  type ClaveCasilla,
  type Composicion,
  type LecturaCasilla,
} from '@/lib/cotizaciones/tarifa-pasajero'

/**
 * Pantallazos de una línea con precio por tipo de pasajero (diseño §6.1).
 *
 * ## El requisito de esta pantalla
 *
 * *«Que nadie dude qué soporte va en cada casilla.»* Nada de «captura A/B/C» ni de restas a
 * la vista: cada casilla dice con números y palabras la búsqueda literal que hay que hacer
 * en la plataforma (P3), y el resultado se muestra ya partido (P6). De dónde salió cada
 * número queda a un clic (CC5).
 *
 * ## Lo que decide el servidor, no esta pantalla
 *
 * Qué casillas existen, si un pantallazo coincide con la suya y el costo de cada pasajero
 * salen de `tarifa-pasajero.ts`, el MISMO módulo que usa la server action. Aquí solo se
 * pinta: si la pantalla tuviera su propia regla, las casillas que ve la persona y las que
 * acepta el servidor se desincronizarían en silencio.
 */
export default function TarifaPasajeroItem({
  itemId,
  ranura,
  composicionViaje,
  tarifaPax,
  costoUnitarioLinea,
  sugeridosGuardados,
  onCambio,
}: {
  itemId: string
  ranura: DefinicionRanura
  /** La composición del viaje (etapa 1). `null` si el negocio no la tiene. */
  composicionViaje: Composicion | null
  /** `items.tarifa_pax` tal como llega. `undefined` mientras la migración no esté aplicada. */
  tarifaPax: unknown
  /** Costo unitario confirmado de la línea, para saber si el reparto guardado sigue vigente. */
  costoUnitarioLinea: number
  /** Propuesta pendiente del cargue de pantallazo anterior a la tarifa por pasajero. */
  sugeridosGuardados?: { id: string }[]
  onCambio: () => void
}) {
  const tarifa = leerTarifaPax(tarifaPax)
  const composicion = composicionDeLinea(tarifa, composicionViaje)
  const casillas = tarifa.casillas ?? {}

  const [leyendo, setLeyendo] = useState<ClaveCasilla | null>(null)
  const [previews, setPreviews] = useState<Partial<Record<ClaveCasilla, string>>>({})
  const [rechazos, setRechazos] = useState<Partial<Record<ClaveCasilla, { mensaje: string; detalle?: string; pideMoneda?: boolean }>>>({})
  const [ultimoMensaje, setUltimoMensaje] = useState<string | null>(null)
  const [detalleAbierto, setDetalleAbierto] = useState<Partial<Record<ClaveCasilla | 'resultado', boolean>>>({})
  const [editandoComposicion, setEditandoComposicion] = useState(false)
  const [tasa, setTasa] = useState('')
  const [isPending, startTransition] = useTransition()

  const defs = composicion ? casillasDe(composicion, ranura.slug) : []
  const estado = composicion ? resolverTarifa(composicion, casillas, ranura.slug) : null
  const primera = casillas.grupo_completo
  const primeraResuelve = !!(composicion && primera && traeDesgloseCompleto(primera, composicion))

  /** P1: la 1 siempre activa; las demás cuando la 1 no separa los tipos (o ya tienen lectura). */
  const activa = (d: CasillaDef) =>
    !d.condicional || !!casillas[d.clave] || (!!primera && !primeraResuelve)

  function leer(clave: ClaveCasilla, dataUrl: string, monedaIndicada?: string) {
    setPreviews(p => ({ ...p, [clave]: dataUrl }))
    setRechazos(r => ({ ...r, [clave]: undefined }))
    setUltimoMensaje(null)
    setLeyendo(clave)
    void (async () => {
      try {
        const r = await leerCasillaDeItem(itemId, clave, dataUrl, monedaIndicada ?? null)
        if (r.ok) {
          setUltimoMensaje(r.mensaje)
          setPreviews(p => ({ ...p, [clave]: undefined }))
          onCambio()
        } else {
          setRechazos(x => ({ ...x, [clave]: { mensaje: r.mensaje, detalle: r.detalle, pideMoneda: r.pideMoneda } }))
        }
      } finally {
        setLeyendo(null)
      }
    })()
  }

  function pegar(clave: ClaveCasilla, e: React.ClipboardEvent) {
    const entrada = Array.from(e.clipboardData.items).find(i => i.type.startsWith('image/'))
    if (!entrada) return
    e.preventDefault()
    const archivo = entrada.getAsFile()
    if (!archivo) return
    const lector = new FileReader()
    lector.onload = ev => leer(clave, ev.target?.result as string)
    lector.readAsDataURL(archivo)
  }

  function accion(fn: () => Promise<{ success: boolean; error?: string }>, exito: string) {
    startTransition(async () => {
      const r = await fn()
      if (!r.success) { toast.error(r.error ?? 'No se pudo guardar'); return }
      toast.success(exito)
      onCambio()
    })
  }

  const monedaResuelta = estado?.estado === 'resuelta' ? estado.moneda : 'COP'
  const enCOP = monedaResuelta === 'COP'
  const tasaNum = Number(tasa.replace(/[^\d.,]/g, '').replace(',', '.'))
  const tasaValida = enCOP || (Number.isFinite(tasaNum) && tasaNum > 0)

  // ¿Hay una lectura más nueva que la última confirmación? Entonces hay algo por confirmar.
  const ultimaLectura = Object.values(casillas).reduce<string>((m, l) => (l && l.leidaEn > m ? l.leidaEn : m), '')
  const confirmada = tarifa.confirmada ?? null
  const hayPorConfirmar = estado?.estado === 'resuelta' && (!confirmada || ultimaLectura > confirmada.confirmadaEn)
  const confirmadaAlDia = !!confirmada && confirmadaVigente(confirmada, costoUnitarioLinea)

  return (
    <div className="mt-3 rounded-lg border border-dashed p-3">
      {/* ── Qué se pide, ANTES de pegar ── */}
      <div className="mb-2">
        <p className="text-[11px] font-medium">Pantallazo de {ranura.label.toLowerCase()} · precio por pasajero</p>
        <p className="text-[10px] text-muted-foreground">{ranura.queSePide}</p>
        <p className="text-[10px] text-muted-foreground">No sirve: {ranura.queNoSirve}</p>
        <p className="text-[10px] text-muted-foreground">La imagen no se guarda: queda lo que se leyó de ella.</p>
      </div>

      {(sugeridosGuardados?.length ?? 0) > 0 && (
        <div className="mb-2 flex items-center justify-between gap-2 rounded-md border border-amber-300 bg-amber-50 p-2">
          <p className="text-[11px] text-amber-900">
            Hay una propuesta de costo de un pantallazo anterior, sin confirmar. No está en el costo.
          </p>
          <button
            type="button"
            disabled={isPending}
            onClick={() => accion(() => descartarPropuestaDePantallazo(itemId), 'Propuesta anterior descartada.')}
            className="shrink-0 rounded-md border bg-background px-2 py-1 text-[11px] font-medium text-muted-foreground hover:bg-accent disabled:opacity-50"
          >
            Descartar
          </button>
        </div>
      )}

      {/* ── Quiénes cubre esta línea (P7, CC4b) ── */}
      <ComposicionDeLinea
        itemId={itemId}
        composicion={composicion}
        esPropia={!!tarifa.composicion}
        hayViaje={!!composicionViaje}
        editando={editandoComposicion || !composicion}
        onEditar={setEditandoComposicion}
        hayLecturas={Object.keys(casillas).length > 0}
        onCambio={onCambio}
      />

      {composicion && (
        <div className="mt-2 space-y-2">
          {defs.map(d => {
            const lectura = casillas[d.clave]
            const esActiva = activa(d)
            const rechazo = rechazos[d.clave]
            return (
              <div
                key={d.clave}
                className={`rounded-md border p-2.5 ${esActiva ? 'bg-background' : 'bg-muted/40 opacity-70'}`}
              >
                <div className="flex items-start gap-2">
                  <span className={`mt-0.5 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold ${esActiva ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground'}`}>
                    {d.numero}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-baseline gap-x-2">
                      <p className="text-xs font-semibold">{d.titulo}</p>
                      {d.condicional && !esActiva && d.razonCondicional && (
                        <p className="text-[10px] text-muted-foreground">({d.razonCondicional})</p>
                      )}
                    </div>
                    {/* La búsqueda literal. Es EL requisito de la pantalla (P3). */}
                    <p className="text-[11px] text-foreground">{d.busqueda}</p>

                    {lectura && (
                      <LecturaResumen
                        lectura={lectura}
                        abierta={!!detalleAbierto[d.clave]}
                        onToggle={() => setDetalleAbierto(x => ({ ...x, [d.clave]: !x[d.clave] }))}
                        onQuitar={() => accion(() => quitarCasillaDeItem(itemId, d.clave), `Pantallazo ${d.numero} quitado.`)}
                        deshabilitado={isPending || leyendo !== null}
                      />
                    )}

                    {esActiva && (
                      <div
                        onPaste={e => pegar(d.clave, e)}
                        tabIndex={0}
                        aria-label={`Pegar el pantallazo ${d.numero}: ${d.titulo}`}
                        className="mt-1.5 flex min-h-[52px] cursor-pointer items-center justify-center rounded-lg border-2 border-dashed bg-muted/30 p-2 focus:outline-none focus:ring-2 focus:ring-primary/20"
                      >
                        {leyendo === d.clave ? (
                          <span className="flex items-center gap-1 text-[11px] font-medium text-primary">
                            <Loader2 className="h-3 w-3 animate-spin" /> Leyendo el pantallazo {d.numero}…
                          </span>
                        ) : previews[d.clave] ? (
                          // eslint-disable-next-line @next/next/no-img-element -- data URL del portapapeles, no optimizable por next/image
                          <img src={previews[d.clave]} alt={`Pantallazo ${d.numero} pegado`} className="max-h-20 rounded object-contain" />
                        ) : (
                          <span className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                            <ImageIcon className="h-4 w-4" />
                            {lectura
                              ? 'Pega otro pantallazo aquí para reemplazar este (Ctrl+V / Cmd+V)'
                              : 'Pega aquí el pantallazo con Ctrl+V / Cmd+V'}
                          </span>
                        )}
                      </div>
                    )}

                    {rechazo && (
                      <div className="mt-1.5 rounded-md border border-red-300 bg-red-50 p-2">
                        <p className="flex items-start gap-1.5 text-[11px] font-medium text-red-900">
                          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                          {rechazo.mensaje}
                        </p>
                        {rechazo.detalle && <p className="mt-0.5 pl-5 text-[10px] text-red-800">{rechazo.detalle}</p>}
                        {/* RX3: la captura solo muestra «$». La persona dice en qué moneda está
                            y se vuelve a leer: el sistema no la supone (R-P5). */}
                        {rechazo.pideMoneda && previews[d.clave] && (
                          <div className="mt-1.5 flex flex-wrap items-center gap-1.5 pl-5">
                            <span className="text-[10px] text-red-900">¿En qué moneda está el precio?</span>
                            {['COP', 'USD', 'EUR', 'MXN'].map(mon => (
                              <button
                                key={mon}
                                type="button"
                                disabled={leyendo !== null}
                                onClick={() => leer(d.clave, previews[d.clave] as string, mon)}
                                className="rounded border bg-background px-2 py-0.5 text-[11px] font-medium hover:bg-accent disabled:opacity-50"
                              >
                                {mon}
                              </button>
                            ))}
                          </div>
                        )}
                        <p className="mt-0.5 pl-5 text-[10px] text-red-700">Este pantallazo no se guardó.</p>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            )
          })}

          {/* ── Qué encontró (P4) y qué falta ── */}
          {ultimoMensaje && estado?.estado !== 'falta' && estado?.estado !== 'resuelta' && (
            <p className="text-[11px] font-medium">{ultimoMensaje}</p>
          )}
          {estado?.estado === 'falta' && (
            <p className="rounded-md bg-amber-50 p-2 text-[11px] font-medium text-amber-900">{estado.mensaje}</p>
          )}
          {estado?.estado === 'inconsistente' && (
            <p className="rounded-md bg-red-50 p-2 text-[11px] font-medium text-red-900">{estado.mensaje}</p>
          )}
          {estado?.estado === 'confirmar_menor_no_paga' && (
            <div className="rounded-md border border-amber-300 bg-amber-50 p-2">
              <p className="text-[11px] font-medium text-amber-900">{estado.mensaje}</p>
              <button
                type="button"
                disabled={isPending}
                onClick={() => accion(() => confirmarMenorNoPaga(itemId, estado.casilla.clave), 'Queda registrado que ese pasajero no paga.')}
                className="mt-1.5 inline-flex items-center gap-1 rounded-md border bg-background px-2 py-1 text-[11px] font-medium hover:bg-accent disabled:opacity-50"
              >
                <Check className="h-3 w-3" /> Confirmo: no paga en este proveedor
              </button>
            </div>
          )}

          {/* ── El resultado, ya partido (P6) ── */}
          {estado?.estado === 'resuelta' && hayPorConfirmar && (
            <div className="space-y-2 rounded-md border bg-background p-2.5">
              <p className="text-[11px] font-medium">{ultimoMensaje ?? estado.mensaje}</p>
              <p className="text-sm font-semibold tabular-nums">{lineaPorPasajero(estado.costos, estado.moneda)}</p>
              <p className="text-[10px] text-muted-foreground">
                Costo por pasajero, de {describirOcupacion(composicion)}. Es una propuesta: no entra al costo hasta que confirmes.
              </p>

              <button
                type="button"
                onClick={() => setDetalleAbierto(x => ({ ...x, resultado: !x.resultado }))}
                className="flex items-center gap-1 text-[10px] font-medium text-muted-foreground hover:text-foreground"
              >
                {detalleAbierto.resultado ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
                De dónde sale cada valor
              </button>
              {detalleAbierto.resultado && (
                <ul className="space-y-0.5 pl-4 text-[10px] text-muted-foreground">
                  {estado.costos.map(c => (
                    <li key={c.tipo}>
                      <span className="font-medium text-foreground">{lineaPorPasajero([c], estado.moneda)}</span>: {c.deDonde}
                    </li>
                  ))}
                </ul>
              )}

              {Object.values(casillas).flatMap(l => l?.alertas ?? []).filter((a, i, arr) => arr.indexOf(a) === i).map((a, i) => (
                <p key={i} className="flex items-start gap-1.5 rounded bg-amber-50 p-1.5 text-[10px] text-amber-800">
                  <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />
                  {a}
                </p>
              ))}

              {!enCOP && (
                <div>
                  <label className="mb-0.5 block text-[10px] font-medium text-muted-foreground">
                    Tasa de cambio {monedaResuelta} → COP
                  </label>
                  <input
                    type="text"
                    inputMode="decimal"
                    value={tasa}
                    onChange={e => setTasa(e.target.value)}
                    placeholder="ej. 4150"
                    aria-label={`Tasa de cambio ${monedaResuelta} a COP`}
                    className="w-40 rounded border bg-background px-2 py-1 text-sm"
                  />
                  <p className="mt-0.5 text-[10px] text-muted-foreground">
                    El sistema no consulta la TRM: la escribes tú y queda en el costo.
                  </p>
                </div>
              )}

              <button
                type="button"
                disabled={isPending || !tasaValida}
                onClick={() => accion(() => confirmarTarifaPorPasajero(itemId, enCOP ? null : tasaNum), 'Costo por pasajero cargado. Revisa el margen de la línea.')}
                className="inline-flex items-center gap-1 rounded-md bg-primary px-2.5 py-1.5 text-xs font-medium text-primary-foreground disabled:opacity-50"
              >
                <Check className="h-3 w-3" /> Confirmar y cargar el costo
              </button>
              <p className="text-[10px] text-muted-foreground">
                Al confirmar, esto REEMPLAZA los rubros de la línea. El precio lo calcula el margen.
              </p>
            </div>
          )}

          {confirmada && !hayPorConfirmar && (
            <div className="rounded-md border border-emerald-200 bg-emerald-50/60 p-2">
              <p className="text-[11px] font-medium text-emerald-900">
                Costo cargado por pasajero: {lineaPorPasajero(confirmada.costos.map(c => ({ tipo: c.tipo, unitario: c.unitarioCOP })), 'COP')}
              </p>
              {!confirmadaAlDia && (
                <p className="mt-0.5 text-[10px] text-amber-800">
                  El costo de la línea cambió después de confirmar. El precio por pasajero no se imprime hasta volver a confirmar.
                </p>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function LecturaResumen({
  lectura,
  abierta,
  onToggle,
  onQuitar,
  deshabilitado,
}: {
  lectura: LecturaCasilla
  abierta: boolean
  onToggle: () => void
  onQuitar: () => void
  deshabilitado: boolean
}) {
  const obs = ocupacionObservada(lectura)
  const ocupacion = lectura.ocupacionDelItem
    ? 'ocupación no visible en la imagen'
    : obs.adultos !== null || obs.ninos !== null || obs.infantes !== null
      ? describirOcupacion({ adultos: obs.adultos ?? 0, ninos: obs.ninos ?? 0, infantes: obs.infantes ?? 0 })
      : `${obs.total} personas`
  return (
    <div className="mt-1.5 rounded border bg-muted/20 px-2 py-1.5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-[11px]">
          <span className="font-medium">Leído:</span> {formatoMonto(lectura.total, lectura.moneda)} · {ocupacion}
          {lectura.porTipo.length > 0 && ' · con precio por tipo de pasajero'}
          {lectura.aPagarAgencia !== null && ` · a pagar agencia ${formatoMonto(lectura.aPagarAgencia, lectura.moneda)}`}
        </p>
        <div className="flex items-center gap-2">
          <button type="button" onClick={onToggle} className="flex items-center gap-0.5 text-[10px] font-medium text-muted-foreground hover:text-foreground">
            {abierta ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
            Ver lo leído
          </button>
          <button type="button" disabled={deshabilitado} onClick={onQuitar} className="flex items-center gap-0.5 text-[10px] font-medium text-muted-foreground hover:text-red-700 disabled:opacity-50">
            <X className="h-3 w-3" /> Quitar
          </button>
        </div>
      </div>
      {abierta && (
        <div className="mt-1 grid grid-cols-2 gap-x-3 gap-y-0.5 sm:grid-cols-3">
          {lectura.porTipo.map(f => (
            <div key={f.tipo} className="min-w-0">
              <span className="block text-[9px] uppercase tracking-wide text-muted-foreground">Fila {f.tipo === 'nino' ? 'niños' : f.tipo === 'adulto' ? 'adultos' : 'infantes'}</span>
              <span className="block truncate text-[11px] tabular-nums">{f.cantidad} · {formatoMonto(f.subtotal, lectura.moneda)}</span>
            </div>
          ))}
          {lectura.campos.map(c => (
            <div key={c.label} className="min-w-0">
              <span className="block text-[9px] uppercase tracking-wide text-muted-foreground">{c.label}</span>
              <span className="block truncate text-[11px]">{c.valor}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function ComposicionDeLinea({
  itemId,
  composicion,
  esPropia,
  hayViaje,
  editando,
  onEditar,
  hayLecturas,
  onCambio,
}: {
  itemId: string
  composicion: Composicion | null
  esPropia: boolean
  hayViaje: boolean
  editando: boolean
  onEditar: (v: boolean) => void
  hayLecturas: boolean
  onCambio: () => void
}) {
  const [adultos, setAdultos] = useState(String(composicion?.adultos ?? ''))
  const [ninos, setNinos] = useState(String(composicion?.ninos ?? 0))
  const [infantes, setInfantes] = useState(String(composicion?.infantes ?? 0))
  const [isPending, startTransition] = useTransition()

  function guardar(propia: { adultos: string; ninos: string; infantes: string } | null) {
    startTransition(async () => {
      const r = await actualizarComposicionDeItem(itemId, propia)
      if (!r.success) { toast.error(r.error ?? 'No se pudo guardar'); return }
      toast.success(r.borroLecturas
        ? 'Pasajeros de la línea actualizados. Los pantallazos leídos se borraron: eran para otra ocupación.'
        : 'Pasajeros de la línea actualizados.')
      onEditar(false)
      onCambio()
    })
  }

  if (!editando && composicion) {
    return (
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-md bg-muted/30 px-2 py-1.5">
        <p className="text-[11px]">
          <span className="font-medium">Esta línea cubre:</span> {describirOcupacion(composicion)}
          <span className="ml-1 text-muted-foreground">· {esPropia ? 'ajustado en esta línea' : 'la del viaje'}</span>
        </p>
        <button
          type="button"
          onClick={() => onEditar(true)}
          className="flex items-center gap-1 text-[10px] font-medium text-muted-foreground hover:text-foreground"
        >
          <Pencil className="h-3 w-3" /> Cambiar pasajeros de esta línea
        </button>
      </div>
    )
  }

  const numero = (label: string, valor: string, set: (v: string) => void) => (
    <label className="flex flex-col">
      <span className="text-[10px] font-medium text-muted-foreground">{label}</span>
      <input
        type="number"
        min={label === 'Adultos' ? 1 : 0}
        step={1}
        value={valor}
        onChange={e => set(e.target.value)}
        aria-label={`${label} de esta línea`}
        className="w-20 rounded border bg-background px-2 py-1 text-sm tabular-nums"
      />
    </label>
  )

  return (
    <div className="rounded-md border bg-muted/20 p-2">
      <p className="text-[11px] font-medium">
        {composicion ? '¿Cuántos pasajeros cubre esta línea?' : 'Escribe cuántos adultos, niños e infantes cubre esta línea para saber qué pantallazos pegar.'}
      </p>
      <p className="text-[10px] text-muted-foreground">
        Clasifica a cada menor como lo hace este proveedor: la aerolínea y el hotel pueden llamarlo distinto.
      </p>
      <div className="mt-1.5 flex flex-wrap items-end gap-2">
        {numero('Adultos', adultos, setAdultos)}
        {numero('Niños', ninos, setNinos)}
        {numero('Infantes', infantes, setInfantes)}
        <button
          type="button"
          disabled={isPending}
          onClick={() => guardar({ adultos, ninos, infantes })}
          className="rounded-md bg-primary px-2.5 py-1.5 text-xs font-medium text-primary-foreground disabled:opacity-50"
        >
          Guardar
        </button>
        {esPropia && hayViaje && (
          <button
            type="button"
            disabled={isPending}
            onClick={() => guardar(null)}
            className="rounded-md border bg-background px-2.5 py-1.5 text-xs font-medium text-muted-foreground hover:bg-accent disabled:opacity-50"
          >
            Usar la del viaje
          </button>
        )}
        {composicion && (
          <button
            type="button"
            disabled={isPending}
            onClick={() => onEditar(false)}
            className="rounded-md border bg-background px-2.5 py-1.5 text-xs font-medium text-muted-foreground hover:bg-accent disabled:opacity-50"
          >
            Cancelar
          </button>
        )}
      </div>
      {hayLecturas && (
        <p className="mt-1 text-[10px] text-amber-800">
          Cambiar los pasajeros borra los pantallazos leídos de esta línea: eran búsquedas para otra ocupación.
        </p>
      )}
    </div>
  )
}
