'use client'

import { useEffect, useId, useRef, useState, useTransition, type DragEvent, type ReactNode } from 'react'
import { toast } from 'sonner'

import {
  cambiarPantallazoDeHabitacion,
  corregirCampoDeFicha,
  corregirHabitacion,
  quitarHabitacionDeOpcion,
  sumarHabitacionAOpcion,
} from '@/app/(app)/negocios/tarifa-pax-actions'
import HojaCliente from '@/app/(app)/negocios/hoja-cliente'
import TarjetaCosto from '@/app/(app)/negocios/tarjeta-costo'
import { AlertaDecision } from '@/components/viaje/alerta-decision'
import { BTN, BTN_PRIM, INPUT } from '@/components/viaje/estilo'
import { ItemMenu, MenuAcciones, SeparadorMenu } from '@/components/viaje/menu-acciones'
import { Miniatura, useVistaAmpliada } from '@/components/viaje/pantallazo'
import type { FilaAdicional } from '@/lib/cotizaciones/adicionales'
import { aplicarCorrecciones, esCorregible, leerCorrecciones, leidosPorSlug } from '@/lib/cotizaciones/correcciones'
import { cargoDeItem, hotelesDeItems, type ItemConLectura } from '@/lib/cotizaciones/detalle-viaje'
import {
  costoPorTipoDeHabitaciones,
  habitacionesDeTarifa,
  ID_HABITACION_UNICA,
  repartirHabitaciones,
  type HabitacionRepartida,
} from '@/lib/cotizaciones/habitaciones'
import { fichaDeOpcion, resumenDeOpcion } from '@/lib/cotizaciones/opcion-viaje'
import type { ConvencionMargen } from '@/lib/cotizaciones/precio-item'
import { esNombreDeOpcion } from '@/lib/cotizaciones/ranuras-cotizacion'
import { ranuraDeGrupo } from '@/lib/cotizaciones/ranuras-pantallazo'
import {
  formatoMonto,
  monedaDeTarifa,
  type Composicion,
  type TarifaConfirmada,
  type TarifaPax,
} from '@/lib/cotizaciones/tarifa-pasajero'
import {
  fechasDeEstadia,
  nochesTexto,
  notaDeEdad,
  notaDeReferencia,
  ocupacionConEdades,
  pesos,
  resumenDeAlojamiento,
} from '@/lib/cotizaciones/tarjeta-opcion'
import { parseMontoCop } from '@/lib/negocios/monto-cop'

/**
 * La tarjeta de una opción de viaje (prototipo aprobado por Mauricio el 2026-09-24,
 * `proyectos/trappvel/clarity/docs/diseno/prototipo-tarjeta-2026-09-24/`), en su orden:
 * la cabecera (Opción N, el nombre, el precio, ⚠ y ⋯), la ficha, el alojamiento (solo hotel),
 * «Costo y precio» y lo que la opción todavía necesite a mano.
 *
 * Todo lo que se pinta sale de `tarjeta-opcion.ts` y de `habitaciones.ts`: la tarjeta, el
 * documento y la confirmación del costo cuentan con las mismas reglas.
 *
 * Solo el flujo de viaje (Trappvel) la monta; el resto del editor no cambia (R6).
 */

const ESPERA_DESHACER_MS = 6000

/** Lo que una persona escribe en la ficha, con el rótulo del prototipo. */
const CAMPOS_FICHA_HOTEL: readonly { slug: string; label: string }[] = [
  { slug: 'hotel', label: 'Hotel' },
  { slug: 'tipo_habitacion', label: 'Habitación' },
  { slug: 'regimen', label: 'Régimen' },
  { slug: 'check_in', label: 'Entrada' },
  { slug: 'check_out', label: 'Salida' },
  // ⚠️ El prototipo dice «Cancelación gratis hasta» y guarda una fecha; aquí se guarda la
  // política tal como la leyó la captura («No reembolsable», «Gratis hasta…»), así que el
  // rótulo no puede prometer una fecha.
  { slug: 'politica_cancelacion', label: 'Cancelación' },
]
const CAMPOS_FICHA_VUELO: readonly { slug: string; label: string }[] = [
  { slug: 'aerolinea', label: 'Aerolínea' },
  { slug: 'numero_vuelo', label: 'Vuelo' },
  { slug: 'fecha_salida', label: 'Salida' },
  { slug: 'fecha_regreso', label: 'Regreso' },
  { slug: 'familia_tarifa', label: 'Tarifa' },
]

