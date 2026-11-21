/**
 * El cierre del recorrido de la auditoría (`auditoriaFrontend.mjs`): de las filas medidas —una por pantalla y ancho— al
 * informe que alguien lee, al resumen que sale por la consola y al código de salida. No abre un navegador ni escribe
 * nada, así que se puede probar con filas de mentira (`tests/herramientasDeCaptura.test.ts`); hasta el 19-11-2026
 * vivía al final del guion y lo único que se podía mirar era que sus rótulos estuvieran escritos.
 *
 * El recorrido es un informe, no una puerta: desborde, consola, accesibilidad, un texto cortado o una caja que se
 * desplaza de lado no cambian el código de salida, hay que leerlos. Lo cambian cinco cosas. Cuatro quieren decir que la pasada no midió lo que dice: no
 * haber entrado, que alguna pantalla no se haya podido medir, que falte alguna de las pedidas en Modo cliente, y que
 * una pantalla que desplaza se haya medido sin su barra. La quinta es lo que no puede pasar delante de un cliente: que
 * en Modo cliente la página lleve algo reservado al asesor.
 *
 * Una pantalla que no se pudo medir llega aquí con `sinMedir` y sin medidas. No rompe el informe de las demás, pero
 * tampoco cuenta como buena: se dice arriba del todo, y lo que sigue habla solo de las que sí se midieron.
 */
import { ANCHO_DE_TABLETA, marcaDeAncho } from "./anchosDeCaptura.mjs";
import { CORTES_ADMITIDOS } from "./textoCortado.mjs";
import { TOPE_DE_CAJAS_POR_PANTALLA, describirCaja } from "./cajasQueSeDesplazan.mjs";
import { PALABRAS_DEL_ASESOR } from "./modoCliente.mjs";

const plural = (cuantos, uno, varios) => `${cuantos} ${cuantos === 1 ? uno : varios}`;

/**
 * @param {object} datos
 * @param {object[]} datos.informe      las filas medidas
 * @param {string} datos.etiqueta       el nombre de la pasada
 * @param {string} datos.base           la dirección medida
 * @param {string} datos.fecha          cuándo, ya escrito
 * @param {{ id: string, modoCliente?: unknown }[]} datos.pantallas  las pantallas pedidas
 * @param {{ ancho: number, conDedo: boolean }[]} datos.anchos       los anchos pedidos
 * @param {boolean} datos.barrasOcultas si la pasada se hizo sin barras, como las de antes
 * @param {boolean} datos.axeEnTodos    si axe-core pasó en todos los anchos
 * @param {string} datos.marcaDeAxe     el ancho en el que pasó axe-core, si no
 * @returns {{ lineas: string[], consola: string[], errores: string[], codigo: 0 | 1 }}
 */
