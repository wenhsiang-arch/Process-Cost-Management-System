param(
  [int]$Port = 8765
)

$ErrorActionPreference = 'Stop'
$script:IndexVersion = 15
$script:Prefix = "http://127.0.0.1:$Port/"
$script:Stage = ''
$script:Detail = ''
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
}

function Add-Log([string]$name, [string]$detail = '') {
  if ($null -eq $script:Timer) { Start-Timer }
  $total = [int]$script:Timer.ElapsedMilliseconds
  $lap = $total - $script:LastMs
  $script:LastMs = $total
  $line = "$name total=${total}ms lap=${lap}ms"
  if ($detail) { $line = "$line $detail" }
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
  $asciiName = ($safeName -replace '[^\x20-\x7E]', '_') -replace '[";\\]', '_'
  if (-not $asciiName) { $asciiName = 'cutting.pdf' }
  $encodedName = [System.Uri]::EscapeDataString($safeName)
  $response.StatusCode = 200
  $response.ContentType = 'application/pdf'
  $response.ContentLength64 = $bytes.Length
  $response.Headers.Add('Access-Control-Allow-Origin', '*')
  $response.Headers.Add('Access-Control-Allow-Methods', 'GET,POST,OPTIONS')
  $response.Headers.Add('Access-Control-Allow-Headers', 'Content-Type')
  $response.Headers.Add('Content-Disposition', "attachment; filename=""$asciiName""; filename*=UTF-8''$encodedName")
  $response.OutputStream.Write($bytes, 0, $bytes.Length)
  $response.Close()
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

function Remove-TemplateCache($payload) {
  Set-Stage 'delete_cache' 'remove template cache'
  $templateId = [string]$payload.templateId
  if (-not $templateId) { throw 'BAD_CACHE_DELETE_REQUEST' }
  $root = [System.IO.Path]::GetFullPath((Get-CacheRoot))
  $safeId = Safe-FileName $templateId
  $targets = @()

  if ($payload.templateUpdatedAt -and $payload.templateFileSize) {
    $key = Get-CacheKey $payload
    $path = Join-Path $root $key
    if (Test-Path -LiteralPath $path) { $targets += Get-Item -LiteralPath $path }
  } else {
    $targets = @(Get-ChildItem -LiteralPath $root -Directory -ErrorAction SilentlyContinue | Where-Object {
      $_.Name.StartsWith("$safeId-", [System.StringComparison]::OrdinalIgnoreCase)
    })
  }

  $deleted = 0
  foreach ($target in @($targets)) {
    $full = [System.IO.Path]::GetFullPath($target.FullName)
    $isInside = $full.StartsWith($root + [System.IO.Path]::DirectorySeparatorChar, [System.StringComparison]::OrdinalIgnoreCase)
    $isMatch = $target.Name.StartsWith("$safeId-", [System.StringComparison]::OrdinalIgnoreCase)
    if ($isInside -and $isMatch) {
      Remove-Item -LiteralPath $full -Recurse -Force -ErrorAction Stop
      $deleted++
    }
  }
  Add-Log 'delete_cache' "templateId=$templateId deleted=$deleted"
  return @{ ok = $true; deleted = $deleted }
}

function Remove-OldTemplateCacheVersions($payload) {
  $templateId = [string]$payload.templateId
  if (-not $templateId) { return 0 }
  $root = [System.IO.Path]::GetFullPath((Get-CacheRoot))
  $safeId = Safe-FileName $templateId
  $currentKey = Get-CacheKey $payload
  $deleted = 0
  try {
    $targets = @(Get-ChildItem -LiteralPath $root -Directory -ErrorAction SilentlyContinue | Where-Object {
      $_.Name.StartsWith("$safeId-", [System.StringComparison]::OrdinalIgnoreCase) -and
      -not $_.Name.Equals($currentKey, [System.StringComparison]::OrdinalIgnoreCase)
    })
    foreach ($target in @($targets)) {
      try {
        $full = [System.IO.Path]::GetFullPath($target.FullName)
        $isInside = $full.StartsWith($root + [System.IO.Path]::DirectorySeparatorChar, [System.StringComparison]::OrdinalIgnoreCase)
        $isMatch = $target.Name.StartsWith("$safeId-", [System.StringComparison]::OrdinalIgnoreCase)
        if ($isInside -and $isMatch) {
          Remove-Item -LiteralPath $full -Recurse -Force -ErrorAction Stop
          $deleted++
        }
      } catch {
        Add-Log 'clean_old_cache_failed' $_.Exception.Message
      }
    }
  } catch {
    Add-Log 'clean_old_cache_scan_failed' $_.Exception.Message
  }
  if ($deleted -gt 0) { Add-Log 'clean_old_cache' "templateId=$templateId deleted=$deleted" }
  return $deleted
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

function Normalize-PdfCellText([string]$text) {
  if ($null -eq $text) { return '' }
  $normalized = [string]$text
  $normalized = $normalized -replace "`r`n", "`n"
  $normalized = $normalized -replace "`r", "`n"
  $lines = @($normalized -split "`n" | ForEach-Object { ([string]$_).Trim() })
  return (($lines -join "`n").Trim())
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

function Get-TemplateCacheStatus($payload) {
  $cachedTemplateIds = @()
  foreach ($template in @($payload.templates)) {
    $indexDir = Join-Path (Get-CacheRoot) (Get-CacheKey $template)
    $indexPath = Join-Path $indexDir 'index.json'
    if (-not (Test-Path -LiteralPath $indexPath)) { continue }
    if ($null -ne (Load-TemplateIndex $template)) {
      $cachedTemplateIds += [string]$template.templateId
    }
  }
  return @{ ok = $true; cachedTemplateIds = $cachedTemplateIds }
}

function Get-OrBuildTemplateIndex($payload, [string]$templatePath) {
  $index = Load-TemplateIndex $payload
  if ($null -ne $index) {
    Add-Log 'index_hit' "file=$($payload.fileName)"
    return $index
  }
  Add-Log 'index_miss' "file=$($payload.fileName)"
  return Build-FixedTemplateIndex $payload $templatePath
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

function Get-XlsxSharedStrings($zip) {
  $values = @()
  $text = Get-ZipEntryText $zip 'xl/sharedStrings.xml'
  if (-not $text) { return $values }
  [xml]$xml = $text
  foreach ($item in @(Get-XmlNodesByLocalName $xml 'si')) {
    $parts = @(Get-XmlNodesByLocalName $item 't' | ForEach-Object { [string]$_.InnerText })
    $values += ($parts -join '')
  }
  return $values
}

function Get-XlsxCellText($cell, $sharedStrings) {
  if ($null -eq $cell) { return '' }
  $type = [string]$cell.GetAttribute('t')
  if ($type -eq 'inlineStr') {
    return [string]((Get-XmlNodesByLocalName $cell 't' | ForEach-Object { [string]$_.InnerText }) -join '')
  }
  $valueNode = Get-FirstXmlNodeByLocalName $cell 'v'
  if ($null -eq $valueNode) { return '' }
  $value = [string]$valueNode.InnerText
  if ($type -eq 's') {
    $index = 0
    if ([int]::TryParse($value, [ref]$index) -and $index -ge 0 -and $index -lt $sharedStrings.Count) {
      return [string]$sharedStrings[$index]
    }
  }
  return $value
}

function Get-XlsxRowMap($rowNode, $sharedStrings) {
  $map = @{}
  foreach ($cell in @(Get-XmlNodesByLocalName $rowNode 'c')) {
    $reference = ([string]$cell.GetAttribute('r')).ToUpperInvariant()
    if ($reference -notmatch '^([A-Z]+)\d+$') { continue }
    $map[$Matches[1]] = Get-XlsxCellText $cell $sharedStrings
  }
  return $map
}

function Convert-XlsxColumnLettersToNumber([string]$letters) {
  if ([string]::IsNullOrWhiteSpace($letters)) { return 0 }
  $number = 0
  foreach ($character in $letters.Trim().ToUpperInvariant().ToCharArray()) {
    $code = [int][char]$character
    if ($code -lt 65 -or $code -gt 90) { return 0 }
    $number = ($number * 26) + ($code - 64)
  }
  return $number
}

function Convert-XlsxColumnNumberToLetters([int]$number) {
  if ($number -le 0) { return '' }
  $letters = ''
  while ($number -gt 0) {
    $number--
    $letters = ([char](65 + ($number % 26))) + $letters
    $number = [int][Math]::Floor($number / 26)
  }
  return $letters
}

function Get-XlsxMergeCellMap($sheetXml, $rowsByNumber, [string]$sheetName, [int]$maxColumn = 11) {
  $map = @{}
  foreach ($mergeNode in @(Get-XmlNodesByLocalName $sheetXml 'mergeCell')) {
    $reference = ([string]$mergeNode.GetAttribute('ref')).ToUpperInvariant()
    if ($reference -notmatch '^([A-Z]+)(\d+):([A-Z]+)(\d+)$') { continue }
    $startLetter = [string]$Matches[1]
    $startRow = [int]$Matches[2]
    $endLetter = [string]$Matches[3]
    $endRow = [int]$Matches[4]
    $startColumn = Convert-XlsxColumnLettersToNumber $startLetter
    $endColumn = Convert-XlsxColumnLettersToNumber $endLetter
    if ($startRow -le 0 -or $endRow -lt $startRow -or $startColumn -le 0 -or $endColumn -lt $startColumn) { continue }

    $value = ''
    if ($rowsByNumber.ContainsKey($startRow) -and $rowsByNumber[$startRow].ContainsKey($startLetter)) {
      $value = [string]$rowsByNumber[$startRow][$startLetter]
    }
    $mergeInfo = [PSCustomObject]@{
      id = "$sheetName!$reference"
      reference = $reference
      value = $value
      anchorCell = "$startLetter$startRow"
      startRow = $startRow
      endRow = $endRow
      startColumn = $startColumn
      endColumn = $endColumn
    }
    $firstColumn = [Math]::Max(1, $startColumn)
    $lastColumn = [Math]::Min($maxColumn, $endColumn)
    if ($lastColumn -lt $firstColumn) { continue }
    for ($rowNumber = $startRow; $rowNumber -le $endRow; $rowNumber++) {
      for ($columnNumber = $firstColumn; $columnNumber -le $lastColumn; $columnNumber++) {
        $columnLetter = Convert-XlsxColumnNumberToLetters $columnNumber
        $map["$columnLetter$rowNumber"] = $mergeInfo
      }
    }
  }
  return $map
}

function Get-XlsxResolvedCellText($rowMap, [int]$rowNumber, [string]$columnLetter, $mergeCellMap) {
  $cellKey = "$($columnLetter.ToUpperInvariant())$rowNumber"
  if ($mergeCellMap.ContainsKey($cellKey)) { return [string]$mergeCellMap[$cellKey].value }
  if ($null -ne $rowMap -and $rowMap.ContainsKey($columnLetter)) { return [string]$rowMap[$columnLetter] }
  return ''
}

function Get-XlsxResolvedCellAddress([int]$rowNumber, [string]$columnLetter, $mergeCellMap) {
  $cellKey = "$($columnLetter.ToUpperInvariant())$rowNumber"
  if ($mergeCellMap.ContainsKey($cellKey)) { return [string]$mergeCellMap[$cellKey].anchorCell }
  return "$($columnLetter.ToUpperInvariant())$rowNumber"
}

function Get-XlsxCellMergeId([int]$rowNumber, [string]$columnLetter, $mergeCellMap) {
  $cellKey = "$($columnLetter.ToUpperInvariant())$rowNumber"
  if ($mergeCellMap.ContainsKey($cellKey)) { return [string]$mergeCellMap[$cellKey].id }
  return ''
}

function Get-XlsxColumnWidths($sheetXml) {
  $widths = @{}
  foreach ($column in @(Get-XmlNodesByLocalName $sheetXml 'col')) {
    $min = [int]$column.GetAttribute('min')
    $max = [int]$column.GetAttribute('max')
    $width = Convert-ToSafeDouble $column.GetAttribute('width')
    if ($min -le 0 -or $max -lt $min -or $width -le 0) { continue }
    for ($index = $min; $index -le [Math]::Min(11, $max); $index++) { $widths[$index] = $width }
  }
  return $widths
}

function Get-FixedTemplateColumns($headerRow, [int]$headerRowNumber, $widths, $mergeCellMap) {
  $keys = @('Image','Code','Color','Belt','Segment','CutSpec','Qty','Piece','Total','Shortage','Note')
  $letters = @('A','B','C','D','E','F','G','H','I','J','K')
  $columns = @()
  for ($index = 0; $index -lt $keys.Count; $index++) {
    $sourceColumn = $index + 1
    $width = if ($widths.ContainsKey($sourceColumn)) { [double]$widths[$sourceColumn] } else { 9.14 }
    # header（表頭文字）：表頭有合併儲存格時同樣使用左上角來源。
    $header = Normalize-PdfCellText (Get-XlsxResolvedCellText $headerRow $headerRowNumber $letters[$index] $mergeCellMap)
    $columns += [PSCustomObject]@{
      key = $keys[$index]
      sourceCol = $sourceColumn
      width = $width
      header = $header
    }
  }
  return $columns
}

function Test-FixedTemplateHeader($rowMap, [int]$rowNumber, $mergeCellMap) {
  $code = Normalize-HeaderText (Get-XlsxResolvedCellText $rowMap $rowNumber 'B' $mergeCellMap)
  $qty = Normalize-HeaderText (Get-XlsxResolvedCellText $rowMap $rowNumber 'G' $mergeCellMap)
  $piece = Normalize-HeaderText (Get-XlsxResolvedCellText $rowMap $rowNumber 'H' $mergeCellMap)
  $total = Normalize-HeaderText (Get-XlsxResolvedCellText $rowMap $rowNumber 'I' $mergeCellMap)
  return (
    $code.Contains('MAHANG') -and
    ($qty.Contains('SLPO') -or $qty.Contains('PCS')) -and
    $piece.Contains('SOKIEN') -and
    ($total.Contains('SLCAT') -or $total.Contains('THUCTE'))
  )
}

function Get-FixedModuleKey($columns) {
  return (@($columns | ForEach-Object { "$($_.key):$([Math]::Round([double]$_.width, 2))" }) -join '|')
}

function Add-FixedIndexedImage([string]$xlsxPath, [string]$mediaPath, [string]$imageDir, $imagesByHash, $imagesByMedia, [ref]$imageNo) {
  if (-not $mediaPath) { return '' }
  if ($imagesByMedia.ContainsKey($mediaPath)) { return [string]$imagesByMedia[$mediaPath] }
  $extension = [System.IO.Path]::GetExtension($mediaPath)
  if (-not $extension) { $extension = '.png' }
  $tempPath = Join-Path $imageDir ("image_pending_" + [Guid]::NewGuid().ToString('N') + $extension)
  try {
    if (-not (Copy-XlsxEntryToFile $xlsxPath $mediaPath $tempPath)) { return '' }
    $hash = Get-ImageHash $tempPath
    if (-not $hash) { return '' }
    if ($imagesByHash.ContainsKey($hash)) {
      $imageId = [string]$imagesByHash[$hash].id
      $imagesByMedia[$mediaPath] = $imageId
      return $imageId
    }
    $imageNo.Value++
    $imageId = "image_$($imageNo.Value)"
    $relativePath = "images/$imageId$extension"
    $finalPath = Join-Path (Split-Path -Parent $imageDir) $relativePath
    Move-Item -LiteralPath $tempPath -Destination $finalPath -Force
    $imagesByHash[$hash] = [PSCustomObject]@{ id = $imageId; hash = $hash; file = $relativePath }
    $imagesByMedia[$mediaPath] = $imageId
    return $imageId
  } finally {
    Remove-Item -LiteralPath $tempPath -Force -ErrorAction SilentlyContinue
  }
}

function Build-FixedTemplateIndex($payload, [string]$xlsxPath) {
  Set-Stage 'build_index' 'read fixed A-K template'
  if (-not $xlsxPath -or -not (Test-Path -LiteralPath $xlsxPath)) { throw 'TEMPLATE_CACHE_MISS' }
  $indexDir = Get-IndexDir $payload
  $imageDir = Join-Path $indexDir 'images'
  if (-not (Test-Path -LiteralPath $imageDir)) { New-Item -ItemType Directory -Path $imageDir | Out-Null }
  $embeddedImageMap = Get-XlsxEmbeddedImageMap $xlsxPath
  $zip = [System.IO.Compression.ZipFile]::OpenRead($xlsxPath)
  try {
    $sharedStrings = @(Get-XlsxSharedStrings $zip)
    $workbookText = Get-ZipEntryText $zip 'xl/workbook.xml'
    if (-not $workbookText) { throw 'INVALID_XLSX_WORKBOOK' }
    [xml]$workbookXml = $workbookText
    $workbookRels = Get-OpenXmlRels $zip 'xl/workbook.xml'
    $modulesByKey = @{}
    $groups = @()
    $imagesByHash = @{}
    $imagesByMedia = @{}
    $items = @()
    $moduleNo = 0
    $groupNo = 0
    $imageNo = 0
    $validRows = 0
    $mergeRangeCount = 0
    $fixedColumnLetters = [ordered]@{
      Image = 'A'
      Code = 'B'
      Color = 'C'
      Belt = 'D'
      Segment = 'E'
      CutSpec = 'F'
      Qty = 'G'
      Piece = 'H'
      Total = 'I'
      Shortage = 'J'
      Note = 'K'
    }

    foreach ($sheetNode in $workbookXml.GetElementsByTagName('sheet')) {
      $sheetName = [string]$sheetNode.GetAttribute('name')
      $relId = [string]$sheetNode.GetAttribute('id', 'http://schemas.openxmlformats.org/officeDocument/2006/relationships')
      if (-not $sheetName -or -not $workbookRels.ContainsKey($relId)) { continue }
      $sheetPath = [string]$workbookRels[$relId]
      $sheetText = Get-ZipEntryText $zip $sheetPath
      if (-not $sheetText) { continue }
      [xml]$sheetXml = $sheetText
      $widths = Get-XlsxColumnWidths $sheetXml
      $rowNodes = @(Get-XmlNodesByLocalName $sheetXml 'row')
      $rowsByNumber = @{}
      foreach ($rowNode in $rowNodes) {
        $rowNumber = [int]$rowNode.GetAttribute('r')
        if ($rowNumber -gt 0) { $rowsByNumber[$rowNumber] = Get-XlsxRowMap $rowNode $sharedStrings }
      }
      # mergeCellMap（合併儲存格索引）：保留匯入範本 A-K 的實際合併範圍、左上角內容與來源位置。
      $mergeCellMap = Get-XlsxMergeCellMap $sheetXml $rowsByNumber $sheetName 11
      $mergeRangeCount += @($mergeCellMap.Values | ForEach-Object { [string]$_.id } | Sort-Object -Unique).Count
      # headerRowNumbers（表頭列編號）：每個表頭到下一個表頭之間的所有有效 B 欄款號都要建立索引。
      $headerRowNumbers = @($rowsByNumber.Keys | Where-Object {
        Test-FixedTemplateHeader $rowsByNumber[$_] ([int]$_) $mergeCellMap
      } | Sort-Object)
      for ($headerIndex = 0; $headerIndex -lt $headerRowNumbers.Count; $headerIndex++) {
        $headerRowNumber = [int]$headerRowNumbers[$headerIndex]
        $headerRow = $rowsByNumber[$headerRowNumber]
        $nextHeaderRowNumber = if ($headerIndex + 1 -lt $headerRowNumbers.Count) {
          [int]$headerRowNumbers[$headerIndex + 1]
        } else {
          [int](($rowsByNumber.Keys | Measure-Object -Maximum).Maximum) + 1
        }
        $columns = @(Get-FixedTemplateColumns $headerRow $headerRowNumber $widths $mergeCellMap)
        $moduleKey = Get-FixedModuleKey $columns
        if (-not $modulesByKey.ContainsKey($moduleKey)) {
          $moduleNo++
          $modulesByKey[$moduleKey] = [PSCustomObject]@{
            id = "module_$moduleNo"
            key = $moduleKey
            columns = $columns
            headerHeight = 28.0
            groupHeight = 140.3
            sourceSheet = $sheetName
            sourceStartRow = $headerRowNumber
            sourceEndRow = $nextHeaderRowNumber - 1
          }
        }
        $module = $modulesByKey[$moduleKey]
        # embeddedImage（組別圖片）：使用完整原始組別範圍判斷一次，避免前後款號取得不同圖片。
        $embeddedImage = if ($embeddedImageMap.ContainsKey($sheetName)) {
          Find-EmbeddedImageInfo $embeddedImageMap[$sheetName] $headerRowNumber ($nextHeaderRowNumber - 1)
        } else { $null }
        $imageId = ''
        if ($null -ne $embeddedImage) {
          $imageId = Add-FixedIndexedImage $xlsxPath ([string]$embeddedImage.mediaPath) $imageDir $imagesByHash $imagesByMedia ([ref]$imageNo)
        }
        $groupNo++
        # sourceKey（原始組別識別）：只依工作表與原始表頭列定位，禁止依內容自行合併。
        $sourceKey = "$sheetName!R$headerRowNumber"
        $group = [PSCustomObject]@{
          id = "group_$groupNo"
          sourceKey = $sourceKey
          sheetName = $sheetName
          index = $groupNo
          moduleId = [string]$module.id
          imageId = $imageId
          columns = $columns
          startRow = $headerRowNumber
          endRow = $nextHeaderRowNumber - 1
          items = @()
        }
        for ($dataRowNumber = $headerRowNumber + 1; $dataRowNumber -lt $nextHeaderRowNumber; $dataRowNumber++) {
          # dataRow（資料列）：即使 XML（可延伸標記語言）沒有實體列，也要讓合併範圍提供左上角內容。
          $dataRow = if ($rowsByNumber.ContainsKey($dataRowNumber)) { $rowsByNumber[$dataRowNumber] } else { @{} }
          $code = (Get-XlsxResolvedCellText $dataRow $dataRowNumber 'B' $mergeCellMap).Trim().ToUpperInvariant()
          if ([string]::IsNullOrWhiteSpace($code)) { continue }
          $piece = Convert-ToSafeDouble (Get-XlsxResolvedCellText $dataRow $dataRowNumber 'H' $mergeCellMap)
          if ($piece -le 0) { continue }
          $validRows++

          $values = @{
            Image = Normalize-PdfCellText (Get-XlsxResolvedCellText $dataRow $dataRowNumber 'A' $mergeCellMap)
            Color = Normalize-PdfCellText (Get-XlsxResolvedCellText $dataRow $dataRowNumber 'C' $mergeCellMap)
            Belt = Normalize-PdfCellText (Get-XlsxResolvedCellText $dataRow $dataRowNumber 'D' $mergeCellMap)
            Segment = Normalize-PdfCellText (Get-XlsxResolvedCellText $dataRow $dataRowNumber 'E' $mergeCellMap)
            CutSpec = Normalize-PdfCellText (Get-XlsxResolvedCellText $dataRow $dataRowNumber 'F' $mergeCellMap)
            Shortage = Normalize-PdfCellText (Get-XlsxResolvedCellText $dataRow $dataRowNumber 'J' $mergeCellMap)
            Note = Normalize-PdfCellText (Get-XlsxResolvedCellText $dataRow $dataRowNumber 'K' $mergeCellMap)
          }
          $itemMerges = @{}
          foreach ($entry in $fixedColumnLetters.GetEnumerator()) {
            $mergeId = Get-XlsxCellMergeId $dataRowNumber ([string]$entry.Value) $mergeCellMap
            if ($mergeId) { $itemMerges[[string]$entry.Key] = $mergeId }
          }
          $item = [PSCustomObject]@{
            code = $code
            aliases = @($code)
            sheetName = $sheetName
            groupId = [string]$group.id
            moduleId = [string]$module.id
            imageId = $imageId
            rowNumber = $dataRowNumber
            qtyCell = Get-XlsxResolvedCellAddress $dataRowNumber 'G' $mergeCellMap
            pieceCell = Get-XlsxResolvedCellAddress $dataRowNumber 'H' $mergeCellMap
            totalCell = Get-XlsxResolvedCellAddress $dataRowNumber 'I' $mergeCellMap
            piece = $piece
            color = [string]$values.Color
            values = $values
            merges = $itemMerges
          }
          $group.items += $item
          $items += $item
        }
        if (@($group.items).Count -gt 0) {
          $groups += $group
        }
      }
    }
    if ($validRows -le 0) { throw 'FIXED_TEMPLATE_STRUCTURE_NOT_FOUND' }
    $index = [PSCustomObject]@{
      version = $script:IndexVersion
      schemaVersion = 'fixed-2026-07'
      templateId = [string]$payload.templateId
      fileName = [string]$payload.fileName
      templateUpdatedAt = [string]$payload.templateUpdatedAt
      templateFileSize = [string]$payload.templateFileSize
      createdAt = (Get-Date).ToString('s')
      modules = @($modulesByKey.Values)
      images = @($imagesByHash.Values)
      groups = $groups
      items = $items
    }
    [System.IO.File]::WriteAllText((Get-IndexPath $payload), ($index | ConvertTo-Json -Depth 40), [System.Text.Encoding]::UTF8)
    Add-Log 'build_index' "groups=$($groups.Count) items=$($items.Count) modules=$($modulesByKey.Count) images=$($imagesByHash.Count) merges=$mergeRangeCount"
    [void](Remove-OldTemplateCacheVersions $payload)
    return $index
  } finally {
    $zip.Dispose()
  }
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
  $indexDir = Get-IndexDir $payload
  $result = @()
  foreach ($group in @($index.groups)) {
    $visible = @()
    foreach ($item in @($group.items)) {
      $qtyKey = "$([string]$item.sheetName)!$([string]$item.qtyCell)".ToUpperInvariant()
      $qty = if ($writeMap.ContainsKey($qtyKey)) { [double]$writeMap[$qtyKey] } else { 0.0 }
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

function Split-HeadSideTextLine([string]$line) {
  $clean = ([string]$line).Trim()
  if ($clean -match '^(?i)(.*?(?:ĐẦU|DAU))\s+((?:TRÁI|TRAI)\s+(?:PHẢI|PHAI).*)$') {
    $left = ([string]$Matches[1]).Trim()
    $right = ([string]$Matches[2]).Trim()
    if ($left -and $right) { return @($left, $right) }
  }
  return @($clean)
}

function Get-DisplayTextLines([string]$text) {
  $value = Normalize-PdfCellText $text
  if (-not $value) { return @('') }
  if ($value.Contains("`n")) {
    $result = @()
    foreach ($line in @($value -split "`n" | ForEach-Object { ([string]$_).Trim() })) {
      $result += @(Split-HeadSideTextLine $line)
    }
    return $result
  }
  $flat = ($value -replace '\s+', ' ').Trim()
  $headSideLines = @(Split-HeadSideTextLine $flat)
  if ($headSideLines.Count -gt 1) { return $headSideLines }
  if ($flat -match '^\d+(?:\.\d+)?\s*MM\s*[*xX×]\s*\d+(?:\.\d+)?\s*MM$') {
    return @($flat)
  }
  if ($flat -match '^(\d+(?:\.\d+)?\s*MM\s*[*xX×]\s*\d+(?:\.\d+)?\s*MM)(.+)$') {
    $left = ([string]$Matches[1]).Trim()
    $right = ([string]$Matches[2]).Trim()
    if ($left -and $right) { return @($left, $right) }
  }
  if ($flat -match '^(.*?MM)(.+)$') {
    $left = ([string]$Matches[1]).Trim()
    $right = ([string]$Matches[2]).Trim()
    if ($left -and $right) { return @($left, $right) }
  }
  return @($flat)
}

# Get-FitTextLinesFontSize（多行文字合適字級）：同時計算最長行寬與全部行高。
function Get-FitTextLinesFontSize($graphics, [string[]]$lines, [float]$maxSize, [float]$minSize, [float]$width, [float]$height, [int]$style = 0) {
  $cleanLines = @($lines | ForEach-Object { ([string]$_).Trim() } | Where-Object { $_ -ne '' })
  if ($cleanLines.Count -eq 0) { return $maxSize }
  $size = $maxSize
  while ($size -gt $minSize) {
    $font = [System.Drawing.Font]::new('Arial', [single]$size, [System.Drawing.FontStyle]$style)
    try {
      $fitsWidth = $true
      foreach ($line in $cleanLines) {
        if ($graphics.MeasureString([string]$line, $font).Width -gt ($width + 2)) {
          $fitsWidth = $false
          break
        }
      }
      $lineHeight = [float]($font.GetHeight($graphics) * 1.18)
      if ($fitsWidth -and (($lineHeight * $cleanLines.Count) -le ($height + 2))) { return [float]$size }
    } finally {
      $font.Dispose()
    }
    $size -= 0.5
  }
  return [float]$minSize
}

function Draw-CenteredTextLines($graphics, [string[]]$lines, [System.Drawing.RectangleF]$rect, [float]$maxSize = 12, [float]$minSize = 3.0, [bool]$bold = $false, $brush = $null, [float]$fixedSize = 0) {
  if ($null -eq $brush) { $brush = [System.Drawing.Brushes]::Black }
  $cleanLines = @($lines | ForEach-Object { ([string]$_).Trim() } | Where-Object { $_ -ne '' })
  if ($cleanLines.Count -eq 0) { $cleanLines = @('') }
  $style = if ($bold) { [System.Drawing.FontStyle]::Bold } else { [System.Drawing.FontStyle]::Regular }
  # fontSize（實際字級）：指定共同字級時不再讓每格文字各自放大。
  $fontSize = if ($fixedSize -gt 0) {
    [Math]::Max($minSize, [Math]::Min($maxSize, $fixedSize))
  } else {
    Get-FitTextLinesFontSize $graphics $cleanLines $maxSize $minSize $rect.Width $rect.Height $style
  }
  $font = [System.Drawing.Font]::new('Arial', [single]$fontSize, [System.Drawing.FontStyle]$style)
  try {
    $lineHeight = [float]($font.GetHeight($graphics) * 1.18)
    $blockHeight = [float]($lineHeight * $cleanLines.Count)
    $startY = [float]($rect.Y + (($rect.Height - $blockHeight) / 2))
    $format = New-Object System.Drawing.StringFormat
    try {
      $format.Alignment = [System.Drawing.StringAlignment]::Center
      $format.LineAlignment = [System.Drawing.StringAlignment]::Center
      $format.Trimming = [System.Drawing.StringTrimming]::None
      $format.FormatFlags = [System.Drawing.StringFormatFlags]::NoWrap
      for ($i = 0; $i -lt $cleanLines.Count; $i++) {
        $lineRect = [System.Drawing.RectangleF]::new($rect.X, $startY + ($i * $lineHeight), $rect.Width, $lineHeight)
        $graphics.DrawString([string]$cleanLines[$i], $font, $brush, $lineRect, $format)
      }
    } finally {
      $format.Dispose()
    }
  } finally {
    $font.Dispose()
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

function Draw-BodyCellText($graphics, [string]$key, [string]$value, [System.Drawing.RectangleF]$rect, [bool]$bold = $false, [float]$fixedSize = 0) {
  $lines = Get-DisplayTextLines $value
  Draw-CenteredTextLines $graphics $lines $rect 11 3.0 ($bold -or $key -eq 'Code') $null $fixedSize
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

function Draw-Group($graphics, $printGroup, [float]$pageWidth, [float]$top, [float]$groupHeight, $bodyFontSizes = $null) {
  $columns = @($printGroup.module.columns)
  $headerColumns = @()
  if ($null -ne $printGroup.group -and $null -ne $printGroup.group.PSObject.Properties['columns']) {
    $headerColumns = @($printGroup.group.columns | Where-Object { $null -ne $_ })
  }
  $headerHeight = 28.0
  $items = @($printGroup.items)
  $detailHeight = Get-PrintDetailHeight $printGroup $groupHeight
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
      $headerText = [string]$column.header
      foreach ($headerColumn in $headerColumns) {
        if ([string]$headerColumn.key -eq $key) {
          $headerText = [string]$headerColumn.header
          break
        }
      }
      Draw-CenteredText $graphics $headerText $headerRect 11 6 $true $white
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
    $mergeGroups = @{}
    $bodyColumnKeys = @($columns | ForEach-Object { [string]$_.key } | Where-Object { $_ -ne 'Image' -and $rects.ContainsKey($_) })
    for ($rowIndex = 0; $rowIndex -lt $items.Count; $rowIndex++) {
      for ($columnIndex = 0; $columnIndex -lt $bodyColumnKeys.Count; $columnIndex++) {
        $key = [string]$bodyColumnKeys[$columnIndex]
        $mergeId = Get-ValueFromMap $items[$rowIndex].merges $key
        if (-not $mergeId) { continue }
        if (-not $mergeGroups.ContainsKey($mergeId)) { $mergeGroups[$mergeId] = @() }
        $mergeGroups[$mergeId] += [PSCustomObject]@{
          rowIndex = $rowIndex
          columnIndex = $columnIndex
          key = $key
          value = Get-PrintableCellValue $items[$rowIndex] $key
        }
      }
    }
    foreach ($mergeId in @($mergeGroups.Keys)) {
      $mergeParts = @($mergeGroups[$mergeId])
      if ($mergeParts.Count -le 1) { continue }
      $orderedParts = @($mergeParts | Sort-Object rowIndex, columnIndex)
      $firstPart = $orderedParts[0]
      $minRowIndex = [int](($mergeParts | Measure-Object rowIndex -Minimum).Minimum)
      $maxRowIndex = [int](($mergeParts | Measure-Object rowIndex -Maximum).Maximum)
      $minColumnIndex = [int](($mergeParts | Measure-Object columnIndex -Minimum).Minimum)
      $maxColumnIndex = [int](($mergeParts | Measure-Object columnIndex -Maximum).Maximum)
      $firstKey = [string]$bodyColumnKeys[$minColumnIndex]
      $lastKey = [string]$bodyColumnKeys[$maxColumnIndex]
      $firstCell = $rects[$firstKey]
      $lastCell = $rects[$lastKey]
      $mergeTop = $top + $headerHeight + ($minRowIndex * $detailHeight)
      $mergeHeight = ($maxRowIndex - $minRowIndex + 1) * $detailHeight
      $mergeWidth = ($lastCell.X + $lastCell.Width) - $firstCell.X
      $mergeRect = [System.Drawing.RectangleF]::new($firstCell.X, $mergeTop, $mergeWidth, $mergeHeight)
      $mergeKeys = @($mergeParts.key | Sort-Object -Unique)
      $mergedCells += [PSCustomObject]@{
        key = [string]$firstPart.key
        keys = $mergeKeys
        rect = $mergeRect
        value = [string]$firstPart.value
      }
      for ($rowNo = $minRowIndex; $rowNo -le $maxRowIndex; $rowNo++) {
        for ($columnNo = $minColumnIndex; $columnNo -le $maxColumnIndex; $columnNo++) {
          $skipCells["$([string]$bodyColumnKeys[$columnNo])|$rowNo"] = $true
        }
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
        $fontSize = if ($null -ne $bodyFontSizes -and $bodyFontSizes.ContainsKey($key)) { [float]$bodyFontSizes[$key] } else { 0.0 }
        Draw-BodyCellText $graphics $key $value $rowRect ($key -eq 'Total') $fontSize
      }
    }

    foreach ($mergedCell in $mergedCells) {
      $mergeRect = $mergedCell.rect
      $mergeKeys = @($mergedCell.keys)
      if ($mergeKeys -contains 'Total') { $graphics.FillRectangle($cream, $mergeRect) } else { $graphics.FillRectangle([System.Drawing.Brushes]::White, $mergeRect) }
      $graphics.DrawRectangle($linePen, $mergeRect.X, $mergeRect.Y, $mergeRect.Width, $mergeRect.Height)
      $mergeKey = [string]$mergedCell.key
      $fontSize = if ($null -ne $bodyFontSizes -and $bodyFontSizes.ContainsKey($mergeKey)) { [float]$bodyFontSizes[$mergeKey] } else { 0.0 }
      Draw-BodyCellText $graphics $mergeKey ([string]$mergedCell.value) $mergeRect ($mergeKeys -contains 'Total') $fontSize
    }

  } finally {
    $green.Dispose()
    $linePen.Dispose()
    $cream.Dispose()
  }
}

function Format-ReportValue($value) {
  if ($null -eq $value) { return '' }
  $text = [string]$value
  if ([string]::IsNullOrWhiteSpace($text)) { return '' }
  $number = 0.0
  if ([double]::TryParse($text, [System.Globalization.NumberStyles]::Any, [System.Globalization.CultureInfo]::InvariantCulture, [ref]$number)) {
    if ([Math]::Abs($number - [Math]::Round($number)) -lt 0.0001) { return ('{0:N0}' -f $number) }
    return (('{0:N2}' -f $number).TrimEnd('0').TrimEnd('.'))
  }
  return $text
}

function Get-ReportField($row, [string]$name) {
  if ($null -eq $row) { return '' }
  $property = $row.PSObject.Properties[$name]
  if ($null -eq $property) { return '' }
  return $property.Value
}

function Get-ReportSummary($rows) {
  $qtyTotal = 0.0
  $cutTotal = 0.0
  $hasQty = $false
  $hasCutTotal = $false
  foreach ($row in @($rows)) {
    $qtyRaw = Get-ReportField $row 'qty'
    if (-not [string]::IsNullOrWhiteSpace([string]$qtyRaw)) {
      $qtyTotal += Convert-ToSafeDouble $qtyRaw
      $hasQty = $true
    }
    $totalRaw = Get-ReportField $row 'total'
    if (-not [string]::IsNullOrWhiteSpace([string]$totalRaw)) {
      $cutTotal += Convert-ToSafeDouble $totalRaw
      $hasCutTotal = $true
    }
  }
  return [PSCustomObject]@{
    qty = if ($hasQty) { $qtyTotal } else { '' }
    piece = ''
    total = if ($hasCutTotal) { $cutTotal } else { '' }
  }
}

function Draw-ReportText($graphics, [string]$text, [System.Drawing.RectangleF]$rect, [float]$maxSize = 15, [float]$minSize = 8, [bool]$bold = $false, [string]$align = 'Near') {
  $style = if ($bold) { [System.Drawing.FontStyle]::Bold } else { [System.Drawing.FontStyle]::Regular }
  $font = Get-FitSingleLineFont $graphics $text 'Microsoft JhengHei' $maxSize $minSize $rect.Width $style
  $format = New-Object System.Drawing.StringFormat
  try {
    if ($align -eq 'Center') {
      $format.Alignment = [System.Drawing.StringAlignment]::Center
    } elseif ($align -eq 'Far') {
      $format.Alignment = [System.Drawing.StringAlignment]::Far
    } else {
      $format.Alignment = [System.Drawing.StringAlignment]::Near
    }
    $format.LineAlignment = [System.Drawing.StringAlignment]::Center
    $format.Trimming = [System.Drawing.StringTrimming]::EllipsisCharacter
    $format.FormatFlags = [System.Drawing.StringFormatFlags]::NoWrap
    $graphics.DrawString($text, $font, [System.Drawing.Brushes]::Black, $rect, $format)
  } finally {
    $format.Dispose()
    $font.Dispose()
  }
}

function Draw-ReportHeaderText($graphics, [string]$topText, [string]$bottomText, [System.Drawing.RectangleF]$rect) {
  $topRect = [System.Drawing.RectangleF]::new($rect.X + 2.0, $rect.Y + 3.0, $rect.Width - 4.0, ($rect.Height / 2.0) - 2.0)
  $bottomRect = [System.Drawing.RectangleF]::new($rect.X + 2.0, $rect.Y + ($rect.Height / 2.0), $rect.Width - 4.0, ($rect.Height / 2.0) - 3.0)
  Draw-ReportText $graphics $topText $topRect 10.5 6.0 $true 'Center'
  Draw-ReportText $graphics $bottomText $bottomRect 10.0 6.0 $false 'Center'
}

function Draw-ReportTable($graphics, [string]$title, $rows, [float]$x, [float]$y, [float]$bottom, $summary = $null) {
  $width = 535.0
  $titleHeight = 30.0
  $headerHeight = 34.0
  $rowHeight = 20.0
  $columns = @()
  $columns += [PSCustomObject]@{ name = 'code'; vi = 'Mã hàng'; zh = '款號'; x = $x; width = 170.0; align = 'Near' }
  $columns += [PSCustomObject]@{ name = 'qty'; vi = 'SL đơn'; zh = '訂單數量'; x = $x + 170.0; width = 105.0; align = 'Center' }
  $columns += [PSCustomObject]@{ name = 'piece'; vi = 'Số kiện'; zh = '工序段'; x = $x + 275.0; width = 110.0; align = 'Center' }
  $columns += [PSCustomObject]@{ name = 'total'; vi = 'Tổng công đoạn'; zh = '總共工序段'; x = $x + 385.0; width = 150.0; align = 'Center' }
  $borderPen = [System.Drawing.Pen]::new([System.Drawing.Color]::FromArgb(80, 80, 80), 0.8)
  $lightPen = [System.Drawing.Pen]::new([System.Drawing.Color]::FromArgb(150, 150, 150), 0.5)
  $headerBrush = [System.Drawing.SolidBrush]::new([System.Drawing.Color]::FromArgb(238, 243, 250))
  $summaryBrush = [System.Drawing.SolidBrush]::new([System.Drawing.Color]::FromArgb(248, 250, 252))
  try {
    $titleRect = [System.Drawing.RectangleF]::new($x, $y, $width, $titleHeight)
    $graphics.FillRectangle($headerBrush, $titleRect)
    $graphics.DrawRectangle($borderPen, $titleRect.X, $titleRect.Y, $titleRect.Width, $titleRect.Height)
    Draw-ReportText $graphics $title ([System.Drawing.RectangleF]::new($x + 4.0, $y, $width - 8.0, $titleHeight)) 13.5 7.0 $true 'Center'
    $headerY = $y + $titleHeight
    foreach ($col in $columns) {
      $rect = [System.Drawing.RectangleF]::new([float]$col.x, $headerY, [float]$col.width, $headerHeight)
      $graphics.FillRectangle($headerBrush, $rect)
      $graphics.DrawRectangle($borderPen, $rect.X, $rect.Y, $rect.Width, $rect.Height)
      Draw-ReportHeaderText $graphics ([string]$col.vi) ([string]$col.zh) $rect
    }
    $rowY = $headerY + $headerHeight
    foreach ($row in @($rows)) {
      if ($rowY + $rowHeight -gt $bottom) { break }
      foreach ($col in $columns) {
        $rect = [System.Drawing.RectangleF]::new([float]$col.x, $rowY, [float]$col.width, $rowHeight)
        $graphics.DrawRectangle($lightPen, $rect.X, $rect.Y, $rect.Width, $rect.Height)
        $raw = Get-ReportField $row ([string]$col.name)
        $value = if ($col.name -eq 'code') { [string]$raw } else { Format-ReportValue $raw }
        $textRect = [System.Drawing.RectangleF]::new($rect.X + 4.0, $rect.Y, $rect.Width - 8.0, $rect.Height)
        Draw-ReportText $graphics $value $textRect 10.5 6.0 $false ([string]$col.align)
      }
      $rowY += $rowHeight
    }
    if ($null -ne $summary -and $rowY + $rowHeight -le $bottom) {
      foreach ($col in $columns) {
        $rect = [System.Drawing.RectangleF]::new([float]$col.x, $rowY, [float]$col.width, $rowHeight)
        $graphics.FillRectangle($summaryBrush, $rect)
        $graphics.DrawRectangle($borderPen, $rect.X, $rect.Y, $rect.Width, $rect.Height)
        if ($col.name -eq 'code') {
          $value = 'Tổng cộng / 總數'
        } elseif ($col.name -eq 'piece') {
          $value = ''
        } else {
          $value = Format-ReportValue (Get-ReportField $summary ([string]$col.name))
        }
        $textRect = [System.Drawing.RectangleF]::new($rect.X + 4.0, $rect.Y, $rect.Width - 8.0, $rect.Height)
        Draw-ReportText $graphics $value $textRect 10.5 6.0 $true ([string]$col.align)
      }
    }
  } finally {
    $borderPen.Dispose()
    $lightPen.Dispose()
    $headerBrush.Dispose()
    $summaryBrush.Dispose()
  }
}

function Get-PdfRenderOptions($payload) {
  # renderOptions（繪圖品質設定）：mode（模式）、width（寬度）、height（高度）、jpegQuality（JPEG 品質）、isHighQuality（是否高品質）。
  $mode = if ([string]$payload.pdfQuality -eq 'high') { 'high' } else { 'standard' } # mode（品質模式）
  if ($mode -eq 'high') {
    return [PSCustomObject]@{ mode = 'high'; width = 2480; height = 3508; jpegQuality = 100; isHighQuality = $true }
  }
  return [PSCustomObject]@{ mode = 'standard'; width = 1240; height = 1754; jpegQuality = 0; isHighQuality = $false }
}

# Save-BitmapAsJpeg（儲存 JPEG 圖片）：標準品質沿用原本設定，高品質才指定壓縮品質。
function Save-BitmapAsJpeg([System.Drawing.Bitmap]$bitmap, [string]$path, [int]$jpegQuality = 0) {
  if ($jpegQuality -le 0) {
    $bitmap.Save($path, [System.Drawing.Imaging.ImageFormat]::Jpeg)
    return
  }
  # codec（圖片編碼器）
  $codec = [System.Drawing.Imaging.ImageCodecInfo]::GetImageEncoders() |
    Where-Object { $_.MimeType -eq 'image/jpeg' } |
    Select-Object -First 1
  if ($null -eq $codec) { throw 'JPEG_ENCODER_NOT_FOUND（找不到 JPEG 圖片編碼器）' }
  $encoderParameters = [System.Drawing.Imaging.EncoderParameters]::new(1) # encoderParameters（圖片編碼參數集合）
  $encoderParameter = [System.Drawing.Imaging.EncoderParameter]::new( # encoderParameter（圖片編碼參數）
    [System.Drawing.Imaging.Encoder]::Quality,
    [int64]$jpegQuality
  )
  try {
    $encoderParameters.Param[0] = $encoderParameter
    $bitmap.Save($path, $codec, $encoderParameters)
  } finally {
    $encoderParameter.Dispose()
    $encoderParameters.Dispose()
  }
}

function Save-ReportImage($sections, [string]$path, $renderOptions) {
  $width = [int]$renderOptions.width
  $height = [int]$renderOptions.height
  $bitmap = New-Object System.Drawing.Bitmap $width, $height
  try {
    $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
    try {
      $graphics.Clear([System.Drawing.Color]::White)
      $graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
      $graphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
      if ([bool]$renderOptions.isHighQuality) {
        $graphics.TextRenderingHint = [System.Drawing.Text.TextRenderingHint]::AntiAliasGridFit
        $graphics.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
        $graphics.CompositingQuality = [System.Drawing.Drawing2D.CompositingQuality]::HighQuality
      }
      $scaleX = $width / 595.0
      $scaleY = $height / 842.0
      $graphics.ScaleTransform($scaleX, $scaleY)
      foreach ($section in @($sections)) {
        Draw-ReportTable $graphics ([string]$section.title) @($section.rows) ([float]$section.x) ([float]$section.y) ([float]$section.bottom) $section.summary
      }
    } finally {
      $graphics.Dispose()
    }
    Save-BitmapAsJpeg $bitmap $path ([int]$renderOptions.jpegQuality)
  } finally {
    $bitmap.Dispose()
  }
}

function Save-ReportPages($report, [string]$root, $renderOptions) {
  if ($null -eq $report) { return @() }
  $completedRows = @($report.completed)
  $missingRows = @($report.missing)
  $completedCount = if ($report.completedCount -ne $null) { [int](Convert-ToSafeDouble $report.completedCount) } else { $completedRows.Count }
  $missingCount = if ($report.missingCount -ne $null) { [int](Convert-ToSafeDouble $report.missingCount) } else { $missingRows.Count }
  $pages = @()
  $completedSummary = Get-ReportSummary $completedRows
  $missingSummary = Get-ReportSummary $missingRows
  if ($completedRows.Count -le 14 -and $missingRows.Count -le 14) {
    $path = Join-Path $root 'report_1.jpg'
    $sections = @(
      [PSCustomObject]@{ title = "Danh sách mã hàng hoàn tất / 已完成款號（總共$($completedCount)個）"; rows = $completedRows; summary = $completedSummary; x = 30.0; y = 35.0; bottom = 405.0 },
      [PSCustomObject]@{ title = "Công đoạn thiếu tệp / 缺少檔案的工序段（總共$($missingCount)個）"; rows = $missingRows; summary = $missingSummary; x = 30.0; y = 445.0; bottom = 812.0 }
    )
    Save-ReportImage $sections $path $renderOptions
    return @($path)
  }
  $pageIndex = 0
  foreach ($sectionData in @(
    [PSCustomObject]@{ title = "Danh sách mã hàng hoàn tất / 已完成款號（總共$($completedCount)個）"; rows = $completedRows; summary = $completedSummary },
    [PSCustomObject]@{ title = "Công đoạn thiếu tệp / 缺少檔案的工序段（總共$($missingCount)個）"; rows = $missingRows; summary = $missingSummary }
  )) {
    $rows = @($sectionData.rows)
    if ($rows.Count -eq 0) {
      continue
    }
    for ($i = 0; $i -lt $rows.Count; $i += 34) {
      $take = [Math]::Min(34, $rows.Count - $i)
      $chunk = @($rows[$i..($i + $take - 1)])
      $pageIndex++
      $path = Join-Path $root ("report_{0}.jpg" -f $pageIndex)
      $isLastChunk = ($i + $take) -ge $rows.Count
      $summary = if ($isLastChunk) { $sectionData.summary } else { $null }
      $sections = @([PSCustomObject]@{ title = [string]$sectionData.title; rows = $chunk; summary = $summary; x = 30.0; y = 35.0; bottom = 812.0 })
      Save-ReportImage $sections $path $renderOptions
      $pages += $path
    }
  }
  return $pages
}

# Get-StandardDetailHeight（五格標準列高）：第六格起沿用此列高增加組別高度。
function Get-StandardDetailHeight() {
  return (140.3 - 28.0) / 5.0
}

function Get-PrintGroupHeight($printGroup) {
  $itemCount = @($printGroup.items).Count
  if ($itemCount -le 5) { return 140.3 }
  $detailHeight = Get-StandardDetailHeight
  return 28.0 + ($itemCount * $detailHeight)
}

# Get-PrintDetailHeight（實際款號列高）：1～5 格平均填滿固定高度，第六格起使用五格標準列高。
function Get-PrintDetailHeight($printGroup, [float]$groupHeight) {
  $itemCount = @($printGroup.items).Count
  if ($itemCount -le 0) { return [Math]::Max(1.0, $groupHeight - 28.0) }
  if ($itemCount -le 5) { return ($groupHeight - 28.0) / $itemCount }
  return Get-StandardDetailHeight
}

# Get-BodyFontSizesForGroups（報表欄位共同字級）：以整份 PDF 的最長內容決定各欄統一字級。
function Get-BodyFontSizesForGroups($groups, [float]$pageWidth = 595.0) {
  $fontSizes = @{}
  $bitmap = New-Object System.Drawing.Bitmap 16, 16
  try {
    $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
    try {
      $graphics.ScaleTransform((1240.0 / 595.0), (1754.0 / 842.0))
      foreach ($printGroup in @($groups)) {
        $groupHeight = [float](Get-PrintGroupHeight $printGroup)
        $detailHeight = [float](Get-PrintDetailHeight $printGroup $groupHeight)
        $columns = @($printGroup.module.columns)
        $rects = Get-ColumnRects $columns 0.0 0.0 $pageWidth $groupHeight
        foreach ($column in $columns) {
          $key = [string]$column.key
          if ($key -eq 'Image' -or -not $rects.ContainsKey($key)) { continue }
          $style = if ($key -in @('Code','Total')) { [System.Drawing.FontStyle]::Bold } else { [System.Drawing.FontStyle]::Regular }
          foreach ($item in @($printGroup.items)) {
            $value = Get-PrintableCellValue $item $key
            if ([string]::IsNullOrWhiteSpace([string]$value)) { continue }
            $lines = Get-DisplayTextLines $value
            $fitSize = [float](Get-FitTextLinesFontSize $graphics $lines 11.0 3.0 ([float]$rects[$key].Width) $detailHeight $style)
            if (-not $fontSizes.ContainsKey($key) -or $fitSize -lt [float]$fontSizes[$key]) {
              $fontSizes[$key] = $fitSize
            }
          }
        }
      }
    } finally {
      $graphics.Dispose()
    }
  } finally {
    $bitmap.Dispose()
  }
  return $fontSizes
}

function Split-PrintGroupsIntoPages($groups) {
  $pages = @()
  $current = @()
  $usedHeight = 0.0
  foreach ($group in @($groups)) {
    $height = Get-PrintGroupHeight $group
    if ($height -gt 842.0) { throw 'GROUP_EXCEEDS_A4_PAGE' }
    if ($current.Count -gt 0 -and ($usedHeight + $height) -gt 842.0) {
      $pages += [PSCustomObject]@{ groups = @($current) }
      $current = @()
      $usedHeight = 0.0
    }
    $current += $group
    $usedHeight += $height
  }
  if ($current.Count -gt 0) { $pages += [PSCustomObject]@{ groups = @($current) } }
  return $pages
}

function Save-JpegPage($groups, [string]$path, $bodyFontSizes, $renderOptions) {
  $width = [int]$renderOptions.width
  $height = [int]$renderOptions.height
  $bitmap = New-Object System.Drawing.Bitmap $width, $height
  try {
    $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
    try {
      $graphics.Clear([System.Drawing.Color]::White)
      $graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
      $graphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
      if ([bool]$renderOptions.isHighQuality) {
        $graphics.TextRenderingHint = [System.Drawing.Text.TextRenderingHint]::AntiAliasGridFit
        $graphics.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
        $graphics.CompositingQuality = [System.Drawing.Drawing2D.CompositingQuality]::HighQuality
      }
      $scaleX = $width / 595.0
      $scaleY = $height / 842.0
      $graphics.ScaleTransform($scaleX, $scaleY)
      $top = 0.0
      foreach ($group in @($groups)) {
        $groupHeight = Get-PrintGroupHeight $group
        Draw-Group $graphics $group 595.0 ([float]$top) ([float]$groupHeight) $bodyFontSizes
        $top += $groupHeight
      }
    } finally {
      $graphics.Dispose()
    }
    Save-BitmapAsJpeg $bitmap $path ([int]$renderOptions.jpegQuality)
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
    if (-not $templatePayload.writes) { throw "BAD_TEMPLATE_PAYLOAD: index=$templateIndex" }
    $templatePath = ''
    if ($templatePayload.templateBase64) {
      $templatePath = Join-Path $root "template_${templateIndex}.xlsx"
      [System.IO.File]::WriteAllBytes($templatePath, [Convert]::FromBase64String([string]$templatePayload.templateBase64))
    }
    $index = Get-OrBuildTemplateIndex $templatePayload $templatePath
    $groups = @(Get-PrintableGroups $index $templatePayload)
    Add-Log 'select_groups' "index=$templateIndex groups=$($groups.Count)"
    $printGroups += $groups
  }
  if ($printGroups.Count -eq 0) { throw '沒有符合列印條件的款號資料。' }
  $bodyFontSizes = Get-BodyFontSizesForGroups $printGroups 595.0
  $fontSizeLog = @($bodyFontSizes.Keys | Sort-Object | ForEach-Object { "$_=$([Math]::Round([double]$bodyFontSizes[$_], 1))" }) -join ','
  Add-Log 'body_font_sizes' $fontSizeLog
  $renderOptions = Get-PdfRenderOptions $payload
  Add-Log 'render_quality' "mode=$($renderOptions.mode) width=$($renderOptions.width) height=$($renderOptions.height) jpegQuality=$($renderOptions.jpegQuality)"
  $pageImages = @()
  $reportPages = @(Save-ReportPages $payload.report $root $renderOptions)
  if ($reportPages.Count -gt 0) {
    $pageImages += $reportPages
    Add-Log 'render_report' "pages=$($reportPages.Count)"
  }
  $packedPages = @(Split-PrintGroupsIntoPages $printGroups)
  for ($i = 0; $i -lt $packedPages.Count; $i++) {
    $pageGroups = @($packedPages[$i].groups)
    $jpgPath = Join-Path $root ("page_{0}.jpg" -f ($i + 1))
    Save-JpegPage $pageGroups $jpgPath $bodyFontSizes $renderOptions
    $pageImages += $jpgPath
    Add-Log 'render_page' "page=$($pageImages.Count) groups=$($pageGroups.Count)"
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
    if ($request.Url.AbsolutePath -eq '/cutting/cache/status' -and $request.HttpMethod -eq 'POST') {
      $reader = [System.IO.StreamReader]::new($request.InputStream, [System.Text.Encoding]::UTF8)
      try { $body = $reader.ReadToEnd() } finally { $reader.Dispose() }
      $payload = $body | ConvertFrom-Json
      Send-Json $response 200 (Get-TemplateCacheStatus $payload)
      continue
    }
    if ($request.Url.AbsolutePath -eq '/cutting/cache' -and $request.HttpMethod -eq 'POST') {
      $reader = [System.IO.StreamReader]::new($request.InputStream, [System.Text.Encoding]::UTF8)
      try { $body = $reader.ReadToEnd() } finally { $reader.Dispose() }
      $payload = $body | ConvertFrom-Json
      Send-Json $response 200 (Remove-TemplateCache $payload)
      continue
    }
    if ($request.Url.AbsolutePath -ne '/cutting/pdf' -or $request.HttpMethod -ne 'POST') { Send-Text $response 404 '{"ok":false,"error":"NOT_FOUND"}'; continue }
    $reader = [System.IO.StreamReader]::new($request.InputStream, [System.Text.Encoding]::UTF8)
    try { $body = $reader.ReadToEnd() } finally { $reader.Dispose() }
    $payload = $body | ConvertFrom-Json
    if ((-not $payload.templates) -and (-not $payload.templateId -or -not $payload.writes)) { Send-Text $response 400 '{"ok":false,"error":"BAD_REQUEST"}'; continue }
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
