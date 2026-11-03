'use client'

/**
 * «Documentos y entrega» (F4; Noor §2 etapa 6, copy literal §8): cuatro tarjetas —Vouchers,
 * Documentos del viajero, Cobro: 80 % a 15 días y Paquete de viaje— con lo que falta en palabras.
 *
 * Lo que sale de ONE (el paquete) pide confirmación; el resto, no. El canal es C1: se abre el
 * WhatsApp de la comercial con el mensaje listo (ella adjunta el PDF y lo manda) y, si el viajero
 * tiene correo, le llega también por correo con el PDF.
 */

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { AlertTriangle, CheckCircle2, FileDown, MessageCircle, Paperclip } from 'lucide-react'
import { useTransitionTolerante } from '@/hooks/use-transition-tolerante'
import { useIntencion } from '@/hooks/use-intencion'
import { createClient } from '@/lib/supabase/client'
import { BUCKET_DOCUMENTOS_ONE } from '@/lib/almacenamiento/referencia'
import { ETIQUETA_DOCUMENTO, TEXTO_CAMBIO_VOUCHER, TEXTO_CERTIFICADO_ASISTENCIA, TEXTO_VIAJE_NACIONAL, fechaConAnio } from '@/lib/viaje/entrega'
import type { VistaEntrega } from '@/lib/viaje/entrega-datos'
import { ETIQUETA_CLASE, type ClaseDocumento } from '@/lib/viaje/documentos-por-viajero'
import {
  asignarDocumentoViajero,
  enviarPaquete,
  guardarDocumentoViajero,
  leerDocumentoViajero,
  marcarPaqueteMandado,
  responderMenoresConPadres,
  verPaquete,
  type ResultadoEnviarPaquete,
} from '../entrega-viaje-actions'

type Enviado = Extract<ResultadoEnviarPaquete, { ok: true }>

function Tarjeta({ titulo, estado, children }: { titulo: string; estado: 'ok' | 'falta' | 'aviso'; children: React.ReactNode }) {
  const color = estado === 'ok' ? 'text-emerald-700' : estado === 'falta' ? 'text-red-700' : 'text-amber-700'
  return (
    <section className="min-w-0 rounded-lg border p-3 text-xs">
      <p className={`flex items-center gap-1 font-semibold ${color}`}>
        {estado === 'ok' ? <CheckCircle2 className="h-3.5 w-3.5" aria-hidden /> : <AlertTriangle className="h-3.5 w-3.5" aria-hidden />}
        {titulo}
      </p>
      <div className="mt-1.5 space-y-1.5">{children}</div>
    </section>
  )
}

function descargarBase64(pdf: string, filename: string) {
  const bytes = Uint8Array.from(atob(pdf), c => c.charCodeAt(0))
  const url = URL.createObjectURL(new Blob([bytes], { type: 'application/pdf' }))
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}

