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

function Send-File($response, [string]$path, [string]$fileName) {
  $bytes = [System.IO.File]::ReadAllBytes($path)
  $safeName = $fileName -replace '[\\/:*?"<>|]', '_'
  $response.StatusCode = 200
  $response.ContentType = 'application/pdf'
  $response.Headers.Add('Access-Control-Allow-Origin', '*')
  $response.Headers.Add('Access-Control-Allow-Methods', 'GET,POST,OPTIONS')
  $response.Headers.Add('Access-Control-Allow-Headers', 'Content-Type')
  $response.Headers.Add('Content-Disposition', "inline; filename=""$safeName""")
  $response.OutputStream.Write($bytes, 0, $bytes.Length)
  $response.Close()
}

function Release-Com($object) {
  if ($null -ne $object) {
    [void][System.Runtime.InteropServices.Marshal]::ReleaseComObject($object)
  }
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
  return ($chars.ToString().ToUpperInvariant() -replace '\s+', '')
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

function Get-GroupHeight($sheet, [int]$startRow, [int]$endRow) {
  $height = 0.0
  for ($row = $startRow; $row -le $endRow; $row++) {
    $height += [double]$sheet.Rows.Item($row).RowHeight
  }
  return $height
}

function Set-RowRangeHidden($sheet, [int]$startRow, [int]$endRow, [bool]$hidden) {
  $range = $sheet.Range("A$($startRow):A$($endRow)").EntireRow
  $range.Hidden = $hidden
  Release-Com $range
}

function Format-SheetForPdf($sheet, $orderRows) {
  $xlLandscape = 2
  $xlPaperA4 = 9
  $sheet.PageSetup.Orientation = $xlLandscape
  $sheet.PageSetup.PaperSize = $xlPaperA4
  $sheet.PageSetup.Zoom = $false
  $sheet.PageSetup.FitToPagesWide = 1
  $sheet.PageSetup.FitToPagesTall = $false
  $sheet.PageSetup.TopMargin = 18
  $sheet.PageSetup.BottomMargin = 18
  $sheet.PageSetup.LeftMargin = 18
  $sheet.PageSetup.RightMargin = 18
  try { $sheet.ResetAllPageBreaks() } catch {}

  $groups = Get-GroupRanges $sheet
  if (-not $groups -or $groups.Count -eq 0) { return }

  $keepGroups = @()
  foreach ($group in $groups) {
    $hasOrder = $false
    foreach ($row in $orderRows) {
      if ($row -ge $group.Start -and $row -le $group.End) {
        $hasOrder = $true
        break
      }
    }
    if ($hasOrder) { $keepGroups += $group }
  }

  foreach ($group in $groups) {
    if ($keepGroups -notcontains $group) {
      Set-RowRangeHidden $sheet $group.Start $group.End $true
    } else {
      Set-RowRangeHidden $sheet $group.Start $group.End $false
    }
  }

  $usableHeight = 595.0 - [double]$sheet.PageSetup.TopMargin - [double]$sheet.PageSetup.BottomMargin
  $currentHeight = 0.0
  $isFirst = $true
  foreach ($group in $keepGroups) {
    $groupHeight = Get-GroupHeight $sheet $group.Start $group.End
    if (-not $isFirst -and ($currentHeight + $groupHeight) -gt $usableHeight) {
      try { $sheet.HPageBreaks.Add($sheet.Rows.Item($group.Start)) | Out-Null } catch {}
      $currentHeight = 0.0
    }
    $currentHeight += $groupHeight
    $isFirst = $false
  }
}

function New-CuttingPdf($payload) {
  $root = Join-Path $env:TEMP ("cutting-pdf-" + [Guid]::NewGuid().ToString('N'))
  New-Item -ItemType Directory -Path $root | Out-Null
  $templatePath = Join-Path $root 'template_original.xlsx'
  $workPath = Join-Path $root 'template_work.xlsx'
  $pdfPath = Join-Path $root 'cutting_output.pdf'
  $templateBytes = [Convert]::FromBase64String([string]$payload.templateBase64)
  [System.IO.File]::WriteAllBytes($templatePath, $templateBytes)
  Copy-Item -LiteralPath $templatePath -Destination $workPath

  $excel = $null
  $workbook = $null
  try {
    $excel = New-Object -ComObject Excel.Application
    $excel.Visible = $false
    $excel.DisplayAlerts = $false
    $excel.EnableEvents = $false

    $workbook = $excel.Workbooks.Open($workPath, $null, $false)
    foreach ($write in $payload.writes) {
      $sheetName = [string]$write.sheetName
      $cell = [string]$write.cell
      $value = [double]$write.value
      $sheet = $workbook.Worksheets.Item($sheetName)
      $sheet.Range($cell).Value2 = $value
      Release-Com $sheet
    }
    $orderRowsBySheet = Get-OrderRowsBySheet $payload
    foreach ($sheetName in $orderRowsBySheet.Keys) {
      $sheet = $workbook.Worksheets.Item([string]$sheetName)
      Format-SheetForPdf $sheet $orderRowsBySheet[$sheetName]
      Release-Com $sheet
    }
    $workbook.ExportAsFixedFormat(0, $pdfPath)
    $workbook.Close($false)
    Release-Com $workbook
    $workbook = $null
    $excel.Quit()
    Release-Com $excel
    $excel = $null
    return $pdfPath
  } finally {
    if ($null -ne $workbook) {
      try { $workbook.Close($false) } catch {}
      Release-Com $workbook
    }
    if ($null -ne $excel) {
      try { $excel.Quit() } catch {}
      Release-Com $excel
    }
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
    $body = $reader.ReadToEnd()
    $payload = $body | ConvertFrom-Json
    if (-not $payload.templateBase64 -or -not $payload.writes) {
      Send-Text $response 400 '{"ok":false,"error":"BAD_REQUEST"}'
      continue
    }
    $pdfPath = New-CuttingPdf $payload
    $name = if ($payload.outputName) { [string]$payload.outputName } else { 'cutting.pdf' }
    Send-File $response $pdfPath $name
  } catch {
    $message = ($_.Exception.Message -replace '\\', '\\' -replace '"', '\"' -replace "`r?`n", ' ')
    Send-Text $response 500 "{""ok"":false,""error"":""$message""}"
  }
}
