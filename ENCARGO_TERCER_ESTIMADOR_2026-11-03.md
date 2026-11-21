# Encargo: el tercer estimador que nadie declaró

*Para una sesión de agente que no conoce este proyecto. El entregable es un informe: **no
arregles nada**.*

## Qué es este proyecto, en cuatro líneas

Gestor Activos Financieros es una aplicación profesional para asesores de inversión: buscar
activos, analizar fichas, comparar productos, construir carteras y generar informes para
clientes. Son cinco repositorios Git independientes en la rama `gestor-activos-financieros`:
`1-extractor` (Python, extrae datos y **calcula las métricas**), `2-plataforma-datos`
(TypeScript, valida y carga hacia Firestore), `3-BDB-ACTIVOS_app` (React 19 + Vite + Firebase),
`4-base-nueva` (el proyecto Firebase de la base nueva) y la raíz, que guarda los documentos que
gobiernan.

Hay **dos bases de datos**. La **vieja**, `gestor-activos-local`, emulador en
`127.0.0.1:8082`: es la que **lee la aplicación de hoy**, y es la que te importa. La **nueva**,
`bdb-gestor-de-activos`, emulador en `127.0.0.1:8092`: no entra en este encargo. Lo que separa
las dos **es el puerto**, no el id de proyecto: los dos emuladores arrancan en
`singleProjectMode` y sirven con cualquier id. Para saber en qué base estás, mira el puerto.

## El hallazgo del que sales, y la trampa de creérselo

Una auditoría del 03-11-2026 midió esto en la base vieja: **1.090 de 1.097 activos tienen un
Sharpe con `method: GEOMETRIC_CAGR` y `frequency: WEEKLY`**. Ninguno de los dos métodos que el
proyecto declara se llama así.

Los métodos declarados son dos, y están definidos en `METODO_PROPIO_METRICAS_2026-11-01.md`,
que es el documento que manda sobre las fórmulas:

- `EXTRACTOR_MONTHLY_V1` — fondos. Serie **mensual**, anualización ×√12. Escribe los bloques
  `riesgo` y `rentabilidades`.
- `EXTRACTOR_DAILY_V1` — acciones y ETF. Serie **diaria**, anualización ×√252. Escribe
  `metricas_diarias`.

**No heredes la conclusión de la auditoría.** Hay al menos dos hipótesis y tienes que decidir
entre ellas con medición, no con la que te suene mejor:

- **A)** Existe un tercer estimador real, con su propia ventana y su propia frecuencia, que
  nadie documentó.
- **B)** `GEOMETRIC_CAGR` / `WEEKLY` es lo que uno de los dos métodos declarados **escribe de
  verdad**, y lo que está mal es el documento que dice que son mensuales o diarios.

Las dos tienen consecuencias opuestas: en A hay que declarar un método nuevo; en B hay que
corregir el documento que gobierna. Di cuál es, y con qué lo demuestras.

## La lente que en este proyecto rinde más que ninguna

Busca **comprobaciones que no pueden fallar**: una respuesta válida afirmando otra cosa. Es el
defecto característico de aquí y ha aparecido cuatro veces en una semana. Un ejemplo real: un
chequeo de vida de la base construía una URL inválida que contestaba **200 con cero
documentos**, así que una base con 11.566 documentos dentro se informó como vacía, con el
código de estado diciendo que todo bien.

De cada comprobación que hagas, y de cada una que encuentres en el código, pregúntate **qué
tendría que pasar para que fallara**. Si la respuesta es «nada» o «no lo sé», es un hallazgo.

Y **distingue siempre lo que has comprobado de lo que supones.** Dilo en el informe, caso por
caso.

## Lo que hay que averiguar, por orden de valor

1. **Dónde se calcula.** Fichero y línea. La fórmula tal como está escrita, la **ventana**, la
   **frecuencia** del muestreo, el **factor de anualización**, y qué **tipo libre de riesgo**
   usa —si usa alguno; un Sharpe sin tipo libre de riesgo es un número distinto y hay que
   decirlo—.
