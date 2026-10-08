'use client'

import { MENSAJE_LECTURA_INTERRUMPIDA } from '@/lib/cotizaciones/lectura-sin-silencio'
import { useEffect, useId, useRef, useState, type DragEvent, type ReactNode } from 'react'
import { useTransitionTolerante } from '@/hooks/use-transition-tolerante'
import { toast } from 'sonner'

import {
  cambiarPantallazoDeHabitacion,
  marcarHabitacionQueVa,
  corregirCampoDeFicha,
  corregirHabitacion,
  ponerFotoDelHotel,
  quitarFotoDelHotel,
  quitarHabitacionDeOpcion,
  sumarHabitacionAOpcion,
} from '@/app/(app)/negocios/tarifa-pax-actions'
import { comprimirFotoHotel } from '@/lib/cotizaciones/foto-hotel-navegador'
import HojaCliente from '@/app/(app)/negocios/hoja-cliente'
import TarjetaCosto from '@/app/(app)/negocios/tarjeta-costo'
import PastillaAerolinea from '@/app/(app)/negocios/pastilla-aerolinea'
import { AlertaDecision } from '@/components/viaje/alerta-decision'
import { BTN, BTN_PRIM, INPUT } from '@/components/viaje/estilo'
import { ItemMenu, MenuAcciones, SeparadorMenu } from '@/components/viaje/menu-acciones'
import { Miniatura, MiniaturaManual, useVistaAmpliada } from '@/components/viaje/pantallazo'
import type { FilaAdicional } from '@/lib/cotizaciones/adicionales'
import { aplicarCorrecciones, esCorregible, leerCorrecciones, leidosPorSlug } from '@/lib/cotizaciones/correcciones'
import { cargoDeItem, hotelesDeItems, vuelosDeItems, type ItemConLectura } from '@/lib/cotizaciones/detalle-viaje'
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
import { avisoFechaDeActividad, avisoTasaPendiente } from '@/lib/cotizaciones/actividad-pantallazo'
import {
  composicionDeLinea,
  formatoMonto,
  leerTarifaPax,
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
  avisoDePasajeros,
  preguntaEliminarOpcion,
  referenciasTexto,
  resumenDeAlojamiento,
} from '@/lib/cotizaciones/tarjeta-opcion'
import { parseMontoCop } from '@/lib/negocios/monto-cop'
import {
  agregarEspera,
  quitarEspera,
  segundosParaElTotal,
  SIN_ESPERAS,
  textoAvisoDeshacer,
  type EsperasDeshacer,
} from '@/lib/cotizaciones/espera-deshacer'
import { datosManuales, esManual, montoConMiles } from '@/lib/cotizaciones/ingreso-manual'
import { nombreVisibleDeLinea } from '@/lib/cotizaciones/nombre-visible'
import { CheckVa, ModoYDia, useActividad, type ActividadDeTarjeta } from '@/app/(app)/negocios/actividad-control'
import { TEXTO_ACTIVIDAD_NO_VA } from '@/lib/cotizaciones/actividad-en-cotizacion'

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

/**
 * La línea de una habitación que no va (de referencia). La misma frase que la actividad sin el
 * check (brief del 2026-10-05: un solo gesto, y un solo texto, para lo mismo en toda la cotización).
 */
