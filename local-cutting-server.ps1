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

function Set-CuttingStage([string]$stage, [string]$detail = '') {
  $script:CuttingStage = $stage
  $script:CuttingDetail = $detail
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

function Get-CellText($sheet, [int]$row, [int]$col) {
  $cell = $sheet.Cells.Item($row, $col)
  $text = [string]$cell.Text
  Release-Com $cell
  return $text
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
  return 0.0
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
    Code = 0; Color = 0; Qty = 0; Piece = 0; Total = 0; Note = 0; Belt = 0; CutSpec = 0
  }
  for ($col = $firstCol; $col -le $lastCol; $col++) {
    $text = Normalize-HeaderText (Get-CellText $sheet $row $col)
    if ($cols.Code -eq 0 -and ($text.Contains('MAHANG') -or $text.Contains('ITEMNO') -or $text.Contains('ITEM'))) { $cols.Code = $col }
    if ($cols.Color -eq 0 -and ($text.Contains('MAU') -or $text.Contains('COLOR'))) { $cols.Color = $col }
    if ($cols.Qty -eq 0 -and ($text.Contains('SLPO') -or $text.Contains('SL:PO') -or $text.Contains('QTY') -or $text.Contains('PCS'))) { $cols.Qty = $col }
    if ($cols.Piece -eq 0 -and ($text.Contains('SOKIEN') -or $text.Contains('SOBO'))) { $cols.Piece = $col }
    if ($cols.Total -eq 0 -and (($text.Contains('SLCAT') -or $text.Contains('THUCTE')))) { $cols.Total = $col }
    if ($cols.Note -eq 0 -and ($text.Contains('GHICHU') -or $text.Contains('NOTE'))) { $cols.Note = $col }
    if ($cols.Belt -eq 0 -and ($text.Contains('QUYCACH') -and ($text.Contains('DAY') -or $text.Contains('DAI') -or $text.Contains('THUNG')))) { $cols.Belt = $col }
    if ($cols.CutSpec -eq 0 -and ($text.Contains('QUYCACH') -and $text.Contains('CAT'))) { $cols.CutSpec = $col }
  }
  if ($cols.Color -eq 0 -and $cols.Code -gt 0) { $cols.Color = $cols.Code + 1 }
  if ($cols.CutSpec -eq 0 -and $cols.Qty -gt 1) { $cols.CutSpec = $cols.Qty - 1 }
  return $cols
}

function Is-ItemCode([string]$text) {
  $code = ($text.Trim().ToUpperInvariant() -replace '[^\w-]', '')
  return ($code -match '^[A-Z]{1,6}\d{2,}[-A-Z0-9]*$')
}

function First-NonEmptyInColumn($sheet, [int]$startRow, [int]$endRow, [int]$col) {
  if ($col -le 0) { return '' }
  for ($row = $startRow; $row -le $endRow; $row++) {
    $text = (Get-CellText $sheet $row $col).Trim()
    if ($text) { return $text }
  }
  return ''
}

function Find-GroupImage($sheet, [int]$startRow, [int]$endRow) {
  try {
    for ($i = 1; $i -le $sheet.Shapes.Count; $i++) {
      $shape = $sheet.Shapes.Item($i)
      $topRow = [int]$shape.TopLeftCell.Row
      $bottomRow = [int]$shape.BottomRightCell.Row
      if ($topRow -le $endRow -and $bottomRow -ge $startRow) {
        return $shape
      }
      Release-Com $shape
    }
  } catch {}
  return $null
}

