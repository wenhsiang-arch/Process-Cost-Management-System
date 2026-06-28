param(
  [int]$Port = 8765
)

$ErrorActionPreference = 'Stop'
$script:IndexVersion = 9
$script:Prefix = "http://127.0.0.1:$Port/"
$script:Stage = ''
$script:Detail = ''
$script:Logs = New-Object System.Collections.Generic.List[string]
$script:Timer = $null
$script:LastMs = 0
$script:CurrentTempDir = ''

Add-Type -AssemblyName System.Drawing
Add-Type -AssemblyName System.IO.Compression.FileSystem

function Set-Stage([string]$stage, [string]$detail = '') {
  $script:Stage = $stage
  $script:Detail = $detail
}

function Start-Timer() {
  $script:Timer = [System.Diagnostics.Stopwatch]::StartNew()
  $script:LastMs = 0
  $script:Logs = New-Object System.Collections.Generic.List[string]
}

function Add-Log([string]$name, [string]$detail = '') {
  if ($null -eq $script:Timer) { Start-Timer }
  $total = [int]$script:Timer.ElapsedMilliseconds
  $lap = $total - $script:LastMs
  $script:LastMs = $total
  $line = "$name total=${total}ms lap=${lap}ms"
  if ($detail) { $line = "$line $detail" }
  $script:Logs.Add($line)
  Write-Host "[cutting-time] $line"
}

function Send-Text($response, [int]$statusCode, [string]$text, [string]$contentType = 'application/json; charset=utf-8') {
  $bytes = [System.Text.Encoding]::UTF8.GetBytes($text)
  $response.StatusCode = $statusCode
  $response.ContentType = $contentType
  $response.Headers.Add('Access-Control-Allow-Origin', '*')
  $response.Headers.Add('Access-Control-Allow-Methods', 'GET,POST,OPTIONS')
  $response.Headers.Add('Access-Control-Allow-Headers', 'Content-Type')
  $response.OutputStream.Write($bytes, 0, $bytes.Length)
  $response.Close()
}

function Send-Json($response, [int]$statusCode, $data) {
  Send-Text $response $statusCode ($data | ConvertTo-Json -Compress -Depth 12)
}

function Send-File($response, [string]$path, [string]$fileName) {
  $bytes = [System.IO.File]::ReadAllBytes($path)
  $safeName = $fileName -replace '[\\/:*?"<>|]', '_'
  $response.StatusCode = 200
  $response.ContentType = 'application/pdf'
  $response.Headers.Add('Access-Control-Allow-Origin', '*')
  $response.Headers.Add('Access-Control-Allow-Methods', 'GET,POST,OPTIONS')
  $response.Headers.Add('Access-Control-Allow-Headers', 'Content-Type')
  $response.Headers.Add('Content-Disposition', "inline; filename=""$safeName""")
  if ($script:Logs.Count -gt 0) {
    $timing = ($script:Logs -join ' | ')
    if ($timing.Length -gt 3500) { $timing = $timing.Substring(0, 3500) }
    $response.Headers.Add('X-Cutting-Timing', $timing)
  }
  $response.OutputStream.Write($bytes, 0, $bytes.Length)
  $response.Close()
}

function Release-Com($object) {
  if ($null -ne $object -and [System.Runtime.InteropServices.Marshal]::IsComObject($object)) {
    [void][System.Runtime.InteropServices.Marshal]::ReleaseComObject($object)
  }
}

function Safe-FileName([string]$text) {
  $name = if ($text) { $text } else { 'template' }
  return ($name -replace '[\\/:*?"<>|]', '_')
}

function Get-CacheKey($payload) {
  $raw = if ($payload.templateId) { [string]$payload.templateId } elseif ($payload.fileName) { [string]$payload.fileName } else { 'template' }
  $stamp = "$([string]$payload.templateUpdatedAt)-$([string]$payload.templateFileSize)"
  return Safe-FileName "$raw-$stamp"
}

function Get-CacheRoot() {
  $root = Join-Path $PSScriptRoot 'cutting-cache'
  if (-not (Test-Path -LiteralPath $root)) { New-Item -ItemType Directory -Path $root | Out-Null }
  return $root
}

function Get-IndexDir($payload) {
  $dir = Join-Path (Get-CacheRoot) (Get-CacheKey $payload)
  if (-not (Test-Path -LiteralPath $dir)) { New-Item -ItemType Directory -Path $dir | Out-Null }
  return $dir
}

function Get-IndexPath($payload) {
  return (Join-Path (Get-IndexDir $payload) 'index.json')
}

function New-TempDir() {
  $root = Join-Path ([System.IO.Path]::GetTempPath()) ("cutting-pdf-" + [Guid]::NewGuid().ToString('N'))
  New-Item -ItemType Directory -Path $root | Out-Null
  $script:CurrentTempDir = $root
  return $root
}

function Remove-CuttingTempDir([string]$path) {
  if (-not $path) { return }
  try {
    $tempRoot = [System.IO.Path]::GetFullPath([System.IO.Path]::GetTempPath())
    $target = [System.IO.Path]::GetFullPath($path)
    $trimChars = @([System.IO.Path]::DirectorySeparatorChar, [System.IO.Path]::AltDirectorySeparatorChar)
    $name = [System.IO.Path]::GetFileName($target.TrimEnd($trimChars))
    if ($target.StartsWith($tempRoot, [System.StringComparison]::OrdinalIgnoreCase) -and $name.StartsWith('cutting-pdf-', [System.StringComparison]::OrdinalIgnoreCase)) {
      Remove-Item -LiteralPath $target -Recurse -Force -ErrorAction SilentlyContinue
      Add-Log 'clean_temp' "path=$target"
    }
  } catch {
    Add-Log 'clean_temp_failed' $_.Exception.Message
  }
}

function Remove-OldCuttingTempDirs([int]$olderThanHours = 24) {
  try {
    $tempRoot = [System.IO.Path]::GetFullPath([System.IO.Path]::GetTempPath())
    $cutoff = (Get-Date).AddHours(-1 * $olderThanHours)
    Get-ChildItem -LiteralPath $tempRoot -Directory -Filter 'cutting-pdf-*' -ErrorAction SilentlyContinue | ForEach-Object {
      if ($_.LastWriteTime -lt $cutoff) { Remove-CuttingTempDir $_.FullName }
    }
  } catch {
    Add-Log 'clean_old_temp_failed' $_.Exception.Message
  }
}

function Convert-ToSafeDouble($value) {
  if ($null -eq $value) { return 0.0 }
  if ($value -is [byte] -or $value -is [int16] -or $value -is [int32] -or $value -is [int64] -or $value -is [single] -or $value -is [double] -or $value -is [decimal]) {
    return [double]$value
  }
  $text = ([string]$value).Trim() -replace ',', ''
  if (-not $text) { return 0.0 }
  $number = 0.0
  $style = [Globalization.NumberStyles]::Float -bor [Globalization.NumberStyles]::AllowThousands
  if ([double]::TryParse($text, $style, [Globalization.CultureInfo]::InvariantCulture, [ref]$number)) { return $number }
  if ([double]::TryParse($text, $style, [Globalization.CultureInfo]::CurrentCulture, [ref]$number)) { return $number }
  return 0.0
}

function Normalize-HeaderText([string]$text) {
  if ($null -eq $text) { return '' }
  $formD = $text.Normalize([Text.NormalizationForm]::FormD)
  $chars = New-Object System.Text.StringBuilder
  foreach ($ch in $formD.ToCharArray()) {
    $category = [Globalization.CharUnicodeInfo]::GetUnicodeCategory($ch)
    if ($category -ne [Globalization.UnicodeCategory]::NonSpacingMark) { [void]$chars.Append($ch) }
  }
  return (($chars.ToString() -replace [char]272, 'D' -replace [char]273, 'd').ToUpperInvariant() -replace '\s+', '')
}

function Is-ItemCode([string]$text) {
  $value = ([string]$text).Trim().ToUpperInvariant()
  return (
    $value -match '^[A-Z]{1,6}\d{2,}[-A-Z0-9]*$' -or
    $value -match '^[A-Z]{1,6}\d{2,}~(?:[A-Z]{1,6})?\d{1,}[-A-Z0-9]*$'
  )
}

