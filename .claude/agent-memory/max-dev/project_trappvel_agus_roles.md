---
name: project-trappvel-agus-roles
description: Roles de Trappvel sobre la bandeja de viajes (mano_derecha viajes+ONE, asesor_viajes), 29-oct; datos de personas FUERA del repo (asignaciones.json); arnés con Haiku sin Gemini; SQL SIN aplicar; trampas de dos motores
metadata:
  type: project
---

Rama `feat/trappvel-agus-roles-v2` (29-oct; la v1 no se pudo subir: el clasificador negó el push por datos del cliente).
La bandeja es el motor `viajes` (`equipo.viajes_*`, `equipo.clientes_viaje`, `equipo.autorizacion_datos`);
`atenderConAgente` resuelve el rol con `bandeja/turno-con-rol.ts`. Sin roles en `wa_one` el camino de hoy NO se compone.

**Datos del cliente fuera del repo (decisión de Mauricio, 29-oct: «limpia la rama»):** nombres, ids de staff/colaborador
y teléfonos viven en `proyectos/trappvel/clarity/docs/asistente/roles/asignaciones.json`; ahí mismo los bancos y los SQL
generados. `roles-trappvel-sql.ts --asignaciones <json>` los escribe en esa carpeta. Pruebas con uuids y teléfonos
inventados (`57000…`, nunca `573…`). Un push de ONE con celulares o nombres reales lo niega el clasificador.

**Estado:** SQL SIN aplicar; los bancos de la carpeta dicen `pasa:false` (la corrida con Gemini murió por el tope de
gasto de la llave, HTTP 429). El arnés ya corre con Haiku (`--proveedor anthropic`, por defecto) y solo pide
ANTHROPIC_API_KEY, que la torre no tiene: la corrida k=3 la hace la sesión principal.

Lo no obvio:
- Arnés con Haiku = `proveedor-haiku.ts`: entorno FIJO (ni `LLM_PROVEEDOR=gemini` ni `LLM_PROVEEDOR_SOPORTES` lo
  cambian) y un fetch que solo sale a api.anthropic.com; un pedido bloqueado deja la corrida sin banco (exit 4).
  `fetchModelo` a secas cae a Gemini en silencio si falta la llave de Anthropic: por eso no basta con él.
- Dos motores en un turno (`componer.ts`): un SOLO preparador de adjuntos; vencimiento de propuesta POR ACCIÓN
  (`Dominio.venceConRespuesta`); propiedades de `proponer` repetidas se unen; `config.topes.bloques` sube el tope.
- `huellaPublicable` NO quita `herramientas: []`: el SQL guarda `'{}'::text[]`, no null.
- El paso 0 del SQL compara la huella de la bandeja PUBLICADA con la base del código; si la agencia ajustó fichas, se
  exportan y se usa `--fichas-base`. Las fichas reales de prod no se leyeron.
- Quien entra como colaborador (sin `staff.phone_whatsapp`) no es equipo comercial para la bandeja: «la llevo yo» no lo
  elige. El UPDATE que lo arregla va comentado en la cabecera (`staff_sin_telefono` del JSON).
- Falla heredada de la bandeja: propone el viaje con quien escribe sin que lo diga (r-lista 0/3 en la base).

**Why:** Mauricio aprobó los dos roles el 29-oct; publicar exige un banco que pase con k=3.
**How to apply:** correr línea base y roles con Haiku (comandos en `docs/asistentes/roles-trappvel.md`), regenerar en la
carpeta del proyecto y desplegar wa-webhook ANTES del SQL. Ver [[project-spec-asistentes-roles]] y [[project-paso-a-persona]].
