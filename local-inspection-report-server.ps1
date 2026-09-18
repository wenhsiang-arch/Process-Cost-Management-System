param([int]$Port = 8767)

$ErrorActionPreference = 'Stop'
$script:Prefix = "http://127.0.0.1:$Port/"
$script:MaxBytes = 5 * 1024 * 1024
$script:AllowedOrigins = @('https://wenhsiang-arch.github.io')
$script:TempRoot = Join-Path $PSScriptRoot '.inspection-report-temp'

function Test-AllowedOrigin([string]$origin) {
  if ([string]::IsNullOrWhiteSpace($origin)) { return $true }
  if ($script:AllowedOrigins -contains $origin) { return $true }
  return ($origin -match '^http://(localhost|127\.0\.0\.1)(:\d+)?$')
}

function Send-Response($response, [int]$status, [byte[]]$bytes, [string]$type, [string]$origin) {
  $response.StatusCode = $status
  $response.ContentType = $type
  $response.ContentLength64 = $bytes.Length
  if (-not [string]::IsNullOrWhiteSpace($origin)) {
    $response.Headers.Add('Access-Control-Allow-Origin', $origin)
    $response.Headers.Add('Access-Control-Allow-Methods', 'GET,POST,OPTIONS')
    $response.Headers.Add('Access-Control-Allow-Headers', 'Content-Type')
    $response.Headers.Add('Access-Control-Allow-Private-Network', 'true')
    $response.Headers.Add('Vary', 'Origin')
  }
  try { $response.OutputStream.Write($bytes, 0, $bytes.Length) } finally { $response.Close() }
}

function Send-Json($response, [int]$status, [string]$json, [string]$origin) {
  Send-Response $response $status ([System.Text.Encoding]::UTF8.GetBytes($json)) 'application/json; charset=utf-8' $origin
}

function Read-LimitedBytes($request) {
  if ($request.ContentLength64 -gt $script:MaxBytes) { throw 'FILE_TOO_LARGE' }
  if (-not ([string]$request.ContentType).StartsWith('application/vnd.ms-excel', [System.StringComparison]::OrdinalIgnoreCase)) {
    throw 'UNSUPPORTED_CONTENT_TYPE'
  }
  $memory = [System.IO.MemoryStream]::new()
  $buffer = New-Object byte[] 8192
  try {
    while (($count = $request.InputStream.Read($buffer, 0, $buffer.Length)) -gt 0) {
      if ($memory.Length + $count -gt $script:MaxBytes) { throw 'FILE_TOO_LARGE' }
      $memory.Write($buffer, 0, $count)
    }
    $bytes = $memory.ToArray()
    if ($bytes.Length -lt 8) { throw 'INVALID_XLS' }
    $signature = [byte[]](0xD0,0xCF,0x11,0xE0,0xA1,0xB1,0x1A,0xE1)
    for ($index = 0; $index -lt 8; $index++) {
      if ($bytes[$index] -ne $signature[$index]) { throw 'INVALID_XLS' }
    }
    return ,$bytes
  } finally { $memory.Dispose() }
}

function Convert-Xls([byte[]]$inputBytes) {
  if (-not (Test-Path -LiteralPath $script:TempRoot)) {
    New-Item -ItemType Directory -Path $script:TempRoot | Out-Null
  }
  $job = Join-Path $script:TempRoot ([guid]::NewGuid().ToString('N'))
  New-Item -ItemType Directory -Path $job | Out-Null
  $source = Join-Path $job 'template.xls'
  $target = Join-Path $job 'template.xlsx'
  $excel = $null
  $book = $null
  try {
    [System.IO.File]::WriteAllBytes($source, $inputBytes)
    $excel = New-Object -ComObject Excel.Application
    $excel.Visible = $false
    $excel.DisplayAlerts = $false
    $excel.EnableEvents = $false
    $excel.AskToUpdateLinks = $false
    $excel.AutomationSecurity = 3
    $book = $excel.Workbooks.Open($source, 0, $true)
    $book.SaveAs($target, 51)
    $book.Close($false)
    [void][System.Runtime.InteropServices.Marshal]::ReleaseComObject($book)
    $book = $null
    $result = [System.IO.File]::ReadAllBytes($target)
    if ($result.Length -lt 100 -or $result.Length -gt (20 * 1024 * 1024)) { throw 'INVALID_OUTPUT' }
    return ,$result
  } finally {
    if ($null -ne $book) {
      try { $book.Close($false) } catch { }
      [void][System.Runtime.InteropServices.Marshal]::ReleaseComObject($book)
    }
    if ($null -ne $excel) {
      try { $excel.Quit() } catch { }
      [void][System.Runtime.InteropServices.Marshal]::ReleaseComObject($excel)
    }
    [GC]::Collect()
    [GC]::WaitForPendingFinalizers()
    $root = [System.IO.Path]::GetFullPath($script:TempRoot)
    $full = [System.IO.Path]::GetFullPath($job)
    $inside = $full.StartsWith(($root + [System.IO.Path]::DirectorySeparatorChar), [System.StringComparison]::OrdinalIgnoreCase)
    if ($inside -and (Test-Path -LiteralPath $full)) {
      Remove-Item -LiteralPath $full -Recurse -Force
    }
  }
}

$listener = [System.Net.HttpListener]::new()
$listener.Prefixes.Add($script:Prefix)
try {
  $listener.Start()
  Write-Host "Inspection report converter ready: $script:Prefix"
  while ($listener.IsListening) {
    $context = $listener.GetContext()
    $request = $context.Request
    $response = $context.Response
    $origin = [string]$request.Headers['Origin']
    try {
      if (-not (Test-AllowedOrigin $origin)) {
        Send-Json $response 403 '{"ok":false,"error":"ORIGIN_NOT_ALLOWED"}' ''
      } elseif ($request.HttpMethod -eq 'OPTIONS') {
        Send-Response $response 204 ([byte[]]@()) 'text/plain' $origin
      } elseif ($request.HttpMethod -eq 'GET' -and $request.Url.AbsolutePath -eq '/health') {
        Send-Json $response 200 '{"ok":true,"service":"inspection-report-converter"}' $origin
      } elseif ($request.HttpMethod -eq 'POST' -and $request.Url.AbsolutePath -eq '/convert') {
        $output = Convert-Xls (Read-LimitedBytes $request)
        Send-Response $response 200 $output 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' $origin
      } else {
        Send-Json $response 404 '{"ok":false,"error":"NOT_FOUND"}' $origin
      }
    } catch {
      Write-Warning $_.Exception.Message
      try { Send-Json $response 422 '{"ok":false,"error":"CONVERSION_FAILED"}' $origin } catch { }
    }
  }
} finally {
  $listener.Stop()
  $listener.Close()
}