function leerArchivo(archivo: File): Promise<string> {
  return new Promise((ok, mal) => {
    const lector = new FileReader()
    lector.onload = ev => ok(String(ev.target?.result ?? ''))
    lector.onerror = () => mal(new Error('No se pudo leer el archivo.'))
    lector.readAsDataURL(archivo)
  })
}

/** El enlace de un pantallazo guardado: lo firma la ruta de archivos, que valida la sesión. */
const urlDePantallazo = (ref: string | null | undefined) =>
  ref ? `/api/archivos/abrir?ref=${encodeURIComponent(ref)}` : null

const chev = (abierta: boolean) => (
  <svg
    className={`shrink-0 text-[#6E6A62] transition-transform ${abierta ? 'rotate-90' : ''}`}
    width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden
  >
    <path d="m9 6 6 6-6 6" />
  </svg>
)

const Rotulo = ({ children }: { children: ReactNode }) => (
  <p className="m-0 flex items-center gap-2 text-[11px] font-bold uppercase tracking-[.08em] text-[#6E6A62]">
    {children}<span className="h-px flex-1 bg-[#E2DED5]" />
  </p>
)

export interface PendienteEnBandeja {
  /** La fila de la bandeja que espera la decisión. */
  capturaId: string
}

export default function TarjetaOpcion({
  itemId,
  numero,
  item,
  tarifa,
  composicionViaje,
  editable,
  abierta,
  onAlternar,
  precioOpcion,
  precioLinea,
  costoLinea,
  confirmada,
  margenAplicado,
  convencion,
  administrativosPct,
  pisoPct,
  adicionales,
  adicionalesDisponible,
  margenCotizacion,
  pendiente,
  onIrABandeja,
  onEliminar,
  onMover,
  mover,
  respaldo,
  nota,
  bloqueTitulo,
  general = false,
  onGuardarNota,
  onCambio,
}: {
  itemId: string
  numero: number
  item: ItemConLectura
  tarifa: TarifaPax
  composicionViaje: Composicion | null
  editable: boolean
  abierta: boolean
  onAlternar: () => void
  /** Lo que paga el cliente por la opción, con sus adicionales. */
  precioOpcion: number
  /** El precio de la línea que calculó la cascada, sin adicionales. */
  precioLinea: number
  costoLinea: number
  /** La confirmación del costo, solo si sigue siendo el costo de la línea. */
  confirmada: TarifaConfirmada | null
  margenAplicado: number
  convencion: ConvencionMargen
  administrativosPct: number
  pisoPct: number
  adicionales: FilaAdicional[]
  adicionalesDisponible: boolean
  margenCotizacion: { margenPct: number | null; convencion: ConvencionMargen | null }
  /** Un pantallazo de este hotel espera en la bandeja la decisión de si sobra. */
  pendiente: PendienteEnBandeja | null
  onIrABandeja: (capturaId: string) => void
  /** «Eliminar opción»: ya confirmado; sus pantallazos vuelven a la bandeja. */
  onEliminar: (nombre: string) => void
  /** «Mover a otro bloque». */
  onMover: () => void
  /** El selector de bloque, cuando se está moviendo. */
  mover: ReactNode
  /** Lo que la opción todavía necesita a mano (sin costo confirmado). */
  respaldo: ReactNode
  /** La nota para el cliente de una opción que no es hotel (el hotel la escribe sobre la hoja). */
  nota: ReactNode
  /** «Hotel en Providencia»: el bloque, como lo nombra la hoja del cliente. */
  bloqueTitulo: string
  /** El nivel de detalle del documento: «general» no nombra habitación ni régimen. */
  general?: boolean
  onGuardarNota: (texto: string) => void
  onCambio: () => void
}) {
  const ranura = ranuraDeGrupo(item.grupo)
  const esHotel = ranura?.slug === 'hotel_detalle'
  const [hotel] = esHotel ? hotelesDeItems([item]) : [null]
  const nombre = (esHotel ? hotel?.hotel : null) || item.nombre || `Opción ${numero}`
  const estrellas = esHotel ? hotel?.estrellas ?? null : null

  const grupo = composicionViaje ?? tarifa.composicion ?? null
  const habitaciones = esHotel ? habitacionesDeTarifa(tarifa) : []
  const reparto = esHotel && habitaciones.length > 0 ? repartirHabitaciones(habitaciones, grupo) : null
  const resumenAloj = reparto ? resumenDeAlojamiento(reparto) : null

  const [confirmaBorrar, setConfirmaBorrar] = useState(false)
  const [editandoFicha, setEditandoFicha] = useState(false)
  const [isPending, startTransition] = useTransition()
  const { ampliar, vista } = useVistaAmpliada()
  const entradaPantallazo = useRef<HTMLInputElement>(null)

  // La fila cerrada dice lo que sirve para comparar: habitación, habitaciones y si cubre al grupo.
  const subCerrada = esHotel && resumenAloj
    ? (
      <>
        {[hotel?.habitacion, `${resumenAloj.habitaciones} ${resumenAloj.habitaciones === 1 ? 'habitación' : 'habitaciones'}`].filter(Boolean).join(' · ')}
        {' · '}
        {resumenAloj.falta
          ? <span className="font-semibold text-[#9A5F0C]">{resumenAloj.falta.verbo.toLowerCase()} {resumenAloj.falta.quien}</span>
          : grupo ? `cubre a los ${grupo.adultos + grupo.ninos + grupo.infantes}` : null}
      </>
    )
    : resumenDeOpcion(item)
  const subAbierta = esHotel ? (hotel?.ciudad ?? null) : resumenDeOpcion(item)
  // «Opción 2» es un relleno hasta que se lea su pantallazo, y lo dice.
  const sinPantallazo = !tarifa.casillas?.grupo_completo && habitaciones.length === 0 && esNombreDeOpcion(item.nombre)

  function cambiarPantallazo(archivo: File) {
    startTransition(async () => {
      const dataUrl = await leerArchivo(archivo)
      const r = await cambiarPantallazoDeHabitacion(itemId, ID_HABITACION_UNICA, dataUrl)
      if (!r.ok) { toast.error(r.mensaje); return }
      if (r.pendiente) toast.warning(r.pendiente)
      onCambio()
    })
  }

  const menuOpcion = (cerrar: () => void) => confirmaBorrar ? (
    <span className="flex flex-col gap-2 px-2.5 py-2 text-[13px]" data-confirma-borrar>
      <span>¿Eliminas {nombre} de este bloque? Sus habitaciones vuelven a la bandeja.</span>
      <span className="flex gap-2">
        <button
          type="button"
          className="rounded-lg border border-[#B3382C] bg-[#B3382C] px-2.5 py-1.5 text-[13px] font-semibold text-white"
          onClick={() => { setConfirmaBorrar(false); cerrar(); onEliminar(nombre) }}
        >
          Eliminar
        </button>
        <button type="button" className={BTN} onClick={() => { setConfirmaBorrar(false); cerrar() }}>Cancelar</button>
      </span>
    </span>
  ) : (
    <>
      <ItemMenu onClick={() => { cerrar(); setEditandoFicha(true); if (!abierta) onAlternar() }}>Corregir datos</ItemMenu>
      {habitaciones.length <= 1 && (
        <ItemMenu onClick={() => { cerrar(); entradaPantallazo.current?.click() }}>Cambiar pantallazo</ItemMenu>
      )}
      <ItemMenu onClick={() => { cerrar(); onMover() }}>Mover a otro bloque</ItemMenu>
      <SeparadorMenu />
      <ItemMenu peligro onClick={() => setConfirmaBorrar(true)}>Eliminar opción</ItemMenu>
    </>
  )

  return (
    <div
      className={`rounded-[10px] border bg-white text-sm text-[#191713] ${abierta ? 'border-[#CFCAC0]' : 'border-[#E2DED5]'}`}
      data-tarjeta-opcion={itemId}
      data-linea-id={itemId}
    >
      <div className="flex items-center gap-1.5 py-2.5 pl-3 pr-2">
        <button
          type="button"
          onClick={onAlternar}
          aria-expanded={abierta}
          className="flex min-w-0 flex-1 items-center gap-2.5 border-0 bg-transparent py-0.5 text-left"
        >
          {chev(abierta)}
          <span className="min-w-0">
            <span className="block text-xs font-semibold text-[#6E6A62]">Opción {numero}</span>
            <span className="flex flex-wrap items-center gap-1.5 text-base font-bold">
              {nombre}
              {estrellas ? <span className="text-xs tracking-[1px] text-[#C98A00]" aria-label={`${estrellas} estrellas`}>{'★'.repeat(estrellas)}</span> : null}
            </span>
            {sinPantallazo ? (
              <span className="block text-[13px] text-[#6E6A62] max-sm:text-xs">pega el pantallazo</span>
            ) : (abierta ? subAbierta : subCerrada) && (
              <span className="block text-[13px] text-[#6E6A62] max-sm:text-xs">{abierta ? subAbierta : subCerrada}</span>
            )}
            <span className="mt-0.5 hidden text-sm font-bold tabular-nums max-sm:block">{pesos(precioOpcion)}</span>
          </span>
        </button>
        {pendiente && (
          <AlertaDecision tip="Hay un pantallazo de este hotel esperando tu decisión">
            <p className="m-0">Hay un pantallazo de <b>{nombre}</b> en la bandeja que ONE no sabe dónde poner: el grupo ya está cubierto aquí. Decide si sobra o si es una habitación más.</p>
            <span className="flex flex-wrap gap-2">
              <button type="button" className={BTN} onClick={() => onIrABandeja(pendiente.capturaId)}>Ir a la bandeja</button>
            </span>
          </AlertaDecision>
        )}
        <span className="shrink-0 pr-0.5 text-right max-sm:hidden">
          <small className="block text-[11px] text-[#6E6A62]">Precio</small>
          <b className="text-[15px] tabular-nums">{pesos(precioOpcion)}</b>
        </span>
        {editable && <MenuAcciones contenido={menuOpcion} />}
        <input
          ref={entradaPantallazo}
          type="file"
          accept="image/*"
          hidden
          onChange={e => {
            const f = e.target.files?.[0]
            e.target.value = ''
            if (f) cambiarPantallazo(f)
          }}
        />
      </div>

      {mover}

      {abierta && (
        <div className="flex flex-col gap-5 px-3.5 pb-4" data-opcion-abierta={itemId}>
          {editandoFicha && editable ? (
            <FormFicha
              itemId={itemId}
              tarifa={tarifa}
              esHotel={esHotel}
              grupoItem={item.grupo}
              onListo={() => { setEditandoFicha(false); onCambio() }}
              onCancelar={() => setEditandoFicha(false)}
            />
          ) : (
            <Ficha item={item} esHotel={esHotel} composicion={grupo} />
          )}

          {esHotel && reparto && resumenAloj && (
            <Alojamiento
              itemId={itemId}
              reparto={reparto}
              resumen={resumenAloj}
              editable={editable}
              ampliar={ampliar}
              onCambio={onCambio}
            />
          )}

          <TarjetaCosto
            itemId={itemId}
            editable={editable}
            confirmada={confirmada}
            preciosAMano={tarifa.preciosAMano}
            precioLinea={precioLinea}
            costoLinea={costoLinea}
            margenAplicado={margenAplicado}
            convencion={convencion}
            administrativosPct={administrativosPct}
            pisoPct={pisoPct}
            adicionales={adicionales}
            adicionalesDisponible={adicionalesDisponible}
            margenCotizacion={margenCotizacion}
            moneda={monedaDeTarifa(tarifa)}
            onCambio={onCambio}
          />

          {!confirmada && respaldo}

          {esHotel ? (
            <HojaCliente
              item={item}
              numero={numero}
              bloqueTitulo={bloqueTitulo}
              general={general}
              adicionales={adicionales}
              confirmada={confirmada}
              preciosAMano={tarifa.preciosAMano}
              precioLinea={precioLinea}
              precioOpcion={precioOpcion}
              editable={editable}
              onGuardarNota={onGuardarNota}
            />
          ) : nota}
        </div>
      )}
      {isPending && <span className="sr-only" role="status">Guardando…</span>}
      {vista}
    </div>
  )
}

