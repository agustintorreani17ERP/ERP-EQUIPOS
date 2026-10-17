param([string]$DbPath, [string]$OutDir)
# Exporta formularios, informes, módulos y consultas a texto (SaveAsText) desde una COPIA del .accdb.
# AutomationSecurity = 3 (msoAutomationSecurityForceDisable): no se ejecuta VBA ni macros al abrir.
New-Item -ItemType Directory -Force $OutDir | Out-Null
$acc = New-Object -ComObject Access.Application
try {
  $acc.Visible = $false
  $acc.AutomationSecurity = 3
  $acc.OpenCurrentDatabase($DbPath, $false)
  $proj = $acc.CurrentProject
  $sets = @(
    @{ Type = 2; Items = $proj.AllForms;   Dir = 'forms' },
    @{ Type = 3; Items = $proj.AllReports; Dir = 'reports' },
    @{ Type = 5; Items = $proj.AllModules; Dir = 'modules' }
  )
  foreach ($set in $sets) {
    $d = Join-Path $OutDir $set.Dir
    New-Item -ItemType Directory -Force $d | Out-Null
    foreach ($obj in $set.Items) {
      if ($obj.Name -like '~*') { continue }
      $safe = ($obj.Name -replace '[\\/:*?"<>|]', '_')
      try { $acc.SaveAsText($set.Type, $obj.Name, (Join-Path $d "$safe.txt")) }
      catch { "ERR $($set.Dir)/$($obj.Name): $($_.Exception.Message)" }
    }
  }
} finally {
  try { $acc.CloseCurrentDatabase() } catch {}
  $acc.Quit()
  [void][Runtime.InteropServices.Marshal]::ReleaseComObject($acc)
}
