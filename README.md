# ERP Gestión Operativa

Migración web moderna de sistema ERP operativo legacy (originalmente desarrollado en Microsoft Access VBA) a **React 19**, **TypeScript** y **Tailwind CSS**.

## Módulos del Sistema

- **Panel General (Dashboard)**: Métricas consolidadas de flota, mantenimiento, pedidos y fondos.
- **Flota y Maquinarias (`Form_AMAQUINAS` / `Form_A`)**: Control de equipos, ficha técnica, registro de horómetros y cálculo de horas trabajadas (`DifK`).
- **Servicios de Mantenimiento (`Form_CAT 416` / `Form_FREZADORA 1000/2000 HS`)**: Protocolos de mantenimiento preventivo, checklist técnico y control de edición (`allowedit`).
- **Pedidos de Materiales (`Form_AGREGAR PEDIDO` / `Form_EDITAR PEDIDO`)**: Gestión de órdenes de compra, renglones de insumos con cálculo en tiempo real y stock.
- **Partes Diarios y Envíos (`Form_PARTE DIARIO` / `Form_ENVIO`)**: Partes operativos por chofer y remitos de entrega de materiales a obra.
- **Tesorería y Solicitudes (`Form_SFONDOS` / `Form_CAJA CHICA`)**: Solicitudes de fondos, rendición de caja chica y cuentas corrientes de proveedores.
- **Centro de Informes (`DoCmd.OpenReport`)**: Plantillas imprimibles y exportables en formato oficial A4.
- **Auditoría de Migración**: Comparativa técnica de rutinas VBA frente a su implementación en TypeScript.

## Requisitos Previos

- Node.js 18+ o superior
- npm / yarn / pnpm

## Instalación y Ejecución Local

1. Clonar el repositorio:
   ```bash
   git clone https://github.com/TU-USUARIO/TU-REPOSITORIO.git
   cd TU-REPOSITORIO
   ```

2. Instalar dependencias:
   ```bash
   npm install
   ```

3. Iniciar el servidor de desarrollo:
   ```bash
   npm run dev
   ```

4. Abrir en el navegador en `http://localhost:3000` (o el puerto indicado en la terminal).

## Compilación para Producción

```bash
npm run build
```
Los archivos optimizados se generarán en la carpeta `dist/`.
