---
name: certificado-correo-contacto
description: Ajuste a #896 (2026-09-24): fuera el cruce VIN; el certificado UPME se cruza por CORREO contra @contacto + RUT y SOLO AVISA; el celular no se cruza (el certificado no lo trae); migración 20260925010000 SIN aplicar; certificados viejos sin correo hasta el backfill
metadata:
  type: project
---

2026-09-24, pedido de Mauricio sobre [[voto-entre-fuentes]].

- **`@contacto`** (`SLUG_CONTACTO` en `fuentes-negocio.ts`): pseudo-bloque con `contactos(nombre, telefono, email)` del negocio; `contextoFuentesDelNegocio` solo consulta `negocios` si alguien lo pide. NO sirve en una `condition` (la resuelve `condicion_cumplida` en SQL).
- **Modo `correo`** en `comparar-valores.ts`: minúsculas, sin espacios, tolera solo 1/l y 0/o (la IA leyó «diegotamayol» donde el PDF dice «diegotamayo1», V0208). No hay modo `celular`: **el certificado no trae teléfono** (1 de 47 PDFs, carta del formato viejo).
- **Medido sobre los 315 certificados abiertos** (Drive + la misma extracción, sin escribir): 12 discrepancias; solo V0210 («hotmaiol») y quizá V0326 son errores. El resto: correo dado a propósito (trabajo, familiar, asesor, `notificacionesupme@gmail.com`), RUT mal leído por la IA (V0309) o RUT que no aplica por falta de `tipo_persona` (V0089). Por eso **solo avisa** (`bloquea_en_etapas: []`); con [9,18] hoy frenaría solo V0515.
- ⚠️ Los certificados ya cargados no tienen `correo_certificado`: el cruce calla hasta correr `scripts/backfill-compradores-factura.ts soena --bloque concepto_upme --campos correo_certificado,correo_certificado_2` (y `concepto_upme_anexos`). Ese script escribe `{value:null, manual:true}` cuando no lee un campo (casi siempre `correo_certificado_2`).

**Why:** el VIN no está en el certificado (0/47) y `vin_certificado` solo invitaba a la IA a inventarlo.

**How to apply:** la migración va antes o después del merge (el código viejo descarta el modo desconocido). Para medir un campo nuevo de extracción sin escribir: tsx en el worktree que baja el PDF con `downloadDriveFile` y llama `extractFieldsFromDocument` con los campos leídos del bloque `$tag$` de la migración, con caché JSON (315 PDFs ≈ 6 min).
