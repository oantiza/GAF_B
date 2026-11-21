# Auditoría del backend, 15-11-2026

Se auditaron las 51 funciones de `3-BDB-ACTIVOS_app/functions_python/main.py`, las 34 que estaban en producción, las reglas de la base y su configuración en la nube. Fue de solo lectura, el 15-11-2026, sobre el commit `01d31919`, y dejó **32 hallazgos**. El informe publicado está en https://claude.ai/artifact/BXTefcJZHJPXYNn3G3iksY y su fuente en `Gestor-Activos-Financieros-copias\auditoria-backend-2026-11-15\auditoria-backend.html`.

El mismo día Óscar tomó ocho decisiones (A-146 a A-153, en `3-BDB-ACTIVOS_app/docs/rediseno-2026-11/DECISIONES_AUDITORIA_2026-11-04.md`), ejecutadas y en producción desde las 16:06; la novena, A-154 (Optimizar a un año), llegó después y está en producción desde el 15-11-2026 a las 21:00. Este documento es el de trabajo que queda: cada hallazgo con su estado de hoy.

**Estado a 15-11-2026, al cierre del día:** 24 cerrados (2, 3, 4, 6, 7, 8, 10, 11, 12, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27 y 31), 3 cerrados en parte (1, 9 y 32) y 5 abiertos (5, 13, 28, 29 y 30). **Lo cerrado en la segunda mitad del día** (4, 11, 12, 14, 15, 16, 17, 18, 19, 20, 21, 24, 25, 26, 27 y 31, y el 32 en parte) **está en producción desde el 15-11-2026 a las 21:00**, en la segunda subida del día; la primera fue a las 16:06. Lo más importante que queda: el ensayo de restauración de las copias (1), el alta de usuarios sin comprobar y el correo verificado en las reglas (5), y el Sharpe del borrador de cartera (13).

**Estado a 16-11-2026:** 24 cerrados, 4 cerrados en parte (1, 5, 9 y 32) y 4 abiertos (13, 28, 29 y 30). El 5 pasa a cerrado en parte: las reglas de la base piden ya el correo verificado, en la rama principal y **sin desplegar**; el alta de usuarios sigue sin comprobar.

Las rutas son de `3-BDB-ACTIVOS_app/functions_python`, salvo que digan otra cosa. «Comprobado» quiere decir que el camino se leyó de punta a punta y se verificó sobre el código o la nube; «por confirmar» depende de algo que no se pudo ver.

## Producción e infraestructura

### 1 · La base de producción no tiene copia (alto, comprobado en la nube)

- **Dónde:** la base `(default)` del proyecto en la nube.
- **Qué pasa:** no tenía recuperación a un momento anterior, ni copias programadas, ni protección contra el borrado. El catálogo se reconstruye desde el ordenador, pero las carteras y las retrocesiones se editan en la web y solo existen allí.
- **Arreglo mínimo:** activar las tres cosas; una copia diaria con una o dos semanas de retención basta.
- **Estado: cerrado en parte (A-147, commit `2b8d32b1`).** Hecho: siete días de recuperación, protección contra el borrado y copia diaria de 14 días, leído de vuelta en la nube y escrito en `4-base-nueva/README.md`. **Falta el ensayo de restauración**: nadie ha restaurado todavía una copia.

### 2 · Seis funciones de administración contestan sobre una base que no entienden (alto, comprobado)

- **Dónde:** `admin_panel.py:313, 533, 585` · `history_backfill.py:314` · `system_status.py:17`.
- **Qué pasa:** leen las colecciones `assets` y `meta`, que en la base nueva no existen. `admin_db_status` decía «0 activos, 0 anomalías»; `admin_asset_detail`, «activo no encontrado» para cualquiera de los 1.104 que sí están. La web ya ocultaba esas pestañas.
- **Arreglo mínimo:** sacarlas de la lista de despliegue y borrarlas de la nube.
- **Estado: cerrado (A-146, commit `67906a6d`).** Siguen en `main.py` y en el emulador local.

### 3 · Cuatro funciones de «Análisis rápido» abiertas sin pantalla (alto, comprobado)

- **Dónde:** `main.py:489-536` · `portfolio_real/` · `real_history.py`.
- **Qué pasa:** la pantalla se retiró el 14-11, y cualquier usuario con sesión podía enviarles ficheros. Su motor tiene tres caminos que dan una rentabilidad falsa sin avisar (una aportación que no se llame «transferencia» cuenta como ganancia; una cartera casi vacía dispara la cifra; una posición cuyo precio no cuadra se trata como vendida).
- **Arreglo mínimo:** retirarlas.
- **Estado: cerrado (A-146, commit `67906a6d`).** Retiradas de producción; **el código sigue** en el repositorio (unas 5.900 líneas), y su borrado es un paso aparte.

### 4 · Un despliegue sin la lista subiría las 51 (medio, comprobado)

