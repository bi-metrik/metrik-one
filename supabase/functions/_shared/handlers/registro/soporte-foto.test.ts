// El contrato del estado `awaiting_image`, ejercitado entero.
//
// El defecto que cierra este modulo no se veia en ninguna prueba del clasificador: "Si"
// se clasificaba bien y aun asi la conversacion se cerraba, porque el handler no tenia
// rama para esa respuesta. Lo que hay que fijar es la DECISION, y sobre todo la
// invariante: no entender nunca cierra.
import { describe, expect, it } from 'vitest';
import {
  BTN_DESPUES,
  BTN_SIN_SOPORTE,
  MAX_REINTENTOS_SOPORTE,
  MSG_SOPORTE,
  decidirSoporte,
  type EntradaSoporte,
} from './soporte-foto';

const texto = (t: string): EntradaSoporte => ({ tipo: 'text', tieneImagen: false, texto: t });
const boton = (id: string): EntradaSoporte => ({ tipo: 'interactive', tieneImagen: false, botonId: id, texto: '' });

describe('la foto', () => {
  it('una imagen con id se guarda', () => {
    expect(decidirSoporte({ tipo: 'image', tieneImagen: true, texto: '' }, 0)).toEqual({ accion: 'guardar_foto' });
  });

  it('la foto gana aunque venga con caption y con reintentos acumulados', () => {
    expect(decidirSoporte({ tipo: 'image', tieneImagen: true, texto: 'no' }, 9).accion).toBe('guardar_foto');
  });

  it('una imagen SIN id no se puede bajar: no cierra, pide de nuevo', () => {
    const d = decidirSoporte({ tipo: 'image', tieneImagen: false, texto: '' }, 0);
    expect(d.accion).toBe('permanecer');
  });
});

describe('el caso que abrio el frente: "Si" no expulsa', () => {
  // Reproduccion literal del bug de produccion (Termotech): tras registrar el gasto, el
  // usuario contesta "Si" a la pregunta de si/no y la sesion se cerraba en silencio.
  for (const t of ['Si', 'sí', 'claro', 'dale', 'ya', 'tengo', 'ahí va', 'un momento']) {
    it(`"${t}" permanece en awaiting_image`, () => {
      const d = decidirSoporte(texto(t), 0);
      expect(d.accion).toBe('permanecer');
      if (d.accion !== 'permanecer') return;
      expect(d.mensaje).toBe(MSG_SOPORTE.adjunta);
    });
  }

  it('una afirmacion NO consume reintentos: se entendio', () => {
    const d = decidirSoporte(texto('si'), 1);
    expect(d).toEqual({ accion: 'permanecer', mensaje: MSG_SOPORTE.adjunta, conBotones: false, reintentos: 1 });
  });

  it('aunque el contador este en el tope, una afirmacion no cierra', () => {
    // Es la invariante al reves: el tope solo lo dispara lo que NO se entiende.
    const d = decidirSoporte(texto('si'), MAX_REINTENTOS_SOPORTE);
    expect(d.accion).toBe('permanecer');
  });
});

describe('las salidas explicitas', () => {
  it('el boton "No tengo" cierra diciendo que queda sin soporte', () => {
    expect(decidirSoporte(boton(BTN_SIN_SOPORTE), 0)).toEqual({ accion: 'cerrar', mensaje: MSG_SOPORTE.sinSoporte });
  });

  it('el boton "Después" cierra con el mensaje de siempre', () => {
    expect(decidirSoporte(boton(BTN_DESPUES), 0)).toEqual({ accion: 'cerrar', mensaje: MSG_SOPORTE.despues });
  });

  it('la negacion escrita cierra igual que el boton', () => {
    expect(decidirSoporte(texto('no tengo'), 0)).toEqual({ accion: 'cerrar', mensaje: MSG_SOPORTE.sinSoporte });
  });

  it('el aplazamiento escrito cierra igual que el boton', () => {
    expect(decidirSoporte(texto('ahorita'), 0)).toEqual({ accion: 'cerrar', mensaje: MSG_SOPORTE.despues });
  });

  it('cancelar suelta la conversacion sin prometer que el gasto se deshace', () => {
    // El gasto ya esta escrito en la base: aqui cancelar solo cierra el paso del soporte.
    expect(decidirSoporte(texto('cancelar'), 0)).toEqual({ accion: 'cerrar', mensaje: MSG_SOPORTE.despues });
  });

  it('el id del boton manda aunque el titulo diga otra cosa', () => {
    const d = decidirSoporte({ tipo: 'interactive', tieneImagen: false, botonId: BTN_SIN_SOPORTE, texto: 'sí' }, 0);
    expect(d).toEqual({ accion: 'cerrar', mensaje: MSG_SOPORTE.sinSoporte });
  });
});