export const TEXTO_NO_VA = TEXTO_ACTIVIDAD_NO_VA
/** Solo desde manejadores y efectos (el clic de «Quitar habitación» y el tic del aviso). */
const horaActual = () => Date.now()

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
  item: itemDeLaPagina,
  tarifa: tarifaDeLaPagina,
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
  fechasViaje = null,
  onGuardarNota,
  onCambio,
  actividad = null,
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
  /** Las fechas del viaje: una actividad fuera de ellas lo avisa (brief del 2026-10-01, punto 5). */
  fechasViaje?: { inicio: string | null; fin: string | null } | null
  onGuardarNota: (texto: string) => void
  onCambio: () => void
  /**
   * Solo actividades (brief del 2026-10-05, punto 0): si va en la cotización, Incluida u Opcional,
   * y su día. `null` en vuelo, hotel y traslado, que se ven como siempre.
   */
  actividad?: ActividadDeTarjeta | null
}) {
  // Lo que el servidor acaba de guardar desde «Corregir datos» se pinta sin esperar el
  // refresco (COT-2026-0019: la ficha siguió diciendo las fechas viejas después de guardar).
  // Vale solo mientras la página siga trayendo la tarifa de antes.
  const [recienGuardada, setRecienGuardada] = useState<{ antes: unknown; ahora: TarifaPax } | null>(null)
  const vigenteLocal = !!recienGuardada && recienGuardada.antes === itemDeLaPagina.tarifa_pax
  const item: ItemConLectura = vigenteLocal ? { ...itemDeLaPagina, tarifa_pax: recienGuardada!.ahora } : itemDeLaPagina
  const tarifa: TarifaPax = vigenteLocal ? recienGuardada!.ahora : tarifaDeLaPagina
  const ranura = ranuraDeGrupo(item.grupo)
  const esHotel = ranura?.slug === 'hotel_detalle'
  const esTraslado = ranura?.slug === 'traslado_detalle'
  const esActividad = ranura?.slug === 'actividad_detalle'
  const esVuelo = ranura?.slug === 'vuelo_detalle'
  const [hotel] = esHotel ? hotelesDeItems([item]) : [null]
  // La pastilla de la aerolínea en la cabecera, la misma del PDF (brief del 2026-10-08).
  const [vuelo] = esVuelo ? vuelosDeItems([item]) : [null]
  const nombre = (esHotel ? hotel?.hotel : null) || nombreVisibleDeLinea(item) || `Opción ${numero}`
  const estrellas = esHotel ? hotel?.estrellas ?? null : null

  const grupo = composicionViaje ?? tarifa.composicion ?? null
  const habitaciones = esHotel ? habitacionesDeTarifa(tarifa) : []
  const reparto = esHotel && habitaciones.length > 0 ? repartirHabitaciones(habitaciones, grupo, tarifa.correcciones) : null
  const resumenAloj = reparto ? resumenDeAlojamiento(reparto) : null
  const avisoPax = resumenAloj ? avisoDePasajeros(resumenAloj) : null
  // Lo que se lee con la tarjeta CERRADA (brief del 2026-10-01, puntos 3 y 5): la actividad
  // fuera de las fechas del viaje, y el costo que no entró porque falta la tasa de cambio. Un
  // precio en $0 nunca pasa callado.
  const avisosCerrada = [
    avisoFechaDeActividad(ranura?.slug, tarifa, fechasViaje),
    avisoTasaPendiente(tarifa, composicionDeLinea(tarifa, composicionViaje), ranura?.slug),
  ].filter((a): a is string => !!a)

  // Qué va y qué no (punto 0). El hook va siempre: en las demás opciones no pinta nada.
  const act = useActividad(itemId, actividad ?? { estado: 'incluida', dia: null, precioPorPersona: null, era: null }, onCambio)
  const noVa = !!actividad && act.estado === 'no_va'

  const [confirmaBorrar, setConfirmaBorrar] = useState(false)
  const [editandoFicha, setEditandoFicha] = useState(false)
  const [isPending, startTransition] = useTransitionTolerante()
  const { ampliar, vista } = useVistaAmpliada()
  const entradaPantallazo = useRef<HTMLInputElement>(null)

  // La fila cerrada dice lo que sirve para comparar: habitación, habitaciones y si cubre al grupo.
  const subCerrada = esHotel && resumenAloj
    ? (
      <>
        {[hotel?.habitacion, `${resumenAloj.habitaciones} ${resumenAloj.habitaciones === 1 ? 'habitación' : 'habitaciones'}`].filter(Boolean).join(' · ')}
        {' · '}
        {avisoPax
          ? <span className="font-semibold text-[#9A5F0C]">{avisoPax.corto.toLowerCase()}</span>
          : grupo ? `cubre a los ${grupo.adultos + grupo.ninos + grupo.infantes}` : null}
        {resumenAloj.referencias > 0 && ` · ${referenciasTexto(resumenAloj.referencias)}`}
      </>
    )
    : resumenDeOpcion(item)
  const subAbierta = esHotel ? (hotel?.ciudad ?? null) : resumenDeOpcion(item)
  // «Opción 2» es un relleno hasta que se lea su pantallazo, y lo dice.
  const sinPantallazo = !tarifa.casillas?.grupo_completo && habitaciones.length === 0 && esNombreDeOpcion(item.nombre)

  // La foto del hotel (`foto-hotel.ts`). Lo que el servidor acaba de confirmar se pinta sin
  // esperar el refresco; vale solo mientras la página siga mostrando la foto de antes.
  const fotoDeLaPagina = tarifa.fotoHotel?.ref ?? null
  const [fotoConfirmada, setFotoConfirmada] = useState<{ antes: string | null; ahora: string | null } | null>(null)
  const fotoRef = fotoConfirmada && fotoConfirmada.antes === fotoDeLaPagina ? fotoConfirmada.ahora : fotoDeLaPagina
  const [subiendoFoto, setSubiendoFoto] = useState(false)

  function ponerFoto(archivo: File) {
    if (subiendoFoto) return
    setSubiendoFoto(true)
    void (async () => {
      try {
        const foto = await comprimirFotoHotel(archivo)
        if (!foto) { toast.error('Ese archivo no es una foto. Usa un JPG o un PNG.'); return }
        const r = await ponerFotoDelHotel(itemId, foto.dataUrl, foto.proporcion)
        if (!r.success) { toast.error(r.error ?? 'No se pudo guardar la foto. Vuelve a intentarlo.'); return }
        setFotoConfirmada({ antes: fotoDeLaPagina, ahora: r.tarifa?.fotoHotel?.ref ?? null })
        onCambio()
      } catch {
        toast.error('No se pudo guardar la foto. Vuelve a intentarlo.')
      } finally {
        setSubiendoFoto(false)
      }
    })()
  }

  function quitarFoto() {
    if (subiendoFoto) return
    setSubiendoFoto(true)
    void (async () => {
      try {
        const r = await quitarFotoDelHotel(itemId)
        if (!r.success) { toast.error(r.error ?? 'No se pudo quitar la foto. Vuelve a intentarlo.'); return }
        setFotoConfirmada({ antes: fotoDeLaPagina, ahora: null })
        onCambio()
      } catch {
        toast.error('No se pudo quitar la foto. Vuelve a intentarlo.')
      } finally {
        setSubiendoFoto(false)
      }
    })()
  }

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
      <span>{preguntaEliminarOpcion(nombre, { esHotel, tieneLectura: !!tarifa.casillas?.grupo_completo, manual: esManual(tarifa.casillas?.grupo_completo) })}</span>
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
      className={`rounded-[10px] border text-sm ${noVa ? 'bg-[#F8F7F3] text-[#6E6A62]' : 'bg-white text-[#191713]'} ${abierta ? 'border-[#CFCAC0]' : 'border-[#E2DED5]'}`}
      data-tarjeta-opcion={itemId}
      data-linea-id={itemId}
      {...(actividad ? { 'data-actividad-estado': act.estado } : {})}
    >
      <div className="flex items-center gap-1.5 py-2.5 pl-3 pr-2">
        {actividad && (
          <CheckVa va={!noVa} editable={editable} ocupado={act.ocupado} onCambio={va => act.marcar({ va })} />
        )}
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
              {vuelo && <PastillaAerolinea aerolinea={vuelo.aerolinea} numeroVuelo={vuelo.numeroVuelo} />}
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
          <small className="block text-[11px] text-[#6E6A62]">
            {actividad && act.estado === 'opcional' ? 'Opcional · no suma' : 'Precio'}
          </small>
          <b className={`text-[15px] tabular-nums ${noVa ? 'font-semibold text-[#6E6A62] line-through' : ''}`}>{pesos(precioOpcion)}</b>
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

      {actividad && (
        <div className="-mt-1 pb-2.5 pl-[50px] pr-3" data-actividad-control>
          <ModoYDia
            estado={act.estado}
            dia={act.dia}
            precioPorPersona={actividad.precioPorPersona}
            fechasViaje={fechasViaje}
            editable={editable}
            ocupado={act.ocupado}
            onModo={modo => act.marcar({ modo })}
            onDia={act.ponerDia}
          />
        </div>
      )}

      {avisosCerrada.length > 0 && (
        <div className="-mt-1 flex flex-col gap-1 pb-2.5 pl-[42px] pr-3" data-avisos-opcion>
          {avisosCerrada.map(a => (
            <div key={a} className="flex items-start gap-[5px] text-xs font-semibold text-[#9A5F0C]" data-aviso-opcion>
              <svg className="mt-0.5 shrink-0" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden><path d="M12 3 2 21h20L12 3Z" /><path d="M12 10v4M12 17h.01" /></svg>
              <span>{a}</span>
            </div>
          ))}
        </div>
      )}

      {mover}

      {abierta && (
        <div className="flex flex-col gap-5 px-3.5 pb-4" data-opcion-abierta={itemId}>
          {editandoFicha && editable ? (
            <FormFicha
              itemId={itemId}
              tarifa={tarifa}
              esHotel={esHotel}
              grupoItem={item.grupo}
              onListo={guardada => {
                if (guardada) setRecienGuardada({ antes: itemDeLaPagina.tarifa_pax, ahora: guardada })
                setEditandoFicha(false)
                onCambio()
              }}
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
              onGuardada={guardada => setRecienGuardada({ antes: itemDeLaPagina.tarifa_pax, ahora: guardada })}
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

          {/* El traslado, la actividad y (desde el 2026-10-05, D3) el vuelo también tienen su
              hoja: la línea de «Inversión» del documento y, en el vuelo, sus filas de la tabla
              «Vuelos». Su nota se sigue escribiendo aparte, encima. */}
          {!esHotel && nota}
          {(esHotel || esTraslado || esActividad || esVuelo) && <HojaCliente
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
            {...(esHotel ? { fotoRef, subiendoFoto, onPonerFoto: ponerFoto, onQuitarFoto: quitarFoto } : {})}
          />}
        </div>
      )}
      {isPending && <span className="sr-only" role="status">Guardando…</span>}
      {vista}
    </div>
  )
}

// ── La ficha ─────────────────────────────────────────────────────────────────

/** La fuente de una opción ingresada a mano («Portafolio Verdemar 2026»). Interna. */
function fuenteManual(item: ItemConLectura): string | null {
  const t = leerTarifaPax(item.tarifa_pax)
  return datosManuales(t.casillas?.grupo_completo ?? t.habitaciones?.[0]?.lectura ?? null)?.fuente || null
}

function Ficha({ item, esHotel, composicion }: { item: ItemConLectura; esHotel: boolean; composicion: Composicion | null }) {
  const fuente = fuenteManual(item)
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
    if (fuente) filas.push({ dt: 'Ingresado a mano', dd: fuente })
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
  const renglones = [...fichaDeOpcion(item, composicion), ...(fuente ? [`Ingresado a mano · ${fuente}`] : [])]
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
  /** Con la tarifa que quedó guardada, para pintarla sin esperar el refresco. */
  onListo: (guardada: TarifaPax | null) => void
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
  const [isPending, startTransition] = useTransitionTolerante()

  function guardar(e: React.FormEvent) {
    e.preventDefault()
    const cambios = campos.filter(c => (valores[c.slug] ?? '').trim() !== (vigentes[c.slug] ?? '').trim())
    if (cambios.length === 0) { onCancelar(); return }
    startTransition(async () => {
      let guardada: TarifaPax | null = null
      let pendiente: string | null = null
      for (const c of cambios) {
        const v = (valores[c.slug] ?? '').trim()
        const r = await corregirCampoDeFicha(itemId, c.slug, v === '' ? null : v)
        if (!r.success) { toast.error(`${c.label}: ${r.error ?? 'no se pudo guardar'}`); return }
        guardada = r.tarifa ?? guardada
        pendiente = r.pendiente ?? pendiente
      }
      toast('Guardado. La vista del cliente ya muestra el cambio.')
      if (pendiente) toast.warning(pendiente)
      onListo(guardada)
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
  onGuardada,
  onCambio,
}: {
  itemId: string
  reparto: ReturnType<typeof repartirHabitaciones>
  resumen: NonNullable<ReturnType<typeof resumenDeAlojamiento>>
  editable: boolean
  ampliar: (src: string, caption: string) => void
  /** Lo que el servidor acaba de guardar, para pintarlo sin esperar el refresco. */
  onGuardada: (t: TarifaPax) => void
  onCambio: () => void
}) {
  // «Va» / «No va» (ajuste de Mauricio, 2026-10-01): la operadora elige qué habitaciones van.
  // Mientras se guarda, ninguna fila se puede tocar otra vez.
  const [eligiendo, startEleccion] = useTransitionTolerante()
  function elegir(h: HabitacionRepartida, va: boolean) {
    if (eligiendo || (h.rol === 'habitacion') === va) return
    startEleccion(async () => {
      const r = await marcarHabitacionQueVa(itemId, h.id, va)
      if (!r.success) { toast.error(r.error ?? 'No se pudo guardar.'); return }
      if (r.tarifa) onGuardada(r.tarifa)
      if (r.pendiente) toast.warning(r.pendiente)
      onCambio()
    })
  }
  const avisoPax = avisoDePasajeros(resumen)
  // Elegir tiene sentido con más de una captura: la única siempre va.
  const puedeElegir = editable && reparto.habitaciones.length > 1

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
  // Mientras corre el «Deshacer» el total todavía no cambió: el aviso lo dice, con la cuenta
  // (`espera-deshacer.ts`). Se va al deshacer, o cuando la quita ya se escribió.
  const [esperas, setEsperas] = useState<EsperasDeshacer>(SIN_ESPERAS)
  const [ahora, setAhora] = useState(0)
  useEffect(() => {
    if (esperas.size === 0) return
    const tic = setInterval(() => setAhora(horaActual()), 500)
    return () => clearInterval(tic)
  }, [esperas])
  const segundosTotal = segundosParaElTotal(esperas, ahora)

  const porTipo = costoPorTipoDeHabitaciones(reparto)
  const visibles = reparto.habitaciones.filter(h => !quitadas.has(h.id))

  function quitar(h: HabitacionRepartida, indice: number) {
    if (enEspera.current.has(h.id)) return
    const mostrar = () => setQuitadas(prev => { const n = new Set(prev); n.delete(h.id); return n })
    const sinAviso = () => setEsperas(prev => quitarEspera(prev, h.id))
    setQuitadas(prev => new Set([...prev, h.id]))
    const empieza = horaActual()
    setAhora(empieza)
    setEsperas(prev => agregarEspera(prev, h.id, empieza + ESPERA_DESHACER_MS))
    const ejecutar = () => {
      enEspera.current.delete(h.id)
      void quitarHabitacionDeOpcion(itemId, h.id).then(r => {
        sinAviso()
        if (!r.success) { toast.error(r.error ?? 'No se pudo quitar la habitación.'); mostrar(); return }
        if (r.pendiente) toast.warning(r.pendiente)
        onCambio()
      })
    }
    const reloj = setTimeout(ejecutar, ESPERA_DESHACER_MS)
    enEspera.current.set(h.id, { reloj, ejecutar })
    toast(`Quitaste la habitación ${h.numero ?? indice + 1}.`, {
      duration: ESPERA_DESHACER_MS,
      action: { label: 'Deshacer', onClick: () => { clearTimeout(reloj); enEspera.current.delete(h.id); mostrar(); sinAviso() } },
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
              posicion={reparto.habitaciones.indexOf(h) + 1}
              notaReferencia={notaDeReferencia(h.sirveParaRestar, porTipo, h.rol === 'habitacion')}
              editable={editable}
              ampliar={ampliar}
              eleccion={puedeElegir ? { ocupado: eligiendo, onElegir: va => elegir(h, va) } : null}
              onQuitar={() => quitar(h, ix)}
              onCambio={onCambio}
            />
          ))}
        </div>
      )}
      {eligiendo && <p className="m-0 text-xs text-[#6E6A62]" role="status">Guardando la elección…</p>}
      <AvisoDeshacerTotal segundos={segundosTotal} />
      {resumen.falta && editable && avisoPax && (
        <PideHabitacion itemId={itemId} texto={avisoPax.frase} onCambio={onCambio} />
      )}
      {!resumen.falta && avisoPax && (
        <p className="m-0 rounded-lg border border-[#E9C98F] bg-[#FBF1E2] px-3 py-2 text-[13px] font-semibold text-[#9A5F0C]" data-sobran>
          {avisoPax.frase}
        </p>
      )}
    </section>
  )
}

