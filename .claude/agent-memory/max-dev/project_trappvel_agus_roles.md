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

**Estado (29-oct tarde):** #1327 mergeado; arreglos en `fix/trappvel-mano-derecha-arnes`. SQL SIN aplicar. La bandeja
publicada v3 (2026-10-14) = el código ordenado por clave + `herramientas` null: el paso 0 frena y hay que correr con
`--fichas-base` (export en el scratchpad de la sesión, fuera del repo).

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
- **El orden de las fichas cambia a Haiku.** `bot_publicar_reglamento` guarda por clave; el arnés corre con
  `ordenPublicado` desde el 29-oct. Con el orden del código av-yo pasaba 3/3; con el publicado, 0/3 (desde main). El
  `--excluir` sale de la base CON ese orden: c1-1140, r-fuera, r-ignora, r-cliente-nuevo, r-ambiguo, a-foto-anotar.
- Falla heredada de la bandeja: tras crear al cliente propone el viaje con quien escribe sin que lo diga
  (r-cliente-nuevo 2/3 en la base con el orden publicado). `dicho_en` solo exige que el #n exista; arreglarlo pide un
  invariante de respaldo (citar las palabras) y ~20 pruebas guionadas apuntan `dicho_en` a mensajes que no lo dicen.
- Una ficha de rol reescrita mueve casos lejanos: cambiar el texto de `g.natural` tumbó r-yo 3/3. Medir antes de
  tocar fichas compartidas por los dos roles.
- `cargar_tanda` lleva a la extracción lo que el comercial escribió al pedirla desde `fix/agus-cargar-tanda-con-escrito`
  (29-oct): 4º parámetro `pedido` de `prepararCarga` (`pedidoDeTanda`), numerado tras la tanda «escrito por el
  comercial» + `PARRAFO_PEDIDO`. Con él a-choque 3/3 en md, pero Haiku NO toma el 10: deja «por definir» con la duda
  (PARRAFO_DOCUMENTOS dice «no elijas»). Los bancos del 29-oct valen solo con ese PR desplegado.
- Quitar el nombre `cargar_tanda` de una frase de `g.viaje_o_gasto` tumbó md-yo a 0/3. Cada cambio de ficha = corrida.
- Las fichas de archivos de ONE (`g.soporte`…) dan por hecho que todo archivo es un gasto: en la mano derecha van con
  `cuando` acotado a recibos/comprobantes, o la solicitud en PDF se trata como soporte.

**Why:** Mauricio aprobó los dos roles el 29-oct; publicar exige un banco que pase con k=3.
**How to apply:** correr línea base y roles con Haiku (comandos en `docs/asistentes/roles-trappvel.md`), regenerar en la
carpeta del proyecto y desplegar wa-webhook ANTES del SQL. Ver [[project-spec-asistentes-roles]] y [[project-paso-a-persona]].
