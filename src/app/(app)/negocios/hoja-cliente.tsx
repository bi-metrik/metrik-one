'use client'

import { useId, useState, type ClipboardEvent, type DragEvent, type ReactNode } from 'react'

import { adicionalEnLaFicha, aAdicional, type FilaAdicional } from '@/lib/cotizaciones/adicionales'
import { hotelesDeItems, vuelosDeItems, type ItemConLectura, type VueloPDF } from '@/lib/cotizaciones/detalle-viaje'
import type { PreciosAMano, TarifaConfirmada } from '@/lib/cotizaciones/tarifa-pasajero'
import { filasDeCosto, pesos } from '@/lib/cotizaciones/tarjeta-opcion'
import { aerolineaDeFila, filasDelVuelo, numerosSinTramo, TOKENS, textosDeTarjetaHotel } from '@/lib/pdf/cotizacion-trappvel-formato'
import { TEXTO_AGREGAR_FOTO_HOTEL, urlDeFotoHotel } from '@/lib/cotizaciones/foto-hotel'
import { nombreVisibleDeLinea } from '@/lib/cotizaciones/nombre-visible'
import type { DudaVista } from '@/lib/fotos/vista'
import PreguntaMismo from '../fotos/pregunta-mismo'
import PastillaAerolinea from './pastilla-aerolinea'

/**
 * «Así lo ve el cliente» (prototipo de la tarjeta, 2026-09-24): la opción de hotel como sale en
 * la hoja de la cotización de Trappvel, con los colores y la letra del documento, y la nota
 * para el cliente escrita encima de la hoja.
 *
 * Un traslado sale en el documento como su línea de «Inversión»: el nombre de la línea,
 * «Incluye: …» con sus adicionales, el precio de cada pasajero y el total (`LineaPrecio` del
 * PDF). Esa es su hoja (`LineaDelCliente`). Hasta el 2026-09-28 solo el hotel tenía hoja. Desde
 * el brief del 2026-10-05 (D3) el vuelo también: su línea de «Inversión» y, debajo, sus filas de la
 * tabla «Vuelos» del documento (`filasDelVuelo`, la misma función que las imprime).
 *
 * ⚠️ Los textos NO se arman aquí: la tarjeta del hotel sale de `textosDeTarjetaHotel` (la misma
 * función que pinta el PDF) y el precio de cada pasajero de `filasDeCosto`, que reparte con la
 * regla del documento (`precioPorPasajero` / `precioPorHabitacion`). Si el PDF cambia, esto
 * cambia con él.
 */

const HELVETICA = '"Helvetica Neue", Helvetica, Arial, sans-serif'

/**
 * El perfil del hotel o del tour en su tarjeta (Mauricio, 2026-10-16): el recuadro muestra la foto
 * que sale en la propuesta (con «+N» si tiene más); vacío, «Agrega fotos de este hotel» para
 * pegar, arrastrar o subir. Si el nombre se parece a otro hotel del espacio, en su lugar va la
 * pregunta «¿Es el mismo hotel que …?».
 */
export interface BibliotecaEnTarjeta {
  tipo: 'hotel' | 'actividad'
  /** La foto del perfil que sale en la propuesta. `null` = no tiene. */
  foto: { url: string | null } | null
  /** Cuántas más del mismo perfil salen con ella. */
  mas: number
  /** ¿Cabe otra (hasta 3)? */
  admiteOtra: boolean
  /** «¿Es el mismo hotel que …?», sin contestar. */
  duda: DudaVista | null
  contestando: boolean
  onContestar: (mismo: boolean) => void
  /** Abre el perfil (ordenar, quitar, ver las tres). */
  onVerFotos: () => void
}
const PLACEHOLDER_NOTA = 'Agrega una nota para el cliente…'

