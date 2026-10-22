// ============================================================
// Arnés del asistente público — fichas de prueba propias (no son la semilla de Sabor)
// ------------------------------------------------------------
// Desde el kickoff del 22-oct la semilla de Sabor va con `elige_mesa: no`, sin ubicaciones con recargo, con una sola
// condición (la preventa, ya vencida a la hora del arnés) y con todas las reglas escritas. Los candados que esos datos
// dejan dormidos siguen en el código (§8.4) y se prueban aquí, sobre una copia de la ficha [EJEMPLO]:
//   · `conZonaYMesaPedida`  `elige_mesa: se_pide` y una zona frente a la pantalla con recargo (la preferencia de mesa
//                            anotada y el recargo dicho con su monto de la ficha);
//   · `conDosCondiciones`   dos descuentos vigentes no acumulables (no se suman);
//   · `sinRegla(clave)`     una regla sin ficha (consultar_reglas devuelve sin_dato → duda abierta y persona).
// Datos [EJEMPLO] inventados. Puro.
// ============================================================

import type { Ficha } from '../../tipos.ts';

export const CLAVE_EXPERIENCIA = 'cat.ejemplo-cena-1';

const conValores = (fichas: Ficha[], extra: Record<string, unknown>): Ficha[] =>
  fichas.map((f) => (f.clave === CLAVE_EXPERIENCIA ? { ...f, valores: { ...f.valores, ...extra } } : f));

/** Ficha que deja pedir mesa y trae una zona con recargo ($12.000 por persona frente a la pantalla). */
export const conZonaYMesaPedida = (fichas: Ficha[]): Ficha[] => conValores(fichas, {
  elige_mesa: 'se_pide',
  disposicion: '6 mesas de 4 puestos; las parejas pueden compartir mesa con otra pareja',
  ubicaciones: [
    { zona: 'frente', descripcion: 'frente a la pantalla', recargo: 12000, unidad: 'por persona' },
    { zona: 'centro', descripcion: 'centro del salón', recargo: null },
  ],
});

/** Ficha con dos descuentos vigentes el 23-oct, ninguno acumulable. */
export const conDosCondiciones = (fichas: Ficha[]): Ficha[] => conValores(fichas, {
  condiciones: [
    { id: 'pago-anticipado', tipo: 'descuento', monto: 10000, unidad: 'por persona', condicion: 'pagar el total antes del jueves de la función', desde: '2026-10-20', hasta: '2026-12-31', acumulable: false },
    { id: 'cumpleanero', tipo: 'descuento', monto: 5000, unidad: 'para el cumpleañero', condicion: 'cumplir años la semana de la función, con documento', desde: '2026-10-19', hasta: '2026-12-31', acumulable: false },
  ],
});

/** Sin la ficha de esa regla: `consultar_reglas` devuelve `sin_dato`. */
export const sinRegla = (clave: string) => (fichas: Ficha[]): Ficha[] => fichas.filter((f) => f.clave !== `pol.${clave}`);
