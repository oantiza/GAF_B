# -*- coding: utf-8 -*-
"""Resolucion UNICA del proyecto de la base de datos maestra. No tiene defecto.

Barrera 7 del clon (README.md): las Cloud Functions leen la maestra como proyecto
CRUZADO, asi que este id decide si el codigo habla con la base del clon o con la de
BDB, que esta en uso. Era la unica de las ocho barreras que no estaba en codigo.

Hasta el 03-11-2026 el id se resolvia con un defecto en doce ficheros
-`os.environ.get("MASTER_PROJECT_ID", <defecto>)`- y dos scripts mas lo recibian
importado de `price_refresh`. En ocho de los doce el defecto era
`bbdd-activos-financieros`, el proyecto real de BDB, y uno de esos ocho era el
cliente de ESCRITURA. Los otros cuatro decian `gestor-activos-local`: el mismo
paquete tenia dos defectos opuestos para la misma variable.

Aqui NO hay defecto, a proposito. Una barrera cuyo valor puede faltar no puede caer
en un destino: si falta, esto aborta nombrando lo que falta. Eso es lo que hace que
la comprobacion pueda fallar; antes no podia.

El `.env` de al lado lo carga la CLI de Firebase al desplegar, pero nada en Python lo
leia: un script ejecutado a mano se quedaba sin la variable y recibia el defecto.
`cargar_dotenv()` lo lee aqui, sin dependencia nueva.

Lee SOLO las claves de `CLAVES_DEL_ENV`, no el fichero entero. Un lector que inyectara
todo el `.env` en cualquier proceso que importe un modulo haria que el comportamiento
de los scripts dependiera de un fichero que nadie revisa con ese criterio -incluidas
las claves que alguien anada manana para el despliegue-, que es la misma clase de
defecto que este modulo elimina. Consecuencia, dicha entera: `FIRESTORE_EMULATOR_HOST`
NO se carga aqui, asi que un script ejecutado a mano resuelve `gestor-activos-local`
-un proyecto que no existe en la nube- y falla al conectar en vez de escribir en
ningun sitio. Para que llegue al emulador, el entorno del operador sigue poniendo
`FIRESTORE_EMULATOR_HOST`, como ya hace la habilidad `arrancar-entorno`.

Decision 106 (05-11-2026): no tener defecto no bastaba. El valor declarado se aceptaba
fuera el que fuera, asi que `MASTER_PROJECT_ID=<el de BDB>` -un .env copiado de BDB, una
variable que se queda puesta- llevaba a BDB sin que nadie lo decidiera. Ahora es una LISTA
DE PERMITIDOS, como la puerta de despliegue de `4-base-nueva`: rechazar solo a BDB dejaria
pasar a cualquier tercer proyecto que apareciera manana. BDB se nombra aparte para que el
error diga que es BDB y que no se arregla cambiando el valor por otro parecido.
"""
import os

VARIABLE = "MASTER_PROJECT_ID"
CLAVES_DEL_ENV = (VARIABLE,)
RUTA_DOTENV = os.path.join(os.path.dirname(os.path.abspath(__file__)), ".env")

# BDB esta en uso, y desde este proyecto no se escribe ni se lee.
PROYECTO_DE_BDB = "bbdd-activos-financieros"
# La base de siempre, en el emulador. No existe en la nube.
PROYECTO_BASE_DE_SIEMPRE = "gestor-activos-local"
# La base nueva: un proyecto REAL. Lo que dice "local" es el emulador, no este id.
PROYECTO_BASE_NUEVA = "bdb-gestor-de-activos"
# Los unicos que pasan. La misma pareja vive para TypeScript en
# 2-plataforma-datos/src/config/projectAllowlist.ts, y tests/barreraDeBdb.test.ts de la
# app falla si dejan de coincidir.
PROYECTOS_PERMITIDOS = (PROYECTO_BASE_DE_SIEMPRE, PROYECTO_BASE_NUEVA)

# Lo que decide con que proyecto arranca una Function, ademas de la maestra. Las dos cuentas
# de servicio estan porque el .env.example las traia de BDB: copiarlo las reclamaba.
VARIABLES_DEL_ARRANQUE = (
    "GCLOUD_PROJECT",
    "GOOGLE_CLOUD_PROJECT",
    "FIREBASE_CONFIG",
    VARIABLE,
    "BDB_READER_SERVICE_ACCOUNT",
    "BDB_WRITER_SERVICE_ACCOUNT",
)


