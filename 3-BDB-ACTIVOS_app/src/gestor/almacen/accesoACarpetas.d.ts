/**
 * Lo que le falta a la `lib` DOM de TypeScript de la File System Access API: el selector de
 * carpetas y los permisos de un manejador. Solo existen en Chrome y Edge (y otros Chromium);
 * por eso van como opcionales y el código comprueba que estén antes de usarlos.
 */

interface FileSystemHandlePermissionDescriptor {
  mode?: "read" | "readwrite";
}

interface FileSystemHandle {
  queryPermission?(descriptor?: FileSystemHandlePermissionDescriptor): Promise<PermissionState>;
  requestPermission?(descriptor?: FileSystemHandlePermissionDescriptor): Promise<PermissionState>;
}

interface DirectoryPickerOptions {
  /** Recuerda la última carpeta abierta con este id para proponerla la próxima vez. */
  id?: string;
  mode?: "read" | "readwrite";
  startIn?: FileSystemHandle | "desktop" | "documents" | "downloads" | "music" | "pictures" | "videos";
}

interface Window {
  showDirectoryPicker?(opciones?: DirectoryPickerOptions): Promise<FileSystemDirectoryHandle>;
}
