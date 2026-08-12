'use client'

/**
 * Propuesta de reversa de ruta, en el detalle del negocio.
 *
 * Aparece cuando una corrección cambió el dato que decidió por dónde iba el caso y el caso
 * ya se había ido por la vía equivocada, saltándose etapas. Dice por dónde debía pasar y
 * ofrece devolverlo a la primera que se saltó.
 *
 * Tres cosas deliberadas:
 *
 * 1. **Es una propuesta, no un aviso de algo que ya pasó.** El sistema no mueve el caso
 *    solo: devolverlo reabre gates de saldo y puede dejar cobros y cuentas emitidas en
 *    desacuerdo con la etapa. Los dos botones pesan lo mismo, y ninguno está preseleccionado.
 *
 * 2. **Vive en el negocio, no en un diálogo.** Quien corrige el dato no siempre es quien
 *    puede decidir mover el caso, y un caso en la vía equivocada no puede depender de que
 *    alguien alcance a leer un mensaje que se va. Queda hasta que se decida.
 *
 * 3. **Las dos salidas piden motivo escrito.** Descartar también es una decisión: si el
 *    equipo descarta siempre la misma propuesta, lo que está mal es la configuración de la
 *    línea, y sin el motivo eso no se ve nunca.
 */

import { useState, useTransition } from 'react'
import { GitBranch, X } from 'lucide-react'
import { toast } from 'sonner'
import { aplicarReversaDeRuta, descartarReversaDeRuta } from '../negocio-v2-actions'
import { puedeDevolverCasoPorRuta, type Role } from '@/lib/permissions/can-edit'

export type ReversaPendienteVista = {
  decision?: { nombre?: string } | null
  actual?: { nombre?: string } | null
  destino?: { nombre?: string } | null
  omitidas?: Array<{ nombre?: string }> | null
  aviso?: string | null
  detectado_por_nombre?: string | null
  detectado_at?: string | null
}