function Expand-ItemCodeAliases([string]$text) {
  $value = ([string]$text).Trim().ToUpperInvariant() -replace '\s+', ''
  if (-not $value) { return @() }
  if ($value -notmatch '~') { return @($value) }
  $parts = $value -split '~', 2
  if ($parts.Count -ne 2) { return @($value) }
  $left = $parts[0]
  $right = $parts[1]
  if ($left -notmatch '^([A-Z]{1,6})(\d+)([-A-Z0-9]*)$') { return @($value) }
  $prefix = $Matches[1]
  $leftDigits = $Matches[2]
  $suffix = $Matches[3]
  if ($suffix) { return @($value) }
  $rightDigits = ''
  if ($right -match '^([A-Z]{1,6})(\d+)$') {
    if ($Matches[1] -ne $prefix) { return @($value) }
    $rightDigits = $Matches[2]
  } elseif ($right -match '^(\d+)$') {
    $rightDigits = $Matches[1]
  } else {
    return @($value)
  }
  if ($rightDigits.Length -lt $leftDigits.Length) {
    $baseLength = $leftDigits.Length - $rightDigits.Length
    $baseDigits = $leftDigits.Substring(0, $baseLength)
    $leftTail = $leftDigits.Substring($baseLength)
    $leftNum = [int]$leftTail
    $rightNum = [int]$rightDigits
    $width = $rightDigits.Length
  } else {
    $baseDigits = ''
    $leftNum = [int]$leftDigits
    $rightNum = [int]$rightDigits
    $width = [Math]::Max($leftDigits.Length, $rightDigits.Length)
  }
  if ($rightNum -lt $leftNum -or ($rightNum - $leftNum) -gt 200) { return @($value) }
  $aliases = @()
  for ($num = $leftNum; $num -le $rightNum; $num++) {
    $aliases += ($prefix + $baseDigits + $num.ToString("D$width"))
  }
  return $aliases
}

function Get-ColumnLetters([int]$col) {
  $n = $col
  $letters = ''
  while ($n -gt 0) {
    $rem = ($n - 1) % 26
    $letters = [char](65 + $rem) + $letters
    $n = [Math]::Floor(($n - 1) / 26)
  }
  return $letters
}

function Get-CellAddress1([int]$row, [int]$col) {
  return "$(Get-ColumnLetters $col)$row"
}

function Get-CellText($sheet, [int]$row, [int]$col) {
  $cell = $sheet.Cells.Item($row, $col)
  try { return [string]$cell.Text } finally { Release-Com $cell }
}

function Normalize-PdfCellText([string]$text) {
  if ($null -eq $text) { return '' }
  $normalized = [string]$text
  $normalized = $normalized -replace "`r`n", "`n"
  $normalized = $normalized -replace "`r", "`n"
  $lines = @($normalized -split "`n" | ForEach-Object { ([string]$_).Trim() })
  return (($lines -join "`n").Trim())
}

function Get-CellValueText($cell) {
  $value = $cell.Value2
  if ($null -ne $value) { return Normalize-PdfCellText ([string]$value) }
  return Normalize-PdfCellText ([string]$cell.Text)
}

function Get-CellNumber($sheet, [int]$row, [int]$col) {
  if ($col -le 0) { return 0.0 }
  $cell = $sheet.Cells.Item($row, $col)
  try { return Convert-ToSafeDouble $cell.Value2 } finally { Release-Com $cell }
}

function Get-MergedCellText($sheet, [int]$row, [int]$col) {
  if ($col -le 0) { return '' }
  $cell = $sheet.Cells.Item($row, $col)
  try {
    if ($cell.MergeCells) {
      $area = $cell.MergeArea
      try {
        $first = $area.Cells.Item(1, 1)
        try { return [string]$first.Text } finally { Release-Com $first }
      } finally {
        Release-Com $area
      }
    }
    return [string]$cell.Text
  } finally {
    Release-Com $cell
  }
}

function Get-MergedCellValueText($sheet, [int]$row, [int]$col) {
  if ($col -le 0) { return '' }
  $cell = $sheet.Cells.Item($row, $col)
  try {
    if ($cell.MergeCells) {
      $area = $cell.MergeArea
      try {
        $first = $area.Cells.Item(1, 1)
        try { return Get-CellValueText $first } finally { Release-Com $first }
      } finally {
        Release-Com $area
      }
    }
    return Get-CellValueText $cell
  } finally {
    Release-Com $cell
  }
}

function Is-GroupHeaderRow($sheet, [int]$row, [int]$firstCol, [int]$lastCol) {
  $texts = @()
  for ($col = $firstCol; $col -le $lastCol; $col++) {
    $text = Get-CellText $sheet $row $col
    if ($text) { $texts += $text }
  }
  $joined = Normalize-HeaderText (($texts -join ' '))
  return (
    ($joined.Contains('MAHANG') -or $joined.Contains('ITEMNO') -or $joined.Contains('ITEM')) -and
    ($joined.Contains('SLPO') -or $joined.Contains('SL:PO') -or $joined.Contains('QTY') -or $joined.Contains('PCS'))
  )
}

function Get-UsedBounds($sheet) {
  $used = $sheet.UsedRange
  try {
    return [PSCustomObject]@{
      FirstRow = [int]$used.Row
      FirstCol = [int]$used.Column
      LastRow = [int]$used.Row + [int]$used.Rows.Count - 1
      LastCol = [int]$used.Column + [int]$used.Columns.Count - 1
    }
  } finally {
    Release-Com $used
  }
}

function Get-GroupRanges($sheet) {
  $bounds = Get-UsedBounds $sheet
  $starts = New-Object System.Collections.Generic.List[int]
  for ($row = $bounds.FirstRow; $row -le $bounds.LastRow; $row++) {
    if (Is-GroupHeaderRow $sheet $row $bounds.FirstCol $bounds.LastCol) { $starts.Add($row) }
  }
  $groups = @()
  for ($i = 0; $i -lt $starts.Count; $i++) {
    $start = $starts[$i]
    $end = if ($i + 1 -lt $starts.Count) { $starts[$i + 1] - 1 } else { $bounds.LastRow }
    $groups += [PSCustomObject]@{ Start = $start; End = $end }
  }
  return $groups
}

function Find-HeaderColumns($sheet, [int]$row) {
  $bounds = Get-UsedBounds $sheet
  $cols = @{
    Code = 0; Color = 0; Qty = 0; Piece = 0; Total = 0; Note = 0; Belt = 0; CutSpec = 0; Segment = 0
  }
  for ($col = $bounds.FirstCol; $col -le $bounds.LastCol; $col++) {
    $text = Normalize-HeaderText (Get-CellText $sheet $row $col)
    if ($cols.Code -eq 0 -and ($text.Contains('MAHANG') -or $text.Contains('ITEMNO') -or $text.Contains('ITEM'))) { $cols.Code = $col }
    if ($cols.Color -eq 0 -and ($text.Contains('MAU') -or $text.Contains('COLOR'))) { $cols.Color = $col }
    if ($cols.Qty -eq 0 -and ($text.Contains('SLPO') -or $text.Contains('SL:PO') -or $text.Contains('QTY') -or $text.Contains('PCS'))) { $cols.Qty = $col }
    if ($cols.Piece -eq 0 -and ($text.Contains('SOKIEN') -or $text.Contains('SOBO'))) { $cols.Piece = $col }
    if ($cols.Total -eq 0 -and (($text.Contains('SLCAT') -or $text.Contains('THUCTE'))) -and -not $text.Contains('THIEU')) { $cols.Total = $col }
    if ($cols.Note -eq 0 -and ($text.Contains('GHICHU') -or $text.Contains('NOTE'))) { $cols.Note = $col }
    if ($cols.Belt -eq 0 -and ($text.Contains('QUYCACH') -and ($text.Contains('DAY') -or $text.Contains('DAI') -or $text.Contains('THUNG')))) { $cols.Belt = $col }
    if ($cols.CutSpec -eq 0 -and ($text.Contains('QUYCACH') -and $text.Contains('CAT'))) { $cols.CutSpec = $col }
    if ($cols.Segment -eq 0 -and ($text.Contains('CONGDOAN') -or $text -eq 'DOAN')) { $cols.Segment = $col }
  }
  if ($cols.CutSpec -eq 0 -and $cols.Qty -gt 1 -and ($cols.Qty - 1) -ne $cols.Code) { $cols.CutSpec = $cols.Qty - 1 }
  return $cols
}