// ── La ficha ─────────────────────────────────────────────────────────────────

function Ficha({ item, esHotel, composicion }: { item: ItemConLectura; esHotel: boolean; composicion: Composicion | null }) {
  if (esHotel) {
    const [h] = hotelesDeItems([item])
    const cargo = cargoDeItem(item)
    const fechas = h ? fechasDeEstadia(h.checkIn, h.checkOut) : null
    const noches = h ? nochesTexto(h.noches) : null
    const filas: { dt: string; dd: ReactNode }[] = []
    if (h?.habitacion) filas.push({ dt: 'Habitación', dd: h.habitacion })
    if (h?.regimen) filas.push({ dt: 'Régimen', dd: h.regimen })
    if (fechas) filas.push({ dt: 'Fechas', dd: <>{fechas}{noches && <small className="text-xs font-normal text-[#6E6A62]"> · {noches}</small>}</> })
    if (h?.cancelacion) filas.push({ dt: 'Cancelación', dd: h.cancelacion })
    if (cargo) {
      filas.push({
        dt: 'Se paga en el destino',
        dd: <>{`${cargo.valor.toLocaleString('es-CO')}${cargo.moneda ? ` ${cargo.moneda}` : ''}`}<small className="text-xs font-normal text-[#6E6A62]"> · lo paga el viajero allá</small></>,
      })
    }
    if (filas.length === 0) return null
    return (
      <dl className="m-0 grid grid-cols-3 gap-x-4 gap-y-2 rounded-lg border border-[#E2DED5] bg-[#F8F7F3] p-3 max-sm:grid-cols-2" data-ficha>
        {filas.map(f => (
          <div key={f.dt} className="flex min-w-0 flex-col">
            <dt className="text-[11px] text-[#6E6A62]">{f.dt}</dt>
            <dd className="m-0 font-medium">{f.dd}</dd>
          </div>
        ))}
      </dl>
    )
  }
  const renglones = fichaDeOpcion(item, composicion)
  if (renglones.length === 0) return null
  return (
    <ul className="m-0 flex list-none flex-col gap-1 rounded-lg border border-[#E2DED5] bg-[#F8F7F3] p-3" data-ficha>
      {renglones.map((r, i) => <li key={i} className={i === 0 ? 'font-medium' : ''}>{r}</li>)}
    </ul>
  )
}

