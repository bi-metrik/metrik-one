---
name: alta-4dsoft-one
description: Alta de 4D SOFT en ONE (workspace, contrato, usuario, documentos) preparada el 2026-09-16 y ya ejecutada (medido el mismo día); mis_documentos_de_servicio muestra la aceptacion de PRUEBA de Mauricio; la comision es de AFI, no de Yessica
metadata:
  type: project
---

⚠️ CADUCÓ el «sin ejecutar» (medido 2026-09-16 por PostgREST): el workspace, su contrato, Juan
Guillermo como owner y la versión v1.0 (`b91b4a14`) ya están en producción.

El 2026-09-16 quedó **preparada, sin ejecutar**, el alta de 4D SOFT para el módulo Valida API
(spec `proyectos/metrik/one/2026-09-15_spec-modulos-servicios-cobro.md` §5.2 y §5.4). Los archivos
viven en el scratchpad de la sesión `1077a39c` (`…/scratchpad/alta-4dsoft/`, efímero): 01 y 02 y 04a
son `DO` con interruptor `c_ensayo`, 03 y 04b son `.mjs` con `--apply`, y `verificacion/` trae las
lecturas. Lo corre la sesión principal.

**Lo que no se ve en el código:**
- ⚠️⚠️ **`mis_documentos_de_servicio()` (C2, #747) une la aceptación SOLO por la huella del PDF.**
  La prueba `41233b25` de Mauricio («Mauricio Moreno (PRUEBA)», representante_legal) usó el MISMO
  PDF que 4D SOFT (`85e6d157…`), así que con el documento cargado la pestaña Documentos lo muestra
  DOS veces. Corrección: exigir `a.negocio_id` entre los negocios de los contratos de ESA empresa
  que cubren al workspace. **PR #753 (2026-09-16), checks verdes, SIN mergear y migración
  `20260916213000` SIN aplicar**: la aplica la sesión principal y después mergea. md5 esperado del
  `prosrc`: `6a5976e946ecba1a74ac1032ccbc7a3d`. No se le avisa a Juan Guillermo antes.
  Las dos condiciones de la subconsulta (empresa y workspace) no las cubría ninguna prueba hasta
  sembrar un negocio que está en contratos de otra empresa y de otro workspace.
- **La comisión de 4D SOFT es de AFI** (empresa `ecc378c7`, NIT `902003244-6`), no de Yessica como
  persona: lo prueban el gasto `c8cd60c7` y el acta de cruce ACX-2026-09-001. La metadata del
  negocio dice «para Yessica»: se contradice con la contabilidad.
- `cargarReciboManual` no tiene botón: el recibo va por script con la misma marca.
- `workspace_modulos` estaba **vacía** en producción (la carga inicial de A1 nunca corrió).
- El `.md` de términos de Emilio trae notas internas después de `<!-- FIN-PDF -->`: `texto_md` se
  corta ahí (verificado palabra por palabra contra el PDF).

**Why:** medir cambió tres premisas de la spec (beneficiario de la comisión, botón del recibo, vínculo
por huella suficiente).

**How to apply:** antes de dar acceso a un cliente a Documentos, contar cuántas aceptaciones
`aceptado` comparten su `documento_sha256`. Una comisión se declara contra el tercero del gasto, no
contra el nombre de la metadata. Relacionado: [[modulo-valida-api-c2]], [[catalogo-servicios-a2]],
[[pruebas-por-mutacion]].