- **Dónde:** `firebase.funciones.json` (sin `predeploy`).
- **Qué pasa:** la puerta de aprobación vive en `firebase.json`, no en el fichero que usa el despliegue de funciones. Lanzado a mano sin `--only`, solo lo frenaría que faltan claves en el gestor de secretos.
- **Arreglo mínimo:** un `predeploy` que aborte si el despliegue no viene del guion.
- **Estado: cerrado (commit `62e54062`, fusión `7f2cd85e`, 15-11-2026; en producción desde el 15-11-2026 a las 21:00).** `firebase.funciones.json` tiene un `predeploy` que ejecuta `scripts/puertaFunciones.mjs`: no escribe nada y aborta si el despliegue no viene de `scripts/desplegarFunciones.mjs`. Prueba: `tests/desplegarFunciones.test.ts`. **La puerta no se ha visto actuar dentro de un despliegue real.**

### 5 · La única puerta es la sesión (medio, comprobado; el alta, por confirmar)

- **Dónde:** `4-base-nueva/compilar-sitio.mjs` · `main.py:31` · `rate_limit.py` · `firestore.rules` (`esAsesor`).
- **Qué pasa:** App Check está apagado en los dos lados. El límite de llamadas es en memoria y por instancia, así que el tope real puede ser varias veces el nominal. Las reglas piden sesión, pero no correo verificado (las funciones sí). Con un solo usuario y el alta cerrada es suficiente; con el alta abierta no.
- **Arreglo mínimo:** confirmar en la consola que el alta está cerrada; añadir `email_verified` a `esAsesor()`; App Check cuando haya más de un usuario.
- **Estado: cerrado en parte (commit `deba92d1`, fusión `4b3d6955`, 16-11-2026; reglas publicadas en la nube el 17-11-2026 a las 12:35 UTC).** Hecho: `esAsesor()` en `4-base-nueva/firestore.rules` pide sesión con `email_verified == true`, y el administrador lo hereda. `4-base-nueva/probar-reglas.mjs` pasa de 48 a 69 casos, con sesión sin verificar y sin el campo en cada familia de reglas; con las reglas de antes fallan 22 y con las nuevas pasan los 69, contra un emulador aparte. Prueba estática: `tests/reglasBaseNuevaCorreoVerificado.test.ts`. `npm run nube:reglas` comprueba también esta condición en lo desplegado. **Las reglas no tienen interruptor:** si se apaga el de las Functions o el de la app, hay que cambiarlas y desplegarlas, o dejan fuera a quien aquellos dejan entrar. **Hecho después:** las reglas están desplegadas. Leído en la nube el 20-11-2026 con `npm run nube:reglas` (`2-plataforma-datos/scripts/verReglasDesplegadas.ts`), las reglas activas del proyecto `bdb-gestor-de-activos` se publicaron el 17-11-2026 (12:35 UTC), son idénticas a `4-base-nueva/firestore.rules` y exigen sesión y correo verificado; la primera lectura fue el 19-11-2026, con el mismo resultado. **Falta:** comprobar en la consola que el alta de usuarios está cerrada; App Check y el límite de llamadas, que se quedan para cuando haya más de un usuario.

## Cifras: simulación, frontera, mejora y borrador

### 6 · Tres «3 años» distintos para la misma cartera (medio, comprobado)

- **Dónde:** `optimization/repository.py:628, 909` · `portfolio_horizon.py:204` · `improvement_service.py`.
- **Qué pasa:** la simulación suelta, el análisis de 3 y 5 años y «Mejorar» cortan la ventana de forma distinta. La rentabilidad y el Sharpe de una cartera a 3 años podían no coincidir entre pantallas, y nada lo decía.
- **Arreglo mínimo:** que las tres usen el mismo periodo común.
- **Estado: cerrado para Simular, Optimizar y «Mejorar» (A-152 y A-153, fusión `a9c4a6c9`).** Se midió antes: entre Simular y «Mejorar» la rentabilidad anual difería entre 0,3 y 1,4 puntos. Después, 36 de 36 casos coinciden. La simulación suelta no se tocó porque ninguna pantalla la usa a 3 ni a 5 años.

### 7 · La simulación anualiza tramos de meses (el informe lo calificó de alto; gravedad corregida a menos)

- **Dónde:** `optimization/repository.py:1123-1131`.
- **Qué pasa:** si un activo es reciente, la ventana común se encoge y la rentabilidad anual se calcula igual (ejemplo: +6 % en 17 semanas sale como 19,7 % anual).
- **Gravedad corregida:** el informe lo calificó de **alto** y era menos. Al seguir la cifra pantalla a pantalla se vio que la aplicación solo llama a esa simulación a 10 años y apartando los activos sin historia, así que el tramo corto no llegaba a darse. Lo que sí había era el comparador de carteras, que recalculaba la anual por su cuenta y anualizaba cualquier tramo de tres semanas o más.
- **Arreglo mínimo:** rentabilidad anual y Sharpe «no disponible» por debajo de 330 días.
- **Estado: cerrado (A-150, fusión `65763ad0`).** Con 330 días o más no cambia ninguna cifra.

