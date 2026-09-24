'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useMemo, useState, useTransition } from 'react'
import { toast } from 'sonner'
import { ArrowLeft, ExternalLink } from 'lucide-react'
import type { Detalle } from '@/lib/ferreteria/datos'
import {
  ESTADOS_PUBLICACION,
  ETIQUETA_ESTADO,
  ETIQUETA_LINEA,
  LINEAS,
  costoVigente,
  formatoPesos,
  gananciaPorVenta,
  semaforoPendiente,
  validarPiso,
  type EstadoPublicacion,
  type Linea,
} from '@/lib/ferreteria/reglas'
import { agregarNotaAction, guardarPublicacionAction, registrarVentaAction } from '../actions'
import { PuntoPendiente } from '../ferreteria-cliente'

const ETIQUETA_EVENTO: Record<string, string> = {
  creada: 'Creada',
  cambio_precio: 'Cambio de precio',
  cambio_estado: 'Cambio de estado',
  cambio_texto: 'Cambio de texto',
  cambio_dato: 'Cambio de dato',
  venta: 'Venta',
  nota: 'Nota',
  aplicado_en_canal: 'Aplicado en Marketplace',
  error_en_canal: 'Error al aplicar en Marketplace',
}

function fechaHora(iso: string): string {
  return new Date(iso).toLocaleString('es-CO', { timeZone: 'America/Bogota', dateStyle: 'medium', timeStyle: 'short', hourCycle: 'h23' })
}

function Seccion({ titulo, children }: { titulo: string; children: React.ReactNode }) {
  return (
    <section className="rounded-md border p-4">
      <h2 className="mb-3 text-sm font-semibold">{titulo}</h2>
      {children}
    </section>
  )
}

