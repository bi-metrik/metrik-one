'use client'

import { useState, type DragEvent } from 'react'
import { ChevronLeft, ChevronRight, ImagePlus, Loader2, Star, Trash2, Unlink } from 'lucide-react'
import { toast } from 'sonner'

import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog'
import { comprimirFotoHotel } from '@/lib/cotizaciones/foto-hotel-navegador'
import type { PedidoAutorizacion } from '@/lib/fotos/autorizacion'
import type { CategoriaFoto } from '@/lib/fotos/categoria'
import { NOMBRE_CATEGORIA } from '@/lib/fotos/categoria'
import { MAX_FOTOS_POR_ELEMENTO, type TipoFoto } from '@/lib/fotos/clave'
import type { ElementoVista, FotoVista } from '@/lib/fotos/vista'
import { moverFoto, quitarFotoDeBiblioteca, separarNombreDelPerfil, subirFotoABiblioteca, type PedidoFoto, type ResultadoElemento } from './actions'
import { AutorizacionFoto } from './autorizacion-foto'
import { useImagenPegada } from './usar-imagen-pegada'

/** Las acciones del perfil (inyectables para verlo con datos de muestra). */
export interface AccionesPerfil {
  subir: (p: PedidoFoto, dataUrl: string, reemplaza?: string | null, categoria?: string | null, autorizacion?: PedidoAutorizacion) => Promise<ResultadoElemento>
  mover: (id: string, hacia: 'antes' | 'despues' | 'primera') => Promise<ResultadoElemento>
  quitar: (id: string) => Promise<ResultadoElemento>
  separar: (aliasId: string) => Promise<ResultadoElemento>
}

const ACCIONES: AccionesPerfil = { subir: subirFotoABiblioteca, mover: moverFoto, quitar: quitarFotoDeBiblioteca, separar: separarNombreDelPerfil }

export const NOMBRE_TIPO: Record<TipoFoto, string> = { hotel: 'hotel', actividad: 'tour', ciudad: 'ciudad' }
const ORIGEN: Record<FotoVista['origen'], string> = { asesora: 'Propia', wikimedia: 'Wikimedia Commons', sitio_oficial: 'Página oficial' }

/** «Agrega fotos de este hotel» / «… de este tour» / «… de esta ciudad». */
export function textoAgregarFotos(tipo: TipoFoto): string {
  return tipo === 'ciudad' ? 'Agrega fotos de esta ciudad' : `Agrega fotos de este ${NOMBRE_TIPO[tipo]}`
}

/**
 * El perfil de un hotel, un tour o una ciudad: sus fotos (hasta 3, la primera es la principal y
 * sale en grande), con calma. Pegar (Ctrl+V), arrastrar o subir, y listo: la casilla de
 * autorización y queda. Se reordenan con las flechas y se quitan. Lo abren la pantalla «Hoteles y
 * tours» y la tarjeta de la cotización («Ver fotos»).
 */
