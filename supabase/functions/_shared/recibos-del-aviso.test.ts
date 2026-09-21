/**
 * El correo del recibo: UN documento, DOS documentos, y una línea que no configuró nada.
 *
 * DOS DEFECTOS MEDIDOS CONTRA PRODUCCIÓN EL 2026-09-21, y son los que estas pruebas
 * fijan:
 *
 *   1. El enlace del recibo está MUERTO. Los PDF de `recibo_caja_upme` devuelven 401 sin
 *      sesión (los de factura, el control, devuelven 200): el archivo de Drive nace
 *      cerrado desde el 2026-09-16 y el copy seguía diciendo "puedes ver y descargar el
 *      recibo aquí: {link}". 14 avisos `enviado`, a 8 correos de clientes reales, el 16 y
 *      el 17 de septiembre.
 *   2. Con `recibo_por_concepto` encendido el correo habría sido PEOR: los dos
 *      componentes archivan en el mismo bloque, así que `drive_url` apunta al último (el
 *      de la tarifa UPME) y el honorario no se nombraba en ninguna parte.
 *
 * SE VIERON FALLAR antes de la implementación (`recibosDelUltimoPago` no existía y
 * `textoDeRecibos` tampoco):
 *   - "un pago mixto nombra los DOS documentos"      → el copy solo tenía un `{link}`
 *   - "no nombra los recibos de un pago ANTERIOR"    → no había forma de agrupar
 *   - "un documento sin enlace no promete descarga"  → la promesa vivía en el texto fijo
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  DIAS_ENLACE_CLIENTE,
  MARCA_RECIBOS,
  formatearPesos,
  recibosDelUltimoPago,
  textoDeRecibos,
} from './recibos-del-aviso';

/** Un cobro puro: un solo recibo. Es el 85% de los cobros de SOENA. */
const COBRO_PURO = '31eefc54-00b6-4beb-94d5-b37fbcfd39e1';
/** Un cobro mixto: honorario y tarifa UPME, dos recibos del MISMO pago. */
const COBRO_MIXTO = 'dd84a727-05f7-4076-8894-1e871982bc5a';
/** Un pago anterior del mismo negocio, ya confirmado otro día. */
const COBRO_VIEJO = '8b43df53-462c-4085-bc5a-a820314ca394';

const REF_HON = 'one://ve-documentos/ws/negocios/neg/bloque/RC-1-79.pdf';
const REF_PAS = 'one://ve-documentos/ws/negocios/neg/bloque/RC-2-4.pdf';

function conEnlaces(lista: unknown) {
  // El firmado es de la edge function; aquí se simula con una URL estable para poder
  // mirar el TEXTO, que es lo que el cliente lee.
  return recibosDelUltimoPago(lista).map((r) => ({
    ...r,
    enlace: r.ref ? `https://signed.example/${r.numero}` : null,
  }));
}

// ─────────────────────────────────────────────────────────────────────────────
// UN COMPONENTE: el cobro puro, que es como sale SOENA hoy
// ─────────────────────────────────────────────────────────────────────────────

