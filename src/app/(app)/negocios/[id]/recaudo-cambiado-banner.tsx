'use client'

/**
 * El aviso de recaudo cambiado, en el detalle del negocio.
 *
 * Aparece cuando el área financiera corrigió el reparto de una referencia y el negocio
 * quedó con menos plata de la que su cuenta necesita, o con gates que esa plata sostenía.
 *
 * ── Por qué existe este banner ──────────────────────────────────────────────
 *
 * El aviso vive en `negocios.metadata.recaudo_cambiado_pendiente` y es un gate duro que
 * **no cede al override de owner/admin** (decisión del 2026-08-11). Hasta el 2026-09-08
 * el único código que lo retiraba era `aplicarRetrocesoFinanciero`, y esa acción no la
 * invocaba ninguna pantalla: el aviso se ponía solo y no había forma de quitarlo desde
 * la aplicación. V0442 y V0443 quedaron congelados en Negociación con el reparto
 * perfectamente cuadrado, y hubo que desbloquearlos por SQL.
 *
 * Tres cosas deliberadas:
 *
 * 1. **Vive en el negocio, no en un diálogo.** Quien cambia la plata (la financiera) casi
 *    nunca es quien mueve el caso (el comercial). Un aviso que se muestra y desaparece lo
 *    cierra quien pasaba por ahí. Mismo criterio que `ReversaRutaBanner`.
 *
 * 2. **Lo VEN todos, lo CIERRA el área financiera.** El comercial necesita saber por qué
 *    su caso no avanza; declarar que la plata ya está resuelta es de quien la movió.
 *
 * 3. **Las dos salidas piden motivo escrito.** Sin él nadie sabe después por qué se dio
 *    por atendido, que es justo lo que el aviso vino a evitar.
 */

import { useState, useTransition } from 'react'
import { Banknote, X } from 'lucide-react'
import { toast } from 'sonner'
import {
  resolverAvisoRecaudo,
  proponerRetroceso,
  aplicarRetrocesoFinanciero,
} from '@/lib/actions/conciliacion-actions'
import type {
  CausaRetrocesoFinanciero,
  PropuestaRetroceso,
} from '@/lib/negocios/retroceso-financiero'

/** El aviso tal como quedó guardado. Se lee de la metadata del negocio. */
export type AvisoRecaudoVista = {
  referencia?: string | null
  motivo?: string | null
  etapaAlCambiar?: string | null
  gatesReabiertos?: number | null
  destinoSugerido?: string | null
  creadoEn?: string | null
}

const CAUSAS: Array<{ valor: CausaRetrocesoFinanciero; label: string; ayuda: string }> = [
  {
    valor: 'reparto_mal_contabilizado',
    label: 'El reparto estaba mal anotado',
    ayuda: 'La plata siempre estuvo; quedó en el negocio equivocado. El caso no se mueve.',
  },
  {
    valor: 'falta_plata',
    label: 'Al negocio le falta plata',
    ayuda: 'Quedó con menos de lo que su etapa exige. Se propone volver a donde se le pide al cliente.',
  },
  {
    valor: 'condiciones_mal_pactadas',
    label: 'Las condiciones no eran las pactadas',
    ayuda: 'El precio o el plan de pago no eran los acordados. Se propone volver a donde se fijan.',
  },
]

const MOTIVO_MIN = 10

