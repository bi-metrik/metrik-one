---
name: project-soe026-028-descarga
description: SOE-026 «Descargar» de Drive va a uc?export=download; SOE-028 roles extra de descarga de Negocios por config_extra (Drive no se abre)
metadata:
  type: project
---

SOE-026 y SOE-028 en un PR (rama fix/soe026-028-descarga-excel, 2026-10-21). Sin migración.

- SOE-026: `hrefArchivo(url, {descargar:true})` manda URLs de drive.google.com a
  `uc?export=download&id=`. docs.google.com (Docs nativos) NO se reescribe: uc no los baja.
  `idDeArchivoDrive` se movió a referencia.ts (archivo-de-cobro la re-exporta; al revés es circular).
- SOE-028: clave `workspaces.config_extra.roles_descarga_negocios_extra` (array, SUMA al default).
  Para SOENA el valor es `["operator"]`; lo pone Mauricio en base.
  **Why:** la hoja «Subir a Drive» es una sola por workspace y se sobrescribe; un operator
  (que solo ve sus negocios) la dejaría parcial. Por eso Drive se queda en el default.
  **How to apply:** si piden abrir también «Subir a Drive» a operator, primero resolver la
  hoja por usuario o dejarla con todos los negocios; no basta con cambiar el gate.
