'use client'

import { useSyncExternalStore } from 'react'
import { ChevronDown, HelpCircle } from 'lucide-react'
import type { GuiaEtapa } from '../negocio-v2-actions'

const KEY = 'guia-etapa:abierta'

/**
 * La preferencia vive en `localStorage`, que es un sistema externo a React.
 *
 * Se lee con `useSyncExternalStore` y no con un `useState` de arranque perezoso (el patrón
 * que usa el activity log) porque aquella tarjeta solo aparece DESPUÉS de cargar datos en
 * el cliente, y esta se renderiza desde el servidor: leer `localStorage` en el primer
 * render desajustaría la hidratación. El server siempre parte de "cerrada".
 */
const oyentes = new Set<() => void>()
const prefStore = {
  subscribe(fn: () => void) {
    oyentes.add(fn)
    return () => { oyentes.delete(fn) }
  },
  get: () => (typeof window === 'undefined' ? '0' : window.localStorage.getItem(KEY) ?? '0'),
  getServer: () => '0',
  set(v: '0' | '1') {
    window.localStorage.setItem(KEY, v)
    oyentes.forEach(fn => fn())
  },
}

/**
 * La ayuda de la etapa, EN la etapa.
 *
 * Quien abre un caso se hace tres preguntas: dónde está, qué me toca y qué falta para que
 * avance. Hasta ahora eso vivía en un documento aparte, y un documento aparte no se abre
 * mientras se trabaja: se adivina, se pregunta por WhatsApp, o se avanza a ciegas.
 *
 * Diseño deliberado, porque el destinatario está trabajando y no leyendo:
 *  · La definición SIEMPRE visible — una frase. Es lo que orienta y no cuesta leer.
 *  · El detalle plegado, y **se recuerda plegado** (localStorage). Quien ya se sabe la
 *    etapa la cierra una vez y no la vuelve a ver; quien está aprendiendo la deja abierta.
 *    Si obligáramos a cerrarla en cada caso, en una semana la ignorarían — es el mismo
 *    razonamiento por el que no se activan todos los avisos a la vez.
 *  · Sin `guia` configurada no se renderiza nada: ninguna línea de ningún workspace cambia.
 */
export function GuiaEtapaCard({
  guia,
  etapaNumero,
  etapaNombre,
}: {
  guia: GuiaEtapa | null | undefined
  etapaNumero: number
  etapaNombre: string
}) {
  const abierto = useSyncExternalStore(prefStore.subscribe, prefStore.get, prefStore.getServer) === '1'

  function alternar() {
    prefStore.set(abierto ? '0' : '1')
  }

  if (!guia?.definicion && !guia?.hacer?.length && !guia?.avanzar) return null

  const hayDetalle = !!(guia.hacer?.length || guia.avanzar || guia.responsable)

  return (
    <div className="rounded-xl border border-[#BBF7D0] bg-[#F0FDF4] dark:border-emerald-900/60 dark:bg-emerald-950/25">
      <div className="flex items-start gap-2.5 px-4 py-3">
        <HelpCircle className="mt-0.5 h-4 w-4 shrink-0 text-[#10B981]" aria-hidden="true" />
        <div className="min-w-0 flex-1">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-[#059669] dark:text-emerald-400">
            Etapa {etapaNumero} · {etapaNombre}
          </p>
          {guia.definicion && (
            <p className="mt-0.5 text-sm text-foreground">{guia.definicion}</p>
          )}
        </div>
        {hayDetalle && (
          <button
            type="button"
            onClick={alternar}
            aria-expanded={abierto}
            className="flex shrink-0 items-center gap-1 rounded-md px-2 py-1 text-xs font-medium text-[#059669] hover:bg-[#DCFCE7] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#10B981] dark:text-emerald-400 dark:hover:bg-emerald-900/40"
          >
            {abierto ? 'Ocultar' : '¿Qué hago aquí?'}
            <ChevronDown className={`h-3.5 w-3.5 transition-transform ${abierto ? 'rotate-180' : ''}`} />
          </button>
        )}
      </div>

      {abierto && hayDetalle && (
        <div className="flex flex-col gap-3 border-t border-[#BBF7D0] px-4 py-3 dark:border-emerald-900/60">
          {!!guia.hacer?.length && (
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                Qué se hace
              </p>
              <ol className="mt-1 flex list-decimal flex-col gap-1 pl-4 text-sm text-foreground marker:text-[#10B981]">
                {guia.hacer.map((paso, i) => (
                  <li key={i}>{paso}</li>
                ))}
              </ol>
            </div>
          )}
          {guia.avanzar && (
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                No avanza hasta
              </p>
              <p className="mt-0.5 text-sm text-foreground">{guia.avanzar}</p>
            </div>
          )}
          {guia.responsable && (
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                Quién responde
              </p>
              <p className="mt-0.5 text-sm text-foreground">{guia.responsable}</p>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
