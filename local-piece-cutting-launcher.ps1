param([switch]$Register,[switch]$RegisterOnly,[switch]$UnregisterOnly,[switch]$Silent,[string]$ProtocolUri='')

$ErrorActionPreference='Stop'
$script:Protocol='piececuttingpdf'
$script:HealthUrl='http://127.0.0.1:8766/health'
$script:PowerShell=Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
$script:Server=Join-Path $PSScriptRoot 'local-piece-cutting-server.ps1'

function Show-Message([string]$Text){if($Silent){return};Write-Host $Text -ForegroundColor Red;try{Add-Type -AssemblyName System.Windows.Forms;[Windows.Forms.MessageBox]::Show($Text,'Công cụ PDF cắt chi tiết / 裁片 PDF 工具',[Windows.Forms.MessageBoxButtons]::OK,[Windows.Forms.MessageBoxIcon]::Warning)|Out-Null}catch{}}
function Test-Tool{try{$health=Invoke-RestMethod -Uri $script:HealthUrl -Method Get -TimeoutSec 1;return($health.ok-eq$true-and[string]$health.service-eq'piece-cutting-pdf-local')}catch{return $false}}
function Register-Protocol{
  $root="HKCU:\Software\Classes\$($script:Protocol)";$command=Join-Path $root 'shell\open\command';$value='"{0}" -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "{1}" -ProtocolUri "%1"'-f$script:PowerShell,$PSCommandPath
  try{New-Item -Path $command -Force|Out-Null;Set-Item -Path $root -Value 'URL:Piece Cutting PDF Launcher';New-ItemProperty -Path $root -Name 'URL Protocol' -Value '' -PropertyType String -Force|Out-Null;Set-Item -Path $command -Value $value}catch{throw("PROTOCOL_REGISTER_FAILED / Không thể đăng ký đường dẫn mở công cụ / 無法登記工具啟動路徑："+$_.Exception.Message)}
  try{$urlProtocol=(Get-Item -LiteralPath $root).GetValue('URL Protocol',$null);$registeredCommand=[string](Get-Item -LiteralPath $command).GetValue('');if($null-eq$urlProtocol-or$registeredCommand-ne$value){throw 'Giá trị đăng ký không khớp / 登記內容不一致'}}catch{throw("PROTOCOL_VERIFY_FAILED / Không thể xác nhận đường dẫn mở công cụ / 無法確認工具啟動路徑："+$_.Exception.Message)}
}
function Unregister-Protocol{$root="HKCU:\Software\Classes\$($script:Protocol)";if(Test-Path -LiteralPath $root){Remove-Item -LiteralPath $root -Recurse -Force};Show-Message "Đã hủy đường dẫn khởi động công cụ PDF cắt chi tiết.`n已取消裁片 PDF 工具啟動路徑。"}

$uri=([string]$ProtocolUri).Trim().TrimEnd('/')
if($uri-ieq'piececuttingpdf://unregister'-or$UnregisterOnly){Unregister-Protocol;exit 0}
try{if($Register-or$RegisterOnly){Register-Protocol}}catch{Show-Message ("Không thể đăng ký công cụ PDF cắt chi tiết.`n無法登記裁片 PDF 工具。`n`n"+$_.Exception.Message);exit 1};if($RegisterOnly){exit 0};$null=$ProtocolUri
if(-not(Test-Path -LiteralPath $script:Server)){Show-Message "Không tìm thấy công cụ PDF cắt chi tiết.`n找不到裁片 PDF 工具。";exit 1}
if(Test-Tool){exit 0}
$mutex=$null;$owns=$false
try{$created=$false;$mutex=New-Object Threading.Mutex($true,'Local\PieceCuttingPdfLauncher8766',[ref]$created);$owns=$created;if(-not$owns){exit 0};if(Test-Tool){exit 0}
  $arguments=@('-NoProfile','-ExecutionPolicy','Bypass','-NoExit','-File',('"{0}"'-f$script:Server));$serverProcess=Start-Process -FilePath $script:PowerShell -ArgumentList $arguments -WorkingDirectory $PSScriptRoot -PassThru
  $ready=$false;for($attempt=0;$attempt-lt20;$attempt++){Start-Sleep -Milliseconds 500;if(Test-Tool){$ready=$true;break}};if(-not$ready){if($serverProcess.HasExited){throw("SERVER_EXITED / Dịch vụ đã đóng khi khởi động / 服務啟動時已關閉；ExitCode="+$serverProcess.ExitCode)};throw 'SERVER_START_TIMEOUT / Dịch vụ chưa sẵn sàng sau 10 giây; xem cửa sổ PowerShell đang mở / 服務在 10 秒後仍未就緒，請查看保持開啟的 PowerShell 視窗'}
}catch{Show-Message ("Không thể khởi động công cụ PDF cắt chi tiết.`n無法啟動裁片 PDF 工具。`n`n"+$_.Exception.Message);exit 1}finally{if($null-ne$mutex){if($owns){try{$mutex.ReleaseMutex()}catch{}};$mutex.Dispose()}}
exit 0
