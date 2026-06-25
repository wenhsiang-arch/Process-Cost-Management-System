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
    $payload = $body | ConvertFrom-Json -Depth 50
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
