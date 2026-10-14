/**
 * @file components/Migration/MigrationGuide.tsx
 * @description Panel técnico de análisis de migración arquitectónica:
 * Comparativa directa del código VBA original vs. React/TypeScript limpio.
 */

import React, { useState } from 'react';
import {
  ArrowRight,
  Code2,
  FileCode,
  FolderTree,
  Layers,
  ShieldCheck,
  Zap,
} from 'lucide-react';

export const MigrationGuide: React.FC = () => {
  const [activeSnippet, setActiveSnippet] = useState<'RECORDSET' | 'EVENTS' | 'BUSINESS_LOGIC' | 'REPORTS'>('RECORDSET');

  return (
    <div id="migration-guide-container" className="space-y-8 max-w-6xl mx-auto">
      {/* Encabezado Técnico */}
      <div className="bg-white p-6 rounded-xl border border-slate-200 shadow-xs">
        <div className="flex items-center space-x-3 mb-2">
          <div className="p-2 bg-blue-100 text-blue-800 rounded-lg">
            <Layers className="w-5 h-5" />
          </div>
          <div>
            <h2 className="text-xl font-black text-slate-900 tracking-tight">
              Informe Técnico de Migración: Microsoft Access VBA &rarr; React 19 / TypeScript
            </h2>
            <p className="text-xs text-slate-500">
              Evaluación estructural realizada por el Ingeniero de Software Senior.
            </p>
          </div>
        </div>

        <p className="text-xs text-slate-600 leading-relaxed mt-3">
          Se analizaron los formularios (<code>.frm</code>), módulos de clase (<code>.cls</code>) y rutinas (<code>.bas</code>)
          del ERP operativo. Toda la lógica monolítica ligada a eventos OLE y motores DAO/Jet Engine fue desacoplada en:
          (1) Componentes funcionales declarativos con hooks, (2) Tipos estrictos de dominio, (3) Utilidades puras de cálculo,
          y (4) Una capa de acceso a datos REST simulada mediante contratos asíncronos.
        </p>
      </div>

      {/* Matriz de Correspondencia de Formularios Access */}
      <div className="bg-white p-6 rounded-xl border border-slate-200 shadow-xs space-y-4">
        <h3 className="text-sm font-bold text-slate-800 uppercase tracking-wider flex items-center space-x-2">
          <FolderTree className="w-4 h-4 text-blue-600" />
          <span>Estructura de Componentes y Mapeo de Archivos</span>
        </h3>

        <div className="overflow-x-auto border border-slate-200 rounded-lg">
          <table className="w-full text-left text-xs">
            <thead className="bg-slate-100 text-slate-700 font-semibold border-b border-slate-200">
              <tr>
                <th className="p-3">Formulario / Módulo Access Original</th>
                <th className="p-3">Rol Operativo en ERP</th>
                <th className="p-3">Componente / Módulo React &amp; TS</th>
                <th className="p-3">Patrón de Estado &amp; Eventos</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              <tr>
                <td className="p-3 font-mono font-bold text-slate-800">Form_SWITCHBOARD</td>
                <td className="p-3 text-slate-600">Menú principal y navegación</td>
                <td className="p-3 font-mono text-blue-700">&lt;Sidebar /&gt; / &lt;App /&gt;</td>
                <td className="p-3 text-slate-600">Navegación declarativa por tabs de estado</td>
              </tr>
              <tr>
                <td className="p-3 font-mono font-bold text-slate-800">
                  Form_AMAQUINAS, Form_2011AG, Form_2012
                </td>
                <td className="p-3 text-slate-600">Ficha general de flota y consumos</td>
                <td className="p-3 font-mono text-blue-700">&lt;MachinesModule /&gt;</td>
                <td className="p-3 text-slate-600">
                  <code>useState(machines)</code>, <code>acNext</code>, <code>acSaveRecord</code>
                </td>
              </tr>
              <tr>
                <td className="p-3 font-mono font-bold text-slate-800">Form_A (TOTALIZADOR)</td>
                <td className="p-3 text-slate-600">Cálculo de horas diferenciales (DifK)</td>
                <td className="p-3 font-mono text-blue-700"><code>calculateHourDifference()</code></td>
                <td className="p-3 text-slate-600">
                  <code>onChange</code> en input HORAS con recálculo dinámico de <code>DifK</code>
                </td>
              </tr>
              <tr>
                <td className="p-3 font-mono font-bold text-slate-800">
                  Form_CAT 416, FREZADORA 1000/2000 HS, MOTONIV, TOPADORAS
                </td>
                <td className="p-3 text-slate-600">Protocolos de mantenimiento 1000/2000 HS</td>
                <td className="p-3 font-mono text-blue-700">&lt;MaintenanceServicesModule /&gt;</td>
                <td className="p-3 text-slate-600">
                  <code>allowEdit</code> toggle (reemplaza <code>allowedit</code> en VBA) + <code>acNewRec</code>
                </td>
              </tr>
              <tr>
                <td className="p-3 font-mono font-bold text-slate-800">
                  Form_AGREGAR PEDIDO, EDITAR PEDIDO, EDITAR ARTICULO (I/II/CON CALCULO)
                </td>
                <td className="p-3 text-slate-600">Requerimientos de repuestos y depósitos</td>
                <td className="p-3 font-mono text-blue-700">&lt;OrdersModule /&gt;</td>
                <td className="p-3 text-slate-600">
                  Cálculo continuo en renglones: <code>calculateOrderTotals()</code>
                </td>
              </tr>
              <tr>
                <td className="p-3 font-mono font-bold text-slate-800">
                  Form_PARTE DIARIO, INFORME DIARIO, Form_ENVIO
                </td>
                <td className="p-3 text-slate-600">Operaciones de choferes y remitos</td>
                <td className="p-3 font-mono text-blue-700">&lt;DailyReportsModule /&gt;</td>
                <td className="p-3 text-slate-600">
                  Búsqueda por chofer (<code>rs.FindFirst [CHOFER]</code>) y paginación <code>acNext</code>
                </td>
              </tr>
              <tr>
                <td className="p-3 font-mono font-bold text-slate-800">
                  Form_CAJA CHICA, PROVEEDORES A PAGAR, Form_SFONDOS (PEND/TUBULAR)
                </td>
                <td className="p-3 text-slate-600">Tesorería, egresos y solicitudes de fondos</td>
                <td className="p-3 font-mono text-blue-700">&lt;FinanceModule /&gt;</td>
                <td className="p-3 text-slate-600">
                  Validación tipada de montos + simulación de correo (<code>DoCmd.SendObject</code>)
                </td>
              </tr>
              <tr>
                <td className="p-3 font-mono font-bold text-slate-800">
                  DoCmd.OpenReport / DoCmd.OutputTo
                </td>
                <td className="p-3 text-slate-600">Previsualización de informes impresos</td>
                <td className="p-3 font-mono text-blue-700">&lt;ReportViewerModal /&gt;</td>
                <td className="p-3 text-slate-600">Plantilla imprimible estilo A4 con <code>window.print()</code></td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      {/* Comparador de Código: Legacy VBA vs. Modern TypeScript */}
      <div className="bg-white p-6 rounded-xl border border-slate-200 shadow-xs space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h3 className="text-sm font-bold text-slate-800 uppercase tracking-wider flex items-center space-x-2">
            <Code2 className="w-4 h-4 text-emerald-600" />
            <span>Comparativa de Código Fuente (VBA vs. React / TypeScript)</span>
          </h3>

          <div className="flex space-x-2 text-xs">
            <button
              onClick={() => setActiveSnippet('RECORDSET')}
              className={`px-3 py-1 rounded-lg border font-semibold ${
                activeSnippet === 'RECORDSET'
                  ? 'bg-blue-600 text-white border-blue-600'
                  : 'bg-slate-50 text-slate-700 border-slate-200 hover:bg-slate-100'
              }`}
            >
              Recordset.Clone &amp; FindFirst
            </button>
            <button
              onClick={() => setActiveSnippet('BUSINESS_LOGIC')}
              className={`px-3 py-1 rounded-lg border font-semibold ${
                activeSnippet === 'BUSINESS_LOGIC'
                  ? 'bg-blue-600 text-white border-blue-600'
                  : 'bg-slate-50 text-slate-700 border-slate-200 hover:bg-slate-100'
              }`}
            >
              Cálculo Horómetro (Form_A)
            </button>
            <button
              onClick={() => setActiveSnippet('EVENTS')}
              className={`px-3 py-1 rounded-lg border font-semibold ${
                activeSnippet === 'EVENTS'
                  ? 'bg-blue-600 text-white border-blue-600'
                  : 'bg-slate-50 text-slate-700 border-slate-200 hover:bg-slate-100'
              }`}
            >
              Eventos &amp; allowedit
            </button>
            <button
              onClick={() => setActiveSnippet('REPORTS')}
              className={`px-3 py-1 rounded-lg border font-semibold ${
                activeSnippet === 'REPORTS'
                  ? 'bg-blue-600 text-white border-blue-600'
                  : 'bg-slate-50 text-slate-700 border-slate-200 hover:bg-slate-100'
              }`}
            >
              OpenReport &amp; SendObject
            </button>
          </div>
        </div>

        {/* Panel comparativo side-by-side */}
        {renderSnippetComparison(activeSnippet)}
      </div>

      {/* Arquitectura REST API Futura */}
      <div className="bg-white text-slate-900 p-6 rounded-2xl border border-slate-200 shadow-2xs space-y-3 text-xs">
        <div className="flex items-center space-x-2 text-blue-700 font-bold uppercase tracking-wider">
          <ShieldCheck className="w-4 h-4 text-blue-600" />
          <span>Hoja de Ruta de Backend REST (Endpoints Listos)</span>
        </div>
        <p className="text-slate-600">
          En el archivo <code>src/services/api.ts</code>, todos los métodos están desacoplados mediante el patrón
          Repository/Service con anotaciones <code>// TODO: Fetch from /api/...</code>. Para conectar a una base
          de datos PostgreSQL o Cloud Firestore, sólo se sustituye el cuerpo del servicio manteniendo intactos
          los contratos de interfaz TypeScript.
        </p>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 pt-2 font-mono text-[11px] text-slate-700">
          <div className="bg-blue-50/40 p-3 rounded-xl border border-blue-200">
            <span className="text-blue-700 font-bold">GET</span> /api/machines/:codmaq
            <p className="text-slate-500 text-[10px] mt-1">Reemplaza: Cuadro_combinado168_AfterUpdate</p>
          </div>
          <div className="bg-blue-50/40 p-3 rounded-xl border border-blue-200">
            <span className="text-blue-700 font-bold">POST</span> /api/totalizers
            <p className="text-slate-500 text-[10px] mt-1">Reemplaza: Form_A TOTALIZADOR_AfterUpdate</p>
          </div>
          <div className="bg-blue-50/40 p-3 rounded-xl border border-blue-200">
            <span className="text-blue-700 font-bold">PUT</span> /api/services/:id
            <p className="text-slate-500 text-[10px] mt-1">Reemplaza: Form_CAT 416 allowedit &amp; save</p>
          </div>
          <div className="bg-blue-50/40 p-3 rounded-xl border border-blue-200">
            <span className="text-blue-700 font-bold">POST</span> /api/fund-requests/:id/send-email
            <p className="text-slate-500 text-[10px] mt-1">Reemplaza: DoCmd.SendObject acReport, "SF"</p>
          </div>
        </div>
      </div>
    </div>
  );
};

