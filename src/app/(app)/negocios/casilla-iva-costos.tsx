'use client'

import { useEffect, useRef, useState } from 'react'
import { Loader2 } from 'lucide-react'
import { toast } from 'sonner'

import { IVA_COSTO_PCT } from '@/lib/cotizaciones/iva-costo'
import { cambiarIvaDeCostos, sincronizarIvaDeCostos, type EstadoIvaCostos } from './iva-costos-actions'

/**
 * La casilla «Calcular con IVA» de la cotización de viaje (Mauricio, 2026-10-19). Al abrir, el
 * servidor deja cada línea con el IVA que le toca (la casilla guardada o la de por defecto); al
 * cambiarla, recalcula todo y la página se refresca con los totales nuevos. Sin propuesta de viaje
 * en el espacio (o sin la migración), no pinta nada.
 */
export default function CasillaIvaCostos({
  cotizacionId,
  onRecalculo,
  sincronizar = sincronizarIvaDeCostos,
  cambiar = cambiarIvaDeCostos,
}: {
  cotizacionId: string
  onRecalculo: () => void
  /** Inyectables para probarla sin servidor. */
  sincronizar?: typeof sincronizarIvaDeCostos
  cambiar?: typeof cambiarIvaDeCostos
}) {
  const [estado, setEstado] = useState<EstadoIvaCostos | null>(null)
  const [ocupado, setOcupado] = useState(false)
  const avisar = useRef(onRecalculo)
  useEffect(() => {
    avisar.current = onRecalculo
  }, [onRecalculo])

  useEffect(() => {
    let vivo = true
    sincronizar(cotizacionId)
      .then((r) => {
        if (!vivo || !r.ok) return
        setEstado(r)
        if (r.cambio) avisar.current()
      })
      .catch(() => {
        // Sin red: la casilla no aparece; los totales quedan como los guardó el servidor.
      })
    return () => {
      vivo = false
    }
  }, [cotizacionId, sincronizar])

  if (!estado?.disponible) return null

  const enviar = async (cambio: { encendida?: boolean; viajeroResidente?: boolean }) => {
    if (ocupado) return
    setOcupado(true)
    try {
      const r = await cambiar(cotizacionId, cambio)
      if (!r.ok) return void toast.error(r.error)
      setEstado(r)
      if (r.cambio) onRecalculo()
    } catch {
      toast.error('No se pudo guardar. Vuelve a intentarlo.')
    } finally {
      setOcupado(false)
    }
  }

  const sinProveedores = estado.proveedoresConIva.length === 0
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 rounded-lg border bg-muted/20 px-3 py-2 text-xs" data-casilla-iva={estado.encendida ? 'on' : 'off'}>
      <label className="flex items-center gap-2 font-medium">
        <input type="checkbox" checked={estado.encendida} disabled={!estado.editable || ocupado} onChange={(e) => void enviar({ encendida: e.target.checked })} />
        Calcular con IVA ({IVA_COSTO_PCT} %)
      </label>
      <label className="flex items-center gap-2 text-muted-foreground">
        <input type="checkbox" checked={estado.viajeroResidente} disabled={!estado.editable || ocupado} onChange={(e) => void enviar({ viajeroResidente: e.target.checked })} />
        Viajero residente en Colombia
      </label>
      {ocupado && <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />}
      <span className="basis-full text-[11px] text-muted-foreground">
        {sinProveedores
          ? 'Ningún proveedor de esta cotización declara IVA en su ficha: los costos van sin IVA.'
          : estado.encendida
            ? `El IVA se suma al costo de ${estado.lineasConIva} ${estado.lineasConIva === 1 ? 'línea' : 'líneas'} (${estado.proveedoresConIva.join(', ')}).${estado.porDefecto ? ' Encendida por defecto: el proveedor declara IVA y el viajero es residente.' : ''}`
            : `Declaran IVA: ${estado.proveedoresConIva.join(', ')}. Los costos van sin IVA.`}
      </span>
    </div>
  )
}
