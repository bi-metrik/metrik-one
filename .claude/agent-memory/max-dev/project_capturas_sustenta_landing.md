---
name: capturas-sustenta-landing
description: Las 6 capturas del módulo compliance para la landing de AFI (Sustenta) son datos FICTICIOS; el lockup "MéTRIK sustenta" es SOLO para la captura; las erratas de tilde del producto ya se corrigieron (PR #613)
metadata:
  type: project
---

Entregadas el 2026-09-10 en
`/home/mauricio/Developer/metrik/proyectos/afi/landing/docs/entrega/sustenta/capturas/`
(6 PNG, 1440 px de ancho): matriz, listado de riesgos, detalle de evento con causas y
controles, listado de controles, detalle de control y la misma pantalla vista por un
auditor de solo lectura. **Segunda pasada el mismo día**: lockup `MéTRIK sustenta` y
tildes correctas.

**Why:** la landing es pública y ALMA es un cliente real; el encargo prohibía exponer
nombres de contrapartes, cédulas, NIT o personas. Se descartó capturar producción y se
montó un workspace ficticio ("Concesión Vial Demo", usuario "Usuario Demo", responsables
por CARGO y no por nombre propio) con 4 eventos SARLAFT, 12 causas y 13 controles.
Método completo en [[capturas-ui-sin-servidor]].

**How to apply:**

- ⚠️⚠️ **El lockup `MéTRIK sustenta` NO está en el producto.** Se aplica editando a mano
  `app-shell.tsx` (líneas ~544-545), se fotografía y **se revierte**. Que el módulo cambie
  de marca en la aplicación es decisión de producto que Mauricio no ha tomado. La spec del
  lockup sale del HTML de la landing (`docs/entrega/sustenta/Main.dc.html`), no se inventa:
  `MéTRIK` peso 700 + `sustenta` peso 400 con `letter-spacing: 0.16em` y
  `margin-left: 0.16em`, línea de 2 px en **#6FB89D**. En el sidebar `--sidebar-linea` ya
  vale `var(--acento-claro)` = #6FB89D, así que **la línea no hay que tocarla**.
- ✅ **CERRADO el 2026-09-10 (PR #613, mergeado).** Las nueve etiquetas que las capturas
  corregían «por encima del producto» ya están con tilde en `main`, más **26 del mismo tipo**
  en esas mismas pantallas (35 caracteres en 31 líneas, 7 archivos). **La landing y el
  producto ya coinciden**: la excepción que decía «si alguien pide que coincidan, el arreglo
  es un PR de producto» quedó ejecutada. Lo que **sigue sin tilde a propósito**:
  `src/lib/actions/riesgos.ts` (hoja «Instrucciones» de la plantilla de Excel, documento
  generado y no interfaz, con el bloque entero sin tildes de forma consistente) y
  `movimientos/movimientos-client.tsx` (otro módulo). El lockup `MéTRIK sustenta` **sí**
  sigue siendo solo de la foto: eso no se tocó.
- **El detalle de control se recorta antes de las tres tarjetas «Próximamente»** (workflow
  de ejecución, próxima ejecución, historial): el brief de `bloque-servicios-v1.md` prohíbe
  anunciar lo que no está desplegado. Alto de ventana 762 px.
- ⚠️ **El detalle del riesgo muestra MENOS controles que el listado, y está bien.**
  `riesgos_controles.causa_id` es UNA columna (la causa primaria) y el detalle agrupa por
  ella; el listado cuenta la junction M:N `control_causa`. Por eso LA-C01 sale con badge
  «4» en el listado y con «CONTROLES (3)» en el detalle. No es un descuadre del dataset:
  reproducirlo es lo fiel al modelo.
- ⚠️ **`clasificacion` del control admite `manual | automatico | hibrido` en el formulario
  del producto**, y el dataset de demo usa `semiautomático`, que ese selector no ofrece.
  Es columna de texto, así que un cargue podría ponerlo, pero conviene saberlo si alguien
  compara la captura con la pantalla de creación.
- **ONE no tiene ninguna pantalla que muestre la matriz de permisos por rol**: el permiso
  vive en `src/lib/roles.ts` y se manifiesta como botones presentes o ausentes. Por eso la
  captura 06 es la MISMA pantalla con rol `read_only` (solo Plantilla y Exportar, sin
  Importar ni Nueva causa, y el sidebar sin Responsables ni Expediente).

⚠️ **La tabla «Permisos compliance por rol» de `proyectos/afi/alma/CONTEXT.md` está
desactualizada.** Dice que `supervisor` crea, edita e importa; `roles.ts` le da
`canEditRiesgos:false`, `canImportRiesgos:false` y solo `canExportRiesgos:true` (el cambio
es del commit `d066854`, 2026-05-31: «Supervisor pierde edit»). Por eso la captura del
oficial de cumplimiento se hizo con rol `admin`. Antes de citar esa tabla, leer `roles.ts`.

Relacionado: [[valida-paquete-documental-v11]].