function Get-ColumnWidth($sheet, [int]$col) {
  if ($col -le 0) { return 0.0 }
  $column = $sheet.Columns.Item($col)
  try { return [double]$column.ColumnWidth } finally { Release-Com $column }
}

function Get-ColumnKeyForSourceCol([int]$col, $cols) {
  if ($col -eq 1) { return 'Image' }
  if ($col -eq [int]$cols.Code) { return 'Code' }
  if ($col -eq [int]$cols.Color) { return 'Color' }
  if ($col -eq [int]$cols.Qty) { return 'Qty' }
  if ($col -eq [int]$cols.Piece) { return 'Piece' }
  if ($col -eq [int]$cols.Total) { return 'Total' }
  if ($col -eq [int]$cols.Note) { return 'Note' }
  if ($col -eq [int]$cols.Belt) { return 'Belt' }
  if ($col -eq [int]$cols.CutSpec) { return 'CutSpec' }
  if ($col -eq [int]$cols.Segment) { return 'Segment' }
  return "Static_$col"
}

function Get-MergedCellInfo($sheet, [int]$row, [int]$col) {
  if ($col -le 0) { return $null }
  $cell = $sheet.Cells.Item($row, $col)
  try {
    if (-not $cell.MergeCells) { return $null }
    $area = $cell.MergeArea
    try {
      $rows = $area.Rows
      $columns = $area.Columns
      try {
        return [PSCustomObject]@{
          startRow = [int]$area.Row
          endRow = [int]$area.Row + [int]$rows.Count - 1
          startCol = [int]$area.Column
          endCol = [int]$area.Column + [int]$columns.Count - 1
        }
      } finally {
        Release-Com $rows
        Release-Com $columns
      }
    } finally {
      Release-Com $area
    }
  } finally {
    Release-Com $cell
  }
}

function Get-TemplateColumns($sheet, [int]$headerRow, [int]$startCol, [int]$endCol, $cols) {
  $result = @()
  $seen = @{}
  for ($col = $startCol; $col -le $endCol; $col++) {
    $key = Get-ColumnKeyForSourceCol $col $cols
    if ($seen.ContainsKey($key)) { $key = "Static_$col" }
    $header = (Get-CellText $sheet $headerRow $col).Trim()
    $result += [PSCustomObject]@{
      key = $key
      sourceCol = $col
      header = $header
      width = [double](Get-ColumnWidth $sheet $col)
    }
    $seen[$key] = $true
  }
  return @($result)
}

function Get-StaticValueMap($sheet, [int]$row, $columns, $cols) {
  $map = @{}
  foreach ($column in @($columns)) {
    $key = [string]$column.key
    if ($key -in @('Code','Qty','Piece','Total')) { continue }
    $sourceCol = [int]$column.sourceCol
    if ($sourceCol -le 0) { continue }
    $value = ''
    if ($key -in @('Image','Color','Belt','CutSpec','Segment','Note') -or $key.StartsWith('Static_')) {
      $value = Get-MergedCellValueText $sheet $row $sourceCol
      if (-not $value) { $value = (Get-CellText $sheet $row $sourceCol).Trim() }
    }
    if ($value) { $map[$key] = $value }
  }
  return $map
}

function Get-StaticMergeMap($sheet, [int]$row, $columns, [string]$sheetName) {
  $map = @{}
  foreach ($column in @($columns)) {
    $key = [string]$column.key
    if ($key -in @('Image','Code','Qty','Piece','Total')) { continue }
    $sourceCol = [int]$column.sourceCol
    if ($sourceCol -le 0) { continue }
    $merge = Get-MergedCellInfo $sheet $row $sourceCol
    if ($null -eq $merge) { continue }
    if ([int]$merge.endRow -le [int]$merge.startRow) { continue }
    $map[$key] = "$sheetName!R$($merge.startRow)C$($merge.startCol):R$($merge.endRow)C$($merge.endCol)"
  }
  return $map
}

function Get-ImageHash([string]$path) {
  if (-not $path -or -not (Test-Path -LiteralPath $path)) { return '' }
  $stream = [System.IO.File]::OpenRead($path)
  try {
    $sha = [System.Security.Cryptography.SHA256]::Create()
    try { return ([BitConverter]::ToString($sha.ComputeHash($stream)) -replace '-', '').ToLowerInvariant() } finally { $sha.Dispose() }
  } finally {
    $stream.Dispose()
  }
}

function Export-ShapeImage($shape, $sheet, [string]$path) {
  if ($null -eq $shape) { return $false }
  $chart = $null
  try {
    $width = [Math]::Max(80.0, [double]$shape.Width)
    $height = [Math]::Max(80.0, [double]$shape.Height)
    $shape.CopyPicture(1, 2)
    $chart = $sheet.ChartObjects().Add(0, 0, $width, $height)
    $chart.Chart.Paste()
    [void]$chart.Chart.Export($path, 'PNG')
    return (Test-Path -LiteralPath $path)
  } catch {
    return $false
  } finally {
    if ($null -ne $chart) {
      try { $chart.Delete() } catch {}
      Release-Com $chart
    }
  }
}

function Find-GroupImageShape($sheet, [int]$startRow, [int]$endRow) {
  $best = $null
  $bestScore = -1.0
  try {
    for ($i = 1; $i -le $sheet.Shapes.Count; $i++) {
      $shape = $sheet.Shapes.Item($i)
      try {
        $topRow = [int]$shape.TopLeftCell.Row
        $bottomRow = [int]$shape.BottomRightCell.Row
        if ($topRow -le $endRow -and $bottomRow -ge $startRow) {
          $leftCol = [int]$shape.TopLeftCell.Column
          $area = [double]$shape.Width * [double]$shape.Height
          $score = $area
          if ($leftCol -le 2) { $score += 100000000 }
          if ($score -gt $bestScore) {
            if ($null -ne $best) { Release-Com $best }
            $best = $shape
            $bestScore = $score
          } else {
            Release-Com $shape
          }
        } else {
          Release-Com $shape
        }
      } catch {
        Release-Com $shape
      }
    }
  } catch {}
  return $best
}

function Get-ModuleKey($columns) {
  $parts = @()
  foreach ($col in $columns) { $parts += "$($col.key):$([Math]::Round([double]$col.width, 2))" }
  return ($parts -join '|')
}

