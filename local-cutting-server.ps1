param(
  [int]$Port = 8765
)

$ErrorActionPreference = 'Stop'
$script:IndexVersion = 2
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

function Get-TemplateColumns($sheet, [int]$headerRow, $cols) {
  $items = @(
    @{ Key = 'Image'; Col = 1; Header = (Get-CellText $sheet $headerRow 1) },
    @{ Key = 'Belt'; Col = $cols.Belt; Header = 'QUY CACH' },
    @{ Key = 'Code'; Col = $cols.Code; Header = 'MA HANG' },
    @{ Key = 'Color'; Col = $cols.Color; Header = 'MAU' },
    @{ Key = 'Segment'; Col = $cols.Segment; Header = 'CONG DOAN' },
    @{ Key = 'CutSpec'; Col = $cols.CutSpec; Header = 'QUY CACH' },
    @{ Key = 'Qty'; Col = $cols.Qty; Header = 'SL:PO PCS' },
    @{ Key = 'Piece'; Col = $cols.Piece; Header = 'SO KIEN' },
    @{ Key = 'Total'; Col = $cols.Total; Header = 'SL:CAT THUC TE' },
    @{ Key = 'Note'; Col = $cols.Note; Header = 'GHI CHU' }
  )
  $result = @()
  $seen = @{}
  foreach ($item in ($items | Sort-Object { [int]$_.Col })) {
    $col = [int]$item.Col
    if ($col -le 0 -or $seen.ContainsKey([string]$item.Key)) { continue }
    $header = (Get-CellText $sheet $headerRow $col).Trim()
    if (-not $header) { $header = [string]$item.Header }
    $result += [PSCustomObject]@{
      key = [string]$item.Key
      sourceCol = $col
      header = $header
      width = [double](Get-ColumnWidth $sheet $col)
    }
    $seen[[string]$item.Key] = $true
  }
  return @($result)
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
        $columns = @(Get-TemplateColumns $sheet $firstGroup.Start $cols)
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
          $shape = Find-GroupImageShape $sheet $group.Start $group.End
          if ($null -ne $shape) {
            $tempImage = Join-Path $imageDir "tmp_${s}_${groupNo}.png"
            try {
              if (Export-ShapeImage $shape $sheet $tempImage) {
                $hash = Get-ImageHash $tempImage
                if ($hash) {
                  if ($images.ContainsKey($hash)) {
                    $imageId = [string]$images[$hash].id
                    Remove-Item -LiteralPath $tempImage -Force -ErrorAction SilentlyContinue
                  } else {
                    $imageNo++
                    $imageId = "image_$imageNo"
                    $imagePath = Join-Path $imageDir "$imageId.png"
                    Move-Item -LiteralPath $tempImage -Destination $imagePath -Force
                    $images[$hash] = [PSCustomObject]@{ id = $imageId; hash = $hash; file = "images/$imageId.png" }
                  }
                }
              }
            } finally {
              Release-Com $shape
            }
          }

          $groupItems = @()
          for ($row = $group.Start + 1; $row -le $group.End; $row++) {
            $code = (Get-CellText $sheet $row $cols.Code).Trim()
            if (-not (Is-ItemCode $code)) { continue }
            $piece = Get-CellNumber $sheet $row $cols.Piece
            $color = if ($cols.Color -gt 0) { (Get-MergedCellText $sheet $row $cols.Color).Trim() } else { '' }
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
    $font = New-Object System.Drawing.Font($fontName, $size, $style)
    $measured = $graphics.MeasureString($text, $font, [int][Math]::Max(1, $width))
    if ($measured.Width -le $width + 2 -and $measured.Height -le $height + 2) { return $font }
    $font.Dispose()
    $size -= 0.8
  }
  return New-Object System.Drawing.Font($fontName, $minSize, $style)
}

