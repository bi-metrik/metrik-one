'use client'

import { useRef, useState, type DragEvent } from 'react'
import { ExternalLink, FileUp, Loader2, Pencil, Trash2 } from 'lucide-react'
import { toast } from 'sonner'

import { NOMBRE_SEMAFORO, fechaCorta, vigenciaDeNombre } from '@/lib/proveedores/vigencia'
import type { TarifarioVista } from '@/lib/proveedores/vista'
import { abrirTarifario, borrarTarifario, editarTarifario, registrarTarifario, type FichaProveedor } from '../actions'
import { PastillaSemaforo } from '../semaforo'
import { subirArchivoProveedor } from './subir'

const campo = 'block h-9 w-full min-w-0 rounded-md border bg-background px-2 text-sm text-foreground'
const etiqueta = 'min-w-0 space-y-0.5 text-[11px] text-muted-foreground'

interface Vigencia {
  desde: string
  hasta: string
  temporada: string
}

/** Lo que dice la vigencia: «1 ene 2026 – 31 dic 2026», «hasta 31 dic 2026», «sin fechas». */
function textoVigencia(t: Pick<TarifarioVista, 'desde' | 'hasta'>): string {
  if (t.desde && t.hasta) return `${fechaCorta(t.desde)} – ${fechaCorta(t.hasta)}`
  if (t.hasta) return `hasta ${fechaCorta(t.hasta)}`
  if (t.desde) return `desde ${fechaCorta(t.desde)}`
  return 'sin fechas'
}

function CamposVigencia({ v, onCambio }: { v: Vigencia; onCambio: (v: Vigencia) => void }) {
  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
      <label className={etiqueta}>
        Vale desde
        <input type="date" className={campo} value={v.desde} onChange={(e) => onCambio({ ...v, desde: e.target.value })} />
      </label>
      <label className={etiqueta}>
        Vale hasta
        <input type="date" className={campo} value={v.hasta} onChange={(e) => onCambio({ ...v, hasta: e.target.value })} />
      </label>
      <label className={`${etiqueta} col-span-2 sm:col-span-1`}>
        Temporada
        <input className={campo} value={v.temporada} onChange={(e) => onCambio({ ...v, temporada: e.target.value })} placeholder="Alta 2026" />
      </label>
    </div>
  )
}

/**
 * «Tarifarios» de la ficha: subir = arrastrar el PDF (o la imagen) + desde/hasta + temporada, en un
 * solo paso. Sin fechas se puede, pero se piden: sin ellas el aviso de la cotización no sabe si el
 * tarifario vale. Si el hotel se compra por un mayorista y no tiene tarifario propio, se muestra
 * el del mayorista.
 */
