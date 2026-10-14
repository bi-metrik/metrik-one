'use client'

/**
 * Riel de facturación del viaje (F5, Noor «Riel B»): la píldora con el estado de la factura en
 * palabras, «Ver datos de facturación» (a nombre de quién, con dirección y ciudad, editables hasta
 * emitir) y «Facturar ya» (solo la dirección, con motivo).
 */

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { ChevronDown } from 'lucide-react'
import { useTransitionTolerante } from '@/hooks/use-transition-tolerante'
import { useIntencion } from '@/hooks/use-intencion'
import type { EstadoPildoraFactura } from '@/lib/facturacion/regla-viaje'
import type { TitularFacturacion } from '@/lib/viaje/confirmacion'
import { forzarFacturaViaje, guardarDatosFacturacionViaje } from '../facturacion-viaje-actions'

const BOTON = 'inline-flex min-h-11 items-center justify-center gap-1.5 rounded-lg px-4 text-sm font-medium disabled:opacity-50'
const PRIMARIO = `${BOTON} bg-[#10B981] text-white hover:bg-[#059669]`
const SECUNDARIO = `${BOTON} border border-[#E5E7EB] bg-white text-[#1A1A1A] hover:bg-gray-50`

const COLOR: Record<EstadoPildoraFactura['estado'], string> = {
  apagada: 'bg-gray-100 text-gray-600',
  espera: 'bg-amber-50 text-amber-800',
  en_cola: 'bg-blue-50 text-blue-800',
  emitida: 'bg-emerald-50 text-emerald-800',
}

const TIPOS_DOC: Array<{ v: string; t: string }> = [
  { v: '13', t: 'Cédula' },
  { v: '22', t: 'Cédula de extranjería' },
  { v: '31', t: 'NIT' },
  { v: '41', t: 'Pasaporte' },
]

interface Props {
  negocioId: string
  pildora: EstadoPildoraFactura
  titular: TitularFacturacion | null
  puedeEditar: boolean
  puedeForzar: boolean
}