export function PublicacionCliente({
  detalle,
  hoy,
  ahoraIso,
  puedeEditar,
}: {
  detalle: Detalle
  hoy: string
  ahoraIso: string
  puedeEditar: boolean
}) {
  const { publicacion: pub, producto, costos, eventos, mediciones, conversaciones, ventas } = detalle
  const router = useRouter()
  const [pendiente, iniciar] = useTransition()
  const vigente = costoVigente(costos)
  const tono = semaforoPendiente(pub, new Date(ahoraIso))

  // ── Edición ──
  const [precio, setPrecio] = useState(pub.precio != null ? String(pub.precio) : '')
  const [estado, setEstado] = useState<EstadoPublicacion>(pub.estado)
  const [titulo, setTitulo] = useState(pub.titulo)
  const [descripcion, setDescripcion] = useState(pub.descripcion ?? '')
  const [etiquetas, setEtiquetas] = useState((pub.etiquetas ?? []).join(', '))
  const [linea, setLinea] = useState<'' | Linea>(pub.linea ?? '')
  const [link, setLink] = useState(pub.link ?? '')
  const [motivo, setMotivo] = useState('')

  const precioNum = precio.trim() === '' ? null : Number(precio.replace(/[.\s$]/g, '').replace(',', '.'))
  const cambiaPrecio = precioNum !== (pub.precio ?? null)
  const veredicto = useMemo(
    () => (cambiaPrecio && precioNum != null ? validarPiso(precioNum, vigente?.costo_f ?? null, motivo) : null),
    [cambiaPrecio, precioNum, vigente, motivo],
  )
  const pideMotivo = veredicto != null && (veredicto.ok ? veredicto.bajoRegla : veredicto.codigo === 'falta_motivo')

  function guardar() {
    iniciar(async () => {
      const r = await guardarPublicacionAction(pub.codigo, {
        ...(cambiaPrecio ? { precio: precioNum } : {}),
        estado,
        titulo,
        descripcion,
        etiquetas: etiquetas.split(',').map((e) => e.trim()).filter(Boolean),
        linea: linea || null,
        link: link || null,
        motivo: motivo || null,
      })
      if (r.ok) {
        toast.success(r.mensaje ?? 'Guardado.')
        setMotivo('')
        router.refresh()
      } else toast.error(r.error)
    })
  }

  // ── Venta y nota ──
  const [ventaFecha, setVentaFecha] = useState(hoy)
  const [ventaPrecio, setVentaPrecio] = useState(pub.precio != null ? String(pub.precio) : '')
  const [ventaRuta, setVentaRuta] = useState<'recoge' | 'despacho'>('recoge')
  const [nota, setNota] = useState('')

  function vender() {
    iniciar(async () => {
      const r = await registrarVentaAction(pub.codigo, { fecha_primer_pago: ventaFecha, precio_final: Number(ventaPrecio), ruta: ventaRuta })
      if (r.ok) {
        toast.success(r.mensaje ?? 'Venta registrada.')
        router.refresh()
      } else toast.error(r.error)
    })
  }

  function anotar() {
    iniciar(async () => {
      const r = await agregarNotaAction(pub.codigo, nota)
      if (r.ok) {
        setNota('')
        router.refresh()
      } else toast.error(r.error)
    })
  }

  const entrada = 'h-9 w-full rounded-md border bg-background px-3 text-sm disabled:opacity-60'

  return (
    <div className="mx-auto max-w-6xl space-y-4 p-4 md:p-6">
      <Link href="/ferreteria" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="h-4 w-4" /> Ferretería
      </Link>

      <header className="space-y-1">
        <div className="flex flex-wrap items-center gap-2">
          <PuntoPendiente tono={tono} titulo={tono === 'rojo' ? 'Sin aplicar tras dos corridas' : 'Pendiente de aplicar en Marketplace'} />
          <h1 className="text-xl font-semibold">{pub.codigo} · {producto.nombre}</h1>
          <span className="rounded border px-2 py-0.5 text-xs">{ETIQUETA_ESTADO[pub.estado]}</span>
          {pub.link && (
            <a href={pub.link} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-sm text-primary hover:underline">
              Ver aviso <ExternalLink className="h-3 w-3" />
            </a>
          )}
        </div>
        <p className="text-sm text-muted-foreground">
          SKU {producto.sku}{producto.marca ? ` · ${producto.marca}` : ''}{producto.proveedor ? ` · ${producto.proveedor}` : ''}
          {producto.pagina_catalogo ? ` · catálogo pág. ${producto.pagina_catalogo}` : ''}
        </p>
        {pub.pendiente_en_canal && (
          <p className={`text-sm ${tono === 'rojo' ? 'text-red-600' : 'text-amber-700'}`}>
            Hay un cambio pendiente de aplicar en Marketplace desde {pub.pendiente_desde ? fechaHora(pub.pendiente_desde) : '—'}
            {pub.intentos_fallidos > 0 ? ` · ${pub.intentos_fallidos} intento(s) fallido(s)` : ''}
            {pub.ultimo_error_canal ? ` · ${pub.ultimo_error_canal}` : ''}
          </p>
        )}
      </header>

      <div className="grid gap-4 md:grid-cols-2">
        <Seccion titulo="Precio y costo">
          <dl className="grid grid-cols-2 gap-y-1 text-sm">
            <dt className="text-muted-foreground">Precio</dt>
            <dd className="text-right tabular-nums">{pub.precio != null ? formatoPesos(pub.precio) : '—'}</dd>
            <dt className="text-muted-foreground">Costo F vigente</dt>
            <dd className="text-right tabular-nums">{vigente ? `${formatoPesos(vigente.costo_f)} (lista ${vigente.fecha_lista})` : 'sin costo'}</dd>
            <dt className="text-muted-foreground">Costo D (sin revista)</dt>
            <dd className="text-right tabular-nums">{vigente?.costo_d != null ? formatoPesos(vigente.costo_d) : '—'}</dd>
            <dt className="text-muted-foreground">Ganancia por venta</dt>
            <dd className="text-right font-medium tabular-nums">
              {pub.precio != null && vigente ? formatoPesos(gananciaPorVenta(pub.precio, vigente.costo_f)) : '—'}
            </dd>
          </dl>
          {costos.length > 1 && (
            <table className="mt-3 w-full text-xs">
              <thead className="text-left text-muted-foreground">
                <tr><th>Lista</th><th className="text-right">F</th><th className="text-right">D</th></tr>
              </thead>
              <tbody>
                {costos.map((c) => (
                  <tr key={c.fecha_lista} className="border-t">
                    <td className="py-1">{c.fecha_lista}</td>
                    <td className="py-1 text-right tabular-nums">{formatoPesos(c.costo_f)}</td>
                    <td className="py-1 text-right tabular-nums">{c.costo_d != null ? formatoPesos(c.costo_d) : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Seccion>

        <Seccion titulo="Ficha técnica">
          {producto.ficha.length === 0 ? (
            <p className="text-sm text-muted-foreground">Sin especificaciones cargadas.</p>
          ) : (
            <table className="w-full text-sm">
              <tbody>
                {producto.ficha.map((f, i) => (
                  <tr key={`${f.etiqueta}-${i}`} className="border-t first:border-t-0">
                    <td className="py-1 pr-2 text-muted-foreground">{f.etiqueta}</td>
                    <td className="py-1">{f.valor}</td>
                    <td className="py-1 text-right text-xs text-muted-foreground">
                      {f.fuente ?? ''}{f.verificado ? ' · verificado' : ''}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {producto.observaciones && <p className="mt-2 text-xs text-muted-foreground">{producto.observaciones}</p>}
          {producto.fotos.length > 0 && (
            <div className="mt-3 flex flex-wrap gap-2">
              {producto.fotos.map((url) => (
                <a key={url} href={url} target="_blank" rel="noopener noreferrer">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={url} alt={producto.nombre} className="h-20 w-20 rounded border object-cover" />
                </a>
              ))}
            </div>
          )}
        </Seccion>
      </div>

      {puedeEditar && (
        <Seccion titulo="Editar publicación">
          <p className="mb-3 text-xs text-muted-foreground">
            Un cambio de precio, estado o texto queda pendiente hasta que el cron lo aplique en Marketplace y lo confirme releyendo el aviso.
          </p>
          <div className="grid gap-3 md:grid-cols-3">
            <label className="space-y-1 text-sm">
              <span className="text-muted-foreground">Precio</span>
              <input className={entrada} inputMode="numeric" value={precio} onChange={(e) => setPrecio(e.target.value)} />
            </label>
            <label className="space-y-1 text-sm">
              <span className="text-muted-foreground">Estado</span>
              <select className={entrada} value={estado} onChange={(e) => setEstado(e.target.value as EstadoPublicacion)}>
                {ESTADOS_PUBLICACION.map((e) => <option key={e} value={e}>{ETIQUETA_ESTADO[e]}</option>)}
              </select>
            </label>
            <label className="space-y-1 text-sm">
              <span className="text-muted-foreground">Línea</span>
              <select className={entrada} value={linea} onChange={(e) => setLinea(e.target.value as Linea | '')}>
                <option value="">Sin línea</option>
                {LINEAS.map((l) => <option key={l} value={l}>{ETIQUETA_LINEA[l]}</option>)}
              </select>
            </label>
            <label className="space-y-1 text-sm md:col-span-3">
              <span className="text-muted-foreground">Título</span>
              <input className={entrada} value={titulo} onChange={(e) => setTitulo(e.target.value)} />
            </label>
            <label className="space-y-1 text-sm md:col-span-3">
              <span className="text-muted-foreground">Descripción</span>
              <textarea className="min-h-24 w-full rounded-md border bg-background px-3 py-2 text-sm" value={descripcion} onChange={(e) => setDescripcion(e.target.value)} />
            </label>
            <label className="space-y-1 text-sm md:col-span-2">
              <span className="text-muted-foreground">Etiquetas (separadas por coma)</span>
              <input className={entrada} value={etiquetas} onChange={(e) => setEtiquetas(e.target.value)} />
            </label>
            <label className="space-y-1 text-sm">
              <span className="text-muted-foreground">Link del aviso</span>
              <input className={entrada} value={link} onChange={(e) => setLink(e.target.value)} />
            </label>
          </div>

          {veredicto && (
            <div className={`mt-3 rounded-md border p-3 text-sm ${!veredicto.ok && veredicto.codigo !== 'falta_motivo' ? 'border-red-300 bg-red-50 text-red-800' : pideMotivo ? 'border-amber-300 bg-amber-50 text-amber-900' : 'bg-muted/40'}`}>
              {veredicto.ok
                ? `Ganancia por venta con este precio: ${formatoPesos(veredicto.ganancia)}.${veredicto.bajoRegla ? ` Queda bajo 1,25 x costo (${formatoPesos(veredicto.regla)}): el motivo es obligatorio.` : ''}`
                : veredicto.mensaje}
            </div>
          )}
          {pideMotivo && (
            <label className="mt-3 block space-y-1 text-sm">
              <span className="text-muted-foreground">Motivo (queda en la bitácora)</span>
              <input className={entrada} value={motivo} onChange={(e) => setMotivo(e.target.value)} placeholder="Ej.: igualar precio de Homecenter" />
            </label>
          )}
          <div className="mt-3 flex justify-end">
            <button
              type="button"
              onClick={guardar}
              disabled={pendiente || (veredicto != null && !veredicto.ok)}
              className="h-9 rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground disabled:opacity-50"
            >
              Guardar cambios
            </button>
          </div>
        </Seccion>
      )}

      <div className="grid gap-4 md:grid-cols-2">
        <Seccion titulo="Bitácora">
          <ol className="max-h-96 space-y-2 overflow-y-auto text-sm">
            {eventos.length === 0 && <li className="text-muted-foreground">Sin eventos.</li>}
            {eventos.map((e) => (
              <li key={e.id} className="border-l-2 pl-2">
                <div className="flex justify-between gap-2">
                  <span className="font-medium">{ETIQUETA_EVENTO[e.tipo] ?? e.tipo}{e.campo ? ` · ${e.campo}` : ''}</span>
                  <span className="shrink-0 text-xs text-muted-foreground">{fechaHora(e.created_at)}</span>
                </div>
                {(e.valor_anterior || e.valor_nuevo) && (
                  <div className="text-xs">
                    {e.valor_anterior != null && <span className="text-muted-foreground line-through">{e.valor_anterior}</span>}
                    {e.valor_anterior != null && e.valor_nuevo != null && ' → '}
                    {e.valor_nuevo}
                  </div>
                )}
                {e.motivo && <div className="text-xs italic">Motivo: {e.motivo}</div>}
                <div className="text-xs text-muted-foreground">{e.autor_nombre ?? e.autor_tipo}</div>
              </li>
            ))}
          </ol>
          {puedeEditar && (
            <div className="mt-3 flex gap-2">
              <input className={entrada} value={nota} onChange={(e) => setNota(e.target.value)} placeholder="Agregar una nota" />
              <button type="button" onClick={anotar} disabled={pendiente || !nota.trim()} className="h-9 shrink-0 rounded-md border px-3 text-sm disabled:opacity-50">
                Anotar
              </button>
            </div>
          )}
        </Seccion>

        <div className="space-y-4">
          <Seccion titulo="Mediciones diarias">
            {mediciones.length === 0 ? (
              <p className="text-sm text-muted-foreground">Sin mediciones. Las sube el cron una vez al día.</p>
            ) : (
              <table className="w-full text-sm">
                <thead className="text-left text-xs text-muted-foreground">
                  <tr><th>Fecha</th><th className="text-right">Clics acum.</th><th className="text-right">Guardados</th><th>Estado visto</th></tr>
                </thead>
                <tbody>
                  {mediciones.slice(0, 30).map((m) => (
                    <tr key={m.fecha} className="border-t">
                      <td className="py-1">{m.fecha}</td>
                      <td className="py-1 text-right tabular-nums">{m.clics_acumulados}</td>
                      <td className="py-1 text-right tabular-nums">{m.guardados ?? '—'}</td>
                      <td className="py-1 pl-2 text-xs">{m.estado_visto ?? ''}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </Seccion>

          <Seccion titulo="Conversaciones">
            {conversaciones.length === 0 ? (
              <p className="text-sm text-muted-foreground">Sin conversaciones.</p>
            ) : (
              <ul className="space-y-1 text-sm">
                {conversaciones.map((c) => (
                  <li key={c.id} className="flex justify-between gap-2 border-t pt-1 first:border-t-0">
                    <span>{c.interesado} <span className="text-xs text-muted-foreground">· {c.canal} · {c.fecha}</span></span>
                    <span className="text-xs">{c.resultado}{c.motivo_perdida ? ` (${c.motivo_perdida})` : ''}</span>
                  </li>
                ))}
              </ul>
            )}
          </Seccion>

          <Seccion titulo="Ventas">
            {ventas.length === 0 ? (
              <p className="text-sm text-muted-foreground">Sin ventas.</p>
            ) : (
              <table className="w-full text-sm">
                <thead className="text-left text-xs text-muted-foreground">
                  <tr><th>Primer pago</th><th className="text-right">Precio</th><th className="text-right">Costo</th><th className="text-right">Ganancia</th><th>Ruta</th></tr>
                </thead>
                <tbody>
                  {ventas.map((v) => (
                    <tr key={v.id} className="border-t">
                      <td className="py-1">{v.fecha_primer_pago}</td>
                      <td className="py-1 text-right tabular-nums">{formatoPesos(v.precio_final)}</td>
                      <td className="py-1 text-right tabular-nums">{formatoPesos(v.costo_dia)}</td>
                      <td className="py-1 text-right tabular-nums">{formatoPesos(v.ganancia)}</td>
                      <td className="py-1 pl-2 text-xs">{v.ruta}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            {puedeEditar && (
              <div className="mt-3 grid grid-cols-2 gap-2 md:grid-cols-4">
                <input type="date" className={entrada} value={ventaFecha} onChange={(e) => setVentaFecha(e.target.value)} aria-label="Fecha del primer pago" />
                <input className={entrada} inputMode="numeric" value={ventaPrecio} onChange={(e) => setVentaPrecio(e.target.value)} aria-label="Precio final" placeholder="Precio final" />
                <select className={entrada} value={ventaRuta} onChange={(e) => setVentaRuta(e.target.value as 'recoge' | 'despacho')} aria-label="Ruta">
                  <option value="recoge">Recoge en punto</option>
                  <option value="despacho">Despacho</option>
                </select>
                <button type="button" onClick={vender} disabled={pendiente || !ventaPrecio} className="h-9 rounded-md border px-3 text-sm disabled:opacity-50">
                  Registrar venta
                </button>
              </div>
            )}
          </Seccion>
        </div>
      </div>
    </div>
  )
}
