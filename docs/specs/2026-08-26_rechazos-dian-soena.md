# Rechazos de la DIAN en SOENA — qué se descartó y qué queda

Fecha: 2026-08-26. Motivo reportado por Diana: *"no coincide la información con el RUT"*.
Facturas involucradas: FV-2-243 (V0103), FV-2-244 (V0189), FV-2-245 (V0149), FV-2-246 (V0168).

## Resuelto: FV-2-244

Se facturó a la cédula **8081571** cuando el RUT dice **80815711**. Causa: `nit_sin_dv`
adivinaba el último dígito como DV (acierta por azar ~1 de cada 11) y la marca
`metadata.siigo_cliente` guardaba el resultado. Arreglado en dos partes:

- [#394](https://github.com/bi-metrik/metrik-one/pull/394) — la extracción dejó de recortar.
- [#413](https://github.com/bi-metrik/metrik-one/pull/413) — la marca se compara con el RUT antes de reusarla, así los
  21 terceros ya guardados mal se reparan solos al próximo intento de facturar.

## Descartado para las otras tres

Se comparó campo por campo lo que ONE mandó contra lo que dice el RUT extraído:

| Qué se revisó | FV-2-243 | FV-2-245 | FV-2-246 |
|---|---|---|---|
| Cédula enviada = cédula del RUT | ✅ | ✅ | ✅ |
| DV del RUT = DV real (módulo 11) | ✅ | ✅ | ✅ |
| Nombres y apellidos desglosados | ✅ | ✅ | ✅ |
| Dirección, municipio, departamento | ✅ | ✅ | ✅ |
| Correo | ✅ | ✅ | ✅ |
| Fecha de emisión en hora Colombia | ✅ | ✅ | ✅ |
| Concepto (producto 11) | ✅ | ✅ | ✅ |

**Del lado de ONE las tres están limpias.** El defecto está donde no alcanza esta medición:
en el tercero tal como quedó guardado en Siigo, o en un campo que ONE no lee del RUT.

## Los dos campos que ONE manda sin leerlos del RUT

Son los únicos candidatos que quedan dentro del código, y los dos son suposiciones fijas:

1. **`vat_responsible: false`** ([mapeo.ts](../../src/lib/siigo/mapeo.ts)) — hardcodeado para todo adquiriente. El bloque
   `rut` ni siquiera extrae las responsabilidades fiscales (casilla 53), así que no hay
   con qué contrastarlo. Si el adquiriente es responsable de IVA, esto contradice su RUT.
2. **`id_type: '13'` (cédula de ciudadanía)** — `codigoTipoDocumento` devuelve `'31'` (NIT) solo
   si el RUT dice "jurídica" o "NIT". Toda persona natural sale como CC. Pero las cuatro
   tienen RUT **con DV** (casilla 6), o sea están inscritas: su documento fiscal ante la
   DIAN es el NIT, no la cédula.

Ninguna de las dos se puede confirmar sin ver el rechazo real. No las cambien a ciegas:
mover `id_type` a NIT para todos rompería a quien no esté inscrito.

## Un defecto distinto, ya latente

Aparte del DV: **21 RUT de SOENA tienen el DV mal leído** por la extracción (el valor de la
casilla 6 no coincide con el módulo 11 del número), y **16 de esos terceros ya están creados
en Siigo con ese DV**. Ninguna de las facturas emitidas hasta hoy está entre ellos, así que
no explica estos rechazos, pero sí es la próxima tanda si se factura la cola tal como está.

Arreglo natural: el DV es determinista, así que no hay razón para creerle a la extracción.
Calcularlo siempre y usar el del RUT solo para avisar cuando difieren.

## Cómo cerrar el diagnóstico

Abrir en Siigo el tercero de una de las tres (por ejemplo 79626040, Luis Eduardo Acosta
Medina) y comparar contra su RUT: nombre completo, tipo de documento, dígito de
verificación y responsabilidad de IVA. Eso distingue entre las dos hipótesis de arriba en
un minuto, y es lo único que falta.

## Nota de método

Este diagnóstico se hizo solo con datos de ONE. No se pudo consultar la API de Siigo desde
la máquina local: el `curl` lo bloquea el clasificador de permisos y `scripts/check-siigo.ts`
lo bloquea el hook `code-ownership-one`.
