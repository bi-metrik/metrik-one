// ============================================================
// Núcleo conversacional — las declaraciones de las herramientas (§3.3)
// ------------------------------------------------------------
// En la bandeja: las lecturas del dominio (`buscar`, `ver_viaje`), sus cierres y dos del núcleo (`proponer`,
// `responder`). Sin solapes; `proponer` y `responder` cierran el turno. `consultar_reglas` salió el 2026-10-09: las
// fichas de índice ya van completas en el sistema (ver `reglamento.ts`).
// ============================================================

import { fichasDeHerramienta, temas } from './reglamento.ts';
import type { DeclaracionHerramienta, Dominio, Reglamento } from './tipos.ts';

export const CIERRAN = ['responder', 'proponer'];

/** Lo que cierra el turno con este dominio: los del núcleo y los cierres que declare el dominio. */
export function cierranCon(d: Pick<Dominio, 'cierres'>): string[] {
  return [...CIERRAN, ...(d.cierres ?? []).map((c) => c.name)];
}

export function declaraciones(d: Dominio, r: Reglamento): DeclaracionHerramienta[] {
  // Las fichas de `proponer` van en su descripción: el turno se cierra al proponer, así que el modelo tiene que
  // tenerlas ANTES (las de las lecturas llegan con su resultado).
  const reglasProponer = fichasDeHerramienta(r, 'proponer');
  // Los cierres del dominio también cierran el turno: sus fichas van en la descripción, como las de `proponer`.
  const cierres = (d.cierres ?? []).map((c) => {
    const reglas = fichasDeHerramienta(r, c.name);
    return reglas.length ? { ...c, description: `${c.description}\nReglas:\n${reglas.join('\n')}` } : c;
  });
  return [
    ...d.lecturas,
    ...cierres,
    {
      name: 'proponer',
      description: [
        'La única puerta para escribir en ONE, y no escribe: el sistema arma un resumen con datos reales y lo manda con botones; se ejecuta solo si la persona toca «sí». Cierra el turno: no redactes después.',
        'Si la persona además preguntó algo (p. ej. «¿ya tenemos algo abierto?»), la respuesta va en `texto`: sale arriba del resumen, en el mismo mensaje. Una pregunta sin contestar es un error.',
        'Si la propuesta pendiente (en el Estado) ya es esta, no la repitas: contesta con `responder`.',
        `Acciones: ${d.acciones.join(', ')}.`,
        reglasProponer.length ? `Reglas al proponer:\n${reglasProponer.join('\n')}` : '',
      ].filter(Boolean).join('\n'),
      parameters: {
        type: 'object',
        properties: {
          accion: { type: 'string', enum: d.acciones },
          datos: { type: 'object', properties: d.datosProponer },
          texto: { type: 'string', description: 'Opcional. La respuesta a lo que la persona preguntó en este mensaje (máximo 600 caracteres, mismas reglas que `responder`). No repitas el resumen: lo escribe el sistema.' },
          reglas_usadas: { type: 'array', items: { type: 'string' } },
        },
        required: ['accion', 'datos'],
      },
    },
    {
      name: 'responder',
      description: 'Lo que le llega a la persona. Texto corto (máximo 600 caracteres). Con 2 o 3 salidas cerradas, ponlas en `opciones` (botones, título de hasta 20 caracteres); para elegir entre 4 y 10 cosas, también (lista: título de hasta 24, descripción de hasta 72). Más de 10, no.',
      parameters: {
        type: 'object',
        properties: {
          texto: { type: 'string' },
          tema: { type: 'string', enum: temas(r) },
          opciones: {
            type: 'array',
            items: { type: 'object', properties: { titulo: { type: 'string' }, descripcion: { type: 'string' } }, required: ['titulo'] },
          },
          reglas_usadas: { type: 'array', items: { type: 'string' } },
        },
        required: ['texto', 'tema'],
      },
    },
  ];
}