export function RecaudoCambiadoBanner({
  negocioId,
  aviso,
  puedeResolver,
}: {
  negocioId: string
  aviso: AvisoRecaudoVista | null
  /**
   * Mismo predicado que aplica el servidor (`ctxFinanciero`). Se calcula arriba y viaja
   * como prop: si acá se copiara el criterio, la pantalla ofrecería algo que la acción
   * rechaza, o se lo escondería a quien sí puede.
   */
  puedeResolver: boolean
}) {
  const [isPending, startTransition] = useTransition()
  const [modo, setModo] = useState<'resolver' | 'retroceso' | null>(null)
  const [motivo, setMotivo] = useState('')
  const [causa, setCausa] = useState<CausaRetrocesoFinanciero | null>(null)
  const [propuesta, setPropuesta] = useState<PropuestaRetroceso | null>(null)
  const [destinoElegido, setDestinoElegido] = useState<string>('')

  if (!aviso?.referencia) return null

  const cerrar = () => {
    setModo(null)
    setMotivo('')
    setCausa(null)
    setPropuesta(null)
    setDestinoElegido('')
  }

  const pedirPropuesta = (c: CausaRetrocesoFinanciero) => {
    setCausa(c)
    setPropuesta(null)
    startTransition(async () => {
      const r = await proponerRetroceso({ negocioId, causa: c })
      if (!r.ok) {
        toast.error(r.error)
        return
      }
      setPropuesta(r.propuesta)
      // El sugerido queda preseleccionado, pero la financiera puede elegir otro: es una
      // propuesta, no un carril. '' = no mover de etapa.
      setDestinoElegido(r.propuesta.destinoEtapaId ?? '')
    })
  }

  const enviar = () => {
    const razon = motivo.trim()
    if (razon.length < MOTIVO_MIN) {
      toast.error(`Escribe por qué (mínimo ${MOTIVO_MIN} caracteres)`)
      return
    }
    startTransition(async () => {
      const r =
        modo === 'resolver'
          ? await resolverAvisoRecaudo({ negocioId, motivo: razon })
          : await aplicarRetrocesoFinanciero({
              negocioId,
              causa: causa ?? 'reparto_mal_contabilizado',
              destinoEtapaId: destinoElegido || null,
              motivo: razon,
            })
      if (!r.ok) {
        toast.error(r.error)
        return
      }
      toast.success(
        modo === 'resolver'
          ? 'Aviso resuelto'
          : destinoElegido
            ? 'El caso volvió atrás y el aviso quedó resuelto'
            : 'Retroceso evaluado sin mover de etapa; el aviso quedó resuelto',
      )
      cerrar()
    })
  }

  const gates = aviso.gatesReabiertos ?? 0

  return (
    <div className="mb-3 rounded-lg border border-advertencia/40 bg-[#FFFBEB] p-3">
      <div className="flex items-start gap-2">
        <Banknote className="mt-0.5 h-4 w-4 shrink-0 text-[#B45309]" />
        <div className="min-w-0 flex-1">
          <p className="text-xs font-semibold text-[#B45309]">El recaudo de este negocio cambió</p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            El área financiera corrigió el reparto de la referencia {aviso.referencia}
            {aviso.etapaAlCambiar ? `, con el caso en ${aviso.etapaAlCambiar}` : ''}.
            {aviso.motivo ? ` Motivo: ${aviso.motivo}` : ''}
          </p>
          {gates > 0 && (
            <p className="mt-1 text-[11px] text-muted-foreground">
              Se {gates === 1 ? 'reabrió 1 gate' : `reabrieron ${gates} gates`} que esa plata había cerrado.
            </p>
          )}
          {aviso.destinoSugerido && (
            <p className="mt-1 text-[11px] text-muted-foreground">
              Se sugirió devolverlo a {aviso.destinoSugerido}.
            </p>
          )}
          <p className="mt-1 text-[11px] italic text-muted-foreground">
            Mientras esté puesto, el negocio no avanza de etapa.
          </p>

          {!puedeResolver && (
            <p className="mt-2 text-[11px] italic text-muted-foreground">
              Lo resuelve el área financiera.
            </p>
          )}

          {puedeResolver && modo === null && (
            <div className="mt-2 flex flex-wrap gap-1.5">
              <button
                type="button"
                onClick={() => setModo('resolver')}
                className="rounded-md border border-advertencia/50 bg-white px-2 py-1 text-[11px] font-medium text-[#B45309] transition-colors hover:bg-[#FEF3C7]"
              >
                Resolver
              </button>
              <button
                type="button"
                onClick={() => setModo('retroceso')}
                className="rounded-md border border-[#E5E7EB] bg-white px-2 py-1 text-[11px] font-medium text-muted-foreground transition-colors hover:bg-papel"
              >
                Devolver el caso
              </button>
            </div>
          )}

          {puedeResolver && modo === 'retroceso' && (
            <div className="mt-2 space-y-2">
              <p className="text-[11px] font-medium text-[#B45309]">¿Por qué cambió la plata?</p>
              <div className="space-y-1">
                {CAUSAS.map(c => (
                  <button
                    key={c.valor}
                    type="button"
                    disabled={isPending}
                    onClick={() => pedirPropuesta(c.valor)}
                    className={`block w-full rounded-md border px-2 py-1.5 text-left transition-colors disabled:opacity-60 ${
                      causa === c.valor
                        ? 'border-advertencia/50 bg-[#FEF3C7]'
                        : 'border-[#E5E7EB] bg-white hover:bg-papel'
                    }`}
                  >
                    <span className="block text-[11px] font-medium text-tinta">{c.label}</span>
                    <span className="block text-[11px] text-muted-foreground">{c.ayuda}</span>
                  </button>
                ))}
              </div>

              {propuesta && (
                <div className="space-y-1.5 rounded-md border border-[#E5E7EB] bg-white p-2">
                  <p className="text-[11px] text-muted-foreground">{propuesta.explicacion}</p>
                  <label className="block text-[11px] font-medium text-tinta-suave">
                    ¿A dónde vuelve?
                  </label>
                  <select
                    value={destinoElegido}
                    onChange={e => setDestinoElegido(e.target.value)}
                    className="w-full rounded-lg border border-[#E5E7EB] bg-white px-2 py-1.5 text-xs text-tinta focus:border-acento focus:outline-none focus:ring-2 focus:ring-acento/15"
                  >
                    <option value="">No mover de etapa</option>
                    {propuesta.alternativas.map(e => (
                      <option key={e.id} value={e.id}>
                        {e.nombre}
                        {e.id === propuesta.destinoEtapaId ? ' (sugerida)' : ''}
                      </option>
                    ))}
                  </select>
                </div>
              )}
            </div>
          )}

          {puedeResolver && modo !== null && (modo === 'resolver' || propuesta) && (
            <div className="mt-2 space-y-1.5">
              <label className="block text-[11px] font-medium text-[#B45309]">
                {modo === 'resolver'
                  ? '¿Por qué se da por resuelto?'
                  : '¿Por qué retrocede el caso?'}
              </label>
              <textarea
                value={motivo}
                onChange={e => setMotivo(e.target.value)}
                rows={2}
                autoFocus
                placeholder={
                  modo === 'resolver'
                    ? 'Ej.: el reparto quedó correcto, cada negocio cubre su cuenta.'
                    : 'Ej.: la plata que sostenía el avance se movió al negocio correcto.'
                }
                className="w-full rounded-lg border border-[#E5E7EB] bg-white px-2 py-1.5 text-xs text-tinta focus:border-acento focus:outline-none focus:ring-2 focus:ring-acento/15"
              />
              <div className="flex flex-wrap gap-1.5">
                <button
                  type="button"
                  disabled={isPending}
                  onClick={enviar}
                  className="rounded-md border border-advertencia/50 bg-white px-2 py-1 text-[11px] font-medium text-[#B45309] transition-colors hover:bg-[#FEF3C7] disabled:opacity-60"
                >
                  {isPending
                    ? 'Guardando…'
                    : modo === 'resolver'
                      ? 'Resolver el aviso'
                      : 'Aplicar el retroceso'}
                </button>
                <button
                  type="button"
                  disabled={isPending}
                  onClick={cerrar}
                  className="rounded-md px-2 py-1 text-[11px] text-muted-foreground transition-colors hover:text-foreground disabled:opacity-60"
                >
                  Cancelar
                </button>
              </div>
            </div>
          )}
        </div>
        {puedeResolver && modo !== null && (
          <button
            type="button"
            onClick={cerrar}
            className="shrink-0 rounded p-0.5 text-muted-foreground transition-colors hover:text-foreground"
            aria-label="Cerrar"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        )}
      </div>
    </div>
  )
}
