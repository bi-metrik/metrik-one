/**
 * H10-1 (QA de punta a punta del 2026-10-29, viaje 10): el cliente pidió otra versión con el
 * negocio ya en Seguimiento. ONE dejó armar toda la v2 sin decir que ya había una enviada, y al
 * final no la dejó salir («Ya hay una cotización enviada»).
 *
 * Ahora lo dice DESDE QUE SE ABRE la versión nueva, arriba del editor, y dice qué va a pasar: al
 * enviarla, la enviada queda rechazada y esta sale en su lugar (`decidirEnvioConOtraEnviada`).
 * Sin estado: lo pinta el editor con lo que leyó la página.
 */
export function AvisoVersionNueva({ consecutivo }: { consecutivo: string | null }) {
  const cual = consecutivo ? `la ${consecutivo}` : 'otra cotización'
  return (
    <div
      role="status"
      className="mb-3 flex flex-col gap-1 rounded-xl border border-[#F0D9B5] bg-[#FBF1E2] px-3 py-2.5 text-[13px] text-[#191713]"
      data-aviso-version-nueva
    >
      <b className="text-[#9A5F0C]">Ya está enviada {cual}: esta es una versión nueva</b>
      <span>Al enviar esta, {cual} queda rechazada y esta sale en su lugar. Mientras tanto, el cliente sigue teniendo {cual}.</span>
    </div>
  )
}

/** El texto de la confirmación de envío cuando la versión reemplaza a otra. */
export function textoReemplazo(consecutivo: string | null): string {
  return ` ${consecutivo ? `La ${consecutivo}` : 'La cotización enviada'} queda rechazada: esta la reemplaza.`
}
