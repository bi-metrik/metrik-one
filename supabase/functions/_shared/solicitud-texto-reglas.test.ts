import { describe, expect, it } from 'vitest';
import {
  esMarcaDeChat,
  filasDelResumen,
  partirPegado,
  preguntasDeGuardianes,
  textoCargado,
  textoCruceWeb,
  textoDosViajesWeb,
  textoNadaNuevo,
} from './solicitud-texto-reglas.ts';

/** Ejemplos inventados: ningún texto sale de un cliente real. */

describe('partirPegado', () => {
  it('un chat copiado de WhatsApp Web se parte por sus marcas y conserva quién habla', () => {
    const chat = [
      '[2/10/26, 10:32] Lucía Prueba: Hola, queremos ir a Lisboa en marzo',
      '[2/10/26, 10:33] Agencia Prueba: ¡Hola Lucía! ¿Cuántos viajan?',
      '[2/10/26, 10:35] Lucía Prueba: Somos dos adultos',
      'mi papá tiene 72',
    ].join('\n');
    expect(partirPegado(chat, 'cliente')).toEqual([
      { cuerpo: 'Lucía Prueba: Hola, queremos ir a Lisboa en marzo', reenviado: true },
      { cuerpo: 'Agencia Prueba: ¡Hola Lucía! ¿Cuántos viajan?', reenviado: true },
      { cuerpo: 'Lucía Prueba: Somos dos adultos\nmi papá tiene 72', reenviado: true },
    ]);
  });

  it('también el formato con la hora primero y el del chat exportado', () => {
    expect(esMarcaDeChat('[10:32, 2/10/2026] Lucía: hola')).toBe(true);
    expect(esMarcaDeChat('2/10/26, 10:32 - Lucía: hola')).toBe(true);
    expect(esMarcaDeChat('2/10/26, 10:32 p. m. - Lucía: hola')).toBe(true);
    const exportado = '2/10/26, 10:32 - Lucía: Lisboa\n2/10/26, 10:40 - Lucía: en marzo';
    expect(partirPegado(exportado, 'cliente').map(m => m.cuerpo)).toEqual(['Lucía: Lisboa', 'Lucía: en marzo']);
  });

  it('un correo o unas notas son UN mensaje; «Son mis notas» no es reenviado', () => {
    const correo = 'Buenos días,\n\nQueremos cotizar Lisboa para marzo, 10 días.\n\nGracias, Lucía';
    expect(partirPegado(correo, 'cliente')).toEqual([{ cuerpo: correo, reenviado: true }]);
    expect(partirPegado('Lucía, Lisboa en marzo, ella y el papá de 72', 'notas')).toEqual([
      { cuerpo: 'Lucía, Lisboa en marzo, ella y el papá de 72', reenviado: false },
    ]);
  });

  it('una sola marca no basta para leerlo como chat (una fecha suelta en un correo no lo parte)', () => {
    const t = '[2/10/26, 10:32] Lucía: hola\nsigo en el mismo mensaje';
    expect(partirPegado(t, 'cliente')).toHaveLength(1);
  });

  it('sin texto no hay mensajes', () => {
    expect(partirPegado('   \n ', 'cliente')).toEqual([]);
  });
});

const FIELDS = [
  { slug: 'destino', tipo: 'texto', label: 'Destino', nivel: 'minimo', pregunta: '¿A dónde quieren viajar?' },
  { slug: 'fecha_salida', tipo: 'fecha', label: 'Salida', nivel: 'minimo', pregunta: '¿Qué día salen?' },
  { slug: 'adultos', tipo: 'numero', label: 'Adultos', nivel: 'minimo', pregunta: '¿Cuántos adultos?' },
  { slug: 'hotel', tipo: 'select', label: 'Hotel', nivel: 'minimo', opciones: [{ value: '4', label: '4 estrellas' }] },
] as never[];

describe('filasDelResumen', () => {
  const sug = {
    destino: { valor: 'Lisboa', frase: 'ir a Lisboa' },
    fecha_salida: { valor: '2027-03-14', frase: 'salimos el 14 de marzo' },
    adultos: { valor: 2, frase: 'ella y el papá' },
    hotel: { valor: '4', frase: 'cuatro estrellas' },
  };

  it('negocio nuevo: todo es nuevo, legible y con su frase, en el orden de la config', () => {
    const f = filasDelResumen(FIELDS, sug);
    expect(f.map(x => [x.slug, x.grupo, x.legible])).toEqual([
      ['destino', 'nuevo', 'Lisboa'], ['fecha_salida', 'nuevo', '14 mar'], ['adultos', 'nuevo', '2'], ['hotel', 'nuevo', '4 estrellas'],
    ]);
    expect(f[2].frase).toBe('ella y el papá');
  });

  it('negocio existente: nuevo, choca (con lo que hay) y ya estaba; lo sin sustento no se ofrece', () => {
    const f = filasDelResumen(FIELDS, sug, {
      escritos: ['hotel'],
      actualizados: [],
      conflictos: [{ slug: 'fecha_salida', actual: '2027-03-12', valor: '2027-03-14', frase: 'salimos el 14 de marzo' }],
      iguales: ['destino'],
    });
    expect(f.map(x => [x.slug, x.grupo, x.actual ?? null])).toEqual([
      ['destino', 'ya_estaba', null], ['fecha_salida', 'choca', '12 mar'], ['hotel', 'nuevo', null],
    ]);
  });
});

describe('preguntas de los guardianes', () => {
  it('la fecha sin día se pregunta con la frase; la de C9 va tal cual', () => {
    const p = preguntasDeGuardianes(FIELDS, [
      { slug: 'fecha_salida', motivo: 'un mes o una ventana no es una fecha: «en marzo» no nombra el día 1' },
      { slug: 'adultos', motivo: 'C9', pregunta: 'Dijeron «mi bebé de 18»: ¿viaja como bebé en brazos o con su propio cupo?' },
      { slug: 'hotel', motivo: 'fuera de las opciones: 7' },
    ]);
    expect(p).toEqual([
      { slug: 'fecha_salida', texto: 'No cargué la fecha: «en marzo» no dice el día. ¿Qué día salen?' },
      { slug: 'adultos', texto: 'Dijeron «mi bebé de 18»: ¿viaja como bebé en brazos o con su propio cupo?' },
    ]);
  });
});

describe('textos de la pantalla', () => {
  it('los de Noor', () => {
    expect(textoCargado(4, 3)).toBe('Cargué 4 datos. Faltan 3 para cotizar.');
    expect(textoCargado(1, 0)).toBe('Cargué 1 dato. Lista para cotizar.');
    expect(textoNadaNuevo('LISBOA MAR')).toBe('No encontré datos nuevos para LISBOA MAR.');
    expect(textoCruceWeb([{ que: 'destino', enNegocio: 'Lisboa', enMensajes: 'Cancún' }], 'LISBOA MAR'))
      .toBe('Esto parece de otro viaje: aquí dice Cancún y este es LISBOA MAR.');
    expect(textoDosViajesWeb([
      { cliente: null, destino: 'Lisboa mar', frase: 'a' },
      { cliente: null, destino: 'Cancún dic', frase: 'b' },
    ])).toBe('Veo dos solicitudes distintas (Lisboa mar · Cancún dic). No las mezclo. Pega cada una por separado.');
  });
});
