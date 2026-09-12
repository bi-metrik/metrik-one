'use client'

import { useEffect, useState, useTransition } from 'react'
import Link from 'next/link'
import { ShieldCheck, ShieldAlert, ExternalLink, User } from 'lucide-react'
import { toast } from 'sonner'
import { InfoTooltip } from '@/components/ui/info-tooltip'
import { formatFecha } from '@/lib/dates/bogota'
import {
  cargarFichaContacto,
  guardarFichaContacto,
  registrarAutorizacionContacto,
  type FichaContacto,
} from './contacto-actions'
import {
  leerCampo,
  esCampoNativo,
  estadoAutorizacion,
  type CampoContacto,
} from '@/lib/contactos/campos-contacto'

/**
 * Bloque `contacto`: la ficha de la PERSONA, editada desde dentro del negocio.
 *
 * Lo que se escribe aqui queda en `contactos`, no en el negocio. Por eso un cliente
 * recurrente ve estos campos ya llenos en su segundo viaje: no es que el bloque recuerde,
 * es que el dato nunca fue del viaje.
 *
 * Dos modos, uno solo por bloque:
 *  · `campos` — formulario sobre la ficha del contacto.
 *  · `autorizacion` — estado de la autorizacion de tratamiento de datos. Se registra una
 *    vez por persona; en los negocios siguientes el bloque solo la muestra.
 */

interface BloqueContactoProps {
  negocioBloqueId: string
  modo: 'editable' | 'visible'
  variante: 'campos' | 'autorizacion'
  campos: CampoContacto[]
}

/**
 * El contacto NO llega por props: lo resuelve el servidor desde el bloque. Pasarlo por
 * `BloqueCard` y `BloqueRenderer` obligaria a hilar dos props por cuatro sitios de
 * llamada para un solo tipo de bloque, y el `custom_data` que este bloque necesita se
 * retira a proposito del payload del negocio.
 */