2. **Si sus cifras conviven con las de los otros dos.** Esto es lo que de verdad importa, y
   es lo que un asesor sufre: localiza cada pantalla, tabla, comparador o informe PDF donde una
   cifra de este estimador aparezca **al lado de** una de `EXTRACTOR_MONTHLY_V1` o
   `EXTRACTOR_DAILY_V1`, o donde se **ordenen juntas** en una misma columna. Fichero, línea y
   qué ve el asesor. Dos Sharpe de estimadores distintos en la misma columna no son
   comparables, y ordenarlos produce un ranking falso.
3. **Si el método se publica o solo se guarda.** ¿Llega el `method` / `frequency` a alguna
   pantalla o informe, o se queda en Firestore y el asesor ve la cifra desnuda?
4. **Los 7 que no lo tienen.** 1.090 de 1.097: qué les pasa a los otros siete.
5. **Cuál de las dos hipótesis**, A o B, y la prueba.

## Cómo leer la base, y qué está prohibido

La base vieja se lee por REST con la cabecera `Authorization: Bearer owner`, que **salta las
reglas de seguridad**:

```
http://127.0.0.1:8082/v1/projects/gestor-activos-local/databases/(default)/documents/assets?pageSize=1
```

**No compruebes si el emulador está vivo mirando los puertos.** Está medido: ni
`Get-NetTCPConnection -State Listen` ni `netstat` listan el 8082 aunque esté sirviendo
peticiones, porque lo abre la JVM del emulador de Firestore. Pregúntale al servicio con la URL
de arriba: si contesta con documentos, está vivo.

Si la base vieja estuviera vacía, repoblarla tarda segundos y es idempotente, desde
`2-plataforma-datos`:

```
npm run backup:restore-drill -- --emulator-host 127.0.0.1:8082 --project gestor-activos-local
```

Eso es la **única** escritura que tienes permitida, y solo si está vacía.

**Prohibido**, sin excepciones:

- Escribir en cualquiera de las dos bases, salvo la repoblación de arriba. Nada en la nube.
- Abrir las puertas de entorno `BDB_DATA_PLATFORM_ENABLE_MASTER_WRITES` o
  `BDB_SUBIDA_A_LA_NUBE`.
- `firebase deploy`, `gcloud`, `git push`, y **commitear**: la carpeta está compartida con
  otras sesiones.
- Tocar `C:\Users\oanti\Proyectos\BDB` o su proyecto Firebase `bbdd-activos-financieros`.
  Leerlo como referencia puntual está bien; modificarlo, nunca.
- Modificar **ningún fichero** que no sea tu informe. En particular nada de
  `3-BDB-ACTIVOS_app`, que se está reescribiendo ahora mismo en otra sesión.
- Si una etapa dice «Project id fuera de la allowlist», **no** pongas
  `FIREBASE_PROJECT_ID=bbdd-activos-financieros`. Ese error no es un obstáculo: es la barrera
  funcionando.

## Antes de concluir nada, lee

1. `AGENTS.md` entero. Fija el papel con el que se decide aquí y las barreras.
2. `METODO_PROPIO_METRICAS_2026-11-01.md` completo. Es la definición de las fórmulas, y su §3
   lleva la regla que da sentido a este encargo: **dos cifras solo se comparan si coinciden
   también en el estimador**.
3. `LEGADO_CONOCIMIENTO_SISTEMA_2026-07-12.md`: convenciones del extractor y de la plataforma
   que no están escritas en el código y que es caro redescubrir.
4. `docs/historico-bdb/AUDITORIA_2026-11-03.md`, el hallazgo A-2, que es de donde sale este encargo. Lee lo que
   midió y lo que no.

## El entregable

Un fichero `INFORME_TERCER_ESTIMADOR_2026-11-03.md` en la raíz del proyecto. Cada hallazgo con
**dónde está** (fichero y línea), **qué lo demuestra** —la medición o el fragmento, no la
impresión— y su impacto. Lo que sea hipótesis sin comprobar, marcado como tal.

Y al final, separado y en dos listas: **lo que cambia una cifra que ve un asesor** y **lo que
es deuda interna**. Son cosas distintas y se deciden distinto.

No arregles nada. Decide Óscar.
