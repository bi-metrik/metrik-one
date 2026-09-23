---
name: project-iva-ingreso-propio
description: IVA de la cotización sobre el ingreso propio (Trappvel) — #830 mergeado con el IVA ENCIMA; el modo iva_incluido (adenda 23-sep) va en PR aparte, y la config viva de Trappvel infla el total hasta aplicarlo
metadata:
  type: project
---

#830 mergeado (squash `1dd1f34c`): el IVA de una cotización va sobre precio − costo del
tercero, línea por línea, con UNA función (`src/lib/fiscal/iva-cotizacion.ts`) que usan
PDF, editor y «Aprobar». Ese PR SUMA el IVA encima del precio.

Adenda del 23-sep (Edgar: «ya va incluido en el precio»): rama `trappvel/iva-incluido-en-el-fee`,
modo `config_extra.iva_cotizacion.precio = 'iva_incluido'`. El total es el de la cascada,
el IVA se extrae (gravable × t/(100+t)), retenciones sobre la base neta, «Aprobar» = valor_total.
Sin la llave = `iva_aparte` = el #830 byte a byte. Sin DDL.

**Why:** regla fiscal de Felipe en `proyectos/trappvel/clarity/docs/diseno/brief-max-2026-09-22-iva-sobre-el-ingreso-propio.md`
(la adenda está al final). Si una de las tres superficies calcula por su cuenta, el comercial
cotiza una cifra y el documento o el cobro dicen otra.

**How to apply:**
- ⚠️⚠️ La config de Trappvel YA está viva desde el 2026-09-23 como `{base: ingreso_propio,
  en_documento: oculto}` SIN `precio` → hoy el código lee `iva_aparte` y cada PDF sale con
  el total inflado (0002: $15.881.609 en vez de $15.441.526). Medido ese día: 8 cotizaciones,
  todas en borrador, ningún `precio_aprobado` escrito. Se arregla con merge + deploy del PR
  de la adenda y DESPUÉS `proyectos/trappvel/clarity/migrations/2026-09-23_iva-ingreso-propio-config-PENDIENTE.sql`
  (ya reescrito: agrega `precio` y conserva el `en_documento` vivo).
- `iva_incluido` sobre una plantilla que no está en `plantillaImprimePreciosConIva` saca el
  PDF como borrador: su pie pintaría un IVA que el TOTAL no suma.
- Con el IVA adentro, el margen que muestra la cascada incluye ese IVA: 15 % bruto = 12,6 %
  neto. El piso de margen NO se tocó (decisión de precio de Edgar).
- Hallazgo del #830 que sigue vivo: `calcularFiscal` no reconoce `tax_regime = 'ordinario'`
  como responsable de IVA; el camino viejo se dejó intacto para los demás workspaces.
- Abierto: tableros (19 % estimado) y `v_negocio_valor` no leen esta regla.

Relacionado: [[project-margen-recargo-configurables-trappvel]], [[project-documento-cliente-trappvel]].
