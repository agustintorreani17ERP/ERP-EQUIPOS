/**
 * @file server/module/manifest.ts
 * @description Contrato del módulo Taller para CTRL+: qué secciones de menú expone,
 * qué permisos existen y qué eventos publica o consume. CTRL+ lo lee para registrar el
 * módulo sin conocer su interior.
 */

export const MODULE_CODE = 'taller';
export const MODULE_VERSION = '0.1.0';

export interface MenuEntry {
  id: string;
  label: string;
  /** Ruta dentro de la app web de Taller. */
  path: string;
}

export interface ModuleManifest {
  code: typeof MODULE_CODE;
  name: string;
  version: string;
  menu: MenuEntry[];
  permissions: string[];
  publishes: string[];
  consumes: string[];
}

export const moduleManifest: ModuleManifest = {
  code: MODULE_CODE,
  name: 'Taller',
  version: MODULE_VERSION,
  menu: [
    { id: 'panel', label: 'Panel', path: '/panel' },
    { id: 'flota', label: 'Flota', path: '/flota' },
    { id: 'partes', label: 'Partes y horas', path: '/partes' },
    { id: 'mantenimiento', label: 'Mantenimiento', path: '/mantenimiento' },
    { id: 'combustibles', label: 'Combustibles y lubricantes', path: '/combustibles' },
    { id: 'abastecimiento', label: 'Abastecimiento', path: '/abastecimiento' },
    { id: 'fondos', label: 'Fondos', path: '/fondos' },
    { id: 'informes', label: 'Informes', path: '/informes' },
    { id: 'configuracion', label: 'Configuración', path: '/configuracion' },
  ],
  permissions: ['flota.leer', 'flota.editar', 'partes.cargar', 'mantenimiento.gestionar', 'abastecimiento.gestionar', 'fondos.solicitar', 'configuracion.administrar'],
  publishes: ['taller.parte_equipo.registrado', 'taller.gasto_caja_chica.registrado', 'taller.solicitud_fondos.creada'],
  consumes: ['erp.solicitud_fondos.estado_cambiado', 'erp.obra.actualizada'],
};
