// ============================================================
// Un PDF de una página con texto, hecho a mano (sin dependencias), para los soportes SINTÉTICOS del arnés y las pruebas
// ------------------------------------------------------------
// Helvetica con WinAnsiEncoding: tildes y eñes sí; flechas y emojis no. Los datos son inventados (no hay datos de
// clientes): el recibo de Uber de $6.880 en Bogotá del 21-oct-2026 que reproduce el caso del 2026-10-21.
// Regenerar los archivos: `deno run -A --node-modules-dir=none supabase/functions/_shared/agente/arnes/soportes/pdf-minimo.ts`
// ============================================================

/** Un renglón: texto, tamaño de letra y posición (puntos desde abajo a la izquierda). */
export interface Renglon { texto: string; x: number; y: number; tam?: number; negrita?: boolean }

const latin1 = (s: string): number[] => [...s].map((c) => {
  const n = c.charCodeAt(0);
  return n < 256 ? n : 63; // fuera de Latin-1: «?»
});
const escaparPdf = (s: string) => s.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');

/** El PDF (bytes) con esos renglones en una página tamaño carta. Pura. */
export function pdfMinimo(renglones: Renglon[], titulo = 'Soporte sintético'): Uint8Array {
  const flujo = renglones.map((r) => `BT /${r.negrita ? 'F2' : 'F1'} ${r.tam ?? 11} Tf ${r.x} ${r.y} Td (${escaparPdf(r.texto)}) Tj ET`).join('\n');
  const flujoBytes = latin1(flujo);
  const objetos: Array<number[]> = [
    latin1('<< /Type /Catalog /Pages 2 0 R >>'),
    latin1('<< /Type /Pages /Kids [3 0 R] /Count 1 >>'),
    latin1('<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R /F2 5 0 R >> >> /Contents 6 0 R >>'),
    latin1('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>'),
    latin1('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>'),
    [...latin1(`<< /Length ${flujoBytes.length} >>\nstream\n`), ...flujoBytes, ...latin1('\nendstream')],
    latin1(`<< /Title (${escaparPdf(titulo)}) /Producer (MeTRIK arnes) >>`),
  ];
  const salida: number[] = [...latin1('%PDF-1.4\n%'), 0xe2, 0xe3, 0xcf, 0xd3, 10];
  const offsets: number[] = [];
  objetos.forEach((o, i) => {
    offsets.push(salida.length);
    salida.push(...latin1(`${i + 1} 0 obj\n`), ...o, ...latin1('\nendobj\n'));
  });
  const xref = salida.length;
  salida.push(...latin1(`xref\n0 ${objetos.length + 1}\n0000000000 65535 f \n`));
  for (const off of offsets) salida.push(...latin1(`${String(off).padStart(10, '0')} 00000 n \n`));
  salida.push(...latin1(`trailer\n<< /Size ${objetos.length + 1} /Root 1 0 R /Info ${objetos.length} 0 R >>\nstartxref\n${xref}\n%%EOF\n`));
  return new Uint8Array(salida);
}

/** El recibo sintético de Uber del caso real (2026-10-21): $6.880, Bogotá, 21 de octubre de 2026. */
export function reciboUberSintetico(): Uint8Array {
  return pdfMinimo([
    { texto: 'Uber', x: 60, y: 720, tam: 28, negrita: true },
    { texto: 'Gracias por viajar, Ana', x: 60, y: 690, tam: 14 },
    { texto: '21 de octubre de 2026, 7:42 a. m.', x: 60, y: 668 },
    { texto: 'Total', x: 60, y: 630, tam: 18, negrita: true },
    { texto: 'COP 6.880', x: 420, y: 630, tam: 18, negrita: true },
    { texto: 'Tarifa del viaje', x: 60, y: 600 },
    { texto: 'COP 6.880', x: 420, y: 600 },
    { texto: 'UberX  -  3,1 km  -  14 min', x: 60, y: 560 },
    { texto: 'Origen: Carrera 7 # 71-21, Bogotá', x: 60, y: 540 },
    { texto: 'Destino: Calle 26 # 59-41, Bogotá', x: 60, y: 522 },
    { texto: 'Pagado con Visa terminada en 0000', x: 60, y: 490 },
    { texto: 'Recibo de viaje generado para pruebas (sintético).', x: 60, y: 440, tam: 9 },
  ], 'Recibo de viaje Uber');
}

/**
 * La solicitud de viaje sintética de la bandeja (2026-10-21): lo que un cliente le manda a la agencia en PDF (destino,
 * fechas, viajeros con edades, hotel, presupuesto). Inventado: Laura Prueba, San Andrés, 8-13 de enero de 2027.
 */
export function solicitudViajeSintetica(): Uint8Array {
  return pdfMinimo([
    { texto: 'Solicitud de viaje', x: 60, y: 720, tam: 24, negrita: true },
    { texto: 'Familia Prueba', x: 60, y: 692, tam: 14 },
    { texto: 'Destino: San Andrés (Colombia)', x: 60, y: 650 },
    { texto: 'Salida: 8 de enero de 2027, desde Medellín', x: 60, y: 630 },
    { texto: 'Regreso: 13 de enero de 2027', x: 60, y: 610 },
    { texto: 'Viajeros:', x: 60, y: 580, negrita: true },
    { texto: '- Laura Prueba, 38 años', x: 75, y: 562 },
    { texto: '- Andrés Prueba, 40 años', x: 75, y: 544 },
    { texto: '- Sofía Prueba, 9 años', x: 75, y: 526 },
    { texto: '- Tomás Prueba, 1 año', x: 75, y: 508 },
    { texto: 'Hotel: 4 estrellas, plan todo incluido, frente al mar', x: 60, y: 476 },
    { texto: 'Presupuesto: hasta COP 9.000.000 en total', x: 60, y: 456 },
    { texto: 'Documento generado para pruebas (sintético).', x: 60, y: 410, tam: 9 },
  ], 'Solicitud de viaje');
}

if (import.meta.main) {
  const dir = new URL('.', import.meta.url);
  await Deno.writeFile(new URL('recibo-uber-sintetico.pdf', dir), reciboUberSintetico());
  await Deno.writeFile(new URL('solicitud-viaje-sintetica.pdf', dir), solicitudViajeSintetica());
  console.log('recibo-uber-sintetico.pdf y solicitud-viaje-sintetica.pdf escritos');
}
