'use client'

import { useEffect, useMemo, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { X } from 'lucide-react'
import {
  ETIQUETA_FORMA_PAGO,
  FORMAS_PAGO,
  formatoPesos,
  type FormaPago,
} from '@/lib/ferreteria/reglas'
import {
  conversacionesParaVentaAction,
  publicacionesParaVentaAction,
  registrarVentaAction,
  type OpcionConversacion,
  type OpcionPublicacion,
} from './actions'

const entrada = 'h-9 w-full rounded-md border bg-background px-2 text-sm'

/**
 * El formulario de una venta. Uno solo para las dos puertas: el detalle de la publicación
 * (con la publicación ya fijada) y "Registrar venta" del botón flotante (con buscador por
 * código o título). Las dos llaman a la misma acción, que crea la venta y su negocio.
 */
export function RegistrarVentaForm({
  publicacionFija,
  conversacionesFijas,
  hoy,
  onRegistrada,
}: {
  publicacionFija?: OpcionPublicacion
  conversacionesFijas?: OpcionConversacion[]
  hoy: string
  onRegistrada?: () => void
}) {
  const router = useRouter()
  const [pendiente, iniciar] = useTransition()

  const [publicaciones, setPublicaciones] = useState<OpcionPublicacion[] | null>(publicacionFija ? [publicacionFija] : null)
  const [busqueda, setBusqueda] = useState('')
  const [elegida, setElegida] = useState<OpcionPublicacion | null>(publicacionFija ?? null)
  const [conversaciones, setConversaciones] = useState<OpcionConversacion[]>(conversacionesFijas ?? [])

  const [fecha, setFecha] = useState(hoy)
  const [precio, setPrecio] = useState(publicacionFija?.precio != null ? String(publicacionFija.precio) : '')
  const [ruta, setRuta] = useState<'recoge' | 'despacho'>('recoge')
  const [formaPago, setFormaPago] = useState<FormaPago>('contra_entrega')
  const [comprador, setComprador] = useState('')
  const [conversacion, setConversacion] = useState('')

  // El catálogo se pide al abrir, solo en la puerta sin publicación fijada.
  useEffect(() => {
    if (publicacionFija) return
    let cancel = false
    publicacionesParaVentaAction().then((r) => {
      if (cancel) return
      if (r.ok) setPublicaciones(r.publicaciones)
      else toast.error(r.error)
    })
    return () => {
      cancel = true
    }
  }, [publicacionFija])

  const coincidencias = useMemo(() => {
    const q = busqueda.trim().toLowerCase()
    if (!publicaciones || !q) return []
    return publicaciones
      .filter((p) => p.codigo.toLowerCase().includes(q) || p.titulo.toLowerCase().includes(q))
      .slice(0, 8)
  }, [publicaciones, busqueda])

  function elegir(p: OpcionPublicacion) {
    setElegida(p)
    setBusqueda('')
    setPrecio(p.precio != null ? String(p.precio) : '')
    setConversacion('')
    setConversaciones([])
    conversacionesParaVentaAction(p.codigo).then(setConversaciones)
  }

  const precioNum = Number(precio.replace(/[.\s$]/g, '').replace(',', '.'))

  function registrar() {
    if (!elegida) return
    iniciar(async () => {
      const r = await registrarVentaAction({
        codigo: elegida.codigo,
        fecha_venta: fecha,
        precio_final: precioNum,
        ruta,
        forma_pago: formaPago,
        comprador_nombre: comprador.trim() || null,
        conversacion_id: conversacion || null,
      })
      if (r.ok) {
        toast.success(r.mensaje ?? 'Venta registrada.')
        setComprador('')
        setConversacion('')
        router.refresh()
        onRegistrada?.()
      } else toast.error(r.error)
    })
  }

  return (
    <div className="space-y-3">
      {!publicacionFija && (
        <div>
          <label className="mb-1 block text-xs text-muted-foreground">Publicación</label>
          {elegida ? (
            <div className="flex items-center justify-between gap-2 rounded-md border px-2 py-1.5 text-sm">
              <span className="min-w-0 truncate">
                <span className="font-mono whitespace-nowrap">{elegida.codigo.replace(/-/g, '‑')}</span> · {elegida.titulo}
              </span>
              <button type="button" onClick={() => setElegida(null)} className="rounded p-0.5 hover:bg-accent" aria-label="Cambiar publicación">
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          ) : (
            <div>
              <input
                className={entrada}
                value={busqueda}
                onChange={(e) => setBusqueda(e.target.value)}
                placeholder={publicaciones ? 'Código MP o título' : 'Cargando catálogo…'}
                disabled={!publicaciones}
                aria-label="Buscar publicación"
              />
              {coincidencias.length > 0 && (
                <div className="mt-1 max-h-56 overflow-y-auto rounded-md border">
                  {coincidencias.map((p) => (
                    <button
                      type="button"
                      key={p.codigo}
                      onClick={() => elegir(p)}
                      className="flex w-full items-center justify-between gap-2 border-b px-2 py-1.5 text-left text-sm last:border-b-0 hover:bg-accent"
                    >
                      <span className="min-w-0 truncate">
                        <span className="font-mono whitespace-nowrap">{p.codigo.replace(/-/g, '‑')}</span> · {p.titulo}
                      </span>
                      {p.precio != null && <span className="shrink-0 tabular-nums text-muted-foreground">{formatoPesos(p.precio)}</span>}
                    </button>
                  ))}
                </div>
              )}
              {publicaciones && busqueda.trim() && coincidencias.length === 0 && (
                <p className="mt-1 text-xs text-muted-foreground">Ninguna publicación coincide.</p>
              )}
            </div>
          )}
        </div>
      )}

      <div className="grid grid-cols-2 gap-2 md:grid-cols-3">
        <label className="text-xs text-muted-foreground">
          Fecha de la venta
          <input type="date" className={entrada} value={fecha} max={hoy} onChange={(e) => setFecha(e.target.value)} />
        </label>
        <label className="text-xs text-muted-foreground">
          Precio final
          <input className={entrada} inputMode="numeric" value={precio} onChange={(e) => setPrecio(e.target.value)} placeholder="Precio final" />
        </label>
        <label className="text-xs text-muted-foreground">
          Ruta
          <select className={entrada} value={ruta} onChange={(e) => setRuta(e.target.value as 'recoge' | 'despacho')}>
            <option value="recoge">Recoge en punto</option>
            <option value="despacho">Despacho</option>
          </select>
        </label>
        <label className="text-xs text-muted-foreground">
          Forma de pago
          <select className={entrada} value={formaPago} onChange={(e) => setFormaPago(e.target.value as FormaPago)}>
            {FORMAS_PAGO.map((f) => (
              <option key={f} value={f}>{ETIQUETA_FORMA_PAGO[f]}</option>
            ))}
          </select>
        </label>
        <label className="text-xs text-muted-foreground">
          Comprador (opcional)
          <input className={entrada} value={comprador} onChange={(e) => setComprador(e.target.value)} placeholder="Nombre" />
        </label>
        <label className="text-xs text-muted-foreground">
          Conversación de origen (opcional)
          <select className={entrada} value={conversacion} onChange={(e) => setConversacion(e.target.value)} disabled={!elegida}>
            <option value="">Sin conversación</option>
            {conversaciones.map((c) => (
              <option key={c.id} value={c.id}>{c.fecha} · {c.interesado}</option>
            ))}
          </select>
        </label>
      </div>

      <p className="text-xs text-muted-foreground">
        {formaPago === 'anticipado'
          ? 'El pago queda registrado en el negocio desde ya; el negocio se cierra cuando marques la entrega.'
          : 'El negocio nace en Vendido; al entregar pasa a Entregado y el pago lo cierra.'}
      </p>

      <button
        type="button"
        onClick={registrar}
        disabled={pendiente || !elegida || !(precioNum > 0) || !fecha}
        className="h-9 rounded-md border px-3 text-sm font-medium disabled:opacity-50"
      >
        {pendiente ? 'Registrando…' : 'Registrar venta'}
      </button>
    </div>
  )
}
