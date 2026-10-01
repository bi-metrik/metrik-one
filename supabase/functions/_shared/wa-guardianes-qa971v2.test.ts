/**
 * Los tres S1 del QA de #971 v2 (resultado-2026-10-01-pr971-v2.md, scratchpad qa971v2/). Cada caso
 * copia lo que registró la corrida real con gemini-2.5-flash-lite: el valor que dio el modelo
 * (líneas «[ONE · valores]», «[FINAL …]» y «[modelo propuso]» del log) y el mensaje sintético del
 * banco. La frase es el fragmento del mensaje: el log no guarda la salida cruda.
 * Las opciones de los campos son las del SQL PROVISIONAL de Trappvel que vive en el repo.
 */
import { describe, expect, it } from 'vitest';
import {
  cifrasEnMillones,
  fraseNombraOpcion,
  nombreEsLugar,
  opcionPorCifra,
  rangosDeDinero,
  validarSalida,
  type CampoEntendible,
} from './wa-entendimiento-reglas.ts';
import { armarSegmentos, tieneEncabezados, type MensajeViaje, type ViajeAbierto } from './wa-viajes-reglas.ts';

const PRESUPUESTO: CampoEntendible = { slug: 'presupuesto', tipo: 'select', label: 'Presupuesto aproximado del viaje', opciones: [
  { value: 'menos_3m', label: 'Menos de $3 millones' }, { value: '3m_5m', label: 'Entre $3 y $5 millones' },
  { value: '5m_8m', label: 'Entre $5 y $8 millones' }, { value: '8m_12m', label: 'Entre $8 y $12 millones' },
  { value: '12m_20m', label: 'Entre $12 y $20 millones' }, { value: 'mas_20m', label: 'Más de $20 millones' },
  { value: 'sin_definir', label: 'Aún no tiene presupuesto definido', no_definido: true },
] };
const DESTINO_TIPO: CampoEntendible = { slug: 'destino_tipo', tipo: 'select', label: '¿El viaje es nacional o internacional?', opciones: [
  { value: 'nacional', label: 'Nacional' }, { value: 'internacional', label: 'Internacional' },
] };
const CAMPOS = [PRESUPUESTO, DESTINO_TIPO, { slug: 'destino', tipo: 'texto', label: 'Destino' } as CampoEntendible];
const leer = (t: string, valores: Record<string, { valor: string; frase: string }>, campos = CAMPOS) => validarSalida({ valores }, campos, t, { hoyISO: '2026-10-01' });

describe('1 · el rango de presupuesto lo elige el código con la cifra', () => {
  it('día, Andrés: «unos 10 millones en total» → 8m_12m aunque el modelo diga 12m_20m (10/10)', () => {
    const t = 'Nos gustaría todo incluido, unos 10 millones en total';
    const s = leer(t, { presupuesto: { valor: '12m_20m', frase: 'unos 10 millones en total' } });
    expect(s.sugeridos.presupuesto).toMatchObject({ valor: '8m_12m' });
  });

  it('día, Jorge: «presupuesto como 8 millones» cae en el borde de dos rangos: vacío y se pregunta (el modelo dio 5m_8m)', () => {
    const t = 'Tati, presupuesto como 8 millones';
    const s = leer(t, { presupuesto: { valor: '5m_8m', frase: 'presupuesto como 8 millones' } });
    expect(s.sugeridos.presupuesto).toBeUndefined();
    expect(s.descartados[0].motivo).toContain('queda en el borde de dos rangos');
    // Prueba en vivo del 2026-10-01, error 7: el borde se pregunta en el acto aunque el campo sea deseable.
    expect(s.descartados[0].pregunta).toContain('(dijeron 8 millones: queda justo entre «Entre $5 y $8 millones» y «Entre $8 y $12 millones»)');
  });

  it.each([
    ['presupuesto unos 15 millones', '12m_20m'],
    ['tenemos unos quince millones por todo', '12m_20m'],
    ['algo de $2.5M', 'menos_3m'],
    ['unos 25 millones', 'mas_20m'],
    ['como 9.000.000', '8m_12m'],
  ])('«%s» → %s', (t, esperado) => {
    expect(leer(t, { presupuesto: { valor: 'menos_3m', frase: t } }).sugeridos.presupuesto?.valor).toBe(esperado);
  });

  it.each([
    ['unos 1.500 dólares por persona'], ['3 millones por persona'], ['más o menos lo normal'], ['entre 4 y 10 millones'],
  ])('«%s» no ubica un rango: vacío', t => {
    expect(leer(t, { presupuesto: { valor: '3m_5m', frase: t } }).sugeridos.presupuesto).toBeUndefined();
  });

  it('las piezas: rangos sacados de las etiquetas de la config; cifras y ambigüedad', () => {
    expect(rangosDeDinero(PRESUPUESTO)?.map(r => r.value)).toEqual(['menos_3m', '3m_5m', '5m_8m', '8m_12m', '12m_20m', 'mas_20m']);
    expect(rangosDeDinero(DESTINO_TIPO)).toBeNull();
    expect(cifrasEnMillones('unos 1.500 dólares')).toBe('ambiguo');
    expect(opcionPorCifra(rangosDeDinero(PRESUPUESTO)!, 'unos 12 millones')).toMatchObject({ motivo: expect.stringContaining('borde'), borde: { cifra: 12 } });
  });
});