function Draw-CenteredText($graphics, [string]$text, [System.Drawing.RectangleF]$rect, [float]$maxSize = 12, [float]$minSize = 6, [bool]$bold = $false, $brush = $null) {
  if ($null -eq $brush) { $brush = [System.Drawing.Brushes]::Black }
  $style = if ($bold) { [System.Drawing.FontStyle]::Bold } else { [System.Drawing.FontStyle]::Regular }
  $font = Get-FitFont $graphics $text 'Arial' $maxSize $minSize $rect.Width $rect.Height $style
  try {
    $format = New-Object System.Drawing.StringFormat
    $format.Alignment = [System.Drawing.StringAlignment]::Center
    $format.LineAlignment = [System.Drawing.StringAlignment]::Center
    $format.Trimming = [System.Drawing.StringTrimming]::EllipsisCharacter
    $graphics.DrawString($text, $font, $brush, $rect, $format)
  } finally {
    $font.Dispose()
  }
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
      $imageBody = [System.Drawing.RectangleF]::new($imageBody.X + 2, $top + $headerHeight + 2, $imageBody.Width - 4, $groupHeight - $headerHeight - 4)
      Draw-ImageFit $graphics ([string]$printGroup.imagePath) $imageBody
    }

    for ($i = 0; $i -lt $items.Count; $i++) {
      $rowTop = $top + $headerHeight + ($i * $detailHeight)
      foreach ($column in $columns) {
        $key = [string]$column.key
        if ($key -eq 'Image') { continue }
        $cell = $rects[$key]
        $rowRect = [System.Drawing.RectangleF]::new($cell.X, $rowTop, $cell.Width, $detailHeight)
        if ($key -eq 'Total') { $graphics.FillRectangle($cream, $rowRect) }
        $graphics.DrawRectangle($linePen, $rowRect.X, $rowRect.Y, $rowRect.Width, $rowRect.Height)
        $value = ''
        switch ($key) {
          'Code' { $value = [string]$items[$i].code }
          'Color' { $value = [string]$items[$i].color }
          'Qty' { $value = [string]([int][Math]::Round([double]$items[$i].qty)) }
          'Piece' { $value = [string]([int][Math]::Round([double]$items[$i].piece)) }
          'Total' { $value = [string]([int][Math]::Round([double]$items[$i].total)) }
          default { $value = '' }
        }
        Draw-CenteredText $graphics $value $rowRect 11 6 ($key -eq 'Total')
      }
    }

    if ($showTotalRow) {
      $totalTop = $top + $headerHeight + ($items.Count * $detailHeight)
      $sumTotal = 0.0
      foreach ($item in $items) { $sumTotal += [double]$item.total }
      foreach ($column in $columns) {
        $key = [string]$column.key
        if ($key -eq 'Image') { continue }
        $cell = $rects[$key]
        $rowRect = [System.Drawing.RectangleF]::new($cell.X, $totalTop, $cell.Width, $detailHeight)
        if ($key -eq 'Total') { $graphics.FillRectangle($cream, $rowRect) }
        $graphics.DrawRectangle($linePen, $rowRect.X, $rowRect.Y, $rowRect.Width, $rowRect.Height)
        $value = ''
        if ($key -eq 'Code') { $value = 'TỔNG CỘNG' }
        if ($key -eq 'Total') { $value = [string]([int][Math]::Round($sumTotal)) }
        Draw-CenteredText $graphics $value $rowRect 12 7 $true
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
  $offsets = New-Object System.Collections.Generic.List[int64]
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
      $offsets.Add($stream.Position)
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
        $offsets.Add($stream.Position)
        Write-Ascii $stream "$imageId 0 obj`n<< /Type /XObject /Subtype /Image /Width $($img.Width) /Height $($img.Height) /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length $($jpgBytes.Length) >>`nstream`n"
        $stream.Write($jpgBytes, 0, $jpgBytes.Length)
        Write-Ascii $stream "`nendstream`nendobj`n"
      } finally {
        $img.Dispose()
      }
      $content = "q`n595 0 0 842 0 0 cm`n/Im$i Do`nQ`n"
      $contentBytes = [System.Text.Encoding]::ASCII.GetBytes($content)
      $contentId = $contentIds[$i]
      $offsets.Add($stream.Position)
      Write-Ascii $stream "$contentId 0 obj`n<< /Length $($contentBytes.Length) >>`nstream`n"
      $stream.Write($contentBytes, 0, $contentBytes.Length)
      Write-Ascii $stream "endstream`nendobj`n"
      $pageBody = "<< /Type /Page /Parent $pagesId 0 R /MediaBox [0 0 595 842] /Resources << /XObject << /Im$i $($imageIds[$i]) 0 R >> >> /Contents $($contentIds[$i]) 0 R >>"
      Write-Obj $stream $offsets $pageIds[$i] $pageBody
    }
    $xrefStart = $stream.Position
    Write-Ascii $stream "xref`n0 $objectId`n0000000000 65535 f `n"
    foreach ($offset in $offsets) { Write-Ascii $stream ("{0:0000000000} 00000 n `n" -f $offset) }
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
