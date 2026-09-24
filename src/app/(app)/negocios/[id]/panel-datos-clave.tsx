import { AlertTriangle, KeyRound } from 'lucide-react'
import type { VistaDatosClave } from '@/lib/negocios/datos-clave'

/**
 * Tarjeta «Datos clave» del negocio: lo que cambia el trámite, a la vista en todas las
 * etapas. Solo lectura: cada dato se corrige en el bloque donde se responde.
 *
 * Tres estados por campo, y ninguno se esconde:
 *  - con valor: el valor, y su nota si la trae («cotizada»);
 *  - «Sin definir» en ámbar: el dato le aplica al caso y falta. Es justo lo que hay que ver;
 *  - «No aplica» en gris: ninguna de sus fuentes le aplica al caso.
 * Las contradicciones entre datos (los cruces de la línea) van arriba y en rojo, con el
 * texto del cruce. Si una frena el avance en esta etapa, lo dice.
 *
 * La decisión de qué mostrar ya viene tomada del servidor (`datos-clave.ts`); aquí solo se
 * pinta, así que la tarjeta y el gate de avance no pueden decir cosas distintas.
 */
export default function PanelDatosClave({ vista }: { vista: VistaDatosClave | null | undefined }) {
  if (!vista || (vista.campos.length === 0 && vista.contradicciones.length === 0)) return null

  return (
    <section className="rounded-lg border border-border bg-card p-3" aria-label={vista.titulo}>
      <div className="mb-2 flex items-center gap-2">
        <KeyRound className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden />
        <h3 className="text-xs font-semibold">{vista.titulo}</h3>
      </div>

      {vista.contradicciones.length > 0 && (
        <ul className="mb-2 space-y-1.5">
          {vista.contradicciones.map(c => (
            <li
              key={c.slug}
              className="flex gap-1.5 rounded-md border border-red-200 bg-red-50 px-2 py-1.5 text-[11px] leading-snug text-red-800 dark:border-red-900/60 dark:bg-red-950/40 dark:text-red-300"
            >
              <AlertTriangle className="mt-px h-3 w-3 shrink-0" aria-hidden />
              <span>
                {c.mensaje}
                {c.bloquea && <span className="font-semibold"> Frena el avance en esta etapa.</span>}
              </span>
            </li>
          ))}
        </ul>
      )}

      {vista.campos.length > 0 && (
        <dl className="space-y-1.5">
          {vista.campos.map(campo => (
            <div key={campo.label}>
              <div className="flex items-baseline justify-between gap-3">
                <dt className="shrink-0 text-[10px] uppercase tracking-wide text-muted-foreground">{campo.label}</dt>
                <dd className="min-w-0 flex-1 text-right text-xs">
                  {campo.valor.estado === 'ok' && (
                    <>
                      <span className="font-medium">{campo.valor.texto}</span>
                      {campo.valor.nota && (
                        <span className="ml-1 text-[10px] text-muted-foreground">({campo.valor.nota})</span>
                      )}
                    </>
                  )}
                  {campo.valor.estado === 'sin_definir' && (
                    <span className="rounded bg-amber-50 px-1.5 py-0.5 font-medium text-amber-800 dark:bg-amber-950/40 dark:text-amber-300">
                      Sin definir
                    </span>
                  )}
                  {campo.valor.estado === 'no_aplica' && <span className="text-muted-foreground">No aplica</span>}
                </dd>
              </div>
              {campo.detalle.length > 0 && (
                <ul className="mt-0.5 space-y-0.5 text-right">
                  {campo.detalle.map((d, i) => (
                    <li key={i} className="text-[11px] leading-snug text-muted-foreground">{d}</li>
                  ))}
                </ul>
              )}
            </div>
          ))}
        </dl>
      )}
    </section>
  )
}
