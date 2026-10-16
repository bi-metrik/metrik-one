'use client'

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { Check, ImagePlus, Images, Loader2, RefreshCw, Trash2 } from 'lucide-react'
import { toast } from 'sonner'

import { useTransitionTolerante } from '@/hooks/use-transition-tolerante'
import {
  confirmarFotoDelCatalogo,
  fotosDeLaPropuesta,
  otraFotoDeCommons,
  quitarFotoDelCatalogo,
  subirFotoPropia,
  sugerirFotosQueFaltan,
  type FotoDelPanel,
  type PanelFotos,
} from '@/app/(app)/negocios/fotos-catalogo-actions'
import { comprimirFotoHotel } from '@/lib/cotizaciones/foto-hotel-navegador'
import type { TipoFoto } from '@/lib/fotos/clave'
import SelectorFotos, { type PedidoFoto } from '../fotos/selector-fotos'

const TITULO: Record<TipoFoto, string> = { ciudad: 'Ciudades', hotel: 'Hoteles', actividad: 'Actividades y planes opcionales' }

/**
 * «Fotos de la propuesta» (PR 4): la foto de cada ciudad, hotel y actividad que sale en la
 * propuesta nueva. Son del catálogo del espacio: la que se pone aquí sirve para las siguientes
 * cotizaciones que nombren lo mismo.
 *
 * Al abrir, las ciudades y actividades que faltan se buscan solas en Wikimedia Commons (solo
 * licencias libres, con su crédito al pie del documento). La asesora pide otra, abre el selector
 * de 12 opciones («Elegir»), sube la suya o la quita. Los hoteles NUNCA se buscan solos: los elige
 * una persona en el selector o los sube (Mauricio, 2026-10-14 y 2026-10-16). Las demás fotos de
 * cada elemento (hasta 3) se manejan en la biblioteca (`/fotos`).
 */