function renderSnippetComparison(snippetType: string) {
  if (snippetType === 'RECORDSET') {
    return (
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs font-mono">
        <div className="bg-slate-900 text-slate-100 p-4 rounded-xl border border-slate-800 space-y-2">
          <div className="text-rose-400 font-bold text-[11px] uppercase tracking-wider pb-1 border-b border-slate-800">
            Microsoft Access VBA (Cuadro_combinado168_AfterUpdate)
          </div>
          <pre className="text-[11px] overflow-x-auto text-rose-200">
{`Private Sub Cuadro_combinado168_AfterUpdate()
    ' Buscar el registro que coincida con el control.
    Dim rs As Object

    Set rs = Me.Recordset.Clone
    rs.FindFirst "[CODMAQ] = '" & Me![Cuadro combinado168] & "'"
    If Not rs.EOF Then Me.Bookmark = rs.Bookmark
End Sub`}
          </pre>
          <p className="text-slate-400 text-[10px] pt-2">
            Dependencia del cursor Jet DAO nativo, punteros OLE Bookmark y bloqueo de interfaz.
          </p>
        </div>

        <div className="bg-slate-900 text-slate-100 p-4 rounded-xl border border-slate-800 space-y-2">
          <div className="text-emerald-400 font-bold text-[11px] uppercase tracking-wider pb-1 border-b border-slate-800">
            React 19 &amp; TypeScript (Modern Web)
          </div>
          <pre className="text-[11px] overflow-x-auto text-emerald-200">
{`const handleSelectMachineByCode = (codmaq: string) => {
  const match = machines.find((m) => m.codmaq === codmaq);
  if (match) {
    setSelectedMachine(match);
    loadMachineTotalizers(match.codmaq);
  }
};

// En el JSX declarativo:
<select
  value={selectedMachine?.codmaq || ''}
  onChange={(e) => handleSelectMachineByCode(e.target.value)}
>`}
          </pre>
          <p className="text-slate-400 text-[10px] pt-2">
            Estado inmutable, desacoplado de motor de datos y tipado en tiempo de compilación.
          </p>
        </div>
      </div>
    );
  }

  if (snippetType === 'BUSINESS_LOGIC') {
    return (
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs font-mono">
        <div className="bg-slate-900 text-slate-100 p-4 rounded-xl border border-slate-800 space-y-2">
          <div className="text-rose-400 font-bold text-[11px] uppercase tracking-wider pb-1 border-b border-slate-800">
            Microsoft Access VBA (Form_A - TOTALIZADOR)
          </div>
          <pre className="text-[11px] overflow-x-auto text-rose-200">
{`Private Sub TOTALIZADOR_AfterUpdate()
If Nz(DLast("horas")) = 0 Then
DifK = 0
Else
DifK = HORAS - Nz(DLast("horas"))
End If
End Sub`}
          </pre>
          <p className="text-slate-400 text-[10px] pt-2">
            Uso de la función de dominio de Access <code>DLast</code> directamente en el formulario.
          </p>
        </div>

        <div className="bg-slate-900 text-slate-100 p-4 rounded-xl border border-slate-800 space-y-2">
          <div className="text-emerald-400 font-bold text-[11px] uppercase tracking-wider pb-1 border-b border-slate-800">
            TypeScript (src/utils/legacyCalculations.ts)
          </div>
          <pre className="text-[11px] overflow-x-auto text-emerald-200">
{`export function calculateHourDifference(
  currentHours: number,
  lastHours: number | null | undefined
): number {
  const safeLast = lastHours ?? 0;
  if (safeLast === 0) return 0;
  const diff = currentHours - safeLast;
  return Number.isFinite(diff) ? Math.max(0, diff) : 0;
}`}
          </pre>
          <p className="text-slate-400 text-[10px] pt-2">
            Función pura testeable unitariamente, sin efectos secundarios en UI.
          </p>
        </div>
      </div>
    );
  }

  if (snippetType === 'EVENTS') {
    return (
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs font-mono">
        <div className="bg-slate-900 text-slate-100 p-4 rounded-xl border border-slate-800 space-y-2">
          <div className="text-rose-400 font-bold text-[11px] uppercase tracking-wider pb-1 border-b border-slate-800">
            Microsoft Access VBA (Form_CAT 416 2000HS)
          </div>
          <pre className="text-[11px] overflow-x-auto text-rose-200">
{`Private Sub Opción123_GotFocus()
  allowedit
End Sub

Private Sub Command162_Click()
  DoCmd.GoToRecord , , acNewRec
End Sub`}
          </pre>
        </div>

        <div className="bg-slate-900 text-slate-100 p-4 rounded-xl border border-slate-800 space-y-2">
          <div className="text-emerald-400 font-bold text-[11px] uppercase tracking-wider pb-1 border-b border-slate-800">
            React 19 (MaintenanceServicesModule.tsx)
          </div>
          <pre className="text-[11px] overflow-x-auto text-emerald-200">
{`// Toggle de edición controlada
const handleToggleAllowEdit = () => {
  setSelectedService(prev => ({
    ...prev,
    allowEdit: !prev.allowEdit
  }));
};

// Reemplazo de acNewRec
const handleCreateNewServiceRecord = () => {
  const newRecord = { ...template, allowEdit: true };
  setServices([newRecord, ...services]);
};`}
          </pre>
        </div>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs font-mono">
      <div className="bg-slate-900 text-slate-100 p-4 rounded-xl border border-slate-800 space-y-2">
        <div className="text-rose-400 font-bold text-[11px] uppercase tracking-wider pb-1 border-b border-slate-800">
          Microsoft Access VBA (Form_SFONDOS)
        </div>
        <pre className="text-[11px] overflow-x-auto text-rose-200">
{`Private Sub Comando40_Click()
    Dim stDocName As String
    stDocName = "SF"
    DoCmd.OpenReport stDocName, acPreview
End Sub

Private Sub Comando43_Click()
    Dim stDocName As String
    stDocName = "SF"
    DoCmd.SendObject acReport, stDocName
End Sub`}
        </pre>
      </div>

      <div className="bg-slate-900 text-slate-100 p-4 rounded-xl border border-slate-800 space-y-2">
        <div className="text-emerald-400 font-bold text-[11px] uppercase tracking-wider pb-1 border-b border-slate-800">
          React (ReportViewerModal.tsx &amp; ErpApi)
        </div>
        <pre className="text-[11px] overflow-x-auto text-emerald-200">
{`// Previsualización y Envío de Correo
const handleOpenReport = (reportName: string, data: any) => {
  setActiveReport({ name: reportName, payload: data });
};

const handleSendEmail = async (sfId: string) => {
  // TODO: POST /api/fund-requests/:id/send-email
  await ErpApi.simulateSendObjectEmail(sfId);
  notify('Reporte SF enviado exitosamente');
};`}
        </pre>
      </div>
    </div>
  );
}