/**
 * El aviso de la ventana del «Deshacer» de «Quitar habitación»: el total cambia al vencer.
 * `segundos: null` = nada espera y no se pinta nada.
 */
export function AvisoDeshacerTotal({ segundos }: { segundos: number | null }) {
  if (segundos === null) return null
  return (
    <p
      role="status"
      aria-live="polite"
      className="m-0 flex items-center gap-2 rounded-lg border border-[#E9C98F] bg-[#FBF1E2] px-3 py-2 text-xs font-semibold text-[#9A5F0C]"
      data-aviso-deshacer
    >
      {textoAvisoDeshacer(segundos)}
    </p>
  )
}

function FilaHabitacionTarjeta({
  itemId,
  h,
  posicion,
  notaReferencia,
  editable,
  ampliar,
  eleccion,
  onQuitar,
  onCambio,
}: {
  itemId: string
  h: HabitacionRepartida
  /**
   * Su lugar en la opción, el de siempre (brief del 2026-10-05, punto 16): marcar que una no va no
   * renumera las demás ni la mueve. El número del documento (`h.numero`) cuenta solo las que van.
   */
  posicion: number
  notaReferencia: string | null
  editable: boolean
  ampliar: (src: string, caption: string) => void
  /** «Va» / «No va». `null` = no se elige (sin editar, o la opción tiene una sola captura). */
  eleccion: { ocupado: boolean; onElegir: (va: boolean) => void } | null
  onQuitar: () => void
  onCambio: () => void
}) {
  const [editando, setEditando] = useState(false)
  const [isPending, startTransition] = useTransitionTolerante()
  const entrada = useRef<HTMLInputElement>(null)
  const textoOcupacion = h.lectura.campos.find(x => /ocupaci/i.test(x.label))?.valor ?? null
  const ocupacion = h.ocupacion ? ocupacionConEdades(h.ocupacion, textoOcupacion) : null
  const notaEdad = notaDeEdad(textoOcupacion)
  // La que no va (de referencia) se nombra así y dice que no suma (brief del 2026-10-01,
  // punto 2): el resumen decía «1 habitación» y no se entendía que había otra que no contaba.
  const va = h.rol === 'habitacion'
  const titulo = `Habitación ${posicion}`
  const precio = h.moneda === 'COP' ? pesos(h.total) : formatoMonto(h.total, h.moneda)
  const src = urlDePantallazo(h.lectura.imagenRef)
  const manual = datosManuales(h.lectura)

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
      {manual ? (
        <MiniaturaManual ancho="w-[120px] max-sm:w-[84px]" dato="data-habitacion-manual" />
      ) : (
        <Miniatura src={src} caption={[titulo, ocupacion].filter(Boolean).join(' · ') || 'Pantallazo'} ancho="w-[120px] max-sm:w-[84px]" onAmpliar={ampliar} />
      )}
      <div className="min-w-0">
        <span className="flex items-center gap-1">
          {/* El mismo check de las actividades reemplaza «Va / No va» (brief del 2026-10-05). */}
          {eleccion && <CheckVa va={va} editable ocupado={eleccion.ocupado} onCambio={v => eleccion.onElegir(v)} />}
          <b className={`block font-semibold ${va ? '' : 'text-[#6E6A62]'}`}>{titulo}</b>
        </span>
        {ocupacion && <span className="text-[13px] text-[#6E6A62]">{ocupacion}</span>}
        {manual?.fuente && <span className="block text-xs text-[#6E6A62]">{manual.fuente}</span>}
        {!va && <span className="block text-xs text-[#6E6A62]" data-no-suma>{TEXTO_NO_VA}</span>}
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
        {h.avisoEstadia && (
          <div className="mt-[3px] flex items-start gap-[5px] text-xs font-semibold text-[#9A5F0C]" data-aviso-estadia>
            <svg className="mt-0.5 shrink-0" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden><path d="M12 3 2 21h20L12 3Z" /><path d="M12 10v4M12 17h.01" /></svg>
            <span>{h.avisoEstadia}</span>
          </div>
        )}
      </div>
      <span className={`tabular-nums max-sm:col-start-2 max-sm:row-start-2 max-sm:-mt-1.5 max-sm:justify-self-start ${va ? 'font-semibold' : 'text-[#6E6A62] line-through'}`}>{precio}</span>
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
    total: montoConMiles(String(Math.round(h.total))),
  })
  const [isPending, startTransition] = useTransitionTolerante()

  function guardar(e: React.FormEvent) {
    e.preventDefault()
    const entero = (s: string) => Math.max(0, Math.trunc(Number(s) || 0))
    const total = parseMontoCop(v.total)
    if (total === null) { toast.error('Escribe el precio de la habitación.'); return }
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
      <input className={`${INPUT} tabular-nums`} inputMode="numeric" value={v[k]} onChange={e => setV(p => ({ ...p, [k]: k === 'total' ? montoConMiles(e.target.value) : e.target.value }))} />
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
        setRechazo(MENSAJE_LECTURA_INTERRUMPIDA)
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
