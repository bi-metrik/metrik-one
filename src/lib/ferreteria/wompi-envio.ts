/** La dirección de envío de un pago de Wompi. Sin imports de servidor: la pinta la pestaña. */
export interface EnvioWompi {
  direccion: string | null
  direccion2: string | null
  ciudad: string | null
  region: string | null
  pais: string | null
  telefono: string | null
  nombre: string | null
}

/** Una línea legible de la dirección de envío. */
export function direccionEnvio(envio: EnvioWompi | null): string | null {
  if (!envio) return null
  const partes = [envio.direccion, envio.direccion2, envio.ciudad, envio.region].filter((x): x is string => !!x)
  return partes.length > 0 ? partes.join(', ') : null
}
