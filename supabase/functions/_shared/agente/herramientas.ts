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

/** Lo que dice la descripción de `proponer` sobre el `texto`: en la variante del respaldo se reemplaza. */
const TEXTO_ARRIBA = 'Si la persona además preguntó algo (p. ej. «¿ya tenemos algo abierto?»), la respuesta va en `texto`: sale arriba del resumen, en el mismo mensaje. Una pregunta sin contestar es un error.';
const SIN_TEXTO = 'Aquí `proponer` no lleva texto: el resumen, la pregunta y los botones los escribe el sistema. Si la persona además preguntó algo, contéstale con `responder` en vez de proponer.';

/**
 * Las declaraciones para el modelo de respaldo: `proponer` sin `texto`. Medido en producción (2026-10-07 a 10-09): las
 * 3 propuestas del respaldo con texto lo usaron para repetir la pregunta del resumen; ninguna contestaba algo. Pura.
 */
export function declaracionesRespaldo(decl: DeclaracionHerramienta[]): DeclaracionHerramienta[] {
  return decl.map((x) => {
    if (x.name !== 'proponer') return x;
    const params = x.parameters as { properties: Record<string, unknown> } & Record<string, unknown>;
    const { texto: _texto, ...props } = params.properties;
    return {
      ...x,
      description: x.description.split('\n').map((l) => (l === TEXTO_ARRIBA ? SIN_TEXTO : l))
        .filter((l) => !l.startsWith('La pregunta de confirmación')).join('\n'),
      parameters: { ...params, properties: props },
    };
  });
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
        TEXTO_ARRIBA,
        'La pregunta de confirmación («¿Lo anoto en…?», «¿Abro este viaje?») y sus botones los pone el sistema en el resumen: no la escribas en `texto`, ni con otras palabras.',
        'Si la propuesta pendiente (en el Estado) ya es esta, llámala igual: el sistema no la duplica, reenvía la pendiente con sus botones (y tu `texto` arriba). No la repitas con otras palabras en `responder`.',
        `Acciones: ${d.acciones.join(', ')}.`,
        reglasProponer.length ? `Reglas al proponer:\n${reglasProponer.join('\n')}` : '',
      ].filter(Boolean).join('\n'),
      parameters: {
        type: 'object',
        properties: {
          accion: { type: 'string', enum: d.acciones },
          datos: { type: 'object', properties: d.datosProponer },
          texto: { type: 'string', description: 'Opcional: vacío si la persona no preguntó nada. La respuesta a lo que preguntó en este mensaje, o el cálculo que pidió (máximo 600 caracteres, mismas reglas que `responder`). Nunca la pregunta de si lo anotas, abres o cargas, ni el resumen: los escribe el sistema.' },
          reglas_usadas: { type: 'array', items: { type: 'string' } },
        },
        required: ['accion', 'datos'],
      },
    },
    {
      name: 'responder',
      description: 'Lo que le llega a la persona. Texto corto (máximo 600 caracteres). Con 2 o 3 salidas cerradas, ponlas en `opciones` (botones, título de hasta 20 caracteres); para elegir entre 4 y 10 cosas, también (lista: título de hasta 24, descripción de hasta 72). Más de 10, no. Las `opciones` son para elegir, no para confirmar: los botones que escriben en ONE (cargar, anotar, abrir, descartar) solo los pone el sistema con `proponer`; nunca los imites aquí ni mandes a tocar los de otro mensaje.',
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
