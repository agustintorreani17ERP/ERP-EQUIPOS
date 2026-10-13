/**
 * @file services/googleDrive.ts
 * @description Cliente API de Google Drive v3 para gestión de archivos, carpetas,
 * respaldos de bases de datos del ERP y documentación de maquinaria.
 */

import { getAccessToken } from './googleAuth';

export interface DriveFile {
  id: string;
  name: string;
  mimeType: string;
  size?: string;
  modifiedTime?: string;
  webViewLink?: string;
  webContentLink?: string;
  iconLink?: string;
  thumbnailLink?: string;
  parents?: string[];
  trashed?: boolean;
}

export interface DriveStorageQuota {
  limit?: string;
  usage?: string;
  usageInDrive?: string;
}

export interface DriveAboutInfo {
  user?: {
    displayName: string;
    emailAddress: string;
    photoLink?: string;
  };
  storageQuota?: DriveStorageQuota;
}

const DRIVE_API_BASE = 'https://www.googleapis.com/drive/v3';
const DRIVE_UPLOAD_BASE = 'https://www.googleapis.com/upload/drive/v3';

/**
 * Realiza una llamada autenticada a la API de Google Drive
 */
async function driveFetch(endpoint: string, options: RequestInit = {}): Promise<Response> {
  const token = await getAccessToken();
  if (!token) {
    throw new Error('No se encontró una sesión activa de Google Drive. Por favor inicie sesión con su cuenta de Google.');
  }

  const headers = new Headers(options.headers || {});
  headers.set('Authorization', `Bearer ${token}`);

  const response = await fetch(endpoint, {
    ...options,
    headers,
  });

  if (!response.ok) {
    let errorDetail = `Error HTTP ${response.status}: ${response.statusText}`;
    try {
      const errJson = await response.json();
      if (errJson.error?.message) {
        errorDetail = errJson.error.message;
      }
    } catch {
      // Ignorar fallback
    }
    throw new Error(errorDetail);
  }

  return response;
}