export default function HojaCliente({
  item,
  numero,
  bloqueTitulo,
  general,
  adicionales,
  confirmada,
  preciosAMano,
  precioLinea,
  precioOpcion,
  editable,
  onGuardarNota,
  fotoRef = null,
  subiendoFoto = false,
  onPonerFoto,
  onQuitarFoto,
  biblioteca = null,
}: {
  /** La opción, con su descripción: la nota sale de ahí (`notaDeLaLinea`). */
  item: ItemConLectura
  numero: number
  /** «Hotel en Providencia»: el renglón magenta sobre la tarjeta. */
  bloqueTitulo: string
  /** El nivel de detalle «general» no nombra habitación ni régimen (igual que el PDF). */
  general: boolean
  adicionales: FilaAdicional[]
  confirmada: TarifaConfirmada | null
  preciosAMano: PreciosAMano | undefined
  precioLinea: number
  precioOpcion: number
  editable: boolean
  onGuardarNota: (texto: string) => void
  /** La foto del hotel guardada (`foto-hotel.ts`). `null` = sin foto. */
  fotoRef?: string | null
  subiendoFoto?: boolean
  /** Pegada, arrastrada o subida: quien llama la comprime y la guarda. */
  onPonerFoto?: (archivo: File) => void
  onQuitarFoto?: () => void
  /** Con biblioteca en el espacio, el recuadro la muestra y abre su selector. */
  biblioteca?: BibliotecaEnTarjeta | null
}) {
  const enLaFicha = adicionales.map(f => adicionalEnLaFicha(aAdicional(f)))
  const [h] = hotelesDeItems([{ ...item, adicionales: enLaFicha }])
  const [editando, setEditando] = useState(false)
  const porPasajero = filasDeCosto({ confirmada, precioLinea, preciosAMano })
    .map(f => `${f.nombre}${f.det ? ` (${f.det})` : ''} ${pesos(f.precioUnitario)}`)
    .join('  ·  ')
  const hoja = (tarjeta: ReactNode) => (
    <Hoja bloqueTitulo={bloqueTitulo} porPasajero={porPasajero} precioOpcion={precioOpcion}>{tarjeta}</Hoja>
  )
  const [v] = h ? [null] : vuelosDeItems([{ ...item, adicionales: enLaFicha }])
  if (v) {
    return hoja(
      <>
        <LineaDelCliente numero={numero} nombre={nombreVisibleDeLinea(item)} adicionales={[]} />
        <VueloDelCliente v={v} general={general} />
      </>,
    )
  }
  if (!h) {
    const linea = <LineaDelCliente numero={numero} nombre={nombreVisibleDeLinea(item)} adicionales={enLaFicha} />
    // Un tour o plan con perfil lleva su recuadro de foto al lado, como el hotel.
    if (!biblioteca) return hoja(linea)
    return hoja(
      <div className="flex items-start gap-3 max-sm:flex-col">
        <div className="min-w-0 flex-1 self-stretch max-sm:w-full">{linea}</div>
        {biblioteca.duda ? (
          <div className="w-[34%] shrink-0 max-sm:w-full">
            <PreguntaMismo tipo={biblioteca.tipo} duda={biblioteca.duda} editable={editable} ocupado={biblioteca.contestando} onContestar={biblioteca.onContestar} compacta />
          </div>
        ) : (biblioteca.foto || (editable && onPonerFoto)) ? (
          <FotoDeTarjeta fotoRef={null} editable={editable} subiendo={subiendoFoto} onPoner={onPonerFoto} biblioteca={biblioteca} />
        ) : null}
      </div>,
    )
  }
  const t = textosDeTarjetaHotel(h, general)

  return hoja(
    <>
          {/* La foto va al lado de la tarjeta, como en el documento (la miniatura del capítulo). */}
          <div className="flex items-start gap-3 max-sm:flex-col">
          <div className="flex min-w-0 flex-1 flex-col gap-1 self-stretch rounded-lg px-3.5 py-3 max-sm:w-full" style={{ background: TOKENS.tarjeta }}>
            <span className="self-start rounded-full px-[7px] py-0.5 text-[8.5px] font-bold tracking-[.08em] text-white" style={{ background: TOKENS.magenta }}>
              OPCIÓN {numero}
            </span>
            <h5 className="m-0 mt-0.5 flex flex-wrap items-center gap-1.5 text-base font-bold" style={{ color: TOKENS.tinta }}>
              {t.nombre}
              {t.estrellas ? <span className="text-[11px] tracking-[1px] text-[#F5B400]">{'★'.repeat(t.estrellas)}</span> : null}
            </h5>
            {t.resumen !== '' && <span className="text-[12.5px]" style={{ color: TOKENS.texto }}>{t.resumen}</span>}
            {t.condiciones !== '' && <span className="text-[11.5px]" style={{ color: TOKENS.gris }}>{t.condiciones}</span>}
            {t.adicionales && <span className="text-[11.5px]" style={{ color: TOKENS.gris }}>{t.adicionales}</span>}
            <div className="mt-1" data-nota-cliente>
              {editando && editable ? (
                <textarea
                  autoFocus
                  defaultValue={t.nota ?? ''}
                  maxLength={500}
                  placeholder={PLACEHOLDER_NOTA}
                  aria-label="Nota para el cliente"
                  className="min-h-14 w-full resize-y rounded-md border-[1.5px] bg-[#FFFDF6] px-[9px] py-[7px] text-[11.5px] text-[#3A3F55] outline-none"
                  style={{ fontFamily: HELVETICA, borderColor: TOKENS.magenta }}
                  onFocus={e => e.currentTarget.setSelectionRange(e.currentTarget.value.length, e.currentTarget.value.length)}
                  onBlur={e => {
                    setEditando(false)
                    const val = e.target.value.trim()
                    if (val !== (t.nota ?? '')) onGuardarNota(val)
                  }}
                />
              ) : t.nota ? (
                <button
                  type="button"
                  disabled={!editable}
                  onClick={() => setEditando(true)}
                  aria-label="Editar la nota para el cliente"
                  className="w-full cursor-text rounded border-0 bg-transparent p-0 text-left hover:bg-[#FFF7FB] disabled:cursor-default disabled:hover:bg-transparent"
                >
                  <p className="m-0 mt-0.5 whitespace-pre-wrap text-[11.5px]" style={{ color: TOKENS.texto }}>{t.nota}</p>
                </button>
              ) : editable ? (
                <button
                  type="button"
                  onClick={() => setEditando(true)}
                  className="w-full rounded-md border-[1.5px] border-dashed border-[#C9C6D6] bg-transparent px-[9px] py-[7px] text-left text-[11.5px] text-[#8A8FA3] hover:border-[#E63380] hover:text-[#E63380]"
                  style={{ fontFamily: HELVETICA }}
                >
                  {PLACEHOLDER_NOTA}
                </button>
              ) : null}
            </div>
          </div>
          {biblioteca?.duda ? (
            <div className="w-[34%] shrink-0 max-sm:w-full">
              <PreguntaMismo tipo="hotel" duda={biblioteca.duda} editable={editable} ocupado={biblioteca.contestando} onContestar={biblioteca.onContestar} compacta />
            </div>
          ) : (fotoRef || biblioteca?.foto || (editable && onPonerFoto)) && (
            <FotoDeTarjeta
              fotoRef={fotoRef}
              editable={editable}
              subiendo={subiendoFoto}
              onPoner={onPonerFoto}
              onQuitar={onQuitarFoto}
              biblioteca={biblioteca}
            />
          )}
          </div>
    </>,
  )
}

