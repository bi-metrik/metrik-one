'use client'

import { CAUSAS_CORRECCION, OPCION_CAUSA, type CausaCorreccion } from '@/lib/correcciones/causas'

/**
 * Pregunta por qué se corrige, en un clic, ANTES de dejar editar.
 *
 * Se pregunta antes y no al guardar porque el guardado de un bloque de datos es un
 * autosave: para cuando hubiera algo que preguntar, el dato ya viajó. Y es de un
 * clic, sin texto libre, porque un campo obligatorio de escritura se llena con
 * cualquier cosa y deja de servir para agregar.
 */
export default function SelectorCausa({
  onElegir,
  onCancelar,
}: {
  onElegir: (causa: CausaCorreccion) => void
  onCancelar: () => void
}) {
  return (
    <div className="mt-1 space-y-2 rounded-lg border border-[#FDE68A] bg-[#FFFBEB] p-2.5">
      <p className="text-[11px] font-medium text-[#92400E]">¿Por qué se corrige?</p>
      <div className="flex flex-wrap gap-1.5">
        {CAUSAS_CORRECCION.map(c => (
          <button
            key={c}
            type="button"
            onClick={() => onElegir(c)}
            className="rounded-md border border-[#FDE68A] bg-white px-2 py-1 text-[11px] font-medium text-[#92400E] hover:bg-[#FEF3C7] transition-colors"
          >
            {OPCION_CAUSA[c]}
          </button>
        ))}
        <button
          type="button"
          onClick={onCancelar}
          className="rounded-md px-2 py-1 text-[11px] text-[#92400E]/70 hover:text-[#92400E] transition-colors"
        >
          Cancelar
        </button>
      </div>
    </div>
  )
}
