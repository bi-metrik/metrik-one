---
name: capturas-sustenta-landing
description: Las 6 capturas del módulo compliance para la landing pública de AFI (Sustenta) son datos FICTICIOS, no ALMA; y la tabla de permisos del CONTEXT.md de ALMA está desactualizada frente a roles.ts
metadata:
  type: project
---

Entregadas el 2026-09-10 en
`/home/mauricio/Developer/metrik/proyectos/afi/landing/docs/entrega/sustenta/capturas/`
(6 PNG, 1440 px de ancho): matriz, listado de riesgos, detalle de evento con causas y
controles, listado de controles, detalle de control y la misma pantalla vista por un
auditor de solo lectura.

**Why:** la landing es pública y ALMA es un cliente real; el encargo prohibía exponer
nombres de contrapartes, cédulas, NIT o personas. Se descartó capturar producción y se
montó un workspace ficticio ("Concesión Vial Demo", usuario "Usuario Demo", responsables
por CARGO y no por nombre propio) con 4 eventos SARLAFT, 12 causas y 13 controles.
Método completo en [[capturas-ui-sin-servidor]].

**How to apply:**
- Las capturas **no** son de ALMA y no hay que tratarlas como dato de cliente. Si alguien
  pide "actualizarlas con datos reales", eso cambia la clase del entregable y necesita
  decisión de Mauricio, no una recaptura.
- El **detalle de control** se recortó a propósito antes de las tres tarjetas
  «Próximamente» (workflow de ejecución, próxima ejecución, historial). El brief de
  `bloque-servicios-v1.md` prohíbe anunciar lo que no está desplegado; el bloque completo
  existe en el producto y se puede volver a capturar si alguna vez se despliega.
- **ONE no tiene ninguna pantalla que muestre la matriz de permisos por rol**: el permiso
  vive en `src/lib/roles.ts` y se manifiesta como botones presentes o ausentes. Por eso la
  captura 06 es la MISMA pantalla con rol `read_only` (solo Plantilla y Exportar, sin
  Importar ni Nueva causa, y el sidebar sin Responsables ni Expediente). Inventar una
  pantalla de permisos para la landing sería mostrar algo que no existe.

⚠️ **La tabla «Permisos compliance por rol» de `proyectos/afi/alma/CONTEXT.md` está
desactualizada.** Dice que `supervisor` crea, edita e importa; `roles.ts` le da
`canEditRiesgos:false`, `canImportRiesgos:false` y solo `canExportRiesgos:true` (el cambio
es del commit `d066854`, 2026-05-31: «Supervisor pierde edit»). Por eso la captura del
oficial de cumplimiento se hizo con rol `admin`. Antes de citar esa tabla, leer `roles.ts`.

Relacionado: [[valida-paquete-documental-v11]].