export function cerrarElRecorrido({ informe, etiqueta, base, fecha, pantallas, anchos, barrasOcultas, axeEnTodos, marcaDeAxe }) {
  const marcas = anchos.map(marcaDeAncho);
  const errores = [];

  /* Las que no se pudieron medir: no entran en ninguna cuenta de las de abajo. */
  const sinMedir = informe.filter((f) => f.sinMedir);
  const medidasBien = informe.filter((f) => !f.sinMedir);

  /* La barra de desplazamiento: se dice la que se midió, no la que se supone. Con ratón, una pantalla más alta que la
     ventana tiene barra; si mide cero, el navegador no la está pintando y todo se ha medido con sitio de más. */
  const conRaton = medidasBien.filter((f) => !f.conDedo);
  const desplazan = conRaton.filter((f) => f.altoDePagina > (f.altoDeVentana ?? Infinity) + 1);
  const sinBarra = barrasOcultas ? [] : desplazan.filter((f) => !f.barra);
  const conBarra = desplazan.filter((f) => f.barra);
  const medidas = [...new Set(conBarra.map((f) => f.barra))].sort((a, b) => a - b);
  /* Pantallas, no filas: la misma pantalla en cuatro anchos es una pantalla, a cuatro anchos. */
  const pantallasDe = (filas) => new Set(filas.map((f) => f.id)).size;
  const anchosDe = (filas) => new Set(filas.map((f) => f.marca)).size;
  const aCuantosAnchos = (filas) => (anchosDe(filas) > 1 ? `, a ${anchosDe(filas)} anchos` : "");
  let deLaBarra;
  if (!medidasBien.length) deLaBarra = "No se pudo medir ninguna pantalla.";
  else if (barrasOcultas) deLaBarra = "Con las barras de desplazamiento ocultas, como en las pasadas anteriores al 19-11-2026.";
  else if (!conRaton.length) deLaBarra = "Todo con dedo: sin barra de desplazamiento que ocupe sitio.";
  else if (!desplazan.length) deLaBarra = "Con ratón, ninguna pantalla desplaza: no hay barra que medir.";
  else if (!medidas.length) {
    deLaBarra = `Con ratón, SIN barra de desplazamiento: no se midió en ${pantallasDe(sinBarra) === 1 ? "la única pantalla que desplaza" : `ninguna de las ${pantallasDe(sinBarra)} pantallas que desplazan`} (se listan abajo).`;
  } else {
    deLaBarra = `Con ratón, con la barra de desplazamiento puesta (${medidas.join(" y ")} px, medida en ${plural(pantallasDe(conBarra), "pantalla que desplaza", "pantallas que desplazan")}${aCuantosAnchos(conBarra)})${sinBarra.length ? `, salvo en ${plural(pantallasDe(sinBarra), "pantalla, que se lista abajo", "pantallas, que se listan abajo")}` : ""}; con dedo, sin ella.`;
  }

  const lineas = [`# Recorrido «${etiqueta}» — ${fecha} UTC`, "", `Base: ${base}. Pantallas: ${pantallas.length}. Anchos: ${marcas.join(", ")} (una «d» detrás es con dedo). ${deLaBarra}`, ""];
  /* Sin ninguna pantalla medida, cada «ninguno» de abajo sería una afirmación sobre algo que no se ha mirado. */
  if (!medidasBien.length) lineas.push("**No se midió ninguna pantalla: los «ninguno» y «ninguna» de abajo no dicen nada de la aplicación.**", "");
  if (sinMedir.length && medidasBien.length) {
    lineas.push(`**Sin medir: ${plural(pantallasDe(sinMedir), "pantalla", "pantallas")}${aCuantosAnchos(sinMedir)}, que se ${pantallasDe(sinMedir) === 1 ? "lista" : "listan"} abajo. Lo que sigue habla solo de las que sí se midieron.**`, "");
  }
  for (const pedido of anchos) {
    const marca = marcaDeAncho(pedido);
    lineas.push(`## ${pedido.ancho} px${pedido.conDedo && pedido.ancho > ANCHO_DE_TABLETA ? ", con dedo" : ""}`, "", "| Pantalla | Desborde | Consola | Peticiones fallidas | Accesibilidad (nodos) | Carga (ms) | Alto (px) |", "|---|---|---|---|---|---|---|");
    for (const fila of informe.filter((f) => f.marca === marca)) {
      const desborda = fila.sinMedir ? "—" : fila.anchoDePagina > fila.anchoDeVentana + 1 ? `**${fila.anchoDePagina - fila.anchoDeVentana} px**` : "no";
      const axe = fila.axe ? String(fila.axe.reduce((suma, f) => suma + f.nodos, 0)) : "—";
      lineas.push(`| ${fila.id}${fila.fallo ? ` (${fila.fallo})` : ""} | ${desborda} | ${fila.consola.length} | ${fila.peticiones.length} | ${axe} | ${fila.msDeCarga ?? "—"} | ${fila.altoDePagina ?? "—"} |`);
    }
    lineas.push("");
  }

  const porRegla = new Map();
  for (const fila of informe) for (const fallo of fila.axe ?? []) {
    const previo = porRegla.get(fallo.regla) ?? { impacto: fallo.impacto, ayuda: fallo.ayuda, nodos: 0, pantallas: new Set(), ejemplo: fallo.ejemplos[0] ?? "" };
    previo.nodos += fallo.nodos;
    previo.pantallas.add(fila.id);
    porRegla.set(fallo.regla, previo);
  }
  lineas.push(`## Accesibilidad por regla (axe-core, WCAG 2.2 AA${axeEnTodos ? "" : `; solo a ${marcaDeAxe} px`})`, "", "| Regla | Impacto | Nodos | Pantallas | Qué pide | Ejemplo |", "|---|---|---|---|---|---|");
  for (const [regla, dato] of [...porRegla].sort((a, b) => b[1].nodos - a[1].nodos)) {
    lineas.push(`| ${regla} | ${dato.impacto} | ${dato.nodos} | ${dato.pantallas.size} | ${dato.ayuda} | \`${dato.ejemplo.replace(/\|/g, "/").slice(0, 160)}\` |`);
  }

  const conDesborde = informe.filter((f) => f.anchoDePagina > f.anchoDeVentana + 1);
  const conAlgoFuera = informe.filter((f) => f.desborde?.length);
  lineas.push("", "## Elementos que se salen de la ventana", "");
  if (!conAlgoFuera.length) lineas.push("Ninguno: en ninguna pantalla hay un elemento que pase del borde de la ventana fuera de una zona que desplace o recorte.");
  for (const fila of conAlgoFuera) lineas.push(`- **${fila.marca} · ${fila.id}** — ${fila.desborde.join(" · ")}`);

  const conTablasApretadas = informe.filter((f) => f.apretadas?.length);
  lineas.push("", "## Tablas con filas de cuatro líneas o más", "");
  if (!conTablasApretadas.length) lineas.push("Ninguna: en todas las tablas de cinco filas o más, la fila mediana mide menos de 96 px.");
  for (const fila of conTablasApretadas) for (const tabla of fila.apretadas) lineas.push(`- **${fila.marca} · ${fila.id}** — ${tabla}`);

  const conSaltos = informe.filter((f) => f.saltos?.length && (axeEnTodos || f.marca === marcaDeAxe));
  lineas.push("", "## Saltos de nivel entre encabezados", "");
  if (!conSaltos.length) lineas.push("Ninguno: en ninguna pantalla se baja más de un nivel de encabezado de golpe.");
  for (const fila of conSaltos) lineas.push(`- **${fila.marca} · ${fila.id}** — ${fila.saltos.join(" · ")}`);

  const conLetraPequena = informe.filter((f) => f.letraPequena?.length);
  lineas.push("", "## Letra por debajo de 12 px", "");
  if (!conLetraPequena.length) lineas.push("Ninguna: en ninguna pantalla hay texto a la vista más pequeño que el menor tamaño del sistema.");
  for (const fila of conLetraPequena) lineas.push(`- **${fila.marca} · ${fila.id}** — ${fila.letraPequena.join(" · ")}`);

  const conCifrasFuera = informe.filter((f) => f.cifrasFuera?.length);
  lineas.push("", "## Cifras que se salen de su casilla", "");
  if (!conCifrasFuera.length) lineas.push("Ninguna: en la banda de respuesta de cada pantalla, toda cifra cabe en su casilla.");
  for (const fila of conCifrasFuera) lineas.push(`- **${fila.marca} · ${fila.id}** — ${fila.cifrasFuera.join(" · ")}`);

  const conTextoCortado = informe.filter((f) => f.textoCortado?.length);
  const cortesAdmitidos = informe.reduce((suma, f) => suma + (f.cortesAdmitidos ?? 0), 0);
  lineas.push("", "## Textos cortados", "");
  if (!conTextoCortado.length) lineas.push("Ninguno entre los que se miden: ningún texto que su hoja mande recortar se queda sin sitio, fuera de los que el sistema de diseño admite.");
  for (const fila of conTextoCortado) lineas.push(`- **${fila.marca} · ${fila.id}** — ${fila.textoCortado.join(" · ")}`);
  lineas.push(
    "",
    `Cortes que el sistema de diseño admite, y que no cuentan: ${cortesAdmitidos}. ${CORTES_ADMITIDOS.map((corte) => `\`${corte.selector}\`: ${corte.motivo}`).join("; ")}.`,
    "",
    "No se mide el texto de un desplegable ni el de un campo, ni el que una caja de alto fijo tapa sin que su hoja lo mande recortar."
  );

  /* Las cajas que se desplazan de lado. Que una tabla ancha lo haga es lo previsto: se listan las que alguien tiene que
     mirar —dejan un control fuera de la vista, o no llevan nada que se enfoque— y todas se cuentan por clase de caja. */
  const conCajas = informe.filter((f) => f.cajasDesplazables?.length);
  const conControlesFuera = conCajas.filter((f) => f.cajasDesplazables.some((caja) => caja.controles > 0));
  const conCajasSinTeclado = conCajas.filter((f) => f.cajasDesplazables.some((caja) => !caja.conTeclado));
  lineas.push("", "## Cajas que se desplazan de lado", "");
  if (!conCajas.length) lineas.push("Ninguna: en ninguna pantalla hay una caja con desplazamiento propio a la que su contenido no le quepa de ancho.");
  else {
    lineas.push(
      "Una caja con desplazamiento propio a la que su contenido no le cabe de ancho no desborda la página ni corta un texto: lo que no cabe queda dentro, a un desplazamiento de distancia. Que una tabla ancha lo haga es lo previsto. Se listan las que alguien tiene que mirar y, después, todas por clase de caja.",
      "",
      "### Con algún control fuera de la vista",
      ""
    );
    if (!conControlesFuera.length) lineas.push("Ninguna: tal como se abre cada pantalla, ningún botón, enlace ni campo de una fila queda fuera de la vista dentro de una caja que se desplaza.");
    for (const fila of conControlesFuera) lineas.push(`- **${fila.marca} · ${fila.id}** — ${fila.cajasDesplazables.filter((caja) => caja.controles > 0).map(describirCaja).join(" · ")}`);
    lineas.push("", "### Sin nada que se enfoque", "");
    if (!conCajasSinTeclado.length) lineas.push("Ninguna: toda caja que se desplaza de lado se puede enfocar, o lleva dentro algo que se enfoca.");
    else lineas.push("Con el teclado solo se llega a lo que queda fuera de estas en un navegador que enfoque por su cuenta una caja que se desplaza: la página no lo garantiza.", "");
    for (const fila of conCajasSinTeclado) lineas.push(`- **${fila.marca} · ${fila.id}** — ${fila.cajasDesplazables.filter((caja) => !caja.conTeclado).map(describirCaja).join(" · ")}`);
    /* Todas, por clase de caja: en cuántas pantallas y a qué anchos se desplaza, y dónde deja más fuera. */
    const porClase = new Map();
    for (const fila of conCajas) for (const caja of fila.cajasDesplazables) {
      const previa = porClase.get(caja.firma) ?? { pantallas: new Set(), anchos: new Set(), peor: null };
      previa.pantallas.add(fila.id);
      previa.anchos.add(fila.marca);
      if (!previa.peor || caja.fuera > previa.peor.fuera) previa.peor = { fuera: caja.fuera, donde: `${fila.marca} · ${fila.id}` };
      porClase.set(caja.firma, previa);
    }
    const porPixeles = (a, b) => Number.parseInt(a, 10) - Number.parseInt(b, 10) || a.localeCompare(b);
    lineas.push("", "### Todas, por clase de caja", "", "| Caja | Pantallas | Anchos | Donde más deja fuera |", "|---|---|---|---|");
    for (const [firma, dato] of [...porClase].sort((a, b) => b[1].pantallas.size - a[1].pantallas.size || b[1].peor.fuera - a[1].peor.fuera)) {
      lineas.push(`| ${firma} | ${dato.pantallas.size} | ${[...dato.anchos].sort(porPixeles).join(", ")} | ${dato.peor.fuera} px (${dato.peor.donde}) |`);
    }
    const conMasDeLasGuardadas = conCajas.filter((f) => (f.cajasQueSeDesplazan ?? 0) > f.cajasDesplazables.length);
    if (conMasDeLasGuardadas.length) {
      lineas.push("", `En ${plural(conMasDeLasGuardadas.length, "pantalla hay", "pantallas hay")} más cajas de las que se guardan —de cada pantalla, todas las que hay que mirar y, de las demás, ${TOPE_DE_CAJAS_POR_PANTALLA}—: ${conMasDeLasGuardadas.map((f) => `${f.marca} · ${f.id} (${f.cajasQueSeDesplazan})`).join(", ")}.`);
    }
  }
  lineas.push(
    "",
    "Los botones de la cabecera de una tabla no cuentan como controles fuera de la vista: van con su columna. No se mide lo que queda fuera en vertical, ni lo que una caja recorta sin dejar desplazarse, ni si la columna que queda fuera hace falta para leer la fila."
  );

  /* El Modo cliente: tienen que estar todas las pantallas que se pidieron en ese modo, en todos los anchos. */
  const pedidasEnModoCliente = pantallas.filter((pantalla) => pantalla.modoCliente).map((pantalla) => pantalla.id);
  const enModoCliente = informe.filter((f) => Array.isArray(f.modoCliente));
  const conFugas = enModoCliente.filter((f) => f.modoCliente.length);
  const faltan = pedidasEnModoCliente.flatMap((id) => marcas.filter((marca) => !enModoCliente.some((f) => f.id === id && f.marca === marca)).map((marca) => `${marca} · ${id}`));
  lineas.push("", "## Modo cliente", "");
  if (!pedidasEnModoCliente.length) lineas.push("No se pidió ninguna pantalla en Modo cliente en esta pasada.");
  else if (!conFugas.length && !faltan.length) {
    lineas.push(`En ${plural(pedidasEnModoCliente.length, "pantalla medida", "pantallas medidas")} en Modo cliente (${pedidasEnModoCliente.join(", ")}), a ${plural(marcas.length, "ancho", "anchos")}, el interruptor quedó encendido, se lee lo que cada una tiene que enseñar y la página no lleva nada reservado al asesor, tampoco dentro de un panel plegado (${PALABRAS_DEL_ASESOR.map(({ palabra }) => `«${palabra}»`).join(", ")}).`);
  }
  for (const fila of conFugas) lineas.push(`- **${fila.marca} · ${fila.id}** — ${fila.modoCliente.join(" · ")}`);
  for (const falta of faltan) lineas.push(`- **${falta}** — se pidió en Modo cliente y no se midió`);

  /* Los títulos de pantalla: uno. Ni dos, ni ninguno. La pantalla de acceso no lleva el marco de la aplicación y no cuenta. */
  const conVariosTitulos = informe.filter((f) => f.titulosDePantalla > 1);
  const sinTitulo = informe.filter((f) => f.titulosDePantalla === 0 && f.id !== "acceso" && !f.esElAcceso);
  lineas.push("", "## Títulos de pantalla", "");
  if (!conVariosTitulos.length && !sinTitulo.length) lineas.push("Cada pantalla enseña un título de pantalla (`h1`), y solo uno.");
  for (const fila of conVariosTitulos) lineas.push(`- **${fila.marca} · ${fila.id}** — ${fila.titulosDePantalla} títulos de pantalla: ${(fila.titulos ?? []).map((titulo) => `«${titulo}»`).join(", ")}`);
  for (const fila of sinTitulo) lineas.push(`- **${fila.marca} · ${fila.id}** — ningún título de pantalla a la vista`);

  if (sinBarra.length) {
    lineas.push("", "## Pantallas que desplazan y se midieron sin barra", "", "El navegador no pintó la barra de desplazamiento: estas pantallas se midieron con más sitio del que tienen en una ventana.", "");
    for (const fila of sinBarra) lineas.push(`- **${fila.marca} · ${fila.id}** — ${fila.altoDePagina} px de alto en una ventana de ${fila.altoDeVentana}`);
  }

  if (sinMedir.length) {
    lineas.push("", "## Pantallas que no se pudieron medir", "", "De estas no se sabe nada: ni si desbordan, ni si cortan un texto, ni su accesibilidad. La pasada no vale hasta repetirlas.", "");
    for (const fila of sinMedir) lineas.push(`- **${fila.marca} · ${fila.id}** — ${fila.fallo ?? "sin medidas"}`);
  }

  const sinPreparar = informe.filter((f) => f.fallo);
  if (sinPreparar.length) {
    lineas.push("", "## Pantallas en las que algo falló al prepararlas, medirlas o fotografiarlas", "");
    for (const fila of sinPreparar) lineas.push(`- **${fila.marca} · ${fila.id}** — ${fila.fallo}`);
  }

  const conConsola = informe.filter((f) => f.consola.length || f.peticiones.length);
  lineas.push("", "## Consola y peticiones", "");
  if (!conConsola.length) lineas.push("Ninguna pantalla escribió errores o avisos en la consola ni tuvo peticiones fallidas.");
  const conEsperados = informe.filter((f) => f.esperados);
  if (conEsperados.length) lineas.push("", `No cuenta lo que una pantalla declara como esperado: ${[...new Set(conEsperados.map((f) => f.id))].join(", ")} (un servicio local que no está en marcha, y la pantalla lo dice).`);
  for (const fila of conConsola) {
    lineas.push(`- **${fila.marca} · ${fila.id}**`);
    for (const texto of [...fila.consola, ...fila.peticiones]) lineas.push(`  - ${texto.replace(/\s+/g, " ")}`);
  }

  const consola = [
    `\nPantallas recorridas: ${informe.length}. Con desborde: ${conDesborde.length}. Con algo fuera de la ventana: ${conAlgoFuera.length}. Con consola o peticiones: ${conConsola.length}. Reglas de accesibilidad incumplidas: ${porRegla.size}. Con tablas apretadas: ${conTablasApretadas.length}. Con saltos de encabezado: ${conSaltos.length}. Con letra pequeña: ${conLetraPequena.length}. Con cifras fuera de su casilla: ${conCifrasFuera.length}. Con texto cortado: ${conTextoCortado.length}. Con cajas que se desplazan de lado: ${conCajas.length}; con algún control fuera de la vista: ${conControlesFuera.length}; con alguna sin nada que se enfoque: ${conCajasSinTeclado.length}. Con más de un título de pantalla: ${conVariosTitulos.length}; sin ninguno: ${sinTitulo.length}. En Modo cliente: ${enModoCliente.length} (pantallas por ancho), con fallos: ${conFugas.length}, sin medir: ${faltan.length}. Sin barra donde debía haberla: ${sinBarra.length}. Sin medir: ${sinMedir.length}. Con algún fallo al prepararlas, medirlas o fotografiarlas: ${sinPreparar.length}.`
  ];
  for (const fila of conFugas) consola.push(`  MODO CLIENTE · ${fila.marca} · ${fila.id} · ${fila.modoCliente.join(" · ")}`);
  for (const fila of conVariosTitulos) consola.push(`  títulos · ${fila.marca} · ${fila.id} · ${(fila.titulos ?? []).join(" · ")}`);
  for (const fila of sinTitulo) consola.push(`  sin título · ${fila.marca} · ${fila.id}`);
  for (const fila of conTextoCortado) consola.push(`  cortado · ${fila.marca} · ${fila.id} · ${fila.textoCortado.join(" · ")}`);
  /* De las cajas, solo las que alguien tiene que mirar: las demás están en el informe, por clase. */
  for (const fila of conCajas) {
    const deMirar = fila.cajasDesplazables.filter((caja) => caja.controles > 0 || !caja.conTeclado);
    if (deMirar.length) consola.push(`  caja · ${fila.marca} · ${fila.id} · ${deMirar.map(describirCaja).join(" · ")}`);
  }
  for (const fila of conAlgoFuera) consola.push(`  fuera · ${fila.marca} · ${fila.id} · ${fila.desborde.join(" · ")}`);
  for (const fila of conCifrasFuera) consola.push(`  cifra · ${fila.marca} · ${fila.id} · ${fila.cifrasFuera.join(" · ")}`);
  for (const fila of conLetraPequena) consola.push(`  letra · ${fila.marca} · ${fila.id} · ${fila.letraPequena.join(" · ")}`);
  for (const fila of sinPreparar) consola.push(`  sin preparar · ${fila.marca} · ${fila.id} · ${fila.fallo}`);
  for (const fila of conSaltos) consola.push(`  salto · ${fila.marca} · ${fila.id} · ${fila.saltos.join(" · ")}`);
  for (const fila of conTablasApretadas) for (const tabla of fila.apretadas) consola.push(`  apretada · ${fila.marca} · ${fila.id} · ${tabla}`);

  /* Si una pantalla del recorrido es la de acceso, no se recorrió: se fotografió el acceso en su lugar. Antes se miraba
     que no todas llevaran el mismo título, y daba falsa alarma con las pestañas de una misma pantalla (las cuatro de
     Diseño, las de Mercado): ahora se mira lo que distingue al acceso. */
  for (const marca of marcas) {
    const enElAcceso = informe.filter((f) => f.marca === marca && f.id !== "acceso" && f.esElAcceso).map((f) => f.id);
    if (enElAcceso.length) errores.push(`NO SE RECORRIÓ en ${marca}: estas pantallas son la de acceso: ${enElAcceso.join(", ")}.`);
    /* Una pantalla sin medir no se sabe cómo está: la pasada no la puede dar por buena. */
    const noMedidas = sinMedir.filter((f) => f.marca === marca).map((f) => f.id);
    if (noMedidas.length) errores.push(`NO SE MIDIÓ en ${marca}: ${noMedidas.join(", ")}.`);
  }
  /* Y si en Modo cliente se lee algo del asesor, o no se pudo mirar, tampoco vale: es lo que no puede pasar delante de
     un cliente. */
  if (conFugas.length) errores.push(`MODO CLIENTE: ${conFugas.length === 1 ? "1 pantalla deja" : `${conFugas.length} pantallas dejan`} ver algo reservado al asesor, o no se pudo comprobar.`);
  if (faltan.length) errores.push(`MODO CLIENTE: se pidió y no se midió en ${faltan.join(", ")}.`);
  if (sinBarra.length) errores.push(`SIN BARRA: ${plural(sinBarra.length, "pantalla que desplaza se midió", "pantallas que desplazan se midieron")} sin barra de desplazamiento; el navegador no la está pintando y sobran sus píxeles en todas las medidas.`);

  return { lineas, consola, errores, codigo: errores.length ? 1 : 0 };
}
