# Encargo: los 149 instrumentos sin métricas, y por qué cada uno

*Para una sesión de agente que no conoce este proyecto. El entregable es un informe: **no
arregles nada ni calcules ninguna métrica**.*

## Qué es este proyecto, en cuatro líneas

Gestor Activos Financieros es una aplicación profesional para asesores de inversión: buscar
activos, analizar fichas, comparar productos, construir carteras y generar informes para
clientes. Son cinco repositorios Git independientes en la rama `gestor-activos-financieros`:
`1-extractor` (Python, extrae datos y **calcula las métricas**), `2-plataforma-datos`
(TypeScript, valida y carga hacia Firestore **contra contratos JSON Schema**),
`3-BDB-ACTIVOS_app` (React 19 + Vite + Firebase), `4-base-nueva` (el proyecto Firebase de la
base nueva) y la raíz, que guarda los documentos que gobiernan.

Hay **dos bases de datos**. La **nueva**, `bdb-gestor-de-activos`, emulador en
`127.0.0.1:8092`, que **persiste en disco**: es la de este encargo. La **vieja**,
`gestor-activos-local`, emulador en `127.0.0.1:8082`: no entra aquí. Lo que separa las dos
**es el puerto**, no el id de proyecto: los dos emuladores arrancan en `singleProjectMode` y
sirven con cualquier id. Para saber en qué base estás, mira el puerto.

## El estado, medido el 03-11-2026 sobre la base nueva

```
raíces de instrumento      : 1.091
con computed/metrics       : 942
SIN computed/metrics       : 149

por tipo                   : FUND 767, STOCK 305, ETF 18, OTHER 1
sin métricas, por tipo     : FUND 122, ETF 18, STOCK 8, OTHER 1
```

**Dos avisos sobre estas cifras, y el segundo importa más que el primero.**

Primero: por ahí circulaba «141 fondos y ETF sin métricas». Está mal, y lo está en dos
sentidos: son **149** y no 141, y no son solo fondos y ETF —hay **8 acciones** y **1 OTHER**
dentro—. Si te anclas en el 141 vas a buscar la explicación equivocada. Vuelve a contarlo tú
antes de empezar: si tu cuenta no da 149, dilo y averigua por qué difiere de esta en vez de
seguir.

Segundo, y es el hilo del que hay que tirar primero: **los 18 ETF son los 18 que hay.
Ninguno tiene métricas.** El 100 % de un tipo no se explica por datos que falten uno a uno;
se explica por código, por una condición del pipeline o por una fuente que no se consultó
nunca. Los 122 fondos sobre 767 pueden ser mil razones distintas; los 18 de 18 son **una**.
Empieza por ahí.

## La pregunta, y la forma exacta que tiene que tener la respuesta

Este proyecto no trata una ausencia como un agujero: la trata como un **hecho con razón
declarada**. Los contratos de `2-plataforma-datos/contracts/base-nueva/` llevan un campo
`x-absence` con **tres** razones posibles, y la diferencia entre ellas es toda la cuestión:

- `NOT_APPLICABLE` — no aplica a este instrumento. No falta nada.
- `NOT_PROVIDED` — aplica, y la fuente no lo da.
- `NOT_YET_FETCHED` — aplica, la fuente lo daría, y no se ha pedido.

Así que el entregable no es «faltan 149». Es: **de los 149, cuántos son de cada razón, y con
qué se demuestra cada clasificación.** Esa es la columna vertebral del informe. Un fondo sin
Sharpe porque su serie tiene ocho meses y la ventana pide tres años es `NOT_PROVIDED` y no
hay nada que arreglar; el mismo fondo sin Sharpe porque nadie pidió su serie es
`NOT_YET_FETCHED` y es trabajo pendiente. Las dos cosas se ven igual en la base y se deciden
al contrario.

### Por orden de valor

1. **Los 18 ETF.** La causa única, con fichero y línea. ¿Los excluye una condición del
   extractor? ¿Les falta la serie? ¿El escritor bloquea su raíz? ¿No se piden nunca?
2. **Los 122 fondos**, clasificados por causa y por razón de ausencia, con cuántos hay de
   cada una. No hace falta el detalle de los 122 uno a uno si los grupos están bien
   demostrados; sí hace falta decir cuántos en cada grupo.
3. **Las 8 acciones y el 1 OTHER.** Son pocos y por eso vale la pena nombrarlos uno a uno:
   un grupo pequeño suele ser el que enseña la causa de los grandes. Y dime **qué es** ese
   OTHER, porque un tipo con un solo miembro normalmente es un dato mal clasificado.
4. **Qué haría falta para cerrar cada grupo**, y qué grupos **no se cierran** porque la fuente
   no da el dato. Separa las dos cosas: lo segundo no es trabajo pendiente, es un techo.

## La lente que en este proyecto rinde más que ninguna

Busca **comprobaciones que no pueden fallar**: una respuesta válida afirmando otra cosa. Es el
defecto característico de aquí y ha aparecido cuatro veces en una semana. Un ejemplo real: un
chequeo de vida de la base construía una URL inválida que contestaba **200 con cero
documentos**, así que una base con 11.566 documentos dentro se informó como vacía, con el
código de estado diciendo que todo bien.