function Build-TemplateIndex($payload, [string]$xlsxPath) {
  Set-Stage 'build_index' 'analyze template'
  $indexDir = Get-IndexDir $payload
  $imageDir = Join-Path $indexDir 'images'
  if (-not (Test-Path -LiteralPath $imageDir)) { New-Item -ItemType Directory -Path $imageDir | Out-Null }

  $excel = $null
  $workbook = $null
  try {
    $excel = New-Object -ComObject Excel.Application
    $excel.Visible = $false
    $excel.ScreenUpdating = $false
    $excel.DisplayAlerts = $false
    $excel.EnableEvents = $false
    try { $excel.Calculation = -4135 } catch {}
    $workbook = $excel.Workbooks.Open($xlsxPath, $null, $true)
    $embeddedImageMap = Get-XlsxEmbeddedImageMap $xlsxPath

    $modules = @{}
    $images = @{}
    $groups = @()
    $items = @()
    $codeIndex = @{}
    $moduleNo = 0
    $imageNo = 0

    for ($s = 1; $s -le $workbook.Worksheets.Count; $s++) {
      $sheet = $workbook.Worksheets.Item($s)
      try {
        $sheetName = [string]$sheet.Name
        $ranges = @(Get-GroupRanges $sheet)
        if ($ranges.Count -eq 0) { continue }
        $firstGroup = $ranges[0]
        $cols = Find-HeaderColumns $sheet $firstGroup.Start
        if ($cols.Code -le 0 -or $cols.Qty -le 0 -or $cols.Piece -le 0) { continue }
        $bounds = Get-UsedBounds $sheet
        $startCol = [Math]::Max(1, [int]$bounds.FirstCol)
        $knownCols = @(
          [int]$cols.Note, [int]$cols.Total, [int]$cols.Piece, [int]$cols.Qty,
          [int]$cols.CutSpec, [int]$cols.Segment, [int]$cols.Color,
          [int]$cols.Code, [int]$cols.Belt, 1
        ) | Where-Object { $_ -gt 0 }
        $endCol = ($knownCols | Measure-Object -Maximum).Maximum
        $columns = @(Get-TemplateColumns $sheet $firstGroup.Start $startCol $endCol $cols)
        $moduleKey = Get-ModuleKey $columns
        $moduleId = ''
        if ($modules.ContainsKey($moduleKey)) {
          $moduleId = [string]$modules[$moduleKey].id
        } else {
          $moduleNo++
          $moduleId = "module_$moduleNo"
          $modules[$moduleKey] = [PSCustomObject]@{
            id = $moduleId
            key = $moduleKey
            columns = $columns
            headerHeight = 28.0
            groupHeight = 140.3
            sourceSheet = $sheetName
            sourceStartRow = $firstGroup.Start
            sourceEndRow = $firstGroup.End
          }
        }

        $groupNo = 0
        foreach ($group in $ranges) {
          $groupNo++
          $groupId = "$sheetName`_$groupNo"
          $imageId = ''
          $tempImage = Join-Path $imageDir "tmp_${s}_${groupNo}.png"
          $imageReady = $false
          $embeddedImage = if ($embeddedImageMap.ContainsKey($sheetName)) { Find-EmbeddedImageInfo $embeddedImageMap[$sheetName] $group.Start $group.End } else { $null }
          if ($null -ne $embeddedImage) {
            $extension = [System.IO.Path]::GetExtension([string]$embeddedImage.mediaPath)
            if (-not $extension) { $extension = '.png' }
            $tempImage = Join-Path $imageDir "tmp_${s}_${groupNo}$extension"
            $imageReady = Copy-XlsxEntryToFile $xlsxPath ([string]$embeddedImage.mediaPath) $tempImage
          }
          if (-not $imageReady) {
            $shape = Find-GroupImageShape $sheet $group.Start $group.End
            if ($null -ne $shape) {
              $tempImage = Join-Path $imageDir "tmp_${s}_${groupNo}.png"
              try {
                $imageReady = (Export-ShapeImage $shape $sheet $tempImage) -and (Test-UsableImageFile $tempImage)
              } finally {
                Release-Com $shape
              }
            }
          }
          if ($imageReady) {
            try {
              $hash = Get-ImageHash $tempImage
              if ($hash) {
                if ($images.ContainsKey($hash)) {
                  $imageId = [string]$images[$hash].id
                  Remove-Item -LiteralPath $tempImage -Force -ErrorAction SilentlyContinue
                } else {
                  $imageNo++
                  $imageId = "image_$imageNo"
                  $imageExt = [System.IO.Path]::GetExtension($tempImage)
                  if (-not $imageExt) { $imageExt = '.png' }
                  $imagePath = Join-Path $imageDir "$imageId$imageExt"
                  Move-Item -LiteralPath $tempImage -Destination $imagePath -Force
                  $images[$hash] = [PSCustomObject]@{ id = $imageId; hash = $hash; file = "images/$imageId$imageExt" }
                }
              }
            } finally {
              Remove-Item -LiteralPath $tempImage -Force -ErrorAction SilentlyContinue
            }
          }

          $groupItems = @()
          for ($row = $group.Start + 1; $row -le $group.End; $row++) {
            $code = (Get-CellText $sheet $row $cols.Code).Trim()
            if (-not (Is-ItemCode $code)) { continue }
            $piece = Get-CellNumber $sheet $row $cols.Piece
            $color = if ($cols.Color -gt 0) { Get-MergedCellValueText $sheet $row $cols.Color } else { '' }
            $values = Get-StaticValueMap $sheet $row $columns $cols
            $merges = Get-StaticMergeMap $sheet $row $columns $sheetName
            $item = [PSCustomObject]@{
              code = $code
              aliases = @(Expand-ItemCodeAliases $code)
              sheetName = $sheetName
              groupId = $groupId
              moduleId = $moduleId
              imageId = $imageId
              rowNumber = $row
              qtyCell = Get-CellAddress1 $row $cols.Qty
              pieceCell = Get-CellAddress1 $row $cols.Piece
              totalCell = if ($cols.Total -gt 0) { Get-CellAddress1 $row $cols.Total } else { '' }
              piece = $piece
              color = $color
              values = $values
              merges = $merges
            }
            $groupItems += $item
            $items += $item
            foreach ($alias in @($item.aliases)) {
              if (-not $codeIndex.ContainsKey($alias)) { $codeIndex[$alias] = @() }
              $codeIndex[$alias] += $item
            }
          }
          if ($groupItems.Count -gt 0) {
            $groups += [PSCustomObject]@{
              id = $groupId
              sheetName = $sheetName
              index = $groupNo
              moduleId = $moduleId
              imageId = $imageId
              startRow = $group.Start
              endRow = $group.End
              items = $groupItems
            }
          }
        }
      } finally {
        Release-Com $sheet
      }
    }

    $index = [PSCustomObject]@{
      version = $script:IndexVersion
      templateId = [string]$payload.templateId
      fileName = [string]$payload.fileName
      templateUpdatedAt = [string]$payload.templateUpdatedAt
      templateFileSize = [string]$payload.templateFileSize
      createdAt = (Get-Date).ToString('s')
      modules = @($modules.Values)
      images = @($images.Values)
      groups = $groups
      items = $items
    }
    [System.IO.File]::WriteAllText((Get-IndexPath $payload), ($index | ConvertTo-Json -Depth 40), [System.Text.Encoding]::UTF8)
    Add-Log 'build_index' "groups=$($groups.Count) items=$($items.Count) modules=$($modules.Count) images=$($images.Count)"
    return $index
  } finally {
    if ($null -ne $workbook) { try { $workbook.Close($false) } catch {}; Release-Com $workbook }
    if ($null -ne $excel) { try { $excel.Quit() } catch {}; Release-Com $excel }
    [GC]::Collect()
    [GC]::WaitForPendingFinalizers()
  }
}

function Load-TemplateIndex($payload) {
  $path = Get-IndexPath $payload
  if (-not (Test-Path -LiteralPath $path)) { return $null }
  try {
    $index = Get-Content -LiteralPath $path -Raw -Encoding UTF8 | ConvertFrom-Json
    if ([int]$index.version -ne $script:IndexVersion) { return $null }
    if ([string]$index.templateUpdatedAt -ne [string]$payload.templateUpdatedAt) { return $null }
    if ([string]$index.fileName -ne [string]$payload.fileName) { return $null }
    if ([string]$index.templateFileSize -ne [string]$payload.templateFileSize) { return $null }
    return $index
  } catch {
    return $null
  }
}

function Get-OrBuildTemplateIndex($payload, [string]$templatePath) {
  $index = Load-TemplateIndex $payload
  if ($null -ne $index) {
    Add-Log 'index_hit' "file=$($payload.fileName)"
    return $index
  }
  Add-Log 'index_miss' "file=$($payload.fileName)"
  return Build-TemplateIndex $payload $templatePath
}

function Get-WriteMap($payload) {
  $map = @{}
  foreach ($write in @($payload.writes)) {
    $key = "$([string]$write.sheetName)!$([string]$write.cell)".ToUpperInvariant()
    if (-not $map.ContainsKey($key)) { $map[$key] = 0.0 }
    $map[$key] = [double]$map[$key] + (Convert-ToSafeDouble $write.value)
  }
  return $map
}

function Test-UsableImageFile([string]$path) {
  if (-not $path -or -not (Test-Path -LiteralPath $path)) { return $false }
  try { return ((Get-Item -LiteralPath $path).Length -gt 1024) } catch { return $false }
}

function Resolve-OpenXmlTarget([string]$sourcePath, [string]$target) {
  if (-not $target) { return '' }
  $cleanTarget = $target -replace '\\', '/'
  if ($cleanTarget.StartsWith('/')) { return $cleanTarget.TrimStart('/') }
  $base = ($sourcePath -replace '\\', '/')
  $baseDir = ''
  $slash = $base.LastIndexOf('/')
  if ($slash -ge 0) { $baseDir = $base.Substring(0, $slash) }
  $parts = New-Object System.Collections.Generic.List[string]
  foreach ($part in (($baseDir + '/' + $cleanTarget) -split '/')) {
    if (-not $part -or $part -eq '.') { continue }
    if ($part -eq '..') {
      if ($parts.Count -gt 0) { $parts.RemoveAt($parts.Count - 1) }
    } else {
      $parts.Add($part)
    }
  }
  return ($parts -join '/')
}