describe('un solo recibo', () => {
  const lista = [
    {
      at: '2026-09-15T18:37:29.607Z',
      valor: 425000,
      numero: 'RC-1-70',
      cobro_id: COBRO_PURO,
      concepto: 'Honorarios de asesoría',
      componente: 'honorario',
      ref: REF_HON,
    },
  ];

  it('nombra el documento con su número, su concepto y su valor', () => {
    const texto = textoDeRecibos(conEnlaces(lista));

    expect(texto).toContain('RC-1-70');
    expect(texto).toContain('Honorarios de asesoría');
    expect(texto).toContain('$425.000');
  });

  it('da el enlace y dice cuánto dura', () => {
    const texto = textoDeRecibos(conEnlaces(lista));

    expect(texto).toContain('https://signed.example/RC-1-70');
    expect(texto).toContain(`${DIAS_ENLACE_CLIENTE} días`);
  });

  it('es UNA sola línea de documento', () => {
    expect(recibosDelUltimoPago(lista)).toHaveLength(1);
    // Los documentos se separan por línea en blanco (así el correo los hace párrafos).
    expect(textoDeRecibos(conEnlaces(lista)).split('\n\n')).toHaveLength(1);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// DOS COMPONENTES: el caso que el frente abre
// ─────────────────────────────────────────────────────────────────────────────

describe('un pago mixto nombra los DOS documentos', () => {
  const lista = [
    {
      at: '2026-09-17T17:59:18.700Z',
      valor: 637500,
      numero: 'RC-1-79',
      cobro_id: COBRO_MIXTO,
      concepto: 'Honorarios de asesoría',
      componente: 'honorario',
      ref: REF_HON,
    },
    {
      at: '2026-09-17T17:59:20.100Z',
      valor: 795037,
      numero: 'RC-2-4',
      cobro_id: COBRO_MIXTO,
      concepto: 'Recaudo para pago de tarifa UPME',
      componente: 'pasante',
      ref: REF_PAS,
    },
  ];

  it('salen los dos, en el orden en que se emitieron', () => {
    expect(recibosDelUltimoPago(lista).map((r) => r.numero)).toEqual(['RC-1-79', 'RC-2-4']);
  });

  it('cada uno con SU concepto y SU valor', () => {
    const texto = textoDeRecibos(conEnlaces(lista));

    expect(texto).toContain('RC-1-79 · Honorarios de asesoría · $637.500');
    expect(texto).toContain('RC-2-4 · Recaudo para pago de tarifa UPME · $795.037');
  });

  it('cada uno con su PROPIO enlace', () => {
    const texto = textoDeRecibos(conEnlaces(lista));

    // El defecto que esto cierra: los dos componentes archivan en el mismo bloque, así
    // que un solo `{link}` (el `drive_url`) apuntaría al último y el honorario se
    // perdería. Dos documentos son dos enlaces.
    expect(texto).toContain('https://signed.example/RC-1-79');
    expect(texto).toContain('https://signed.example/RC-2-4');
  });

  it('el cliente ve DOS bloques, no un párrafo pegado', () => {
    expect(textoDeRecibos(conEnlaces(lista)).split('\n\n')).toHaveLength(2);
  });

  it('NO nombra los recibos de un pago ANTERIOR del mismo negocio', () => {
    // Medido en producción el 2026-09-21: el negocio 6c0d155e ya tiene dos entradas, de
    // dos cobros distintos y de días distintos. Nombrar el de ayer junto al de hoy se
    // lee como un cobro doble, que es el ruido que "un solo correo" vino a quitar.
    const conHistoria = [
      { at: '2026-09-16T17:23:36.658Z', valor: 701812, numero: 'RC-1-73', cobro_id: COBRO_VIEJO, ref: REF_HON },
      ...lista,
    ];

    expect(recibosDelUltimoPago(conHistoria).map((r) => r.numero)).toEqual(['RC-1-79', 'RC-2-4']);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// COMPATIBILIDAD: una línea SIN recibo_por_concepto, y el copy que no lo pide
// ─────────────────────────────────────────────────────────────────────────────

describe('una línea que no configuró nada manda el correo de hoy', () => {
  it('el copy que no escribe {recibos} no tiene nada que resolver', () => {
    // Es la guarda que deja intactos a `metrik` y a `valida`: la marca no está en su
    // copy, así que ni se consulta la lista ni se firma ningún enlace.
    const copy = 'Hola[ {cliente}]. Recibimos tu pago y ya quedó registrado. Lo puedes ver aquí: {link}';

    expect(copy.includes(MARCA_RECIBOS)).toBe(false);
  });

  it('una entrada sin concepto (las 7 de producción) se nombra igual, con número y valor', () => {
    // Medido el 2026-09-21: las 7 entradas vivas solo traen `at`, `valor`, `numero` y
    // `cobro_id`. Degradan, no rompen.
    const vieja = [{ at: '2026-09-08T00:28:07.896Z', valor: 595000, numero: 'RC-1-69', cobro_id: COBRO_PURO }];

    expect(textoDeRecibos(conEnlaces(vieja))).toBe('RC-1-69 · $595.000');
  });

  it('un documento SIN enlace no promete una descarga', () => {
    // La invitación vive dentro de la línea del documento que sí tiene enlace. Si
    // viviera en el texto fijo del copy, el correo la haría igual y el cliente volvería
    // a encontrarse con nada: el defecto del 2026-09-16 con otro disfraz.
    const sinRef = [{ at: '2026-09-08T00:28:07.896Z', valor: 595000, numero: 'RC-1-69', cobro_id: COBRO_PURO }];

    expect(textoDeRecibos(conEnlaces(sinRef))).not.toContain('Descargar');
  });

  it('sin lista no hay nada que nombrar, y el aviso se omite', () => {
    // `recibos: null` existe en producción (1 de las 7 filas del bloque). Vacío es la
    // señal de omitir: un correo que dice "estos son los documentos de tu pago" y no
    // lista ninguno es peor que no mandarlo, y en el log se ve como un éxito.
    expect(recibosDelUltimoPago(null)).toEqual([]);
    expect(recibosDelUltimoPago([])).toEqual([]);
    expect(recibosDelUltimoPago('no es una lista')).toEqual([]);
    expect(recibosDelUltimoPago([{ valor: 1, cobro_id: COBRO_PURO }])).toEqual([]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// El dinero
// ─────────────────────────────────────────────────────────────────────────────

describe('los pesos se leen como pesos', () => {
  it('separa miles con punto, como en Colombia', () => {
    expect(formatearPesos(795037)).toBe('$795.037');
    expect(formatearPesos(1000000)).toBe('$1.000.000');
    expect(formatearPesos(500)).toBe('$500');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// CONTRATO con la edge function, que vitest no puede importar
// ─────────────────────────────────────────────────────────────────────────────

describe('notificar-etapa usa este módulo, y lo usa como toca', () => {
  const index = readFileSync(join(process.cwd(), 'supabase/functions/notificar-etapa/index.ts'), 'utf8');

  it('lo importa en vez de tener su propia copia', () => {
    expect(index).toContain("from '../_shared/recibos-del-aviso.ts'");
    expect(index).toContain('recibosDelUltimoPago');
    expect(index).toContain('textoDeRecibos');
  });

  it('solo resuelve {recibos} si el copy lo pide', () => {
    // Sin esta guarda, un workspace que no usa la marca pagaría consultas y firmas de
    // más, y quedarían enlaces firmados de siete días que nadie pidió.
    expect(index).toContain('const quiereRecibos = texto.includes(MARCA_RECIBOS);');
  });

  it('{recibos} es OBLIGATORIO: sin él se omite el aviso', () => {
    // Está en la misma lista que `link` y `fecha_cita`, que es la que decide omitir.
    expect(index).toContain("for (const clave of ['fecha_cita', 'link', 'recibos'] as const)");
  });

  it('firma cada recibo por separado, con el enlace del cliente', () => {
    expect(index).toContain('r.ref ? await enlaceParaElCliente(supabase, r.ref, workspaceId) : null');
  });

  it('el plazo que dice el texto es el mismo que se firma', () => {
    // Si se separaran, el correo prometería un número de días y el enlace duraría otro.
    expect(index).toContain('const SEGUNDOS_ENLACE_CLIENTE = DIAS_ENLACE_CLIENTE * 24 * 60 * 60;');
  });
});
