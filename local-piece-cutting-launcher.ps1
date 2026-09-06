param([switch]$Register,[switch]$RegisterOnly,[switch]$UnregisterOnly,[switch]$Silent,[string]$ProtocolUri='')

$ErrorActionPreference='Stop'
$script:Protocol='piececuttingpdf'
$script:HealthUrl='http://127.0.0.1:8766/health'
$script:PowerShell=Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
$script:Server=Join-Path $PSScriptRoot 'local-piece-cutting-server.ps1'

function Show-Message([string]$Text){if($Silent){return};try{Add-Type -AssemblyName System.Windows.Forms;[Windows.Forms.MessageBox]::Show($Text,'Công cụ PDF cắt chi tiết',[Windows.Forms.MessageBoxButtons]::OK,[Windows.Forms.MessageBoxIcon]::Warning)|Out-Null}catch{Write-Host $Text}}
function Test-Tool{try{$health=Invoke-RestMethod -Uri $script:HealthUrl -Method Get -TimeoutSec 1;return($health.ok-eq$true-and[string]$health.service-eq'piece-cutting-pdf-local')}catch{return$false}}
function Register-Protocol{
  $root="HKCU:\Software\Classes\$($script:Protocol)";$command=Join-Path $root 'shell\open\command';$value='"{0}" -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "{1}" -ProtocolUri "%1"'-f$script:PowerShell,$PSCommandPath
  New-Item -Path $command -Force|Out-Null;Set-Item -Path $root -Value 'URL:Piece Cutting PDF Launcher';New-ItemProperty -Path $root -Name 'URL Protocol' -Value '' -PropertyType String -Force|Out-Null;Set-Item -Path $command -Value $value
}
function Unregister-Protocol{$root="HKCU:\Software\Classes\$($script:Protocol)";if(Test-Path -LiteralPath $root){Remove-Item -LiteralPath $root -Recurse -Force};Show-Message "Đã hủy đường dẫn khởi động công cụ PDF cắt chi tiết.`n已取消裁片 PDF 工具啟動路徑。"}

$uri=([string]$ProtocolUri).Trim().TrimEnd('/')
if($uri-ieq'piececuttingpdf://unregister'-or$UnregisterOnly){Unregister-Protocol;exit 0}
if($Register-or$RegisterOnly){Register-Protocol};if($RegisterOnly){exit 0};$null=$ProtocolUri
if(-not(Test-Path -LiteralPath $script:Server)){Show-Message "Không tìm thấy công cụ PDF cắt chi tiết.`n找不到裁片 PDF 工具。";exit 1}
if(Test-Tool){exit 0}
$mutex=$null;$owns=$false
try{$created=$false;$mutex=New-Object Threading.Mutex($true,'Local\PieceCuttingPdfLauncher8766',[ref]$created);$owns=$created;if(-not$owns){exit 0};if(Test-Tool){exit 0}
  $arguments=@('-NoProfile','-ExecutionPolicy','Bypass','-NoExit','-File',('"{0}"'-f$script:Server));Start-Process -FilePath $script:PowerShell -ArgumentList $arguments -WorkingDirectory $PSScriptRoot|Out-Null
  $ready=$false;for($attempt=0;$attempt-lt20;$attempt++){Start-Sleep -Milliseconds 500;if(Test-Tool){$ready=$true;break}};if(-not$ready){Show-Message "Không thể khởi động công cụ PDF cắt chi tiết.`n無法啟動裁片 PDF 工具。";exit 1}
}catch{Show-Message ("Không thể khởi động công cụ PDF cắt chi tiết.`n無法啟動裁片 PDF 工具。`n`n"+$_.Exception.Message);exit 1}finally{if($null-ne$mutex){if($owns){try{$mutex.ReleaseMutex()}catch{}};$mutex.Dispose()}}
exit 0
