'use client'

import { useState, useTransition, type ReactNode } from 'react'
import { AlertTriangle, BedDouble, Check, Image as ImageIcon, Loader2, X } from 'lucide-react'
import { toast } from 'sonner'

import {
  confirmarTarifaPorPasajero,
  leerCasillaDeItem,
  quitarHabitacion,
} from '@/app/(app)/negocios/tarifa-pax-actions'
import {
  habitacionesDeTarifa,
  repartirHabitaciones,
  resolverHabitaciones,
  textoDeCupos,
  textoDeFaltantes,
  type HabitacionRepartida,
} from '@/lib/cotizaciones/habitaciones'
import {
  confirmacionDesactualizada,
  describirOcupacion,
  formatoMonto,
  lineaPorPasajero,
  monedaDeTarifa,
  type Composicion,
  type TarifaPax,
} from '@/lib/cotizaciones/tarifa-pasajero'
import { parseMontoCop } from '@/lib/negocios/monto-cop'

/**
 * R8 · una opción de hotel con varias habitaciones (Mauricio, 2026-09-24).
 *
 * Diseño: `reunion-edgar-alejandra-2026-09-23.md`, «R8 resuelto», regla 5: el bloque dice
 * cuántos lugares del grupo quedan cubiertos («6/6 adultos · 1/1 niño · 0/1 infante») y lo
 * que falta; cada captura dice si es «Habitación N»; la que solo sirve para restar no lleva título. El papel lo decide el
 * reparto: desde la tarjeta del 2026-09-24 ya no se cambia con un toque.
 *
 * Nada de lo que se pinta se decide aquí: el reparto, los cupos y el costo salen de
 * `habitaciones.ts`, el mismo módulo que usa la confirmación en el servidor.
 */