export default function BloqueContacto({
  negocioBloqueId,
  modo,
  variante,
  campos,
}: BloqueContactoProps) {
  const [ficha, setFicha] = useState<FichaContacto | null>(null)
  const [values, setValues] = useState<Record<string, unknown>>({})
  const [cargando, setCargando] = useState(true)
  const [isPending, startTransition] = useTransition()

  useEffect(() => {
    let vivo = true
    cargarFichaContacto(negocioBloqueId).then(res => {
      if (!vivo) return
      setCargando(false)
      if (res.error) {
        toast.error(res.error)
        return
      }
      setFicha(res.ficha)
      if (res.ficha) {
        const iniciales: Record<string, unknown> = {}
        for (const c of campos) iniciales[c.slug] = leerCampo(res.ficha.valores, c.slug) ?? ''
        setValues(iniciales)
      }
    })
    return () => {
      vivo = false
    }
    // `campos` viene de config y no cambia en vida del componente.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [negocioBloqueId])

  if (cargando) {
    return <p className="text-xs text-tinta-suave italic">Cargando la ficha del contacto…</p>
  }

  // Sin contacto no hay ficha que llenar, y no es un error: es un negocio que todavia no
  // tiene a quien pertenecer. Decirlo es mas util que un formulario que no guarda nada.
  if (!ficha) {
    return (
      <p className="text-xs text-tinta-suave italic">
        Este negocio todavia no tiene un contacto asociado. Asignalo para completar su ficha.
      </p>
    )
  }

  const fichaActual = ficha
  const contactoId = ficha.contactoId
  const contactoNombre = ficha.valores.nombre

  const enlaceFicha = (
    <Link
      href={`/directorio/contacto/${contactoId}`}
      className="inline-flex items-center gap-1 text-[11px] text-acento hover:underline"
    >
      <ExternalLink className="h-3 w-3" />
      Ver ficha completa de {contactoNombre}
    </Link>
  )

  // ── Variante: autorizacion de tratamiento de datos ───────────────────────────
  if (variante === 'autorizacion') {
    const estado = estadoAutorizacion(ficha.valores.custom_data)

    function handleRegistrar() {
      startTransition(async () => {
        const res = await registrarAutorizacionContacto(negocioBloqueId)
        if (res.error) {
          toast.error(res.error)
          return
        }
        setFicha(prev =>
          prev
            ? {
                ...prev,
                valores: {
                  ...prev.valores,
                  custom_data: {
                    ...prev.valores.custom_data,
                    autorizacion_datos: true,
                    autorizacion_datos_fecha: res.fecha,
                  },
                },
              }
            : prev,
        )
        toast.success('Autorizacion registrada en el contacto')
      })
    }

    if (estado.autorizado) {
      const fechaFmt = estado.fecha
        ? formatFecha(estado.fecha, { day: 'numeric', month: 'short', year: 'numeric' })
        : null
      return (
        <div className="space-y-2">
          <div className="flex items-center gap-2 rounded-lg border border-[#BBF7D0] bg-[var(--acento-tinte)] px-3 py-2">
            <ShieldCheck className="h-4 w-4 shrink-0 text-acento" />
            <div className="min-w-0 flex-1">
              <p className="text-xs font-medium text-acento">Autorizacion de datos vigente</p>
              <p className="text-[10px] text-acento/80">
                {fechaFmt ? `Registrada el ${fechaFmt}` : 'Registrada sin fecha (dato migrado)'}
              </p>
            </div>
          </div>
          {enlaceFicha}
        </div>
      )
    }

    return (
      <div className="space-y-2">
        <div className="flex items-center gap-2 rounded-lg border border-[#FDE68A] bg-[#FFFBEB] px-3 py-2">
          <ShieldAlert className="h-4 w-4 shrink-0 text-[#B45309]" />
          <p className="text-xs text-[#92400E]">
            {contactoNombre} no tiene autorizacion de tratamiento de datos.
          </p>
        </div>
        {modo === 'editable' ? (
          <button
            type="button"
            onClick={handleRegistrar}
            disabled={isPending}
            className="rounded-lg bg-acento px-4 py-2 text-sm font-medium text-white hover:bg-acento-hover disabled:cursor-not-allowed disabled:opacity-50"
          >
            {isPending ? 'Registrando…' : 'Registrar autorizacion'}
          </button>
        ) : (
          <p className="text-[11px] text-tinta-suave">
            Se registra desde la ficha del contacto o desde la etapa donde se recoge.
          </p>
        )}
        {enlaceFicha}
      </div>
    )
  }

  // ── Variante: campos de la ficha ─────────────────────────────────────────────
  const inputBaseClass =
    'w-full rounded-lg border border-[#E5E7EB] px-3 py-2 text-xs text-tinta focus:border-acento focus:outline-none focus:ring-2 focus:ring-acento/15 disabled:opacity-60'

  function guardar(slug: string, valor: unknown) {
    const previo = leerCampo(fichaActual.valores, slug) ?? ''
    if (String(previo) === String(valor)) return
    startTransition(async () => {
      const res = await guardarFichaContacto(negocioBloqueId, { [slug]: valor })
      if (res.error) {
        toast.error(res.error)
        return
      }
      // La ficha local se mueve con lo guardado: sin esto, cada blur volveria a comparar
      // contra el valor original y reenviaria lo mismo.
      setFicha(prev => {
        if (!prev) return prev
        const valores = esCampoNativo(slug)
          ? { ...prev.valores, [slug]: valor }
          : { ...prev.valores, custom_data: { ...prev.valores.custom_data, [slug]: valor } }
        return { ...prev, valores }
      })
    })
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-1.5 text-[11px] text-tinta-suave">
        <User className="h-3.5 w-3.5" />
        <span>
          Estos datos son del contacto, no del negocio: quedan para sus proximos viajes.
        </span>
      </div>

      {campos.map(f => (
        <div key={f.slug}>
          <label className="mb-1 flex items-center gap-1 text-[11px] font-medium text-tinta-suave">
            {f.label}
            {f.required && <span className="text-red-500">*</span>}
            {f.ayuda && <InfoTooltip text={f.ayuda} />}
          </label>

          {f.tipo === 'select' ? (
            <select
              value={(values[f.slug] as string) ?? ''}
              disabled={modo === 'visible' || isPending}
              onChange={e => {
                setValues(v => ({ ...v, [f.slug]: e.target.value }))
                guardar(f.slug, e.target.value)
              }}
              className={`${inputBaseClass} bg-white`}
            >
              <option value="">Sin definir</option>
              {(f.options ?? []).map(o => (
                <option key={o} value={o}>
                  {o}
                </option>
              ))}
            </select>
          ) : f.tipo === 'toggle' ? (
            <label className="inline-flex cursor-pointer items-center gap-2">
              <input
                type="checkbox"
                checked={values[f.slug] === true}
                disabled={modo === 'visible' || isPending}
                onChange={e => {
                  setValues(v => ({ ...v, [f.slug]: e.target.checked }))
                  guardar(f.slug, e.target.checked)
                }}
                className="h-4 w-4 accent-[var(--acento)]"
              />
              <span className="text-xs text-tinta">{f.label}</span>
            </label>
          ) : f.tipo === 'textarea' ? (
            <textarea
              rows={3}
              value={(values[f.slug] as string) ?? ''}
              readOnly={modo === 'visible'}
              onChange={e => setValues(v => ({ ...v, [f.slug]: e.target.value }))}
              onBlur={e => guardar(f.slug, e.target.value)}
              className={`${inputBaseClass} bg-white`}
            />
          ) : (
            <input
              type={f.tipo === 'fecha' ? 'date' : f.tipo === 'numero' ? 'number' : f.tipo === 'email' ? 'email' : 'text'}
              value={(values[f.slug] as string) ?? ''}
              readOnly={modo === 'visible'}
              onChange={e => setValues(v => ({ ...v, [f.slug]: e.target.value }))}
              onBlur={e => guardar(f.slug, e.target.value)}
              className={`${inputBaseClass} bg-white`}
            />
          )}
        </div>
      ))}

      {enlaceFicha}
    </div>
  )
}
