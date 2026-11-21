/**
 * Dónde está la aplicación y cómo se entra en ella: lo que comparten las comprobaciones que abren un navegador (la
 * batería de fotos, el recorrido de la auditoría y las dos pruebas de humo).
 *
 * Hasta el 19-11-2026 cada una llevaba su copia, y habían divergido: tres apuntaban por defecto a un puerto que en
 * local no levanta nadie (el 5178, que es el del CI de la aplicación) y una de las que tienen que entrar no entraba, así
 * que con Firebase configurado —que es como está el entorno local— se quedaba esperando un campo que no llegaba. La
 * prueba de humo de los PDF solo toma de aquí la dirección: no entra ni lee la base.
 */

/** Vite sirve en el 5174 y escucha solo en `::1`: `localhost`, nunca `127.0.0.1` (habilidad `arrancar-entorno`). */
export const BASE_POR_DEFECTO = "http://localhost:5174";

/** La dirección de la aplicación: `AUDIT_BASE` (o `AUDIT_BASE_URL`, que es como la llamaban las pruebas de humo). */
export const baseDeLaApp = () => process.env.AUDIT_BASE ?? process.env.AUDIT_BASE_URL ?? BASE_POR_DEFECTO;

/**
 * Las credenciales del usuario local del emulador. No viven en el repositorio: las declara
 * `scripts/seedEmulatorUser.mjs`, valen solo contra el emulador y se pasan por entorno.
 */
export const credenciales = () => ({ correo: process.env.BDB_SHOTS_EMAIL, clave: process.env.BDB_SHOTS_PASSWORD });

/** Lo que solo existe con la aplicación abierta: el interruptor de Modo cliente de su barra superior. */
export const MARCO_DE_LA_APP = '[role="switch"].topbar-switch';
/** Lo que solo existe en la pantalla de acceso. */
const FORMULARIO_DE_ACCESO = 'input[type="email"]';

/**
 * Entra en la aplicación. Devuelve «no pide acceso» si la aplicación abre sin él (sin Firebase configurado) y «dentro»
 * si entró. Si pide acceso y faltan las credenciales, si el formulario sigue en pantalla, o si no llega a verse ni el
 * formulario ni la aplicación, lanza un error que lo dice: seguir sin entrar es fotografiar o medir la pantalla de
 * acceso en todas las rutas.
 *
 * Dos esperas, y las dos a lo que se ve, no a que la red calle. Al abrir: al formulario o a la aplicación. Que no haya
 * campo de correo no quiere decir que no se pida acceso: la pantalla de acceso pasa antes por «Cargando acceso…» y
 * «Comprobando sesión…», y tiene una de error, todas sin campo. Y al entrar: a que el formulario DESAPAREZCA, porque
 * la sesión de Firebase se resuelve después de `networkidle`, y navegando antes de que se guarde la aplicación vuelve
 * a pedir acceso (medido el 03-11-2026: con `networkidle` la pasada volvía a salir entera en la pantalla de acceso).
 */
export async function entrar(page, base = baseDeLaApp()) {
  await page.goto(base + "/", { waitUntil: "load", timeout: 30000 });
  try {
    await page.waitForSelector(`${FORMULARIO_DE_ACCESO}, ${MARCO_DE_LA_APP}`, { state: "attached", timeout: 30000 });
  } catch {
    throw new Error(`En ${base} no ha aparecido ni el formulario de acceso ni la aplicación: la pantalla de acceso se quedó cargando o dio un error, o ahí no está la aplicación.`);
  }
  const campoCorreo = page.locator(FORMULARIO_DE_ACCESO);
  if (!(await campoCorreo.count())) return "no pide acceso";
  const { correo, clave } = credenciales();
  if (!correo || !clave) {
    throw new Error("Faltan BDB_SHOTS_EMAIL y BDB_SHOTS_PASSWORD: sin entrar solo se ve la pantalla de acceso. Son las del usuario local del emulador (scripts/seedEmulatorUser.mjs).");
  }
  await campoCorreo.fill(correo);
  await page.locator('input[type="password"]').fill(clave);
  await page.getByRole("button", { name: "Entrar" }).click();
  try {
    await campoCorreo.waitFor({ state: "detached", timeout: 20000 });
  } catch {
    throw new Error("No se completó el acceso: el formulario sigue en pantalla. ¿Está sembrado el usuario del emulador (`npm run seed:emulator-user`)? Hay que sembrarlo en cada arranque del emulador de Auth.");
  }
  /* Y a que la aplicación esté pintada: la red puede no callar si la pantalla a la que se llega escucha la base. */
  await page.waitForLoadState("networkidle", { timeout: 15000 }).catch(() => {});
  try {
    await page.waitForSelector(MARCO_DE_LA_APP, { state: "attached", timeout: 20000 });
  } catch {
    throw new Error("El formulario de acceso se fue, pero la aplicación no ha llegado a pintarse.");
  }
  return "dentro";
}
