---
name: certificado-ubicacion
description: 2026-09-28 — el certificado UPME se cruza por departamento, ciudad y dirección contra el RUT (modo nuevo `direccion`); migración 20260928213000 SIN aplicar; SOLO AVISA; el push lo bloqueó el clasificador por datos de producción en el commit
metadata:
  type: project
---

Continuación de [[certificado-correo-contacto]]. Rama `max/soena-certificado-ubicacion`.

- **Modo `direccion`** (`src/lib/negocios/direccion-predio.ts`): placa (números de la vía con su letra, en orden) + tipo de vía del primer número (`av` es comodín) + unidades comunes a los dos lados. Ignora barrio/edificio, Sur/Norte/Bis, «#»/«N°»/«numero» y pliega homoglifos griegos/cirílicos (la lectura del PDF los mete: «ΤΟ 1 ΑΡ»).
- **Medido 2026-09-28 en 321 certificados abiertos (solo lectura):** 283 direcciones iguales letra a letra; departamento 15 avisos y ciudad 19 con `contenido`; dirección 13 con `direccion` (32 con `compacto`). 29 casos con aviso.
- ⚠️ **La mitad de los avisos revisados eran el RUT mal leído en ONE, no el certificado** (V0129, V0258, V0326: el PDF del RUT dice lo mismo que el certificado). Ese dato también alimenta el Formato 010. Por eso solo avisa.
- ⚠️ **~16 casos traen en el certificado otra ciudad con la MISMA dirección del RUT** (V0398 Bogotá vs Bucaramanga; varios «BOGOTÁ D.C.» contra municipios de Cundinamarca). Es el hallazgo de negocio del frente.
- Backfill tras aplicar: `npx tsx scripts/backfill-compradores-factura.ts soena --bloque concepto_upme --campos departamento_certificado,ciudad_certificado,direccion_certificado,departamento_certificado_2,ciudad_certificado_2,direccion_certificado_2` (y `concepto_upme_anexos`), sin `--commit`.

**Why:** V0129 volvió a reproceso el 22-sep por un dato mal en el certificado (radicar de nuevo = tarifa doble).

**How to apply:** ⚠️ el `git push` de este frente lo negó el clasificador («Sensitive-Source Provenance») porque el commit traía direcciones reales de clientes en las pruebas; después se negó hasta `git status`. **Las pruebas de un comparador medido en producción van con datos INVENTADOS que reproducen el patrón**, nunca con los valores del cliente. Los reportes de medición pueden citar códigos de caso, no direcciones ni nombres.
