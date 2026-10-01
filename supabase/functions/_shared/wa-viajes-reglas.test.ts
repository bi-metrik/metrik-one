/**
 * Varios viajes en una entrega (modo mixto): el grupo F del plan de QA y el día sintético de 4
 * clientes, con la salida del modelo GRABADA (`__fixtures__/bandeja-varios-viajes.json`), más las
 * pruebas puras de la resolución de encabezados y de la respuesta al resumen.
 *
 * Lo que tiene que pasar siempre: nada se carga antes del «sí», ningún mensaje queda en un viaje
 * que no es el suyo, y lo que no tiene evidencia queda sin asignar y se pregunta.
 */
import { describe, expect, it } from 'vitest';
import fx from './__fixtures__/bandeja-varios-viajes.json';
import {
  aplicarCambios,
  armarPlan,
  armarSegmentos,
  claveDestino,
  esSi,
  evidenciaApunta,
  gruposDelPlan,
  interpretarRespuestaPlan,
  planSinDudas,
  resolverEncabezado,
  sinAsignar,
  textoResumenPlan,
  validarAsignaciones,
  type DestinoPlan,
  type MensajeViaje,
  type PlanViajes,
  type ViajeAbierto,
} from './wa-viajes-reglas.ts';
import { CONFIG_BANDEJA_POR_DEFECTO, LLAVE_BANDEJA, decidirRuta, leerConfigBandeja } from './wa-bandeja-reglas.ts';

type Esc = (typeof fx.escenarios)[number] & {
  viajes?: ViajeAbierto[];
  viajes_extra?: ViajeAbierto[];
  cerrados?: string[];
  respuestas?: Array<{ texto: string; tipo: string; grupos?: Array<[string, number[]]>; aviso?: string }>;
};

const CFG = { segundosBloque: fx.config.segundos_bloque, horasCajaActiva: fx.config.horas_caja_activa };

function aMensajes(ms: ReadonlyArray<{ en: string; texto: string; reenviado: boolean }>): MensajeViaje[] {
  return ms.map((m, i) => ({ n: i + 1, cuerpo: m.texto, reenviado: m.reenviado, tipo: 'text', en: m.en }));
}

function proponer(viajes: ViajeAbierto[], mensajes: MensajeViaje[], modelo: unknown, cerrados: string[] = []): PlanViajes {
  const { segmentos, encabezados } = armarSegmentos(mensajes, viajes, CFG);
  const asignaciones = validarAsignaciones(modelo, mensajes, viajes);
  return armarPlan({ mensajes, viajes, segmentos, encabezados, asignaciones, codigosCerrados: new Set(cerrados) });
}

function nombre(d: DestinoPlan): string {
  return d.tipo === 'existente' ? (d.codigo ?? '') : `NUEVO ${d.cliente ?? ''}`;
}

const grupos = (plan: PlanViajes) => gruposDelPlan(plan).map(g => [nombre(g.destino), g.mensajes]);

describe('grupo F (salida del modelo grabada)', () => {
  for (const e of fx.escenarios as Esc[]) {
    it(`${e.id} · ${e.titulo}`, () => {
      const viajes = [...(e.viajes ?? fx.viajes), ...(e.viajes_extra ?? [])];
      const mensajes = aMensajes(e.mensajes);
      const plan = proponer(viajes, mensajes, e.modelo, e.cerrados);
      const p = e.propuesta as { grupos: Array<[string, number[]]>; sin_asignar: number[]; encabezados?: number[]; avisos?: string[]; varios?: number[]; resumen_empieza?: string };

      expect(grupos(plan)).toEqual(p.grupos);
      expect(sinAsignar(plan).map(m => m.n)).toEqual(p.sin_asignar);
      if (p.encabezados) expect(plan.encabezados).toEqual(p.encabezados);
      for (const a of p.avisos ?? []) expect(plan.avisos.join('\n')).toContain(a);
      if (p.varios) expect(plan.mensajes.filter(m => m.varios).map(m => m.n)).toEqual(p.varios);

      // Nada se carga antes del «sí»: el resumen lo dice y pide la confirmación.
      const resumen = textoResumenPlan(plan, mensajes);
      expect(resumen).toContain('No cargué nada todavía.');
      if (p.resumen_empieza) expect(resumen.startsWith(p.resumen_empieza)).toBe(true);

      let actual = plan;
      for (const r of e.respuestas ?? []) {
        const res = interpretarRespuestaPlan(r.texto, actual, viajes);
        expect(res.tipo, `«${r.texto}»`).toBe(r.tipo);
        if (r.aviso) expect((res as { aviso?: string }).aviso).toContain(r.aviso);
        if (res.tipo === 'corregir') {
          actual = aplicarCambios(actual, res.cambios);
          if (r.grupos) expect(grupos(actual)).toEqual(r.grupos);
        }
      }
    });
  }

  it('F14: el gasto escrito en medio va al bot de gastos y no entra a la entrega', () => {
    const e = (fx.escenarios as Esc[]).find(x => x.id === 'F14') as Esc & { gasto_en_medio: string };
    const modules = { [LLAVE_BANDEJA]: true };
    expect(decidirRuta({ modules, config: CONFIG_BANDEJA_POR_DEFECTO, tipo: 'text', texto: e.gasto_en_medio, reenviado: false, sesionBotEsperando: false, entregaAbierta: true })).toBe('bot');
  });

  it('F12: con un solo viaje y `confirmar: si_duda` se podría cargar sin preguntar; con `siempre` (default) se pregunta', () => {
    const e = (fx.escenarios as Esc[]).find(x => x.id === 'F12')!;
    const plan = proponer(fx.viajes, aMensajes(e.mensajes), e.modelo);
    expect(planSinDudas(plan)).toBe(true);
    expect(leerConfigBandeja({}).confirmar).toBe('siempre');
    expect(leerConfigBandeja({ bandeja_solicitudes: { confirmar: 'como_sea' } }).confirmar).toBe('siempre');
    // F3 tiene dudas: nunca se cargaría sin preguntar.
    const f3 = (fx.escenarios as Esc[]).find(x => x.id === 'F3')!;
    expect(planSinDudas(proponer(fx.viajes, aMensajes(f3.mensajes), f3.modelo))).toBe(false);
  });
});