function FormFicha({
  itemId,
  tarifa,
  esHotel,
  grupoItem,
  onListo,
  onCancelar,
}: {
  itemId: string
  tarifa: TarifaPax
  esHotel: boolean
  grupoItem: string | null
  onListo: () => void
  onCancelar: () => void
}) {
  const ranura = ranuraDeGrupo(grupoItem)
  const lectura = tarifa.casillas?.grupo_completo ?? tarifa.habitaciones?.[0]?.lectura ?? null
  const vigentes = ranura && lectura
    ? aplicarCorrecciones(leidosPorSlug(ranura, lectura.campos), leerCorrecciones(tarifa.correcciones))
    : {}
  const campos = (esHotel ? CAMPOS_FICHA_HOTEL : CAMPOS_FICHA_VUELO)
    .filter(c => ranura && esCorregible(ranura, c.slug))
  const [valores, setValores] = useState<Record<string, string>>(() =>
    Object.fromEntries(campos.map(c => [c.slug, vigentes[c.slug] ?? ''])))
  const [isPending, startTransition] = useTransition()

  function guardar(e: React.FormEvent) {
    e.preventDefault()
    const cambios = campos.filter(c => (valores[c.slug] ?? '').trim() !== (vigentes[c.slug] ?? '').trim())
    if (cambios.length === 0) { onCancelar(); return }
    startTransition(async () => {
      for (const c of cambios) {
        const v = (valores[c.slug] ?? '').trim()
        const r = await corregirCampoDeFicha(itemId, c.slug, v === '' ? null : v)
        if (!r.success) { toast.error(`${c.label}: ${r.error ?? 'no se pudo guardar'}`); return }
      }
      toast('Guardado. La vista del cliente ya muestra el cambio.')
      onListo()
    })
  }

  return (
    <form onSubmit={guardar} className="grid grid-cols-3 gap-x-3 gap-y-2 rounded-lg border border-[#CFCAC0] bg-[#F8F7F3] p-3 max-sm:grid-cols-2" data-ficha-editar>
      {campos.map(c => (
        <label key={c.slug} className="flex flex-col gap-0.5 text-xs text-[#6E6A62]">
          <span>{c.label}</span>
          <input className={INPUT} value={valores[c.slug] ?? ''} onChange={e => setValores(v => ({ ...v, [c.slug]: e.target.value }))} />
        </label>
      ))}
      <span className="col-span-full flex flex-wrap gap-2">
        <button type="submit" className={BTN_PRIM} disabled={isPending}>Guardar</button>
        <button type="button" className={BTN} onClick={onCancelar}>Cancelar</button>
      </span>
    </form>
  )
}

