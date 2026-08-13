import { calcularDvNit } from '@/lib/dian/nit'

/**
 * Titulares que firman un documento del expediente.
 *
 * Un vehículo puede tener dos propietarios (copropiedad), y la DIAN exige que la
 * declaración juramentada y la relación de facturas las firmen LOS DOS: la cadena
 * factura → certificado → solicitud tiene que cerrar con las mismas personas. Los
 * documentos se generaban siempre con un firmante, así que en copropiedad salían
 * incompletos y había que rehacerlos a mano.
 *
 * El segundo titular es OPCIONAL en todo: un documento cuya configuración no
 * declara los campos `*_2` se arma exactamente igual que antes.
 */
export interface Titular {
  nombre: string
  /** Base limpia del documento (sin DV). El DV se calcula al mostrar. */
  identificacion: string | null
  email?: string | null
  telefono?: string | null
}

/** Los campos que un documento puede recibir por titular. */
export interface DatosTitulares {
  nombre_solicitante?: string | null
  numero_identificacion?: string | null
  email?: string | null
  telefono?: string | null
  nombre_solicitante_2?: string | null
  numero_identificacion_2?: string | null
  email_2?: string | null
  telefono_2?: string | null
}

/**
 * Lista de titulares que firman, en orden.
 *
 * El SEGUNDO existe solo si trae nombre. Un RUT cargado a medias (identificación
 * sin nombre) no puede producir una firma: quedaría una línea en blanco en un
 * documento que va a la DIAN, que es peor que no incluirla.
 *
 * El primero se devuelve siempre, aunque venga vacío, con el marcador que ya
 * usaban los documentos — así el operador ve qué falta en el PDF.
 */
export function titularesDeDatos(
  datos: DatosTitulares,
  marcadorNombre = '[NOMBRE SOLICITANTE]',
): Titular[] {
  const titulares: Titular[] = [{
    nombre: datos.nombre_solicitante?.trim() || marcadorNombre,
    identificacion: datos.numero_identificacion?.trim() || null,
    email: datos.email ?? null,
    telefono: datos.telefono ?? null,
  }]

  const nombre2 = datos.nombre_solicitante_2?.trim()
  if (nombre2) {
    titulares.push({
      nombre: nombre2,
      identificacion: datos.numero_identificacion_2?.trim() || null,
      email: datos.email_2 ?? null,
      telefono: datos.telefono_2 ?? null,
    })
  }

  return titulares
}

/**
 * NIT con dígito de verificación CALCULADO (módulo 11 de la DIAN).
 *
 * El DV es determinista y el del RUT puede venir mal extraído, así que se calcula
 * siempre sobre la base limpia. Misma decisión que ya tomaba la declaración
 * juramentada para el primer titular; aquí queda compartida para no tener dos
 * criterios sobre el mismo número.
 */
export function nitConDv(identificacion: string | null, marcador = '[NIT]'): string {
  const base = identificacion?.trim()
  if (!base) return marcador
  const dv = calcularDvNit(base)
  return dv != null ? `${base}-${dv}` : base
}

/**
 * Concordancia de número para el cuerpo del documento.
 *
 * Un documento que dice "Yo" y lo firman dos personas se contradice a sí mismo, y
 * es el texto que la DIAN lee. Las formas se devuelven juntas para que ningún
 * documento conjugue la mitad de sus frases en singular y la otra en plural.
 */
export function concordancia(cantidad: number) {
  const plural = cantidad > 1
  return {
    plural,
    yo: plural ? 'Nosotros' : 'Yo',
    // Va en SINGULAR incluso con dos firmantes: califica a cada persona por
    // separado ("ANA, identificada con NIT X, y LUIS, identificado con NIT Y").
    // El plural solo aplica al pronombre y a los verbos del cuerpo.
    identificado: 'identificado(a)',
    manifiesto: plural ? 'manifestamos' : 'manifiesto',
    declaro: plural ? 'Declaramos' : 'Declaro',
    solicitante: plural ? 'solicitantes' : 'solicitante',
    presento: plural ? 'presentamos' : 'presento',
  }
}