describe('el día sintético: 4 clientes intercalados, 62 mensajes, encabezados olvidados y un gasto', () => {
  const dia = fx.dia as { viajes: ViajeAbierto[]; mensajes: Array<{ en: string; texto: string; reenviado: boolean; verdad: string | null }>; codigos_cerrados: string[]; modelos: Record<string, unknown> };
  const mensajes = aMensajes(dia.mensajes);

  it('tiene más de 60 mensajes', () => {
    expect(dia.mensajes.length).toBeGreaterThan(60);
  });

  // El modelo real se corre 10 veces en el QA (Vera); aquí, tres salidas grabadas: una buena, una
  // que asigna por cercanía y una adversaria. En NINGUNA un mensaje cae en el viaje equivocado.
  for (const variante of Object.keys(fx.dia.modelos)) {
    it(`modelo «${variante}»: ningún mensaje queda en un viaje que no es el suyo`, () => {
      const plan = proponer(dia.viajes, mensajes, dia.modelos[variante], dia.codigos_cerrados);
      const errores: string[] = [];
      for (const m of plan.mensajes) {
        if (!m.destino) continue;
        const verdad = dia.mensajes[m.n - 1].verdad;
        if (verdad !== nombre(m.destino)) errores.push(`${m.n} «${dia.mensajes[m.n - 1].texto}» → ${nombre(m.destino)} (es de ${verdad})`);
      }
      expect(errores).toEqual([]);
      // Los encabezados no son contenido; el código cerrado se dice.
      expect(plan.encabezados.map(n => dia.mensajes[n - 1].verdad)).toEqual(plan.encabezados.map(() => 'enc'));
      expect(plan.avisos.join('\n')).toContain('El viaje T1 26 3 está cerrado');
    });
  }

  it('con el modelo bueno, lo que tiene encabezado queda asignado y lo dudoso se pregunta', () => {
    const plan = proponer(dia.viajes, mensajes, dia.modelos.bueno, dia.codigos_cerrados);
    const asignados = plan.mensajes.filter(m => m.destino).length;
    expect(asignados).toBeGreaterThanOrEqual(35);
    // El encabezado olvidado (Carolina en la caja de Luisa), el bloque mezclado de Pedro y Jorge,
    // el mensaje con dos viajes, «Luisa me recomendó» y el viaje cerrado quedan para el comercial.
    const sueltos = sinAsignar(plan).map(m => dia.mensajes[m.n - 1].texto);
    expect(sueltos).toEqual(expect.arrayContaining([
      'Hola Tati, soy Carolina Ruiz otra vez', 'Lo de Carolina va para el 15 y lo de Luisa para el 20',
      'Luisa me recomendó con ustedes', 'ya pagamos el anticipo',
    ]));
  });
});