Y uno que te toca de cerca, porque es de este mismo terreno: la auditoría de contratos decía
«la base valida entera» mientras **no miraba** los documentos que cuelgan de una raíz que no
se escribió. No validaban ni dejaban de validar: nadie los miraba.

De cada cuenta que hagas pregúntate **qué tendría que pasar para que saliera mal sin que lo
notaras**. Una consulta que devuelve cero puede significar «no hay» o «he preguntado mal».

Y **distingue siempre lo que has comprobado de lo que supones.** Dilo en el informe, caso por
caso.

## Cómo leer la base, y qué puedes ejecutar

La base nueva se lee por REST con la cabecera `Authorization: Bearer owner`, que **salta las
reglas de seguridad** —en este proyecto están cerradas del todo, y sin esa cabecera una base
perfectamente viva contesta 403 y parece caída—:

```
http://127.0.0.1:8092/v1/projects/bdb-gestor-de-activos/databases/(default)/documents/instruments?pageSize=1
```

**No compruebes si el emulador está vivo mirando los puertos.** Está medido: ni
`Get-NetTCPConnection -State Listen` ni `netstat` listan el 8092 aunque esté sirviendo
peticiones, porque lo abre la JVM del emulador de Firestore. Pregúntale al servicio.

De solo lectura y seguros, desde `2-plataforma-datos`:

```
npm run audit:base-nueva     # lee la base y revalida cada documento contra su contrato
npm run baseNueva:plan       # dice qué escribiría, sin escribir
npm test                     # la batería entera
```

`npm run baseNueva:plan` te puede servir para una de las hipótesis: si un instrumento
aparecería como `crear` para `computed/metrics`, es que el escritor **hoy sí lo produciría** y
lo que pasa es que no se ha dado la pasada; si no aparece, es que el escritor no lo produce
para ese instrumento, y entonces la causa está antes, en el extractor o en la fuente.

Y el canónico del extractor, que es la entrada de todo esto, vive en `1-extractor/export_bdb/`.
Ahí se ve si la serie existe antes de preguntarse por qué no hay métrica.

## Prohibido, sin excepciones

- **Escribir en cualquiera de las dos bases**, y nada en la nube. La base nueva **persiste en
  disco**: un documento de prueba olvidado se queda.
- Abrir las puertas de entorno `BDB_DATA_PLATFORM_ENABLE_MASTER_WRITES` o
  `BDB_SUBIDA_A_LA_NUBE`.
- `firebase deploy`, `gcloud`, `git push`, y **commitear**: la carpeta está compartida con
  otras sesiones.
- Tocar `C:\Users\oanti\Proyectos\BDB` o su proyecto Firebase `bbdd-activos-financieros`.
  Leerlo como referencia puntual está bien; modificarlo, nunca.
- Modificar **ningún fichero** que no sea tu informe. En particular nada de
  `3-BDB-ACTIVOS_app`, que se está reescribiendo ahora mismo en otra sesión.
- **Calcular tú ninguna métrica.** Si un fondo no tiene Sharpe, el encargo es decir por qué no
  lo tiene, no ponerle uno. Las cifras que ve un asesor salen de su pipeline o no salen.
- Si una etapa dice «Project id fuera de la allowlist», **no** pongas
  `FIREBASE_PROJECT_ID=bbdd-activos-financieros`. Ese error no es un obstáculo: es la barrera
  funcionando.

## Antes de concluir nada, lee

1. `AGENTS.md` entero. Fija el papel con el que se decide aquí y las barreras.
2. `METODO_PROPIO_METRICAS_2026-11-01.md`: las fórmulas con su **ventana** y su **frecuencia**,
   que es lo que decide si una serie da para calcular o no. Sin esto no puedes distinguir
   `NOT_PROVIDED` de `NOT_YET_FETCHED`.
3. `DECISIONES_BASE_NUEVA_2026-11-01.md`. Su octava decisión manda sobre las demás en todo lo
   que toque métricas: **nos fiamos de la serie, no de la cifra, porque la serie se puede
   auditar.**
4. El contrato `contracts/base-nueva/instrument-computed-metrics.v2.schema.json` y su sistema
   de `x-applies-when` y `x-absence`. Las descripciones de los campos llevan el porqué de cada
   uno; no está repetido en ningún otro sitio.
5. `LEGADO_CONOCIMIENTO_SISTEMA_2026-07-12.md`: convenciones del extractor y de la plataforma
   que no están en el código y que es caro redescubrir.

## El entregable

Un fichero `INFORME_SIN_METRICAS_2026-11-03.md` en la raíz del proyecto. Cada hallazgo con
**dónde está** (fichero y línea, o la consulta que lo midió), **qué lo demuestra** —la medición
o el fragmento, no la impresión— y su impacto. Lo que sea hipótesis sin comprobar, marcado
como tal.

Con una tabla al principio: los 149 por tipo y por razón de ausencia, y que las dos sumas
cuadren con 149. Si no cuadran, esa discrepancia es el primer hallazgo del informe.

Y al final, separado y en dos listas: **lo que se puede cerrar** —con qué— y **el techo**, lo
que no se cierra porque la fuente no da el dato. Son cosas distintas y se deciden distinto.

No arregles nada. Decide Óscar.