function Get-ZipEntryText($zip, [string]$path) {
  $entry = $zip.GetEntry($path)
  if ($null -eq $entry) { return '' }
  $stream = $entry.Open()
  try {
    $reader = [System.IO.StreamReader]::new($stream, [System.Text.Encoding]::UTF8)
    try { return $reader.ReadToEnd() } finally { $reader.Dispose() }
  } finally {
    $stream.Dispose()
  }
}

function Get-OpenXmlRels($zip, [string]$sourcePath) {
  $source = $sourcePath -replace '\\', '/'
  $slash = $source.LastIndexOf('/')
  $dir = if ($slash -ge 0) { $source.Substring(0, $slash) } else { '' }
  $name = if ($slash -ge 0) { $source.Substring($slash + 1) } else { $source }
  $relsPath = if ($dir) { "$dir/_rels/$name.rels" } else { "_rels/$name.rels" }
  $text = Get-ZipEntryText $zip $relsPath
  $rels = @{}
  if (-not $text) { return $rels }
  [xml]$xml = $text
  foreach ($rel in $xml.GetElementsByTagName('Relationship')) {
    $id = [string]$rel.Id
    $target = [string]$rel.Target
    if ($id -and $target) { $rels[$id] = Resolve-OpenXmlTarget $sourcePath $target }
  }
  return $rels
}

function Get-XmlNodesByLocalName($node, [string]$localName) {
  return @($node.GetElementsByTagName('*') | Where-Object { $_.LocalName -eq $localName })
}

function Get-FirstXmlNodeByLocalName($node, [string]$localName) {
  return (Get-XmlNodesByLocalName $node $localName | Select-Object -First 1)
}

function Get-XlsxEmbeddedImageMap([string]$xlsxPath) {
  $map = @{}
  $zip = [System.IO.Compression.ZipFile]::OpenRead($xlsxPath)
  try {
    $workbookText = Get-ZipEntryText $zip 'xl/workbook.xml'
    if (-not $workbookText) { return $map }
    [xml]$workbookXml = $workbookText
    $workbookRels = Get-OpenXmlRels $zip 'xl/workbook.xml'
    foreach ($sheetNode in $workbookXml.GetElementsByTagName('sheet')) {
      $sheetName = [string]$sheetNode.GetAttribute('name')
      $relId = [string]$sheetNode.GetAttribute('id', 'http://schemas.openxmlformats.org/officeDocument/2006/relationships')
      if (-not $sheetName -or -not $workbookRels.ContainsKey($relId)) { continue }
      $sheetPath = [string]$workbookRels[$relId]
      $sheetText = Get-ZipEntryText $zip $sheetPath
      if (-not $sheetText) { continue }
      [xml]$sheetXml = $sheetText
      $drawingNode = Get-FirstXmlNodeByLocalName $sheetXml 'drawing'
      if ($null -eq $drawingNode) { continue }
      $drawingRelId = [string]$drawingNode.GetAttribute('id', 'http://schemas.openxmlformats.org/officeDocument/2006/relationships')
      $sheetRels = Get-OpenXmlRels $zip $sheetPath
      if (-not $sheetRels.ContainsKey($drawingRelId)) { continue }
      $drawingPath = [string]$sheetRels[$drawingRelId]
      $drawingText = Get-ZipEntryText $zip $drawingPath
      if (-not $drawingText) { continue }
      [xml]$drawingXml = $drawingText
      $drawingRels = Get-OpenXmlRels $zip $drawingPath
      $images = @()
      $anchors = @()
      $anchors += @(Get-XmlNodesByLocalName $drawingXml 'twoCellAnchor')
      $anchors += @(Get-XmlNodesByLocalName $drawingXml 'oneCellAnchor')
      foreach ($anchor in $anchors) {
        $from = Get-FirstXmlNodeByLocalName $anchor 'from'
        if ($null -eq $from) { continue }
        $rowNode = Get-FirstXmlNodeByLocalName $from 'row'
        $colNode = Get-FirstXmlNodeByLocalName $from 'col'
        if ($null -eq $rowNode -or $null -eq $colNode) { continue }
        $to = Get-FirstXmlNodeByLocalName $anchor 'to'
        $endRow = [int]$rowNode.InnerText + 1
        $endCol = [int]$colNode.InnerText + 1
        if ($null -ne $to) {
          $toRow = Get-FirstXmlNodeByLocalName $to 'row'
          $toCol = Get-FirstXmlNodeByLocalName $to 'col'
          if ($null -ne $toRow) { $endRow = [int]$toRow.InnerText + 1 }
          if ($null -ne $toCol) { $endCol = [int]$toCol.InnerText + 1 }
        }
        $blip = Get-FirstXmlNodeByLocalName $anchor 'blip'
        if ($null -eq $blip) { continue }
        $embedId = [string]$blip.GetAttribute('embed', 'http://schemas.openxmlformats.org/officeDocument/2006/relationships')
        if (-not $drawingRels.ContainsKey($embedId)) { continue }
        $images += [PSCustomObject]@{
          sheetName = $sheetName
          startRow = [int]$rowNode.InnerText + 1
          endRow = $endRow
          startCol = [int]$colNode.InnerText + 1
          endCol = $endCol
          mediaPath = [string]$drawingRels[$embedId]
        }
      }
      $map[$sheetName] = @($images)
    }
  } finally {
    $zip.Dispose()
  }
  return $map
}

function Copy-XlsxEntryToFile([string]$xlsxPath, [string]$entryPath, [string]$outPath) {
  $zip = [System.IO.Compression.ZipFile]::OpenRead($xlsxPath)
  try {
    $entry = $zip.GetEntry($entryPath)
    if ($null -eq $entry) { return $false }
    $source = $entry.Open()
    try {
      $target = [System.IO.File]::Create($outPath)
      try { $source.CopyTo($target) } finally { $target.Dispose() }
    } finally {
      $source.Dispose()
    }
    return (Test-UsableImageFile $outPath)
  } finally {
    $zip.Dispose()
  }
}

function Find-EmbeddedImageInfo($images, [int]$startRow, [int]$endRow) {
  $best = $null
  $bestScore = -1
  foreach ($image in @($images)) {
    $overlap = [Math]::Min($endRow, [int]$image.endRow) - [Math]::Max($startRow, [int]$image.startRow) + 1
    if ($overlap -le 0) { continue }
    $score = $overlap * 1000
    if ([int]$image.startCol -le 2) { $score += 100000 }
    if ($score -gt $bestScore) {
      $best = $image
      $bestScore = $score
    }
  }
  return $best
}

function Get-OrderQtyMap($payload) {
  $map = @{}
  foreach ($item in @($payload.orderItems)) {
    $code = ([string]$item.code).Trim().ToUpperInvariant()
    if (-not $code) { continue }
    if (-not $map.ContainsKey($code)) { $map[$code] = 0.0 }
    $map[$code] = [double]$map[$code] + (Convert-ToSafeDouble $item.qty)
  }
  return $map
}

function Get-ImagePathForId($index, [string]$imageId, [string]$indexDir) {
  if (-not $imageId) { return '' }
  foreach ($image in @($index.images)) {
    if ([string]$image.id -eq $imageId) { return (Join-Path $indexDir ([string]$image.file)) }
  }
  return ''
}

function Get-ModuleById($index, [string]$moduleId) {
  foreach ($module in @($index.modules)) {
    if ([string]$module.id -eq $moduleId) { return $module }
  }
  return $null
}

function Get-PrintableGroups($index, $payload) {
  $writeMap = Get-WriteMap $payload
  $orderQtyMap = Get-OrderQtyMap $payload
  $indexDir = Get-IndexDir $payload
  $result = @()
  foreach ($group in @($index.groups)) {
    $visible = @()
    foreach ($item in @($group.items)) {
      $qtyKey = "$([string]$item.sheetName)!$([string]$item.qtyCell)".ToUpperInvariant()
      $qty = if ($writeMap.ContainsKey($qtyKey)) { [double]$writeMap[$qtyKey] } else { 0.0 }
      if ($qty -le 0 -and $orderQtyMap.Count -gt 0) {
        foreach ($alias in @($item.aliases)) {
          $aliasKey = ([string]$alias).ToUpperInvariant()
          if ($orderQtyMap.ContainsKey($aliasKey)) { $qty += [double]$orderQtyMap[$aliasKey] }
        }
      }
      if ($qty -le 0) { continue }
      $total = 0.0
      if ($item.totalCell) {
        $totalKey = "$([string]$item.sheetName)!$([string]$item.totalCell)".ToUpperInvariant()
        if ($writeMap.ContainsKey($totalKey)) { $total = [double]$writeMap[$totalKey] }
      }
      if ($total -le 0) { $total = $qty * (Convert-ToSafeDouble $item.piece) }
      $visible += [PSCustomObject]@{
        code = [string]$item.code
        aliases = @($item.aliases)
        color = [string]$item.color
        values = $item.values
        merges = $item.merges
        qty = $qty
        piece = Convert-ToSafeDouble $item.piece
        total = $total
      }
    }
    if ($visible.Count -eq 0) { continue }
    $module = Get-ModuleById $index ([string]$group.moduleId)
    if ($null -eq $module) { continue }
    $result += [PSCustomObject]@{
      module = $module
      group = $group
      items = $visible
      imagePath = Get-ImagePathForId $index ([string]$group.imageId) $indexDir
    }
  }
  return $result
}

