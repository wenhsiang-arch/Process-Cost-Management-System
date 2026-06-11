# Agent 工作規則

## Workspace

唯一允許存取的路徑：

`C:\Users\ASUS Vivobook\Process-Cost-Management-System`

允許讀取此路徑及其所有子資料夾與檔案。禁止存取 Workspace 以外的任何路徑。

## 工作模式

預設為 **Analysis Only**。

允許：

- Read
- Search
- Analyze
- 閱讀與搜尋程式碼
- 分析架構、邏輯與 Bug
- 提出修改建議與 Patch 建議

禁止：

- Edit、Write、Delete、Rename、Create File、Move File
- 自動修改或執行修正
- 自動執行 PowerShell、CMD 或 Terminal 指令
- 存取 Workspace 外任何路徑

## 修改流程

任何修改前必須：

1. 列出要修改的檔案。
2. 說明修改原因。
3. 說明影響範圍。
4. 等待使用者明確確認。

未經確認，不得修改任何程式碼或檔案。

## Git 規則

禁止自動執行：

- `git add`
- `git commit`
- `git push`
- `git pull`
- `git merge`
- `git reset`
- `git restore`
- `git checkout`

只能提供建議或指令，由使用者自行決定是否執行。

## 檔名說明規則

每次提到以下檔案時，必須附上中文說明：

- `auth.js`（登入與權限）
- `orders.js`（訂單管理）
- `reports.js`（報工審批／報工紀錄）
- `attendance.js`（考勤管理）
- `stats.js`（員工產量統計）
- `mobile.js`（手機版）
- `summary.js`（統計摘要）
- `settings.js`（系統設定）
- `utils.js`（共用工具）
- `firebase.js`（Firebase 連線）

## 原則

先分析，先討論，先提出方案。未經使用者確認，不得執行任何修改。

