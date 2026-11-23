// Siembra el usuario de desarrollo del clon Gestor Activos Financieros en el
// emulador de Auth.
//
// Por que hace falta: el emulador no persiste entre arranques, y la copia de
// seguridad de BDB guarda los usuarios SIN correo, SIN hash y SIN claims (a
// proposito: una copia no debe llevar credenciales). Con aquellos 18 usuarios
// no se puede entrar. Este es un usuario local de mentira, valido solo contra
// el emulador de esta maquina; no existe en ninguna nube.
//
//   npm run seed:emulator-user

const AUTH_HOST = process.env.VITE_FIREBASE_AUTH_EMULATOR_URL || "http://127.0.0.1:9097";
// Desde el 21-11-2026 el desarrollo local usa el proyecto de la base nueva contra sus emuladores. Solo
// habla con el emulador de Auth de esta maquina (AUTH_HOST): en la nube este usuario no existe.
const PROJECT = process.env.VITE_FIREBASE_PROJECT_ID || "bdb-gestor-de-activos";

const EMAIL = process.env.SEED_EMAIL || "asesor@local.test";
const PASSWORD = process.env.SEED_PASSWORD || "DesarrolloLocal-2026";

const idToolkit = `${AUTH_HOST}/identitytoolkit.googleapis.com/v1`;

async function post(url, body, owner = false) {
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(owner ? { Authorization: "Bearer owner" } : {})
    },
    body: JSON.stringify(body)
  });
  const text = await res.text();
  let parsed;
  try { parsed = JSON.parse(text); } catch { parsed = { raw: text }; }
  if (!res.ok) throw new Error(`${res.status} ${url}\n${text}`);
  return parsed;
}

async function main() {
  /* El proyecto es el real: que la siembra solo pueda ir a un emulador de esta maquina. */
  if (!/^http:\/\/(127\.0\.0\.1|localhost|\[::1\]):\d+\/?$/.test(AUTH_HOST)) {
    console.error(`AUTH_HOST no es un emulador local (${AUTH_HOST}): esta siembra no habla con la nube.`);
    process.exit(1);
  }
  try {
    await fetch(`${AUTH_HOST}/`);
  } catch {
    console.error(`No hay emulador de Auth en ${AUTH_HOST}. Arrancalo antes:`);
    console.error("  (la habilidad arrancar-entorno dice el orden: la base nueva y despues Auth y Functions)");
    process.exit(1);
  }

  let localId;
  try {
    const creado = await post(`${idToolkit}/accounts:signUp?key=emulador`, {
      email: EMAIL, password: PASSWORD, returnSecureToken: true
    });
    localId = creado.localId;
    console.log(`Usuario creado: ${EMAIL}`);
  } catch (error) {
    if (!String(error.message).includes("EMAIL_EXISTS")) throw error;
    const existente = await post(`${idToolkit}/projects/${PROJECT}/accounts:query`, {}, true);
    localId = (existente.userInfo || []).find((u) => u.email === EMAIL)?.localId;
    console.log(`Usuario ya existente: ${EMAIL}`);
  }

  // Claim de administrador y correo verificado: sin el claim, las reglas de
  // Firestore y useIsAdmin dejan fuera las pantallas de administracion.
  await post(`${idToolkit}/projects/${PROJECT}/accounts:update`, {
    localId,
    emailVerified: true,
    customAttributes: JSON.stringify({ admin: true })
  }, true);

  console.log("Claim admin y correo verificado aplicados.");
  console.log(`\nEntra en http://localhost:5174 con:\n  correo:     ${EMAIL}\n  contrasena: ${PASSWORD}`);
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
