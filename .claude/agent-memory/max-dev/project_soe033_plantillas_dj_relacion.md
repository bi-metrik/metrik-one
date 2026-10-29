---
name: project-soe033-plantillas-dj-relacion
description: SOE-033 (29-oct) — DJ y Relación de facturas de SOENA con plantilla del 28-oct; migración 20261029114700 SIN aplicar; DJ copropiedad en 2 páginas
metadata:
  type: project
---

PR #1329 (feat/soe-033-plantillas-soena): DJ y Relación de facturas pasan a las plantillas que mandó Deisy el 2026-10-28,
aprobadas por Mauricio TAL CUAL.

- Migración `20261029114700_relacion_facturas_plantilla_soe033.sql` **SIN aplicar** al abrir el PR. Copia `fecha_factura`,
  `numero_caso_upme` y `fecha_certificado` de la config VIVA de la DJ (f2878f39) con un SELECT, sin transcribirlos. Toca la
  copia de Envío 2f7c6a0b solo si conserva `template = relacion-facturas`. No se sabe desde el repo si la copia hereda: el
  dry-run lo dice.
- El componente lee los tres campos como opcionales: sin migración, la ficha sale con «—» en esas casillas.
- La DJ con dos titulares pasa a 2 páginas. El bloque de ciudad, fecha y firmas va junto con `wrap={false}`.
- `nit_proveedor` ya llega SIN DV (normalizado con `nit_sin_dv` desde 2026-06-29): por eso `nitBaseYDv` no pasa por
  `separarNitDv`. La Relación vieja (`nitConGuion`) recortaba los NIT limpios, como el de Bancolombia.
- Con Helvetica, `textoDelPDF` devuelve las rayas «–» y «—» como \x96 y \x97: la prueba las normaliza antes de buscarlas.

**Why:** son documentos que van a la DIAN y se firman bajo juramento. Sin radicado, ningún documento afirma el certificado.
**How to apply:** antes de cambiar otra vez estas plantillas, mira las pruebas de texto del PDF. Si Deisy confirma el texto
degradado sin UPME, quita el PENDIENTE de la nota 3 de la DJ.