describe('encabezados: resolución determinista contra los viajes abiertos', () => {
  const V: ViajeAbierto[] = fx.viajes;

  it.each([
    ['T1 26 9', 'n09', 'codigo'],
    ['t1-26-9', 'n09', 'codigo'],
    ['T1269', 'n09', 'codigo'],
    ['Carolina', 'n11', 'nombre'],
    ['carolina ruiz', 'n11', 'nombre'],
    ['Carlina', 'n11', 'nombre'],
    ['la de punta cana', 'n11', 'destino'],
    ['cliente Jorge', 'n09', 'nombre'],
  ])('«%s» → %s (%s)', (texto, id, por) => {
    expect(resolverEncabezado(texto, V)).toMatchObject({ tipo: 'viaje', viaje: { id }, por });
  });

  it('nuevo, con o sin nombre', () => {
    expect(resolverEncabezado('nuevo Luisa San Andrés', V)).toEqual({ tipo: 'nuevo', cliente: 'Luisa San Andrés' });
    expect(resolverEncabezado('NUEVO', V)).toEqual({ tipo: 'nuevo', cliente: null });
  });

  it('dos candidatos: pregunta; nunca elige', () => {
    const r = resolverEncabezado('Carolina', [...V, { id: 'n14', codigo: 'T1 26 14', cliente: 'CAROLINA PÉREZ', destino: 'CANCÚN' }]);
    expect(r).toMatchObject({ tipo: 'ambiguo' });
    expect((r as { candidatos: ViajeAbierto[] }).candidatos.map(c => c.id).sort()).toEqual(['n11', 'n14']);
  });

  it('un código cerrado o inexistente se informa; no crea ni reabre', () => {
    expect(resolverEncabezado('T1 26 3', V)).toEqual({ tipo: 'codigo_desconocido', codigo: 'T1263' });
  });

  it.each([
    ['Carolina quiere 5 estrellas'], ['son 3 adultos'], ['ok'], ['listo, el cliente es Jorge y quiere ir el 15 de diciembre'], ['Marta'],
  ])('«%s» no es encabezado (es contenido)', texto => {
    expect(resolverEncabezado(texto, V)).toBeNull();
  });

  it('un reenvío nunca es encabezado, aunque diga «Carolina»', () => {
    const ms = aMensajes([{ en: '2026-10-01T13:00:00Z', texto: 'Carolina', reenviado: true }]);
    expect(armarSegmentos(ms, V, CFG).encabezados).toEqual([]);
  });
});

describe('la evidencia del modelo', () => {
  const V: ViajeAbierto[] = fx.viajes;
  const car: DestinoPlan = { tipo: 'existente', negocio_id: 'n11', codigo: 'T1 26 11', cliente: 'CAROLINA RUIZ' };

  it('vale el nombre o el código; ni el destino (aunque sea único) ni una frase cualquiera', () => {
    expect(evidenciaApunta('soy Carolina', car, V)).toBe(true);
    expect(evidenciaApunta('lo del T1 26 11', car, V)).toBe(true);
    expect(evidenciaApunta('Punta Cana', car, V)).toBe(false);
    expect(evidenciaApunta('somos 4', car, V)).toBe(false);
  });

  it('una cita que no está en ESE mensaje no cuenta', () => {
    const ms = aMensajes([{ en: '2026-10-01T13:00:00Z', texto: 'somos 4', reenviado: true }]);
    expect(validarAsignaciones({ asignaciones: [{ n: 1, viaje: 'T1 26 11', evidencia: 'Carolina' }] }, ms, V).size).toBe(0);
  });

  it('las claves de destino distinguen un NUEVO por nombre', () => {
    expect(claveDestino({ tipo: 'nuevo', cliente: 'Luisa' })).toBe(claveDestino({ tipo: 'nuevo', cliente: 'LUISA' }));
  });
});

describe('la respuesta al resumen', () => {
  it.each(['sí', 'Si', 'SÍ.', 'dale', 'confirmo', 'así es'])('«%s» es sí', t => expect(esSi(t)).toBe(true));
  it.each(['ok pero falta uno', 'sí no', 'ok', '', '👍', 'si, pero el 4 no', 'no'])('«%s» NO es sí', t => expect(esSi(t)).toBe(false));

  it('las formas de corregir', () => {
    const e = (fx.escenarios as Esc[]).find(x => x.id === 'F10')!;
    const V = e.viajes!;
    const plan = proponer(V, aMensajes(e.mensajes), e.modelo);
    expect(interpretarRespuestaPlan('descartar', plan, V)).toEqual({ tipo: 'descartar_todo' });
    expect(interpretarRespuestaPlan('el 9 es de Luisa', plan, V)).toMatchObject({ tipo: 'no_entendida' });
    expect(interpretarRespuestaPlan('el 4 es del 2', plan, V)).toMatchObject({ tipo: 'corregir', cambios: [{ ns: [4], a: { tipo: 'nuevo', cliente: 'Luisa' } }] });
    expect(interpretarRespuestaPlan('el 4 es nuevo Pedro Gómez', plan, V)).toMatchObject({ tipo: 'corregir', cambios: [{ ns: [4], a: { tipo: 'nuevo', cliente: 'Pedro Gómez' } }] });
    expect(interpretarRespuestaPlan('el 4 es T1 26 9; descartar el 3', plan, V)).toMatchObject({ tipo: 'corregir', cambios: [{ ns: [4] }, { ns: [3], a: 'descartar' }] });
    expect(interpretarRespuestaPlan('el 4 es de alguien', plan, V)).toMatchObject({ tipo: 'no_entendida' });
    const descartado = aplicarCambios(plan, [{ ns: [3], a: 'descartar' }]);
    expect(textoResumenPlan(descartado, aMensajes(e.mensajes))).toContain('Descartados: 3');
  });
});
