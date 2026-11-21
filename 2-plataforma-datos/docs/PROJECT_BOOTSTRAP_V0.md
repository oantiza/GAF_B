# Bootstrap del Proyecto (V0)

## Proyecto Firebase
- **Nombre:** BBDD Activos Financieros
- **Base de datos Firestore:** `(default)`
- **Reglas actuales:** Cerradas. 
  ```javascript
  rules_version = '2';
  service cloud.firestore {
    match /databases/{database}/documents {
      match /{document=**} {
        allow read, write: if false;
      }
    }
  }
  ```

## Políticas Estrictas
1. **No Credenciales en el Repositorio:**
   - Queda terminantemente prohibido almacenar archivos de claves, `serviceAccountKey.json`, tokens, claves de API (EODHD, OpenFIGI, etc.) o cualquier tipo de secreto dentro del código fuente o repositorio.
2. **No Escrituras sin Approval Gate:**
   - Cualquier script o servicio diseñado para insertar, actualizar o eliminar documentos en Firestore debe requerir confirmación explícita (approval gate). No se permiten escrituras directas desatendidas en esta fase.
3. **Prohibición de tocar sistemas core existentes:**
   - No se debe modificar, consultar, ni alterar bajo ninguna circunstancia los repositorios y carpetas locales `BDB-FONDOS` y `BDB-FONDOS-CORE`. Este proyecto opera de manera completamente aislada.