describe('2 · una opción que el modelo deduce sin frase que la nombre no se carga', () => {
  it('C6c / E2b y el día: «Cartagena» no dice «internacional» (10/10 y 3/3)', () => {
    const t = 'Queremos ir a Cartagena, salimos el 15/12, somos 2 adultos';
    const s = leer(t, { destino_tipo: { valor: 'internacional', frase: 'Cartagena' } });
    expect(s.sugeridos.destino_tipo).toBeUndefined();
    expect(s.descartados[0].motivo).toContain('deducida sin una frase que la nombre');
    const luisa = 'Buenas Tati, para San Andrés serían del 20 al 24 de noviembre';
    expect(leer(luisa, { destino_tipo: { valor: 'internacional', frase: 'para San Andrés' } }).sugeridos.destino_tipo).toBeUndefined();
  });

  it('si el cliente lo dice, entra; la config puede declarar sinónimos de una opción', () => {
    const t = 'es un viaje nacional';
    expect(leer(t, { destino_tipo: { valor: 'nacional', frase: t } }).sugeridos.destino_tipo?.valor).toBe('nacional');
    // «nacional» no nombra «internacional» ni al revés.
    expect(fraseNombraOpcion(DESTINO_TIPO, DESTINO_TIPO.opciones![1], 'viaje nacional')).toBe(false);
    const conSinonimo: CampoEntendible = { ...DESTINO_TIPO, opciones: [DESTINO_TIPO.opciones![0], { value: 'internacional', label: 'Internacional', sinonimos: ['fuera del país'] }] };
    const t2 = 'queremos salir fuera del país';
    expect(leer(t2, { destino_tipo: { valor: 'internacional', frase: t2 } }, [conSinonimo]).sugeridos.destino_tipo?.valor).toBe('internacional');
  });
});

describe('3 · D2m: un destino no es un cliente NUEVO', () => {
  const V: ViajeAbierto[] = [
    { id: 'n8', codigo: 'T1 26 8', cliente: 'JORGE PÉREZ', destino: 'CARTAGENA' },
    { id: 'n9', codigo: 'T1 26 9', cliente: 'LUISA MEJÍA', destino: 'SAN ANDRÉS' },
  ];
  const ms: MensajeViaje[] = [
    { n: 1, cuerpo: 'Queremos Punta Cana en diciembre, del 20 al 27, mi esposo y yo', reenviado: true, tipo: 'text', en: '2026-10-01T14:00:00Z' },
    { n: 2, cuerpo: 'Y aparte, en marzo quiero llevar a mi mamá a Cartagena, del 10 al 14', reenviado: true, tipo: 'text', en: '2026-10-01T14:00:30Z' },
  ];

  it('sin encabezados la tanda es un viaje: no hay reparto que haga de «Punta Cana» un cliente (el modelo ya no asigna)', () => {
    const { segmentos } = armarSegmentos(ms, V, { horasCajaActiva: 4 });
    expect(tieneEncabezados(segmentos)).toBe(false);
  });

  it('al crear el viaje, un «cliente» que es el destino entendido o el de un viaje abierto no es un nombre: se pide', () => {
    expect(nombreEsLugar('Punta Cana', ['PUNTA CANA'])).toBe(true);
    expect(nombreEsLugar('Cartagena', [null, 'CARTAGENA'])).toBe(true);
    expect(nombreEsLugar('Andrés Gil', ['SAN ANDRÉS', 'CANCÚN'])).toBe(false);
    expect(nombreEsLugar('Luisa San Andrés', ['SAN ANDRÉS'])).toBe(false);
  });
});
