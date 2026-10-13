/**
 * @file components/GoogleDrive/GoogleDriveModule.tsx
 * @description Módulo integral de integración con Google Drive para el ERP.
 * Permite:
 * 1. Autenticación oficial con Google Drive mediante Firebase Auth y credenciales seguras.
 * 2. Exploración de archivos y carpetas en Mi Unidad con migas de pan (Breadcrumbs).
 * 3. Copias de seguridad automáticas de todas las tablas del ERP directamente a Google Drive.
 * 4. Restauración de datos con un clic desde cualquier archivo de respaldo .json en Drive.
 * 5. Subida y visualización de manuales técnicos, pólizas y fotos de maquinaria pesada.
 * 6. Diálogos estrictos de confirmación previa antes de eliminar archivos en Google Drive.
 */

import React, { useEffect, useRef, useState } from 'react';
import {
  AlertCircle,
  AlertTriangle,
  ArrowDownToLine,
  ArrowLeft,
  ArrowRight,
  Calendar,
  CheckCircle2,
  Clock,
  Cloud,
  CloudCheck,
  CloudOff,
  CloudRain,
  CloudUpload,
  Database,
  Download,
  ExternalLink,
  Eye,
  File,
  FileArchive,
  FileCode,
  FileSpreadsheet,
  FileText,
  Folder,
  FolderPlus,
  HardDrive,
  HelpCircle,
  Image as ImageIcon,
  Layers,
  Lock,
  LogOut,
  Plus,
  RefreshCw,
  Search,
  SlidersHorizontal,
  Trash2,
  Truck,
  Upload,
  UserCheck,
} from 'lucide-react';
import {
  googleSignIn,
  logout,
  subscribeAuth,
  initAuth,
  getCurrentUser,
  SCOPES,
} from '../../services/googleAuth';
import {
  DriveAboutInfo,
  DriveFile,
  GoogleDriveService,
} from '../../services/googleDrive';
import { ErpApi } from '../../services/api';
import { GoogleSignInButton } from '../Google/GoogleSignInButton';
import { User } from 'firebase/auth';

interface BreadcrumbItem {
  id: string;
  name: string;
}

