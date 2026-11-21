import type { ReactNode } from "react";
import type { AppRouteId } from "./appRoutes";

/**
 * Arquitectura de navegación. Decisión 1 del rediseño, 02-11-2026.
 *
 * El principio no cambia desde la ola 3b: un destino pertenece al grupo de la ENTIDAD
 * sobre la que trabaja, no al de la herramienta que usa. Lo que cambia es que ese
 * principio no se estaba cumpliendo, y se midió dónde:
 *
 * - «Posiciones globales» y «Extracto externo» eran el MISMO componente
 *   —`PositionsWorkbench`, modos `global` y `extracto`— en dos secciones distintas.
 *   Ahora son un destino, «Posiciones», con los dos modos dentro.
 * - «Cartera» y «Cartera real» se distinguían por un adjetivo, y el corte entre ellas
 *   no era lo que el asesor hace sino de dónde venían los datos: modelados contra
 *   importados. Esa es una distinción del sistema, no suya, y era la que obligaba al
 *   reparto anterior. Son una sola sección, «Carteras».
 * - «Carteras guardadas» era un panel dentro del Constructor y ahora es un destino: su tabla.
 * - «Salud del catálogo» no es asesoramiento —contesta dónde conviene invertir
 *   esfuerzo de datos—, así que vive al pie, en «Datos», con Sistema.
 *
 * Y dos decisiones de Óscar del 04-11-2026, sobre la auditoría de pantallas: Análisis va
 * antes que los informes (la 27), porque primero se mira y luego se documenta, y la entrada
 * del informe pasa a decir «Informes» (la 25). Sin cambiar ninguna dirección.
 *
 * 13-11-2026, rediseño «Informe vivo» (apartado 3 de `docs/frontend/SISTEMA_DISENO.md`): «Carteras» se parte en dos.
 * Mezclaba dos objetos que el asesor no confunde y el menú sí: la cartera que se DISEÑA para proponérsela a un
 * cliente y la cartera REAL de un cliente, con sus movimientos. La primera es «Propuestas» —Diseño, Análisis,
 * Informes y Guardadas, cuatro pasos sobre el mismo objeto—; la segunda, «Clientes» —Carteras de clientes y
 * Posiciones—. Con eso la barra superior puede decir de cuál habla: «Propuesta en curso» (hallazgo DIR-04). Las
 * entradas se acortan porque el grupo ya dice el objeto; el título de la pantalla, que es lo que leen la pestaña
 * del navegador y las migas, lo conserva donde el rótulo solo no basta (`titulo`). Sin cambiar ninguna dirección.
 *
 * Lo que este fichero NO decide es la ficha. Tiene dirección propia desde hoy
 * (`/activo/<ISIN>`) y a propósito no es entrada del rail: nadie pulsa «Ficha» sin un
 * instrumento delante. Se llega desde el Buscador, el Comparador y la cartera.
 *
 * El porqué de cada cambio, medido, está en
 * `docs/rediseno-2026-11/MAPA_NAVEGACION_2026-11-02.md`. De septiembre no quedó ningún
 * documento que dijera por qué se eligió un mapa, y el motivo se perdió; esta vez no.
 */

export type NavItem = {
  id: AppRouteId;
  /** El rótulo del menú. Dentro de su grupo, que ya dice el objeto. */
  label: string;
  /** El título de la pantalla: lo usan la pestaña del navegador y las migas. Sin él, sale `label`. */
  titulo?: string;
  /** El nombre bajo el icono en tablet (88 px, a 12 px de letra), donde no cabe el entero. Sin él, sale `label`. */
  corto?: string;
  icon: ReactNode;
  ready: boolean;
};

export type NavSection = {
  label: string;
  items: NavItem[];
  /** Se ancla al final del rail, separada del flujo de asesoramiento. */
  tail?: boolean;
};

// eslint-disable-next-line react-refresh/only-export-components -- helper local de iconos, no es un componente exportado
function Icon({ children }: { children: ReactNode }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width="16"
      height="16"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.7}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {children}
    </svg>
  );
}