### 8 · La frontera de Simular puede proponer lo que no se puede comprar (alto, comprobado)

- **Dónde:** `portfolio_horizon.py:53, 97, 362`.
- **Qué pasa:** Simular mide también valores con precio congelado o dados de baja (correcto para mirar atrás), pero su frontera y su «Máximo Sharpe» se resolvían con ese mismo universo; una serie plana tiene poca volatilidad y el cálculo la favorece.
- **Arreglo mínimo:** resolver la frontera solo con lo que Optimizar admitiría.
- **Estado: cerrado (A-151, fusión `151ec2f5`).** Quedan apartados 7 de 1.097 instrumentos. Queda abierto que la comparación con pesos iguales y la frontera aproximada del navegador siguen contando lo no comprable.

### 9 · «Mejorar cartera»: tipo sin riesgo de otra ventana y más certeza de la que hay (medio, comprobado)

- **Dónde:** `improvement_service.py:225, 244` · `improvement_engine.py:329, 505-578`.
- **Qué pasa:** el €STR medio de la ventana entera se aplicaba también a los tramos de selección y de confirmación, y movía el Sharpe de confirmación lo que mide el umbral de mejora. Y la «confirmación fuera de muestra» elige entre 50 candidatas con un año de datos, que es volver a seleccionar.
- **Arreglo mínimo:** un tipo por ventana; en pantalla, «filtrada con el último año» en vez de «confirmada».
- **Estado: cerrado en parte (A-153).** Hecho: cada tramo usa el €STR medio de sus fechas. **Falta** el texto «confirmada fuera de muestra» de la pantalla.

### 10 · «Mejorar» puede rechazar carteras de más de 13 posiciones (medio, comprobado el tope)

- **Dónde:** `improvement_service.py:32, 168` · `src/core/portfolioImprovement.ts:17`.
- **Qué pasa:** el servidor admite 80 activos entre cartera y candidatos; la pantalla manda hasta 5 candidatos por posición. Con 14 posiciones eran 84: «Demasiados activos».
- **Arreglo mínimo:** recortar candidatos por posición hasta caber.
- **Estado: cerrado (A-153, fusión `a9c4a6c9`).** Si pasan de 80 se recortan candidatos por igual.

### 11 · Ceros donde debería decir «no disponible» (medio, comprobado)

- **Dónde:** `optimization/repository.py:1131, 1151` · `portfolio_horizon.py:270, 275` · `improvement_engine.py:207, 229`.
- **Qué pasa:** una correlación que no se puede calcular sale como 0,00 y un Sharpe con volatilidad cero sale como 0. Un valor de precio congelado aparece «sin correlación con nada».
- **Arreglo mínimo:** devolver vacío.
- **Estado: cerrado (fusión `43665b71`, 15-11-2026; en producción desde el 15-11-2026 a las 21:00).** Una correlación o un Sharpe que no se pueden calcular salen vacíos y la pantalla escribe «Falta el dato»; en «Mejorar», la comprobación afectada queda «no evaluable». Un servidor sin actualizar manda una correlación 0 que no se puede distinguir de una real.

### 12 · Optimizar a un año con 40 activos (medio, comprobado)

- **Dónde:** `main.py:218` · `src/components/OptimizerPanel.tsx:33`.
- **Qué pasa:** a un año hay unas 52 observaciones semanales; con 40 activos la matriz de covarianzas se estima con 1,3 datos por activo, y lo que sale es sobre todo error de estimación.
- **Arreglo mínimo:** exigir un mínimo de observaciones por activo o limitar el número de activos en la ventana de un año.
- **Estado: cerrado (A-154, fusión `76e03e15`, 15-11-2026; en producción desde el 15-11-2026 a las 21:00).** Optimizar limita los activos según las semanas de datos de cada ventana: 13 a un año, 40 a 3, 5 y 10 años. Por encima no calcula, lo dice y ofrece pasar a 3 años. A 3 y 5 años no cambia ninguna cifra. Queda abierto que el aviso `LOW_TN_OAS` del motor ya salta a 3 años con 40 activos.

### 13 · El borrador de cartera: otro Sharpe con el mismo nombre, y patrimonios en otra divisa (medio)