// ── El alojamiento ───────────────────────────────────────────────────────────

function Alojamiento({
  itemId,
  reparto,
  resumen,
  editable,
  ampliar,
  onCambio,
}: {
  itemId: string
  reparto: ReturnType<typeof repartirHabitaciones>
  resumen: NonNullable<ReturnType<typeof resumenDeAlojamiento>>
  editable: boolean
  ampliar: (src: string, caption: string) => void
  onCambio: () => void
}) {
  // «Quitar habitación» se ve en el acto y se hace al vencer el «Deshacer».
  const [quitadas, setQuitadas] = useState<ReadonlySet<string>>(() => new Set())
  const enEspera = useRef(new Map<string, { reloj: ReturnType<typeof setTimeout>; ejecutar: () => void }>())
  useEffect(() => {
    const pendientes = enEspera.current
    return () => {
      for (const { reloj, ejecutar } of pendientes.values()) { clearTimeout(reloj); ejecutar() }
      pendientes.clear()
    }
  }, [])

  const porTipo = costoPorTipoDeHabitaciones(reparto)
  const visibles = reparto.habitaciones.filter(h => !quitadas.has(h.id))

  function quitar(h: HabitacionRepartida, indice: number) {
    if (enEspera.current.has(h.id)) return
    const mostrar = () => setQuitadas(prev => { const n = new Set(prev); n.delete(h.id); return n })
    setQuitadas(prev => new Set([...prev, h.id]))
    const ejecutar = () => {
      enEspera.current.delete(h.id)
      void quitarHabitacionDeOpcion(itemId, h.id).then(r => {
        if (!r.success) { toast.error(r.error ?? 'No se pudo quitar la habitación.'); mostrar(); return }
        if (r.pendiente) toast.warning(r.pendiente)
        onCambio()
      })
    }
    const reloj = setTimeout(ejecutar, ESPERA_DESHACER_MS)
    enEspera.current.set(h.id, { reloj, ejecutar })
    toast(`Quitaste la habitación ${h.numero ?? indice + 1}.`, {
      duration: ESPERA_DESHACER_MS,
      action: { label: 'Deshacer', onClick: () => { clearTimeout(reloj); enEspera.current.delete(h.id); mostrar() } },
    })
  }

  return (
    <section aria-label="Alojamiento" className="flex flex-col gap-2.5" data-alojamiento>
      <Rotulo>Alojamiento</Rotulo>
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <b className="text-[15px]">{resumen.titulo}</b>
        {resumen.cupos.length > 0 && (
          <span className="text-xs text-[#6E6A62]" data-cupos>
            {resumen.cupos.map((c, i) => (
              <span key={c.texto}>
                {i > 0 && ' · '}
                <span className={c.falta ? 'font-semibold text-[#9A5F0C]' : ''}>{c.texto}</span>
              </span>
            ))}
          </span>
        )}
      </div>
      {visibles.length > 0 && (
        <div className="flex flex-col rounded-lg border border-[#E2DED5]" data-habitaciones>
          {visibles.map((h, ix) => (
            <FilaHabitacionTarjeta
              key={h.id}
              itemId={itemId}
              h={h}
              notaReferencia={notaDeReferencia(h.sirveParaRestar, porTipo, h.rol === 'habitacion')}
              editable={editable}
              ampliar={ampliar}
              onQuitar={() => quitar(h, ix)}
              onCambio={onCambio}
            />
          ))}
        </div>
      )}
      {resumen.falta && editable && (
        <PideHabitacion itemId={itemId} texto={`${resumen.falta.verbo} ${resumen.falta.quien}: pega su habitación.`} onCambio={onCambio} />
      )}
    </section>
  )
}

