import { describe, expect, it } from 'vitest';
import { textoAvisoCruce, textoPreguntaNegocio, interpretarRespuestaNegocio } from './wa-carga-reglas.ts';
import { textoDosViajes, textoSinSolicitud } from './wa-guardianes.ts';
import { esDescartarTodo, leerReintentar, textoFallaEntendimiento, textoPreguntaCliente, textoReintentarSinElegir } from './wa-bandeja-reglas.ts';
import { textoNombreNuevoEnDuda, textoPreguntaContacto, interpretarRespuestaContacto } from './wa-entendimiento-reglas.ts';
import { textoDudaDescarte, textoPreguntaViaje, TEXTO_NO_ENCONTRE_VIAJE, TEXTO_NUEVO_NO_ANOTADO, TEXTO_NUEVO_NO_CARGADO } from './wa-interprete-reglas.ts';
import {
  aplicarCambios, armarPlan, armarSegmentos, esSi, interpretarConfirmacionNuevo, interpretarRespuestaPlan, partesResumenPlan, textoConfirmarNuevo,
  textoPreguntaEncabezado, textoPreguntaEncabezadoCorta, TEXTO_COMO_CORREGIR,
} from './wa-viajes-reglas.ts';
import type { MensajeViaje, ViajeAbierto } from './wa-viajes-reglas.ts';

/**
 * PR B del diseño de cliente y conversación (2026-10-05, §5.2): los textos fijos de la bandeja en lenguaje
 * natural. Cuatro reglas: una pregunta, arriba; sin comandos en MAYÚSCULAS; opciones con un dato que distinga;
 * corto (dos líneas más el bloque de la lista o del resumen). Lo que acepta cada pregunta NO cambia: las palabras
 * viejas («SÍ», «NUEVO», «DESCARTAR», «REINTENTAR») siguen valiendo. Datos inventados.
 */

const L: ViajeAbierto = { id: 'l', codigo: 'T1 26 14', cliente: 'LINA PÉREZ', destino: 'CARTAGENA', nombre: 'CARTAGENA DIC' };
const J: ViajeAbierto = { id: 'j', codigo: 'T1 26 12', cliente: 'JORGE PÉREZ', destino: 'MADRID', nombre: 'MADRID 8N' };
const m = (n: number, cuerpo: string, reenviado = true): MensajeViaje => ({ n, cuerpo, reenviado, tipo: 'text', en: `2026-10-05T10:00:0${n}Z` });
const MS = [m(1, 'Lina Pérez', false), m(2, 'Queremos ir a Cartagena del 12 al 16'), m(3, 'soy Andrés, también quiero Madrid')];
const { segmentos, encabezados } = armarSegmentos(MS, [L, J], { horasCajaActiva: 4 });
const PLAN = armarPlan({ mensajes: MS, viajes: [L, J], segmentos, encabezados });
const LISTO = aplicarCambios(PLAN, [{ ns: [3], a: 'dejar' }]);

/** Los textos principales, como salen. Las citas entre «» son del cliente o del comercial: no cuentan. */
const TEXTOS: Record<string, string> = {
  'de qué viaje (lista)': textoPreguntaNegocio({ nMensajes: 3, opciones: [{ ...L, propuesto: true }, J] }),
  'de qué viaje (sin viajes)': textoPreguntaNegocio({ nMensajes: 1, opciones: [] }),
  'de qué viaje (no entendí)': textoPreguntaNegocio({ nMensajes: 0, opciones: [L, J], aviso: 'No entendí «el de allá».' }),
  'encabezado ambiguo': textoPreguntaEncabezado('Pérez', [L, J]),
  'recordatorio de la lista': textoPreguntaEncabezadoCorta('Pérez', [L, J]),
  'resumen con un marcado': partesResumenPlan(PLAN, MS, undefined, [L, J]).join('\n'),
  'resumen listo': partesResumenPlan(LISTO, MS, undefined, [L, J]).join('\n'),
  'resumen tras un «sí» con algo pendiente': partesResumenPlan(PLAN, MS, 'Todavía no lo cargo.', [L, J]).join('\n'),
  'cómo corregir': TEXTO_COMO_CORREGIR,
  'cliente nuevo (sin directorio)': textoConfirmarNuevo({ nombre: 'Ana Ríos', conLista: true }),
  'cliente nuevo parecido': textoConfirmarNuevo({ nombre: 'Lina Ríos', conLista: true, parecidos: [{ viaje: L, numero: 1 }] }),
  'viaje equivocado': textoAvisoCruce({ codigo: 'T1 26 14', cliente: 'LINA PÉREZ', destino: 'CARTAGENA', nombre: 'CARTAGENA DIC', cruces: [{ que: 'destino', enMensajes: 'Punta Cana', enNegocio: 'CARTAGENA' }] }),
  'dos solicitudes': textoDosViajes([{ cliente: 'Lina', destino: 'Cartagena', frase: 'x' }, { cliente: 'Andrés', destino: 'Madrid', frase: 'y' }]),
  'sin solicitud': textoSinSolicitud(2),
  'falla al cargar': textoFallaEntendimiento('agotado', 'Lina Pérez', 'T1 26 14'),
  'cuál reintento': textoReintentarSinElegir('', ['T1 26 14', 'T1 26 12']),
  'de qué cliente (pregunta vieja)': textoPreguntaCliente(3),
  'nombre en duda': textoNombreNuevoEnDuda('123'),
  'contacto: parecidos': textoPreguntaContacto({ tipo: 'preguntar', motivo: 'ninguno', opciones: [{ id: 'a', nombre: 'ANA RÍOS DÍAZ', telefono: '3001112233' }], nombre: 'Ana Ríos' }),
  'intérprete: viaje ambiguo': textoPreguntaViaje('Pérez', [L, J]),
  'intérprete: «nuevo» largo': TEXTO_NUEVO_NO_ANOTADO,
  'intérprete: «nuevo» largo a la lista': TEXTO_NUEVO_NO_CARGADO,
  'intérprete: viaje no encontrado': TEXTO_NO_ENCONTRE_VIAJE,
  'intérprete: ¿descarto qué?': textoDudaDescarte({ capa: 'resumen', origen: 'bandeja', texto: 'Lina Pérez · ¿Lo cargo así?', opciones: [], haceMin: 1, tambien: null, ofreceDescartar: true }, 'las 10:42'),
};

