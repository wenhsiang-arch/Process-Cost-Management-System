# Firebase Security Rules test runner（Firebase 安全規則測試啟動程式）
# 本程式只啟動 demo project（示範專案）的本機模擬器，不登入或連接正式雲端資料。

$ErrorActionPreference = 'Stop'

$projectRoot = Split-Path -Parent $PSScriptRoot
$toolRoot = 'D:\JAVA(開發系統用)'
$javaHome = Join-Path $toolRoot 'Java-21\jdk-21.0.12+8'
$firebaseToolsRoot = Join-Path $toolRoot 'Firebase-Tools'
$firebaseCommand = Join-Path $firebaseToolsRoot 'node_modules\.bin\firebase.cmd'
$emulatorCache = Join-Path $toolRoot 'Firebase-Emulators'
$npmCache = Join-Path $toolRoot 'Npm-Cache'

if (-not (Test-Path -LiteralPath (Join-Path $javaHome 'bin\java.exe'))) {
  throw '找不到 Java 21（程式執行環境），安全規則測試已停止。'
}

if (-not (Test-Path -LiteralPath $firebaseCommand)) {
  throw '找不到 Firebase CLI（Firebase 命令工具），安全規則測試已停止。'
}

$env:JAVA_HOME = $javaHome
$env:Path = "$(Join-Path $javaHome 'bin');$env:Path"
$env:PCMS_FIREBASE_TOOLS_ROOT = $firebaseToolsRoot
$env:FIREBASE_EMULATORS_PATH = $emulatorCache
$env:npm_config_cache = $npmCache
$env:FIREBASE_CLI_DISABLE_UPDATE_CHECK = 'true'
$env:CI = '1'

# demo-pcms-security-tests（製程成本系統安全測試示範專案）沒有正式雲端資源。
$testCommand = 'node --test tests/firestore.rules.test.mjs'

Push-Location $projectRoot
try {
  & $firebaseCommand emulators:exec `
    --config firebase.json `
    --only firestore `
    --project demo-pcms-security-tests `
    $testCommand

  if ($LASTEXITCODE -ne 0) {
    throw "安全規則自動測試失敗，結束代碼：$LASTEXITCODE"
  }
}
finally {
  Pop-Location
}
