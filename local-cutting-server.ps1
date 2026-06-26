param(
  [int]$Port = 8765
)

$ErrorActionPreference = 'Stop'
$prefix = "http://127.0.0.1:$Port/"
$listener = [System.Net.HttpListener]::new()
$listener.Prefixes.Add($prefix)

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
  $json = $data | ConvertTo-Json -Compress -Depth 6
  Send-Text $response $statusCode $json
}

$script:CuttingStage = ''
$script:CuttingDetail = ''
$script:CuttingTimer = $null
$script:CuttingLastMs = 0
$script:CuttingLogs = New-Object System.Collections.Generic.List[string]
$script:CuttingCacheVersion = 4

function Set-CuttingStage([string]$stage, [string]$detail = '') {
  $script:CuttingStage = $stage
  $script:CuttingDetail = $detail
}

function Start-CuttingTimer() {
  $script:CuttingTimer = [System.Diagnostics.Stopwatch]::StartNew()
  $script:CuttingLastMs = 0
  $script:CuttingLogs = New-Object System.Collections.Generic.List[string]
}

function Add-CuttingLog([string]$name, [string]$detail = '') {
  if ($null -eq $script:CuttingTimer) { Start-CuttingTimer }
  $total = [int]$script:CuttingTimer.ElapsedMilliseconds
  $lap = $total - $script:CuttingLastMs
  $script:CuttingLastMs = $total
  $line = "$name total=${total}ms lap=${lap}ms"
  if ($detail) { $line = "$line $detail" }
  $script:CuttingLogs.Add($line)
  Write-Host "[cutting-time] $line"
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
  if ($script:CuttingLogs -and $script:CuttingLogs.Count -gt 0) {
    $timing = ($script:CuttingLogs -join ' | ')
    if ($timing.Length -gt 3500) { $timing = $timing.Substring(0, 3500) }
    $response.Headers.Add('X-Cutting-Timing', $timing)
  }
  $response.OutputStream.Write($bytes, 0, $bytes.Length)
  $response.Close()
}

function Release-Com($object) {
  if ($null -ne $object) {
    [void][System.Runtime.InteropServices.Marshal]::ReleaseComObject($object)
  }
}

function Safe-ToText($value) {
  if ($null -eq $value) { return '' }
  try {
    if ($value -is [System.Array]) { return '' }
    return [string]$value
  } catch {
    throw "TEXT_CONVERT_FAILED: $($_.Exception.Message)"
  }
}

function Safe-FileName([string]$text) {
  $name = if ($text) { $text } else { 'template' }
  return ($name -replace '[\\/:*?"<>|]', '_')
}

function Get-CacheKey($payload) {
  $raw = if ($payload.templateId) { [string]$payload.templateId } elseif ($payload.fileName) { [string]$payload.fileName } else { 'template' }
  return Safe-FileName $raw
}

function Get-CacheDir($payload) {
  $root = Join-Path $PSScriptRoot 'cutting-cache'
  if (-not (Test-Path -LiteralPath $root)) { New-Item -ItemType Directory -Path $root | Out-Null }
  $dir = Join-Path $root (Get-CacheKey $payload)
  if (-not (Test-Path -LiteralPath $dir)) { New-Item -ItemType Directory -Path $dir | Out-Null }
  return $dir
}

function Get-CacheJsonPath($payload) {
  return (Join-Path (Get-CacheDir $payload) 'template-cache.json')
}