function FilaHabitacionTarjeta({
  itemId,
  h,
  notaReferencia,
  editable,
  ampliar,
  onQuitar,
  onCambio,
}: {
  itemId: string
  h: HabitacionRepartida
  notaReferencia: string | null
  editable: boolean
  ampliar: (src: string, caption: string) => void
  onQuitar: () => void
  onCambio: () => void
}) {
  const [editando, setEditando] = useState(false)
  const [isPending, startTransition] = useTransition()
  const entrada = useRef<HTMLInputElement>(null)
  const textoOcupacion = h.lectura.campos.find(x => /ocupaci/i.test(x.label))?.valor ?? null
  const ocupacion = h.ocupacion ? ocupacionConEdades(h.ocupacion, textoOcupacion) : null
  const notaEdad = notaDeEdad(textoOcupacion)
  // La captura que el reparto usa solo para restar no es una habitación del grupo: no lleva
  // título propio, la explica su nota («ONE la usa para sacar el precio…»).
  const titulo = h.numero ? `Habitación ${h.numero}` : null
  const precio = h.moneda === 'COP' ? pesos(h.total) : formatoMonto(h.total, h.moneda)
  const src = urlDePantallazo(h.lectura.imagenRef)

  function cambiarPantallazo(archivo: File) {
    startTransition(async () => {
      const dataUrl = await leerArchivo(archivo)
      const r = await cambiarPantallazoDeHabitacion(itemId, h.id, dataUrl)
      if (!r.ok) { toast.error(r.mensaje); return }
      if (r.pendiente) toast.warning(r.pendiente)
      onCambio()
    })
  }

  return (
    <div
      className="grid grid-cols-[120px_1fr_auto_auto] items-center gap-3 border-t border-[#E2DED5] py-2.5 pl-2.5 pr-2 first:border-t-0 max-sm:grid-cols-[84px_1fr_auto] max-sm:gap-2.5 max-sm:pl-2 max-sm:pr-1.5"
      data-habitacion={h.id}
    >
      <Miniatura src={src} caption={[titulo, ocupacion].filter(Boolean).join(' · ') || 'Pantallazo'} ancho="w-[120px] max-sm:w-[84px]" onAmpliar={ampliar} />
      <div className="min-w-0">
        {titulo && <b className="block font-semibold">{titulo}</b>}
        {ocupacion && <span className="text-[13px] text-[#6E6A62]">{ocupacion}</span>}
        {notaReferencia && (
          <div className="mt-[3px] flex items-start gap-[5px] text-xs text-[#6E6A62]">
            <svg className="mt-0.5 shrink-0 text-[#0E5C43]" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden><circle cx="12" cy="12" r="9" /><path d="M8 12h8" /></svg>
            <span>{notaReferencia}</span>
          </div>
        )}
        {notaEdad && (
          <div className="mt-[3px] flex items-start gap-[5px] text-xs text-[#6E6A62]">
            <svg className="mt-0.5 shrink-0 text-[#0E5C43]" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden><circle cx="12" cy="12" r="9" /><path d="M12 8v5M12 16h.01" /></svg>
            <span>{notaEdad}</span>
          </div>
        )}
      </div>
      <span className="font-semibold tabular-nums max-sm:col-start-2 max-sm:row-start-2 max-sm:-mt-1.5 max-sm:justify-self-start">{precio}</span>
      {editable ? (
        <span className="max-sm:col-start-3 max-sm:row-start-1">
          <MenuAcciones
            contenido={cerrar => (
              <>
                <ItemMenu onClick={() => { cerrar(); setEditando(true) }}>Corregir datos</ItemMenu>
                <ItemMenu onClick={() => { cerrar(); entrada.current?.click() }}>Cambiar pantallazo</ItemMenu>
                <SeparadorMenu />
                <ItemMenu peligro onClick={() => { cerrar(); onQuitar() }}>Quitar habitación</ItemMenu>
              </>
            )}
          />
          <input
            ref={entrada}
            type="file"
            accept="image/*"
            hidden
            onChange={e => {
              const f = e.target.files?.[0]
              e.target.value = ''
              if (f) cambiarPantallazo(f)
            }}
          />
        </span>
      ) : <span />}
      {editando && (
        <FormHabitacion
          itemId={itemId}
          h={h}
          onListo={() => { setEditando(false); onCambio() }}
          onCancelar={() => setEditando(false)}
        />
      )}
      {isPending && <span className="sr-only" role="status">Leyendo…</span>}
    </div>
  )
}

