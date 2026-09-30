import { textoConflicto, type MarcaConflicto as Marca } from '@/lib/negocios/sugeridos'

const MESES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic']

/** Lo que dijo el mensaje, como se le dice a una persona: fechas «20 nov», opciones por su etiqueta. */
export function valorLegibleCampo(
  campo: { tipo: string; opciones?: Array<{ value: string; label?: string }> },
  valor: unknown,
): string {
  if (campo.tipo === 'fecha') {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(valor ?? ''))
    if (m) return `${Number(m[3])} ${MESES[Number(m[2]) - 1]}`
  }
  const op = campo.opciones?.find(o => String(o.value) === String(valor))
  return op?.label ?? String(valor ?? '')
}

/**
 * «El cliente dijo 20 nov en el audio del 30-sep»: la bandeja de WhatsApp cargó en un negocio
 * que ya tenía otro valor en este campo, y no lo pisó. La persona decide: «Usar» escribe el
 * valor del mensaje como cualquier edición (al guardar, la marca se va); «Dejar» conserva el
 * valor actual y quita la marca. Ver `lib/negocios/sugeridos.ts`.
 */
export default function MarcaConflicto({
  marca,
  legible,
  onUsar,
  onDejar,
}: {
  marca: Marca
  legible: string
  /** Sin ellos (modo solo lectura) se muestra el aviso sin botones. */
  onUsar?: () => void
  onDejar?: () => void
}) {
  const titulo = marca.frase ? `«${marca.frase}»` : undefined
  return (
    <span className="inline-flex flex-wrap items-center gap-1" data-marca-conflicto>
      <span
        title={titulo}
        className="rounded bg-[#FEF3C7] px-1 py-px text-[9px] font-medium text-[#92400E]"
      >
        {textoConflicto(legible, marca)}
      </span>
      {onUsar && (
        <button
          type="button"
          onClick={onUsar}
          className="rounded px-1 py-px text-[9px] font-medium text-[#92400E] hover:bg-[#FEF3C7]"
        >
          Usar
        </button>
      )}
      {onDejar && (
        <button
          type="button"
          onClick={onDejar}
          className="rounded px-1 py-px text-[9px] font-medium text-tinta-suave hover:bg-papel"
        >
          Dejar el actual
        </button>
      )}
    </span>
  )
}
