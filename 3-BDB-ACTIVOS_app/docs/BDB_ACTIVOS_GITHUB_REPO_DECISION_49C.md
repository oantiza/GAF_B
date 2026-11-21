# BDB-ACTIVOS GitHub repo decision 49C

## Estado actual

| Punto | Estado |
| --- | --- |
| Repo local | `BDB-ACTIVOS` |
| Rama | `master` |
| Remoto GitHub | No configurado |
| Fase MVP local | Cerrada |
| Validaciones base | `preview:static-export-sample`, build, lint y tests |
| Fuentes locales | `LOCAL_MOCK`, `BBDD_CONTRACT_FIXTURE`, `BBDD_STATIC_EXPORT_SAMPLE` |

BDB-ACTIVOS ya es un proyecto independiente. No debe mezclarse con BBDD-ACTIVOS-FINANCIEROS, BDB-FONDOS legacy ni otros repos.

## Opciones evaluadas

| Opcion | Descripcion | Ventajas | Riesgos | Decision |
| --- | --- | --- | --- | --- |
| A. Repo privado `BDB-ACTIVOS` | Crear repositorio propio privado | Nombre claro, separacion limpia, preparado para evolucion | Requiere primer push controlado | Recomendado |
| B. Repo privado `BDB-ACTIVOS-MVP` | Crear repo con sufijo MVP | Deja claro que es fase local | Puede quedarse corto si el proyecto crece | No recomendado |
| C. Mantener solo local | No crear remoto aun | Maxima prudencia inmediata | Sin backup remoto ni colaboracion | Temporal solamente |
| D. Integrar en otro repo | Meterlo en BBDD-ACTIVOS u otro proyecto | Menos repos | Mezcla responsabilidades | Rechazado |
| E. Repo publico | Publicar abiertamente | Visibilidad | Riesgo innecesario para fase inicial | Rechazado |

## Recomendacion

Crear un repositorio GitHub propio y privado llamado:

```text
BDB-ACTIVOS
```

No crear el remoto ni hacer push en este bloque. El primer push debe hacerse en un bloque posterior con autorizacion expresa y revision final de seguridad.

## Condiciones previas al primer push

Antes de configurar el remoto:

1. Confirmar `git status` limpio.
2. Confirmar que no hay remoto previo.
3. Confirmar que `node_modules`, `dist`, `.env`, `.env.local`, credenciales y llaves no estan trackeados.
4. Confirmar que no hay snapshots grandes ni datasets completos versionados.
5. Ejecutar:

```text
npm run preview:static-export-sample
npm run build
npm run lint
npm test
```

6. Revisar historial local reciente.
7. Crear remoto privado en GitHub.
8. Hacer un push controlado solo despues de autorizacion explicita.

## Exclusiones de seguridad

No deben subirse al remoto:

- `.env` ni `.env.local`;
- service accounts, private keys, API keys, tokens o credenciales;
- `node_modules`;
- `dist`;
- snapshots completos no autorizados;
- datasets grandes;
- imports runtime cross-repo;
- configuracion real de Firebase o Firestore;
- artifacts de escritura, deploy o conexion real.

## Separacion entre repos

| Repo | Rol |
| --- | --- |
| BDB-ACTIVOS | App consumidora y MVP local multi-activo |
| BBDD-ACTIVOS-FINANCIEROS | Base maestra de activos y contratos/read models |
| BDB-FONDOS legacy | Referencia historica, no dependencia runtime |
| Screener | Proyecto separado |

BDB-ACTIVOS debe evolucionar con su propio historial, issues y releases.

## Pasos manuales sugeridos

Estos pasos no se ejecutan en 49C:

```text
Crear repo privado BDB-ACTIVOS en GitHub
git remote add origin <url-del-repo-privado>
git push -u origin master
```

El comando exacto debe decidirse en el bloque de push controlado.

## Siguiente bloque recomendado

| Bloque | Objetivo |
| --- | --- |
| 49C.1 | Commit selectivo de este documento |
| 49C.2 | Crear remoto privado y primer push controlado, solo con autorizacion expresa |

