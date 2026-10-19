'use client'

import { useMemo, useState } from 'react'
import { Copy, Loader2, Mail, MessageCircle, Send } from 'lucide-react'
import { toast } from 'sonner'

import { asuntoSolicitud, enlaceCorreo, enlaceWhatsApp, mensajeSolicitud, preguntasPendientes } from '@/lib/proveedores/solicitud-tarifas'
import { fechaCorta, hoyBogota } from '@/lib/proveedores/vigencia'
import { marcarTarifasPedidas, type FichaProveedor } from '../actions'

/**
 * «Pedir tarifas» (Mauricio, 2026-10-19): ONE arma el mensaje —el tarifario del año con sus
 * temporadas y, si la ficha no lo sabe todavía, si la tarifa es neta o comisionable y si incluye
 * IVA— y la asesora lo manda por WhatsApp o correo desde lo suyo. «Ya la pedí» anota la fecha.
 */
export default function PedirTarifas({ ficha, agencia, editable, onCambio }: { ficha: FichaProveedor; agencia: string; editable: boolean; onCambio: () => void }) {
  const [abierto, setAbierto] = useState(false)
  const [ocupado, setOcupado] = useState(false)
  const datos = useMemo(() => {
    const hoy = hoyBogota()
    // De octubre en adelante se pide el año que viene.
    const anio = Number(hoy.slice(0, 4)) + (Number(hoy.slice(5, 7)) >= 10 ? 1 : 0)
    const d = { proveedor: ficha.nombre, contacto: ficha.contactoNombre, agencia, anio, tarifaCanal: ficha.tarifaCanal, ivaDeclarado: ficha.ivaDeclarado, ivaIncluido: ficha.ivaIncluido }
    const texto = mensajeSolicitud(d)
    return { texto, wa: enlaceWhatsApp(ficha.celular, texto), correo: enlaceCorreo(ficha.correo, asuntoSolicitud(d), texto), preguntas: preguntasPendientes(d).length }
  }, [ficha, agencia])

  const copiar = async () => {
    try {
      await navigator.clipboard.writeText(datos.texto)
      toast.success('Mensaje copiado')
    } catch {
      toast.error('No se pudo copiar. Selecciona el texto y cópialo a mano.')
    }
  }

  const marcar = async () => {
    if (ocupado) return
    setOcupado(true)
    try {
      const r = await marcarTarifasPedidas(ficha.id)
      if (!r.ok) return void toast.error(r.error)
      toast.success('Anotado: tarifas pedidas hoy')
      setAbierto(false)
      onCambio()
    } catch {
      toast.error('No se pudo guardar. Vuelve a intentarlo.')
    } finally {
      setOcupado(false)
    }
  }

  const boton = 'inline-flex h-8 items-center gap-1 rounded-md border bg-background px-3 text-xs font-medium hover:bg-accent disabled:opacity-50'
  return (
    <section className="space-y-2" data-seccion="pedir-tarifas">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-semibold">Pedir tarifas</h2>
        {ficha.tarifasSolicitadasAt && <span className="text-[11px] text-muted-foreground">Pedidas el {fechaCorta(ficha.tarifasSolicitadasAt.slice(0, 10))}</span>}
      </div>
      {!abierto ? (
        <button type="button" className={boton} onClick={() => setAbierto(true)} data-abrir-solicitud>
          <Send className="h-3.5 w-3.5" /> Armar el mensaje
        </button>
      ) : (
        <div className="space-y-2 rounded-lg border p-3">
          <p className="m-0 text-[11px] text-muted-foreground">
            {datos.preguntas > 0 ? 'Incluye las preguntas que la ficha todavía no sabe responder.' : 'La ficha ya sabe si la tarifa es neta o comisionable y si incluye IVA: solo se pide el tarifario.'}
          </p>
          <textarea readOnly value={datos.texto} className="block h-44 w-full rounded-md border bg-muted/30 p-2 text-xs" data-mensaje-solicitud />
          <div className="flex flex-wrap gap-2">
            {datos.wa && (
              <a href={datos.wa} target="_blank" rel="noreferrer" className={boton}>
                <MessageCircle className="h-3.5 w-3.5" /> WhatsApp
              </a>
            )}
            {datos.correo && (
              <a href={datos.correo} className={boton}>
                <Mail className="h-3.5 w-3.5" /> Correo
              </a>
            )}
            <button type="button" className={boton} onClick={() => void copiar()}>
              <Copy className="h-3.5 w-3.5" /> Copiar
            </button>
            {editable && (
              <button type="button" className={`${boton} border-[#10B981] text-[#047857]`} onClick={() => void marcar()} disabled={ocupado}>
                {ocupado && <Loader2 className="h-3.5 w-3.5 animate-spin" />} Ya la pedí
              </button>
            )}
            <button type="button" className="h-8 px-2 text-xs text-muted-foreground" onClick={() => setAbierto(false)}>
              Cerrar
            </button>
          </div>
          {!datos.wa && !datos.correo && <p className="m-0 text-[11px] text-muted-foreground">La ficha no tiene celular ni correo: cópialo y envíalo por donde lo contactes.</p>}
          <p className="m-0 text-[11px] text-muted-foreground">Cuando conteste, anota en «Datos» si la tarifa es neta o comisionable y si cobra IVA.</p>
        </div>
      )}
    </section>
  )
}
