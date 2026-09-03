// Pruebas del filtro que separa lo que el modelo pudo saber de lo que se inventó.
//
// ⚠️ Esto no es una prueba de estilo. Lo que `validarContraElFormulario` deja
// pasar se GUARDA en la configuración del workspace y a partir de ahí manda sobre
// todos los leads de ese formulario. Un campo alucinado que se cuele aquí rompe
// el formulario para siempre, en silencio, y nadie lo relaciona con el modelo.
//
// Los nombres de campo son los reales del formulario de SOENA (medidos en
// `config_extra.meta_leads` el 2026-09-02), tildes y paréntesis incluidos: son
// justamente la clase de nombre que un modelo normaliza al copiar.
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { validarContraElFormulario } from './entender-formulario';

const CAMPOS = [
  'nombre_completo',
  'correo_electrónico',
  'número_de_teléfono',
  '¿la_compra_se_realizó_como_persona_natural_o_jurídica?',
  'marca_-línea_-modelo__(_byd_-yuan_-2026)',
];

beforeEach(() => {
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => vi.restoreAllMocks());

describe('validarContraElFormulario', () => {
  it('acepta un mapa que copia los nombres exactos', () => {
    const mapa = validarContraElFormulario({
      nombre: 'nombre_completo',
      email: 'correo_electrónico',
      telefono: 'número_de_teléfono',
      tipo_persona: '¿la_compra_se_realizó_como_persona_natural_o_jurídica?',
      descripcion: 'marca_-línea_-modelo__(_byd_-yuan_-2026)',
    }, CAMPOS);

    expect(mapa).toEqual({
      nombre: 'nombre_completo',
      email: 'correo_electrónico',
      telefono: 'número_de_teléfono',
      tipo_persona: '¿la_compra_se_realizó_como_persona_natural_o_jurídica?',
      descripcion: 'marca_-línea_-modelo__(_byd_-yuan_-2026)',
    });
  });

  it('descarta el campo que el modelo se inventó', () => {
    // 'phone_number' es plausible y no existe en este formulario. Guardarlo
    // dejaría el teléfono sin resolver para siempre.
    const mapa = validarContraElFormulario(
      { nombre: 'nombre_completo', telefono: 'phone_number' }, CAMPOS,
    );
    expect(mapa.nombre).toBe('nombre_completo');
    expect(mapa.telefono).toBeNull();
  });

  it('tolera que el modelo normalice al copiar, y devuelve el nombre original', () => {
    const mapa = validarContraElFormulario(
      { email: '  CORREO_ELECTRÓNICO ' }, CAMPOS,
    );
    expect(mapa.email).toBe('correo_electrónico');
  });

  it('no deja que un campo cumpla dos papeles', () => {
    // Pasa cuando el formulario pide una sola cosa: el modelo la etiqueta dos
    // veces. Dejarlo así garantiza que uno de los dos papeles quede mal.
    const mapa = validarContraElFormulario(
      { nombre: 'nombre_completo', telefono: 'nombre_completo' }, CAMPOS,
    );
    expect(mapa.nombre).toBe('nombre_completo');
    expect(mapa.telefono).toBeNull();
  });

  it('acepta que un papel no exista en el formulario', () => {
    // Muchos formularios no piden correo. Eso no es un fallo del modelo.
    const mapa = validarContraElFormulario(
      { nombre: 'nombre_completo', email: null, telefono: 'número_de_teléfono' }, CAMPOS,
    );
    expect(mapa.email).toBeNull();
    expect(mapa.telefono).toBe('número_de_teléfono');
  });

  it('sobrevive a una respuesta con basura en vez de texto', () => {
    const mapa = validarContraElFormulario(
      { nombre: 42, email: { a: 1 }, telefono: ['x'], tipo_persona: null, descripcion: '' },
      CAMPOS,
    );
    expect(mapa).toEqual({
      nombre: null, email: null, telefono: null, tipo_persona: null, descripcion: null,
    });
  });
});