export function ReversaRutaBanner({
  negocioId,
  propuesta,
  userRole,
}: {
  negocioId: string
  propuesta: ReversaPendienteVista | null
  userRole: string
}) {
  const [isPending, startTransition] = useTransition()
  const [modo, setModo] = useState<'aplicar' | 'descartar' | null>(null)
  const [motivo, setMotivo] = useState('')

  if (!propuesta?.destino?.nombre) return null

  // Misma función que usa el guard del servidor. Si aquí se copiara el criterio, la
  // pantalla ofrecería algo que el servidor rechaza, o se lo escondería a quien sí puede.
  const puedeDecidir = puedeDevolverCasoPorRuta({
    id: '',
    role: (userRole ?? 'read_only') as Role,
    areas: [],
  })

  const omitidas = (propuesta.omitidas ?? []).map(o => o?.nombre).filter(Boolean) as string[]
  const destino = propuesta.destino.nombre

  const enviar = () => {
    const razon = motivo.trim()
    if (razon.length < 5) {
      toast.error('Escribe por qué, aunque sea en pocas palabras')
      return
    }
    startTransition(async () => {
      const r =
        modo === 'aplicar'
          ? await aplicarReversaDeRuta(negocioId, razon)
          : await descartarReversaDeRuta(negocioId, razon)
      if (r.error) {
        toast.error(r.error)
        // Una propuesta vencida se retira sola en el servidor: cerrar el formulario para
        // que la pantalla no siga ofreciendo algo que ya no existe.
        setModo(null)
        setMotivo('')
        return
      }
      toast.success(
        modo === 'aplicar'
          ? `El caso volvió a ${destino}`
          : 'Se retiró la propuesta',
      )
      setModo(null)
      setMotivo('')
    })
  }

  return (
    <div className="mb-3 rounded-lg border border-[#F59E0B]/40 bg-[#FFFBEB] p-3">
      <div className="flex items-start gap-2">
        <GitBranch className="mt-0.5 h-4 w-4 shrink-0 text-[#B45309]" />
        <div className="min-w-0 flex-1">
          <p className="text-xs font-semibold text-[#B45309]">El caso quedó en la vía equivocada</p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {propuesta.aviso
              ?? `Con el dato corregido el caso debía pasar por ${omitidas.join(', ') || destino}, y no pasó.`}
          </p>
          {propuesta.decision?.nombre && (
            <p className="mt-1 text-[11px] text-muted-foreground">
              La bifurcación se decide en {propuesta.decision.nombre}
              {propuesta.actual?.nombre ? `; el caso está en ${propuesta.actual.nombre}` : ''}.
              {propuesta.detectado_por_nombre ? ` Lo destapó la corrección de ${propuesta.detectado_por_nombre}.` : ''}
            </p>
          )}
          {/* Solo el primer destino es una certeza: de ahi en adelante el recorrido lo
              predice el sistema con los datos que el caso todavia no tiene. Decirlo evita
              que alguien lea la lista como una promesa. */}
          {omitidas.length > 1 && (
            <p className="mt-1 text-[11px] italic text-muted-foreground">
              Se propone devolverlo a {destino}. Las etapas siguientes se resolverán a
              medida que el caso avance.
            </p>
          )}

          {!puedeDecidir && (
            <p className="mt-2 text-[11px] italic text-muted-foreground">
              Lo decide quien supervisa el proceso.
            </p>
          )}

          {puedeDecidir && modo === null && (
            <div className="mt-2 flex flex-wrap gap-1.5">
              <button
                type="button"
                onClick={() => setModo('aplicar')}
                className="rounded-md border border-[#F59E0B]/50 bg-white px-2 py-1 text-[11px] font-medium text-[#B45309] hover:bg-[#FEF3C7] transition-colors"
              >
                Devolver a {destino}
              </button>
              <button
                type="button"
                onClick={() => setModo('descartar')}
                className="rounded-md border border-[#E5E7EB] bg-white px-2 py-1 text-[11px] font-medium text-muted-foreground hover:bg-[#F5F4F2] transition-colors"
              >
                Dejarlo donde está
              </button>
            </div>
          )}

          {puedeDecidir && modo !== null && (
            <div className="mt-2 space-y-1.5">
              <label className="block text-[11px] font-medium text-[#B45309]">
                {modo === 'aplicar'
                  ? `¿Por qué se devuelve a ${destino}?`
                  : '¿Por qué se deja donde está?'}
              </label>
              <textarea
                value={motivo}
                onChange={e => setMotivo(e.target.value)}
                rows={2}
                autoFocus
                placeholder={
                  modo === 'aplicar'
                    ? 'Ej.: el cliente sí contrató la certificación, el interruptor estaba mal.'
                    : 'Ej.: el tramo ya se hizo por fuera y quedó documentado en el expediente.'
                }
                className="w-full rounded-lg border border-[#E5E7EB] bg-white px-2 py-1.5 text-xs text-[#1A1A1A] focus:border-[#10B981] focus:outline-none focus:ring-2 focus:ring-[#10B981]/15"
              />
              <div className="flex flex-wrap gap-1.5">
                <button
                  type="button"
                  disabled={isPending}
                  onClick={enviar}
                  className="rounded-md border border-[#F59E0B]/50 bg-white px-2 py-1 text-[11px] font-medium text-[#B45309] hover:bg-[#FEF3C7] transition-colors disabled:opacity-60"
                >
                  {isPending ? 'Guardando…' : modo === 'aplicar' ? 'Devolver el caso' : 'Retirar la propuesta'}
                </button>
                <button
                  type="button"
                  disabled={isPending}
                  onClick={() => { setModo(null); setMotivo('') }}
                  className="rounded-md px-2 py-1 text-[11px] text-muted-foreground hover:text-foreground transition-colors disabled:opacity-60"
                >
                  Cancelar
                </button>
              </div>
            </div>
          )}
        </div>
        {puedeDecidir && modo !== null && (
          <button
            type="button"
            onClick={() => { setModo(null); setMotivo('') }}
            className="shrink-0 rounded p-0.5 text-muted-foreground hover:text-foreground transition-colors"
            aria-label="Cerrar"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        )}
      </div>
    </div>
  )
}