export const GoogleDriveService = {
  /**
   * Obtiene la información del usuario y cuota de almacenamiento de Google Drive
   */
  async getAbout(): Promise<DriveAboutInfo> {
    const res = await driveFetch(`${DRIVE_API_BASE}/about?fields=user,storageQuota`);
    return await res.json();
  },

  /**
   * Lista archivos y carpetas en Google Drive
   */
  async listFiles(options: {
    folderId?: string;
    search?: string;
    mimeTypeFilter?: 'all' | 'folders' | 'backups' | 'documents' | 'images';
    pageSize?: number;
  } = {}): Promise<DriveFile[]> {
    const { folderId, search, mimeTypeFilter = 'all', pageSize = 50 } = options;

    const queryParts: string[] = ['trashed = false'];

    if (folderId && folderId !== 'root') {
      queryParts.push(`'${folderId}' in parents`);
    } else if (folderId === 'root') {
      queryParts.push(`'root' in parents`);
    }

    if (search && search.trim()) {
      const sanitized = search.replace(/'/g, "\\'");
      queryParts.push(`name contains '${sanitized}'`);
    }

    if (mimeTypeFilter === 'folders') {
      queryParts.push("mimeType = 'application/vnd.google-apps.folder'");
    } else if (mimeTypeFilter === 'backups') {
      queryParts.push("(name contains '.json' or name contains '.csv' or name contains '.txt' or name contains 'ERP')");
    } else if (mimeTypeFilter === 'documents') {
      queryParts.push("(mimeType contains 'pdf' or mimeType contains 'document' or mimeType contains 'sheet' or mimeType contains 'text')");
    } else if (mimeTypeFilter === 'images') {
      queryParts.push("mimeType contains 'image/'");
    }

    const q = encodeURIComponent(queryParts.join(' and '));
    const fields = encodeURIComponent('files(id, name, mimeType, size, modifiedTime, webViewLink, webContentLink, iconLink, thumbnailLink, parents, trashed)');
    const orderBy = encodeURIComponent('folder,modifiedTime desc');

    const res = await driveFetch(
      `${DRIVE_API_BASE}/files?q=${q}&fields=${fields}&orderBy=${orderBy}&pageSize=${pageSize}&spaces=drive`
    );

    const data = await res.json();
    return data.files || [];
  },

  /**
   * Crea una nueva carpeta en Google Drive
   */
  async createFolder(name: string, parentFolderId?: string): Promise<DriveFile> {
    const metadata: { name: string; mimeType: string; parents?: string[] } = {
      name,
      mimeType: 'application/vnd.google-apps.folder',
    };

    if (parentFolderId && parentFolderId !== 'root') {
      metadata.parents = [parentFolderId];
    }

    const res = await driveFetch(`${DRIVE_API_BASE}/files`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(metadata),
    });

    return await res.json();
  },

  /**
   * Localiza o crea la carpeta raíz "ERP_Gestion_Operativa" para mantener los respaldos organizados
   */
  async getOrCreateErpRootFolder(): Promise<DriveFile> {
    const existing = await this.listFiles({
      search: 'ERP_Gestion_Operativa',
      mimeTypeFilter: 'folders',
    });

    const folder = existing.find((f) => f.name === 'ERP_Gestion_Operativa' && f.mimeType === 'application/vnd.google-apps.folder');
    if (folder) {
      return folder;
    }

    return await this.createFolder('ERP_Gestion_Operativa');
  },

  /**
   * Sube un archivo a Google Drive utilizando multipart upload
   */
  async uploadFile(options: {
    name: string;
    content: Blob | string;
    mimeType: string;
    parentFolderId?: string;
    description?: string;
  }): Promise<DriveFile> {
    const { name, content, mimeType, parentFolderId, description } = options;

    const metadata: any = {
      name,
      mimeType,
    };
    if (description) metadata.description = description;
    if (parentFolderId && parentFolderId !== 'root') {
      metadata.parents = [parentFolderId];
    }

    const boundary = '-------314159265358979323846';
    const delimiter = `\r\n--${boundary}\r\n`;
    const closeDelimiter = `\r\n--${boundary}--`;

    let bodyBlob: Blob;

    if (typeof content === 'string') {
      const multipartRequestBody =
        delimiter +
        'Content-Type: application/json; charset=UTF-8\r\n\r\n' +
        JSON.stringify(metadata) +
        delimiter +
        `Content-Type: ${mimeType}\r\n\r\n` +
        content +
        closeDelimiter;

      bodyBlob = new Blob([multipartRequestBody], { type: `multipart/related; boundary=${boundary}` });
    } else {
      const metadataBlob = new Blob(
        [
          delimiter +
            'Content-Type: application/json; charset=UTF-8\r\n\r\n' +
            JSON.stringify(metadata) +
            delimiter +
            `Content-Type: ${mimeType}\r\n\r\n`,
        ],
        { type: 'text/plain' }
      );
      const closeBlob = new Blob([closeDelimiter], { type: 'text/plain' });
      bodyBlob = new Blob([metadataBlob, content, closeBlob], { type: `multipart/related; boundary=${boundary}` });
    }

    const res = await driveFetch(`${DRIVE_UPLOAD_BASE}/files?uploadType=multipart`, {
      method: 'POST',
      headers: {
        'Content-Type': `multipart/related; boundary=${boundary}`,
      },
      body: bodyBlob,
    });

    return await res.json();
  },

  /**
   * Descarga el contenido de un archivo de texto o JSON desde Google Drive
   */
  async downloadFileContent(fileId: string): Promise<string> {
    const res = await driveFetch(`${DRIVE_API_BASE}/files/${fileId}?alt=media`);
    return await res.text();
  },

  /**
   * Elimina un archivo o carpeta en Google Drive.
   * NOTA: El componente que llama a esta función DEBE solicitar confirmación explícita al usuario
   * tal como lo exige la normativa de seguridad de Google Workspace.
   */
  async deleteFile(fileId: string): Promise<void> {
    await driveFetch(`${DRIVE_API_BASE}/files/${fileId}`, {
      method: 'DELETE',
    });
  },

  /**
   * Guarda un backup completo de la base de datos del ERP directamente en Google Drive
   */
  async backupDatabaseToDrive(backupData: any, folderId?: string): Promise<DriveFile> {
    const dateStr = new Date().toISOString().replace(/:/g, '-').replace(/\..+/, '');
    const fileName = `ERP_Backup_Access_${dateStr}.json`;
    const jsonString = JSON.stringify(backupData, null, 2);

    let targetFolderId = folderId;
    if (!targetFolderId) {
      const erpFolder = await this.getOrCreateErpRootFolder();
      targetFolderId = erpFolder.id;
    }

    return await this.uploadFile({
      name: fileName,
      content: jsonString,
      mimeType: 'application/json',
      parentFolderId: targetFolderId,
      description: `Copia de seguridad del ERP de Gestión Operativa creada el ${new Date().toLocaleString()}`,
    });
  },
};
