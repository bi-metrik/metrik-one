// La descripcion de un gasto registrado por WhatsApp, con mensajes REALES.
//
// Los textos salen de `gastos.mensaje_original` y `wa_message_log` (canal WhatsApp,
// leidos el 2026-09-23). El caso que abrio el frente: "14400 para impresion de
// documentos para abrir la cuenta en bancolombia" quedo guardado como
// "impresion de documentos", y los mensajes con mas detalle quedaban como
// "Otros gastos operativos — $ 15.000" por pasar de 40 caracteres.
import { describe, expect, it } from 'vitest';
import {
  categoriaConocida,
  conDescripcion,
  descripcionParaGuardar,
  descripcionVisible,
  elegirDescripcion,
  extraerDescripcionGasto,
} from './wa-gasto-descripcion';

describe('extraerDescripcionGasto: conserva el detalle y quita solo monto, codigo y verbo', () => {
  const casos: Array<[string, number, string]> = [
    ['14400 para impresión de documentos para abrir la cuenta en bancolombia', 14400,
      'impresión de documentos para abrir la cuenta en bancolombia'],
    ['Gasto en DEWALT por valor de  15.000 en ESCOBILLAS TALADRO correspondiente al proyecto B1 26 2', 15000,
      'DEWALT en ESCOBILLAS TALADRO'],
    ['GASTOS DE TRANSPORTE  ENTREGA BARANDAS POR 900.000 CORRSPONDIENTE AL PROYECTO B1 26 2', 900000,
      'TRANSPORTE ENTREGA BARANDAS'],
    ['GASTOS DE TRANSPORTE  POR 64.400 CORREPSONDIENTE AL PROYECTO B1 26 2', 64400, 'TRANSPORTE'],
    ['GASTOS DE PINTURA POR $756.000 CORRESPONDIENTE AL \nPROYECTO B1 26 2', 756000, 'PINTURA'],
    ['10700 invitacion café cierre T1261', 10700, 'invitacion café cierre'],
    ['Gasto en MUNDIAL DE TORNILLOS por valor de  1.241.769 CHAZOS EXPANSIVOS 3/8 correspondiente al proyecto B1 26 2',
      1241769, 'MUNDIAL DE TORNILLOS CHAZOS EXPANSIVOS 3/8'],
    ['Gasto en ferretyria PERFIMETALES por valor de  14.553.226 en tubos 30x30 calibre 18 de correspondiente al proyecto B1 26 2',
      14553226, 'ferretyria PERFIMETALES en tubos 30x30 calibre 18'],
    // Numero pegado al "correspondiente" y codigo con espacio ("B 1 26 2"): asi llego.
    ['Gasto en la campana  Tubería de 30x30 por valor de 3.572.920correspondiente al proyecto B 1 26 2',
      3572920, 'la campana Tubería de 30x30'],
    ['Pago de 30mil por transporte de tubo en inox a Dimpro a KAE-2', 30000,
      'Pago por transporte de tubo en inox a Dimpro'],
    ['Gaste 182300 para compra de insumos eléctricos. Presta Mauricio Moreno. Al proyecto tráiler KAE-2', 182300,
      'compra de insumos eléctricos. Presta Mauricio Moreno. Al proyecto tráiler'],
    ['Gasto ángulos en Ferretería la campana  de 1000000 para el proyecto b1 26 1', 1000000,
      'ángulos en Ferretería la campana'],
  ];
  for (const [mensaje, monto, esperado] of casos) {
    it(mensaje.slice(0, 60), () => {
      expect(extraerDescripcionGasto(mensaje, monto)).toBe(esperado);
    });
  }

  it('los numeros que son parte de lo comprado se quedan (30x30, 3/8, calibre 18)', () => {
    const d = extraerDescripcionGasto('tubos 30x30 calibre 18 y brocas de 3/8 por 20.000', 20000);
    expect(d).toBe('tubos 30x30 calibre 18 y brocas de 3/8');
  });

  it('el monto se reconoce por valor aunque venga con multiplicador coloquial', () => {
    expect(extraerDescripcionGasto('almuerzo equipo 50 mil', 50000)).toBe('almuerzo equipo');
    expect(extraerDescripcionGasto('pagué medio palo de arriendo bodega', 500000)).toBe('arriendo bodega');
  });

  it('un saludo al inicio no se cuela en la descripcion', () => {
    expect(extraerDescripcionGasto('Hola, registra un gasto de 50 mil en almuerzo', 50000)).toBe('almuerzo');
  });
});