function FormHabitacion({ itemId, h, onListo, onCancelar }: { itemId: string; h: HabitacionRepartida; onListo: () => void; onCancelar: () => void }) {
  const [v, setV] = useState({
    adultos: String(h.ocupacion?.adultos ?? ''),
    ninos: String(h.ocupacion?.ninos ?? 0),
    infantes: String(h.ocupacion?.infantes ?? 0),
    total: String(Math.round(h.total)),
  })
  const [isPending, startTransition] = useTransition()

  function guardar(e: React.FormEvent) {
    e.preventDefault()
    const entero = (s: string) => Math.max(0, Math.trunc(Number(s) || 0))
    const total = parseMontoCop(v.total)
    if (total === null) { toast.error('Escribe el precio sin puntos ni símbolo.'); return }
    startTransition(async () => {
      const r = await corregirHabitacion(itemId, h.id, { adultos: entero(v.adultos), ninos: entero(v.ninos), infantes: entero(v.infantes), total })
      if (!r.success) { toast.error(r.error ?? 'No se pudo guardar'); return }
      if (r.pendiente) toast.warning(r.pendiente)
      onListo()
    })
  }

  const campo = (k: keyof typeof v, label: string) => (
    <label className="flex flex-col gap-0.5 text-xs text-[#6E6A62]">
      <span>{label}</span>
      <input className={`${INPUT} tabular-nums`} inputMode="numeric" value={v[k]} onChange={e => setV(p => ({ ...p, [k]: e.target.value }))} />
    </label>
  )
  return (
    <form onSubmit={guardar} className="col-span-full grid grid-cols-4 gap-2 max-sm:grid-cols-2" data-habitacion-editar>
      {campo('adultos', 'Adultos')}
      {campo('ninos', 'Niños')}
      {campo('infantes', 'Infantes')}
      {campo('total', 'Precio de la habitación')}
      <span className="col-span-full flex flex-wrap gap-2">
        <button type="submit" className={BTN_PRIM} disabled={isPending}>Guardar</button>
        <button type="button" className={BTN} onClick={onCancelar}>Cancelar</button>
      </span>
    </form>
  )
}

