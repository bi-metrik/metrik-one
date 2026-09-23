'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Loader2, Plus, Trash2 } from 'lucide-react'
import { toast } from 'sonner'

import {
  agregarAdicional,
  eliminarAdicional,
} from '@/app/(app)/negocios/adicional-actions'
import {
  ADICIONAL_OTRO,
  aAdicional,
  etiquetaDeAdicional,
  margenDeAdicional,
  TIPOS_ADICIONAL,
  totalesDeAdicionales,
  type FilaAdicional,
} from '@/lib/cotizaciones/adicionales'
import { formatMargenPct } from '@/lib/cotizaciones/margen-vista'
import { formatCOP } from '@/lib/contacts/constants'
import { parseMontoCop } from '@/lib/negocios/monto-cop'

/**
 * Los adicionales de UNA variante: la maleta extra, la silla, el seguro.
 *
 * Vive dentro del bloque del ítem porque el adicional es **de esa variante**: una maleta
 * en Avianca Basic no es la misma que en LATAM. Ponerlo al nivel de la ranura —una sola
 * lista para «Vuelo»— es exactamente el error que el diseño marca con dos advertencias:
 * el total quedaría bien sumado y mal costeado.
 *
 * ## Lo que la pantalla tiene que dejar claro, y por qué
 *
 *  · **Suman, no compiten.** Dos adicionales sobre la misma variante van los dos. La
 *    pantalla no ofrece elegir entre ellos porque no hay nada que elegir.
 *  · **El margen de cada uno se ve al lado.** El adicional trae su costo y su precio, así
 *    que su margen ya está tomado; enseñarlo es lo que permite ver una maleta revendida a
 *    costo sin tener que sacar la calculadora. Sin precio se pinta una raya, no un 0%: un
 *    cero ahí afirma «revendida a costo», que es otra cosa.
 *  · **El total de los adicionales se declara aparte del precio base.** Así se puede leer
 *    de dónde sale la diferencia entre dos variantes del mismo tramo.
 *
 * ## R6 en la pantalla
 *
 * Sin la tabla en la base no se ofrece nada: un control que devuelve `42P01` al primer
 * clic enseña a ignorar los errores de la pantalla. Y una cotización que no es de viaje
 * no monta este componente en absoluto — el editor solo lo pinta donde ya pinta el cargue
 * de pantallazo, o sea en las líneas con ranura del catálogo.
 */
