'use client'

import type { EstadoDePaso, NumeroDePaso } from '@/lib/cotizaciones/por-pasos-vista'

/**
 * La barra de los tres pasos (diseño, sección 1): siempre a la vista, dice dónde estoy (el paso
 * abierto, resaltado), qué falta (la frase de estado de cada paso, con su color) y qué sigue (el
 * renglón «Sigue:» con UN botón). Los pasos no se bloquean: se salta a cualquiera con un toque.
 */

const PASOS: { n: NumeroDePaso; titulo: string; que: string }[] = [
  { n: 1, titulo: 'Armar el viaje', que: 'Pega todo lo que cotizaste' },
  { n: 2, titulo: 'Tarifas', que: 'Escoge qué va en cada una' },
  { n: 3, titulo: 'Revisar y enviar', que: 'Mira lo que le llega al cliente' },
]

const COLOR: Record<EstadoDePaso['tono'], string> = {
  hecho: 'text-[#0E5C43]',
  error: 'text-[#B3382C]',
  ambar: 'text-[#9A5F0C]',
  pend: 'text-[#6E6A62]',
}

export function BarraPasos({
  paso,
  estados,
  sigue,
  onPaso,
  onSigue,
}: {
  paso: NumeroDePaso
  estados: Record<NumeroDePaso, EstadoDePaso>
  sigue: { texto: string; boton: string | null }
  onPaso: (n: NumeroDePaso) => void
  onSigue: () => void
}) {
  return (
    <nav
      aria-label="Pasos de la cotización"
      data-barra-pasos
      className="sticky top-0 z-20 rounded-[14px] border border-[#E2DED5] bg-white p-2 shadow-[0_1px_2px_rgba(25,23,19,.06),0_4px_14px_rgba(25,23,19,.05)]"
    >
      <ol className="m-0 grid list-none grid-cols-3 gap-1.5 p-0">
        {PASOS.map(p => {
          const e = estados[p.n]
          const activo = paso === p.n
          return (
            <li key={p.n}>
              <button
                type="button"
                onClick={() => onPaso(p.n)}
                aria-current={activo ? 'step' : undefined}
                data-paso={p.n}
                data-tono={e.tono}
                className={`flex w-full items-start gap-2.5 rounded-[10px] border px-2.5 py-2 text-left max-sm:flex-col max-sm:gap-1 max-sm:px-1.5 ${activo ? 'border-[#B9D3C8] bg-[#EAF1EE]' : 'border-transparent hover:bg-[#F8F7F3]'}`}
              >
                <span
                  className={`grid h-[26px] w-[26px] shrink-0 place-items-center rounded-full border-[1.5px] text-[13px] font-bold ${
                    e.tono === 'hecho'
                      ? 'border-[#0E5C43] bg-[#0E5C43] text-white'
                      : e.tono === 'error'
                        ? 'border-[#B3382C] text-[#B3382C]'
                        : e.tono === 'ambar'
                          ? 'border-[#9A5F0C] text-[#9A5F0C]'
                          : activo ? 'border-[#0E5C43] text-[#0E5C43]' : 'border-[#CFCAC0] text-[#6E6A62]'
                  }`}
                  aria-hidden
                >
                  {e.tono === 'hecho' ? '✓' : e.tono === 'error' ? '!' : p.n}
                </span>
                <span className="min-w-0">
                  <b className="block text-sm text-[#191713] max-sm:text-[13px]">{p.titulo}</b>
                  <span className="block text-xs text-[#6E6A62] max-sm:hidden">{p.que}</span>
                  <span className={`mt-0.5 block text-xs font-semibold ${COLOR[e.tono]}`} data-estado-paso>{e.texto}</span>
                </span>
              </button>
            </li>
          )
        })}
      </ol>
      <div className="mt-2 flex flex-wrap items-center gap-2 border-t border-[#E2DED5] px-1.5 pb-0.5 pt-2 text-[13px]" data-sigue>
        <span className="font-bold text-[#0E5C43]">Sigue:</span>
        <span className="min-w-0 flex-1 text-[#191713]">{sigue.texto}</span>
        {sigue.boton && (
          <button
            type="button"
            onClick={onSigue}
            className="ml-auto shrink-0 rounded-lg border border-[#0E5C43] bg-[#0E5C43] px-2.5 py-1 text-xs font-semibold text-white hover:bg-[#1C7D5E]"
          >
            {sigue.boton}
          </button>
        )}
      </div>
    </nav>
  )
}