/**
 * La hoja: el renglón del bloque arriba, la tarjeta de la opción y la franja de «Inversión»
 * con el precio de cada pasajero y el total. La misma para el hotel y para lo que no es hotel.
 */
function Hoja({ bloqueTitulo, porPasajero, precioOpcion, children }: {
  bloqueTitulo: string
  porPasajero: string
  precioOpcion: number
  children: ReactNode
}) {
  return (
    <section aria-label="Así lo ve el cliente" className="flex flex-col gap-2.5" data-hoja-cliente>
      <p className="m-0 flex items-center gap-2 text-[11px] font-bold uppercase tracking-[.08em] text-[#6E6A62]">
        Así lo ve el cliente<span className="h-px flex-1 bg-[#E2DED5]" />
      </p>
      <div className="rounded-[10px] bg-[#EEEBE4] p-[18px] max-sm:p-2.5">
        <div
          className="mx-auto flex max-w-[600px] flex-col gap-3 rounded-[2px] bg-white px-7 pb-[22px] pt-[26px] shadow-[0_1px_1px_rgba(22,26,51,.06),0_8px_24px_rgba(22,26,51,.14)] max-sm:px-4 max-sm:pb-4 max-sm:pt-[18px]"
          style={{ fontFamily: HELVETICA, color: TOKENS.texto, colorScheme: 'light' }}
          data-hoja
        >
          <span className="flex items-center gap-1.5 text-[10px] font-bold tracking-[.14em]" style={{ color: TOKENS.magenta }}>
            <i className="h-1.5 w-1.5 rounded-full" style={{ background: TOKENS.magenta }} />
            {bloqueTitulo.toUpperCase()}
          </span>
          {children}
          <div className="flex flex-wrap items-end justify-between gap-3 border-t pt-2.5" style={{ borderColor: TOKENS.linea }}>
            <div>
              <small className="block text-[9.5px] font-bold tracking-[.12em]" style={{ color: TOKENS.gris }}>INVERSIÓN</small>
              {porPasajero !== '' && <div className="mt-0.5 whitespace-pre-wrap text-[11px] tabular-nums" style={{ color: TOKENS.purpura }}>{porPasajero}</div>}
            </div>
            <div className="text-right text-lg font-bold tabular-nums" style={{ color: TOKENS.tinta }}>{pesos(precioOpcion)}</div>
          </div>
        </div>
        <p className="m-0 mt-2.5 text-center text-xs text-[#6E6A62]">Así sale esta opción en la cotización que recibe el cliente.</p>
      </div>
    </section>
  )
}