/** La caja ámbar: «Falta 1 infante: pega su habitación.», con su zona de pegado. */
function PideHabitacion({ itemId, texto, onCambio }: { itemId: string; texto: string; onCambio: () => void }) {
  const idEntrada = useId()
  const [leyendo, setLeyendo] = useState(false)
  const [sobre, setSobre] = useState(false)
  const [rechazo, setRechazo] = useState<string | null>(null)

  function leer(archivo: File) {
    if (leyendo || !archivo.type.startsWith('image/')) return
    setRechazo(null)
    setLeyendo(true)
    void (async () => {
      try {
        const r = await sumarHabitacionAOpcion(itemId, await leerArchivo(archivo))
        if (!r.ok) { setRechazo(r.mensaje); return }
        toast('ONE leyó el pantallazo y lo sumó a esta opción.')
        if (r.pendiente) toast.warning(r.pendiente)
        onCambio()
      } catch {
        setRechazo('No se pudo leer el pantallazo. Vuelve a pegarlo.')
      } finally {
        setLeyendo(false)
      }
    })()
  }

  const alSoltar = {
    onDragOver: (e: DragEvent) => { if (Array.from(e.dataTransfer?.types ?? []).includes('Files')) { e.preventDefault(); setSobre(true) } },
    onDragLeave: () => setSobre(false),
    onDrop: (e: DragEvent) => {
      setSobre(false)
      const f = Array.from(e.dataTransfer?.files ?? []).find(x => x.type.startsWith('image/'))
      if (!f) return
      e.preventDefault()
      e.stopPropagation()
      leer(f)
    },
  }

  return (
    <div className="flex flex-col gap-2.5 rounded-lg border border-[#E9C98F] bg-[#FBF1E2] p-3" data-pide-habitacion>
      <p className="m-0 font-semibold">{texto}</p>
      <label
        htmlFor={idEntrada}
        tabIndex={0}
        onPaste={e => {
          const f = Array.from(e.clipboardData.items).find(i => i.type.startsWith('image/'))?.getAsFile()
          if (!f) return
          // La bandeja escucha el pegado en toda la página: este se queda en la opción.
          e.preventDefault()
          leer(f)
        }}
        className={`flex cursor-pointer flex-wrap items-center gap-3 rounded-[10px] border-[1.5px] border-dashed px-3.5 py-3 ${sobre ? 'border-[#0E5C43] bg-[#EAF1EE]' : 'border-[#CFCAC0] bg-white'}`}
        {...alSoltar}
      >
        <svg className="shrink-0 text-[#6E6A62]" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <rect x="3" y="5" width="18" height="14" rx="2" /><circle cx="9" cy="11" r="2" /><path d="m21 16-5-5-8 8" />
        </svg>
        <p className="m-0 min-w-[180px] flex-1">
          {leyendo ? 'Leyendo…' : 'Pega aquí el pantallazo o arrástralo'}
          <small className="block text-xs text-[#6E6A62]">ONE lo suma a esta opción.</small>
        </p>
        <span className={BTN}>Subir foto</span>
        <input
          id={idEntrada}
          type="file"
          accept="image/*"
          hidden
          onChange={e => {
            const f = e.target.files?.[0]
            e.target.value = ''
            if (f) leer(f)
          }}
        />
      </label>
      {rechazo && <p className="m-0 text-xs font-medium text-[#B3382C]">{rechazo}</p>}
    </div>
  )
}
