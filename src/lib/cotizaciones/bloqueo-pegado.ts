/**
 * A DÓNDE VA UN PANTALLAZO PEGADO en una cotización de bloqueo (QA estricto del 2026-10-29).
 *
 * Tatiana pegó con Ctrl+V el vuelo (sin precio) de COT-2026-0007 y ONE lo rechazó: «La captura no
 * corresponde a vuelo… no el precio total del itinerario». El pegado de toda la ventana lo atrapaba
 * la bandeja y lo leía con el lector GENÉRICO, que a un vuelo le exige precio (RX4). El lector del
 * bloqueo (`PROMPT_VUELO_BLOQUEO`) solo lo recibía si la casilla «Vuelo» del paquete tenía el foco.
 *
 * Ahora, en una cotización de bloqueo, el pegado va al paquete:
 *  · con UN paquete abierto (o el último que se tocó, si hay varios abiertos), a ese;
 *  · la casilla, la que esté vacía; con las dos vacías o las dos llenas, la decide la detección
 *    (`casillaDesdeDeteccion`) y, si no reconoce, la asesora («¿Es el hotel o el vuelo?»);
 *  · sin paquete abierto, la bandeja ofrece elegir el paquete, uno nuevo, u «Otro servicio» (la
 *    lectura de siempre, para un traslado o una actividad del mismo viaje).
 *
 * El registro es el puente entre la bandeja (arriba) y las tarjetas de los paquetes (abajo): cada
 * tarjeta se registra al montarse; lo que llega para una tarjeta que todavía no está montada espera
 * en su buzón hasta que se abre.
 */

export type CasillaPaquete = 'hotel' | 'vuelo'

export interface EstadoDePaquete {
  itemId: string
  /** La tarjeta está desplegada («Ver y editar el paquete»). */
  abierto: boolean
  hotelLleno: boolean
  vueloLleno: boolean
}

export type DestinoDelPegado =
  /** `casilla: null` = las dos vacías (o llenas): la decide la detección. */
  | { a: 'paquete'; itemId: string; casilla: CasillaPaquete | null }
  | { a: 'elegir' }

/** El paquete que recibe el pegado: el activo si está abierto; si no, el único abierto. */
export function paqueteParaPegado(paquetes: readonly EstadoDePaquete[], activo: string | null): EstadoDePaquete | null {
  const abiertos = paquetes.filter(p => p.abierto)
  const elActivo = activo ? abiertos.find(p => p.itemId === activo) : undefined
  if (elActivo) return elActivo
  return abiertos.length === 1 ? abiertos[0] : null
}

/** La casilla vacía; `null` si las dos están vacías o las dos llenas. */
export function casillaParaPegado(p: Pick<EstadoDePaquete, 'hotelLleno' | 'vueloLleno'>): CasillaPaquete | null {
  if (!p.hotelLleno && p.vueloLleno) return 'hotel'
  if (p.hotelLleno && !p.vueloLleno) return 'vuelo'
  return null
}

/**
 * Lo que dijo el clasificador de capturas (`detectarTipoDeCaptura`), a la casilla del paquete. Un
 * vuelo SIN precio sigue siendo un vuelo: aquí nunca se le exige precio. Lo que no reconoce
 * (`null`, una actividad…) lo decide la asesora.
 */
export function casillaDesdeDeteccion(tipo: string | null | undefined): CasillaPaquete | null {
  if (tipo === 'vuelo') return 'vuelo'
  if (tipo === 'hotel' || tipo === 'paquete') return 'hotel'
  return null
}

export function destinoDelPegado(paquetes: readonly EstadoDePaquete[], activo: string | null): DestinoDelPegado {
  const p = paqueteParaPegado(paquetes, activo)
  return p ? { a: 'paquete', itemId: p.itemId, casilla: casillaParaPegado(p) } : { a: 'elegir' }
}

// ── El registro (sin React) ──────────────────────────────────────────────────

export interface ReceptorDePaquete {
  estado: () => EstadoDePaquete
  /** `casilla: null` = que la tarjeta decida (casilla vacía, o detección). */
  recibir: (dataUrl: string, casilla: CasillaPaquete | null) => void
}

export class RegistroDePaquetes {
  private receptores = new Map<string, ReceptorDePaquete>()
  private buzon = new Map<string, { dataUrl: string; casilla: CasillaPaquete | null }>()
  private activo: string | null = null
  private bandeja: ((dataUrl: string) => void) | null = null

  /** La bandeja se conecta para recibir lo que la tarjeta devuelve como «Otro servicio». */
  conectarBandeja(f: (dataUrl: string) => void): () => void {
    this.bandeja = f
    return () => { if (this.bandeja === f) this.bandeja = null }
  }

  /** «Otro servicio»: el pantallazo vuelve a la bandeja y lo lee la lectura de siempre. */
  aLaBandeja(dataUrl: string): boolean {
    if (!this.bandeja) return false
    this.bandeja(dataUrl)
    return true
  }

  /** La tarjeta se registra al montarse. Devuelve con qué darse de baja. */
  registrar(itemId: string, r: ReceptorDePaquete): () => void {
    this.receptores.set(itemId, r)
    const pendiente = this.buzon.get(itemId)
    if (pendiente) {
      this.buzon.delete(itemId)
      r.recibir(pendiente.dataUrl, pendiente.casilla)
    }
    return () => {
      if (this.receptores.get(itemId) === r) this.receptores.delete(itemId)
    }
  }

  /** La tarjeta que la asesora tocó por última vez: con varias abiertas, a esa va el pegado. */
  activar(itemId: string): void {
    this.activo = itemId
  }

  estados(): EstadoDePaquete[] {
    return [...this.receptores.values()].map(r => r.estado())
  }

  destino(): DestinoDelPegado {
    return destinoDelPegado(this.estados(), this.activo)
  }

  /** Lo entrega ya si la tarjeta está montada; si no, espera en su buzón. `true` = entregado ya. */
  entregar(itemId: string, dataUrl: string, casilla: CasillaPaquete | null): boolean {
    this.activo = itemId
    const r = this.receptores.get(itemId)
    if (r) {
      r.recibir(dataUrl, casilla)
      return true
    }
    this.buzon.set(itemId, { dataUrl, casilla })
    return false
  }
}