- **Dónde:** `generador_de_carteras.py:202-210, 258, 436-441`.
- **Qué pasa:** el Sharpe del generador usa rentabilidad geométrica menos €STR sobre la desviación de las rentabilidades brutas; el de las fichas, la media del exceso mensual (la regla del estimador pide no compararlos). Y el filtro de 100 millones compara el patrimonio sin convertir: 1.000 millones de coronas suecas pasan como si fueran euros. Fórmula comprobada; alcance, por confirmar.
- **Arreglo mínimo:** usar la fórmula del método o rotularlo; convertir el patrimonio o excluir lo que no esté en euros.
- **Estado: abierto.** Medido en la base nueva local (volcado del 13-11): ningún fondo de 762 tiene el patrimonio fuera del euro, así que la parte del patrimonio en otra divisa no da casos hoy. La del Sharpe sigue sin tocar.

### 14 · Esperas del navegador más cortas que las del servidor (medio, comprobado)

- **Dónde:** `src/adapters/improvePortfolioBackend.ts:259` · `backtestPortfolioBackend.ts:420` · `generadorBackend.ts:122`.
- **Qué pasa:** «Mejorar», la simulación suelta y el borrador se llamaban con 70 segundos de espera; el servidor les da 300, 300 y 120. Si el cálculo tarda más, la pantalla da error mientras el servidor sigue trabajando.
- **Arreglo mínimo:** pasar la misma espera que el servidor.
- **Estado: cerrado (A-153 y fusión `43665b71`, 15-11-2026; todo en producción desde el 15-11-2026 a las 21:00).** «Mejorar» espera 300 segundos, la simulación suelta 300 y el borrador 120, las mismas que el servidor.

### 15 · Fallos del cálculo que llegan como error interno (bajo, comprobado)

- **Dónde:** `robust_engine.py:454, 627` · `portfolio_horizon.py:217` · `main.py:364`.
- **Qué pasa:** si el segundo intento del optimizador también falla, o si la historia sintética de un solo activo no enlaza, el usuario recibe un error genérico (y en el segundo caso cae la simulación entera).
- **Arreglo mínimo:** convertirlos en el error con mensaje que ya existe y excluir el activo con su motivo.
- **Estado: cerrado (fusión `43665b71`, 15-11-2026; en producción desde el 15-11-2026 a las 21:00).** Un fallo del optimizador llega con un mensaje que sugiere qué probar, y un activo cuya historia no se puede completar con su referencia se aparta con su motivo en Simular, Optimizar y «Mejorar». Queda una reserva: Optimizar presenta así cualquier fallo inesperado, también un error de programación; el tipo queda en el registro del servidor. La comprobación en pantalla vio que ese mensaje nuevo no llegaba a la pantalla (se perdía el texto del servidor); se arregló en `d3744549`.

## Cifras: lectura de activos (comparador, selector, posiciones)

### 16 · Las métricas viajan sin fecha de corte ni base de rentabilidad (medio, comprobado)

- **Dónde:** `readmodel/lector_base_nueva.py:198-236` · `readmodel/mappers.py:816-841`.
- **Qué pasa:** la tarjeta de la base nueva sabe hasta qué fecha llega cada cifra, si es rentabilidad total o de precio y si el fondo reparte; la capa que la traduce a la forma antigua solo conserva el método y la frecuencia. En el comparador, la rentabilidad a 3 años de un fondo con dato a junio y la de una acción a noviembre salen en la misma columna sin aviso.
- **Arreglo mínimo:** proyectar esos campos y devolverlos con las cifras.
- **Estado: cerrado (commits `0208f4fb` y `236fbfd4`, fusión `ad90c388`, 15-11-2026; en producción desde el 15-11-2026 a las 21:00).** Las funciones de catálogo devuelven la fecha de corte y la base de rentabilidad de las métricas, y el comparador avisa cuando las cifras no son de la misma fecha (margen de 7 días). Medido en la base nueva local (volcado del 13-11): todas las bases de rentabilidad son «rentabilidad total»; 24 fondos tienen la fecha de corte a más de 30 días de la más reciente y 3 a más de 60. Como los fondos cortan a fin de mes y las acciones unos días después, **la nota sale en toda comparación de fondo con acción**. Ninguna cifra cambia (comprobado en los 1.334 instrumentos). Cambió el contrato de respuesta en su origen, `2-plataforma-datos/contracts/read/asset-for-bdb.v1.schema.json`.

### 17 · «Último dato» sin su divisa (medio; servidor comprobado, pantallas por confirmar)

- **Dónde:** `readmodel/lector_base_nueva.py:173-177`.
- **Qué pasa:** en 13 de los 28 ETF la clase está en dólares y el precio en euros; la función devuelve el precio con la divisa de la clase, no la de la cotización («98,4 USD» para un precio en euros).
- **Arreglo mínimo:** devolver la divisa de la cotización junto al valor.
- **Estado: cerrado (misma fusión `ad90c388`; en producción desde el 15-11-2026 a las 21:00).** El último precio viaja con la divisa de la cotización. Medido: la divisa del precio no es la de la clase en 15 de 32 ETF (el informe contó 13 de 28).

### 18 · Lo que falta se rotula como simulado, y lo vacío como completo (medio, comprobado)