function Get-FitFont([System.Drawing.Graphics]$graphics, [string]$text, [string]$fontName, [float]$maxSize, [float]$minSize, [float]$width, [float]$height, [int]$style = 0) {
  $size = $maxSize
  while ($size -gt $minSize) {
    $font = [System.Drawing.Font]::new([string]$fontName, [single]$size, [System.Drawing.FontStyle]$style)
    $measured = $graphics.MeasureString($text, $font, [int][Math]::Max(1, $width))
    if ($measured.Width -le $width + 2 -and $measured.Height -le $height + 2) { return $font }
    $font.Dispose()
    $size -= 0.8
  }
  return [System.Drawing.Font]::new([string]$fontName, [single]$minSize, [System.Drawing.FontStyle]$style)
}

function Get-FitSingleLineFont([System.Drawing.Graphics]$graphics, [string]$text, [string]$fontName, [float]$maxSize, [float]$minSize, [float]$width, [int]$style = 0) {
  $size = $maxSize
  while ($size -gt $minSize) {
    $font = [System.Drawing.Font]::new([string]$fontName, [single]$size, [System.Drawing.FontStyle]$style)
    $measured = $graphics.MeasureString($text, $font)
    if ($measured.Width -le $width + 2) { return $font }
    $font.Dispose()
    $size -= 0.8
  }
  return [System.Drawing.Font]::new([string]$fontName, [single]$minSize, [System.Drawing.FontStyle]$style)
}

function Draw-CenteredText($graphics, [string]$text, [System.Drawing.RectangleF]$rect, [float]$maxSize = 12, [float]$minSize = 6, [bool]$bold = $false, $brush = $null) {
  if ($null -eq $brush) { $brush = [System.Drawing.Brushes]::Black }
  $style = if ($bold) { [System.Drawing.FontStyle]::Bold } else { [System.Drawing.FontStyle]::Regular }
  $font = Get-FitFont $graphics $text 'Arial' $maxSize $minSize $rect.Width $rect.Height $style
  try {
    $format = New-Object System.Drawing.StringFormat
    $format.Alignment = [System.Drawing.StringAlignment]::Center
    $format.LineAlignment = [System.Drawing.StringAlignment]::Center
    $format.Trimming = [System.Drawing.StringTrimming]::None
    $graphics.DrawString($text, $font, $brush, $rect, $format)
  } finally {
    $font.Dispose()
  }
}

function Draw-CenteredSingleLineText($graphics, [string]$text, [System.Drawing.RectangleF]$rect, [float]$maxSize = 12, [float]$minSize = 3.0, [bool]$bold = $false, $brush = $null) {
  if ($null -eq $brush) { $brush = [System.Drawing.Brushes]::Black }
  $style = if ($bold) { [System.Drawing.FontStyle]::Bold } else { [System.Drawing.FontStyle]::Regular }
  $font = Get-FitSingleLineFont $graphics $text 'Arial' $maxSize $minSize $rect.Width $style
  try {
    $format = New-Object System.Drawing.StringFormat
    $format.Alignment = [System.Drawing.StringAlignment]::Center
    $format.LineAlignment = [System.Drawing.StringAlignment]::Center
    $format.Trimming = [System.Drawing.StringTrimming]::None
    $format.FormatFlags = [System.Drawing.StringFormatFlags]::NoWrap
    $graphics.DrawString($text, $font, $brush, $rect, $format)
  } finally {
    $font.Dispose()
  }
}

function Get-DisplayTextLines([string]$text) {
  $value = Normalize-PdfCellText $text
  if (-not $value) { return @('') }
  if ($value.Contains("`n")) {
    return @($value -split "`n" | ForEach-Object { ([string]$_).Trim() })
  }
  $flat = ($value -replace '\s+', ' ').Trim()
  if ($flat -match '^(.*?MM)(.+)$') {
    $left = ([string]$Matches[1]).Trim()
    $right = ([string]$Matches[2]).Trim()
    if ($left -and $right) { return @($left, $right) }
  }
  return @($flat)
}

function Draw-CenteredTextLines($graphics, [string[]]$lines, [System.Drawing.RectangleF]$rect, [float]$maxSize = 12, [float]$minSize = 3.0, [bool]$bold = $false, $brush = $null) {
  if ($null -eq $brush) { $brush = [System.Drawing.Brushes]::Black }
  $cleanLines = @($lines | ForEach-Object { ([string]$_).Trim() } | Where-Object { $_ -ne '' })
  if ($cleanLines.Count -eq 0) { $cleanLines = @('') }
  $lineHeight = [float]($rect.Height / [Math]::Max(1, $cleanLines.Count))
  for ($i = 0; $i -lt $cleanLines.Count; $i++) {
    $lineRect = [System.Drawing.RectangleF]::new($rect.X, $rect.Y + ($i * $lineHeight), $rect.Width, $lineHeight)
    Draw-CenteredSingleLineText $graphics ([string]$cleanLines[$i]) $lineRect $maxSize $minSize $bold $brush
  }
}

function Get-ValueFromMap($map, [string]$key) {
  if ($null -eq $map -or -not $key) { return '' }
  if ($map -is [System.Collections.IDictionary]) {
    if ($map.Contains($key)) { return [string]$map[$key] }
    return ''
  }
  $property = $map.PSObject.Properties[$key]
  if ($null -ne $property) { return [string]$property.Value }
  return ''
}

function Get-PrintableCellValue($item, [string]$key) {
  switch ($key) {
    'Code' { return [string]$item.code }
    'Qty' { return [string]([int][Math]::Round([double]$item.qty)) }
    'Piece' { return [string]([int][Math]::Round([double]$item.piece)) }
    'Total' { return [string]([int][Math]::Round([double]$item.total)) }
    default {
      $value = Get-ValueFromMap $item.values $key
      if (-not $value -and $key -eq 'Color') {
        $value = [string]$item.color
      }
      return [string]$value
    }
  }
}

function Draw-BodyCellText($graphics, [string]$key, [string]$value, [System.Drawing.RectangleF]$rect, [bool]$bold = $false, [bool]$allowSingleLine = $true) {
  $lines = Get-DisplayTextLines $value
  Draw-CenteredTextLines $graphics $lines $rect 11 3.0 ($bold -or $key -eq 'Code')
}

function Get-ColumnRects($columns, [float]$x, [float]$y, [float]$width, [float]$height) {
  $sum = 0.0
  foreach ($column in @($columns)) { $sum += [Math]::Max(0.1, [double]$column.width) }
  if ($sum -le 0) { $sum = 1.0 }
  $cursor = $x
  $rects = @{}
  foreach ($column in @($columns)) {
    $w = $width * ([Math]::Max(0.1, [double]$column.width) / $sum)
    $rects[[string]$column.key] = [System.Drawing.RectangleF]::new($cursor, $y, $w, $height)
    $cursor += $w
  }
  return $rects
}

function Draw-ImageFit($graphics, [string]$path, [System.Drawing.RectangleF]$rect) {
  if (-not $path -or -not (Test-Path -LiteralPath $path)) { return }
  $img = [System.Drawing.Image]::FromFile($path)
  try {
    $scale = [Math]::Min($rect.Width / $img.Width, $rect.Height / $img.Height)
    $w = [float]($img.Width * $scale)
    $h = [float]($img.Height * $scale)
    $dx = [float]($rect.X + (($rect.Width - $w) / 2))
    $dy = [float]($rect.Y + (($rect.Height - $h) / 2))
    $graphics.DrawImage($img, $dx, $dy, $w, $h)
  } finally {
    $img.Dispose()
  }
}