const sinCitas = (t: string) => t.replace(/«[^»]*»/g, '«…»');

describe('PR B · los textos fijos de la bandeja', () => {
  it.each(Object.entries(TEXTOS))('%s: sin comandos en mayúsculas', (_k, t) => {
    expect(sinCitas(t)).not.toMatch(/\b(?:SÍ|SI|NUEVO|DESCARTAR|REINTENTAR|CORREGIR|DEJAR)\b/);
  });

  it.each(Object.entries(TEXTOS))('%s: una sola pregunta (o ninguna), y si la hay va en la primera línea', (_k, t) => {
    const lineas = sinCitas(t).split('\n');
    const preguntas = lineas.flatMap((l, i) => (l.includes('?') ? [i] : []));
    expect((sinCitas(t).match(/\?/g) ?? []).length).toBeLessThanOrEqual(t.startsWith('¿Descarto') ? 2 : 1);
    if (preguntas.length > 0) expect(preguntas[0]).toBe(0);
  });

  it.each(Object.entries(TEXTOS))('%s: corto (dos líneas más el bloque de la lista o del resumen)', (_k, t) => {
    // El bloque: la lista, y en el resumen (2026-10-05) el viaje en negrita con la línea de su cliente y las líneas en blanco.
    const bloque = /^(?:\d+[.)] |   \d+ |⚠ |Entendí |Descartados|- |\*.*\*$|Ya es cliente · |Cliente nuevo · |No lo tengo |$)/;
    expect(t.split('\n').filter(l => !bloque.test(l)).length).toBeLessThanOrEqual(3);
  });

  it('los textos principales, tal cual', () => {
    expect(TEXTOS['de qué viaje (lista)']).toBe([
      '¿De qué viaje son los 3 mensajes? Parece de Lina Pérez (el 1).',
      '1. CARTAGENA DIC · Lina Pérez (T1 26 14)',
      '2. MADRID 8N · Jorge Pérez (T1 26 12)',
      'Tócalo en la lista o escribe su número. Si es un viaje nuevo, escribe «nuevo» y el nombre del cliente; si no va, «descartar».',
    ].join('\n'));
    expect(TEXTOS['resumen listo'].split('\n')[0]).toBe('¿Cargo este viaje?');
    // 2026-10-05: «No cargué nada todavía» lo dicen ahora los botones «Cargar» y «Descartar»; queda cómo corregir.
    expect(TEXTOS['resumen listo'].split('\n').at(-1)).toBe('Para mover o quitar uno, escríbeme: «el 2 es de Luisa» o «quita el 2».');
    expect(TEXTOS['resumen con un marcado'].split('\n')[0]).toBe('¿Qué hago con el 2 (⚠)?');
    expect(TEXTOS['dos solicitudes']).toBe('¿Me las reenvías por separado? Veo dos solicitudes distintas (Lina: Cartagena · Andrés: Madrid) y no las mezclo en un viaje.\nResponde «descartar» y reenvía cada una después de su encabezado («Carolina», «T1 26 9», «nuevo Luisa»).');
  });
});

describe('PR B · lo que acepta cada pregunta no cambia: las palabras viejas siguen valiendo', () => {
  it('«SÍ» y «sí», «NUEVO X» y «nuevo X», «DESCARTAR» y «descartar», «REINTENTAR» y «reintentar»', () => {
    expect([esSi('SÍ'), esSi('sí'), esSi('Si')]).toEqual([true, true, true]);
    expect(interpretarRespuestaPlan('SÍ', LISTO, [L, J])).toEqual({ tipo: 'si' });
    expect(interpretarRespuestaPlan('sí', LISTO, [L, J])).toEqual({ tipo: 'si' });
    expect(interpretarRespuestaPlan('DESCARTAR', LISTO, [L, J])).toEqual({ tipo: 'descartar_todo' });
    expect(interpretarRespuestaPlan('descartar', LISTO, [L, J])).toEqual({ tipo: 'descartar_todo' });
    for (const t of ['NUEVO Ana Ríos', 'nuevo Ana Ríos']) expect(interpretarRespuestaNegocio(t, [L, J])).toEqual({ tipo: 'nuevo', cliente: 'Ana Ríos' });
    for (const t of ['DESCARTAR', 'descartar']) expect([interpretarRespuestaNegocio(t, [L, J]), esDescartarTodo(t)]).toEqual([{ tipo: 'descartar' }, true]);
    expect([leerReintentar('REINTENTAR T1 26 14'), leerReintentar('reintentar T1 26 14')]).toEqual(['T1 26 14', 'T1 26 14']);
    for (const t of ['SÍ', 'sí', 'NUEVO', 'nuevo']) expect(interpretarConfirmacionNuevo(t, [], 'Ana Ríos')).toEqual({ tipo: 'si' });
    expect([interpretarRespuestaContacto('NUEVO', []), interpretarRespuestaContacto('nuevo', [])]).toEqual([{ tipo: 'nuevo', nombre: null }, { tipo: 'nuevo', nombre: null }]);
  });
});