- **Dónde:** `readmodel/mappers.py:517-534, 840, 916`.
- **Qué pasa:** los 149 instrumentos sin métricas salen con origen `MOCK` («dato de prueba») cuando lo cierto es «no hay dato». Y un fondo con política de historial y ninguna cifra sale con cobertura `COMPLETE`, porque los rótulos del método se cuentan como métricas.
- **Arreglo mínimo:** «no disponible» en el primer caso; no contar rótulos en el segundo.
- **Estado: cerrado (misma fusión `ad90c388`; en producción desde el 15-11-2026 a las 21:00).** Un instrumento sin cifras ya no sale como dato de prueba ni como completo. Medido: 8 acciones salían rotuladas como dato de prueba y 9 fondos y 1 acción salían «completos» sin ninguna cifra.

### 19 · Un fallo de lectura parece «el activo no existe» (medio, comprobado)

- **Dónde:** `readmodel/repository.py:49-66, 96-145, 370-429` · `lector_base_nueva.py:464`.
- **Qué pasa:** si la base falla un momento, `resolve_portfolio` contesta «activo no encontrado» para toda la cartera y `compare_assets` devuelve una lista vacía, las dos como respuesta correcta. El límite de 15 segundos por lectura está declarado y no se aplica en el lector de la base nueva.
- **Arreglo mínimo:** distinguir «no se pudo leer» de «no existe», y aplicar el límite.
- **Estado: cerrado (fusión `d342df71`, 15-11-2026; en producción desde el 15-11-2026 a las 21:00).** Si la base no contesta, las funciones de catálogo lo dicen como fallo; si falla una parte, la respuesta lleva un aviso propio; y cada lectura de la base nueva lleva su límite de 15 segundos. Quedan dos detalles: en el buscador, un fallo parcial bloquea la página entera hasta reintentar, y la exportación a Excel de Posiciones sigue poniendo «No reconocida» a lo que no se pudo leer.

### 20 · Posiciones de un fondo: el recuento no es el total (medio, comprobado)

- **Dónde:** `readmodel/lector_base_nueva.py:239-247, 347-364`.
- **Qué pasa:** en un fondo mixto con 40 bonos y 120 acciones, dice «40 posiciones». No devuelve qué parte del patrimonio cubren y, si solo hay las 25 principales, no avisa de que la lista está cortada.
- **Arreglo mínimo:** devolver el total de valores, la cobertura y una marca de lista parcial.
- **Estado: cerrado (misma fusión `ad90c388`; en producción desde el 15-11-2026 a las 21:00).** Se devuelve el total real de valores, la cobertura y la marca de lista parcial. Medido: en 156 de 744 fondos el recuento que se enseñaba no era el total de valores; ningún fondo sirve hoy solo las 25 principales. **Queda abierto:** el informe interno de cartera y la ficha nueva siguen usando el recuento parcial; la interfaz equivalente en `2-plataforma-datos/src/contracts/bdbAclContracts.ts` no está al día; y hay 3 fondos con la fecha de corte de hace un año.

### 21 · El identificador del activo no se valida en la base nueva (bajo, comprobado)

- **Dónde:** `readmodel/lector_base_nueva.py:268` · `main.py:304, 316`.
- **Qué pasa:** el lector antiguo rechazaba identificadores con barras; el nuevo no. Uno como `X/read/card` lee otro documento del catálogo y devuelve una ficha sin sentido; con un número impar de tramos da error interno. No expone nada que el usuario no pueda leer ya.
- **Arreglo mínimo:** reutilizar la validación que ya existe.
- **Estado: cerrado (fusión `d342df71`, 15-11-2026; en producción desde el 15-11-2026 a las 21:00).** Un identificador sin forma válida no se lee de la base: da error en las funciones de un solo activo y solo marca su fila en las listas y en las carteras, porque Posiciones admite códigos como «BRK/B». Además, las entradas mal formadas de las funciones de catálogo devuelven un error que nombra el campo.

## Fuentes externas, informes e IA

### 22 · Publicar el informe: la pantalla no mira el resultado, y tres fallos bloquean el día (medio, comprobado)

- **Dónde:** `report_publication.py:36-62` · `src/adapters/weeklyReportBackend.ts:191` · `main.py:828`.
- **Qué pasa:** la función podía contestar «ya publicado», «en curso» o «intentos agotados» como respuesta correcta y la pantalla recargaba como si hubiera ido bien. Tras tres intentos fallidos en el día no se podía volver a intentar, ni regenerar un informe ya publicado; solo se arreglaba borrando documentos a mano.
- **Arreglo mínimo:** que la pantalla enseñe el estado, y un «forzar» para administrador.
- **Estado: cerrado (A-148, fusión `d9d39918`).** El informe se sigue publicando a mano. Queda un detalle: el aviso de intentos agotados dice «los tres intentos» aunque haya habido un cuarto, forzado.

