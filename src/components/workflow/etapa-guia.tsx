import { HelpCircle } from 'lucide-react'
import { guiaTieneContenido, type GuiaEtapa } from '@/lib/negocios/guia-etapa'

/**
 * La ayuda de la etapa dentro de la vista del flujo.
 *
 * Es la MISMA pieza que `GuiaEtapaCard` muestra dentro del negocio (mismo dato, mismas
 * etiquetas, misma paleta), y esa es justamente la intención: quien diseña el proceso
 * en `/flujo` y quien lo ejecuta en el caso leen lo mismo, así que una etapa que se
 * explica mal se ve mal en los dos sitios.
 *
 * Tres diferencias deliberadas con la tarjeta del negocio, por el contexto:
 *  · **Sin plegado.** La tarjeta del negocio pliega el detalle y recuerda la preferencia
 *    en una clave única de `localStorage`; aquí hay una etapa por fila y esa clave
 *    abriría o cerraría todas a la vez. Además, quien llega aquí ya abrió la etapa a
 *    propósito: volver a pedirle un clic para ver el contenido no aporta.
 *  · **Sin encabezado de etapa.** El número y el nombre ya los da la fila que la contiene.
 *  · **Sin estado vacío.** Una etapa sin `guia` no dibuja nada. La guía es opt-in y hoy
 *    solo una línea la usa: un aviso de "sin guía configurada" sería ruido permanente
 *    en todas las demás.
 */
export function EtapaGuia({ guia }: { guia: GuiaEtapa | null | undefined }) {
  if (!guiaTieneContenido(guia)) return null

  return (
    <div className="border-t border-[#BBF7D0] bg-[#F0FDF4] px-3 py-2.5 dark:border-emerald-900/60 dark:bg-emerald-950/25">
      <div className="flex items-start gap-2">
        <HelpCircle className="mt-[1px] h-3.5 w-3.5 shrink-0 text-[#10B981]" aria-hidden="true" />
        <div className="flex min-w-0 flex-1 flex-col gap-2">
          {guia.definicion && (
            <p className="text-[12px] leading-snug text-[#1A1A1A] dark:text-foreground">
              {guia.definicion}
            </p>
          )}

          {!!guia.hacer?.length && (
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-wide text-[#059669] dark:text-emerald-400">
                Qué se hace
              </p>
              <ol className="mt-0.5 flex list-decimal flex-col gap-0.5 pl-4 text-[12px] leading-snug text-[#1A1A1A] marker:text-[#10B981] dark:text-foreground">
                {guia.hacer.map((paso, i) => (
                  <li key={i}>{paso}</li>
                ))}
              </ol>
            </div>
          )}

          {guia.avanzar && (
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-wide text-[#059669] dark:text-emerald-400">
                No avanza hasta
              </p>
              <p className="mt-0.5 text-[12px] leading-snug text-[#1A1A1A] dark:text-foreground">
                {guia.avanzar}
              </p>
            </div>
          )}

          {guia.responsable && (
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-wide text-[#059669] dark:text-emerald-400">
                Quién responde
              </p>
              <p className="mt-0.5 text-[12px] leading-snug text-[#1A1A1A] dark:text-foreground">
                {guia.responsable}
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