export default function AdicionalesItem({
  itemId,
  filas,
  disponible,
  editable,
}: {
  itemId: string
  /** Las filas crudas de `item_adicionales` de ESTA variante. */
  filas: FilaAdicional[]
  /** `false` mientras la migración esté pendiente: no se ofrece el control. */
  disponible: boolean
  editable: boolean
}) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [abierto, setAbierto] = useState(false)
  const [codigo, setCodigo] = useState('')
  const [nombre, setNombre] = useState('')
  const [cantidad, setCantidad] = useState('1')
  const [costo, setCosto] = useState('')
  const [precio, setPrecio] = useState('')
  const [moneda, setMoneda] = useState('COP')
  const [tasa, setTasa] = useState('')

  const adicionales = filas.map(aAdicional)
  const totales = totalesDeAdicionales(adicionales)

  // Sin la tabla y sin nada cargado, la sección no existe. Con algo cargado —datos de
  // otro entorno— se pinta de solo lectura: esconder plata que sí suma sería peor.
  if (!disponible && adicionales.length === 0) return null

  function limpiar() {
    setCodigo('')
    setNombre('')
    setCantidad('1')
    setCosto('')
    setPrecio('')
    setMoneda('COP')
    setTasa('')
  }

  function guardar() {
    startTransition(async () => {
      const r = await agregarAdicional(itemId, {
        codigo: codigo === '' ? null : codigo,
        nombre,
        cantidad: Number(cantidad.replace(/\D/g, '')) || 1,
        costo: numero(costo),
        precio: numero(precio),
        moneda,
        tasaCop: numero(tasa) || null,
      })
      if (!r.success) {
        // El motivo del servidor se muestra ENTERO: resumirlo a «no se pudo» deja al
        // usuario sin saber si le falta la tasa de cambio o el nombre del cargo.
        toast.error(r.error ?? 'No se pudo agregar el adicional')
        return
      }
      for (const d of r.desmarcados ?? []) {
        toast.warning(`«${d.nombre ?? 'Sin nombre'}» salió de la propuesta: ${d.motivo}`)
      }
      limpiar()
      setAbierto(false)
      router.refresh()
    })
  }

  function borrar(id: string) {
    startTransition(async () => {
      const r = await eliminarAdicional(id)
      if (!r.success) {
        toast.error(r.error ?? 'No se pudo quitar el adicional')
        return
      }
      for (const d of r.desmarcados ?? []) {
        toast.warning(`«${d.nombre ?? 'Sin nombre'}» salió de la propuesta: ${d.motivo}`)
      }
      router.refresh()
    })
  }

  return (
    <div className="mb-3 rounded-md border border-dashed px-3 py-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
            Adicionales de esta opción
          </span>
          {/* Lo que más cuesta entender, dicho donde se usa. */}
          <p className="text-[10px] leading-tight text-muted-foreground">
            Van <strong>dentro</strong> de esta opción y suman a su precio. Si eliges otra
            {' '}opción de esta ranura, estos no la acompañan.
          </p>
        </div>
        {editable && disponible && !abierto && (
          <button
            type="button"
            onClick={() => setAbierto(true)}
            className="flex items-center gap-1 rounded border px-2 py-1 text-[11px] font-medium hover:bg-accent"
          >
            <Plus className="h-3 w-3" />
            Agregar adicional
          </button>
        )}
      </div>

      {adicionales.length === 0 && !abierto && (
        <p className="mt-1 text-[10px] text-muted-foreground">
          Sin adicionales. Equipaje de bodega extra, selección de silla, seguro…
        </p>
      )}

      {adicionales.length > 0 && (
        <ul className="mt-1.5 space-y-1">
          {adicionales.map(ad => {
            const margen = margenDeAdicional(ad)
            const suyo = totalesDeAdicionales([ad])
            const noConvierte = suyo.sinConvertir.length > 0
            return (
              <li key={ad.id} className="flex items-center justify-between gap-2 text-[11px]">
                <span className="min-w-0 flex-1 truncate">
                  {etiquetaDeAdicional(ad)}
                  {ad.cantidad > 1 && <span className="text-muted-foreground"> ×{ad.cantidad}</span>}
                </span>
                {/* ⚠️ Lo que no se puede convertir se DECLARA, no se pinta en cero: un
                    cero ahí es plata que se regala sin que nada falle. */}
                {noConvierte ? (
                  <span className="shrink-0 font-medium text-red-600">
                    En {ad.moneda} sin tasa: no suma al precio
                  </span>
                ) : (
                  <>
                    <span className="shrink-0 tabular-nums text-muted-foreground">
                      costo {formatCOP(suyo.costo)}
                    </span>
                    <span className="shrink-0 tabular-nums font-medium">{formatCOP(suyo.precio)}</span>
                    <span className="w-12 shrink-0 text-right tabular-nums text-muted-foreground">
                      {formatMargenPct(margen) ?? '—'}
                    </span>
                  </>
                )}
                {editable && (
                  <button
                    type="button"
                    disabled={isPending}
                    title="Quitar este adicional"
                    onClick={() => borrar(ad.id)}
                    className="shrink-0 rounded p-0.5 text-muted-foreground hover:bg-accent hover:text-red-600 disabled:opacity-40"
                  >
                    <Trash2 className="h-3 w-3" />
                  </button>
                )}
              </li>
            )
          })}
          <li className="flex items-center justify-between border-t pt-1 text-[11px] font-medium">
            <span>Suman a esta opción</span>
            <span className="tabular-nums">{formatCOP(totales.precio)}</span>
          </li>
        </ul>
      )}

      {editable && abierto && (
        <div className="mt-2 space-y-2 border-t pt-2">
          <div className="flex flex-wrap gap-2">
            <select
              value={codigo}
              onChange={e => setCodigo(e.target.value)}
              aria-label="Tipo de adicional"
              className="rounded border bg-background px-1.5 py-1 text-[11px]"
            >
              <option value="">Elige de la lista…</option>
              {TIPOS_ADICIONAL.map(t => (
                <option key={t.codigo} value={t.codigo}>{t.etiqueta}</option>
              ))}
            </select>
            <input
              value={nombre}
              onChange={e => setNombre(e.target.value)}
              aria-label="Nombre del adicional"
              // La lista corta Y ADEMÁS texto libre (§1.3). Con «otro» el texto es lo
              // único que va a decir qué es el cargo, así que ahí se pide de frente.
              placeholder={
                codigo === ADICIONAL_OTRO
                  ? '¿De qué es? (obligatorio con «Otro»)'
                  : '…o descríbelo en tus palabras (opcional)'
              }
              className="min-w-[12rem] flex-1 rounded border bg-background px-1.5 py-1 text-[11px]"
            />
          </div>
          <div className="flex flex-wrap items-end gap-2">
            <Campo etiqueta="Cantidad" valor={cantidad} onChange={setCantidad} ancho="w-16" />
            <Campo etiqueta={`Costo unit. (${moneda})`} valor={costo} onChange={setCosto} ancho="w-28" />
            <Campo etiqueta={`Precio unit. (${moneda})`} valor={precio} onChange={setPrecio} ancho="w-28" />
            <Campo etiqueta="Moneda" valor={moneda} onChange={v => setMoneda(v.toUpperCase())} ancho="w-16" />
            {moneda !== 'COP' && (
              <Campo etiqueta="Tasa a COP" valor={tasa} onChange={setTasa} ancho="w-24" />
            )}
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              disabled={isPending}
              onClick={guardar}
              className="flex items-center gap-1 rounded bg-primary px-2.5 py-1 text-[11px] font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50"
            >
              {isPending && <Loader2 className="h-3 w-3 animate-spin" />}
              Guardar adicional
            </button>
            <button
              type="button"
              disabled={isPending}
              onClick={() => { limpiar(); setAbierto(false) }}
              className="rounded px-2 py-1 text-[11px] text-muted-foreground hover:bg-accent"
            >
              Cancelar
            </button>
          </div>
        </div>
      )}

      {!disponible && adicionales.length > 0 && (
        <p className="mt-1 text-[10px] text-amber-700 dark:text-amber-400">
          Estos adicionales no se pueden editar en esta base: falta aplicar la migración.
        </p>
      )}
    </div>
  )
}

function Campo({
  etiqueta,
  valor,
  onChange,
  ancho,
}: {
  etiqueta: string
  valor: string
  onChange: (v: string) => void
  ancho: string
}) {
  return (
    <div>
      <label className="mb-0.5 block text-[10px] font-medium text-muted-foreground">{etiqueta}</label>
      <input
        value={valor}
        onChange={e => onChange(e.target.value)}
        aria-label={etiqueta}
        className={`${ancho} rounded border bg-background px-1.5 py-1 text-[11px] tabular-nums`}
      />
    </div>
  )
}

/**
 * Un número escrito con puntos de miles o coma decimal, como lo teclea quien cotiza: «1.200,50»,
 * «4.980.000», «1200.50». Pasa por el normalizador único de montos (`parseMontoCop`), el mismo
 * que lee los pantallazos, para que un monto no se lea de dos formas según dónde se escribió.
 * Un negativo llega tal cual: lo rechaza el servidor con su motivo, no se voltea el signo aquí.
 */
function numero(texto: string): number {
  return parseMontoCop(texto) ?? 0
}