/**
 * El traslado, como lo imprime la línea de «Inversión» del documento (`LineaPrecio`):
 * el nombre de la línea tal cual y «Incluye: …» con los adicionales, sin cifra propia.
 */
function LineaDelCliente({ numero, nombre, adicionales }: { numero: number; nombre: string; adicionales: string[] }) {
  return (
    <div className="flex flex-col gap-1 rounded-lg px-3.5 py-3" style={{ background: TOKENS.tarjeta }} data-linea-cliente>
      <span className="self-start rounded-full px-[7px] py-0.5 text-[8.5px] font-bold tracking-[.08em] text-white" style={{ background: TOKENS.magenta }}>
        OPCIÓN {numero}
      </span>
      <h5 className="m-0 mt-0.5 text-base font-bold" style={{ color: TOKENS.tinta }}>{nombre || `Opción ${numero}`}</h5>
      {adicionales.length > 0 && <span className="text-[11.5px]" style={{ color: TOKENS.gris }}>{`Incluye: ${adicionales.join(' · ')}`}</span>}
    </div>
  )
}

/**
 * El vuelo como lo imprime la tabla «Vuelos» del documento: una fila por tramo (aerolínea, ruta,
 * escala, fecha, horas, número) y la línea gris de tarifa, equipaje y adicionales. Las filas y la
 * línea salen de las mismas funciones que la plantilla (`filasDelVuelo`, `numerosSinTramo`).
 */
function VueloDelCliente({ v, general }: { v: VueloPDF; general: boolean }) {
  const filas = filasDelVuelo(v)
  const meta = [
    numerosSinTramo(v),
    !general ? v.tarifa : null,
    !general ? v.equipaje : null,
    v.adicionales.length > 0 ? `Adicionales: ${v.adicionales.join(' · ')}` : null,
  ].filter(Boolean).join(' · ')
  return (
    <div className="flex flex-col gap-1.5 rounded-lg border px-3.5 py-2.5" style={{ borderColor: TOKENS.linea }} data-vuelo-cliente>
      {/* Una pastilla por vuelo (regla del 2026-10-12): la aerolínea va una vez, junto a su
          nombre; los trayectos debajo van sin pastilla, salvo uno de otra aerolínea. */}
      {(() => { const primera = aerolineaDeFila(filas, 0); return primera ? (
        <span className="inline-flex items-center gap-1.5 text-[11.5px]" style={{ color: TOKENS.tinta }} data-aerolinea-del-vuelo>
          <PastillaAerolinea aerolinea={v.aerolinea} numeroVuelo={v.numeroVuelo} /><b>{primera.nombre}</b>
        </span>
      ) : null })()}
      {filas.map((f, i) => (
        <div key={i} className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5 text-[11.5px]" style={{ color: TOKENS.tinta }}>
          {i > 0 && aerolineaDeFila(filas, i) && (
            <span className="inline-flex items-center gap-1.5" data-aerolinea-de-otro-tramo>
              <PastillaAerolinea aerolinea={null} numeroVuelo={f.numero} /><b>{aerolineaDeFila(filas, i)!.nombre}</b>
            </span>
          )}
          <span>{[f.desde, f.hasta].filter(Boolean).join(' → ')}</span>
          {f.fecha && <span>{f.fecha}</span>}
          {(f.salida || f.llegada) && <span className="tabular-nums">{[f.salida, f.llegada].filter(Boolean).join(' – ')}</span>}
          {f.numero && <span>{f.numero}</span>}
          {f.escala && <span className="w-full text-[10.5px]" style={{ color: TOKENS.gris }}>{f.escala}</span>}
        </div>
      ))}
      {meta !== '' && <span className="text-[10.5px]" style={{ color: TOKENS.gris }}>{meta}</span>}
      {v.nota && <span className="text-[10.5px]" style={{ color: TOKENS.texto }}>{v.nota}</span>}
    </div>
  )
}