### 23 · El informe de estrategia lleva cifras que escribe el modelo (alto, comprobado)

- **Dónde:** `weekly_report.py:213, 506, 779, 811`.
- **Qué pasa:** los pesos estratégicos y tácticos por clase de activo, región y sector son una opinión numérica de Gemini; la validación solo exige que sumen 100. Las cifras de los indicadores son texto libre: se comprueba que haya fuentes, no que cada cifra esté en ellas.
- **Arreglo mínimo:** decisión de Óscar.
- **Estado: cerrado (A-149, fusión `2e003d66`).** En pantalla, «Escenario del modelo, no una recomendación»; del PDF sale la sección «Asignación de activos». **Queda** que el texto narrativo, que sigue en el PDF, puede traer pesos en prosa.

### 24 · La lectura con IA de la cartera (medio, comprobado)

- **Dónde:** `analyze_portfolio.py:66-123`.
- **Qué pasa:** el nombre de cada posición entra en la petición sin recortar ni limpiar saltos de línea, así que un nombre largo o con instrucciones dentro altera el resultado y encarece la llamada. La respuesta se devuelve sin mirar si quedó cortada. Solo la ve quien la pide y no entra en ningún informe.
- **Arreglo mínimo:** recortar el nombre a 80 caracteres y rechazar respuestas cortadas.
- **Estado: cerrado (commit `7142bbcd`, fusión `928dfc9d`, 15-11-2026; en producción desde el 15-11-2026 a las 21:00).** Los nombres de las posiciones entran acotados a 80 caracteres y en una línea, el contexto por campos enteros, y una respuesta cortada no se sirve. Prueba: `functions_python/tests/test_ia_entradas_acotadas.py`. (Lo que queda del A-149 está en el hallazgo 23.)

### 25 · Calendario económico: solo esta semana, y el respaldo no funciona (medio, comprobado)

- **Dónde:** `economic_calendar.py:21, 213, 367, 412`.
- **Qué pasa:** la fuente es un espejo no documentado de Forex Factory que solo trae la semana en curso. La pantalla pide hoy más siete días, así que la semana siguiente sale vacía con «no se encontraron eventos», que no es verdad. El respaldo con los hitos del informe espera fechas en un formato que el informe no usa.
- **Arreglo mínimo:** decir hasta dónde cubre la fuente; quitar o rehacer el respaldo.
- **Estado: cerrado (commit `7e7b4094`, fusión `a4ca786a`, 15-11-2026; en producción desde el 15-11-2026 a las 21:00).** El calendario dice qué días cubre su fuente, distingue cuatro estados y deja de usar los hitos del informe de estrategia como respaldo.

### 26 · Dividendos y resultados: un bloqueo de Yahoo se guarda seis horas como «no hay» (medio; código comprobado, Yahoo por confirmar)

- **Dónde:** `spanish_calendar.py:278-326, 430-461`.
- **Qué pasa:** la fuente es Yahoo por una librería no oficial, valor a valor sobre los 35 del IBEX. Una respuesta vacía cuenta como válida; si Yahoo bloquea, las 35 salen vacías y se guarda seis horas como «sin dividendos en el rango». La fecha de resultados estimada sale sin marca de estimada.
- **Arreglo mínimo:** no dar por válida una respuesta vacía y marcar las fechas estimadas.
- **Estado: cerrado (misma fusión `a4ca786a`; en producción desde el 15-11-2026 a las 21:00).** Un barrido de Yahoo en que responde menos de la mitad de los 35 valores sale como que la fuente no contesta y no se guarda; la fecha de resultados estimada va marcada. **Queda abierto:** la lista del IBEX 35 sigue fija en el código.

### 27 · Referencia macro: supuestos presentados como datos (medio, comprobado)

- **Dónde:** `macro_reference.py:146-231, 675, 702`.
- **Qué pasa:** los tipos de depósitos y Letras de 2025 y 2026 son tablas fijas escritas en el código y alimentan la comparativa patrimonial. La media de las Letras son siempre los últimos 12 meses, pidan las fechas que pidan. El campo de fuente dice «INE + BdE» aunque los dos hayan fallado. La escala del IRPF es solo la de Bizkaia.
- **Arreglo mínimo:** devolver cada supuesto con su año y su origen, y la fuente solo si respondió.
- **Estado: cerrado (misma fusión `a4ca786a`; en producción desde el 15-11-2026 a las 21:00).** La referencia macro dice qué es dato de tabla y qué supuesto (los tipos de 2025 y 2026, sin cambiar ningún valor), el periodo real de las Letras, las fuentes que respondieron y que la escala fiscal es la de Bizkaia de 2026; la curva del BCE devuelve vacío con notas en vez de un error.

## Carteras guardadas

### 28 · Dos guardados simultáneos sin condición pueden mezclarse (bajo, comprobado)