export const NAV_SECTIONS: NavSection[] = [
  {
    label: "Mercado",
    items: [
      {
        id: "mercado",
        label: "Mercado",
        ready: true,
        icon: (
          <Icon>
            <path d="M4 20V4" />
            <path d="M4 20h16" />
            <path d="M8 16v-5M12.5 16V7M17 16v-8" />
          </Icon>
        )
      }
    ]
  },
  {
    label: "Activos",
    items: [
      {
        id: "buscador",
        label: "Buscador",
        ready: true,
        icon: (
          <Icon>
            <circle cx="11" cy="11" r="7" />
            <path d="M20.5 20.5 16.7 16.7" />
          </Icon>
        )
      },
      {
        id: "comparador",
        label: "Comparador",
        ready: true,
        icon: (
          <Icon>
            <path d="M12 4v16" />
            <path d="M7 8H3.5l2.2 5a2.6 2.6 0 0 0 4.6 0L12.5 8H9" />
            <path d="M20.5 8H17l2.2 5a2.6 2.6 0 0 0 4.6 0" transform="translate(-3.5)" />
            <path d="M8 4.8h8" />
          </Icon>
        )
      }
    ]
  },
  {
    label: "Propuestas",
    items: [
      {
        id: "cartera",
        label: "Diseño",
        titulo: "Diseño de la propuesta",
        corto: "Diseño",
        ready: true,
        icon: (
          <Icon>
            <rect x="3" y="7" width="18" height="13" rx="1.6" />
            <path d="M8.5 7V5.4A1.4 1.4 0 0 1 9.9 4h4.2a1.4 1.4 0 0 1 1.4 1.4V7" />
            <path d="M3 12.5h18" />
          </Icon>
        )
      },
      {
        id: "analisis",
        label: "Análisis",
        ready: true,
        icon: (
          <Icon>
            <circle cx="12" cy="12" r="8.5" />
            <circle cx="12" cy="12" r="3.2" />
            <path d="M12 3.5v2.6M12 17.9v2.6M3.5 12h2.6M17.9 12h2.6" />
          </Icon>
        )
      },
      {
        id: "informes",
        label: "Informes",
        ready: true,
        icon: (
          <Icon>
            <path d="M6 3h8.5L18 6.5V21H6z" />
            <path d="M14.5 3v3.5H18M9 12h6M9 16h4" />
          </Icon>
        )
      },
      {
        id: "carteras-guardadas",
        label: "Guardadas",
        titulo: "Propuestas guardadas",
        corto: "Guardadas",
        ready: true,
        // Carpetas apiladas: una lista de carteras, no una cartera.
        icon: (
          <Icon>
            <path d="M3 8.5V18a1.5 1.5 0 0 0 1.5 1.5H18" />
            <path d="M7 5h3.4l1.3 1.8H19a1.5 1.5 0 0 1 1.5 1.5v6.2A1.5 1.5 0 0 1 19 16H7a1.5 1.5 0 0 1-1.5-1.5v-8A1.5 1.5 0 0 1 7 5Z" />
          </Icon>
        )
      }
    ]
  },
  {
    label: "Clientes",
    items: [
      {
        id: "cartera-real",
        label: "Carteras de clientes",
        corto: "Clientes",
        ready: true,
        icon: (
          <Icon>
            <path d="M4 20V4.5" />
            <path d="M4 20h16" />
            <path d="M7.5 15.5 11 10.5l3 2 4-6.5" />
            <circle cx="18.5" cy="5.5" r="1.6" />
          </Icon>
        )
      },
      {
        id: "posiciones",
        label: "Posiciones",
        ready: true,
        // El listado de líneas del extracto. El icono de capas apiladas que tenía
        // «Posiciones globales» se retira con el destino: los dos modos comparten
        // pantalla, así que comparten icono.
        icon: (
          <Icon>
            <path d="M9 6h12M9 12h12M9 18h12" />
            <circle cx="4.6" cy="6" r="1.3" />
            <circle cx="4.6" cy="12" r="1.3" />
            <circle cx="4.6" cy="18" r="1.3" />
          </Icon>
        )
      }
    ]
  },
  /* 13-11-2026. La entidad de esta sección no es un activo ni una cartera: es el plan de un cliente. Por eso el
     simulador de jubilación no cuelga de «Propuestas», aunque pueda partir de la propuesta en curso. */
  {
    label: "Planificación",
    items: [
      {
        id: "jubilacion",
        label: "Jubilación",
        ready: true,
        // Un sol sobre el horizonte: una etapa que empieza, no un reloj que se acaba.
        icon: (
          <Icon>
            <path d="M3 18.5h18" />
            <path d="M6.5 18.5a5.5 5.5 0 0 1 11 0" />
            <path d="M12 5.5v3M5 9.4l2.1 2.1M19 9.4l-2.1 2.1" />
          </Icon>
        )
      },
      /* 13-11-2026, decisión D-11. Los planes de pensiones y las EPSV son patrimonio del cliente, pero no cartera:
         no se gestionan con ella, por fiscalidad. Por eso su catálogo está aquí y no en «Activos». */
      {
        id: "planes",
        label: "Planes y EPSV",
        corto: "Planes",
        ready: true,
        // Dos columnas de una misma tabla: dos planes, uno junto a otro.
        icon: (
          <Icon>
            <rect x="4" y="4.5" width="16" height="15" rx="1.5" />
            <path d="M12 4.5v15M4 9.5h16" />
          </Icon>
        )
      }
    ]
  }
];