def cargar_dotenv(ruta=None, claves=CLAVES_DEL_ENV):
    """Lector minimo del .env de al lado. Devuelve las claves que ha puesto.

    El entorno manda: una clave ya presente no se sobreescribe nunca, que es lo que
    hace el runtime de Cloud Functions. Un .env ausente no es un error: quien decide
    si falta algo es `master_project_id()`.
    """
    puestas = []
    try:
        with open(ruta or RUTA_DOTENV, "r", encoding="utf-8") as fh:
            lineas = fh.readlines()
    except OSError:
        return puestas
    for linea in lineas:
        linea = linea.strip()
        if not linea or linea.startswith("#") or "=" not in linea:
            continue
        clave, valor = linea.split("=", 1)
        clave = clave.strip()
        if clave.startswith("export "):
            clave = clave[len("export "):].strip()
        if clave not in claves or clave in os.environ:
            continue
        valor = valor.strip()
        if len(valor) >= 2 and valor[0] == valor[-1] and valor[0] in "\"'":
            valor = valor[1:-1]
        os.environ[clave] = valor
        puestas.append(clave)
    return puestas


def exigir_proyecto_permitido(valor, de_donde=VARIABLE):
    """Devuelve `valor` si es uno de los dos de este proyecto. Si no, aborta nombrandolo.

    Es la misma comprobacion para el id de la maestra y para cualquier otro proyecto que
    un programa reciba de fuera, como el `--project` de `scripts/set_admin.py`.
    """
    valor = (valor or "").strip()
    if PROYECTO_DE_BDB in valor.lower():
        raise RuntimeError(
            "%s dice %r, que es el proyecto de BDB: esta en uso, y desde aqui no se escribe "
            "ni se lee. Este codigo no arranca con el aunque se declare. Si ha venido de un "
            ".env, ese fichero es de BDB y se ha colado. Los de este proyecto son: %s."
            % (de_donde, valor, ", ".join(PROYECTOS_PERMITIDOS))
        )
    if valor not in PROYECTOS_PERMITIDOS:
        raise RuntimeError(
            "%s dice %r, y aqui solo valen estos: %s. Es una lista de permitidos a proposito: "
            "un proyecto que no se conoce no se abre."
            % (de_donde, valor, ", ".join(PROYECTOS_PERMITIDOS))
        )
    return valor


def exigir_arranque_sin_bdb(entorno=None):
    """Aborta si algo de lo que decide el arranque nombra a BDB. Lo llama `main.py`, antes
    de inicializar nada.

    `master_project_id()` cierra la maestra. Esto cierra lo otro: la app del proyecto
    propio, que escribe carteras e informes con el cliente por defecto, sale del proyecto
    del runtime y no de esa variable. Unos emuladores arrancados con el proyecto de BDB y
    sin Firestore emulado escribirian ahi en la nube real.

    Solo mira si nombra a BDB: si faltan, no pasa nada, porque una copia nueva tiene que
    poder importar `main` para pasar pruebas que no hablan con ninguna base.
    """
    entorno = os.environ if entorno is None else entorno
    for nombre in VARIABLES_DEL_ARRANQUE:
        if PROYECTO_DE_BDB in (entorno.get(nombre) or "").lower():
            raise RuntimeError(
                "%s nombra el proyecto de BDB: esta en uso, y esta aplicacion no arranca con "
                "el. Si ha venido de un .env, ese fichero es de BDB y se ha colado." % nombre
            )


def master_project_id():
    """El id del proyecto de la maestra, o aborta nombrando lo que falta o lo que sobra.

    Se llama donde se USA el id -al construir un cliente-, no al importar: el `.env`
    esta en .gitignore, y una copia nueva del repositorio no debe quedarse sin poder
    importar un modulo para ejecutar un test que no habla con ninguna base. Pasar por
    aqui no se puede esquivar: no queda ningun otro sitio donde se resuelva el id.
    """
    valor = (os.environ.get(VARIABLE) or "").strip()
    if not valor:
        cargar_dotenv()
        valor = (os.environ.get(VARIABLE) or "").strip()
    if not valor:
        raise RuntimeError(
            "%s no esta declarado, y aqui no hay valor por defecto a proposito: un "
            "defecto elegiria en silencio entre la base del clon y la de BDB, que esta "
            "en uso. Declaralo en el entorno o en %s, por ejemplo "
            "%s=%s" % (VARIABLE, RUTA_DOTENV, VARIABLE, PROYECTO_BASE_DE_SIEMPRE)
        )
    return exigir_proyecto_permitido(valor)