- **Dónde:** `portfolios/almacen_base_nueva.py:103-122`.
- **Qué pasa:** el guardado normal, con la fecha de la versión abierta, es atómico y está bien. El guardado sin esa fecha (cartera nueva, o «sobrescribir» tras un conflicto) lee y escribe sin transacción: dos pestañas a la vez pueden dejar los pesos de las dos. Con un solo asesor es improbable.
- **Arreglo mínimo:** meterlo en una transacción.
- **Estado: abierto.**

### 29 · La etiqueta de una posición se acepta y no se guarda (bajo, comprobado)

- **Dónde:** `portfolios/repository.py:169` · `portfolios/almacen_base_nueva.py:26-35, 76-89`.
- **Qué pasa:** el frontend manda `label`, la validación lo acepta y el almacén de la base nueva ni lo escribe ni lo devuelve.
- **Arreglo mínimo:** guardarla, o dejar de aceptarla.
- **Estado: abierto.**

## Limpieza

### 30 · Unas 6.100 líneas que en producción no hacen nada (bajo, comprobado)

- **Dónde:** `price_refresh`, `metrics_refresh`, `fund_ingest`, `ingest_asset`, `integrity_check`, `search_index`, `reviewed_nav_*`…
- **Qué pasa:** es el código de refresco y de ingesta de la base vieja, un 22 % del paquete. Parte se carga en el arranque de todas las funciones porque `main.py` lo importa arriba, con dos librerías (`jsonschema`, `curl_cffi`) que casi ninguna función necesita. Sigue siendo útil en local contra la base de siempre.
- **Arreglo mínimo:** ninguno urgente; cuando la base vieja se retire, se va todo junto.
- **Estado: abierto.**

### 31 · Tres guiones de migración escriben sin el cerrojo general (bajo, comprobado)

- **Dónde:** `scripts/migrate_portfolios_uid.py` · `migrate_ownership_v12.py` · `migrate_provisional_roots.py`.
- **Qué pasa:** solo piden una frase de aprobación que está escrita en su propia ayuda; los demás guiones exigen además la variable de escrituras. Con el proyecto de la base nueva en el entorno y una credencial, escribirían en producción con la forma vieja.
- **Arreglo mínimo:** una línea en cada uno, o archivarlos: son migraciones ya hechas.
- **Estado: cerrado (commit `77ca3e7f`, fusión `7f2cd85e`, 15-11-2026; en producción desde el 15-11-2026 a las 21:00).** Los tres piden ahora también el cerrojo general de escrituras.

### 32 · Restos de BDB y textos que ya no son verdad (bajo, comprobado)

- **Dónde:** `functions_python/.env.bbdd-activos-financieros` · `firebase.json` (cabecera de seguridad) · `main.py:1-9` · `README.md` · `AGENTS.md`.
- **Qué pasa:** queda en la carpeta el fichero de entorno del proyecto de BDB, con sus escrituras abiertas; no entra en Git y el código lo rechaza, pero no debería estar. La cabecera de `main.py` dice «solo lectura» y «registro abierto» y nombra un fichero que no existe. `AGENTS.md` decía «33 de 50» y son 34 de 51 (hoy, tras A-146, 23 de 51: ese dato ya está corregido). Una prueba dice «32 invocables» y son 40.
- **Arreglo mínimo:** borrar el fichero y corregir los textos.
- **Estado: cerrado en parte (commit `acc2da8b`, fusión `7f2cd85e`, 15-11-2026; en producción desde el 15-11-2026 a las 21:00).** Hecho: la cabecera de `main.py`, el README del backend y la prueba dicen lo que hay hoy (y el dato de `AGENTS.md`). **Queda lo que es decisión de Óscar:** el fichero de entorno del proyecto de BDB sigue en la carpeta de funciones del checkout principal, fuera de Git y con las escrituras abiertas, y el `firebase.json` de la app nombra el dominio de ese proyecto en su cabecera de seguridad.

## Lo que salió por el camino y sigue abierto

Hecho a lo largo del día y quitado de esta lista: los pesos en prosa del informe (A-149, hecho en el encargo de IA, **sin saber si el modelo obedece la regla nueva**: solo se sabe publicando un informe, y una comprobación avisa en el registro si escribe pesos), «Misma estrategia, otra clase» (commits `83a67417` y `54f9d4dd`, fusión `79e0c73e`), el PDF del comparador con periodo corto (misma fusión) y el aviso de intentos agotados (`7142bbcd`, fusión `928dfc9d`). Todo ello en producción desde el 15-11-2026 a las 21:00.