export default function SeccionTarifarios({ ficha, editable, onCambio }: { ficha: FichaProveedor; editable: boolean; onCambio: () => void }) {
  const [archivo, setArchivo] = useState<File | null>(null)
  const [nueva, setNueva] = useState<Vigencia>({ desde: '', hasta: '', temporada: '' })
  const [paraTarifario, setParaTarifario] = useState<string | null>(null)
  const [ocupado, setOcupado] = useState<string | null>(null)
  const [editando, setEditando] = useState<{ id: string; v: Vigencia } | null>(null)
  const [sobre, setSobre] = useState(false)
  const entrada = useRef<HTMLInputElement>(null)

  const correr = async (clave: string, fn: () => Promise<{ ok: true } | { ok: false; error: string }>, exito?: string) => {
    if (ocupado) return false
    setOcupado(clave)
    try {
      const r = await fn()
      if (!r.ok) {
        toast.error(r.error)
        return false
      }
      if (exito) toast.success(exito)
      onCambio()
      return true
    } catch {
      toast.error('No se pudo. Vuelve a intentarlo.')
      return false
    } finally {
      setOcupado(null)
    }
  }

  const tomar = (f: File | null | undefined, tarifarioId: string | null = null) => {
    if (!f) return
    setArchivo(f)
    setParaTarifario(tarifarioId)
    // La fecha sugerida por el nombre («Tarifas 2026.pdf»): se ve y se puede cambiar antes de subir.
    const sugerida = tarifarioId ? null : vigenciaDeNombre(f.name)
    if (sugerida && !nueva.desde && !nueva.hasta) setNueva({ ...nueva, desde: sugerida.desde ?? '', hasta: sugerida.hasta ?? '' })
  }

  const subir = () =>
    archivo &&
    void correr(
      'subir',
      async () => {
        const s = await subirArchivoProveedor(ficha.id, 'tarifarios', archivo)
        if (!s.ok) return s
        const existente = paraTarifario ? ficha.tarifarios.find((t) => t.id === paraTarifario) : null
        const v = existente ? { desde: existente.desde ?? '', hasta: existente.hasta ?? '', temporada: existente.temporada ?? '' } : nueva
        return registrarTarifario(ficha.id, { ruta: s.ruta, nombreArchivo: archivo.name, desde: v.desde || null, hasta: v.hasta || null, temporada: v.temporada || null, tarifarioId: paraTarifario })
      },
      'Tarifario guardado',
    ).then((ok) => {
      if (ok) {
        setArchivo(null)
        setParaTarifario(null)
        setNueva({ desde: '', hasta: '', temporada: '' })
      }
    })

  const abrir = async (id: string) => {
    const r = await abrirTarifario(id)
    if (!r.ok) return void toast.error(r.error)
    window.open(r.url, '_blank', 'noopener')
  }

  const soltar = (e: DragEvent) => {
    e.preventDefault()
    setSobre(false)
    if (editable) tomar(e.dataTransfer.files?.[0])
  }

  const deVia = ficha.tarifarios.length === 0 && ficha.via && ficha.via.tarifarios.length > 0 ? ficha.via : null

  return (
    <section className="space-y-3" data-seccion="tarifarios">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="text-sm font-semibold">Tarifarios</h2>
        <PastillaSemaforo semaforo={ficha.semaforo.semaforo} />
      </div>

      {ficha.tarifarios.length === 0 && !deVia && (
        <p className="m-0 text-xs text-muted-foreground">
          Todavía no hay tarifario. Pídeselo {ficha.via ? `al mayorista ${ficha.via.nombre}` : 'al proveedor'} y súbelo aquí con sus fechas.
        </p>
      )}

      {deVia && (
        <div className="rounded-md border border-dashed p-2 text-xs" data-tarifario-del-mayorista>
          <p className="m-0 text-muted-foreground">Se compra a través de {deVia.nombre}: vale su tarifario.</p>
          <ul className="mt-1 space-y-0.5">
            {deVia.tarifarios.map((t) => (
              <li key={t.id} className="flex flex-wrap items-center gap-2">
                <span className="font-medium">{t.nombreArchivo ?? 'Tarifario'}</span>
                <span className="text-muted-foreground">{textoVigencia(t)}</span>
                <span className="text-muted-foreground">· {NOMBRE_SEMAFORO[t.estado]}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {ficha.tarifarios.length > 0 && (
        <ul className="divide-y rounded-lg border" data-lista-tarifarios>
          {ficha.tarifarios.map((t) => (
            <li key={t.id} className="space-y-1.5 p-2" data-tarifario={t.id}>
              <div className="flex flex-wrap items-start gap-2">
                <div className="min-w-0 flex-1">
                  <p className="m-0 truncate text-sm font-medium">{t.nombreArchivo ?? 'Tarifario'}</p>
                  <p className="m-0 text-[11px] text-muted-foreground">
                    {textoVigencia(t)}
                    {t.temporada ? ` · ${t.temporada}` : ''}
                    {t.subidoPor ? ` · subió ${t.subidoPor}` : ''}
                  </p>
                  {t.inferida && <p className="m-0 text-[11px] text-[#9A5F0C]">Fechas sugeridas por el nombre del archivo: confírmalas.</p>}
                  {!t.tieneArchivo && <p className="m-0 text-[11px] text-[#9A5F0C]">Falta subir el archivo (vino de Airtable sin él).</p>}
                </div>
                <PastillaSemaforo semaforo={t.estado} />
              </div>
              <div className="flex flex-wrap gap-1.5 text-xs">
                {t.tieneArchivo && (
                  <button type="button" className="inline-flex items-center gap-1 rounded-md border px-2 py-1" onClick={() => void abrir(t.id)}>
                    <ExternalLink className="h-3.5 w-3.5" /> Abrir
                  </button>
                )}
                {editable && !t.tieneArchivo && (
                  <button type="button" className="inline-flex items-center gap-1 rounded-md border px-2 py-1" onClick={() => (setParaTarifario(t.id), entrada.current?.click())}>
                    <FileUp className="h-3.5 w-3.5" /> Subir el archivo
                  </button>
                )}
                {editable && (
                  <button
                    type="button"
                    className="inline-flex items-center gap-1 rounded-md border px-2 py-1"
                    onClick={() => setEditando({ id: t.id, v: { desde: t.desde ?? '', hasta: t.hasta ?? '', temporada: t.temporada ?? '' } })}
                  >
                    <Pencil className="h-3.5 w-3.5" /> Fechas
                  </button>
                )}
                {editable && (
                  <button
                    type="button"
                    className="inline-flex items-center gap-1 rounded-md border px-2 py-1 text-[#B42318]"
                    disabled={!!ocupado}
                    onClick={() => {
                      if (window.confirm('¿Quitar este tarifario? El archivo se borra.')) void correr(`borrar:${t.id}`, () => borrarTarifario(t.id), 'Tarifario quitado')
                    }}
                  >
                    <Trash2 className="h-3.5 w-3.5" /> Quitar
                  </button>
                )}
              </div>
              {editando?.id === t.id && (
                <div className="space-y-2 rounded-md bg-muted/40 p-2">
                  <CamposVigencia v={editando.v} onCambio={(v) => setEditando({ id: t.id, v })} />
                  <div className="flex gap-2">
                    <button
                      type="button"
                      className="inline-flex h-8 items-center gap-1 rounded-md border bg-background px-3 text-xs font-medium"
                      disabled={!!ocupado}
                      onClick={() =>
                        void correr(`editar:${t.id}`, () => editarTarifario(t.id, { desde: editando.v.desde || null, hasta: editando.v.hasta || null, temporada: editando.v.temporada || null, notas: t.notas }), 'Fechas guardadas').then(
                          (ok) => ok && setEditando(null),
                        )
                      }
                    >
                      {ocupado === `editar:${t.id}` && <Loader2 className="h-3.5 w-3.5 animate-spin" />} Guardar
                    </button>
                    <button type="button" className="h-8 px-2 text-xs text-muted-foreground" onClick={() => setEditando(null)}>
                      Cancelar
                    </button>
                  </div>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}

      <input
        ref={entrada}
        type="file"
        accept="application/pdf,image/jpeg,image/png,image/webp"
        hidden
        onChange={(e) => {
          const f = e.target.files?.[0]
          e.target.value = ''
          tomar(f, paraTarifario)
        }}
      />

      {editable && (
        <div
          onDragOver={(e) => (e.preventDefault(), setSobre(true))}
          onDragLeave={() => setSobre(false)}
          onDrop={soltar}
          className={`space-y-2 rounded-lg border-2 border-dashed p-3 ${sobre ? 'border-[#10B981] bg-[#10B981]/5' : ''}`}
          data-subir-tarifario
        >
          {!archivo ? (
            <button type="button" className="flex w-full flex-col items-center gap-1 py-2 text-xs text-muted-foreground" onClick={() => (setParaTarifario(null), entrada.current?.click())}>
              <FileUp className="h-5 w-5" />
              Arrastra aquí el tarifario (PDF o imagen) o toca para elegirlo
            </button>
          ) : (
            <>
              <p className="m-0 truncate text-xs">
                <b>{archivo.name}</b>
                {paraTarifario ? ' · para el tarifario que no tenía archivo' : ''}
              </p>
              {!paraTarifario && (
                <>
                  <CamposVigencia v={nueva} onCambio={setNueva} />
                  {!nueva.desde && !nueva.hasta && <p className="m-0 text-[11px] text-[#9A5F0C]">Pon hasta cuándo vale: sin fechas, la cotización no puede avisar cuando venza.</p>}
                </>
              )}
              <div className="flex gap-2">
                <button type="button" onClick={subir} disabled={!!ocupado} className="inline-flex h-9 items-center gap-1 rounded-md bg-[#10B981] px-4 text-sm font-medium text-white hover:bg-[#059669] disabled:opacity-50">
                  {ocupado === 'subir' && <Loader2 className="h-4 w-4 animate-spin" />} Subir tarifario
                </button>
                <button type="button" className="h-9 px-2 text-xs text-muted-foreground" onClick={() => (setArchivo(null), setParaTarifario(null))}>
                  Cancelar
                </button>
              </div>
            </>
          )}
        </div>
      )}
    </section>
  )
}