function Draw-Group($graphics, $printGroup, [float]$pageWidth, [float]$top, [float]$groupHeight) {
  $columns = @($printGroup.module.columns)
  $headerHeight = 28.0
  $items = @($printGroup.items)
  $showTotalRow = ($items.Count -gt 1)
  $contentRows = $items.Count + $(if ($showTotalRow) { 1 } else { 0 })
  $detailHeight = ($groupHeight - $headerHeight) / [Math]::Max(1, $contentRows)
  $rects = Get-ColumnRects $columns 0 $top $pageWidth $groupHeight
  $green = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(0, 121, 95))
  $white = [System.Drawing.Brushes]::White
  $linePen = New-Object System.Drawing.Pen([System.Drawing.Color]::Black, 1)
  $cream = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(255, 242, 204))
  try {
    foreach ($column in $columns) {
      $key = [string]$column.key
      $rect = $rects[$key]
      $headerRect = [System.Drawing.RectangleF]::new($rect.X, $top, $rect.Width, $headerHeight)
      $graphics.FillRectangle($green, $headerRect)
      $graphics.DrawRectangle($linePen, $headerRect.X, $headerRect.Y, $headerRect.Width, $headerRect.Height)
      Draw-CenteredText $graphics ([string]$column.header) $headerRect 11 6 $true $white
      $bodyRect = [System.Drawing.RectangleF]::new($rect.X, $top + $headerHeight, $rect.Width, $groupHeight - $headerHeight)
      if ($key -eq 'Total') { $graphics.FillRectangle($cream, $bodyRect) }
      $graphics.DrawRectangle($linePen, $bodyRect.X, $bodyRect.Y, $bodyRect.Width, $bodyRect.Height)
    }

    if ($rects.ContainsKey('Image')) {
      $imageBody = $rects['Image']
      $segmentText = ''
      foreach ($item in $items) {
        $segmentText = Get-ValueFromMap $item.values 'Image'
        if ($segmentText) {
          break
        }
      }
      $imageTop = $top + $headerHeight
      $imageHeight = $groupHeight - $headerHeight
      if ($segmentText) {
        $segmentHeight = [Math]::Min(28.0, $imageHeight * 0.35)
        $segmentRect = [System.Drawing.RectangleF]::new($imageBody.X, $imageTop, $imageBody.Width, $segmentHeight)
        $graphics.DrawRectangle($linePen, $segmentRect.X, $segmentRect.Y, $segmentRect.Width, $segmentRect.Height)
        Draw-CenteredText $graphics $segmentText $segmentRect 12 7 $true
        $imageTop += $segmentHeight
        $imageHeight -= $segmentHeight
      }
      $imageBody = [System.Drawing.RectangleF]::new($imageBody.X + 2, $imageTop + 2, $imageBody.Width - 4, $imageHeight - 4)
      Draw-ImageFit $graphics ([string]$printGroup.imagePath) $imageBody
    }

    $skipCells = @{}
    $mergedCells = @()
    foreach ($column in $columns) {
      $key = [string]$column.key
      if ($key -in @('Image','Code','Qty','Piece','Total')) { continue }
      if (-not $rects.ContainsKey($key)) { continue }
      $i = 0
      while ($i -lt $items.Count) {
        $mergeId = Get-ValueFromMap $items[$i].merges $key
        if (-not $mergeId) {
          $i++
          continue
        }
        $startIndex = $i
        $endIndex = $i
        while (($endIndex + 1) -lt $items.Count) {
          $nextMergeId = Get-ValueFromMap $items[$endIndex + 1].merges $key
          if ($nextMergeId -ne $mergeId) { break }
          $endIndex++
        }
        if ($endIndex -gt $startIndex) {
          $cell = $rects[$key]
          $mergeTop = $top + $headerHeight + ($startIndex * $detailHeight)
          $mergeHeight = ($endIndex - $startIndex + 1) * $detailHeight
          $mergeRect = [System.Drawing.RectangleF]::new($cell.X, $mergeTop, $cell.Width, $mergeHeight)
          $mergedCells += [PSCustomObject]@{
            key = $key
            rect = $mergeRect
            value = Get-PrintableCellValue $items[$startIndex] $key
          }
          for ($j = $startIndex; $j -le $endIndex; $j++) {
            $skipCells["$key|$j"] = $true
          }
        }
        $i = $endIndex + 1
      }
    }

    for ($i = 0; $i -lt $items.Count; $i++) {
      $rowTop = $top + $headerHeight + ($i * $detailHeight)
      foreach ($column in $columns) {
        $key = [string]$column.key
        if ($key -eq 'Image') { continue }
        if ($skipCells.ContainsKey("$key|$i")) { continue }
        $cell = $rects[$key]
        $rowRect = [System.Drawing.RectangleF]::new($cell.X, $rowTop, $cell.Width, $detailHeight)
        if ($key -eq 'Total') { $graphics.FillRectangle($cream, $rowRect) }
        $graphics.DrawRectangle($linePen, $rowRect.X, $rowRect.Y, $rowRect.Width, $rowRect.Height)
        $value = Get-PrintableCellValue $items[$i] $key
        Draw-BodyCellText $graphics $key $value $rowRect ($key -eq 'Total') $true
      }
    }

    foreach ($mergedCell in $mergedCells) {
      $mergeRect = $mergedCell.rect
      $graphics.FillRectangle([System.Drawing.Brushes]::White, $mergeRect)
      $graphics.DrawRectangle($linePen, $mergeRect.X, $mergeRect.Y, $mergeRect.Width, $mergeRect.Height)
      Draw-BodyCellText $graphics ([string]$mergedCell.key) ([string]$mergedCell.value) $mergeRect $false $true
    }

    if ($showTotalRow) {
      $totalTop = $top + $headerHeight + ($items.Count * $detailHeight)
      $sumTotal = 0.0
      foreach ($item in $items) { $sumTotal += [double]$item.total }
      $totalRect = $null
      if ($rects.ContainsKey('Total')) {
        $totalRect = $rects['Total']
      }
      $labelCells = @()
      foreach ($column in $columns) {
        $key = [string]$column.key
        if ($key -in @('Image','Total')) { continue }
        $cell = $rects[$key]
        if (($null -eq $totalRect) -or (($cell.X + ($cell.Width / 2.0)) -lt $totalRect.X)) {
          $labelCells += $cell
        }
      }
      $labelRect = $null
      if ($labelCells.Count -gt 0) {
        $labelX = ($labelCells | Measure-Object -Property X -Minimum).Minimum
        $labelRight = ($labelCells | ForEach-Object { $_.X + $_.Width } | Measure-Object -Maximum).Maximum
        $labelRect = [System.Drawing.RectangleF]::new([float]$labelX, [float]$totalTop, [float]($labelRight - $labelX), [float]$detailHeight)
        $graphics.FillRectangle([System.Drawing.Brushes]::White, $labelRect)
        $graphics.DrawRectangle($linePen, $labelRect.X, $labelRect.Y, $labelRect.Width, $labelRect.Height)
        Draw-CenteredText $graphics 'TỔNG CỘNG' $labelRect 12 7 $true
      }
      foreach ($column in $columns) {
        $key = [string]$column.key
        if ($key -eq 'Image') { continue }
        $cell = $rects[$key]
        if (($null -ne $labelRect) -and ($key -ne 'Total') -and ($cell.X -ge ($labelRect.X - 0.1)) -and (($cell.X + $cell.Width) -le ($labelRect.X + $labelRect.Width + 0.1))) {
          continue
        }
        $rowRect = [System.Drawing.RectangleF]::new($cell.X, $totalTop, $cell.Width, $detailHeight)
        if ($key -eq 'Total') {
          $graphics.FillRectangle($cream, $rowRect)
          $graphics.DrawRectangle($linePen, $rowRect.X, $rowRect.Y, $rowRect.Width, $rowRect.Height)
          Draw-CenteredText $graphics ([string]([int][Math]::Round($sumTotal))) $rowRect 12 7 $true
        } else {
          $graphics.DrawRectangle($linePen, $rowRect.X, $rowRect.Y, $rowRect.Width, $rowRect.Height)
        }
      }
    }
  } finally {
    $green.Dispose()
    $linePen.Dispose()
    $cream.Dispose()
  }
}