export default function FacturaViajePanel({ negocioId, pildora, titular, puedeEditar, puedeForzar }: Props) {
  const router = useRouter()
  const [abierto, setAbierto] = useState(false)
  const [forzando, setForzando] = useState(false)
  const [motivo, setMotivo] = useState('')
  const [isPending, startTransition] = useTransitionTolerante()
  const intencion = useIntencion()
  const [form, setForm] = useState({
    tipo: titular?.tipo ?? 'viajero',
    tipo_documento: titular?.tipo_documento ?? '13',
    numero_documento: titular?.numero_documento ?? '',
    nombre: titular?.nombre ?? '',
    correo: titular?.correo ?? '',
    telefono: titular?.telefono ?? '',
    direccion: titular?.direccion ?? '',
    departamento: titular?.departamento ?? '',
    municipio: titular?.municipio ?? '',
  })
  const faltaUbicacion = !titular?.direccion || !titular?.municipio || !titular?.departamento

  function guardar() {
    startTransition(async () => {
      const r = await guardarDatosFacturacionViaje(negocioId, form, intencion.clave())
      intencion.cerrar()
      if (!r.ok) {
        toast.error(r.error)
        return
      }
      toast.success('Datos de facturación guardados.')
      router.refresh()
    })
  }

  function forzar() {
    startTransition(async () => {
      const r = await forzarFacturaViaje(negocioId, motivo, intencion.clave())
      intencion.cerrar()
      if (!r.ok) {
        toast.error(r.error)
        return
      }
      toast.success('La factura quedó en la cola.')
      setForzando(false)
      router.refresh()
    })
  }

  const campo = (clave: keyof typeof form, etiqueta: string, tipo: string = 'text') => (
    <label className="block space-y-1">
      <span className="text-xs font-medium">{etiqueta}</span>
      <input
        type={tipo}
        value={form[clave] ?? ''}
        onChange={e => setForm(f => ({ ...f, [clave]: e.target.value }))}
        disabled={!puedeEditar || isPending}
        className="h-11 w-full rounded-md border px-2 text-sm disabled:bg-muted"
      />
    </label>
  )

  return (
    <div className="rounded-lg border border-[#E5E7EB] bg-white px-3 py-2">
      <div className="flex flex-wrap items-center gap-2">
        <span className={`rounded-full px-2.5 py-1 text-xs font-medium ${COLOR[pildora.estado]}`}>{pildora.texto}</span>
        {titular && <span className="text-xs text-[#6B7280]">A nombre de {titular.nombre}</span>}
        {faltaUbicacion && pildora.estado !== 'emitida' && (
          <span className="text-xs text-amber-700">Falta la dirección y la ciudad para facturar.</span>
        )}
        <button type="button" onClick={() => setAbierto(a => !a)} aria-expanded={abierto}
          className="ml-auto inline-flex min-h-11 items-center gap-1 px-2 text-xs text-[#1A1A1A] underline">
          Ver datos de facturación <ChevronDown className={`h-3.5 w-3.5 transition-transform ${abierto ? 'rotate-180' : ''}`} />
        </button>
      </div>

      {abierto && (
        <div className="mt-2 space-y-2 border-t pt-2">
          <div className="grid gap-2 sm:grid-cols-2">
            <label className="block space-y-1">
              <span className="text-xs font-medium">A nombre de</span>
              <select value={form.tipo} disabled={!puedeEditar || isPending}
                onChange={e => setForm(f => ({ ...f, tipo: e.target.value as TitularFacturacion['tipo'] }))}
                className="h-11 w-full rounded-md border bg-background px-2 text-sm">
                <option value="viajero">El viajero</option>
                <option value="empresa">Una empresa</option>
                <option value="tercero">Otra persona</option>
              </select>
            </label>
            <label className="block space-y-1">
              <span className="text-xs font-medium">Documento</span>
              <select value={form.tipo_documento ?? '13'} disabled={!puedeEditar || isPending || form.tipo === 'empresa'}
                onChange={e => setForm(f => ({ ...f, tipo_documento: e.target.value as '13' | '22' | '31' | '41' }))}
                className="h-11 w-full rounded-md border bg-background px-2 text-sm">
                {TIPOS_DOC.map(d => <option key={d.v} value={d.v}>{d.t}</option>)}
              </select>
            </label>
            {campo('numero_documento', form.tipo === 'empresa' ? 'NIT' : 'Número de documento')}
            {form.tipo !== 'viajero' && campo('nombre', form.tipo === 'empresa' ? 'Razón social' : 'Nombre completo')}
            {campo('correo', 'Correo para la factura', 'email')}
            {campo('telefono', 'Teléfono', 'tel')}
            {campo('direccion', 'Dirección')}
            {campo('municipio', 'Ciudad')}
            {campo('departamento', 'Departamento')}
          </div>
          {puedeEditar && (
            <button type="button" onClick={guardar} disabled={isPending} className={PRIMARIO}>
              {isPending ? 'Guardando…' : 'Guardar datos de facturación'}
            </button>
          )}
        </div>
      )}

      {puedeForzar && (
        forzando ? (
          <div className="mt-2 space-y-2 border-t pt-2">
            <label className="block space-y-1">
              <span className="text-xs font-medium">¿Por qué antes de tiempo?</span>
              <input value={motivo} onChange={e => setMotivo(e.target.value)} className="h-11 w-full rounded-md border px-2 text-sm" />
            </label>
            <div className="flex flex-wrap gap-2">
              <button type="button" onClick={forzar} disabled={isPending || motivo.trim().length < 5} className={PRIMARIO}>Facturar ya</button>
              <button type="button" onClick={() => setForzando(false)} disabled={isPending} className={SECUNDARIO}>Volver</button>
            </div>
          </div>
        ) : (
          <button type="button" onClick={() => setForzando(true)} className={`${SECUNDARIO} mt-2`}>Facturar ya</button>
        )
      )}
    </div>
  )
}
