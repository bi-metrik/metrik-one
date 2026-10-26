// ============================================================
// Arnés del asistente público — fichas de prueba propias (no son la semilla de Sabor)
// ------------------------------------------------------------
// Desde el kickoff del 22-oct la semilla de Sabor va con `elige_mesa: no`, sin ubicaciones con recargo, con una sola
// condición (la preventa, ya vencida a la hora del arnés) y con todas las reglas escritas. Los candados que esos datos
// dejan dormidos siguen en el código (§8.4) y se prueban aquí, sobre una copia de la ficha [EJEMPLO]:
//   · `conZonaYMesaPedida`  `elige_mesa: se_pide` y una zona frente a la pantalla con recargo (la preferencia de mesa
//                            anotada y el recargo dicho con su monto de la ficha);
//   · `conDosCondiciones`   dos descuentos vigentes no acumulables (no se suman);
//   · `sinRegla(clave)`     una regla sin ficha (consultar_reglas devuelve sin_dato → duda abierta y persona);
//   · `conPreventaVigente`  la preventa abierta a la hora del arnés (23-oct), con su cierre el 29-oct (§8.8: el bot dice
//                            el descuento y hasta cuándo, sin explicar por qué).
// Sabor no hace solo cenas con película (Mauricio, 26-oct): también catas, clases y otras experiencias, y todas funcionan
// igual (horarios, precios, cupo). Para probar que el asistente no supone cine:
//   · `soloCata`            el catálogo con una sola experiencia, una cata de vino sin nada de cine (con su preventa
//                            vigente y su edad mínima de 18);
//   · `cataYPelicula`       la cata y la cena de película vigentes a la vez (las dos con horario el sábado 24);
//   · `tresExperiencias`    las dos y una clase de sushi (para medir el tope del resultado de `ver_catalogo`).
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

/** La preventa vigente el 23-oct: $20.000 por persona hasta el 29-oct (cierre). Monto y fechas [EJEMPLO]. */
export const conPreventaVigente = (fichas: Ficha[]): Ficha[] => conValores(fichas, {
  condiciones: [
    { id: 'preventa', tipo: 'descuento', monto: 20000, unidad: 'por persona', condicion: 'reservar antes del cierre de la preventa, para cualquier número de personas', desde: '2026-10-22', hasta: '2026-10-29', acumulable: false },
  ],
});

const ejemplo = (clave: string, valores: Record<string, unknown>): Ficha =>
  ({ clave, tipo: 'guia', carga: 'con_herramienta', herramientas: [], hacer: '[EJEMPLO] Ficha inventada para el arnés; no es de Sabor.', fuente: '[EJEMPLO] inventado', valores: { ...valores, ejemplo: true } });

/** Una cata de vino [EJEMPLO], sin nada de cine: preventa vigente el 23-oct (cierra el 30-oct) y solo mayores de 18. */
export const FICHAS_CATA: Ficha[] = [
  ejemplo('cat.ejemplo-cata-1', {
    tipo: 'experiencia', id: 'ejemplo-cata-1', nombre: '[EJEMPLO] Cata de vinos: cinco cepas de Mendoza',
    historia: '[EJEMPLO] Una sommelier guía la cata de cinco vinos argentinos, uno por uno, y cuenta de dónde viene cada uva mientras se prueban maridajes pensados para cada copa.',
    incluye: 'Cinco copas de vino, tabla de quesos y charcutería, y guía de sommelier', precio_persona: 120000, abono: 50000,
    cobro_grupo: 'Precio por persona para cualquier número de personas; sin descuento por pareja ni por grupo.',
    condiciones: [
      { id: 'preventa', tipo: 'descuento', monto: 15000, unidad: 'por persona', condicion: 'reservar antes del cierre de la preventa, para cualquier número de personas', desde: '2026-10-20', hasta: '2026-10-30', acumulable: false },
    ],
    capacidad: 16, disposicion: 'Una mesa larga compartida de 16 puestos; no se elige puesto.', ubicaciones: [], elige_mesa: 'no',
    duracion: '2 horas', edad_sugerida: 'solo mayores de 18 años (se sirve alcohol)', direccion: '[EJEMPLO] Calle Falsa 123, Bogotá',
    vigente_desde: '2026-10-20', vigente_hasta: '2026-12-31', version: 'ejemplo-cata-1', fecha_ficha: '2026-10-26',
  }),
  ejemplo('fun.ejemplo-cata-1', { tipo: 'funcion', id: 'f-cata-1', experiencia: 'ejemplo-cata-1', inicio: '2026-10-24T16:00:00-05:00' }),
  ejemplo('fun.ejemplo-cata-2', { tipo: 'funcion', id: 'f-cata-2', experiencia: 'ejemplo-cata-1', inicio: '2026-10-30T19:00:00-05:00' }),
];

/** Una clase de sushi [EJEMPLO], solo para medir el tope de `ver_catalogo` con tres experiencias vigentes. */
export const FICHAS_SUSHI: Ficha[] = [
  ejemplo('cat.ejemplo-sushi-1', {
    tipo: 'experiencia', id: 'ejemplo-sushi-1', nombre: '[EJEMPLO] Clase de sushi para principiantes',
    historia: '[EJEMPLO] Un chef enseña paso a paso a cocinar el arroz, cortar el pescado y armar makis y nigiris; al final cada uno se come lo que preparó.',
    incluye: 'Ingredientes, delantal, bebida y los rollos que prepares', precio_persona: 110000, abono: 45000,
    cobro_grupo: 'Precio por persona para cualquier número de personas; sin descuento por pareja ni por grupo.',
    condiciones: [], capacidad: 12, disposicion: 'Cada persona tiene su puesto de trabajo en la barra.', ubicaciones: [], elige_mesa: 'no',
    duracion: '3 horas', edad_sugerida: 'desde 12 años', direccion: '[EJEMPLO] Calle Falsa 123, Bogotá',
    vigente_desde: '2026-10-20', vigente_hasta: '2026-12-31', version: 'ejemplo-sushi-1', fecha_ficha: '2026-10-26',
  }),
  ejemplo('fun.ejemplo-sushi-1', { tipo: 'funcion', id: 'f-sushi-1', experiencia: 'ejemplo-sushi-1', inicio: '2026-10-25T10:00:00-05:00' }),
];

/** La cena de película [EJEMPLO] de la semilla y sus horarios. */
const esDeLaPelicula = (f: Ficha): boolean => f.clave === CLAVE_EXPERIENCIA || (f.clave.startsWith('fun.') && f.valores?.experiencia === 'ejemplo-cena-1');

/** El catálogo con una sola experiencia: la cata. La cena de película (y la vencida) salen. */
export const soloCata = (fichas: Ficha[]): Ficha[] =>
  [...fichas.filter((f) => !esDeLaPelicula(f) && f.clave !== 'cat.ejemplo-vencida'), ...FICHAS_CATA];

/** La cata y la cena de película vigentes a la vez. */
export const cataYPelicula = (fichas: Ficha[]): Ficha[] => [...fichas, ...FICHAS_CATA];

/** Tres experiencias vigentes: la cena de película, la cata y la clase de sushi. */
export const tresExperiencias = (fichas: Ficha[]): Ficha[] => [...fichas, ...FICHAS_CATA, ...FICHAS_SUSHI];
