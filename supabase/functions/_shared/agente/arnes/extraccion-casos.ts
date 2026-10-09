// ============================================================
// Arnés del núcleo — los casos de la extracción de una carga (Deno)
// ------------------------------------------------------------
// Uso (la llave llega por GEMINI_API_KEY; nunca se imprime; en el arnés es la de PRUEBAS):
//   deno run -A --node-modules-dir=none supabase/functions/_shared/agente/arnes/extraccion-casos.ts [--n 3]
// Cada caso corre la extracción real (`extraccionGemini`, el mismo pedido que producción) y pasa por `validarCarga`. Se
// mira lo que quedaría como sugerido, no el texto. Casos de la prueba del 2026-10-09 (d3260a5a, 69eeff52, dfbd466a) y
// controles de #1074 («no tienen presupuesto» = sin definir; «económico» = duda, no rango). Datos inventados.
// ============================================================

import { validarCarga } from '../bandeja/extraccion.ts';
import { instruccionesCarga } from '../bandeja/extraccion.ts';
import { CAMPOS_ARNES } from './conjuntos.ts';
import { extraccionGemini, MODELO_EXTRACCION } from './extraccion-gemini.ts';

const HOY = '2026-10-09';
const M_RETOMA = 'A listo. Vamos a retomar el viaje a miami. vamos a hacer una nueva cotización';
const M_PAX = 'Quiero que coticemos M1 26 2 ahora para que vayan 2 adultos y un niño de año y medio. Serían 6 noches saliendo desde Bogotá el 19 de noviembre. calcula la fecha de regreso';
const ESCRITO = { destino: 'Miami', ciudad_origen: 'Bogotá', fecha_salida: '2026-11-19', fecha_regreso: '2026-11-25', adultos: 2, ninos: 0, infantes: 1, edades_menores: '1.5' };

type Sug = Record<string, { valor: unknown; como?: string }>;
export interface CasoExtraccion { id: string; textos: string[]; yaTiene?: Record<string, unknown>; fallas(s: Sug, dudas: unknown[]): string[] }

const num = (s: Sug, k: string) => (s[k] === undefined ? undefined : Number(s[k].valor));
const debe = (cond: boolean, falla: string) => (cond ? [] : [falla]);

export const CASOS_EXTRACCION: CasoExtraccion[] = [
  {
    id: 'd3260a5a: «un niño de año y medio», sin hablar de presupuesto', textos: [M_RETOMA, M_PAX],
    fallas: (s) => [
      ...debe(num(s, 'infantes') === 1, `infantes=${s.infantes?.valor ?? '—'}`),
      ...debe((num(s, 'ninos') ?? 0) === 0, `ninos=${s.ninos?.valor}`),
      ...debe(s.presupuesto === undefined, `presupuesto=${s.presupuesto?.valor}`),
      ...debe(s.fecha_regreso?.valor === '2026-11-25', `regreso=${s.fecha_regreso?.valor ?? '—'}`),
    ],
  },
  {
    id: '69eeff52: la categoría, con el viaje ya escrito', textos: [M_RETOMA, M_PAX, 'están buscando hoteles 4 estrellas'], yaTiene: ESCRITO,
    fallas: (s) => [
      ...debe(String(s.categoria_hotel?.valor) === '4', `categoria=${s.categoria_hotel?.valor ?? '—'}`),
      ...debe(s.presupuesto === undefined, `presupuesto=${s.presupuesto?.valor}`),
    ],
  },
  {
    id: 'dfbd466a: «no tienen nada definido» = sin definir (#1074)', textos: [M_PAX, 'están buscando hoteles 4 estrellas', 'En cuanto al presupuesto, no tienen nada definido por ahora.'], yaTiene: { ...ESCRITO, categoria_hotel: '4' },
    fallas: (s) => debe(s.presupuesto?.valor === 'sin_definir', `presupuesto=${s.presupuesto?.valor ?? '—'}`),
  },
  {
    id: 'la bebé de 8 meses y el hijo de 5', textos: ['van ella, el esposo, la bebé de 8 meses y el hijo de 5 años, salen el 12 de diciembre desde Cali'],
    fallas: (s) => [
      ...debe(num(s, 'adultos') === 2, `adultos=${s.adultos?.valor ?? '—'}`),
      ...debe(num(s, 'ninos') === 1, `ninos=${s.ninos?.valor ?? '—'}`),
      ...debe(num(s, 'infantes') === 1, `infantes=${s.infantes?.valor ?? '—'}`),
      ...debe(s.presupuesto === undefined, `presupuesto=${s.presupuesto?.valor}`),
    ],
  },
  {
    id: 'dos niños de 3 y 7', textos: ['viajan 2 adultos y dos niños de 3 y 7 años, 4 noches desde el 2 de enero'],
    fallas: (s) => [...debe(num(s, 'ninos') === 2, `ninos=${s.ninos?.valor ?? '—'}`), ...debe((num(s, 'infantes') ?? 0) === 0, `infantes=${s.infantes?.valor}`)],
  },
  {
    id: '«algo económico» es duda, no rango (#1074)', textos: ['Quieren ir a Cartagena 5 noches desde el 3 de diciembre, algo económico'],
    fallas: (s, dudas) => [...debe(s.presupuesto === undefined, `presupuesto=${s.presupuesto?.valor}`), ...debe(dudas.length > 0, 'sin duda')],
  },
];

if (import.meta.main) {
  const i = Deno.args.indexOf('--n');
  const n = i >= 0 ? Number(Deno.args[i + 1]) : 1;
  const llave = Deno.env.get('GEMINI_API_KEY') ?? '';
  if (llave.length < 20) { console.error('sin llave'); Deno.exit(2); }
  const registro: Array<{ ms: number; ok: boolean }> = [];
  const extraer = extraccionGemini(llave, registro);
  let total = 0;
  let bien = 0;
  for (const c of CASOS_EXTRACCION) {
    const yaTiene = c.yaTiene ?? {};
    const fallas: string[] = [];
    const deducidos: Record<string, number> = {};
    for (let k = 0; k < n; k++) {
      const raw = await extraer({ textos: c.textos, mensajes: '', campos: CAMPOS_ARNES, yaTiene, instrucciones: instruccionesCarga(CAMPOS_ARNES, HOY, yaTiene, {}) });
      const v = validarCarga(raw, CAMPOS_ARNES, c.textos, { hoyISO: HOY, yaTiene });
      // Lo que el viaje ya tiene con el mismo valor no es nuevo (como en el resumen de la propuesta).
      const s: Sug = Object.fromEntries(Object.entries(v.sugeridos).filter(([key, x]) => String(yaTiene[key]) !== String(x.valor)));
      for (const [key, x] of Object.entries(s)) if (x.como === 'deducido') deducidos[`${key}=${x.valor}`] = (deducidos[`${key}=${x.valor}`] ?? 0) + 1;
      const f = c.fallas(s, v.dudas);
      total++;
      if (f.length) fallas.push(f.join(' ')); else bien++;
    }
    console.log(JSON.stringify({ caso: c.id, aciertos: `${n - fallas.length}/${n}`, fallas, deducidos }));
  }
  console.log(JSON.stringify({ modelo: MODELO_EXTRACCION, aciertos: `${bien}/${total}`, ms: registro.map((x) => x.ms) }));
}
