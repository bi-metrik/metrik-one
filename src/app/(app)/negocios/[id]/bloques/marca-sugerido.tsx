/**
 * «Sugerido»: el valor lo escribió el paso de entendimiento a partir de lo que un comercial
 * reenvió por WhatsApp, y ninguna persona lo ha confirmado. Al pasar el cursor se ve la frase
 * del mensaje que lo sostiene. «Confirmar» quita la marca y deja el valor; cambiar el valor
 * también la quita (lo hace el servidor al guardar). Ver `lib/negocios/sugeridos.ts`.
 */
export default function MarcaSugerido({
  frase,
  onConfirmar,
}: {
  frase?: string
  /** Sin él (modo solo lectura) se muestra la marca sin el botón. */
  onConfirmar?: () => void
}) {
  const titulo = frase ? `Sugerido desde WhatsApp: «${frase}»` : 'Sugerido desde WhatsApp'
  return (
    <span className="inline-flex items-center gap-1" data-marca-sugerido>
      <span
        title={titulo}
        className="rounded bg-[#EEF2FF] px-1 py-px text-[8px] font-medium uppercase tracking-wide text-[#4338CA]"
      >
        Sugerido
      </span>
      {onConfirmar && (
        <button
          type="button"
          onClick={onConfirmar}
          className="rounded px-1 py-px text-[9px] font-medium text-[#4338CA] hover:bg-[#EEF2FF]"
        >
          Confirmar
        </button>
      )}
    </span>
  )
}