export default function EntregaViajePanel({
  vista,
  puedeEnviar,
  esDireccion,
  puedeDocumentos,
}: {
  vista: VistaEntrega
  puedeEnviar: boolean
  esDireccion: boolean
  puedeDocumentos: boolean
}) {
  const router = useRouter()
  const [isPending, startTransition] = useTransitionTolerante()
  const intencion = useIntencion()
  const nombre = vista.cliente.nombre.split(/\s+/)[0] || 'el cliente'
  const [nota, setNota] = useState('')
  const [confirmando, setConfirmando] = useState(false)
  const [bloqueo, setBloqueo] = useState<{ texto: string; puedeIgual: boolean } | null>(null)
  const [motivoIgual, setMotivoIgual] = useState('')
  const [enviado, setEnviado] = useState<Enviado | null>(null)

  // ── Documentos ──
  type DocEnCurso = {
    soporte: { storage_path: string; file_name: string; mime_type: string } | null
    numero: string; nombre: string; vence: string; leido: boolean
    /** De qué viajero es (H6-4): con varios, se elige antes de guardar. */
    viajero: string
    clase: ClaseDocumento
  }
  const [doc, setDoc] = useState<DocEnCurso | null>(null)
  const viajeros = vista.porViajero?.viajeros ?? []
  const variosViajeros = viajeros.length > 1
  // El primero al que le falta el pasaporte, para no hacer elegir en el caso común.
  const sugerido = viajeros.find(e => !e.pasaporte)?.viajero.clave ?? (variosViajeros ? '' : viajeros[0]?.viajero.clave ?? '')
  const [leyendo, setLeyendo] = useState(false)

  async function subirPasaporte(file: File) {
    setLeyendo(true)
    try {
      const ext = file.name.split('.').pop()?.toLowerCase() || 'jpg'
      const path = `${vista.workspaceId}/documentos-viajero/${crypto.randomUUID()}.${ext}`
      const { error } = await createClient().storage.from(BUCKET_DOCUMENTOS_ONE).upload(path, file, { contentType: file.type || undefined, upsert: false })
      if (error) { toast.error(`No se pudo subir el documento: ${error.message}`); return }
      const soporte = { storage_path: path, file_name: file.name, mime_type: file.type || '' }
      setDoc({ soporte, numero: '', nombre: '', vence: '', leido: false, viajero: sugerido, clase: 'pasaporte' })
      const r = await leerDocumentoViajero(vista.negocioId, soporte)
      if (!r.ok) { toast.error(r.error); return }
      if (r.aviso) toast.message(r.aviso)
      setDoc(d => d && ({
        ...d,
        numero: d.numero || (r.lectura.numero ?? ''),
        nombre: d.nombre || (r.lectura.nombre ?? ''),
        vence: d.vence || (r.lectura.fecha_vencimiento ?? ''),
        leido: r.leido,
      }))
    } finally {
      setLeyendo(false)
    }
  }

  function guardarDoc() {
    if (!doc) return
    startTransition(async () => {
      const r = await guardarDocumentoViajero({
        negocioId: vista.negocioId,
        tipo: doc.clase === 'pasaporte' ? 'pasaporte' : 'otro',
        viajero: doc.viajero || null,
        clase: doc.clase,
        numero: doc.numero || null,
        nombre: doc.nombre || null,
        pais: null,
        fechaEmision: null,
        fechaVencimiento: doc.clase === 'pasaporte' ? doc.vence || null : null,
        soporte: doc.soporte,
        leidoPorIa: doc.leido,
      })
      if (!r.ok) { toast.error(r.error); return }
      toast.success(`${ETIQUETA_CLASE[doc.clase]} guardado.`)
      setDoc(null)
      router.refresh()
    })
  }

  function asignar(documentoId: string, viajero: string) {
    if (!viajero) return
    startTransition(async () => {
      const r = await asignarDocumentoViajero(vista.negocioId, documentoId, viajero)
      if (!r.ok) { toast.error(r.error); return }
      toast.success('Pasaporte asignado.')
      router.refresh()
    })
  }

  function responderPadres(ambos: boolean) {
    startTransition(async () => {
      const r = await responderMenoresConPadres(vista.negocioId, ambos)
      if (!r.ok) { toast.error(r.error); return }
      router.refresh()
    })
  }

  // ── Paquete ──
  function ver() {
    startTransition(async () => {
      const r = await verPaquete(vista.negocioId, nota || null)
      if (!r.ok) { toast.error(r.error); return }
      descargarBase64(r.pdf, r.filename)
      if (r.sinAnexar.length > 0) toast.warning(`No se pudo pegar el voucher de: ${r.sinAnexar.join(', ')}. Revisa el archivo de esa fila.`)
    })
  }

  function enviar(igual: boolean) {
    startTransition(async () => {
      const r = await enviarPaquete(
        { negocioId: vista.negocioId, nota: nota || null, enviarIgualMotivo: igual ? motivoIgual : null },
        intencion.clave(),
      )
      intencion.cerrar()
      setConfirmando(false)
      if (!r.ok) {
        setBloqueo({ texto: r.error, puedeIgual: r.puedeEnviarIgual === true })
        return
      }
      setBloqueo(null)
      setEnviado(r)
      toast.success(`Paquete listo para ${nombre}.${r.correo === 'enviado' ? ' También le llegó por correo.' : ''}`)
      window.open(r.waUrl, '_blank', 'noopener')
      router.refresh()
    })
  }

  function yaLoMande() {
    startTransition(async () => {
      const r = await marcarPaqueteMandado(vista.negocioId)
      if (!r.ok) { toast.error(r.error); return }
      toast.success(`Paquete enviado a ${nombre}.`)
      setEnviado(null)
      router.refresh()
    })
  }

  const v = vista.vouchers
  const docsInternacional = vista.internacional !== false
  const enviadoAt = vista.paquete ? fechaConAnio(vista.paquete.enviado_at.slice(0, 10)) : null

  return (
    <div className="mb-3 space-y-2" data-entrega-viaje>
      <p className="text-sm font-semibold">Documentos y entrega · El viajero tiene todo</p>
      <div className="grid gap-2 sm:grid-cols-2">
        <Tarjeta titulo={`Vouchers · ${v.conVoucher} de ${v.total}`} estado={v.faltan.length === 0 ? 'ok' : 'falta'}>
          <p className="text-muted-foreground">Vienen de cada servicio: no se suben de nuevo.</p>
          {v.faltan.map(f => <p key={f.id}>Falta el voucher de {f.nombre}.</p>)}
        </Tarjeta>

        <Tarjeta titulo="Documentos del viajero" estado={vista.faltaDocumento ? 'falta' : 'ok'}>
          {vista.internacional === false && <p>{TEXTO_VIAJE_NACIONAL}</p>}
          {vista.internacional === null && <p className="text-muted-foreground">Si el viaje es internacional, pega el pasaporte de cada viajero.</p>}
          {/* H9-5 / H6-4: los documentos de CADA viajero, no uno para todo el grupo. */}
          {vista.internacional === true && viajeros.map(e => (
            <div key={e.viajero.clave} data-viajero={e.viajero.clave}>
              <p className="font-medium">{e.viajero.etiqueta}</p>
              {e.pasaporte ? (
                <p className={e.avisoPasaporte ? 'font-medium text-red-700' : ''}>
                  Pasaporte {e.pasaporte.numero ?? ''}{e.pasaporte.nombre_en_documento ? ` · ${e.pasaporte.nombre_en_documento}` : ''}{e.pasaporte.fecha_vencimiento ? ` · vence ${fechaConAnio(e.pasaporte.fecha_vencimiento)}` : ''}
                  {e.avisoPasaporte && <span className="block">{e.avisoPasaporte}</span>}
                </p>
              ) : (
                <p className="text-red-700">Falta el pasaporte.</p>
              )}
              {e.viajero.menor && (
                <p className={e.registroCivil ? '' : 'text-red-700'}>
                  {e.registroCivil ? `Registro civil ${e.registroCivil.numero ?? ''}` : 'Falta el registro civil.'}
                </p>
              )}
              {e.viajero.menor && e.pidePermiso === true && (
                <p className={e.permisoSalida ? '' : 'text-red-700'}>
                  {e.permisoSalida ? 'Permiso de salida del país cargado.' : 'Falta el permiso de salida del país.'}
                </p>
              )}
            </div>
          ))}
          {vista.internacional === true && vista.porViajero?.hayMenores && (
            <div className="space-y-1">
              <p>¿Los menores viajan con sus dos padres?{vista.porViajero.menoresConAmbosPadres === true ? ' Sí: no se pide permiso de salida.' : vista.porViajero.menoresConAmbosPadres === false ? ' No: se pide el permiso de salida de cada menor.' : ''}</p>
              {puedeDocumentos && (
                <div className="flex gap-2">
                  <button type="button" disabled={isPending || vista.porViajero.menoresConAmbosPadres === true} onClick={() => responderPadres(true)} className="min-h-11 rounded-md border px-3 font-medium disabled:opacity-60">Sí</button>
                  <button type="button" disabled={isPending || vista.porViajero.menoresConAmbosPadres === false} onClick={() => responderPadres(false)} className="min-h-11 rounded-md border px-3 font-medium disabled:opacity-60">No</button>
                </div>
              )}
            </div>
          )}
          {docsInternacional && (vista.porViajero?.sinAsignar ?? []).map(d => (
            <div key={d.id} className="space-y-1">
              <p className="text-amber-800">{ETIQUETA_DOCUMENTO[d.tipo]} {d.numero ?? ''}{d.nombre_en_documento ? ` · ${d.nombre_en_documento}` : ''}: no dice de qué viajero es.</p>
              {puedeDocumentos && (
                <select aria-label="¿De quién es?" disabled={isPending} defaultValue="" onChange={e => asignar(d.id, e.target.value)} className="h-11 w-full rounded-md border px-2">
                  <option value="" disabled>¿De quién es?</option>
                  {viajeros.map(e => <option key={e.viajero.clave} value={e.viajero.clave}>{e.viajero.etiqueta}</option>)}
                </select>
              )}
            </div>
          ))}
          {/* Noor §11: la asistencia médica aparece sola cuando la cotización la incluye. */}
          {(vista.asistencias ?? []).map(a => (
            <p key={a.id} data-asistencia-medica>
              {a.texto}
              {!a.tieneCertificado && <span className="block text-muted-foreground">{TEXTO_CERTIFICADO_ASISTENCIA}</span>}
            </p>
          ))}
          {docsInternacional && puedeDocumentos && !doc && (
            <label className="inline-flex min-h-11 cursor-pointer items-center gap-1 rounded-md border px-3 font-medium">
              <Paperclip className="h-3.5 w-3.5" aria-hidden />
              {leyendo ? 'Leyendo el documento…' : 'Pega un documento del viajero'}
              <input type="file" accept="image/*,application/pdf" capture="environment" className="sr-only" disabled={leyendo}
                onChange={e => { const f = e.target.files?.[0]; if (f) void subirPasaporte(f); e.target.value = '' }} />
            </label>
          )}
          {doc && (
            <div className="space-y-1.5 rounded-md bg-muted/30 p-2">
              {leyendo && <p className="text-muted-foreground">Leyendo el documento…</p>}
              <label className="block">¿De quién es?
                <select className="mt-0.5 h-11 w-full rounded-md border px-2" value={doc.viajero}
                  onChange={e => {
                    const v = viajeros.find(x => x.viajero.clave === e.target.value)
                    setDoc({ ...doc, viajero: e.target.value, clase: v?.viajero.menor ? doc.clase : 'pasaporte' })
                  }}>
                  {variosViajeros && <option value="" disabled>Elige el viajero</option>}
                  {viajeros.map(e => <option key={e.viajero.clave} value={e.viajero.clave}>{e.viajero.etiqueta}</option>)}
                </select>
              </label>
              {viajeros.find(x => x.viajero.clave === doc.viajero)?.viajero.menor && (
                <label className="block">Documento
                  <select className="mt-0.5 h-11 w-full rounded-md border px-2" value={doc.clase} onChange={e => setDoc({ ...doc, clase: e.target.value as ClaseDocumento })}>
                    <option value="pasaporte">{ETIQUETA_CLASE.pasaporte}</option>
                    <option value="registro_civil">{ETIQUETA_CLASE.registro_civil}</option>
                    <option value="permiso_salida">{ETIQUETA_CLASE.permiso_salida}</option>
                  </select>
                </label>
              )}
              <label className="block">Número
                <input className="mt-0.5 h-11 w-full rounded-md border px-2" value={doc.numero} onChange={e => setDoc({ ...doc, numero: e.target.value })} />
              </label>
              <label className="block">Nombre como aparece
                <input className="mt-0.5 h-11 w-full rounded-md border px-2" value={doc.nombre} onChange={e => setDoc({ ...doc, nombre: e.target.value })} />
              </label>
              {doc.clase === 'pasaporte' && (
                <label className="block">Vence
                  <input type="date" className="mt-0.5 h-11 w-full rounded-md border px-2" value={doc.vence} onChange={e => setDoc({ ...doc, vence: e.target.value })} />
                </label>
              )}
              <div className="flex gap-2">
                <button type="button" disabled={isPending || leyendo || !doc.viajero} onClick={guardarDoc} className="min-h-11 rounded-md bg-primary px-3 font-medium text-primary-foreground disabled:opacity-60">Guardar</button>
                <button type="button" onClick={() => setDoc(null)} className="min-h-11 rounded-md px-3 text-muted-foreground underline">Cancelar</button>
              </div>
            </div>
          )}
        </Tarjeta>

        <Tarjeta titulo={`Cobro: ${vista.cobro.pctMinimo} % a 15 días`} estado={vista.cobro.cumple ? 'ok' : vista.cobro.modo === 'ochenta' ? 'falta' : 'aviso'}>
          <p>{vista.cuentaRegresiva}</p>
          {vista.mensajeCobro && <p className="text-red-700">{vista.mensajeCobro}</p>}
        </Tarjeta>

        <Tarjeta titulo="Paquete de viaje" estado={vista.paquete && !vista.cambioVoucher ? 'ok' : 'aviso'}>
          {vista.paquete ? (
            <p>Paquete enviado el {enviadoAt}.{vista.paquete.forzado ? ` Se envió sin el cobro mínimo: ${vista.paquete.forzado.motivo}` : ''}</p>
          ) : (
            <p className="text-muted-foreground">Falta enviar el paquete.</p>
          )}
          {vista.cambioVoucher && <p className="font-medium text-amber-800">{TEXTO_CAMBIO_VOUCHER}</p>}
          {puedeEnviar && (
            <>
              <label className="block">Algo más para {nombre} (opcional)
                <textarea value={nota} onChange={e => setNota(e.target.value)} rows={2} maxLength={500} className="mt-0.5 w-full rounded-md border px-2 py-1" />
              </label>
              <div className="flex flex-wrap gap-2">
                <button type="button" onClick={ver} disabled={isPending} className="inline-flex min-h-11 items-center gap-1 rounded-md border px-3 font-medium disabled:opacity-60">
                  <FileDown className="h-3.5 w-3.5" aria-hidden /> Ver paquete
                </button>
                {!confirmando && (
                  <button type="button" onClick={() => setConfirmando(true)} disabled={isPending} className="min-h-11 rounded-md bg-primary px-3 font-medium text-primary-foreground disabled:opacity-60">
                    {vista.paquete ? 'Reenviar' : `Enviar el paquete a ${nombre}`}
                  </button>
                )}
              </div>
              {confirmando && (
                <div className="space-y-1.5 rounded-md bg-muted/30 p-2">
                  <p>
                    Se abre tu WhatsApp con el mensaje listo; adjunta el PDF y envíalo desde ahí.
                    {vista.cliente.correo ? ` ${nombre} también lo recibe por correo.` : ''}
                  </p>
                  <div className="flex gap-2">
                    <button type="button" onClick={() => enviar(false)} disabled={isPending} className="min-h-11 rounded-md bg-primary px-3 font-medium text-primary-foreground disabled:opacity-60">Confirmar</button>
                    <button type="button" onClick={() => setConfirmando(false)} className="min-h-11 rounded-md px-3 text-muted-foreground underline">Cancelar</button>
                  </div>
                </div>
              )}
              {bloqueo && (
                <div className="space-y-1.5">
                  <p className="text-red-700">{bloqueo.texto}</p>
                  {bloqueo.puedeIgual && esDireccion && (
                    <>
                      <label className="block">¿Por qué sale sin el {vista.cobro.pctMinimo} %?
                        <input value={motivoIgual} onChange={e => setMotivoIgual(e.target.value)} className="mt-0.5 h-11 w-full rounded-md border px-2" />
                      </label>
                      <button type="button" disabled={isPending || motivoIgual.trim() === ''} onClick={() => enviar(true)} className="min-h-11 rounded-md border border-red-300 px-3 font-medium text-red-700 disabled:opacity-60">
                        Enviar igual
                      </button>
                    </>
                  )}
                </div>
              )}
              {enviado && (
                <div className="flex flex-wrap gap-2">
                  <a href={enviado.waUrl} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-11 items-center gap-1 rounded-md border px-3 font-medium">
                    <MessageCircle className="h-3.5 w-3.5" aria-hidden /> Abrir WhatsApp
                  </a>
                  {enviado.archivoHref && (
                    <a href={enviado.archivoHref} className="inline-flex min-h-11 items-center gap-1 rounded-md border px-3 font-medium">
                      <FileDown className="h-3.5 w-3.5" aria-hidden /> Descargar el PDF
                    </a>
                  )}
                  <button type="button" onClick={yaLoMande} disabled={isPending} className="min-h-11 rounded-md bg-primary px-3 font-medium text-primary-foreground disabled:opacity-60">Ya lo mandé</button>
                </div>
              )}
            </>
          )}
        </Tarjeta>
      </div>
    </div>
  )
}