export default function HabitacionesDeOpcion({
  itemId,
  tarifa,
  composicionViaje,
  monedaSlot,
  onGuardada,
  onCambio,
}: {
  itemId: string
  tarifa: TarifaPax
  /** El grupo del negocio: contra él se cuentan los cupos. */
  composicionViaje: Composicion | null
  /** La moneda de la tarifa, con su aceptación (el mismo control de la opción de siempre). */
  monedaSlot: ReactNode
  onGuardada: (t: TarifaPax) => void
  onCambio: () => void
}) {
  const [leyendo, setLeyendo] = useState(false)
  const [rechazo, setRechazo] = useState<string | null>(null)
  const [tasa, setTasa] = useState('')
  const [isPending, startTransition] = useTransition()

  const grupo = composicionViaje ?? tarifa.composicion ?? null
  const habitaciones = habitacionesDeTarifa(tarifa)
  const reparto = repartirHabitaciones(habitaciones, grupo)
  const faltantes = textoDeFaltantes(reparto)
  const monedaTarifa = monedaDeTarifa(tarifa)
  const estado = resolverHabitaciones(tarifa, grupo, { moneda: monedaTarifa.moneda })
  const confirmada = tarifa.confirmada ?? null
  const confirmacionVieja = confirmacionDesactualizada(tarifa, tarifa.composicion ?? null)
  const ultimaLectura = habitaciones.reduce((m, h) => (h.lectura.leidaEn > m ? h.lectura.leidaEn : m), '')
  const hayPorConfirmar = estado.estado === 'resuelta'
    && (!confirmada || ultimaLectura > confirmada.confirmadaEn || !!confirmacionVieja)

  const monedaResuelta = estado.estado === 'resuelta' ? estado.moneda : 'COP'
  const enCOP = monedaResuelta === 'COP'
  const tasaNum = parseMontoCop(tasa) ?? Number.NaN
  const tasaValida = enCOP || (Number.isFinite(tasaNum) && tasaNum > 0)
  const ocupado = isPending || leyendo

  function accion(fn: () => Promise<{ success: boolean; error?: string; tarifa?: TarifaPax }>, exito: string) {
    startTransition(async () => {
      const r = await fn()
      if (!r.success) { toast.error(r.error ?? 'No se pudo guardar'); return }
      if (r.tarifa) onGuardada(r.tarifa)
      toast.success(exito)
      onCambio()
    })
  }

  function leer(dataUrl: string) {
    setRechazo(null)
    setLeyendo(true)
    void (async () => {
      try {
        const r = await leerCasillaDeItem(itemId, 'grupo_completo', dataUrl, null, null, { comoHabitacion: true })
        if (r.ok) {
          onGuardada(r.tarifa)
          toast.success('Habitación agregada.')
          onCambio()
        } else {
          setRechazo(r.mensaje)
        }
      } catch {
        setRechazo('No se pudo leer el pantallazo. Vuelve a pegarlo.')
      } finally {
        setLeyendo(false)
      }
    })()
  }

  function pegar(e: React.ClipboardEvent) {
    const entrada = Array.from(e.clipboardData.items).find(i => i.type.startsWith('image/'))
    if (!entrada) return
    e.preventDefault()
    const archivo = entrada.getAsFile()
    if (!archivo) return
    const lector = new FileReader()
    lector.onload = ev => leer(ev.target?.result as string)
    lector.readAsDataURL(archivo)
  }

  return (
    <div className="mt-3 space-y-2 rounded-lg border border-dashed p-3" data-habitaciones-opcion>
      <div>
        <p className="flex items-center gap-1.5 text-[11px] font-medium">
          <BedDouble className="h-3.5 w-3.5" aria-hidden />
          Habitaciones de esta opción
        </p>
        <p className="mt-0.5 text-sm font-semibold tabular-nums" data-cupos>{textoDeCupos(reparto)}</p>
        {faltantes && (
          <p className="mt-1 flex items-start gap-1.5 rounded bg-amber-50 p-1.5 text-[11px] font-medium text-amber-900" data-faltantes>
            <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />
            {faltantes}
          </p>
        )}
        {!grupo && (
          <p className="mt-1 text-[10px] text-muted-foreground">
            El negocio no dice quiénes viajan: los cupos se cuentan cuando se registre el grupo.
          </p>
        )}
      </div>

      <ul className="space-y-1.5" aria-label="Habitaciones">
        {reparto.habitaciones.map(h => (
          <FilaHabitacion
            key={h.id}
            h={h}
            deshabilitado={ocupado}
            onQuitar={() => accion(() => quitarHabitacion(itemId, h.id), 'Habitación quitada.')}
          />
        ))}
      </ul>

      <div
        tabIndex={0}
        role="button"
        aria-label="Pega otra habitación de este hotel"
        onPaste={pegar}
        className="flex min-h-[40px] items-center justify-center gap-1.5 rounded-lg border border-dashed bg-[#F5F4F2] p-2 text-[11px] text-[#6B7280] focus:outline-none focus:ring-2 focus:ring-[#10B981]/30"
      >
        {leyendo ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ImageIcon className="h-3.5 w-3.5" />}
        {leyendo ? 'Leyendo la habitación…' : 'Pega otra habitación de este hotel (Ctrl+V / Cmd+V)'}
      </div>
      {rechazo && <p className="text-[11px] font-medium text-red-700">{rechazo}</p>}

      {monedaSlot}

      {estado.estado === 'inconsistente' && (
        <p className="rounded-md bg-red-50 p-2 text-[11px] font-medium text-red-900">{estado.mensaje}</p>
      )}

      {estado.estado === 'resuelta' && hayPorConfirmar && (
        <div className="space-y-2 rounded-md border bg-background p-2.5">
          {confirmacionVieja && (
            <p className="flex items-start gap-1.5 rounded bg-amber-50 p-1.5 text-[11px] font-medium text-amber-900">
              <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />
              {confirmacionVieja.mensaje}
            </p>
          )}
          <p className="text-[11px] font-medium">{estado.mensaje}</p>
          {estado.costos.length > 0 ? (
            <p className="text-sm font-semibold tabular-nums">{lineaPorPasajero(estado.costos, estado.moneda)}</p>
          ) : (
            <ul className="space-y-0.5 text-sm font-semibold tabular-nums">
              {(estado.porHabitacion ?? []).map(h => (
                <li key={h.numero}>
                  Habitación {h.numero} · {describirOcupacion(h.ocupacion, 'y')}: {formatoMonto(h.total, estado.moneda)}
                </li>
              ))}
            </ul>
          )}
          <p className="text-[10px] text-muted-foreground">
            Costo de la opción: {formatoMonto(estado.costoTotal, estado.moneda)}. Es una propuesta: no entra al costo hasta que confirmes.
          </p>

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
            </div>
          )}
          {monedaTarifa.asumida && (
            <p className="text-[10px] font-medium text-amber-800">
              Acepta o cambia la moneda de la tarifa (arriba) para poder confirmar el costo.
            </p>
          )}
          <button
            type="button"
            disabled={ocupado || !tasaValida || monedaTarifa.asumida}
            onClick={() => accion(() => confirmarTarifaPorPasajero(itemId, enCOP ? null : tasaNum), 'Costo de las habitaciones cargado. Revisa el margen de la línea.')}
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
        <div className={confirmacionVieja
          ? 'rounded-md border border-amber-300 bg-amber-50 p-2'
          : 'rounded-md border border-emerald-200 bg-emerald-50/60 p-2'}
        >
          {confirmacionVieja && (
            <p className="mb-1 flex items-start gap-1.5 text-[11px] font-medium text-amber-900">
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              {confirmacionVieja.mensaje}
            </p>
          )}
          <p className={`text-[11px] font-medium ${confirmacionVieja ? 'text-amber-900' : 'text-emerald-900'}`}>
            {confirmada.costos.length > 0
              ? `Costo cargado por pasajero: ${lineaPorPasajero(confirmada.costos.map(c => ({ tipo: c.tipo, unitario: c.unitarioCOP })), 'COP')}`
              : `Costo cargado por habitación: ${(confirmada.porHabitacion ?? []).map(h => `Habitación ${h.numero} ${formatoMonto(h.totalCOP, 'COP')}`).join(' · ')}`}
          </p>
        </div>
      )}
    </div>
  )
}