export default function FotosPropuestaPanel({ cotizacionId, editable }: { cotizacionId: string; editable: boolean }) {
  const [estado, setEstado] = useState<PanelFotos | null>(null)
  const [ocupado, setOcupado] = useState<string | null>(null)
  const [, start] = useTransitionTolerante()
  const buscado = useRef(false)
  const [selector, setSelector] = useState<{ pedido: PedidoFoto; reemplaza: string | null } | null>(null)

  const aplicar = (r: PanelFotos) => {
    if (!r.ok) {
      toast.error(r.error)
      return
    }
    setEstado(r)
    if (r.aviso) toast.message(r.aviso)
  }

  const correr = (clave: string, accion: () => Promise<PanelFotos>) => {
    if (ocupado) return
    setOcupado(clave)
    start(async () => {
      try {
        aplicar(await accion())
      } catch {
        toast.error('No se pudo. Vuelve a intentarlo.')
      } finally {
        setOcupado(null)
      }
    })
  }

  useEffect(() => {
    let vivo = true
    void fotosDeLaPropuesta(cotizacionId).then((r) => {
      if (!vivo) return
      setEstado(r)
      // Sugerencia automática: una vez por apertura, solo si falta alguna y se puede escribir.
      // Los hoteles no cuentan: su foto la sube la asesora, nunca se busca.
      const faltan = r.ok && r.editable && editable && r.fotos.some((f) => f.sugerible && !f.foto && !f.enBanco)
      if (faltan && !buscado.current) {
        buscado.current = true
        setOcupado('todas')
        void sugerirFotosQueFaltan(cotizacionId)
          .then((s) => vivo && aplicar(s))
          .finally(() => vivo && setOcupado(null))
      }
    })
    return () => {
      vivo = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cotizacionId])

  if (!estado) return null
  if (!estado.ok) {
    return (
      <div className="space-y-1 border-t pt-3" data-fotos-propuesta>
        <p className="text-xs font-semibold">Fotos de la propuesta</p>
        <p className="text-[11px] text-muted-foreground">{estado.error}</p>
      </div>
    )
  }

  const puede = editable && estado.editable
  const subir = (f: FotoDelPanel, archivo: File) =>
    correr(`${f.tipo}:${f.clave}`, async () => {
      const foto = await comprimirFotoHotel(archivo)
      if (!foto) return { ok: false, error: 'Ese archivo no es una foto. Usa un JPG o un PNG.' }
      return subirFotoPropia(cotizacionId, f.tipo, f.clave, foto.dataUrl)
    })

  const grupos = (['ciudad', 'hotel', 'actividad'] as TipoFoto[])
    .map((tipo) => ({ tipo, fotos: estado.fotos.filter((f) => f.tipo === tipo) }))
    .filter((g) => g.fotos.length > 0)

  return (
    <div className="space-y-2 border-t pt-3" data-fotos-propuesta>
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs font-semibold">Fotos de la propuesta</p>
        <Link href="/fotos" className="inline-flex items-center gap-1 text-[11px] text-muted-foreground underline-offset-2 hover:underline">
          <Images className="h-3 w-3" /> Biblioteca de fotos
        </Link>
        {ocupado === 'todas' && (
          <span className="inline-flex items-center gap-1 text-[11px] text-muted-foreground">
            <Loader2 className="h-3 w-3 animate-spin" /> Buscando en Wikimedia Commons…
          </span>
        )}
      </div>
      <p className="text-[11px] text-muted-foreground">
        Las de ciudades y actividades que faltan se buscan solas en Wikimedia Commons, solo con licencia libre y con su crédito al
        pie. Revísalas: elige otra entre 12 opciones o sube la tuya. La de cada hotel la eliges tú. Quedan en la biblioteca para las
        próximas cotizaciones. Sin foto, sale el degradado.
      </p>
      {grupos.map((g) => (
        <div key={g.tipo} className="space-y-1">
          <p className="text-[11px] font-medium text-muted-foreground">{TITULO[g.tipo]}</p>
          <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            {g.fotos.map((f) => {
              const k = `${f.tipo}:${f.clave}`
              const trabajando = ocupado === k
              return (
                <li key={k} className="flex gap-2 rounded-md border p-1.5" data-foto={k}>
                  <div
                    className="h-14 w-20 shrink-0 rounded bg-gradient-to-br from-[#e63380] via-[#8b4fa0] to-[#1fa7bd] bg-cover bg-center"
                    style={f.foto?.url ? { backgroundImage: `url(${f.foto.url})` } : undefined}
                    aria-label={f.foto ? `Foto de ${f.nombre}` : `${f.nombre} sin foto`}
                  />
                  <div className="min-w-0 flex-1 space-y-0.5">
                    <p className="truncate text-xs font-medium" title={f.nombre}>
                      {f.nombre}
                      {f.tipo !== 'ciudad' && f.ciudad ? <span className="font-normal text-muted-foreground"> · {f.ciudad}</span> : null}
                    </p>
                    <p className="truncate text-[10px] text-muted-foreground" title={f.foto?.credito ?? undefined}>
                      {f.foto
                        ? !f.foto.seImprime
                          ? 'No sale en la propuesta: elige la foto del hotel'
                          : f.foto.origen === 'asesora'
                            ? 'Foto propia'
                            : f.foto.origen === 'sitio_oficial'
                              ? `Página oficial · ${f.foto.credito ?? ''}`
                              : `${f.foto.revisada ? '' : 'Sugerida · '}${f.foto.credito ?? 'Wikimedia Commons'}`
                        : f.enBanco
                          ? 'Usa la foto de ONE de esta ciudad'
                          : f.sugerible
                            ? 'Sin foto: sale el degradado'
                            : 'Sin foto: sale el degradado. Elige la del hotel'}
                      {f.total > 1 ? ` · ${f.total} fotos` : ''}
                    </p>
                    {puede && (
                      <div className="flex flex-wrap items-center gap-1">
                        {f.sugerible && f.foto && f.foto.origen === 'wikimedia' && !f.foto.revisada && (
                          <button type="button" disabled={!!ocupado} onClick={() => correr(k, () => confirmarFotoDelCatalogo(cotizacionId, f.tipo, f.clave))}
                            className="inline-flex items-center gap-0.5 rounded px-1.5 py-0.5 text-[10px] hover:bg-accent disabled:opacity-50">
                            <Check className="h-3 w-3" /> Está bien
                          </button>
                        )}
                        {f.sugerible && (
                          <button type="button" disabled={!!ocupado} onClick={() => correr(k, () => otraFotoDeCommons(cotizacionId, f.tipo, f.clave))}
                            className="inline-flex items-center gap-0.5 rounded px-1.5 py-0.5 text-[10px] hover:bg-accent disabled:opacity-50">
                            {trabajando ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />} {f.foto ? 'Otra' : 'Buscar'}
                          </button>
                        )}
                        {!f.sugerible && trabajando && <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />}
                        <button type="button" disabled={!!ocupado} onClick={() => setSelector({ pedido: { tipo: f.tipo, nombre: f.nombre, ciudad: f.ciudad }, reemplaza: f.foto?.id ?? null })}
                          className="inline-flex items-center gap-0.5 rounded px-1.5 py-0.5 text-[10px] hover:bg-accent disabled:opacity-50" data-elegir>
                          <Images className="h-3 w-3" /> Elegir
                        </button>
                        <label className={`inline-flex cursor-pointer items-center gap-0.5 rounded px-1.5 py-0.5 text-[10px] hover:bg-accent ${ocupado ? 'pointer-events-none opacity-50' : ''}`}>
                          <ImagePlus className="h-3 w-3" /> Subir la mía
                          <input type="file" accept="image/*" className="hidden" onChange={(e) => { const a = e.target.files?.[0]; e.target.value = ''; if (a) subir(f, a) }} />
                        </label>
                        {f.foto && (
                          <button type="button" disabled={!!ocupado} onClick={() => correr(k, () => quitarFotoDelCatalogo(cotizacionId, f.tipo, f.clave))}
                            className="inline-flex items-center gap-0.5 rounded px-1.5 py-0.5 text-[10px] text-muted-foreground hover:bg-accent disabled:opacity-50">
                            <Trash2 className="h-3 w-3" /> Quitar
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                </li>
              )
            })}
          </ul>
        </div>
      ))}
      <SelectorFotos
        pedido={selector?.pedido ?? null}
        reemplaza={selector?.reemplaza ?? null}
        sitioOficial={estado.sitioOficial}
        abierto={!!selector}
        onCerrar={() => setSelector(null)}
        onElegida={() => {
          setSelector(null)
          void fotosDeLaPropuesta(cotizacionId).then(aplicar)
        }}
      />
    </div>
  )
}
