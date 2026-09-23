'use client'

import { useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { AlertTriangle, Camera, Image as ImageIcon, Loader2 } from 'lucide-react'
import { toast } from 'sonner'

import {
  agregarOpcionARanura,
  crearRanuraConOpcion,
  detectarCaptura,
  type PistasDeLugar,
} from '@/app/(app)/negocios/ranura-actions'
import { leerCasillaDeItem } from '@/app/(app)/negocios/tarifa-pax-actions'
import { deleteItem, recalcularTotales } from '@/app/(app)/negocios/cotizacion-actions'
import { definicionDeTipo, TIPOS_RANURA, type TipoRanura } from '@/lib/cotizaciones/ranuras-cotizacion'

/**
 * UNA zona de pegado para toda la cotización (paso 1 del flujo de Noor, aprobado por
 * Mauricio el 2026-09-23).
 *
 * Antes había que apretar «+ Hotel», que creaba una línea «HOTEL» vacía, abrirla y pegar ahí.
 * Ahora se pega el pantallazo aquí, ONE mira de qué es (vuelo, hotel, actividad o traslado)
 * y:
 *  · si la cotización todavía no tiene una ranura de ese tipo, la crea con su nombre («Hotel
 *    en Cancún») y la primera opción;
 *  · si ya tiene una, pregunta «¿Otra opción de Hotel en Cancún?» —sí por defecto— y la agrega
 *    como hermana; el «no» crea otra ranura que SUMA aparte (paso 2).
 * Después lee el pantallazo en la opción, con la misma lectura de siempre (`leerCasillaDeItem`).
 *
 * ⚠️ Si la lectura rechaza la captura (un listado, una grilla, otro tipo), la opción recién
 * creada se BORRA y el motivo se dice aquí: una opción vacía que nadie pidió quedaría en la
 * cotización como si alguien la hubiera cotizado.
 *
 * En celular pegar es difícil: la misma zona acepta «Subir foto», que abre la galería o la
 * cámara. La imagen no se guarda, igual que en la lectura de cada línea.
 */

type Paso =
  | { estado: 'libre' }
  | { estado: 'mirando'; preview: string }
  | {
      estado: 'preguntando'
      preview: string
      dataUrl: string
      tipo: TipoRanura
      pistas: PistasDeLugar
      ranuras: { grupo: string; etiqueta: string; opciones: number }[]
      eleccion: string
    }
  | { estado: 'eligiendo_tipo'; preview: string; dataUrl: string; motivo: string }
  | { estado: 'leyendo'; preview: string; donde: string }
  | { estado: 'rechazado'; mensaje: string; detalle?: string }

/** «Nueva ranura aparte» en el selector: no es un grupo, así que no puede chocar con uno. */
const APARTE = '__aparte__'

export default function CapturaCotizacion({
  cotizacionId,
  onOpcionCreada,
}: {
  cotizacionId: string
  /** La opción donde quedó la lectura, para abrirla y que se vea lo leído. */
  onOpcionCreada?: (itemId: string) => void
}) {
  const router = useRouter()
  const [paso, setPaso] = useState<Paso>({ estado: 'libre' })
  const entrada = useRef<HTMLInputElement>(null)
  const ocupado = paso.estado === 'mirando' || paso.estado === 'leyendo'

  function conImagen(archivo: File) {
    if (!archivo.type.startsWith('image/')) {
      setPaso({ estado: 'rechazado', mensaje: 'Eso no es una imagen. Pega o sube el pantallazo del proveedor.' })
      return
    }
    const lector = new FileReader()
    lector.onload = ev => mirar(ev.target?.result as string)
    lector.readAsDataURL(archivo)
  }

  function mirar(dataUrl: string) {
    setPaso({ estado: 'mirando', preview: dataUrl })
    void (async () => {
      const r = await detectarCaptura(cotizacionId, dataUrl)
      if (!r.ok) {
        if (r.codigo === 'SIN_TIPO' || r.codigo === 'LECTURA') {
          setPaso({ estado: 'eligiendo_tipo', preview: dataUrl, dataUrl, motivo: r.mensaje })
        } else {
          setPaso({ estado: 'rechazado', mensaje: r.mensaje })
        }
        return
      }
      const pistas: PistasDeLugar = { lugar: r.lugar, origen: r.origen, destino: r.destino }
      // Sin una ranura de ese tipo no hay nada que preguntar: nace la ranura con su nombre.
      if (r.ranuras.length === 0) {
        await crearYLeer(dataUrl, { nueva: r.tipo, pistas })
        return
      }
      setPaso({
        estado: 'preguntando',
        preview: dataUrl,
        dataUrl,
        tipo: r.tipo,
        pistas,
        ranuras: r.ranuras,
        // «Sí» por defecto: lo normal al pegar otro hotel es compararlo con el que ya hay.
        eleccion: r.ranuras[0].grupo,
      })
    })()
  }

  async function crearYLeer(
    dataUrl: string,
    destino: { grupo: string; etiqueta: string } | { nueva: TipoRanura; pistas: PistasDeLugar },
  ) {
    const donde = 'grupo' in destino ? destino.etiqueta : definicionDeTipo(destino.nueva).label
    setPaso({ estado: 'leyendo', preview: dataUrl, donde })
    const creada = 'grupo' in destino
      ? await agregarOpcionARanura(cotizacionId, destino.grupo)
      : await crearRanuraConOpcion(cotizacionId, destino.nueva, destino.pistas)
    if (!creada.success) {
      setPaso({ estado: 'rechazado', mensaje: creada.error })
      return
    }
    const lectura = await leerCasillaDeItem(creada.itemId, 'grupo_completo', dataUrl)
    if (!lectura.ok) {
      // La opción nació para esta captura: si la captura no sirve, se va con ella.
      await deleteItem(creada.itemId)
      await recalcularTotales(cotizacionId)
      setPaso({ estado: 'rechazado', mensaje: lectura.mensaje, detalle: lectura.detalle })
      router.refresh()
      return
    }
    toast.success(lectura.mensaje || 'Pantallazo leído.')
    for (const a of lectura.alertas) toast.warning(a, { duration: 8000 })
    setPaso({ estado: 'libre' })
    onOpcionCreada?.(creada.itemId)
    router.refresh()
  }

  function pegar(e: React.ClipboardEvent) {
    if (ocupado) return
    const item = Array.from(e.clipboardData.items).find(i => i.type.startsWith('image/'))
    if (!item) return
    e.preventDefault()
    const archivo = item.getAsFile()
    if (archivo) conImagen(archivo)
  }

  const preview = 'preview' in paso ? paso.preview : null

  return (
    <div className="rounded-xl border-2 border-dashed border-[#10B981]/40 bg-[#10B981]/[0.03] p-3">
      <p className="text-xs font-semibold text-[#1A1A1A]">Pantallazo del proveedor</p>
      <p className="text-[11px] text-[#6B7280]">
        Pega aquí el pantallazo de un vuelo o de un hotel: ONE ve qué es, crea el componente con
        su nombre y lee el precio. La imagen no se guarda: queda lo que se leyó de ella.
      </p>

      <div
        onPaste={pegar}
        tabIndex={0}
        role="button"
        aria-label="Pegar el pantallazo del proveedor"
        aria-busy={ocupado}
        className="mt-2 flex min-h-[64px] items-center justify-center gap-3 rounded-lg border border-dashed bg-background p-2 focus:outline-none focus:ring-2 focus:ring-[#10B981]/30"
      >
        {paso.estado === 'mirando' ? (
          <span className="flex items-center gap-1.5 text-[11px] font-medium text-[#10B981]">
            <Loader2 className="h-3.5 w-3.5 animate-spin" /> Mirando qué es…
          </span>
        ) : paso.estado === 'leyendo' ? (
          <span className="flex items-center gap-1.5 text-[11px] font-medium text-[#10B981]">
            <Loader2 className="h-3.5 w-3.5 animate-spin" /> Leyendo el pantallazo en «{paso.donde}»…
          </span>
        ) : (
          <span className="flex items-center gap-1.5 text-[11px] text-[#6B7280]">
            <ImageIcon className="h-4 w-4" />
            Pega aquí con Ctrl+V / Cmd+V
          </span>
        )}
        {preview && (
          // eslint-disable-next-line @next/next/no-img-element -- data URL del portapapeles, no optimizable por next/image
          <img src={preview} alt="Pantallazo pegado" className="max-h-14 rounded object-contain" />
        )}
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-2">
        <button
          type="button"
          disabled={ocupado}
          onClick={() => entrada.current?.click()}
          className="inline-flex items-center gap-1 rounded-md border bg-background px-2 py-1.5 text-xs font-medium text-[#1A1A1A] hover:bg-accent disabled:opacity-50"
        >
          <Camera className="h-3.5 w-3.5" />
          Subir foto
        </button>
        <input
          ref={entrada}
          type="file"
          accept="image/*"
          className="hidden"
          aria-label="Subir el pantallazo del proveedor"
          onChange={e => {
            const archivo = e.target.files?.[0]
            e.target.value = ''
            if (archivo) conImagen(archivo)
          }}
        />
      </div>

      {/* PASO 2 · ¿otra opción de la ranura que ya existe? Sí por defecto. */}
      {paso.estado === 'preguntando' && (
        <div className="mt-2 rounded-lg border bg-background p-2.5" role="group" aria-label="Dónde va este pantallazo">
          {paso.ranuras.length === 1 ? (
            <p className="text-xs font-medium text-[#1A1A1A]">¿Otra opción de {paso.ranuras[0].etiqueta}?</p>
          ) : (
            <p className="text-xs font-medium text-[#1A1A1A]">¿Otra opción de cuál?</p>
          )}
          <p className="text-[10px] text-[#6B7280]">
            Una opción compite con las demás y en cada tarifa entra una sola. Si es otro{' '}
            {definicionDeTipo(paso.tipo).label.toLowerCase()} del viaje, suma aparte.
          </p>
          {paso.ranuras.length > 1 && (
            <div className="mt-1.5 space-y-1">
              {paso.ranuras.map(r => (
                <label key={r.grupo} className="flex items-center gap-1.5 text-xs">
                  <input
                    type="radio"
                    name="ranura-destino"
                    checked={paso.eleccion === r.grupo}
                    onChange={() => setPaso({ ...paso, eleccion: r.grupo })}
                  />
                  {r.etiqueta}
                  <span className="text-[10px] text-[#6B7280]">
                    ({r.opciones} {r.opciones === 1 ? 'opción' : 'opciones'})
                  </span>
                </label>
              ))}
              <label className="flex items-center gap-1.5 text-xs">
                <input
                  type="radio"
                  name="ranura-destino"
                  checked={paso.eleccion === APARTE}
                  onChange={() => setPaso({ ...paso, eleccion: APARTE })}
                />
                Otro {definicionDeTipo(paso.tipo).label.toLowerCase()} aparte (suma)
              </label>
            </div>
          )}
          <div className="mt-2 flex flex-wrap gap-2">
            {paso.ranuras.length === 1 ? (
              <>
                <button
                  type="button"
                  autoFocus
                  onClick={() => void crearYLeer(paso.dataUrl, paso.ranuras[0])}
                  className="rounded-md bg-[#10B981] px-3 py-1.5 text-xs font-medium text-white hover:bg-[#059669]"
                >
                  Sí, otra opción
                </button>
                <button
                  type="button"
                  onClick={() => void crearYLeer(paso.dataUrl, { nueva: paso.tipo, pistas: paso.pistas })}
                  className="rounded-md border px-3 py-1.5 text-xs font-medium text-[#1A1A1A] hover:bg-accent"
                >
                  No, es otro {definicionDeTipo(paso.tipo).label.toLowerCase()} que suma aparte
                </button>
              </>
            ) : (
              <button
                type="button"
                autoFocus
                onClick={() => {
                  const elegida = paso.ranuras.find(r => r.grupo === paso.eleccion)
                  void crearYLeer(paso.dataUrl, elegida ?? { nueva: paso.tipo, pistas: paso.pistas })
                }}
                className="rounded-md bg-[#10B981] px-3 py-1.5 text-xs font-medium text-white hover:bg-[#059669]"
              >
                Agregar
              </button>
            )}
            <button
              type="button"
              onClick={() => setPaso({ estado: 'libre' })}
              className="rounded-md px-3 py-1.5 text-xs text-[#6B7280] hover:bg-accent"
            >
              Descartar
            </button>
          </div>
        </div>
      )}

      {/* Sin tipo reconocible: quien cotiza dice qué es. */}
      {paso.estado === 'eligiendo_tipo' && (
        <div className="mt-2 rounded-lg border border-amber-300 bg-amber-50 p-2.5">
          <p className="flex items-start gap-1.5 text-[11px] font-medium text-amber-900">
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            {paso.motivo}
          </p>
          <div className="mt-2 flex flex-wrap gap-2">
            {TIPOS_RANURA.map(t => (
              <button
                key={t}
                type="button"
                onClick={() => void crearYLeer(paso.dataUrl, { nueva: t, pistas: {} })}
                className="rounded-md border bg-background px-2.5 py-1 text-xs font-medium text-[#1A1A1A] hover:bg-accent"
              >
                Es {definicionDeTipo(t).label.toLowerCase()}
              </button>
            ))}
            <button
              type="button"
              onClick={() => setPaso({ estado: 'libre' })}
              className="rounded-md px-2.5 py-1 text-xs text-[#6B7280] hover:bg-accent"
            >
              Descartar
            </button>
          </div>
        </div>
      )}

      {paso.estado === 'rechazado' && (
        <div className="mt-2 rounded-md border border-red-300 bg-red-50 p-2">
          <p className="flex items-start gap-1.5 text-[11px] font-medium text-red-900">
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            {paso.mensaje}
          </p>
          {paso.detalle && <p className="mt-0.5 pl-5 text-[10px] text-red-800">{paso.detalle}</p>}
          <p className="mt-0.5 pl-5 text-[10px] text-red-700">Este pantallazo no se guardó.</p>
        </div>
      )}
    </div>
  )
}
