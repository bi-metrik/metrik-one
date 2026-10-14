'use client'

/**
 * «Pegar conversación»: botón del bloque de la solicitud y su cuadro. La comercial pega el chat (o sube el .txt que
 * exporta WhatsApp, o el .zip de la exportación: solo se lee el .txt) y ONE llena el bloque con valores SUGERIDOS. Sin
 * paso de confirmación aparte: lo sugerido se confirma o se corrige en el mismo bloque, como lo que llega del bot.
 * Al terminar, el mismo cuadro muestra el resumen. Ver `lib/negocios/pegar-conversacion.ts`.
 */

import { useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { MessageSquareText, Upload, X } from 'lucide-react'
import { useTransitionTolerante } from '@/hooks/use-transition-tolerante'
import { pegarConversacion } from '@/lib/negocios/pegar-conversacion-servidor'
import type { ResumenChat } from '@/lib/negocios/pegar-conversacion'

/** Un .txt de chat de años pesa pocos MB; el .zip con fotos puede pesar cientos. */
const MAX_TXT_BYTES = 8 * 1024 * 1024
const MAX_ZIP_BYTES = 80 * 1024 * 1024

/** El texto del archivo: el .txt tal cual; del .zip, el chat (`_chat.txt` en iPhone, el único .txt en Android). */
async function textoDelArchivo(file: File): Promise<string> {
  const nombre = file.name.toLowerCase()
  if (nombre.endsWith('.zip')) {
    if (file.size > MAX_ZIP_BYTES) throw new Error('El .zip es muy pesado. Exporta el chat «Sin archivos» y súbelo de nuevo.')
    const { chatDelZip } = await import('@/lib/negocios/chat-exportado')
    const chat = chatDelZip(await file.arrayBuffer())
    if (chat === null) throw new Error('El .zip no trae el .txt del chat.')
    return chat
  }
  if (file.size > MAX_TXT_BYTES) throw new Error('El archivo es muy pesado para ser un chat.')
  return await file.text()
}

function Lista({ titulo, items, tono = 'normal' }: { titulo: string; items: string[]; tono?: 'normal' | 'aviso' }) {
  if (!items.length) return null
  return (
    <div>
      <p className={`text-[11px] font-medium ${tono === 'aviso' ? 'text-[#92400E]' : 'text-tinta'}`}>{titulo}</p>
      <ul className="mt-0.5 space-y-0.5">
        {items.map((t) => <li key={t} className="text-[11px] text-tinta-suave">· {t}</li>)}
      </ul>
    </div>
  )
}

export function ResumenPegado({ r }: { r: ResumenChat }) {
  const nada = !r.llenados.length && !r.reemplazados.length && !r.conflictos.length && !r.quitados.length
  return (
    <div className="space-y-2" data-resumen-chat>
      <p className="text-xs text-tinta">
        {nada
          ? 'No encontré datos nuevos de este viaje en la conversación.'
          : `Leí ${r.mensajes} mensajes. Lo que llené quedó como sugerido en el bloque: confírmalo con un toque o corrígelo escribiendo encima.`}
      </p>
      {r.recortado && <p className="text-[11px] text-tinta-suave">El chat era largo: leí solo los mensajes más recientes.</p>}
      <Lista titulo={`Llené ${r.llenados.length === 1 ? '1 campo' : `${r.llenados.length} campos`}`} items={r.llenados} />
      <Lista titulo="Cambié sugeridos que nadie había confirmado" items={r.reemplazados} />
      <Lista titulo="En conflicto (no cambié lo que ya estaba)" items={r.conflictos} tono="aviso" />
      <Lista titulo="Quité sugeridos que el chat descarta" items={r.quitados} />
      <Lista titulo="No me quedó claro" items={r.dudas} tono="aviso" />
      <Lista titulo="En el chat hay más, que no es de este viaje (no lo llené)" items={r.otros} />
      {r.hayMinimo && (r.faltaMinimo.length
        ? <Lista titulo="Para el mínimo de cotizar falta" items={r.faltaMinimo} />
        : <p className="text-[11px] font-medium text-acento">Ya está el mínimo para cotizar.</p>)}
    </div>
  )
}

export default function PegarConversacion({
  negocioBloqueId,
  antes,
  alCargar,
}: {
  negocioBloqueId: string
  /** Guarda lo que la comercial tenga a medio escribir antes de leer el chat. */
  antes?: () => Promise<void>
  /** Los campos que cambiaron, para que el bloque los muestre sin recargar. */
  alCargar: (valores: Record<string, unknown>) => void
}) {
  const [abierto, setAbierto] = useState(false)
  const [texto, setTexto] = useState('')
  const [archivo, setArchivo] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [resumen, setResumen] = useState<ResumenChat | null>(null)
  const [isPending, startTransition] = useTransitionTolerante()
  const router = useRouter()
  const inputRef = useRef<HTMLInputElement>(null)

  function cerrar() {
    if (isPending) return
    setAbierto(false)
    setTexto('')
    setArchivo(null)
    setError(null)
    setResumen(null)
  }

  async function elegirArchivo(file: File | undefined) {
    if (!file) return
    setError(null)
    try {
      setTexto(await textoDelArchivo(file))
      setArchivo(file.name)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo leer el archivo.')
    } finally {
      if (inputRef.current) inputRef.current.value = ''
    }
  }

  function leer() {
    if (!texto.trim()) return
    setError(null)
    startTransition(async () => {
      if (antes) await antes()
      const r = await pegarConversacion(negocioBloqueId, texto)
      if (r.error !== null) { setError(r.error); return }
      alCargar(r.valores)
      // Siempre se relee: las marcas (sugerido, conflicto) y las barras llegan con la data guardada.
      router.refresh()
      setResumen(r.resumen)
      setTexto('')
      setArchivo(null)
    })
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setAbierto(true)}
        className="inline-flex items-center gap-1.5 rounded-md border border-[#E5E7EB] bg-white px-2.5 py-1 text-[11px] font-medium text-tinta hover:bg-papel transition-colors"
        data-boton-pegar-conversacion
      >
        <MessageSquareText className="h-3.5 w-3.5 text-acento" />
        Pegar conversación
      </button>
      {abierto && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 p-0 sm:items-center sm:p-4" role="dialog" aria-modal="true" aria-label="Pegar conversación">
          <div className="flex max-h-[90vh] w-full max-w-lg flex-col rounded-t-2xl bg-white p-5 shadow-xl sm:rounded-2xl">
            <div className="flex items-start justify-between gap-2">
              <h3 className="text-base font-semibold text-tinta">{resumen ? 'Lo que entendí' : 'Pegar conversación'}</h3>
              <button type="button" onClick={cerrar} disabled={isPending} aria-label="Cerrar" className="rounded p-1 text-tinta-suave hover:bg-papel disabled:opacity-40">
                <X className="h-4 w-4" />
              </button>
            </div>
            {resumen ? (
              <>
                <div className="mt-3 overflow-y-auto"><ResumenPegado r={resumen} /></div>
                <div className="mt-4 flex gap-2">
                  <button type="button" onClick={() => setResumen(null)} className="flex-1 rounded-md border border-[#E5E7EB] py-2 text-sm font-medium text-tinta hover:bg-papel">
                    Pegar otra
                  </button>
                  <button type="button" onClick={cerrar} className="flex-1 rounded-md bg-acento py-2 text-sm font-medium text-white hover:bg-acento-hover">
                    Listo
                  </button>
                </div>
              </>
            ) : (
              <>
                <p className="mt-1 text-xs text-tinta-suave">
                  Pega el chat con el cliente (con o sin fecha y nombre) o sube el archivo de «Exportar chat» de WhatsApp.
                  ONE llena lo que entienda de este viaje como sugerido; lo que ya está escrito no se pisa.
                </p>
                <textarea
                  value={texto}
                  onChange={(e) => { setTexto(e.target.value); setArchivo(null) }}
                  disabled={isPending}
                  rows={10}
                  placeholder="Pega aquí la conversación…"
                  className="mt-3 w-full resize-y rounded-lg border border-[#E5E7EB] px-3 py-2 text-xs text-tinta focus:border-acento focus:outline-none focus:ring-2 focus:ring-acento/15 disabled:opacity-60"
                  data-texto-chat
                />
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <input
                    ref={inputRef}
                    type="file"
                    accept=".txt,.zip,text/plain,application/zip"
                    className="hidden"
                    onChange={(e) => { void elegirArchivo(e.target.files?.[0]) }}
                  />
                  <button
                    type="button"
                    onClick={() => inputRef.current?.click()}
                    disabled={isPending}
                    className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-[11px] font-medium text-acento hover:bg-[var(--acento-tinte)] disabled:opacity-50"
                  >
                    <Upload className="h-3.5 w-3.5" />
                    Subir chat exportado (.txt o .zip)
                  </button>
                  {archivo && <span className="text-[11px] text-tinta-suave">{archivo}</span>}
                </div>
                {error && <p className="mt-2 text-[11px] text-red-600" role="alert">{error}</p>}
                <div className="mt-4 flex gap-2">
                  <button type="button" onClick={cerrar} disabled={isPending} className="flex-1 rounded-md border border-[#E5E7EB] py-2 text-sm font-medium text-tinta hover:bg-papel disabled:opacity-50">
                    Cancelar
                  </button>
                  <button
                    type="button"
                    onClick={leer}
                    disabled={!texto.trim() || isPending}
                    className="flex-1 rounded-md bg-acento py-2 text-sm font-medium text-white hover:bg-acento-hover disabled:opacity-50"
                  >
                    {isPending ? 'Leyendo la conversación…' : 'Llenar el viaje'}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </>
  )
}
