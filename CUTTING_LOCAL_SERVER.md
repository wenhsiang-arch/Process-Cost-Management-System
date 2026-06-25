# Cutting PDF Local Server（裁帶 PDF 本機後台）

## Mục đích（用途）

Trang cắt dây chỉ gửi dữ liệu cho máy này. Server local sẽ dùng Microsoft Excel COM để mở bản sao mẫu Excel, điền số lượng, rồi xuất PDF.

裁帶頁面只把資料送到本機。本機後台會用 Microsoft Excel COM（Excel 本機自動化介面）開啟模板副本、填入數量，然後輸出 PDF。

## Cách chạy（啟動方式）

在專案資料夾開 PowerShell，執行：

```powershell
cd "C:\Users\ASUS Vivobook\Process-Cost-Management-System"
powershell -ExecutionPolicy Bypass -File .\local-cutting-server.ps1
```

成功時會看到：

```text
Cutting PDF local server started: http://127.0.0.1:8765/
本機裁帶 PDF 後台已啟動：http://127.0.0.1:8765/
```

## Lưu ý（注意）

- Server chỉ bind（綁定）`127.0.0.1`，只給本機使用。
- Không dùng taskkill（不使用強制關閉 Excel）。
- Phiên bản đầu chỉ hỗ trợ một mẫu Excel（第一版只支援單一 Excel 模板）。
- Cần cài Microsoft Excel（需要安裝 Microsoft Excel）。
- Nếu muốn dừng server（停止後台），在 PowerShell 按 `Ctrl+C`。