/** Una captura de la opción: su papel, a quién cubre y su precio. */
export function FilaHabitacion({
  h,
  deshabilitado,
  onQuitar,
}: {
  h: HabitacionRepartida
  deshabilitado: boolean
  onQuitar: () => void
}) {
  // El papel de la captura lo decide el reparto. El que una persona fijó antes (`rolManual`)
  // sigue en los datos, pero ya no se cambia desde la pantalla (tarjeta del 2026-09-24).
  const esHabitacion = h.rol === 'habitacion'
  return (
    <li className="flex items-start gap-2 rounded-md border bg-background px-2 py-1.5" data-habitacion={h.id}>
      <div className="min-w-0 flex-1">
        <p className="text-[11px] font-semibold">
          {/* La captura que solo sirve para restar no lleva título: la explica su nota. */}
          {esHabitacion ? `Habitación ${h.numero}` : null}
          {h.manual && <span className="ml-1 font-normal text-muted-foreground">(fijado a mano)</span>}
        </p>
        <p className="text-[11px] text-[#1A1A1A]">
          {h.ocupacion ? describirOcupacion(h.ocupacion, 'y') : 'No dice a cuántos cubre'}
          {h.tipoHabitacion ? ` · ${h.tipoHabitacion}` : ''}
          {' · '}
          <span className="tabular-nums">{formatoMonto(h.total, h.moneda)}</span>
        </p>
        {h.sirveParaRestar && (
          <p className="text-[10px] text-muted-foreground">Sirve para restar el precio del menor de su mismo tipo de habitación.</p>
        )}
      </div>
      <button
        type="button"
        disabled={deshabilitado}
        onClick={onQuitar}
        aria-label="Quitar esta habitación"
        className="shrink-0 rounded p-1 text-[#6B7280] hover:bg-red-50 hover:text-red-600 disabled:opacity-50"
      >
        <X className="h-3.5 w-3.5" />
      </button>
    </li>
  )
}

/**
 * R8 · en una opción de hotel de una sola captura: pegar otra habitación del mismo hotel la
 * vuelve una opción con habitaciones. Tiene que ser el mismo hotel con las mismas fechas: si
 * no, el servidor lo dice y la captura va a la bandeja.
 */
export function PegarOtraHabitacion({
  itemId,
  deshabilitado,
  onGuardada,
  onCambio,
}: {
  itemId: string
  deshabilitado: boolean
  onGuardada: (t: TarifaPax) => void
  onCambio: () => void
}) {
  const [leyendo, setLeyendo] = useState(false)
  const [rechazo, setRechazo] = useState<string | null>(null)

  function pegar(e: React.ClipboardEvent) {
    if (deshabilitado || leyendo) return
    const entrada = Array.from(e.clipboardData.items).find(i => i.type.startsWith('image/'))
    if (!entrada) return
    e.preventDefault()
    const archivo = entrada.getAsFile()
    if (!archivo) return
    const lector = new FileReader()
    lector.onload = ev => {
      const dataUrl = ev.target?.result as string
      setRechazo(null)
      setLeyendo(true)
      void (async () => {
        try {
          const r = await leerCasillaDeItem(itemId, 'grupo_completo', dataUrl, null, null, { comoHabitacion: true })
          if (r.ok) {
            onGuardada(r.tarifa)
            toast.success('Habitación agregada: la opción ahora cuenta sus habitaciones.')
            onCambio()
          } else {
            setRechazo(r.mensaje)
          }
        } catch {
          setRechazo('No se pudo leer el pantallazo. Vuelve a pegarlo.')
        } finally {
          setLeyendo(false)
        }
      })()
    }
    lector.readAsDataURL(archivo)
  }

  return (
    <div className="mt-2">
      <div
        tabIndex={0}
        role="button"
        aria-label="Pega otra habitación de este hotel"
        onPaste={pegar}
        className="flex min-h-[36px] items-center justify-center gap-1.5 rounded-lg border border-dashed bg-[#F5F4F2] p-2 text-[11px] text-[#6B7280] focus:outline-none focus:ring-2 focus:ring-[#10B981]/30"
      >
        {leyendo ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <BedDouble className="h-3.5 w-3.5" />}
        {leyendo ? 'Leyendo la habitación…' : '¿El grupo va en más de una habitación? Pega aquí la otra (mismo hotel, mismas fechas)'}
      </div>
      {rechazo && <p className="mt-1 text-[11px] font-medium text-red-700">{rechazo}</p>}
    </div>
  )
}
