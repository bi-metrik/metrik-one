/**
 * «Falta la autorización de datos» arriba de la ficha del negocio (reunión con Trappvel del
 * 2026-10-22, L789-793). Desde ese día la autorización ya no frena armar la cotización: frena
 * ENVIARLA y todo lo que viene después (`autorizacion-datos/envio.ts`). Mientras falte, el negocio
 * lo dice aquí, a la vista, para que nadie se entere en el último clic.
 *
 * Sin estado ni efectos: lo pinta el servidor (`vista-negocio.tsx`).
 */
export function AvisoAutorizacionPendiente() {
  return (
    <div
      role="status"
      className="mb-3 flex flex-col gap-1 rounded-xl border border-[#F0D9B5] bg-[#FBF1E2] px-3 py-2.5 text-[13px] text-[#191713]"
      data-aviso-autorizacion-pendiente
    >
      <b className="text-[#9A5F0C]">Falta la autorización de datos del cliente</b>
      <span>
        Puedes armar y revisar la cotización. No se puede enviar al cliente, aprobar ni seguir a reservas y cobros hasta que el cliente autorice.
      </span>
      <span className="text-xs text-[#6E6A62]">El link está en el bloque «Autorización de datos»: cópialo o envíalo por correo.</span>
    </div>
  )
}