function Copy-GroupImage($sourceShape, $targetSheet, [int]$startRow, [int]$endRow) {
  if ($null -eq $sourceShape) { return }
  try {
    $frame = $targetSheet.Range("A$($startRow):A$($endRow)")
    $sourceShape.Copy()
    $targetSheet.Paste() | Out-Null
    $shape = $targetSheet.Shapes.Item($targetSheet.Shapes.Count)
    $shape.LockAspectRatio = -1
    $maxWidth = [double]$frame.Width - 8
    $maxHeight = [double]$frame.Height - 8
    if ($shape.Width -gt $maxWidth) { $shape.Width = $maxWidth }
    if ($shape.Height -gt $maxHeight) { $shape.Height = $maxHeight }
    $shape.Left = [double]$frame.Left + (([double]$frame.Width - [double]$shape.Width) / 2)
    $shape.Top = [double]$frame.Top + (([double]$frame.Height - [double]$shape.Height) / 2)
    Release-Com $shape
    Release-Com $frame
  } catch {}
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
      $items = @()
      $colors = New-Object System.Collections.Generic.List[string]
      $totalCut = 0.0
      for ($row = $group.Start + 1; $row -le $group.End; $row++) {
        Set-CuttingStage 'read_group_items' "sheet=$sheetName; row=$row"
        $code = (Get-CellText $sheet $row $cols.Code).Trim()
        if (-not (Is-ItemCode $code)) { continue }
        $color = if ($cols.Color -gt 0) { (Get-CellText $sheet $row $cols.Color).Trim() } else { '' }
        if ($color -and -not $colors.Contains($color)) { $colors.Add($color) }
        $qty = Get-CellNumber $sheet $row $cols.Qty
        $piece = Get-CellNumber $sheet $row $cols.Piece
        $cut = if ($cols.Total -gt 0) { Get-CellNumber $sheet $row $cols.Total } else { ($qty * $piece) }
        $totalCut += $cut
        $items += [PSCustomObject]@{ Code = $code; Qty = $qty; Piece = $piece }
      }
      $belt = First-NonEmptyInColumn $sheet ($group.Start + 1) $group.End $cols.Belt
      $cutSpec = First-NonEmptyInColumn $sheet ($group.Start + 1) $group.End $cols.CutSpec
      $note = First-NonEmptyInColumn $sheet ($group.Start + 1) $group.End $cols.Note
      $title = Get-CellText $sheet $group.Start 1
      Set-CuttingStage 'find_group_image' "sheet=$sheetName; rows=$($group.Start)-$($group.End); title=$title"
      $image = Find-GroupImage $sheet $group.Start $group.End
      $groupsOut += [PSCustomObject]@{
        Sheet = $sheet; Title = $title; Belt = $belt; Color = ($colors -join ' / ');
        CutSpec = $cutSpec; Note = $note; Items = $items; TotalCut = $totalCut; Image = $image
      }
    }
    Release-Com $sheet
  }
  return $groupsOut
}

function Set-CellStyle($range, [int]$fontSize, [bool]$bold) {
  $range.HorizontalAlignment = -4108
  $range.VerticalAlignment = -4108
  $range.WrapText = $true
  $range.Font.Size = $fontSize
  $range.Font.Bold = $bold
}

