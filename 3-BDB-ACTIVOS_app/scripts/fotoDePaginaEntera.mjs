/**
 * La foto de la página entera sin apagar el modo táctil.
 *
 * `page.screenshot({ fullPage: true })` captura más allá de la ventana, y Chromium lo hace sin la emulación táctil y la
 * deja apagada. Medido el 05-11-2026 con Playwright 1.62, `hasTouch` y una página más alta que la ventana: la imagen sale
 * pintada con `pointer: fine`, ya desde la primera foto, y desde entonces `matchMedia("(pointer: coarse)")` es falso y
 * `navigator.maxTouchPoints` es 0 en todas las rutas siguientes. Reactivar la emulación después no arregla la imagen. Así,
 * la batería a 1024 y 768 fotografiaba y medía una tablet con ratón: iconos de 30 px donde hay 40, y nombres recortados
 * que con dedo salen enteros.
 *
 * Con dedo, se agranda la ventana hasta lo que mide la página, se hace una foto de ventana y se devuelve a su tamaño.
 * Lo que queda: lo que dependa de `vh` se mide contra la ventana agrandada, y por eso una lista con tope en `vh` puede
 * salir más larga que en la tablet. Con ratón, sigue la foto de siempre.
 */
export async function fotoDePaginaEntera(page, path) {
  const conDedo = await page.evaluate(() => matchMedia("(pointer: coarse)").matches);
  if (!conDedo) {
    await page.screenshot({ path, fullPage: true });
    return;
  }
  const ventana = page.viewportSize();
  let alto = ventana.height;
  // Tres vueltas: agrandar puede alargar lo que tiene tope en `vh`, y hay que volver a medir.
  for (let vuelta = 0; vuelta < 3; vuelta++) {
    const mide = await page.evaluate(() => document.documentElement.scrollHeight);
    if (mide <= alto) break;
    alto = mide;
    await page.setViewportSize({ width: ventana.width, height: alto });
    await page.waitForTimeout(150);
  }
  await page.screenshot({ path });
  if (alto !== ventana.height) await page.setViewportSize(ventana);
}
