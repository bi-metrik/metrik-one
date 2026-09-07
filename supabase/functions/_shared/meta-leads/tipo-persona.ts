// ============================================================
// Qué declaró el lead: persona natural o jurídica
// ------------------------------------------------------------
// ## Por qué existe
//
// El webhook decidía el tipo de persona con IGUALDAD EXACTA contra un valor de
// configuración (`config_extra.meta_leads.contacto.natural_value`, que en SOENA
// vale `"natural"`):
//
//     tipoPersona.trim().toLowerCase().replace(/_+$/, '') === natural_value
//
// A finales de julio de 2026 Meta cambió el formulario y el valor pasó a llegar
// como `persona_natural`. La igualdad da falso, `contactoRol` queda en `null`, y
// el contacto **nace sin rol**. No hay error: el lead entra, el contacto se crea,
// y lo único que falta es un campo que nadie mira hasta que alguien pregunta por
// qué el directorio está lleno de contactos sin rol. Estuvo así mes y medio y
// alcanzó a **572 contactos**, ya saneados a mano.
//
// El defecto no era el CONTENIDO de `natural_value`, era comparar por igualdad un
// valor que lo escribe otra persona en otra herramienta. Corregir la constante
// habría durado hasta el siguiente cambio de formulario.
//
// ## Los valores reales (medidos en producción el 2026-09-07, 803 interacciones)
//
//     persona_natural   632   el formulario vigente
//     natural           129   el formulario de julio
//     persona_jurídica   32   el formulario vigente
//     jurídica            6   el formulario de julio
//
// No llega ningún otro valor, y ninguno es ambiguo. Los cuatro los decide este
// criterio; la igualdad exacta solo acertaba con `natural` (129 de 799).
//
// ## Dos copias deliberadas del mismo criterio
//
// La regla de abajo es la MISMA que `detectarTipoPersona` de
// `src/lib/contactos/campos-formulario.ts`, que la usa la ficha del contacto para
// sugerir el tipo de persona al crear el negocio. **No se comparte código a
// propósito**: esta copia corre en Deno dentro de una edge function y no puede
// importar de `src/`, que es código de Next. Lo que se comparte es el criterio,
// escrito dos veces:
//
//   · el valor menciona `natural` y no `jurid`  → natural
//   · menciona `jurid` y no `natural`           → jurídica
//   · menciona las dos, o ninguna               → no se decide
//
// El riesgo de dos copias es que se separen. Se acepta con los ojos abiertos
// porque la alternativa —una tercera capa que sirva a los dos runtimes— cuesta
// más que la regla, y porque cada copia tiene su prueba con **los mismos cuatro
// valores reales**: si alguien cambia una sola, las de la otra siguen fijando el
// criterio viejo y la diferencia se ve al leer. Si aparece una tercera copia, ahí
// sí toca sacar la regla a SQL, que es lo que ya hizo este repo con
// `email_cliente_negocio` cuando sus consumidores quedaron en runtimes distintos.
//
// ## Por qué el ambiguo NO se decide
//
// Un valor que menciona las dos cosas es el de quien responde con la etiqueta
// entera de la pregunta (`persona natural o jurídica`). Ahí no hay respuesta que
// leer, y elegir una de las dos es inventarla: el rol del contacto sale de esto,
// y un `decisor` inventado es peor que un contacto sin rol, porque el segundo se
// ve y el primero no. Hoy no llega ninguno; el día que llegue, el `console.warn`
// del webhook lo delata el primer día en vez del mes y medio que costó esta vez.
// ============================================================

/** Lo que el lead declaró, o `null` si no se puede decidir sin inventar. */
export type TipoPersona = 'natural' | 'juridica';

/**
 * Quita tildes y baja a minúsculas. La ñ se descompone a n, que es lo que se
 * quiere.
 *
 * El rango va escapado (`\u0300-\u036f`) y no con los caracteres literales: un
 * combinante dentro del archivo es invisible al revisar el PR, así que no se
 * puede comprobar que el rango sea el que dice ser. Mismo criterio que ya usa
 * `campos-formulario.ts` en `src/`, y la misma lección que dejó escrita la
 * migración de teléfonos con `chr(160)`.
 */
function sinTildes(v: string): string {
  return v.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
}

/**
 * Decide el tipo de persona a partir del valor que llegó en el formulario.
 *
 * Por SUBCADENA, sin tildes y en minúsculas: así el prefijo `persona_` deja de
 * importar y `jurídica` se reconoce con o sin tilde. Devuelve `null` cuando el
 * valor está vacío, cuando no menciona ninguna de las dos, y cuando menciona las
 * dos — ver el encabezado.
 */
export function decidirTipoPersona(valor: string | null | undefined): TipoPersona | null {
  const v = sinTildes((valor ?? '').trim());
  if (!v) return null;
  const natural = v.includes('natural');
  const juridica = v.includes('jurid');
  if (natural && juridica) return null;
  if (juridica) return 'juridica';
  if (natural) return 'natural';
  return null;
}