function Build-CompactWorkbook($excel, $sourceWorkbook, $payload) {
  Set-CuttingStage 'collect_groups' 'read matched template groups'
  $groups = Get-CompactGroups $sourceWorkbook $payload
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

  $cols = @(13, 10, 13, 12, 9, 8, 7, 9, 7, 12)
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
  $headerHeight = 22.0
  $outRow = 1
  $groupIndex = 0
  foreach ($group in $groups) {
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

    $outSheet.Rows.Item($headerRow).RowHeight = $headerHeight
    for ($r = $detailStart; $r -le $detailEnd; $r++) { $outSheet.Rows.Item($r).RowHeight = $detailHeight }

    $headers = @($group.Title, 'QUY CACH DAY', 'MA HANG', 'MAU', 'QUY CACH CAT', 'SL:PO PCS', 'SO KIEN', 'SL:CAT THUC TE', 'SL: THIEU LIEU', 'GHI CHU')
    for ($c = 1; $c -le 10; $c++) {
      $cell = $outSheet.Cells.Item($headerRow, $c)
      $cell.Value2 = $headers[$c - 1]
      $cell.Interior.Color = 0x5B7F3A
      $cell.Font.Color = 0xFFFFFF
      Set-CellStyle $cell 11 $true
      Release-Com $cell
    }

    foreach ($col in @(1,2,4,5,8,9,10)) {
      $range = $outSheet.Range($outSheet.Cells.Item($detailStart, $col), $outSheet.Cells.Item($detailEnd, $col))
      $range.Merge() | Out-Null
      Release-Com $range
    }

    $outSheet.Cells.Item($detailStart, 2).Value2 = [string]$group.Belt
    $outSheet.Cells.Item($detailStart, 4).Value2 = [string]$group.Color
    $outSheet.Cells.Item($detailStart, 5).Value2 = [string]$group.CutSpec
    $outSheet.Cells.Item($detailStart, 8).Value2 = [double]$group.TotalCut
    $outSheet.Cells.Item($detailStart, 10).Value2 = [string]$group.Note

    for ($i = 0; $i -lt $itemCount; $i++) {
      $row = $detailStart + $i
      if ($i -lt $group.Items.Count) {
        $item = $group.Items[$i]
        $outSheet.Cells.Item($row, 3).Value2 = [string]$item.Code
        $outSheet.Cells.Item($row, 6).Value2 = [double]$item.Qty
        $outSheet.Cells.Item($row, 7).Value2 = [double]$item.Piece
      }
    }

    $block = $outSheet.Range($outSheet.Cells.Item($startRow, 1), $outSheet.Cells.Item($detailEnd, 10))
    $block.Borders.LineStyle = 1
    $block.Borders.Weight = 2
    Set-CellStyle $block 12 $false
    Release-Com $block
    foreach ($col in @(2,4,5,8,10)) {
      $range = $outSheet.Range($outSheet.Cells.Item($detailStart, $col), $outSheet.Cells.Item($detailEnd, $col))
      Set-CellStyle $range 18 $true
      Release-Com $range
    }
    $codeRange = $outSheet.Range($outSheet.Cells.Item($detailStart, 3), $outSheet.Cells.Item($detailEnd, 3))
    Set-CellStyle $codeRange ([Math]::Max(5, [Math]::Min(9, [int](95 / $itemCount)))) $false
    Release-Com $codeRange

    Set-CuttingStage 'copy_group_image' "index=$($groupIndex + 1); title=$($group.Title); rows=$detailStart-$detailEnd"
    Copy-GroupImage $group.Image $outSheet $detailStart $detailEnd
    $outRow = $detailEnd + 1
    $groupIndex++
  }

  Set-CuttingStage 'set_print_area' "rows=$($outRow - 1)"
  $used = $outSheet.UsedRange
  $outSheet.PageSetup.PrintArea = $used.Address()
  Release-Com $used
  return $outBook
}

function New-CuttingPdf($payload) {
  Set-CuttingStage 'prepare_temp_files' 'create temp files'
  $root = Join-Path $env:TEMP ("cutting-pdf-" + [Guid]::NewGuid().ToString('N'))
  New-Item -ItemType Directory -Path $root | Out-Null
  $templatePath = Join-Path $root 'template_original.xlsx'
  $workPath = Join-Path $root 'template_work.xlsx'
  $pdfPath = Join-Path $root 'cutting_output.pdf'
  Set-CuttingStage 'decode_template' 'read templateBase64'
  $templateBytes = [Convert]::FromBase64String([string]$payload.templateBase64)
  Set-CuttingStage 'write_temp_template' "path=$templatePath"
  [System.IO.File]::WriteAllBytes($templatePath, $templateBytes)
  Copy-Item -LiteralPath $templatePath -Destination $workPath

  $excel = $null
  $workbook = $null
  $printWorkbook = $null
  try {
    Set-CuttingStage 'start_excel' 'create Excel COM application'
    $excel = New-Object -ComObject Excel.Application
    $excel.Visible = $false
    $excel.DisplayAlerts = $false
    $excel.EnableEvents = $false

    Set-CuttingStage 'open_workbook' "path=$workPath"
    $workbook = $excel.Workbooks.Open($workPath, $null, $false)
    foreach ($write in $payload.writes) {
      $sheetName = [string]$write.sheetName
      $cell = [string]$write.cell
      $value = Convert-ToSafeDouble $write.value
      Set-CuttingStage 'write_cell' "sheet=$sheetName; cell=$cell; value=$value"
      $sheet = $workbook.Worksheets.Item($sheetName)
      $sheet.Range($cell).Value2 = $value
      Release-Com $sheet
    }
    Set-CuttingStage 'build_compact_pdf_sheet' 'create compact print layout'
    $printWorkbook = Build-CompactWorkbook $excel $workbook $payload
    Set-CuttingStage 'export_pdf' "path=$pdfPath"
    $printWorkbook.ExportAsFixedFormat(0, $pdfPath)
    $printWorkbook.Close($false)
    Release-Com $printWorkbook
    $printWorkbook = $null
    $workbook.Close($false)
    Release-Com $workbook
    $workbook = $null
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
    if (-not $payload.templateBase64 -or -not $payload.writes) {
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
    }
  }
}
