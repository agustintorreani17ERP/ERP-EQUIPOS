param([string]$DbPath, [string]$Out)
# Vuelca estructura de un .accdb con DAO en solo lectura (no ejecuta macros ni VBA).
$ErrorActionPreference = 'Continue'
$eng = New-Object -ComObject DAO.DBEngine.120
$dbo = $eng.OpenDatabase($DbPath, $false, $true)
$sb = New-Object System.Text.StringBuilder

[void]$sb.AppendLine("# TABLES")
foreach ($t in $dbo.TableDefs) {
  if ($t.Name -like 'MSys*' -or $t.Name -like '~*') { continue }
  $cnt = ''
  if (-not $t.Connect) { try { $cnt = $t.RecordCount } catch {} }
  [void]$sb.AppendLine("## $($t.Name) | rows=$cnt | link=$($t.Connect) $($t.SourceTableName)")
  $fs = @()
  foreach ($f in $t.Fields) { $fs += "$($f.Name):$($f.Type)" }
  [void]$sb.AppendLine("   " + ($fs -join ', '))
}

[void]$sb.AppendLine("# RELATIONS")
foreach ($r in $dbo.Relations) {
  $fl = @(); foreach ($f in $r.Fields) { $fl += "$($f.Name)->$($f.ForeignName)" }
  [void]$sb.AppendLine("$($r.Table) -> $($r.ForeignTable) [$($fl -join ', ')]")
}

[void]$sb.AppendLine("# QUERIES")
foreach ($q in $dbo.QueryDefs) {
  if ($q.Name -like '~*') { continue }
  [void]$sb.AppendLine("## $($q.Name) | type=$($q.Type)")
  [void]$sb.AppendLine(($q.SQL -replace "`r`n", ' ').Trim())
}

foreach ($c in 'Forms','Reports','Modules','Scripts') {
  [void]$sb.AppendLine("# $c")
  try { foreach ($d in $dbo.Containers.Item($c).Documents) { [void]$sb.AppendLine($d.Name) } } catch {}
}
$dbo.Close()
[IO.File]::WriteAllText($Out, $sb.ToString(), [Text.Encoding]::UTF8)

