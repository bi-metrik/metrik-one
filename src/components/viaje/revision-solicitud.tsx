'use client'

/**
 * Pieza 3 de la solicitud sin formulario (Noor, §2.2): revisar, no llenar. Una lista de lectura
 * (rótulo · valor). Un valor sugerido lleva la marca y «Confirmar»; un conflicto, la fila en
 * ámbar con «Usar …» / «Dejar …»; tocar un valor lo vuelve el campo en su sitio (Enter o salir
 * guarda, Esc cancela). Los vacíos que no son del mínimo van en «Más datos (n)». La historia del
 * cliente va al final, plegada.
 */

import { useState } from 'react'
import { cumplePedirSi } from '@/lib/negocios/niveles-solicitud'
import { textoConflicto, textoSugerido, type MarcaConflicto, type MarcaSugerido } from '@/lib/negocios/sugeridos'
import MarcaSugeridoChip from '@/app/(app)/negocios/[id]/bloques/marca-sugerido'
import { BTN, INPUT_DUDOSO, LINK } from './estilo'
import { legibleCampo, RespuestaCampo, vacio, type CampoSolicitud } from './solicitud-campo'
import { TEXTOS, textoConfirmarTodos, textoMasDatos } from '@/lib/negocios/solicitud-texto'

export interface HistoriaCliente {
  texto: string
  en: string | null
}

function Fila({
  campo,
  valores,
  sugerido,
  conflicto,
  editable,
  onGuardar,
  onConfirmar,
  onDejar,
}: {
  campo: CampoSolicitud
  valores: Record<string, unknown>
  sugerido?: MarcaSugerido
  conflicto?: MarcaConflicto
  editable: boolean
  onGuardar: (slug: string, v: unknown) => void
  onConfirmar: (slug: string) => void
  onDejar: (slug: string) => void
}) {
  const [editando, setEditando] = useState(false)
  const [verFrase, setVerFrase] = useState(false)
  const valor = valores[campo.slug]
  const legible = legibleCampo(campo, valor)
  // Un campo suma (pasajeros) no se digita: se calcula.
  const calculado = Array.isArray(campo.suma_de) && campo.suma_de.length > 0
  const puedeEditar = editable && !calculado

  if (conflicto) {
    const dicho = legibleCampo(campo, conflicto.valor)
    return (
      <li className="px-3 py-2" data-fila-conflicto={campo.slug}>
        <p className="text-[12px] text-[#6E6A62]">{campo.label ?? campo.slug}</p>
        <div className={`${INPUT_DUDOSO} mt-1 space-y-1.5`}>
          <p className="text-[13px]">{`En ONE: ${legible}. ${textoConflicto(dicho, conflicto)}.`}</p>
          {editable && (
            <div className="flex flex-wrap gap-1.5">
              <button type="button" className={BTN} onClick={() => onGuardar(campo.slug, conflicto.valor)}>{`Usar ${dicho}`}</button>
              <button type="button" className={BTN} onClick={() => onDejar(campo.slug)}>{`Dejar ${legible}`}</button>
            </div>
          )}
        </div>
      </li>
    )
  }

  return (
    <li className="grid grid-cols-1 gap-x-3 gap-y-0.5 px-3 py-2 sm:grid-cols-[minmax(8rem,14rem)_1fr]" data-fila={campo.slug}>
      <div className="flex items-center justify-between gap-2 sm:justify-start">
        <span className="text-[12px] text-[#6E6A62]">{campo.label ?? campo.slug}</span>
        {sugerido && (
          <span className="sm:hidden">
            <MarcaSugeridoChip marca={sugerido} onTocar={() => setVerFrase(v => !v)} onConfirmar={editable ? () => onConfirmar(campo.slug) : undefined} />
          </span>
        )}
      </div>
      <div className="flex min-w-0 flex-wrap items-center gap-2">
        {editando ? (
          <div className="w-full">
            <RespuestaCampo
              campo={campo}
              valor={valor}
              valores={valores}
              autoFocus
              onGuardar={v => { setEditando(false); onGuardar(campo.slug, v) }}
              onCancelar={() => setEditando(false)}
            />
          </div>
        ) : puedeEditar ? (
          <button type="button" className="min-w-0 text-left text-[13px] font-semibold text-[#191713] hover:underline" onClick={() => setEditando(true)}>
            {legible}
          </button>
        ) : (
          <span className="text-[13px] font-semibold text-[#191713]">{legible}</span>
        )}
        {sugerido && !editando && (
          <span className="hidden sm:inline-flex">
            <MarcaSugeridoChip marca={sugerido} onTocar={() => setVerFrase(v => !v)} onConfirmar={editable ? () => onConfirmar(campo.slug) : undefined} />
          </span>
        )}
      </div>
      {sugerido && verFrase && <p className="text-[12px] text-[#6E6A62] sm:col-start-2">{textoSugerido(sugerido)}</p>}
    </li>
  )
}

export default function RevisionSolicitud({
  fields,
  valores,
  sugeridos,
  conflictos,
  historias,
  editable,
  onGuardar,
  onConfirmar,
  onConfirmarTodos,
  onDejar,
}: {
  fields: CampoSolicitud[]
  valores: Record<string, unknown>
  sugeridos: Record<string, MarcaSugerido>
  conflictos: Record<string, MarcaConflicto>
  historias: HistoriaCliente[]
  editable: boolean
  onGuardar: (slug: string, v: unknown) => void
  onConfirmar: (slug: string) => void
  onConfirmarTodos: (slugs: string[]) => void
  onDejar: (slug: string) => void
}) {
  const [verMas, setVerMas] = useState(false)
  const [verHistoria, setVerHistoria] = useState(false)

  const aplica = (f: CampoSolicitud) => cumplePedirSi(f.pedir_si, valores)
  const visibles = fields.filter(f => !vacio(valores[f.slug]) || !!conflictos[f.slug] || (f.nivel === 'minimo' && aplica(f)))
  const mas = fields.filter(f => !visibles.includes(f))
  const pendientes = Object.keys(sugeridos).filter(s => fields.some(f => f.slug === s))

  const fila = (f: CampoSolicitud) => (
    <Fila
      key={f.slug}
      campo={f}
      valores={valores}
      sugerido={sugeridos[f.slug]}
      conflicto={conflictos[f.slug]}
      editable={editable}
      onGuardar={onGuardar}
      onConfirmar={onConfirmar}
      onDejar={onDejar}
    />
  )

  return (
    <div className="space-y-2" data-revision-solicitud>
      {editable && pendientes.length >= 2 && (
        <button type="button" className={LINK} onClick={() => onConfirmarTodos(pendientes)}>{textoConfirmarTodos(pendientes.length)}</button>
      )}
      <ul className="divide-y divide-[#E2DED5] rounded-lg border border-[#E2DED5] bg-white">
        {visibles.map(fila)}
        {verMas && mas.map(fila)}
      </ul>
      {mas.length > 0 && (
        <button type="button" className={LINK} onClick={() => setVerMas(v => !v)}>{verMas ? 'Menos datos' : textoMasDatos(mas.length)}</button>
      )}
      {historias.length > 0 && (
        <div>
          <button type="button" className={LINK} onClick={() => setVerHistoria(v => !v)}>{TEXTOS.loQueDijo}</button>
          {verHistoria && (
            <div className="mt-1.5 space-y-2 rounded-lg border border-[#E2DED5] bg-[#F8F7F3] px-3 py-2">
              {historias.map((h, i) => <p key={i} className="whitespace-pre-line text-[13px] text-[#191713]">{h.texto}</p>)}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