describe('extraerDescripcionGasto: sin detalle queda vacio (el caso solo-monto)', () => {
  for (const [mensaje, monto] of [
    ['18900', 18900],
    ['295.000', 295000],
    ['$ 16.100', 16100],
    ['Registrar gasto', undefined],
    ['Necesito registrar gastos', undefined],
    ['gasto 50 mil', 50000],
  ] as Array<[string, number | undefined]>) {
    it(`"${mensaje}"`, () => {
      expect(extraerDescripcionGasto(mensaje, monto)).toBeUndefined();
    });
  }
});

describe('elegirDescripcion: manda el modelo, salvo que haya recortado', () => {
  it('si el modelo solo boto palabras, se guarda la literal', () => {
    expect(elegirDescripcion('invitacion café', 'invitacion café cierre')).toBe('invitacion café cierre');
    expect(elegirDescripcion('PERFIMETALES, tubos 30x30 calibre 18', 'ferretyria PERFIMETALES en tubos 30x30 calibre 18'))
      .toBe('ferretyria PERFIMETALES en tubos 30x30 calibre 18');
  });

  it('si el modelo reformulo (trae palabras que no estan en el mensaje), manda el modelo', () => {
    expect(elegirDescripcion('almuerzo con el cliente', 'almuerzo cliente')).toBe('almuerzo con el cliente');
  });

  it('con una sola de las dos, esa', () => {
    expect(elegirDescripcion(undefined, 'pintura')).toBe('pintura');
    expect(elegirDescripcion('pintura', undefined)).toBe('pintura');
    expect(elegirDescripcion(undefined, undefined)).toBeUndefined();
  });
});

describe('conDescripcion: limpia lo del modelo y cae al mensaje', () => {
  it('quita el monto y el codigo que el modelo haya dejado', () => {
    const r = conDescripcion(
      { intent: 'GASTO', fields: { amount: 15000, descripcion: 'DEWALT escobillas por 15.000 proyecto B1 26 2' } },
      'Gasto en DEWALT por valor de 15.000 en escobillas correspondiente al proyecto B1 26 2',
    );
    expect(r.fields.descripcion).toBe('DEWALT en escobillas');
  });

  it('solo-monto: la descripcion queda AUSENTE, no vacia ni inventada', () => {
    const r = conDescripcion({ intent: 'GASTO', fields: { amount: 18900, descripcion: '' } }, '18900');
    expect('descripcion' in r.fields).toBe(false);
  });

  it('no toca otros intents', () => {
    const r = conDescripcion({ intent: 'ACTIVIDAD', fields: { descripcion: 'x' } }, 'llamé a Ana');
    expect(r.fields.descripcion).toBe('x');
  });
});

describe('descripcionParaGuardar', () => {
  it('guarda el detalle COMPLETO, sin el tope de 40 caracteres de antes', () => {
    const largo = 'Gasto en ferretería el tornillo feliz: 40 chazos 3/8, 2 brocas de 1/2 y un disco de corte para la baranda del segundo piso';
    expect(largo.length).toBeGreaterThan(40);
    expect(descripcionParaGuardar({ descripcion: largo }, 'materiales', 1000)).toBe(largo);
  });

  it('"Categoria — $monto" solo cuando no hay ningun detalle', () => {
    expect(descripcionParaGuardar({}, 'otros', 18900)).toMatch(/^Otros gastos operativos — \$\s?18\.900$/);
  });

  it('sesiones abiertas antes del cambio (solo concept) no pierden el concepto', () => {
    expect(descripcionParaGuardar({ concept: 'gastos de pintura' }, 'materiales', 1)).toBe('gastos de pintura');
  });
});

describe('descripcionVisible: recorta lo que se MUESTRA, no lo que se guarda', () => {
  it('cabe en el cuerpo de un mensaje con botones (1.024)', () => {
    const d = 'x'.repeat(2000);
    const v = descripcionVisible(d);
    expect(v.length).toBeLessThanOrEqual(300);
    expect(v.endsWith('…')).toBe(true);
  });
  it('lo corto pasa igual', () => {
    expect(descripcionVisible('pintura')).toBe('pintura');
  });
});

describe('categoriaConocida', () => {
  it('acepta solo las categorias del CHECK de gastos', () => {
    expect(categoriaConocida('transporte')).toBe('transporte');
    expect(categoriaConocida('Materiales')).toBe('materiales');
    expect(categoriaConocida('tintos')).toBeUndefined();
    expect(categoriaConocida(undefined)).toBeUndefined();
  });
});