describe('lo que no es una foto', () => {
  it('un audio ilegible pide la foto y NO cierra', () => {
    const d = decidirSoporte({ tipo: 'audio', tieneImagen: false, texto: 'mmm a ver' }, 0);
    expect(d).toEqual({ accion: 'permanecer', mensaje: MSG_SOPORTE.audio, conBotones: true, reintentos: 1 });
  });

  it('un audio que SI se entendio se trata como el texto que dice', () => {
    // El webhook transcribe antes de enrutar. Contestar "necesito una foto, no un audio"
    // a una nota de voz que dice "no tengo" dejaria sin salida a quien solo habla.
    expect(decidirSoporte({ tipo: 'audio', tieneImagen: false, texto: 'no tengo' }, 0).accion).toBe('cerrar');
  });

  it('una ubicacion pide la foto y NO cierra', () => {
    const d = decidirSoporte({ tipo: 'location', tieneImagen: false, texto: '' }, 0);
    expect(d).toEqual({ accion: 'permanecer', mensaje: MSG_SOPORTE.noEsFoto, conBotones: true, reintentos: 1 });
  });
});

describe('la guarda de bucle', () => {
  it('el primer y el segundo mensaje sin entender repreguntan', () => {
    expect(decidirSoporte(texto('asdfgh'), 0)).toEqual({
      accion: 'permanecer', mensaje: MSG_SOPORTE.repregunta, conBotones: true, reintentos: 1,
    });
    expect(decidirSoporte(texto('asdfgh'), 1)).toEqual({
      accion: 'permanecer', mensaje: MSG_SOPORTE.repregunta, conBotones: true, reintentos: 2,
    });
  });

  it('el tercero cierra explicando donde queda el soporte', () => {
    expect(decidirSoporte(texto('asdfgh'), MAX_REINTENTOS_SOPORTE)).toEqual({
      accion: 'cerrar', mensaje: MSG_SOPORTE.rendicion,
    });
  });

  it('un contador corrupto no rompe la cuenta', () => {
    // `session.context` es jsonb: puede llegar cualquier cosa.
    for (const basura of [NaN, -3, undefined as unknown as number, 1.7]) {
      const d = decidirSoporte(texto('asdfgh'), basura);
      expect(d.accion).toBe('permanecer');
    }
  });

  it('un mensaje vacio cuenta como no entendido y tampoco cierra de una', () => {
    expect(decidirSoporte(texto('   '), 0).accion).toBe('permanecer');
  });
});

describe('la invariante', () => {
  it('ninguna entrada sin desenlace explicito cierra antes del tope', () => {
    const entradas: EntradaSoporte[] = [
      texto('si'), texto('gracias'), texto(''), texto('¿y eso cómo?'),
      { tipo: 'audio', tieneImagen: false, texto: 'ruido' },
      { tipo: 'location', tieneImagen: false, texto: '' },
      { tipo: 'flow_response', tieneImagen: false, texto: '' },
      { tipo: 'interactive', tieneImagen: false, botonId: 'btn_confirm', texto: '✔ Confirmar' },
      { tipo: 'image', tieneImagen: false, texto: '' },
    ];
    for (const e of entradas) {
      expect(decidirSoporte(e, 0).accion, JSON.stringify(e)).toBe('permanecer');
    }
  });
});