export default function PerfilFotos({
  elemento,
  pedido,
  abierto,
  editable,
  onCerrar,
  onCambio,
  acciones = ACCIONES,
}: {
  /** El perfil como está (`null` = todavía sin fotos ni fila). */
  elemento: ElementoVista | null
  /** Cómo pedírselo al servidor (el nombre de la tarjeta o del perfil). */
  pedido: PedidoFoto
  abierto: boolean
  editable: boolean
  onCerrar: () => void
  onCambio: (e: ElementoVista | null) => void
  acciones?: AccionesPerfil
}) {
  const [porSubir, setPorSubir] = useState<Blob | null>(null)
  const [ocupado, setOcupado] = useState<string | null>(null)
  const [sobre, setSobre] = useState(false)
  const fotos = elemento?.fotos ?? []
  const admiteOtra = editable && fotos.length < MAX_FOTOS_POR_ELEMENTO
  const tipo = elemento?.tipo ?? pedido.tipo
  const nombre = elemento?.nombre ?? pedido.nombre
  const ciudad = elemento?.ciudad ?? pedido.ciudad

  const tomar = (b: Blob | null | undefined) => {
    if (!b || !admiteOtra || ocupado) return
    if (!b.type.startsWith('image/')) return void toast.error('Ese archivo no es una foto. Usa un JPG o un PNG.')
    setPorSubir(b)
  }
  useImagenPegada({ abierto: abierto && admiteOtra && !porSubir, ocupado: !!ocupado, onImagen: tomar })

  const correr = async (clave: string, accion: () => Promise<ResultadoElemento>, exito?: string) => {
    if (ocupado) return false
    setOcupado(clave)
    try {
      const r = await accion()
      if (!r.ok) {
        toast.error(r.error)
        return false
      }
      if (exito) toast.success(exito)
      onCambio(r.elemento)
      return true
    } catch {
      toast.error('No se pudo. Vuelve a intentarlo.')
      return false
    } finally {
      setOcupado(null)
    }
  }

  const subir = (permiso: PedidoAutorizacion, categoria: CategoriaFoto | null) =>
    void correr(
      'subir',
      async () => {
        const foto = porSubir ? await comprimirFotoHotel(porSubir) : null
        if (!foto) return { ok: false, error: 'Ese archivo no es una foto. Usa un JPG o un PNG.' }
        const r = await acciones.subir(pedido, foto.dataUrl, null, categoria, permiso)
        if (r.ok) setPorSubir(null)
        return r
      },
      'Foto guardada.',
    )

  const soltar = {
    onDragOver: (e: DragEvent) => {
      if (admiteOtra && Array.from(e.dataTransfer?.types ?? []).includes('Files')) {
        e.preventDefault()
        setSobre(true)
      }
    },
    onDragLeave: () => setSobre(false),
    onDrop: (e: DragEvent) => {
      setSobre(false)
      const f = Array.from(e.dataTransfer?.files ?? []).find((x) => x.type.startsWith('image/'))
      if (!f) return
      e.preventDefault()
      tomar(f)
    },
  }

  const entrada = (
    <input
      type="file"
      accept="image/*"
      className="hidden"
      onChange={(e) => {
        const a = e.target.files?.[0]
        e.target.value = ''
        tomar(a)
      }}
    />
  )

  return (
    <Dialog open={abierto} onOpenChange={(v) => !v && !ocupado && (setPorSubir(null), onCerrar())}>
      <DialogContent className="flex max-h-[92vh] flex-col gap-3 sm:max-w-2xl" data-perfil-fotos {...soltar}>
        <div className="space-y-0.5 pr-6">
          <DialogTitle className="text-base">{nombre}</DialogTitle>
          <DialogDescription className="text-xs">
            {ciudad && tipo !== 'ciudad' ? `${ciudad} · ` : ''}
            Hasta {MAX_FOTOS_POR_ELEMENTO} fotos. La primera sale en grande en la propuesta y las otras a su lado, si caben. Salen solas en
            cada cotización que nombre este {NOMBRE_TIPO[tipo]}.
          </DialogDescription>
        </div>

        {elemento && elemento.alias.length > 0 && (
          <div className="text-[11px] text-muted-foreground" data-alias>
            También llega como:{' '}
            {elemento.alias.map((a, i) => (
              <span key={a.id} className="inline-flex items-center gap-0.5">
                {i > 0 ? ' · ' : ''}«{a.nombre}»
                {editable && (
                  <button
                    type="button"
                    title="No es el mismo: separarlo"
                    disabled={!!ocupado}
                    onClick={() => void correr(`alias:${a.id}`, () => acciones.separar(a.id), 'Separado. La próxima cotización que lo nombre te preguntará.')}
                    className="rounded p-0.5 hover:bg-accent disabled:opacity-50"
                    data-separar={a.id}
                  >
                    <Unlink className="h-3 w-3" />
                  </button>
                )}
              </span>
            ))}
          </div>
        )}

        {porSubir ? (
          <AutorizacionFoto
            archivo={porSubir}
            guardando={ocupado === 'subir'}
            conCategoria={tipo === 'hotel'}
            destino={`Queda en el perfil de ${nombre}.`}
            onCancelar={() => setPorSubir(null)}
            onConfirmar={subir}
          />
        ) : fotos.length === 0 ? (
          <label
            className={`flex min-h-48 flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed p-4 text-center text-sm ${
              editable ? 'cursor-pointer hover:bg-accent/40' : ''
            } ${sobre ? 'border-[#E63380] bg-[#FFF7FB] text-[#E63380]' : 'text-muted-foreground'}`}
            data-sin-fotos
          >
            <ImagePlus className="h-6 w-6" />
            <span className="font-medium">{textoAgregarFotos(tipo)}</span>
            {editable ? (
              <span className="text-[11px]">Pégala aquí (Ctrl+V), arrástrala o haz clic para elegirla. Te pedimos confirmar que tienes autorización para usarla.</span>
            ) : (
              <span className="text-[11px]">Todavía no tiene fotos.</span>
            )}
            {editable && entrada}
          </label>
        ) : (
          <ul className="grid grid-cols-1 gap-2 sm:grid-cols-3" data-fotos={fotos.length}>
            {fotos.map((f, i) => (
              <li key={f.id} className={`overflow-hidden rounded-md border ${f.principal ? 'border-[#10B981]' : ''}`} data-foto={f.id} data-principal={f.principal || undefined}>
                <div
                  className="relative aspect-[3/2] bg-gradient-to-br from-[#e63380] via-[#8b4fa0] to-[#1fa7bd] bg-cover bg-center"
                  style={f.url ? { backgroundImage: `url(${JSON.stringify(f.url)})` } : undefined}
                  role="img"
                  aria-label={`Foto ${i + 1} de ${nombre}`}
                >
                  {f.principal && (
                    <span className="absolute top-1 left-1 inline-flex items-center gap-0.5 rounded bg-[#10B981] px-1.5 py-0.5 text-[10px] font-medium text-white">
                      <Star className="h-2.5 w-2.5 fill-current" /> Principal
                    </span>
                  )}
                  {!f.seImprime && (
                    <span className="absolute right-1 bottom-1 left-1 rounded bg-black/65 px-1 py-0.5 text-[10px] text-white">No sale en la propuesta: quítala y sube una propia</span>
                  )}
                </div>
                <div className="flex items-center justify-between gap-1 p-1">
                  <span className="truncate text-[10px] text-muted-foreground" title={f.fuente ?? undefined}>
                    {f.categoria ? NOMBRE_CATEGORIA[f.categoria] : ORIGEN[f.origen]}
                    {f.origen === 'wikimedia' && f.fuente ? ` · ${f.fuente}` : ''}
                  </span>
                  {editable && (
                    <span className="flex shrink-0 items-center">
                      {!f.principal && (
                        <button type="button" title="Hacerla la principal" disabled={!!ocupado} onClick={() => void correr(f.id, () => acciones.mover(f.id, 'primera'))} className="rounded p-1 hover:bg-accent disabled:opacity-50" data-hacer-principal>
                          <Star className="h-3.5 w-3.5" />
                        </button>
                      )}
                      <button type="button" title="Moverla antes" disabled={!!ocupado || i === 0} onClick={() => void correr(f.id, () => acciones.mover(f.id, 'antes'))} className="rounded p-1 hover:bg-accent disabled:opacity-30" data-mover="antes">
                        <ChevronLeft className="h-3.5 w-3.5" />
                      </button>
                      <button type="button" title="Moverla después" disabled={!!ocupado || i === fotos.length - 1} onClick={() => void correr(f.id, () => acciones.mover(f.id, 'despues'))} className="rounded p-1 hover:bg-accent disabled:opacity-30" data-mover="despues">
                        <ChevronRight className="h-3.5 w-3.5" />
                      </button>
                      <button type="button" title="Quitarla" disabled={!!ocupado} onClick={() => void correr(f.id, () => acciones.quitar(f.id))} className="rounded p-1 text-muted-foreground hover:bg-accent disabled:opacity-50" data-quitar>
                        {ocupado === f.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
                      </button>
                    </span>
                  )}
                </div>
              </li>
            ))}
            {admiteOtra && (
              <li>
                <label
                  className={`flex aspect-[3/2] cursor-pointer flex-col items-center justify-center gap-1 rounded-md border-2 border-dashed px-2 text-center text-[11px] hover:bg-accent/40 ${
                    sobre ? 'border-[#E63380] bg-[#FFF7FB] text-[#E63380]' : 'text-muted-foreground'
                  }`}
                  data-agregar-foto
                >
                  <ImagePlus className="h-4 w-4" />
                  <span className="font-medium">Agregar foto</span>
                  <span>Pégala (Ctrl+V), arrástrala o elígela</span>
                  {entrada}
                </label>
              </li>
            )}
          </ul>
        )}
      </DialogContent>
    </Dialog>
  )
}
