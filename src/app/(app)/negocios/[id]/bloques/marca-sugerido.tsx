/**
 * «Sugerido»: el valor lo escribió el paso de entendimiento a partir de lo que un comercial
 * reenvió por WhatsApp, y ninguna persona lo ha confirmado. Al pasar el cursor se ve la frase
 * del mensaje que lo sostiene. «Confirmar» quita la marca y deja el valor; cambiar el valor
 * también la quita (lo hace el servidor al guardar). Ver `lib/negocios/sugeridos.ts`.
 */
import { textoSugerido, type MarcaSugerido as Marca } from '@/lib/negocios/sugeridos'

export default function MarcaSugerido({
  marca,
  onConfirmar,
  onTocar,
}: {
  /** La marca: frase o deducción, y el valor anterior si reemplazó otro sugerido. */
  marca?: Marca
  /** Sin él (modo solo lectura) se muestra la marca sin el botón. */
  onConfirmar?: () => void
  /**
   * Tocar la marca (celular: nada depende de pasar el cursor). La revisión de la solicitud lo
   * usa para mostrar la frase debajo. Sin él, la marca es solo texto con su `title`.
   */
  onTocar?: () => void
}) {
  const titulo = textoSugerido(marca)
  const clase = 'rounded bg-[#EEF2FF] px-1 py-px text-[8px] font-medium uppercase tracking-wide text-[#4338CA]'
  return (
    <span className="inline-flex items-center gap-1" data-marca-sugerido>
      {onTocar ? (
        <button type="button" title={titulo} onClick={onTocar} className={clase}>
          Sugerido
        </button>
      ) : (
        <span title={titulo} className={clase}>
          Sugerido
        </span>
      )}
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
