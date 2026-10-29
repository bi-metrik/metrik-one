'use client'

import { LISTA_VACIA, type DestinoDeIr, type ListaUnica, type RenglonDeLista } from '@/lib/cotizaciones/lista-unica'

/**
 * La lista única de «Revisar y enviar» (C6, decisión 7): arriba del documento, en dos grupos.
 * «Impide enviar» en rojo y «Revisa antes de enviar» en ámbar; cada renglón con su «Ir». Sin nada:
 * «Nada impide enviar y no hay nada por revisar.»
 */
export function ListaUnicaPorPasos({ lista, onIr }: { lista: ListaUnica; onIr: (d: DestinoDeIr) => void }) {
  if (lista.impide.length === 0 && lista.revisar.length === 0) {
    return <p className="m-0 rounded-xl border border-[#CFE3DA] bg-[#EAF1EE] p-3 text-[13px] font-semibold text-[#0E5C43]" data-lista-vacia>{LISTA_VACIA}</p>
  }
  const renglon = (r: RenglonDeLista, rojo: boolean) => (
    <li key={r.clave} className="flex flex-wrap items-start gap-2 border-t border-[#E2DED5] py-2 first:border-t-0" data-renglon-lista={r.clave}>
      <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${rojo ? 'bg-[#B3382C]' : 'bg-[#C98A00]'}`} aria-hidden />
      <span className="min-w-0 flex-1 text-[13px]">{r.texto}</span>
      {r.ir && (
        <button type="button" onClick={() => onIr(r.ir!)} className="text-[13px] font-semibold text-[#0E5C43] underline-offset-2 hover:underline" data-ir={r.ir.a}>
          {r.ir.a === 'poner-en-tarifa' ? `Ponerlo en la ${r.ir.tarifa}` : 'Ir'}
        </button>
      )}
    </li>
  )
  return (
    <div className="flex flex-col gap-2" data-lista-unica>
      {lista.impide.length > 0 && (
        <section className="rounded-xl border border-[#E8C4BF] bg-[#FBF1EF] px-3 py-2" aria-label="Impide enviar" data-grupo-impide>
          <h3 className="m-0 text-[13px] font-bold text-[#B3382C]">Impide enviar</h3>
          <ul className="m-0 list-none p-0">{lista.impide.map(r => renglon(r, true))}</ul>
        </section>
      )}
      {lista.revisar.length > 0 && (
        <section className="rounded-xl border border-[#EBD9B5] bg-[#FBF5EA] px-3 py-2" aria-label="Revisa antes de enviar (no bloquea)" data-grupo-revisar>
          <h3 className="m-0 text-[13px] font-bold text-[#9A5F0C]">Revisa antes de enviar (no bloquea)</h3>
          <ul className="m-0 list-none p-0">{lista.revisar.map(r => renglon(r, false))}</ul>
        </section>
      )}
    </div>
  )
}