function Save-JpegPage($groups, [string]$path) {
  $width = 1240
  $height = 1754
  $bitmap = New-Object System.Drawing.Bitmap $width, $height
  try {
    $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
    try {
      $graphics.Clear([System.Drawing.Color]::White)
      $graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
      $graphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
      $scaleX = $width / 595.0
      $scaleY = $height / 842.0
      $graphics.ScaleTransform($scaleX, $scaleY)
      for ($i = 0; $i -lt $groups.Count; $i++) {
        Draw-Group $graphics $groups[$i] 595.0 ([float]($i * 140.3)) 140.3
      }
    } finally {
      $graphics.Dispose()
    }
    $bitmap.Save($path, [System.Drawing.Imaging.ImageFormat]::Jpeg)
  } finally {
    $bitmap.Dispose()
  }
}

function Write-Ascii($stream, [string]$text) {
  $bytes = [System.Text.Encoding]::ASCII.GetBytes($text)
  $stream.Write($bytes, 0, $bytes.Length)
}

function New-PdfFromJpegs($jpegPaths, [string]$pdfPath) {
  $stream = [System.IO.File]::Create($pdfPath)
  $offsets = @{}
  try {
    Write-Ascii $stream "%PDF-1.4`n%`xE2`xE3`xCF`xD3`n"
    $objectId = 1
    $catalogId = $objectId; $objectId++
    $pagesId = $objectId; $objectId++
    $pageIds = @()
    $imageIds = @()
    $contentIds = @()
    foreach ($jpg in $jpegPaths) {
      $pageIds += $objectId; $objectId++
      $imageIds += $objectId; $objectId++
      $contentIds += $objectId; $objectId++
    }
    function Write-Obj($stream, $offsets, [int]$id, [string]$body) {
      $offsets[$id] = [int64]$stream.Position
      Write-Ascii $stream "$id 0 obj`n$body`nendobj`n"
    }
    Write-Obj $stream $offsets $catalogId "<< /Type /Catalog /Pages $pagesId 0 R >>"
    $kids = ($pageIds | ForEach-Object { "$_ 0 R" }) -join ' '
    Write-Obj $stream $offsets $pagesId "<< /Type /Pages /Kids [ $kids ] /Count $($pageIds.Count) >>"
    for ($i = 0; $i -lt $jpegPaths.Count; $i++) {
      $jpgBytes = [System.IO.File]::ReadAllBytes($jpegPaths[$i])
      $img = [System.Drawing.Image]::FromFile($jpegPaths[$i])
      try {
        $imageId = $imageIds[$i]
        $offsets[$imageId] = [int64]$stream.Position
        Write-Ascii $stream "$imageId 0 obj`n<< /Type /XObject /Subtype /Image /Width $($img.Width) /Height $($img.Height) /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length $($jpgBytes.Length) >>`nstream`n"
        $stream.Write($jpgBytes, 0, $jpgBytes.Length)
        Write-Ascii $stream "`nendstream`nendobj`n"
      } finally {
        $img.Dispose()
      }
      $content = "q`n595 0 0 842 0 0 cm`n/Im$i Do`nQ`n"
      $contentBytes = [System.Text.Encoding]::ASCII.GetBytes($content)
      $contentId = $contentIds[$i]
      $offsets[$contentId] = [int64]$stream.Position
      Write-Ascii $stream "$contentId 0 obj`n<< /Length $($contentBytes.Length) >>`nstream`n"
      $stream.Write($contentBytes, 0, $contentBytes.Length)
      Write-Ascii $stream "endstream`nendobj`n"
      $pageBody = "<< /Type /Page /Parent $pagesId 0 R /MediaBox [0 0 595 842] /Resources << /XObject << /Im$i $($imageIds[$i]) 0 R >> >> /Contents $($contentIds[$i]) 0 R >>"
      Write-Obj $stream $offsets $pageIds[$i] $pageBody
    }
    $xrefStart = $stream.Position
    Write-Ascii $stream "xref`n0 $objectId`n0000000000 65535 f `n"
    for ($id = 1; $id -lt $objectId; $id++) {
      $offset = if ($offsets.ContainsKey($id)) { [int64]$offsets[$id] } else { 0 }
      Write-Ascii $stream ("{0:0000000000} 00000 n `n" -f $offset)
    }
    Write-Ascii $stream "trailer`n<< /Size $objectId /Root $catalogId 0 R >>`nstartxref`n$xrefStart`n%%EOF"
  } finally {
    $stream.Dispose()
  }
}

function New-CuttingPdf($payload) {
  Start-Timer
  $root = New-TempDir
  $pdfPath = Join-Path $root 'cutting_output.pdf'
  Add-Log 'prepare_files' "root=$root"
  $templatePayloads = @()
  if ($payload.templates) { foreach ($item in @($payload.templates)) { $templatePayloads += $item } } else { $templatePayloads += $payload }
  if ($templatePayloads.Count -eq 0) { throw '沒有可產生 PDF 的模板資料。' }
  $printGroups = @()
  $templateIndex = 0
  foreach ($templatePayload in $templatePayloads) {
    $templateIndex++
    if (-not $templatePayload.templateBase64 -or -not $templatePayload.writes) { throw "BAD_TEMPLATE_PAYLOAD: index=$templateIndex" }
    $templatePath = Join-Path $root "template_${templateIndex}.xlsx"
    [System.IO.File]::WriteAllBytes($templatePath, [Convert]::FromBase64String([string]$templatePayload.templateBase64))
    $index = Get-OrBuildTemplateIndex $templatePayload $templatePath
    $groups = @(Get-PrintableGroups $index $templatePayload)
    Add-Log 'select_groups' "index=$templateIndex groups=$($groups.Count)"
    $printGroups += $groups
  }
  if ($printGroups.Count -eq 0) { throw '沒有符合列印條件的款號資料。' }
  $pageImages = @()
  for ($i = 0; $i -lt $printGroups.Count; $i += 6) {
    $take = [Math]::Min(6, $printGroups.Count - $i)
    $pageGroups = @($printGroups[$i..($i + $take - 1)])
    $jpgPath = Join-Path $root ("page_{0}.jpg" -f (($i / 6) + 1))
    Save-JpegPage $pageGroups $jpgPath
    $pageImages += $jpgPath
    Add-Log 'render_page' "page=$($pageImages.Count) groups=$take"
  }
  New-PdfFromJpegs $pageImages $pdfPath
  Add-Log 'export_pdf' "pages=$($pageImages.Count)"
  return $pdfPath
}

Start-Timer
Remove-OldCuttingTempDirs 24
$listener = [System.Net.HttpListener]::new()
$listener.Prefixes.Add($script:Prefix)
$listener.Start()
Write-Host "Da khoi dong cong cu PDF / 已啟動 PDF 工具: $script:Prefix"
Write-Host "Nhan Ctrl+C de dung / 按 Ctrl+C 停止"

while ($listener.IsListening) {
  $context = $listener.GetContext()
  $request = $context.Request
  $response = $context.Response
  $pdfPath = ''
  try {
    Set-Stage 'receive_request' $request.Url.AbsolutePath
    if ($request.HttpMethod -eq 'OPTIONS') { Send-Text $response 204 ''; continue }
    if ($request.Url.AbsolutePath -eq '/health') { Send-Text $response 200 '{"ok":true,"service":"cutting-pdf-local"}'; continue }
    if ($request.Url.AbsolutePath -ne '/cutting/pdf' -or $request.HttpMethod -ne 'POST') { Send-Text $response 404 '{"ok":false,"error":"NOT_FOUND"}'; continue }
    $reader = [System.IO.StreamReader]::new($request.InputStream, [System.Text.Encoding]::UTF8)
    try { $body = $reader.ReadToEnd() } finally { $reader.Dispose() }
    $payload = $body | ConvertFrom-Json
    if ((-not $payload.templates) -and (-not $payload.templateBase64 -or -not $payload.writes)) { Send-Text $response 400 '{"ok":false,"error":"BAD_REQUEST"}'; continue }
    $pdfPath = New-CuttingPdf $payload
    $name = if ($payload.outputName) { [string]$payload.outputName } else { 'cutting.pdf' }
    Send-File $response $pdfPath $name
  } catch {
    $message = ($_.Exception.Message -replace "`r?`n", ' ')
    Send-Json $response 500 @{ ok = $false; error = $message; stage = $script:Stage; detail = $script:Detail }
  } finally {
    Remove-CuttingTempDir $script:CurrentTempDir
    $script:CurrentTempDir = ''
  }
}