/**
 * La sección del pie. Se llamaba «Sistema» y ahora es «Datos», porque desde el
 * 02-11-2026 tiene dos destinos y el otro no es administración: «Salud del catálogo»
 * contesta dónde conviene invertir esfuerzo de datos, que es trabajo de curación.
 *
 * Sigue estando detrás del claim `admin`, como antes. Eso no es un descuido: las dos
 * pantallas hablan del estado de la base, no de un cliente.
 */
export const SYSTEM_SECTION: NavSection = {
  label: "Datos",
  tail: true,
  items: [
    {
      id: "salud-catalogo",
      label: "Salud del catálogo",
      corto: "Salud",
      ready: true,
      // Un pulso: el estado de algo vivo, no una tabla.
      icon: (
        <Icon>
          <path d="M3 12h3.8l2-5.5 3 11 2.4-7 1.8 3.2h4" />
        </Icon>
      )
    },
    {
      id: "sistema",
      label: "Sistema",
      ready: true,
      icon: (
        <Icon>
          <ellipse cx="12" cy="6" rx="7.5" ry="3" />
          <path d="M4.5 6v6c0 1.7 3.4 3 7.5 3s7.5-1.3 7.5-3V6" />
          <path d="M4.5 12v6c0 1.7 3.4 3 7.5 3s7.5-1.3 7.5-3v-6" />
        </Icon>
      )
    }
  ]
};

function itemForRoute(routeId: AppRouteId): NavItem | null {
  for (const section of [...NAV_SECTIONS, SYSTEM_SECTION]) {
    const item = section.items.find((entry) => entry.id === routeId);
    if (item) return item;
  }
  return null;
}

/** Sección a la que pertenece cada destino — alimenta las migas de la barra superior. */
export function sectionForRoute(routeId: AppRouteId): string | null {
  for (const section of [...NAV_SECTIONS, SYSTEM_SECTION]) {
    if (section.items.some((item) => item.id === routeId)) return section.label;
  }
  return null;
}

/** El rótulo del menú. */
export function labelForRoute(routeId: AppRouteId): string | null {
  return itemForRoute(routeId)?.label ?? null;
}

/** El título de la pantalla: el de la pestaña del navegador y el de las migas. */
export function tituloForRoute(routeId: AppRouteId): string | null {
  const item = itemForRoute(routeId);
  return item ? item.titulo ?? item.label : null;
}
