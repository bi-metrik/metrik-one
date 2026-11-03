---
name: feedback-datos-cliente-fuera-del-repo
description: Celulares, nombres e ids de personas de un cliente no van a metrik-one (ni código, ni docs, ni memoria): el clasificador niega el push; van a proyectos/<cliente>/
metadata:
  type: feedback
---

Nada de datos personales reales de un cliente en ningún commit de metrik-one: celulares (573…), nombres de su gente,
uuids de staff o colaboradores. Tampoco en comentarios, SQL generado, bancos del arnés ni en esta memoria. El código
recibe esos datos por un JSON que vive en `proyectos/<cliente>/<proyecto>/…` y escribe ahí lo generado; las pruebas
usan datos inventados (uuids `00000000-0000-4000-8000-…`, teléfonos `57000…`). El uuid del workspace y el número de
MeTRIK (ya público) sí pueden ir.

**Why:** 29-oct, la rama de roles de Trappvel no se pudo subir: el clasificador negó el push por exfiltración de datos
del cliente y hubo que rehacerla limpia (v2). Mauricio: «limpia la rama».
**How to apply:** antes del primer commit, si el trabajo toca personas reales de un cliente, separar los datos al JSON
externo; al cerrar, `git log -p origin/main..HEAD` con grep de `\b(57)?3\d{9}\b`, uuids y los nombres. Ver
[[project-trappvel-agus-roles]].