export const GoogleDriveModule: React.FC = () => {
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [accessToken, setAccessToken] = useState<string | null>(null);
  const [isAuthLoading, setIsAuthLoading] = useState<boolean>(true);
  const [isSigningIn, setIsSigningIn] = useState<boolean>(false);

  // Información de almacenamiento en Google Drive
  const [aboutInfo, setAboutInfo] = useState<DriveAboutInfo | null>(null);

  // Navegación de carpetas
  const [folderStack, setFolderStack] = useState<BreadcrumbItem[]>([
    { id: 'root', name: 'Mi Unidad' },
  ]);
  const currentFolder = folderStack[folderStack.length - 1];

  // Lista de archivos
  const [files, setFiles] = useState<DriveFile[]>([]);
  const [isLoadingFiles, setIsLoadingFiles] = useState<boolean>(false);
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [mimeFilter, setMimeFilter] = useState<'all' | 'folders' | 'backups' | 'documents' | 'images'>('all');

  // Modales
  const [newFolderModalOpen, setNewFolderModalOpen] = useState<boolean>(false);
  const [newFolderName, setNewFolderName] = useState<string>('');
  const [isCreatingFolder, setIsCreatingFolder] = useState<boolean>(false);

  // Diálogo de confirmación de eliminación (MANDATORIO por política de Workspace)
  const [fileToDelete, setFileToDelete] = useState<DriveFile | null>(null);
  const [isDeletingFile, setIsDeletingFile] = useState<boolean>(false);

  // Diálogo de confirmación para restaurar backup desde Drive
  const [backupToRestore, setBackupToRestore] = useState<DriveFile | null>(null);
  const [isRestoringBackup, setIsRestoringBackup] = useState<boolean>(false);

  // Creación de respaldo en Drive
  const [isCreatingBackup, setIsCreatingBackup] = useState<boolean>(false);

  // Notificaciones de éxito y error
  const [statusMessage, setStatusMessage] = useState<{
    type: 'success' | 'error' | 'info';
    text: string;
  } | null>(null);

  const fileUploadInputRef = useRef<HTMLInputElement>(null);

  // Inicializar autenticación
  useEffect(() => {
    const unsubscribeAuthListener = initAuth();

    const unsubscribeSub = subscribeAuth((user, token) => {
      setCurrentUser(user);
      setAccessToken(token);
      setIsAuthLoading(false);
    });

    return () => {
      unsubscribeAuthListener();
      unsubscribeSub();
    };
  }, []);

  // Cargar info del Drive y archivos cuando haya token
  useEffect(() => {
    if (accessToken) {
      loadAboutDrive();
      loadFolderFiles(currentFolder.id);
    } else {
      setAboutInfo(null);
      setFiles([]);
    }
  }, [accessToken, currentFolder.id, mimeFilter]);

  const showNotification = (type: 'success' | 'error' | 'info', text: string, duration = 5000) => {
    setStatusMessage({ type, text });
    if (duration > 0) {
      setTimeout(() => setStatusMessage(null), duration);
    }
  };

  const loadAboutDrive = async () => {
    try {
      const about = await GoogleDriveService.getAbout();
      setAboutInfo(about);
    } catch (err: any) {
      console.error('Error obteniendo información de Google Drive:', err);
    }
  };

  const loadFolderFiles = async (folderId: string, search = searchQuery) => {
    if (!accessToken) return;
    setIsLoadingFiles(true);
    try {
      const result = await GoogleDriveService.listFiles({
        folderId,
        search: search.trim() || undefined,
        mimeTypeFilter: mimeFilter,
      });
      setFiles(result);
    } catch (err: any) {
      showNotification('error', `Error al cargar archivos de Drive: ${err.message}`);
    } finally {
      setIsLoadingFiles(false);
    }
  };

  const handleSignIn = async () => {
    setIsSigningIn(true);
    try {
      const res = await googleSignIn();
      showNotification('success', `¡Bienvenido ${res.user.displayName || res.user.email}! Conexión con Google Drive establecida.`);
    } catch (err: any) {
      showNotification('error', `Error de inicio de sesión con Google: ${err.message}`);
    } finally {
      setIsSigningIn(false);
    }
  };

  const handleSignOut = async () => {
    try {
      await logout();
      showNotification('info', 'Has cerrado la sesión de Google Drive.');
    } catch (err: any) {
      showNotification('error', `Error al cerrar sesión: ${err.message}`);
    }
  };

  const handleEnterFolder = (folder: DriveFile) => {
    setFolderStack((prev) => [...prev, { id: folder.id, name: folder.name }]);
    setSearchQuery('');
  };

  const handleNavigateBreadcrumb = (index: number) => {
    setFolderStack((prev) => prev.slice(0, index + 1));
    setSearchQuery('');
  };

  const handleCreateFolder = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newFolderName.trim()) return;

    setIsCreatingFolder(true);
    try {
      const created = await GoogleDriveService.createFolder(newFolderName.trim(), currentFolder.id);
      setNewFolderModalOpen(false);
      setNewFolderName('');
      showNotification('success', `Carpeta "${created.name}" creada con éxito en Google Drive.`);
      loadFolderFiles(currentFolder.id);
    } catch (err: any) {
      showNotification('error', `Error creando carpeta: ${err.message}`);
    } finally {
      setIsCreatingFolder(false);
    }
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const fileList = e.target.files;
    if (!fileList || fileList.length === 0) return;

    const file = fileList[0];
    showNotification('info', `Subiendo "${file.name}" a Google Drive...`, 0);

    try {
      await GoogleDriveService.uploadFile({
        name: file.name,
        content: file,
        mimeType: file.type || 'application/octet-stream',
        parentFolderId: currentFolder.id,
      });

      showNotification('success', `El archivo "${file.name}" fue subido correctamente a Google Drive.`);
      loadFolderFiles(currentFolder.id);
      if (fileUploadInputRef.current) {
        fileUploadInputRef.current.value = '';
      }
    } catch (err: any) {
      showNotification('error', `Error subiendo archivo: ${err.message}`);
    }
  };

  /**
   * Respaldo completo de la base de datos a Google Drive
   */
  const handleBackupDatabaseToDrive = async () => {
    setIsCreatingBackup(true);
    try {
      const fullDatabase = await ErpApi.exportAllDatabase();
      const driveFile = await GoogleDriveService.backupDatabaseToDrive(
        fullDatabase,
        currentFolder.id === 'root' ? undefined : currentFolder.id
      );

      showNotification(
        'success',
        `¡Copia de seguridad guardada en Google Drive! Archivo: "${driveFile.name}". Todas las 10 tablas del ERP quedaron respaldadas en la nube.`
      );
      loadFolderFiles(currentFolder.id);
    } catch (err: any) {
      showNotification('error', `Error al crear respaldo en Drive: ${err.message}`);
    } finally {
      setIsCreatingBackup(false);
    }
  };

  /**
   * Restaurar respaldo de base de datos desde Google Drive
   */
  const handleConfirmRestoreBackup = async () => {
    if (!backupToRestore) return;

    setIsRestoringBackup(true);
    try {
      const content = await GoogleDriveService.downloadFileContent(backupToRestore.id);
      const parsedData = JSON.parse(content);
      const result = await ErpApi.importFullDatabase(parsedData);

      // Notificar a toda la app para actualizar conteos
      window.dispatchEvent(new Event('erp-database-updated'));

      setBackupToRestore(null);
      showNotification(
        'success',
        `¡Restauración exitosa! Se restablecieron los datos del ERP desde "${backupToRestore.name}". Tablas actualizadas: ${result.importedTables.join(', ')}.`
      );
    } catch (err: any) {
      showNotification('error', `Error al restaurar desde Google Drive: ${err.message}`);
    } finally {
      setIsRestoringBackup(false);
    }
  };

  /**
   * Eliminación con confirmación explícita obligatoria
   */
  const handleConfirmDelete = async () => {
    if (!fileToDelete) return;

    setIsDeletingFile(true);
    try {
      await GoogleDriveService.deleteFile(fileToDelete.id);
      showNotification('success', `El elemento "${fileToDelete.name}" fue eliminado de Google Drive.`);
      setFileToDelete(null);
      loadFolderFiles(currentFolder.id);
    } catch (err: any) {
      showNotification('error', `Error al eliminar de Google Drive: ${err.message}`);
    } finally {
      setIsDeletingFile(false);
    }
  };

  /**
   * Formateador de bytes
   */
  const formatBytes = (bytesStr?: string | number): string => {
    if (!bytesStr) return '-';
    const bytes = Number(bytesStr);
    if (isNaN(bytes) || bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
  };

  /**
   * Icono por tipo MIME
   */
  const getFileIcon = (file: DriveFile) => {
    if (file.mimeType === 'application/vnd.google-apps.folder') {
      return <Folder className="w-5 h-5 text-amber-500 fill-amber-500/20 shrink-0" />;
    }
    if (file.name.endsWith('.json') || file.mimeType.includes('json')) {
      return <FileCode className="w-5 h-5 text-emerald-600 shrink-0" />;
    }
    if (file.name.endsWith('.csv') || file.mimeType.includes('sheet') || file.mimeType.includes('spreadsheet')) {
      return <FileSpreadsheet className="w-5 h-5 text-teal-600 shrink-0" />;
    }
    if (file.mimeType.includes('pdf')) {
      return <FileText className="w-5 h-5 text-rose-600 shrink-0" />;
    }
    if (file.mimeType.startsWith('image/')) {
      return <ImageIcon className="w-5 h-5 text-blue-500 shrink-0" />;
    }
    return <File className="w-5 h-5 text-slate-500 shrink-0" />;
  };

  // Si está cargando el estado inicial
  if (isAuthLoading) {
    return (
      <div className="bg-white p-12 rounded-xl border border-slate-200 text-center space-y-3">
        <RefreshCw className="w-8 h-8 text-blue-600 animate-spin mx-auto" />
        <p className="text-sm font-semibold text-slate-700">Verificando estado de Google Drive...</p>
      </div>
    );
  }

  return (
    <div id="google-drive-module" className="space-y-6">
      {/* Banner Principal / Estado de Conexión */}
      <div className="bg-white p-6 rounded-xl border border-slate-200 shadow-xs flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center space-x-3.5">
          <div className="p-3 bg-blue-50 border border-blue-200 text-blue-700 rounded-xl">
            <Cloud className="w-7 h-7 text-blue-600" />
          </div>
          <div>
            <div className="flex items-center space-x-2">
              <h2 className="text-xl font-black text-slate-900 tracking-tight">
                Google Drive para ERP Gestión Operativa
              </h2>
              {accessToken ? (
                <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-emerald-100 text-emerald-800 border border-emerald-300">
                  <CloudCheck className="w-3.5 h-3.5 mr-1" />
                  Conectado a la Nube
                </span>
              ) : (
                <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-amber-100 text-amber-800 border border-amber-300">
                  <CloudOff className="w-3.5 h-3.5 mr-1" />
                  No autenticado
                </span>
              )}
            </div>
            <p className="text-xs text-slate-500 mt-0.5">
              Almacena copias de seguridad de la flota, manuales de taller y hojas de cálculo en tu cuenta personal de Google Drive.
            </p>
          </div>
        </div>

        {/* Acciones de Autenticación */}
        <div>
          {accessToken && currentUser ? (
            <div className="flex items-center space-x-3">
              <div className="text-right hidden sm:block">
                <p className="text-xs font-bold text-slate-800">{currentUser.displayName || 'Usuario Google'}</p>
                <p className="text-[11px] text-slate-500 font-mono">{currentUser.email}</p>
              </div>
              {currentUser.photoURL && (
                <img
                  src={currentUser.photoURL}
                  alt={currentUser.displayName || 'Avatar'}
                  className="w-9 h-9 rounded-full border border-slate-300 shadow-2xs"
                  referrerPolicy="no-referrer"
                />
              )}
              <button
                onClick={handleSignOut}
                className="inline-flex items-center px-3 py-1.5 text-xs font-semibold text-rose-700 bg-rose-50 border border-rose-200 hover:bg-rose-100 rounded-lg transition-colors"
                title="Cerrar sesión de Google Drive"
              >
                <LogOut className="w-3.5 h-3.5 mr-1.5" />
                Desconectar
              </button>
            </div>
          ) : (
            <GoogleSignInButton
              onClick={handleSignIn}
              isLoading={isSigningIn}
              text="Conectar con Google Drive"
            />
          )}
        </div>
      </div>

      {/* Notificación de Estado */}
      {statusMessage && (
        <div
          className={`p-4 rounded-xl border flex items-center justify-between text-xs shadow-xs animate-in fade-in ${
            statusMessage.type === 'success'
              ? 'bg-emerald-50 border-emerald-300 text-emerald-900'
              : statusMessage.type === 'error'
              ? 'bg-rose-50 border-rose-300 text-rose-900'
              : 'bg-blue-50 border-blue-300 text-blue-900'
          }`}
        >
          <div className="flex items-center space-x-2.5">
            {statusMessage.type === 'success' && <CheckCircle2 className="w-5 h-5 text-emerald-600 shrink-0" />}
            {statusMessage.type === 'error' && <AlertCircle className="w-5 h-5 text-rose-600 shrink-0" />}
            {statusMessage.type === 'info' && <RefreshCw className="w-5 h-5 text-blue-600 animate-spin shrink-0" />}
            <span className="font-semibold">{statusMessage.text}</span>
          </div>
          <button
            onClick={() => setStatusMessage(null)}
            className="text-slate-400 hover:text-slate-600 font-bold text-base px-1"
          >
            ×
          </button>
        </div>
      )}

      {/* Pantalla si NO está conectado */}
      {!accessToken ? (
        <div className="bg-white p-10 rounded-xl border border-slate-200 shadow-xs text-center max-w-2xl mx-auto space-y-6">
          <div className="w-16 h-16 bg-blue-50 text-blue-600 border border-blue-200 rounded-2xl flex items-center justify-center mx-auto shadow-xs">
            <CloudUpload className="w-8 h-8" />
          </div>

          <div className="space-y-2">
            <h3 className="text-xl font-bold text-slate-900">
              Conecta tu Cuenta de Google Drive
            </h3>
            <p className="text-xs text-slate-600 leading-relaxed max-w-lg mx-auto">
              Para guardar respaldos automáticos de tus maquinarias, partes diarios y pedidos de materiales en la nube, y para sincronizar fichas técnicas y manuales de taller, autoriza el acceso a tu Google Drive.
            </p>
          </div>

          <div className="bg-slate-50 p-4 rounded-xl border border-slate-200 text-left space-y-2 text-xs text-slate-600 max-w-md mx-auto">
            <div className="font-bold text-slate-800 text-[11px] uppercase tracking-wider mb-1">
              ¿Qué podrás hacer con esta integración?
            </div>
            <div className="flex items-start space-x-2">
              <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
              <span>Crear copias de seguridad de toda la base de datos con un clic.</span>
            </div>
            <div className="flex items-start space-x-2">
              <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
              <span>Restaurar datos anteriores directamente desde archivos .JSON en Drive.</span>
            </div>
            <div className="flex items-start space-x-2">
              <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
              <span>Subir y organizar documentación de equipos, seguros y remitos.</span>
            </div>
          </div>

          <div>
            <GoogleSignInButton
              onClick={handleSignIn}
              isLoading={isSigningIn}
              size="lg"
              text="Iniciar Sesión y Autorizar Google Drive"
            />
          </div>
        </div>
      ) : (
        /* Pantalla PRINCIPAL cuando SI está conectado */
        <div className="space-y-6">
          {/* Tarjetas de Resumen y Acciones Rápidas */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {/* 1. Respaldo Inmediato a Google Drive */}
            <div className="bg-gradient-to-br from-blue-900 to-slate-900 text-white p-5 rounded-xl border border-blue-800 shadow-xs flex flex-col justify-between">
              <div>
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold uppercase tracking-wider text-blue-300 flex items-center gap-1.5">
                    <Database className="w-4 h-4 text-emerald-400" />
                    Copia de Seguridad en la Nube
                  </span>
                  <span className="text-[10px] px-2 py-0.5 bg-blue-800 text-blue-200 rounded font-semibold">
                    10 Tablas
                  </span>
                </div>
                <h4 className="text-base font-black mt-2">Respaldar ERP en Google Drive</h4>
                <p className="text-xs text-slate-300 mt-1 leading-relaxed">
                  Exporta toda la flota, lecturas de horómetro, partes diarios y tesorería en un archivo JSON seguro en tu Drive.
                </p>
              </div>

              <div className="mt-4 pt-3 border-t border-slate-800">
                <button
                  onClick={handleBackupDatabaseToDrive}
                  disabled={isCreatingBackup}
                  className="w-full py-2 px-3 bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs rounded-lg shadow-2xs transition-colors flex items-center justify-center space-x-2 disabled:opacity-60"
                >
                  {isCreatingBackup ? (
                    <>
                      <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                      <span>Generando y Subiendo...</span>
                    </>
                  ) : (
                    <>
                      <CloudUpload className="w-4 h-4" />
                      <span>Crear Respaldo Ahora</span>
                    </>
                  )}
                </button>
              </div>
            </div>

            {/* 2. Estado de Almacenamiento en Google Drive */}
            <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-xs flex flex-col justify-between">
              <div>
                <span className="text-xs font-bold uppercase tracking-wider text-slate-500 flex items-center gap-1.5">
                  <HardDrive className="w-4 h-4 text-blue-600" />
                  Almacenamiento de Google Drive
                </span>
                <div className="mt-3">
                  <div className="text-xl font-black text-slate-900 font-mono">
                    {formatBytes(aboutInfo?.storageQuota?.usageInDrive || aboutInfo?.storageQuota?.usage)}
                  </div>
                  <div className="text-[11px] text-slate-500 mt-0.5">
                    de {formatBytes(aboutInfo?.storageQuota?.limit)} en tu cuenta Google
                  </div>
                </div>
              </div>

              <div className="mt-4 pt-3 border-t border-slate-100">
                <button
                  onClick={() => {
                    const driveUrl = 'https://drive.google.com';
                    window.open(driveUrl, '_blank');
                  }}
                  className="w-full py-2 px-3 bg-slate-100 hover:bg-slate-200 text-slate-700 font-semibold text-xs rounded-lg transition-colors flex items-center justify-center space-x-1.5"
                >
                  <ExternalLink className="w-3.5 h-3.5 text-blue-600" />
                  <span>Abrir Google Drive en Nueva Pestaña</span>
                </button>
              </div>
            </div>

            {/* 3. Organización para Flota de Maquinarias */}
            <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-xs flex flex-col justify-between">
              <div>
                <span className="text-xs font-bold uppercase tracking-wider text-slate-500 flex items-center gap-1.5">
                  <Truck className="w-4 h-4 text-emerald-600" />
                  Documentación de Maquinarias
                </span>
                <h4 className="text-sm font-bold text-slate-800 mt-2">
                  Carpetas para Equipos y Obras
                </h4>
                <p className="text-xs text-slate-500 mt-1 leading-relaxed">
                  Crea carpetas dedicadas para cada máquina pesada para guardar manuales de taller, pólizas de seguro y partes de revisión técnica.
                </p>
              </div>

              <div className="mt-4 pt-3 border-t border-slate-100 flex space-x-2">
                <button
                  onClick={() => {
                    setNewFolderName('Manuales_y_Polizas_Maquinarias');
                    setNewFolderModalOpen(true);
                  }}
                  className="flex-1 py-2 px-3 bg-blue-50 hover:bg-blue-100 text-blue-800 border border-blue-200 font-semibold text-xs rounded-lg transition-colors flex items-center justify-center space-x-1.5"
                >
                  <FolderPlus className="w-3.5 h-3.5 text-blue-600" />
                  <span>Nueva Carpeta</span>
                </button>
              </div>
            </div>
          </div>

          {/* Explorador de Archivos de Google Drive */}
          <div className="bg-white rounded-xl border border-slate-200 shadow-xs overflow-hidden">
            {/* Barra de Herramientas del Explorador */}
            <div className="p-4 border-b border-slate-200 flex flex-wrap items-center justify-between gap-3 bg-slate-50/70">
              {/* Migas de Pan (Breadcrumbs) */}
              <div className="flex items-center space-x-1.5 text-xs font-semibold text-slate-700 overflow-x-auto py-1">
                {folderStack.map((item, idx) => {
                  const isLast = idx === folderStack.length - 1;
                  return (
                    <React.Fragment key={item.id}>
                      {idx > 0 && <span className="text-slate-400 font-normal">/</span>}
                      <button
                        onClick={() => handleNavigateBreadcrumb(idx)}
                        className={`px-2 py-1 rounded transition-colors flex items-center gap-1 shrink-0 ${
                          isLast
                            ? 'bg-blue-100 text-blue-800 font-bold'
                            : 'text-slate-600 hover:bg-slate-200/70 hover:text-slate-900'
                        }`}
                      >
                        {idx === 0 && <HardDrive className="w-3.5 h-3.5" />}
                        {idx > 0 && <Folder className="w-3.5 h-3.5 text-amber-500" />}
                        <span>{item.name}</span>
                      </button>
                    </React.Fragment>
                  );
                })}
              </div>

              {/* Botones de Acción (Subir, Crear Carpeta, Refrescar) */}
              <div className="flex items-center space-x-2">
                <input
                  type="file"
                  ref={fileUploadInputRef}
                  onChange={handleFileUpload}
                  className="hidden"
                />

                <button
                  onClick={() => fileUploadInputRef.current?.click()}
                  className="inline-flex items-center px-3 py-1.5 text-xs font-semibold text-blue-700 bg-blue-50 border border-blue-200 hover:bg-blue-100 rounded-lg shadow-2xs transition-colors"
                >
                  <CloudUpload className="w-3.5 h-3.5 mr-1.5 text-blue-600" />
                  Subir Archivo
                </button>

                <button
                  onClick={() => {
                    setNewFolderName('');
                    setNewFolderModalOpen(true);
                  }}
                  className="inline-flex items-center px-3 py-1.5 text-xs font-semibold text-slate-700 bg-white border border-slate-300 hover:bg-slate-50 rounded-lg shadow-2xs transition-colors"
                >
                  <FolderPlus className="w-3.5 h-3.5 mr-1.5 text-amber-600" />
                  Nueva Carpeta
                </button>

                <button
                  onClick={() => loadFolderFiles(currentFolder.id)}
                  disabled={isLoadingFiles}
                  className="p-1.5 text-slate-600 hover:text-slate-900 hover:bg-slate-200/70 rounded-lg transition-colors disabled:opacity-50"
                  title="Actualizar lista de archivos"
                >
                  <RefreshCw className={`w-4 h-4 ${isLoadingFiles ? 'animate-spin text-blue-600' : ''}`} />
                </button>
              </div>
            </div>

            {/* Barra de Filtros y Búsqueda */}
            <div className="p-3 border-b border-slate-200 flex flex-wrap items-center justify-between gap-3 bg-white">
              {/* Filtros rápidos */}
              <div className="flex items-center space-x-1 text-xs">
                <span className="text-[11px] font-bold uppercase tracking-wider text-slate-400 mr-2">
                  Filtro:
                </span>
                <button
                  onClick={() => setMimeFilter('all')}
                  className={`px-2.5 py-1 rounded-md text-xs font-medium transition-colors ${
                    mimeFilter === 'all'
                      ? 'bg-slate-900 text-white'
                      : 'text-slate-600 hover:bg-slate-100'
                  }`}
                >
                  Todos
                </button>
                <button
                  onClick={() => setMimeFilter('backups')}
                  className={`px-2.5 py-1 rounded-md text-xs font-medium transition-colors flex items-center gap-1 ${
                    mimeFilter === 'backups'
                      ? 'bg-emerald-600 text-white'
                      : 'text-slate-600 hover:bg-slate-100'
                  }`}
                >
                  <Database className="w-3 h-3" />
                  Respaldos ERP (.json)
                </button>
                <button
                  onClick={() => setMimeFilter('folders')}
                  className={`px-2.5 py-1 rounded-md text-xs font-medium transition-colors flex items-center gap-1 ${
                    mimeFilter === 'folders'
                      ? 'bg-amber-600 text-white'
                      : 'text-slate-600 hover:bg-slate-100'
                  }`}
                >
                  <Folder className="w-3 h-3" />
                  Solo Carpetas
                </button>
                <button
                  onClick={() => setMimeFilter('documents')}
                  className={`px-2.5 py-1 rounded-md text-xs font-medium transition-colors flex items-center gap-1 ${
                    mimeFilter === 'documents'
                      ? 'bg-blue-600 text-white'
                      : 'text-slate-600 hover:bg-slate-100'
                  }`}
                >
                  <FileText className="w-3 h-3" />
                  Docs y Planillas
                </button>
                <button
                  onClick={() => setMimeFilter('images')}
                  className={`px-2.5 py-1 rounded-md text-xs font-medium transition-colors flex items-center gap-1 ${
                    mimeFilter === 'images'
                      ? 'bg-indigo-600 text-white'
                      : 'text-slate-600 hover:bg-slate-100'
                  }`}
                >
                  <ImageIcon className="w-3 h-3" />
                  Fotos
                </button>
              </div>

              {/* Búsqueda en Drive */}
              <div className="relative w-64">
                <Search className="w-3.5 h-3.5 absolute left-3 top-2.5 text-slate-400" />
                <input
                  type="text"
                  placeholder="Buscar en Google Drive..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      loadFolderFiles(currentFolder.id, searchQuery);
                    }
                  }}
                  className="w-full pl-8 pr-3 py-1.5 bg-slate-50 border border-slate-300 rounded-lg text-xs focus:ring-blue-500 focus:border-blue-500"
                />
              </div>
            </div>

            {/* Tabla de Archivos */}
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs border-collapse">
                <thead>
                  <tr className="bg-slate-50 border-b border-slate-200 text-slate-500 uppercase tracking-wider text-[10px] font-bold">
                    <th className="p-3">Nombre del Archivo / Carpeta</th>
                    <th className="p-3">Tipo / Clasificación</th>
                    <th className="p-3">Tamaño</th>
                    <th className="p-3">Última Modificación</th>
                    <th className="p-3 text-right">Acciones</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {isLoadingFiles ? (
                    <tr>
                      <td colSpan={5} className="p-8 text-center text-slate-500">
                        <RefreshCw className="w-6 h-6 animate-spin text-blue-600 mx-auto mb-2" />
                        <span>Cargando archivos de Google Drive...</span>
                      </td>
                    </tr>
                  ) : files.length === 0 ? (
                    <tr>
                      <td colSpan={5} className="p-8 text-center text-slate-400">
                        <Folder className="w-10 h-10 text-slate-300 mx-auto mb-2" />
                        <p className="font-semibold text-slate-600">No hay archivos en esta carpeta.</p>
                        <p className="text-[11px] text-slate-400 mt-0.5">
                          Usa el botón "Subir Archivo" o "Crear Respaldo Ahora" para almacenar datos aquí.
                        </p>
                      </td>
                    </tr>
                  ) : (
                    files.map((file) => {
                      const isFolder = file.mimeType === 'application/vnd.google-apps.folder';
                      const isJsonBackup =
                        file.name.endsWith('.json') ||
                        file.name.includes('Backup') ||
                        file.name.includes('ERP');

                      return (
                        <tr
                          key={file.id}
                          className="hover:bg-blue-50/40 transition-colors group"
                        >
                          <td className="p-3 font-medium text-slate-900">
                            <div className="flex items-center space-x-2.5">
                              {getFileIcon(file)}
                              {isFolder ? (
                                <button
                                  onClick={() => handleEnterFolder(file)}
                                  className="text-blue-700 hover:text-blue-900 hover:underline font-bold text-left truncate max-w-md"
                                >
                                  {file.name}
                                </button>
                              ) : (
                                <span className="truncate max-w-md" title={file.name}>
                                  {file.name}
                                </span>
                              )}
                            </div>
                          </td>

                          <td className="p-3 text-slate-500 text-[11px]">
                            {isFolder ? (
                              <span className="font-bold text-amber-700">Carpeta</span>
                            ) : isJsonBackup ? (
                              <span className="px-1.5 py-0.5 bg-emerald-100 text-emerald-800 rounded font-bold">
                                Respaldo ERP
                              </span>
                            ) : file.mimeType.split('/').pop()?.toUpperCase() || 'ARCHIVO'}
                          </td>

                          <td className="p-3 font-mono text-[11px] text-slate-600">
                            {isFolder ? '-' : formatBytes(file.size)}
                          </td>

                          <td className="p-3 text-slate-500 text-[11px]">
                            {file.modifiedTime
                              ? new Date(file.modifiedTime).toLocaleString()
                              : '-'}
                          </td>

                          <td className="p-3 text-right">
                            <div className="flex items-center justify-end space-x-1.5">
                              {/* Si es un respaldo JSON del ERP, botón para restaurar con 1 clic */}
                              {isJsonBackup && (
                                <button
                                  onClick={() => setBackupToRestore(file)}
                                  className="px-2 py-1 text-[11px] font-bold text-emerald-700 bg-emerald-50 hover:bg-emerald-100 border border-emerald-300 rounded transition-colors flex items-center gap-1 shadow-2xs"
                                  title="Restaurar toda la base de datos desde este respaldo de Drive"
                                >
                                  <Database className="w-3 h-3" />
                                  <span>Restaurar ERP</span>
                                </button>
                              )}

                              {/* Abrir en Google Drive */}
                              {file.webViewLink && (
                                <a
                                  href={file.webViewLink}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="p-1.5 text-slate-500 hover:text-blue-600 hover:bg-blue-50 rounded transition-colors"
                                  title="Abrir en Google Drive"
                                >
                                  <ExternalLink className="w-4 h-4" />
                                </a>
                              )}

                              {/* Eliminar (con diálogo obligatorio de confirmación) */}
                              <button
                                onClick={() => setFileToDelete(file)}
                                className="p-1.5 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded transition-colors"
                                title="Eliminar de Google Drive (Requiere confirmación)"
                              >
                                <Trash2 className="w-4 h-4" />
                              </button>
                            </div>
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* MODAL PARA CREAR NUEVA CARPETA */}
      {newFolderModalOpen && (
        <div className="fixed inset-0 z-50 bg-slate-900/50 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-xl max-w-md w-full p-6 shadow-xl border border-slate-200 space-y-4">
            <div className="flex items-center space-x-3">
              <div className="p-2.5 bg-amber-100 text-amber-800 rounded-lg">
                <FolderPlus className="w-5 h-5" />
              </div>
              <div>
                <h3 className="text-base font-bold text-slate-900">Crear Carpeta en Google Drive</h3>
                <p className="text-xs text-slate-500">Ubicación: {currentFolder.name}</p>
              </div>
            </div>

            <form onSubmit={handleCreateFolder} className="space-y-4">
              <div>
                <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1">
                  Nombre de la Carpeta:
                </label>
                <input
                  type="text"
                  required
                  autoFocus
                  placeholder="Ej: CAT-416_Fichas_Tecnicas"
                  value={newFolderName}
                  onChange={(e) => setNewFolderName(e.target.value)}
                  className="w-full p-2.5 bg-slate-50 border border-slate-300 rounded-lg text-xs font-semibold focus:ring-blue-500 focus:border-blue-500"
                />
              </div>

              <div className="flex justify-end space-x-2 pt-2">
                <button
                  type="button"
                  onClick={() => setNewFolderModalOpen(false)}
                  className="px-3.5 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-100 rounded-lg transition-colors"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={isCreatingFolder || !newFolderName.trim()}
                  className="px-4 py-2 text-xs font-bold text-white bg-blue-600 hover:bg-blue-700 rounded-lg transition-colors shadow-2xs disabled:opacity-50"
                >
                  {isCreatingFolder ? 'Creando...' : 'Crear Carpeta'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* DIÁLOGO DE CONFIRMACIÓN OBLIGATORIO PARA ELIMINAR ARCHIVO (Workspace Safety Requirement) */}
      {fileToDelete && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-xl max-w-md w-full p-6 shadow-2xl border border-rose-200 space-y-4 animate-in fade-in">
            <div className="flex items-center space-x-3">
              <div className="p-3 bg-rose-100 text-rose-700 rounded-xl">
                <AlertTriangle className="w-6 h-6" />
              </div>
              <div>
                <h3 className="text-base font-bold text-slate-900">
                  ¿Confirmar eliminación en Google Drive?
                </h3>
                <p className="text-xs text-rose-600 font-medium">Operación destructiva</p>
              </div>
            </div>

            <div className="p-3.5 bg-slate-50 border border-slate-200 rounded-lg text-xs text-slate-700 space-y-1">
              <p>
                Estás a punto de eliminar permanentemente de tu Google Drive el siguiente elemento:
              </p>
              <p className="font-bold text-slate-900 font-mono break-all pt-1">
                {fileToDelete.name}
              </p>
              <p className="text-[11px] text-slate-500 pt-1">
                Tipo: {fileToDelete.mimeType}
              </p>
            </div>

            <div className="flex justify-end space-x-2 pt-2">
              <button
                type="button"
                disabled={isDeletingFile}
                onClick={() => setFileToDelete(null)}
                className="px-4 py-2 text-xs font-semibold text-slate-700 bg-white border border-slate-300 hover:bg-slate-50 rounded-lg transition-colors"
              >
                Cancelar
              </button>
              <button
                type="button"
                disabled={isDeletingFile}
                onClick={handleConfirmDelete}
                className="px-4 py-2 text-xs font-bold text-white bg-rose-600 hover:bg-rose-700 rounded-lg shadow-2xs transition-colors flex items-center space-x-1.5 disabled:opacity-50"
              >
                {isDeletingFile ? (
                  <>
                    <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                    <span>Eliminando...</span>
                  </>
                ) : (
                  <>
                    <Trash2 className="w-3.5 h-3.5" />
                    <span>Eliminar Definitivamente</span>
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* DIÁLOGO DE CONFIRMACIÓN PARA RESTAURAR BASE DE DATOS DESDE DRIVE */}
      {backupToRestore && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-xl max-w-md w-full p-6 shadow-2xl border border-emerald-200 space-y-4 animate-in fade-in">
            <div className="flex items-center space-x-3">
              <div className="p-3 bg-emerald-100 text-emerald-700 rounded-xl">
                <Database className="w-6 h-6" />
              </div>
              <div>
                <h3 className="text-base font-bold text-slate-900">
                  Restaurar Base de Datos desde Google Drive
                </h3>
                <p className="text-xs text-slate-500">Sincronización del sistema</p>
              </div>
            </div>

            <div className="p-3.5 bg-emerald-50/50 border border-emerald-200 rounded-lg text-xs text-slate-700 space-y-1">
              <p>
                Se descargarán e importarán todos los registros contenidos en el respaldo de Drive:
              </p>
              <p className="font-bold text-slate-900 font-mono break-all pt-1">
                {backupToRestore.name}
              </p>
              <p className="text-[11px] text-slate-500 pt-1">
                Este proceso actualizará las 10 tablas del ERP con los datos del archivo.
              </p>
            </div>

            <div className="flex justify-end space-x-2 pt-2">
              <button
                type="button"
                disabled={isRestoringBackup}
                onClick={() => setBackupToRestore(null)}
                className="px-4 py-2 text-xs font-semibold text-slate-700 bg-white border border-slate-300 hover:bg-slate-50 rounded-lg transition-colors"
              >
                Cancelar
              </button>
              <button
                type="button"
                disabled={isRestoringBackup}
                onClick={handleConfirmRestoreBackup}
                className="px-4 py-2 text-xs font-bold text-white bg-emerald-600 hover:bg-emerald-700 rounded-lg shadow-2xs transition-colors flex items-center space-x-1.5 disabled:opacity-50"
              >
                {isRestoringBackup ? (
                  <>
                    <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                    <span>Restaurando...</span>
                  </>
                ) : (
                  <>
                    <Database className="w-3.5 h-3.5" />
                    <span>Confirmar y Restaurar</span>
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
