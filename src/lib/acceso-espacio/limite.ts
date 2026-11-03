/**
 * Tope de solicitudes EN MEMORIA, por llave (correo o IP), en una ventana deslizante.
 *
 * Por qué en memoria y no en la base: el repo no tiene un limitador compartido (los topes del alta
 * de SECOP y de Valida cuentan filas de SU tabla de registros), y el encargo prohíbe crear una tabla.
 * La consecuencia hay que tenerla clara: cada instancia de Vercel lleva su propia cuenta, así que el
 * tope real es «N por instancia». Es un freno contra el clic repetido y el abuso torpe, no contra
 * un atacante distribuido. El freno que SÍ es compartido entre instancias es la llave de idempotencia
 * de Resend por correo y por ventana (`recuperar-servidor.ts`): el mismo correo no recibe más de un
 * mensaje por ventana aunque las solicitudes caigan en instancias distintas.
 */
export class LimiteEnMemoria {
  private readonly golpes = new Map<string, number[]>()

  constructor(
    private readonly tope: number,
    private readonly ventanaMs: number,
    /** Cota de llaves guardadas: una IP rotando no puede inflar la memoria sin fin. */
    private readonly maxLlaves = 5000,
  ) {}

  /** Cuenta la solicitud y dice si cabe en el tope. Una solicitud rechazada no suma. */
  permitir(llave: string, ahoraMs: number = Date.now()): boolean {
    const desde = ahoraMs - this.ventanaMs
    const previos = (this.golpes.get(llave) ?? []).filter((t) => t > desde)
    if (previos.length >= this.tope) {
      this.golpes.set(llave, previos)
      return false
    }
    previos.push(ahoraMs)
    this.golpes.delete(llave)
    this.golpes.set(llave, previos)
    // El Map conserva el orden de inserción: la primera llave es la que lleva más tiempo sin uso.
    while (this.golpes.size > this.maxLlaves) {
      const vieja = this.golpes.keys().next().value
      if (vieja === undefined) break
      this.golpes.delete(vieja)
    }
    return true
  }
}