function Test-CuttingImageFile([string]$path) {
  if (-not $path -or -not (Test-Path -LiteralPath $path)) { return $false }
  try {
    return ((Get-Item -LiteralPath $path).Length -ge 1024)
  } catch {
    return $false
  }
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

function Load-TemplateCache($payload) {
  $path = Get-CacheJsonPath $payload
  if (-not (Test-Path -LiteralPath $path)) { return $null }
  try {
    $cache = Get-Content -LiteralPath $path -Raw -Encoding UTF8 | ConvertFrom-Json
    if ([int]$cache.version -ne $script:CuttingCacheVersion) { return $null }
    if ([string]$cache.templateUpdatedAt -ne [string]$payload.templateUpdatedAt) { return $null }
    if ([string]$cache.fileName -ne [string]$payload.fileName) { return $null }
    if ([string]$cache.templateFileSize -ne [string]$payload.templateFileSize) { return $null }
    $cacheDir = Get-CacheDir $payload
    foreach ($group in $cache.groups) {
      if ($group.imageFile) {
        $imagePath = Join-Path $cacheDir ([string]$group.imageFile)
        if (-not (Test-CuttingImageFile $imagePath)) { return $null }
        $group | Add-Member -NotePropertyName imagePath -NotePropertyValue $imagePath -Force
      }
    }
    return $cache
  } catch {
    return $null
  }
}

function Save-TemplateCache($payload, $groups) {
  $cacheDir = Get-CacheDir $payload
  $path = Get-CacheJsonPath $payload
  $cache = [PSCustomObject]@{
    version = $script:CuttingCacheVersion
    templateId = [string]$payload.templateId
    templateUpdatedAt = [string]$payload.templateUpdatedAt
    templateFileSize = [string]$payload.templateFileSize
    fileName = [string]$payload.fileName
    createdAt = (Get-Date).ToString('s')
    groups = $groups
  }
  $json = $cache | ConvertTo-Json -Depth 20
  [System.IO.File]::WriteAllText($path, $json, [System.Text.Encoding]::UTF8)
  return $cache
}

function Normalize-HeaderText([string]$text) {
  $formD = $text.Normalize([Text.NormalizationForm]::FormD)
  $chars = New-Object System.Text.StringBuilder
  foreach ($ch in $formD.ToCharArray()) {
    $category = [Globalization.CharUnicodeInfo]::GetUnicodeCategory($ch)
    if ($category -ne [Globalization.UnicodeCategory]::NonSpacingMark) {
      [void]$chars.Append($ch)
    }
  }
  return (($chars.ToString() -replace 'Đ', 'D' -replace 'đ', 'd').ToUpperInvariant() -replace '\s+', '')
}

function Is-GroupHeaderRow($sheet, [int]$row, [int]$firstCol, [int]$lastCol) {
  $texts = @()
  $greenCount = 0
  $checked = 0
  for ($col = $firstCol; $col -le $lastCol; $col++) {
    $cell = $sheet.Cells.Item($row, $col)
    $value = [string]$cell.Text
    if ($value) { $texts += $value }
    try {
      $color = [int]$cell.Interior.Color
      $r = $color -band 255
      $g = ($color -shr 8) -band 255
      $b = ($color -shr 16) -band 255
      if ($g -gt $r -and $g -gt $b -and $g -gt 70) { $greenCount++ }
      $checked++
    } catch {}
    Release-Com $cell
  }
  $joined = Normalize-HeaderText (($texts -join ' '))
  $hasHeaderText = (
    ($joined.Contains('MAHANG') -or $joined.Contains('ITEMNO') -or $joined.Contains('ITEM')) -and
    ($joined.Contains('SL:PO') -or $joined.Contains('SLPO') -or $joined.Contains('QTY') -or $joined.Contains('PCS'))
  )
  $hasGreenHeader = ($checked -gt 0 -and $greenCount -ge 4 -and ($joined.Contains('SL') -or $joined.Contains('MA')))
  return ($hasHeaderText -or $hasGreenHeader)
}

function Get-GroupRanges($sheet) {
  $used = $sheet.UsedRange
  $firstRow = [int]$used.Row
  $firstCol = [int]$used.Column
  $lastRow = $firstRow + [int]$used.Rows.Count - 1
  $lastCol = $firstCol + [int]$used.Columns.Count - 1
  Release-Com $used

  $starts = New-Object System.Collections.Generic.List[int]
  for ($row = $firstRow; $row -le $lastRow; $row++) {
    if (Is-GroupHeaderRow $sheet $row $firstCol $lastCol) {
      $starts.Add($row)
    }
  }
  $groups = @()
  for ($i = 0; $i -lt $starts.Count; $i++) {
    $start = $starts[$i]
    $end = if ($i + 1 -lt $starts.Count) { $starts[$i + 1] - 1 } else { $lastRow }
    $groups += [PSCustomObject]@{ Start = $start; End = $end }
  }
  return $groups
}

function Get-CellRow([string]$address) {
  if ($address -match '\d+') { return [int]$matches[0] }
  return 0
}

function Get-OrderRowsBySheet($payload) {
  $map = @{}
  if ($payload.orderCells) {
    foreach ($item in $payload.orderCells) {
      $sheetName = [string]$item.sheetName
      $row = Get-CellRow ([string]$item.cell)
      if ($row -le 0) { continue }
      if (-not $map.ContainsKey($sheetName)) {
        $map[$sheetName] = New-Object System.Collections.Generic.List[int]
      }
      $map[$sheetName].Add($row)
    }
  }
  return $map
}

function Get-CellText($sheet, [int]$row, [int]$col) {
  $cell = $sheet.Cells.Item($row, $col)
  $text = [string]$cell.Text
  Release-Com $cell
  return $text
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

function Convert-ToSafeDouble($value) {
  if ($null -eq $value) { return 0.0 }
  if ($value -is [byte] -or $value -is [int16] -or $value -is [int32] -or $value -is [int64] -or $value -is [single] -or $value -is [double] -or $value -is [decimal]) {
    return [double]$value
  }
  $text = ([string]$value).Trim()
  if (-not $text) { return 0.0 }
  $text = $text -replace ',', ''
  $number = 0.0
  $style = [Globalization.NumberStyles]::Float -bor [Globalization.NumberStyles]::AllowThousands
  if ([double]::TryParse($text, $style, [Globalization.CultureInfo]::InvariantCulture, [ref]$number)) { return $number }
  if ([double]::TryParse($text, $style, [Globalization.CultureInfo]::CurrentCulture, [ref]$number)) { return $number }
  throw "NUMBER_CONVERT_FAILED: value=$text"
}

function Get-CellNumber($sheet, [int]$row, [int]$col) {
  if ($col -le 0) { return 0.0 }
  $cell = $sheet.Cells.Item($row, $col)
  try {
    return Convert-ToSafeDouble $cell.Value2
  } finally {
    Release-Com $cell
  }
}

function Find-HeaderColumns($sheet, [int]$row) {
  $used = $sheet.UsedRange
  $firstCol = [int]$used.Column
  $lastCol = $firstCol + [int]$used.Columns.Count - 1
  Release-Com $used
  $cols = @{
    Code = 0; Color = 0; Qty = 0; Piece = 0; Total = 0; Shortage = 0; Note = 0; Belt = 0; CutSpec = 0; Segment = 0
  }
  for ($col = $firstCol; $col -le $lastCol; $col++) {
    $text = Normalize-HeaderText (Get-CellText $sheet $row $col)
    if ($cols.Code -eq 0 -and ($text.Contains('MAHANG') -or $text.Contains('ITEMNO') -or $text.Contains('ITEM'))) { $cols.Code = $col }
    if ($cols.Color -eq 0 -and ($text.Contains('MAU') -or $text.Contains('COLOR'))) { $cols.Color = $col }
    if ($cols.Qty -eq 0 -and ($text.Contains('SLPO') -or $text.Contains('SL:PO') -or $text.Contains('QTY') -or $text.Contains('PCS'))) { $cols.Qty = $col }
    if ($cols.Piece -eq 0 -and ($text.Contains('SOKIEN') -or $text.Contains('SOBO'))) { $cols.Piece = $col }
    if ($cols.Total -eq 0 -and (($text.Contains('SLCAT') -or $text.Contains('THUCTE'))) -and -not $text.Contains('THIEU')) { $cols.Total = $col }
    if ($cols.Shortage -eq 0 -and ($text.Contains('THIEU') -or $text.Contains('LIEU'))) { $cols.Shortage = $col }
    if ($cols.Note -eq 0 -and ($text.Contains('GHICHU') -or $text.Contains('NOTE'))) { $cols.Note = $col }
    if ($cols.Belt -eq 0 -and ($text.Contains('QUYCACH') -and ($text.Contains('DAY') -or $text.Contains('DAI') -or $text.Contains('THUNG')))) { $cols.Belt = $col }
    if ($cols.CutSpec -eq 0 -and ($text.Contains('QUYCACH') -and $text.Contains('CAT'))) { $cols.CutSpec = $col }
    if ($cols.Segment -eq 0 -and ($text.Contains('CONGDOAN') -or $text -eq 'DOAN')) { $cols.Segment = $col }
  }
  if ($cols.CutSpec -eq 0 -and $cols.Qty -gt 1 -and ($cols.Qty - 1) -ne $cols.Code) { $cols.CutSpec = $cols.Qty - 1 }
  return $cols
}

function New-LayoutColumn([string]$key, [string]$header, [int]$sourceCol) {
  return [PSCustomObject]@{ Key = $key; Header = $header; SourceCol = $sourceCol }
}

function Get-DefaultHeader([string]$key) {
  switch ($key) {
    'Image' { return 'PO' }
    'Belt' { return 'QUY CACH' }
    'Code' { return 'MA HANG' }
    'Color' { return 'MAU' }
    'Segment' { return 'CONG DOAN' }
    'CutSpec' { return 'QUY CACH' }
    'Qty' { return 'SL:PO PCS' }
    'Piece' { return 'SO KIEN' }
    'Total' { return 'SL:CAT THUC TE' }
    'Shortage' { return 'SL: THIEU' }
    'Note' { return 'GHI CHU' }
    default { return $key }
  }
}

function Get-TemplateLayout($sheet, [int]$headerRow, $cols) {
  $layout = @()
  $title = (Get-CellText $sheet $headerRow 1).Trim()
  if (-not $title) { $title = Get-DefaultHeader 'Image' }
  $layout += New-LayoutColumn 'Image' $title 1
  foreach ($item in @(
    @{ Key = 'Belt'; Col = $cols.Belt },
    @{ Key = 'Code'; Col = $cols.Code },
    @{ Key = 'Color'; Col = $cols.Color },
    @{ Key = 'Segment'; Col = $cols.Segment },
    @{ Key = 'CutSpec'; Col = $cols.CutSpec },
    @{ Key = 'Qty'; Col = $cols.Qty },
    @{ Key = 'Piece'; Col = $cols.Piece },
    @{ Key = 'Total'; Col = $cols.Total },
    @{ Key = 'Shortage'; Col = $cols.Shortage },
    @{ Key = 'Note'; Col = $cols.Note }
  )) {
    $col = [int]$item.Col
    if ($col -le 0) { continue }
    $header = (Get-CellText $sheet $headerRow $col).Trim()
    if (-not $header) { $header = Get-DefaultHeader ([string]$item.Key) }
    $layout += New-LayoutColumn ([string]$item.Key) $header $col
  }
  $seen = @{}
  return @($layout | Sort-Object SourceCol | Where-Object {
    if ($seen.ContainsKey($_.Key)) { return $false }
    $seen[$_.Key] = $true
    return $true
  } | Select-Object -First 10)
}

function Get-LayoutColumnIndex($layout, [string]$key) {
  for ($i = 0; $i -lt $layout.Count; $i++) {
    if ([string]$layout[$i].Key -eq $key) { return ($i + 1) }
  }
  return 0
}

function Is-ItemCode([string]$text) {
  $code = ($text.Trim().ToUpperInvariant() -replace '[^\w-]', '')
  return ($code -match '^[A-Z]{1,6}\d{2,}[-A-Z0-9]*$')
}

function First-NonEmptyInColumn($sheet, [int]$startRow, [int]$endRow, [int]$col) {
  if ($col -le 0) { return '' }
  for ($row = $startRow; $row -le $endRow; $row++) {
    $text = (Get-MergedCellText $sheet $row $col).Trim()
    if ($text) { return $text }
  }
  return ''
}

function Find-GroupSegment($sheet, [int]$startRow, [int]$endRow, [int]$codeCol) {
  $lastCol = if ($codeCol -gt 1) { [Math]::Min($codeCol - 1, 4) } else { 4 }
  for ($row = $startRow + 1; $row -le $endRow; $row++) {
    for ($col = 1; $col -le $lastCol; $col++) {
      $text = (Get-CellText $sheet $row $col).Trim()
      if (-not $text) { continue }
      $normalized = Normalize-HeaderText $text
      if ($normalized.Contains('DOAN') -or $normalized.Contains('CONGDOAN')) { return $text }
    }
  }
  return ''
}

function Resolve-ZipPath([string]$baseDir, [string]$target) {
  $target = ([string]$target) -replace '\\', '/'
  if ($target.StartsWith('/')) { return $target.TrimStart('/') }
  $parts = New-Object System.Collections.Generic.List[string]
  if ($baseDir) {
    foreach ($part in (($baseDir -replace '\\', '/') -split '/')) {
      if ($part) { $parts.Add($part) }
    }
  }
  foreach ($part in ($target -split '/')) {
    if (-not $part -or $part -eq '.') { continue }
    if ($part -eq '..') {
      if ($parts.Count -gt 0) { $parts.RemoveAt($parts.Count - 1) }
    } else {
      $parts.Add($part)
    }
  }
  return ($parts -join '/')
}

function Read-ZipXml($zip, [string]$path) {
  $entry = $zip.GetEntry($path)
  if ($null -eq $entry) { return $null }
  $stream = $entry.Open()
  try {
    $doc = New-Object System.Xml.XmlDocument
    $doc.PreserveWhitespace = $false
    $doc.Load($stream)
    return $doc
  } finally {
    $stream.Dispose()
  }
}

function Get-XmlNodesByLocalName($node, [string]$localName) {
  return @($node.GetElementsByTagName('*') | Where-Object { $_.LocalName -eq $localName })
}

function Get-XmlFirstChildText($node, [string]$localName) {
  $found = Get-XmlNodesByLocalName $node $localName | Select-Object -First 1
  if ($null -eq $found) { return '' }
  return [string]$found.InnerText
}

function Get-ZipRelTarget($zip, [string]$relsPath, [string]$relationshipId, [string]$baseDir) {
  $rels = Read-ZipXml $zip $relsPath
  if ($null -eq $rels) { return '' }
  foreach ($rel in (Get-XmlNodesByLocalName $rels 'Relationship')) {
    if ([string]$rel.Id -eq $relationshipId) {
      return (Resolve-ZipPath $baseDir ([string]$rel.Target))
    }
  }
  return ''
}

function Get-XlsxSheetDrawingPath($zip, [string]$sheetName) {
  $workbook = Read-ZipXml $zip 'xl/workbook.xml'
  if ($null -eq $workbook) { return '' }
  $sheetRelId = ''
  foreach ($sheet in (Get-XmlNodesByLocalName $workbook 'sheet')) {
    if ([string]$sheet.Name -eq $sheetName) {
      $sheetRelId = $sheet.GetAttribute('id', 'http://schemas.openxmlformats.org/officeDocument/2006/relationships')
      break
    }
  }
  if (-not $sheetRelId) { return '' }
  $sheetPath = Get-ZipRelTarget $zip 'xl/_rels/workbook.xml.rels' $sheetRelId 'xl'
  if (-not $sheetPath) { return '' }
  $sheetXml = Read-ZipXml $zip $sheetPath
  if ($null -eq $sheetXml) { return '' }
  $drawing = Get-XmlNodesByLocalName $sheetXml 'drawing' | Select-Object -First 1
  if ($null -eq $drawing) { return '' }
  $drawingRelId = $drawing.GetAttribute('id', 'http://schemas.openxmlformats.org/officeDocument/2006/relationships')
  if (-not $drawingRelId) { return '' }
  $sheetDir = Split-Path -Parent $sheetPath
  $sheetFile = Split-Path -Leaf $sheetPath
  $sheetRelsPath = (Resolve-ZipPath $sheetDir ("_rels/$sheetFile.rels"))
  return (Get-ZipRelTarget $zip $sheetRelsPath $drawingRelId $sheetDir)
}

function Get-XlsxAnchoredImages($zip, [string]$sheetName) {
  $drawingPath = Get-XlsxSheetDrawingPath $zip $sheetName
  if (-not $drawingPath) { return @() }
  $drawing = Read-ZipXml $zip $drawingPath
  if ($null -eq $drawing) { return @() }
  $drawingDir = Split-Path -Parent $drawingPath
  $drawingFile = Split-Path -Leaf $drawingPath
  $drawingRelsPath = Resolve-ZipPath $drawingDir ("_rels/$drawingFile.rels")
  $images = @()
  foreach ($anchor in (Get-XmlNodesByLocalName $drawing 'twoCellAnchor') + (Get-XmlNodesByLocalName $drawing 'oneCellAnchor')) {
    $from = Get-XmlNodesByLocalName $anchor 'from' | Select-Object -First 1
    if ($null -eq $from) { continue }
    $to = Get-XmlNodesByLocalName $anchor 'to' | Select-Object -First 1
    $startCol = 1 + [int](Get-XmlFirstChildText $from 'col')
    $startRow = 1 + [int](Get-XmlFirstChildText $from 'row')
    $endCol = if ($null -ne $to) { 1 + [int](Get-XmlFirstChildText $to 'col') } else { $startCol + 2 }
    $endRow = if ($null -ne $to) { 1 + [int](Get-XmlFirstChildText $to 'row') } else { $startRow + 8 }
    $blip = Get-XmlNodesByLocalName $anchor 'blip' | Select-Object -First 1
    if ($null -eq $blip) { continue }
    $embedId = $blip.GetAttribute('embed', 'http://schemas.openxmlformats.org/officeDocument/2006/relationships')
    if (-not $embedId) { continue }
    $mediaPath = Get-ZipRelTarget $zip $drawingRelsPath $embedId $drawingDir
    if (-not $mediaPath) { continue }
    $images += [PSCustomObject]@{
      StartRow = $startRow; EndRow = $endRow; StartCol = $startCol; EndCol = $endCol; MediaPath = $mediaPath
    }
  }
  return $images
}

function Save-XlsxImageThumbnail($zip, [string]$mediaPath, [string]$destPath) {
  $entry = $zip.GetEntry($mediaPath)
  if ($null -eq $entry) { return $false }
  $tmp = "$destPath.src"
  $inStream = $entry.Open()
  $outStream = [System.IO.File]::Create($tmp)
  try {
    $inStream.CopyTo($outStream)
  } finally {
    $outStream.Dispose()
    $inStream.Dispose()
  }
  try {
    try { Add-Type -AssemblyName System.Drawing -ErrorAction SilentlyContinue } catch {}
    $img = [System.Drawing.Image]::FromFile($tmp)
    try {
      $maxPixels = 720.0
      $scale = [Math]::Min(1.0, $maxPixels / [Math]::Max([double]$img.Width, [double]$img.Height))
      $w = [Math]::Max(1, [int]([double]$img.Width * $scale))
      $h = [Math]::Max(1, [int]([double]$img.Height * $scale))
      $bmp = New-Object System.Drawing.Bitmap $w, $h
      try {
        $g = [System.Drawing.Graphics]::FromImage($bmp)
        try {
          $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
          $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
          $g.DrawImage($img, 0, 0, $w, $h)
        } finally {
          $g.Dispose()
        }
        $bmp.Save($destPath, [System.Drawing.Imaging.ImageFormat]::Png)
      } finally {
        $bmp.Dispose()
      }
    } finally {
      $img.Dispose()
    }
  } catch {
    Copy-Item -LiteralPath $tmp -Destination $destPath -Force
  } finally {
    Remove-Item -LiteralPath $tmp -Force -ErrorAction SilentlyContinue
  }
  return (Test-CuttingImageFile $destPath)
}

function Export-XlsxGroupImage($xlsxPath, [string]$sheetName, [int]$startRow, [int]$endRow, [string]$destPath) {
  if (-not $xlsxPath -or -not (Test-Path -LiteralPath $xlsxPath)) { return $false }
  try {
    Add-Type -AssemblyName System.IO.Compression.FileSystem -ErrorAction SilentlyContinue
    $zip = [System.IO.Compression.ZipFile]::OpenRead($xlsxPath)
    try {
      $images = Get-XlsxAnchoredImages $zip $sheetName
      $candidates = @()
      foreach ($image in $images) {
        if ([int]$image.StartRow -le $endRow -and [int]$image.EndRow -ge $startRow) {
          $overlap = [Math]::Min($endRow, [int]$image.EndRow) - [Math]::Max($startRow, [int]$image.StartRow) + 1
          $score = [Math]::Max(0, $overlap) * 1000
          if ([int]$image.StartCol -le 2) { $score += 100000 }
          $candidates += [PSCustomObject]@{ Image = $image; Score = $score }
        }
      }
      foreach ($candidate in ($candidates | Sort-Object -Property Score -Descending)) {
        if (Save-XlsxImageThumbnail $zip ([string]$candidate.Image.MediaPath) $destPath) { return $true }
      }
    } finally {
      $zip.Dispose()
    }
  } catch {}
  return $false
}

function Get-GroupImageCandidates($sheet, [int]$startRow, [int]$endRow) {
  $candidates = @()
  try {
    for ($i = 1; $i -le $sheet.Shapes.Count; $i++) {
      $shape = $sheet.Shapes.Item($i)
      try {
        $topRow = [int]$shape.TopLeftCell.Row
        $bottomRow = [int]$shape.BottomRightCell.Row
        if ($topRow -le $endRow -and $bottomRow -ge $startRow) {
          $leftCol = [int]$shape.TopLeftCell.Column
          $rightCol = [int]$shape.BottomRightCell.Column
          $width = [double]$shape.Width
          $height = [double]$shape.Height
          $area = $width * $height
          if ($width -lt 20 -or $height -lt 20) {
            Release-Com $shape
            continue
          }
          $type = 0
          try { $type = [int]$shape.Type } catch {}
          $score = $area
          if ($leftCol -le 1 -and $rightCol -ge 1) { $score += 100000000 }
          if ($type -eq 13 -or $type -eq 11 -or $type -eq 6) { $score += 1000000000 }
          if ($type -eq 1) { $score -= 100000000 }
          $candidates += [PSCustomObject]@{ Shape = $shape; Score = $score; Index = $i }
        } else {
          Release-Com $shape
        }
      } catch {
        Release-Com $shape
      }
    }
  } catch {}
  return @($candidates | Sort-Object -Property Score, Index -Descending | ForEach-Object { $_.Shape })
}

function Find-GroupImage($sheet, [int]$startRow, [int]$endRow) {
  $candidates = Get-GroupImageCandidates $sheet $startRow $endRow
  if (-not $candidates -or $candidates.Count -eq 0) { return $null }
  for ($i = 1; $i -lt $candidates.Count; $i++) {
    Release-Com $candidates[$i]
  }
  return $candidates[0]
}

function Find-GroupImageFile($sheet, [int]$startRow, [int]$endRow, [string]$basePath) {
  $candidates = Get-GroupImageCandidates $sheet $startRow $endRow
  if (-not $candidates -or $candidates.Count -eq 0) { return '' }
  $chosen = ''
  for ($i = 0; $i -lt $candidates.Count; $i++) {
    $shape = $candidates[$i]
    $path = $basePath
    if ($i -gt 0) {
      $dir = Split-Path -Parent $basePath
      $name = [System.IO.Path]::GetFileNameWithoutExtension($basePath)
      $path = Join-Path $dir ("${name}_alt$($i + 1).png")
    }
    try {
      if (Export-ShapeImage $shape $sheet $path -and (Test-CuttingImageFile $path)) {
        $chosen = $path
      } elseif (Test-Path -LiteralPath $path) {
        Remove-Item -LiteralPath $path -Force -ErrorAction SilentlyContinue
      }
    } finally {
      Release-Com $shape
    }
    if ($chosen) { break }
  }
  if (-not $chosen) { return '' }
  if ($chosen -ne $basePath) {
    Move-Item -LiteralPath $chosen -Destination $basePath -Force
  }
  return $basePath
}

function Export-ShapeImage($shape, $sheet, [string]$path) {
  if ($null -eq $shape) { return $false }
  $chartObject = $null
  try {
    $width = [Math]::Max(80, [double]$shape.Width)
    $height = [Math]::Max(80, [double]$shape.Height)
    $maxSide = 360.0
    $scale = [Math]::Min(1.0, $maxSide / [Math]::Max($width, $height))
    $width = [Math]::Max(80, $width * $scale)
    $height = [Math]::Max(80, $height * $scale)
    $shape.CopyPicture(1, 2)
    $chartObject = $sheet.ChartObjects().Add(0, 0, $width, $height)
    $chartObject.Chart.Paste()
    [void]$chartObject.Chart.Export($path, 'PNG')
    return (Test-Path -LiteralPath $path)
  } catch {
    return $false
  } finally {
    if ($null -ne $chartObject) {
      try { $chartObject.Delete() } catch {}
      Release-Com $chartObject
    }
  }
}

function Copy-GroupImage($sourceShape, $targetSheet, [int]$startRow, [int]$endRow, [double]$topPadding = 0, [int]$imageCol = 1) {
  if ($null -eq $sourceShape) { return }
  $imageTimer = [System.Diagnostics.Stopwatch]::StartNew()
  try {
    Set-CuttingStage 'copy_group_image_frame' "rows=$startRow-$endRow col=$imageCol"
    $frame = $targetSheet.Range($targetSheet.Cells.Item($startRow, $imageCol), $targetSheet.Cells.Item($endRow, $imageCol))
    Set-CuttingStage 'copy_group_image_copy' "rows=$startRow-$endRow"
    $sourceShape.Copy()
    Set-CuttingStage 'copy_group_image_paste' "rows=$startRow-$endRow"
    $targetSheet.Paste() | Out-Null
    $shape = $targetSheet.Shapes.Item($targetSheet.Shapes.Count)
    $shape.LockAspectRatio = -1
    $maxWidth = [double]$frame.Width - 8
    $maxHeight = [Math]::Max(24.0, [double]$frame.Height - $topPadding - 8)
    if ($shape.Width -gt $maxWidth) { $shape.Width = $maxWidth }
    if ($shape.Height -gt $maxHeight) { $shape.Height = $maxHeight }
    $shape.Left = [double]$frame.Left + (([double]$frame.Width - [double]$shape.Width) / 2)
    $shape.Top = [double]$frame.Top + $topPadding + (([double]$frame.Height - $topPadding - [double]$shape.Height) / 2)
    Release-Com $shape
    Release-Com $frame
    $imageTimer.Stop()
    Add-CuttingLog 'image_copy' "rows=$startRow-$endRow elapsed=$($imageTimer.ElapsedMilliseconds)ms"
    if ($imageTimer.ElapsedMilliseconds -gt 10000) {
      throw "IMAGE_COPY_TIMEOUT: elapsed=$($imageTimer.ElapsedMilliseconds)ms"
    }
  } catch {
    throw "IMAGE_COPY_FAILED: $($_.Exception.Message)"
  }
}

function Place-GroupImage($group, $targetSheet, [int]$startRow, [int]$endRow, [double]$topPadding = 0, [int]$imageCol = 1) {
  if ($group.ImagePath -and (Test-Path -LiteralPath ([string]$group.ImagePath))) {
    $imageTimer = [System.Diagnostics.Stopwatch]::StartNew()
    $frame = $null
    $shape = $null
    try {
      Set-CuttingStage 'insert_cached_image' "path=$($group.ImagePath); rows=$startRow-$endRow col=$imageCol"
      $frame = $targetSheet.Range($targetSheet.Cells.Item($startRow, $imageCol), $targetSheet.Cells.Item($endRow, $imageCol))
      $shape = $targetSheet.Shapes.AddPicture([string]$group.ImagePath, $false, $true, [double]$frame.Left, [double]$frame.Top, -1, -1)
      $shape.LockAspectRatio = -1
      $maxWidth = [double]$frame.Width - 8
      $maxHeight = [Math]::Max(24.0, [double]$frame.Height - $topPadding - 8)
      if ($shape.Width -gt $maxWidth) { $shape.Width = $maxWidth }
      if ($shape.Height -gt $maxHeight) { $shape.Height = $maxHeight }
      $shape.Left = [double]$frame.Left + (([double]$frame.Width - [double]$shape.Width) / 2)
      $shape.Top = [double]$frame.Top + $topPadding + (([double]$frame.Height - $topPadding - [double]$shape.Height) / 2)
      $imageTimer.Stop()
      Add-CuttingLog 'image_insert' "rows=$startRow-$endRow elapsed=$($imageTimer.ElapsedMilliseconds)ms"
      if ($imageTimer.ElapsedMilliseconds -gt 10000) {
        throw "IMAGE_INSERT_TIMEOUT: elapsed=$($imageTimer.ElapsedMilliseconds)ms"
      }
    } catch {
      throw "IMAGE_INSERT_FAILED: $($_.Exception.Message)"
    } finally {
      Release-Com $shape
      Release-Com $frame
    }
    return
  }
  Copy-GroupImage $group.Image $targetSheet $startRow $endRow $topPadding $imageCol
}

function Get-CompactGroups($workbook, $payload) {
  $orderRowsBySheet = Get-OrderRowsBySheet $payload
  $groupsOut = @()
  foreach ($sheetName in $orderRowsBySheet.Keys) {
    Set-CuttingStage 'analyze_groups' "sheet=$sheetName"
    $sheet = $workbook.Worksheets.Item([string]$sheetName)
    $groups = Get-GroupRanges $sheet
    foreach ($group in $groups) {
      Set-CuttingStage 'analyze_group_range' "sheet=$sheetName; rows=$($group.Start)-$($group.End)"
      $hasOrder = $false
      foreach ($row in $orderRowsBySheet[$sheetName]) {
        if ($row -ge $group.Start -and $row -le $group.End) { $hasOrder = $true; break }
      }
      if (-not $hasOrder) { continue }
      $cols = Find-HeaderColumns $sheet $group.Start
      if ($cols.Code -le 0) { continue }
      $layout = Get-TemplateLayout $sheet $group.Start $cols
      $items = @()
      $colors = New-Object System.Collections.Generic.List[string]
      $totalCut = 0.0
      for ($row = $group.Start + 1; $row -le $group.End; $row++) {
        Set-CuttingStage 'read_group_items' "sheet=$sheetName; row=$row"
        $code = (Get-CellText $sheet $row $cols.Code).Trim()
        if (-not (Is-ItemCode $code)) { continue }
        $color = if ($cols.Color -gt 0) { (Get-MergedCellText $sheet $row $cols.Color).Trim() } else { '' }
        if ($color -and -not $colors.Contains($color)) { $colors.Add($color) }
        $qty = Get-CellNumber $sheet $row $cols.Qty
        $piece = Get-CellNumber $sheet $row $cols.Piece
        $cut = if ($cols.Total -gt 0) { Get-CellNumber $sheet $row $cols.Total } else { ($qty * $piece) }
        $totalCut += $cut
        $items += [PSCustomObject]@{ Code = $code; Color = $color; Qty = $qty; Piece = $piece }
      }
      $belt = First-NonEmptyInColumn $sheet ($group.Start + 1) $group.End $cols.Belt
      $cutSpec = First-NonEmptyInColumn $sheet ($group.Start + 1) $group.End $cols.CutSpec
      $note = First-NonEmptyInColumn $sheet ($group.Start + 1) $group.End $cols.Note
      $segment = if ($cols.Segment -gt 0) { First-NonEmptyInColumn $sheet ($group.Start + 1) $group.End $cols.Segment } else { Find-GroupSegment $sheet $group.Start $group.End $cols.Code }
      $title = Get-CellText $sheet $group.Start 1
      Set-CuttingStage 'find_group_image' "sheet=$sheetName; rows=$($group.Start)-$($group.End); title=$title"
      $image = Find-GroupImage $sheet $group.Start $group.End
      $groupsOut += [PSCustomObject]@{
        Sheet = $sheet; Title = $title; Layout = $layout; Segment = $segment; Belt = $belt; Color = ($colors -join ' / ');
        CutSpec = $cutSpec; Note = $note; Items = $items; TotalCut = $totalCut; Image = $image
      }
    }
    Release-Com $sheet
  }
  return $groupsOut
}

function Build-TemplateCacheGroups($excel, $workbook, $payload, [string]$templatePath = '') {
  $cacheDir = Get-CacheDir $payload
  $groupsOut = @()
  for ($s = 1; $s -le $workbook.Worksheets.Count; $s++) {
    $sheet = $workbook.Worksheets.Item($s)
    $sheetName = [string]$sheet.Name
    Set-CuttingStage 'cache_analyze_sheet' "sheet=$sheetName"
    $ranges = Get-GroupRanges $sheet
    $groupNo = 0
    foreach ($group in $ranges) {
      $groupNo++
      Set-CuttingStage 'cache_analyze_group' "sheet=$sheetName; group=$groupNo; rows=$($group.Start)-$($group.End)"
      $cols = Find-HeaderColumns $sheet $group.Start
      if ($cols.Code -le 0) { continue }
      $layout = Get-TemplateLayout $sheet $group.Start $cols
      $items = @()
      $colors = New-Object System.Collections.Generic.List[string]
      for ($row = $group.Start + 1; $row -le $group.End; $row++) {
        $code = (Get-CellText $sheet $row $cols.Code).Trim()
        if (-not (Is-ItemCode $code)) { continue }
        $color = if ($cols.Color -gt 0) { (Get-MergedCellText $sheet $row $cols.Color).Trim() } else { '' }
        if ($color -and -not $colors.Contains($color)) { $colors.Add($color) }
        $piece = Get-CellNumber $sheet $row $cols.Piece
        $items += [PSCustomObject]@{
          code = $code
          color = $color
          rowNumber = $row
          qtyCell = if ($cols.Qty -gt 0) { Get-CellAddress1 $row $cols.Qty } else { '' }
          piece = $piece
        }
      }
      if (-not $items -or $items.Count -eq 0) { continue }
      $imageFile = ''
      $candidate = "group_${s}_${groupNo}.png"
      $imagePath = Join-Path $cacheDir $candidate
      if (Test-Path -LiteralPath $imagePath) { Remove-Item -LiteralPath $imagePath -Force -ErrorAction SilentlyContinue }
      Set-CuttingStage 'cache_export_image' "sheet=$sheetName; group=$groupNo; path=$imagePath"
      if (Export-XlsxGroupImage $templatePath $sheetName $group.Start $group.End $imagePath) {
        $imageFile = $candidate
      } elseif (Find-GroupImageFile $sheet $group.Start $group.End $imagePath) {
        $imageFile = $candidate
      }
      $segment = if ($cols.Segment -gt 0) { First-NonEmptyInColumn $sheet ($group.Start + 1) $group.End $cols.Segment } else { Find-GroupSegment $sheet $group.Start $group.End $cols.Code }
      $groupsOut += [PSCustomObject]@{
        sheetName = $sheetName
        startRow = $group.Start
        endRow = $group.End
        title = Get-CellText $sheet $group.Start 1
        layout = $layout
        segment = $segment
        belt = First-NonEmptyInColumn $sheet ($group.Start + 1) $group.End $cols.Belt
        color = ($colors -join ' / ')
        cutSpec = First-NonEmptyInColumn $sheet ($group.Start + 1) $group.End $cols.CutSpec
        note = First-NonEmptyInColumn $sheet ($group.Start + 1) $group.End $cols.Note
        imageFile = $imageFile
        items = $items
      }
    }
    Release-Com $sheet
  }
  return $groupsOut
}

function Get-CachedGroupsForPayload($cache, $payload) {
  $writeMap = @{}
  foreach ($write in $payload.writes) {
    $key = "$([string]$write.sheetName)!$([string]$write.cell)".ToUpperInvariant()
    $writeMap[$key] = Convert-ToSafeDouble $write.value
  }
  $orderMap = @{}
  foreach ($cell in $payload.orderCells) {
    $key = "$([string]$cell.sheetName)!$([string]$cell.cell)".ToUpperInvariant()
    $orderMap[$key] = $true
  }
  $groupsOut = @()
  $cacheDir = Get-CacheDir $payload
  foreach ($group in $cache.groups) {
    $items = @()
    $totalCut = 0.0
    foreach ($item in $group.items) {
      $qtyKey = "$([string]$group.sheetName)!$([string]$item.qtyCell)".ToUpperInvariant()
      $qty = if ($writeMap.ContainsKey($qtyKey)) { [double]$writeMap[$qtyKey] } else { 0.0 }
      if ($qty -le 0) { continue }
      $piece = Convert-ToSafeDouble $item.piece
      $totalCut += ($qty * $piece)
      $items += [PSCustomObject]@{
        Code = [string]$item.code
        Color = [string]$item.color
        Qty = $qty
        Piece = $piece
      }
    }
    if (-not $items -or $items.Count -eq 0) { continue }
    $imagePath = ''
    if ($group.imageFile) { $imagePath = Join-Path $cacheDir ([string]$group.imageFile) }
    $groupsOut += [PSCustomObject]@{
      Title = [string]$group.title
      Layout = @($group.layout)
      Segment = [string]$group.segment
      Belt = [string]$group.belt
      Color = [string]$group.color
      CutSpec = [string]$group.cutSpec
      Note = [string]$group.note
      Items = $items
      TotalCut = $totalCut
      Image = $null
      ImagePath = $imagePath
    }
  }
  return $groupsOut
}

function Set-CellStyle($range, [int]$fontSize, [bool]$bold) {
  $range.HorizontalAlignment = -4108
  $range.VerticalAlignment = -4108
  $range.WrapText = $true
  try { $range.ShrinkToFit = $true } catch {}
  $range.Font.Size = $fontSize
  $range.Font.Bold = $bold
}

function Set-SingleLineCellStyle($range, [int]$fontSize, [bool]$bold) {
  $range.HorizontalAlignment = -4108
  $range.VerticalAlignment = -4108
  $range.WrapText = $false
  try { $range.ShrinkToFit = $true } catch {}
  $range.Font.Size = $fontSize
  $range.Font.Bold = $bold
}

function Set-SegmentCellStyle($range) {
  $range.HorizontalAlignment = -4108
  $range.VerticalAlignment = -4160
  $range.WrapText = $true
  try { $range.ShrinkToFit = $true } catch {}
  $range.Font.Size = 13
  $range.Font.Bold = $true
}

function Get-FitFontSize([string]$text, [int]$maxSize, [int]$minSize, [int]$stepChars) {
  $value = if ($text) { $text } else { '' }
  $plain = ($value -replace '\s+', '')
  $lines = @($value -split "(\r\n|\n|\r|/)")
  $longest = 0
  foreach ($line in $lines) {
    $len = (($line -replace '\s+', '')).Length
    if ($len -gt $longest) { $longest = $len }
  }
  $score = [Math]::Max($plain.Length, $longest * 2)
  $drop = [Math]::Floor([Math]::Max(0, $score - $stepChars) / [Math]::Max(1, $stepChars))
  return [Math]::Max($minSize, [Math]::Min($maxSize, $maxSize - $drop))
}

function Get-ItemFontSize([int]$itemCount, [double]$rowHeight) {
  $byCount = [Math]::Floor(105 / [Math]::Max(1, $itemCount))
  $byHeight = [Math]::Floor($rowHeight / 2.5)
  return [Math]::Max(7, [Math]::Min(14, [Math]::Min($byCount, $byHeight)))
}

function Get-GroupSortKey($group) {
  $codes = @()
  foreach ($item in $group.Items) {
    if ($item.Code) { $codes += [string]$item.Code }
  }
  if (-not $codes -or $codes.Count -eq 0) { return '' }
  return [string](($codes | Sort-Object)[0])
}

function Get-DefaultLayout($group) {
  return @(
    (New-LayoutColumn 'Image' ([string]$group.Title) 1),
    (New-LayoutColumn 'Belt' 'QUY CACH' 2),
    (New-LayoutColumn 'Code' 'MA HANG' 3),
    (New-LayoutColumn 'Color' 'MAU' 4),
    (New-LayoutColumn 'CutSpec' 'QUY CACH' 5),
    (New-LayoutColumn 'Qty' 'SL:PO PCS' 6),
    (New-LayoutColumn 'Piece' 'SO KIEN' 7),
    (New-LayoutColumn 'Total' 'SL:CAT THUC TE' 8),
    (New-LayoutColumn 'Shortage' 'SL: THIEU' 9),
    (New-LayoutColumn 'Note' 'GHI CHU' 10)
  )
}

function Get-GroupLayout($group) {
  $layout = @($group.Layout)
  if (-not $layout -or $layout.Count -eq 0) { return (Get-DefaultLayout $group) }
  return @($layout | Select-Object -First 10)
}

function Get-ColumnWidthByKey([string]$key) {
  switch ($key) {
    'Image' { return 13 }
    'Belt' { return 10 }
    'Code' { return 13 }
    'Color' { return 12 }
    'Segment' { return 12 }
    'CutSpec' { return 9 }
    'Qty' { return 8 }
    'Piece' { return 7 }
    'Total' { return 9 }
    'Shortage' { return 7 }
    'Note' { return 12 }
    default { return 9 }
  }
}

function Get-PrintColumnWidths($groups) {
  $widths = @(8,8,8,8,8,8,8,8,8,8)
  foreach ($group in $groups) {
    $layout = Get-GroupLayout $group
    for ($i = 0; $i -lt $layout.Count -and $i -lt 10; $i++) {
      $widths[$i] = [Math]::Max([double]$widths[$i], [double](Get-ColumnWidthByKey ([string]$layout[$i].Key)))
    }
  }
  return $widths
}

function Get-GroupFieldValue($group, [string]$key) {
  switch ($key) {
    'Image' { return [string]$group.Segment }
    'Belt' { return Format-BeltDisplayText ([string]$group.Belt) }
    'Segment' { return [string]$group.Segment }
    'CutSpec' { return [string]$group.CutSpec }
    'Total' { return [double]$group.TotalCut }
    'Shortage' { return '' }
    'Note' { return [string]$group.Note }
    default { return '' }
  }
}

function Format-BeltDisplayText([string]$text) {
  $value = if ($text) { $text.Trim() } else { '' }
  if ($value -match '^([0-9]+(?:\*[0-9.]+)?MM)\s+(.+)$') {
    return "$($matches[1])`n$($matches[2])"
  }
  return $value
}

function Is-RowField([string]$key) {
  return ($key -eq 'Code' -or $key -eq 'Color' -or $key -eq 'Qty' -or $key -eq 'Piece')
}

function Get-ItemFieldValue($item, [string]$key) {
  switch ($key) {
    'Code' { return [string]$item.Code }
    'Color' { return [string]$item.Color }
    'Qty' { return [double]$item.Qty }
    'Piece' { return [double]$item.Piece }
    default { return '' }
  }
}

function Merge-RepeatedColorCells($sheet, [int]$startRow, [int]$endRow, [int]$colorCol, $items, [int]$fontSize) {
  if ($colorCol -le 0 -or $endRow -lt $startRow -or $null -eq $items -or $items.Count -le 1) { return }
  $runStart = $startRow
  $lastColor = ''
  for ($i = 0; $i -lt $items.Count; $i++) {
    $currentColor = ([string]$items[$i].Color).Trim()
    if ($i -eq 0) {
      $lastColor = $currentColor
      continue
    }
    if ($currentColor -ne $lastColor) {
      Merge-ColorRun $sheet $runStart ($startRow + $i - 1) $colorCol $lastColor $fontSize
      $runStart = $startRow + $i
      $lastColor = $currentColor
    }
  }
  Merge-ColorRun $sheet $runStart $endRow $colorCol $lastColor $fontSize
}

function Merge-ColorRun($sheet, [int]$startRow, [int]$endRow, [int]$colorCol, [string]$color, [int]$fontSize) {
  if (-not $color -or $endRow -le $startRow) { return }
  $range = $sheet.Range($sheet.Cells.Item($startRow, $colorCol), $sheet.Cells.Item($endRow, $colorCol))
  try {
    $range.Merge() | Out-Null
    $range.Value2 = $color
    Set-SingleLineCellStyle $range $fontSize $false
  } finally {
    Release-Com $range
  }
}

function Build-CompactWorkbook($excel, $sourceWorkbook, $payload, $cachedGroups = $null) {
  Set-CuttingStage 'collect_groups' 'read matched template groups'
  if ($null -ne $cachedGroups) {
    $groups = $cachedGroups
    Add-CuttingLog 'read_template_cache' "groups=$($groups.Count)"
  } else {
    $groups = Get-CompactGroups $sourceWorkbook $payload
    Add-CuttingLog 'read_template' "groups=$($groups.Count)"
  }
  if (-not $groups -or $groups.Count -eq 0) { throw '沒有任何有訂單數量的組可輸出。' }

  Set-CuttingStage 'create_print_workbook' "groups=$($groups.Count)"
  $outBook = $excel.Workbooks.Add()
  $outSheet = $outBook.Worksheets.Item(1)
  $outSheet.Name = 'PDF_PRINT'
  while ($outBook.Worksheets.Count -gt 1) {
    $extra = $outBook.Worksheets.Item($outBook.Worksheets.Count)
    $extra.Delete()
    Release-Com $extra
  }

  $cols = Get-PrintColumnWidths $groups
  for ($i = 0; $i -lt $cols.Count; $i++) { $outSheet.Columns.Item($i + 1).ColumnWidth = $cols[$i] }
  $outSheet.PageSetup.Orientation = 1
  $outSheet.PageSetup.PaperSize = 9
  $outSheet.PageSetup.Zoom = $false
  $outSheet.PageSetup.FitToPagesWide = 1
  $outSheet.PageSetup.FitToPagesTall = $false
  $outSheet.PageSetup.TopMargin = 0
  $outSheet.PageSetup.BottomMargin = 0
  $outSheet.PageSetup.LeftMargin = 0
  $outSheet.PageSetup.RightMargin = 0
  $outSheet.PageSetup.HeaderMargin = 0
  $outSheet.PageSetup.FooterMargin = 0

  $groupHeight = 140.3
  $headerHeight = 28.0
  $outRow = 1
  $groupIndex = 0
  foreach ($group in $groups) {
    $layout = Get-GroupLayout $group
    $colCount = [Math]::Max(1, [Math]::Min(10, $layout.Count))
    $imageCol = Get-LayoutColumnIndex $layout 'Image'
    if ($imageCol -le 0) { $imageCol = 1 }
    $segmentCol = Get-LayoutColumnIndex $layout 'Segment'
    Set-CuttingStage 'render_group' "index=$($groupIndex + 1); title=$($group.Title); items=$($group.Items.Count)"
    if ($groupIndex -gt 0 -and ($groupIndex % 6) -eq 0) {
      try { $outSheet.HPageBreaks.Add($outSheet.Rows.Item($outRow)) | Out-Null } catch {}
    }
    $itemCount = [Math]::Max(1, $group.Items.Count)
    $detailHeight = ($groupHeight - $headerHeight) / $itemCount
    $startRow = $outRow
    $headerRow = $outRow
    $detailStart = $outRow + 1
    $detailEnd = $detailStart + $itemCount - 1

    Set-CuttingStage 'render_group_row_height' "index=$($groupIndex + 1); headerRow=$headerRow; detailRows=$detailStart-$detailEnd; detailHeight=$detailHeight"
    $outSheet.Rows.Item($headerRow).RowHeight = $headerHeight
    for ($r = $detailStart; $r -le $detailEnd; $r++) {
      Set-CuttingStage 'render_group_detail_row_height' "index=$($groupIndex + 1); row=$r; height=$detailHeight"
      $outSheet.Rows.Item($r).RowHeight = $detailHeight
    }

    Set-CuttingStage 'render_group_headers' "index=$($groupIndex + 1); row=$headerRow"
    $headers = @($layout | ForEach-Object { [string]$_.Header })
    $headerFillColor = [int]5996346
    $headerFontColor = [int]16777215
    $headerData = New-Object 'object[,]' 1, $colCount
    for ($c = 1; $c -le $colCount; $c++) {
      $headerIndex = $c - 1
      $headerData[0, $headerIndex] = Safe-ToText $headers[$headerIndex]
    }
    Set-CuttingStage 'render_group_header_range' "index=$($groupIndex + 1); row=$headerRow; cols=1-$colCount"
    $headerRange = $outSheet.Range($outSheet.Cells.Item($headerRow, 1), $outSheet.Cells.Item($headerRow, $colCount))
    Set-CuttingStage 'render_group_header_values' "index=$($groupIndex + 1); row=$headerRow; cols=1-$colCount"
    $headerRange.Value = $headerData
    Set-CuttingStage 'render_group_header_fill_color' "index=$($groupIndex + 1); row=$headerRow; cols=1-10; color=$headerFillColor"
    $headerRange.Interior.Color = $headerFillColor
    Set-CuttingStage 'render_group_header_font_color' "index=$($groupIndex + 1); row=$headerRow; cols=1-10; color=$headerFontColor"
    $headerRange.Font.Color = $headerFontColor
    Set-CuttingStage 'render_group_header_style' "index=$($groupIndex + 1); row=$headerRow; cols=1-10"
    Set-CellStyle $headerRange 9 $true
    Release-Com $headerRange

    Set-CuttingStage 'render_group_merge_cells' "index=$($groupIndex + 1); rows=$detailStart-$detailEnd"
    for ($col = 1; $col -le $colCount; $col++) {
      $key = [string]$layout[$col - 1].Key
      if (Is-RowField $key) { continue }
      Set-CuttingStage 'render_group_merge_column' "index=$($groupIndex + 1); col=$col; key=$key; rows=$detailStart-$detailEnd"
      $range = $outSheet.Range($outSheet.Cells.Item($detailStart, $col), $outSheet.Cells.Item($detailEnd, $col))
      $range.Merge() | Out-Null
      Release-Com $range
    }

    Set-CuttingStage 'render_group_write_values' "index=$($groupIndex + 1); row=$detailStart"
    for ($col = 1; $col -le $colCount; $col++) {
      $key = [string]$layout[$col - 1].Key
      if (Is-RowField $key) { continue }
      if ($key -eq 'Image' -and $segmentCol -gt 0) { continue }
      $outSheet.Cells.Item($detailStart, $col).Value2 = Get-GroupFieldValue $group $key
    }

    Set-CuttingStage 'render_group_write_items' "index=$($groupIndex + 1); items=$itemCount"
    for ($col = 1; $col -le $colCount; $col++) {
      $key = [string]$layout[$col - 1].Key
      if (-not (Is-RowField $key)) { continue }
      $data = New-Object 'object[,]' $itemCount, 1
      for ($i = 0; $i -lt $itemCount; $i++) {
        $row = $detailStart + $i
        if ($i -lt $group.Items.Count) {
          $item = $group.Items[$i]
          Set-CuttingStage 'render_group_prepare_item_row' "index=$($groupIndex + 1); row=$row; key=$key; code=$($item.Code); qty=$($item.Qty); piece=$($item.Piece)"
          $data[$i, 0] = Get-ItemFieldValue $item $key
        } else {
          $data[$i, 0] = ''
        }
      }
      Set-CuttingStage 'render_group_write_item_range' "index=$($groupIndex + 1); col=$col; key=$key; rows=$detailStart-$detailEnd"
      $writeRange = $outSheet.Range($outSheet.Cells.Item($detailStart, $col), $outSheet.Cells.Item($detailEnd, $col))
      $writeRange.Value = $data
      Release-Com $writeRange
    }

    $colorCol = Get-LayoutColumnIndex $layout 'Color'
    if ($colorCol -gt 0) {
      Set-CuttingStage 'render_group_merge_colors' "index=$($groupIndex + 1); col=$colorCol; rows=$detailStart-$detailEnd"
      Merge-RepeatedColorCells $outSheet $detailStart $detailEnd $colorCol $group.Items ([Math]::Max(6, $itemFontSize - 1))
    }

    Set-CuttingStage 'render_group_style_block' "index=$($groupIndex + 1); rows=$startRow-$detailEnd"
    $block = $outSheet.Range($outSheet.Cells.Item($startRow, 1), $outSheet.Cells.Item($detailEnd, $colCount))
    $block.Borders.LineStyle = 1
    $block.Borders.Weight = 2
    Set-CellStyle $block 12 $false
    Release-Com $block
    $itemFontSize = Get-ItemFontSize $itemCount $detailHeight
    for ($col = 1; $col -le $colCount; $col++) {
      $key = [string]$layout[$col - 1].Key
      $range = $outSheet.Range($outSheet.Cells.Item($detailStart, $col), $outSheet.Cells.Item($detailEnd, $col))
      if ($key -eq 'Image') {
        if ([string]$group.Segment -and $segmentCol -le 0) { Set-SegmentCellStyle $range } else { Set-CellStyle $range 12 $false }
      } elseif ($key -eq 'Belt') {
        $beltText = [string](Get-GroupFieldValue $group $key)
        if ($beltText.Contains("`n")) {
          Set-CellStyle $range (Get-FitFontSize $beltText 13 7 4) $true
        } else {
          Set-SingleLineCellStyle $range ([Math]::Max(6, $itemFontSize - 1)) $true
        }
      } elseif ($key -eq 'CutSpec' -or $key -eq 'Color') {
        Set-SingleLineCellStyle $range ([Math]::Max(6, $itemFontSize - 1)) ($key -ne 'Color')
      } elseif ($key -eq 'Code' -or $key -eq 'Qty' -or $key -eq 'Piece') {
        Set-CellStyle $range $itemFontSize $false
      } elseif ($key -eq 'Segment') {
        Set-CellStyle $range (Get-FitFontSize ([string]$group.Segment) 18 8 4) $true
      } elseif ($key -eq 'Total' -or $key -eq 'Note') {
        Set-CellStyle $range (Get-FitFontSize ([string](Get-GroupFieldValue $group $key)) 18 8 7) $true
      } else {
        Set-CellStyle $range 12 $false
      }
      Release-Com $range
    }

    Set-CuttingStage 'copy_group_image' "index=$($groupIndex + 1); title=$($group.Title); rows=$detailStart-$detailEnd"
    $imageTopPadding = if ([string]$group.Segment -and $segmentCol -le 0) { [Math]::Min(38.0, [Math]::Max(22.0, ($groupHeight - $headerHeight) * 0.28)) } else { 0.0 }
    Place-GroupImage $group $outSheet $detailStart $detailEnd $imageTopPadding $imageCol
    $outRow = $detailEnd + 1
    $groupIndex++
  }
  Add-CuttingLog 'generate_table' "groups=$groupIndex rows=$($outRow - 1)"

  Set-CuttingStage 'set_print_area' "rows=$($outRow - 1)"
  $used = $outSheet.UsedRange
  $outSheet.PageSetup.PrintArea = $used.Address()
  Release-Com $used
  return $outBook
}

function New-CuttingPdf($payload) {
  Start-CuttingTimer
  Set-CuttingStage 'prepare_temp_files' 'create temp files'
  $root = Join-Path $env:TEMP ("cutting-pdf-" + [Guid]::NewGuid().ToString('N'))
  New-Item -ItemType Directory -Path $root | Out-Null
  $pdfPath = Join-Path $root 'cutting_output.pdf'
  Add-CuttingLog 'prepare_files' "root=$root"

  $templatePayloads = @()
  if ($payload.templates) {
    foreach ($item in @($payload.templates)) { $templatePayloads += $item }
  } else {
    $templatePayloads += $payload
  }
  if (-not $templatePayloads -or $templatePayloads.Count -eq 0) { throw '沒有可產生 PDF 的模板資料。' }

  $excel = $null
  $workbook = $null
  $printWorkbook = $null
  try {
    Set-CuttingStage 'start_excel' 'create Excel COM application'
    $excel = New-Object -ComObject Excel.Application
    $excel.Visible = $false
    $excel.ScreenUpdating = $false
    $excel.DisplayAlerts = $false
    $excel.EnableEvents = $false
    try { $excel.Calculation = -4135 } catch {}
    Add-CuttingLog 'start_excel'

    $allGroups = @()
    $templateIndex = 0
    foreach ($templatePayload in $templatePayloads) {
      $templateIndex++
      if (-not $templatePayload.templateBase64 -or -not $templatePayload.writes) {
        throw "BAD_TEMPLATE_PAYLOAD: index=$templateIndex"
      }

      $templatePath = Join-Path $root "template_${templateIndex}_original.xlsx"
      $workPath = Join-Path $root "template_${templateIndex}_work.xlsx"
      Set-CuttingStage 'decode_template' "index=$templateIndex; file=$($templatePayload.fileName)"
      $templateBytes = [Convert]::FromBase64String([string]$templatePayload.templateBase64)
      Set-CuttingStage 'write_temp_template' "index=$templateIndex; path=$templatePath"
      [System.IO.File]::WriteAllBytes($templatePath, $templateBytes)
      Copy-Item -LiteralPath $templatePath -Destination $workPath
      Add-CuttingLog 'prepare_template_file' "index=$templateIndex file=$($templatePayload.fileName)"

      Set-CuttingStage 'load_template_cache' "index=$templateIndex; read local template cache"
      $cache = Load-TemplateCache $templatePayload
      if ($null -ne $cache) {
        Add-CuttingLog 'cache_hit' "index=$templateIndex groups=$($cache.groups.Count)"
      } else {
        Add-CuttingLog 'cache_miss' "index=$templateIndex"
      }

      if ($null -eq $cache) {
      Set-CuttingStage 'open_workbook' "path=$workPath"
      $workbook = $excel.Workbooks.Open($workPath, $null, $true)
      Add-CuttingLog 'open_template'
      Set-CuttingStage 'build_template_cache' 'analyze template and export images'
        $cacheGroups = Build-TemplateCacheGroups $excel $workbook $templatePayload $workPath
        Add-CuttingLog 'build_template_cache' "index=$templateIndex groups=$($cacheGroups.Count)"
        $cache = Save-TemplateCache $templatePayload $cacheGroups
        Add-CuttingLog 'save_template_cache' "index=$templateIndex"
      $workbook.Close($false)
      Release-Com $workbook
      $workbook = $null
      }

      Set-CuttingStage 'prepare_cached_groups' "index=$templateIndex; apply order values to cached template"
      $groupsForPrint = Get-CachedGroupsForPayload $cache $templatePayload
      Add-CuttingLog 'prepare_cached_groups' "index=$templateIndex groups=$($groupsForPrint.Count); writes=$($templatePayload.writes.Count)"
      foreach ($group in $groupsForPrint) { $allGroups += $group }
    }

    if (-not $allGroups -or $allGroups.Count -eq 0) { throw '沒有任何有訂單數量的組可輸出。' }
    Set-CuttingStage 'keep_template_order' "groups=$($allGroups.Count)"
    Add-CuttingLog 'keep_template_order' "groups=$($allGroups.Count)"
    Set-CuttingStage 'build_compact_pdf_sheet' 'create compact print layout'
    $printWorkbook = Build-CompactWorkbook $excel $workbook $payload $allGroups
    Add-CuttingLog 'build_compact_workbook'
    Set-CuttingStage 'calculate_print_workbook' 'calculate before PDF export'
    try { $excel.CalculateFull() } catch { $excel.Calculate() }
    Add-CuttingLog 'calculate_print'
    Set-CuttingStage 'export_pdf' "path=$pdfPath"
    $printWorkbook.ExportAsFixedFormat(0, $pdfPath)
    Add-CuttingLog 'export_pdf'
    $printWorkbook.Close($false)
    Release-Com $printWorkbook
    $printWorkbook = $null
    if ($null -ne $workbook) {
      $workbook.Close($false)
      Release-Com $workbook
      $workbook = $null
    }
    $excel.Quit()
    Release-Com $excel
    $excel = $null
    return $pdfPath
  } finally {
    if ($null -ne $printWorkbook) {
      try { $printWorkbook.Close($false) } catch {}
      Release-Com $printWorkbook
    }
    if ($null -ne $workbook) {
      try { $workbook.Close($false) } catch {}
      Release-Com $workbook
    }
    if ($null -ne $excel) {
      try { $excel.Quit() } catch {}
      Release-Com $excel
    }
    Add-CuttingLog 'close_excel'
    [GC]::Collect()
    [GC]::WaitForPendingFinalizers()
  }
}

$listener.Start()
Write-Host "Cutting PDF local server started: $prefix"
Write-Host "本機裁帶 PDF 後台已啟動：$prefix"
Write-Host "Press Ctrl+C to stop / 按 Ctrl+C 停止"

while ($listener.IsListening) {
  $context = $listener.GetContext()
  $request = $context.Request
  $response = $context.Response
  try {
    Set-CuttingStage 'receive_request' $request.Url.AbsolutePath
    if ($request.HttpMethod -eq 'OPTIONS') {
      Send-Text $response 204 ''
      continue
    }
    if ($request.Url.AbsolutePath -eq '/health') {
      Send-Text $response 200 '{"ok":true,"service":"cutting-pdf-local"}'
      continue
    }
    if ($request.Url.AbsolutePath -ne '/cutting/pdf' -or $request.HttpMethod -ne 'POST') {
      Send-Text $response 404 '{"ok":false,"error":"NOT_FOUND"}'
      continue
    }

    $reader = [System.IO.StreamReader]::new($request.InputStream, [System.Text.Encoding]::UTF8)
    Set-CuttingStage 'read_request_body' 'read JSON body'
    $body = $reader.ReadToEnd()
    Set-CuttingStage 'parse_request_json' 'ConvertFrom-Json'
    $payload = $body | ConvertFrom-Json
    if ((-not $payload.templates) -and (-not $payload.templateBase64 -or -not $payload.writes)) {
      Send-Text $response 400 '{"ok":false,"error":"BAD_REQUEST"}'
      continue
    }
    $pdfPath = New-CuttingPdf $payload
    $name = if ($payload.outputName) { [string]$payload.outputName } else { 'cutting.pdf' }
    Send-File $response $pdfPath $name
  } catch {
    $message = ($_.Exception.Message -replace "`r?`n", ' ')
    Send-Json $response 500 @{
      ok = $false
      error = $message
      stage = $script:CuttingStage
      detail = $script:CuttingDetail
      timing = $script:CuttingLogs
    }
  }
}