/**
 * La foto del hotel o del tour sobre la hoja: vacía, invita a pegarla, arrastrarla o subirla (como
 * la nota); con foto, se ve como sale en el documento (3:2, recortada al centro). El pegado se
 * queda aquí: la bandeja escucha el pegado en toda la página.
 *
 * Con perfil (`biblioteca`), manda la foto del perfil; la vieja de la opción (`fotoRef`, solo
 * hoteles) se ve si el perfil no tiene una, igual que en el documento (`foto-hotel-documento.ts`).
 * Pegar o soltar sobre una foto AGREGA otra al perfil si cabe; «Ver fotos» abre el perfil para
 * ordenar o quitar.
 */
function FotoDeTarjeta({
  fotoRef,
  editable,
  subiendo,
  onPoner,
  onQuitar,
  biblioteca,
}: {
  fotoRef: string | null
  editable: boolean
  subiendo: boolean
  onPoner?: (archivo: File) => void
  onQuitar?: () => void
  biblioteca: BibliotecaEnTarjeta | null
}) {
  const idEntrada = useId()
  const [sobre, setSobre] = useState(false)
  const deBiblioteca = !!biblioteca?.foto
  // Una foto de la biblioteca sin enlace firmado se ve como el degradado, no como vacía.
  const src = deBiblioteca ? biblioteca!.foto!.url ?? '' : urlDeFotoHotel(fotoRef)
  // Con el perfil lleno (3 fotos) pegar no agrega: «Ver fotos» para cambiar una.
  const puede = editable && !!onPoner && !subiendo && (!deBiblioteca || biblioteca!.admiteOtra)
  const textoVacio = biblioteca?.tipo === 'actividad' ? 'Agrega fotos de este tour' : biblioteca ? 'Agrega fotos de este hotel' : TEXTO_AGREGAR_FOTO_HOTEL

  function tomar(archivo: File | null | undefined) {
    if (!archivo || !puede) return
    onPoner?.(archivo)
  }
  const alPegar = (e: ClipboardEvent) => {
    const f = Array.from(e.clipboardData.items).find(i => i.type.startsWith('image/'))?.getAsFile()
    if (!f) return
    e.preventDefault()
    e.stopPropagation()
    tomar(f)
  }
  const alSoltar = {
    onDragOver: (e: DragEvent) => { if (puede && Array.from(e.dataTransfer?.types ?? []).includes('Files')) { e.preventDefault(); setSobre(true) } },
    onDragLeave: () => setSobre(false),
    onDrop: (e: DragEvent) => {
      setSobre(false)
      const f = Array.from(e.dataTransfer?.files ?? []).find(x => x.type.startsWith('image/'))
      if (!f) return
      e.preventDefault()
      e.stopPropagation()
      tomar(f)
    },
  }
  const entrada = (
    <input
      id={idEntrada}
      type="file"
      accept="image/*"
      hidden
      onChange={e => {
        const f = e.target.files?.[0]
        e.target.value = ''
        tomar(f)
      }}
    />
  )

  if (src === null) {
    return (
      <label
        htmlFor={idEntrada}
        tabIndex={0}
        onPaste={alPegar}
        {...alSoltar}
        className={`flex aspect-[3/2] w-[34%] shrink-0 cursor-pointer flex-col items-center justify-center gap-1 rounded-lg border-[1.5px] border-dashed px-2 text-center text-[11.5px] max-sm:w-full ${sobre ? 'border-[#E63380] bg-[#FFF7FB] text-[#E63380]' : 'border-[#C9C6D6] text-[#8A8FA3] hover:border-[#E63380] hover:text-[#E63380]'}`}
        style={{ fontFamily: HELVETICA }}
        data-foto-hotel="vacia"
      >
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <rect x="3" y="5" width="18" height="14" rx="2" /><circle cx="9" cy="11" r="2" /><path d="m21 16-5-5-8 8" />
        </svg>
        <span>{subiendo ? 'Guardando la foto…' : textoVacio}</span>
        {!subiendo && <small className="text-[10px] opacity-80">Pégala, arrástrala o súbela</small>}
        {biblioteca && !subiendo && <small className="text-[10px] opacity-70">Queda para las próximas cotizaciones</small>}
        {entrada}
      </label>
    )
  }

  return (
    <div
      tabIndex={editable ? 0 : undefined}
      onPaste={editable ? alPegar : undefined}
      {...(editable ? alSoltar : {})}
      className={`group relative aspect-[3/2] w-[34%] shrink-0 overflow-hidden rounded-lg max-sm:w-full ${sobre ? 'ring-2 ring-[#E63380]' : ''}`}
      data-foto-hotel="con-foto"
      data-de-biblioteca={deBiblioteca ? '' : undefined}
    >
      {src
        // eslint-disable-next-line @next/next/no-img-element -- enlace firmado de 5 minutos, fuera del optimizador
        ? <img src={src} alt={biblioteca?.tipo === 'actividad' ? 'Foto del tour' : 'Foto del hotel'} className="h-full w-full object-cover" />
        : <span className="block h-full w-full bg-gradient-to-br from-[#e63380] via-[#8b4fa0] to-[#1fa7bd]" aria-label="Foto" />}
      {deBiblioteca && biblioteca!.mas > 0 && (
        <span className="absolute top-1.5 right-1.5 rounded-full bg-black/60 px-1.5 py-0.5 text-[10.5px] font-semibold text-white tabular-nums" title={`${biblioteca!.mas} ${biblioteca!.mas === 1 ? 'foto más' : 'fotos más'} en el perfil`} data-mas-fotos>
          +{biblioteca!.mas}
        </span>
      )}
      {subiendo && (
        <span className="absolute inset-0 flex items-center justify-center bg-white/70 text-[11.5px] text-[#3A3F55]">Guardando la foto…</span>
      )}
      {(editable || deBiblioteca) && !subiendo && (
        <span className="absolute inset-x-0 bottom-0 flex justify-end gap-1.5 bg-gradient-to-t from-black/45 to-transparent p-1.5 opacity-0 transition-opacity focus-within:opacity-100 group-hover:opacity-100 max-sm:opacity-100">
          {biblioteca ? (
            <>
              {editable && (!deBiblioteca || biblioteca.admiteOtra) && (
                <label htmlFor={idEntrada} className="cursor-pointer rounded bg-white/90 px-2 py-0.5 text-[11px] font-semibold text-[#3A3F55] hover:bg-white" data-agregar-foto>
                  Agregar
                  {entrada}
                </label>
              )}
              <button type="button" onClick={biblioteca.onVerFotos} className="rounded border-0 bg-white/90 px-2 py-0.5 text-[11px] font-semibold text-[#3A3F55] hover:bg-white" data-ver-fotos>
                Ver fotos
              </button>
            </>
          ) : (
            <label htmlFor={idEntrada} className="cursor-pointer rounded bg-white/90 px-2 py-0.5 text-[11px] font-semibold text-[#3A3F55] hover:bg-white">
              Cambiar
              {entrada}
            </label>
          )}
          {editable && onQuitar && !deBiblioteca && (
            <button type="button" onClick={onQuitar} className="rounded border-0 bg-white/90 px-2 py-0.5 text-[11px] font-semibold text-[#B3382C] hover:bg-white">
              Quitar
            </button>
          )}
        </span>
      )}
    </div>
  )
}
