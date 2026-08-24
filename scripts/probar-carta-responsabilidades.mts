/**
 * Prueba de humo del PDF de la carta de asignación de responsabilidades.
 *
 * Un PDF que compila no es un PDF que renderiza: `@react-pdf/renderer` falla en
 * tiempo de ejecución ante estilos que TypeScript acepta. Esto lo genera de
 * verdad, con los dos estados que la carta tiene que saber pintar (sin aceptar y
 * ya aceptada) y con los huecos que el documento debe rellenar solo (actividad y
 * periodicidad ausentes).
 *
 * No toca la base ni la red: datos de ejemplo en el propio archivo.
 *
 *   npx tsx scripts/probar-carta-responsabilidades.mts
 */

import { writeFileSync } from 'node:fs';
import { generarPDFCartaResponsabilidades } from '../src/lib/compliance/pdf-carta-responsabilidades';

const buf = await generarPDFCartaResponsabilidades({
  workspace_nombre: 'ALMA (AFI International Group)',
  cargo_id: '3f2a91c4-0000-4000-8000-000000000001',
  cargo_nombre: 'Coordinador jurídico predial',
  controles: [
    {
      referencia: 'CTL-009',
      nombre_control: 'Validación en listas cautelares de propietarios de predios a adquirir',
      actividad_control:
        'Consulta en listas vinculantes y restrictivas de propietarios de predios antes de la adquisición.',
      periodicidad: 'continuo',
      tipo_control: 'preventivo',
      evidencia: null,
    },
    {
      referencia: 'CTL-011',
      nombre_control: 'Validación adquisición de predios',
      actividad_control: 'Verificación integral de certificados de libertad y tradición.',
      periodicidad: 'continuo',
      tipo_control: 'preventivo',
      evidencia:
        'Certificado de libertad y tradición con fecha de expedición no mayor a 30 días, archivado en el expediente del predio.',
    },
    {
      // Sin actividad ni periodicidad: el documento tiene que decir qué falta,
      // no dejar el renglón vacío.
      referencia: 'CTL-010',
      nombre_control: 'Validación de unidades sociales',
      actividad_control: null,
      periodicidad: null,
      tipo_control: 'detectivo',
      evidencia: null,
    },
  ],
  emitida_por_nombre: 'Yessica Vásquez',
  emitida_en: new Date().toISOString(),
  aceptacion_previa: null,
});
writeFileSync('/tmp/carta-sin-aceptar.pdf', buf);
console.log('sin aceptar → /tmp/carta-sin-aceptar.pdf', buf.length, 'bytes');

const buf2 = await generarPDFCartaResponsabilidades({
  workspace_nombre: 'ALMA (AFI International Group)',
  cargo_id: '3f2a91c4-0000-4000-8000-000000000002',
  cargo_nombre: 'Tesorero',
  controles: [
    {
      referencia: 'CTL-008',
      nombre_control: 'Validación de pagos',
      actividad_control:
        'Verificación de requisitos mínimos de pago a personas naturales y jurídicas.',
      periodicidad: 'continuo',
      tipo_control: 'preventivo',
      evidencia: null,
    },
  ],
  emitida_por_nombre: 'Yessica Vásquez',
  emitida_en: new Date().toISOString(),
  aceptacion_previa: { persona_nombre: 'Carlos Peña', fecha_aceptacion: '2026-08-15' },
});
writeFileSync('/tmp/carta-aceptada.pdf', buf2);
console.log('aceptada → /tmp/carta-aceptada.pdf', buf2.length, 'bytes');
