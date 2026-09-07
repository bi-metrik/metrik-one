// Pruebas del criterio que decide si el lead declaró persona natural o jurídica.
//
// ⚠️ De esto sale el ROL del contacto. Un fallo aquí no da error: el contacto
// nace sin rol y nadie se entera — es exactamente lo que pasó entre finales de
// julio y el 2026-09-07, con 572 contactos afectados.
//
// Los cuatro valores de abajo NO son inventados: son los únicos cuatro que llegan
// en producción, medidos el 2026-09-07 sobre las 803 interacciones de Meta del
// workspace de SOENA (799 traen el campo; 4 vienen de un formulario que no
// pregunta el tipo de persona).
//
//     persona_natural   632   formulario vigente
//     natural           129   formulario de julio
//     persona_jurídica   32   formulario vigente
//     jurídica            6   formulario de julio
//
// ## Contra la implementacion vieja (medido, no recordado)
//
// Los cuatro valores reales mas el ambiguo y el vacio se corrieron contra el
// criterio que este PR reemplaza —igualdad exacta contra `natural_value =
// 'natural'`— y **caen 3 de 6**: `persona_natural` (que era el defecto) y las
// DOS de juridica. El viejo no sabia decir 'juridica': devolvia el mismo `false`
// para "es juridica" y para "no se pudo leer", y por eso el defecto era mudo.
// Las que pasaban eran `natural` (el unico valor que la igualdad acertaba), el
// ambiguo y el vacio.
//
// Sobre las 799 interacciones con el campo, **el criterio viejo acertaba en 129**
// (las del formulario de julio) y este acierta en las 799.
//
// ## Mutaciones probadas contra ESTA implementacion (2026-09-07)
//
//   · natural y juridica invertidos                     caen 8 de 11
//   · quitar `sinTildes`                                caen 6 de 11
//   · `includes('natural')` -> `startsWith('natural')`  caen 4 de 11
//   · quitar el corte del ambiguo                       cae  1 de 11
//   · `includes('jurid')` -> `includes('juridica')`     cae  1 de 11
//   · quitar la guarda `if (!v) return null`            caen 0 de 11
//
// Las dos ultimas merecen explicacion, y son las que ensenan algo:
//
//   · acortar el fragmento a `juridica` NO tumbaba ninguna en la primera pasada.
//     No sobraba una mutacion: faltaba una prueba. El fragmento es corto a
//     proposito para cubrir `juridico` y `juridicas`, y nada lo fijaba. Se agrego
//     la prueba de genero y numero, y ahora cae.
//   · quitar la guarda del vacio sigue sin tumbar ninguna, y se deja escrito en
//     vez de inventarle una prueba: con la cadena vacia los dos `includes` dan
//     `false` y el flujo cae igual al `return null` del final. La guarda es
//     legibilidad, no comportamiento observable; una prueba para cubrirla
//     estaria fijando un detalle interno.
import { describe, expect, it } from 'vitest';
import { decidirTipoPersona } from './tipo-persona';

describe('decidirTipoPersona — los cuatro valores que llegan de verdad', () => {
  it('persona_natural (formulario vigente, 632 de 799) es natural', () => {
    expect(decidirTipoPersona('persona_natural')).toBe('natural');
  });

  it('natural (formulario de julio, 129 de 799) es natural', () => {
    expect(decidirTipoPersona('natural')).toBe('natural');
  });

  it('persona_jurídica (formulario vigente, 32 de 799) es jurídica', () => {
    expect(decidirTipoPersona('persona_jurídica')).toBe('juridica');
  });

  it('jurídica (formulario de julio, 6 de 799) es jurídica', () => {
    expect(decidirTipoPersona('jurídica')).toBe('juridica');
  });
});

describe('decidirTipoPersona — lo que no se puede decidir', () => {
  it('un valor que menciona las dos no se decide: inventar el rol es peor que no ponerlo', () => {
    expect(decidirTipoPersona('persona natural o jurídica')).toBeNull();
    expect(decidirTipoPersona('persona_natural_o_jurídica')).toBeNull();
  });

  it('el vacío, el blanco y la ausencia no se deciden', () => {
    expect(decidirTipoPersona('')).toBeNull();
    expect(decidirTipoPersona('   ')).toBeNull();
    expect(decidirTipoPersona(null)).toBeNull();
    expect(decidirTipoPersona(undefined)).toBeNull();
  });

  it('un valor que no menciona ninguna de las dos no se decide', () => {
    // El día que Meta cambie las respuestas a "empresa" / "particular", esto
    // devuelve null y el webhook lo grita, en vez de asumir natural.
    expect(decidirTipoPersona('empresa')).toBeNull();
    expect(decidirTipoPersona('sociedad')).toBeNull();
  });
});

describe('decidirTipoPersona — la forma del valor no debe importar', () => {
  it('ignora tildes, mayúsculas y espacios de sobra', () => {
    expect(decidirTipoPersona('  PERSONA_JURIDICA  ')).toBe('juridica');
    expect(decidirTipoPersona('Persona Natural')).toBe('natural');
    expect(decidirTipoPersona('JURÍDICA')).toBe('juridica');
  });

  it('reconoce juridica sin tilde, y en las dos formas Unicode', () => {
    // 'i' con tilde precompuesta (U+00ED) y descompuesta (i + U+0301) son la
    // misma palabra para quien la escribe y dos cadenas DISTINTAS para
    // JavaScript; Meta no garantiza cual manda. La descompuesta se arma con el
    // escape a proposito: escrita literal es un caracter invisible en el diff y
    // la prueba no se podria revisar (mismo criterio que el rango de `sinTildes`).
    const descompuesta = 'juri\u0301dica';
    expect(descompuesta).not.toBe('jur\u00eddica'); // que la prueba pruebe algo
    expect(decidirTipoPersona(descompuesta)).toBe('juridica');
    expect(decidirTipoPersona('juridica')).toBe('juridica');
  });

  it('reconoce las variantes de genero y numero de juridica', () => {
    // El fragmento es `jurid` y no `juridica` a proposito: `\u00bfel comprador es
    // una persona juri\u0301dica?` puede llegar tambien como `juri\u0301dico` o
    // `juri\u0301dicas` segun como redacten la respuesta, y el fragmento corto las
    // cubre las tres. Sin esta prueba, acortar el fragmento a `juridica` no
    // tumbaba ninguna (medido con mutacion el 2026-09-07).
    expect(decidirTipoPersona('persona juri\u0301dico')).toBe('juridica');
    expect(decidirTipoPersona('personas juri\u0301dicas')).toBe('juridica');
  });

  it('aguanta el relleno con guiones bajos que ya traía el criterio anterior', () => {
    expect(decidirTipoPersona('persona_natural___')).toBe('natural');
  });
});