- **Comparación con pesos iguales y frontera aproximada del navegador.** Siguen contando valores que no se pueden comprar (A-151).
- **Sustitutos de una posición completada con referencia.** En «Mejorar», una posición cuya historia se completó con una referencia sí puede recibir sustitutos (A-153).
- **Ensayo de restauración de las copias.** Sin hacer (A-147).
- **Pruebas de Python en local.** Corren con el Python 3.14 del sistema mientras la nube usa el 3.12, y el entorno virtual de `functions_python` no tiene `pytest`.
- **Tres estados que no se pudieron ver en pantalla con datos reales** y solo cubren pruebas: el motivo «bloqueado para nuevas compras» en el aviso de la frontera, una posición «completada con una referencia» en «Mejorar» y un candidato «sin historia propia». A ellos se suma que, con los datos reales de hoy, los textos «Falta» y «Falta el dato» no llegan a darse: solo se vieron doblando la respuesta del servidor.
- **El texto «confirmada fuera de muestra»** de «Mejorar» (resto del hallazgo 9).

Nuevo, de la segunda mitad del día:

- **Optimizar: el aviso `LOW_TN_OAS`** del motor ya salta a 3 años con 40 activos (A-154).
- **Optimizar presenta cualquier fallo inesperado** como «el optimizador no ha conseguido una solución», también un error de programación; el tipo queda en el registro (hallazgo 15).
- **Un servidor sin actualizar** manda una correlación 0 que no se distingue de una real (hallazgo 11).
- **Buscador:** un fallo parcial de lectura bloquea la página entera hasta reintentar (hallazgo 19). **Exportación a Excel de Posiciones:** sigue poniendo «No reconocida» a lo que no se pudo leer (hallazgo 19).
- **«Misma estrategia, otra clase» de «Mejorar»:** Cartesio X y Cartesio Y, que son fondos distintos, se siguen emparejando; la misma estrategia con otra letra y número de clase (A2 frente a E2) no se reconoce; y por debajo de un 2 % de volatilidad anual no se exige correlación a ningún candidato. Medido sobre los 1.300 nombres de la lista de fondos: se fueron cuatro emparejamientos falsos y no cambió ningún otro.
- **Lectura de activos:** la interfaz de `2-plataforma-datos/src/contracts/bdbAclContracts.ts` no está al día; el informe interno de cartera y la ficha nueva usan el recuento parcial de posiciones; hay 3 fondos con la fecha de corte de hace un año (hallazgos 16 y 20).
- **Nota de fechas del comparador:** sale siempre entre fondo y acción, con el margen de 7 días (hallazgo 16).
- **Lista del IBEX 35:** fija en el código (hallazgo 27).
- **Panel de la frontera:** repite «Frontera histórica» como título y como estado, de antes.
- **Puerto 4501:** un emulador de Functions de otra sesión puede ocuparlo, y es el de registro de la base nueva; entonces `node 4-base-nueva/arrancar.mjs` falla.
- **La puerta de `firebase.funciones.json`** actuó por primera vez en el despliegue de las 21:00 y dejó pasar al guion. Lo que no se ha visto es que bloquee un despliegue lanzado a mano dentro de la CLI; eso solo está probado ejecutando la puerta suelta (hallazgo 4).

## Lo que está bien hecho

- Las 40 funciones invocables pasan por la misma puerta de sesión y correo verificado, y las 13 de administración por el permiso de administrador, con una prueba que fija el inventario.
- El proyecto de la base se resuelve en un solo sitio, sin valor por defecto y con lista de permitidos. El cerrojo de escrituras falla cerrado.
- El guion de despliegue comprueba la lista, los secretos, el entorno y que no haya cambios sin registrar; la nube coincide con él (hoy, 23 funciones).
- Las reglas desplegadas son idénticas a las del repositorio y cierran todo lo que no se nombra. Ningún cliente puede escribir carteras saltándose la función.
- El motor de la frontera es sólido: covarianza con encogimiento, segundo intento con otro método, mensajes con cifras cuando no hay solución y series solo en euros.
- Los datos del BCE son oficiales, llevan fecha por serie y no se interpolan. Ningún parámetro del usuario acaba en una dirección de red.
- El guardado de carteras con control de versión es atómico de verdad, y el aislamiento por usuario está bien de punta a punta.

## Cómo se hizo y qué no se comprobó

Inventario de `main.py` leído entero; lista de funciones desplegadas pedida a la nube; reglas desplegadas comparadas con el repositorio; configuración de la base leída con la CLI de Firebase; cruce función a función con las llamadas del frontend; cinco revisiones de código por bloques. Pruebas de Python: 2.310 pasan y 7 se saltan, con las salvedades de arriba; no cubren los hallazgos 2, 3 ni 6 a 21.

**No se comprobó:** si el alta de usuarios está cerrada en la consola; las variables de entorno reales de las funciones desplegadas; los permisos de las dos cuentas de servicio; los tiempos reales de arranque y de cálculo; el comportamiento en vivo de Yahoo, Forex Factory y el BdE; y cuántos fondos del generador tienen el patrimonio en otra divisa.
