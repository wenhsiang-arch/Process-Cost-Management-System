# Công cụ PDF cắt dây trên máy / 裁帶 PDF 本機工具

## Mục đích / 用途

Công cụ nhận dữ liệu từ trang thống kê dây cắt, đọc cấu trúc bên trong file `.xlsx`（Excel 表格檔）, tạo chỉ mục mẫu và hình ảnh, sau đó xuất PDF（可攜式文件）trên máy người dùng.

本機工具接收裁帶統計頁面的資料，直接讀取 `.xlsx`（Excel 表格檔）內部結構，建立模板與圖片索引，再於使用者電腦產生 PDF（可攜式文件）。

## Cách hoạt động hiện tại / 目前運作方式

- Chỉ nhận mẫu mới có cột A–K cố định / 只接受 A～K 固定欄位的新模板。
- Hỗ trợ nhiều mẫu trong cùng một lần xuất / 支援一次輸出多個模板。
- Không mở Microsoft Excel（微軟表格程式）và không dùng Excel COM（Excel 本機自動化介面）。
- Mỗi nhóm được xác định theo vị trí tiêu đề gốc / 每個組別依原始表頭位置判定。
- Giữ tiêu đề riêng của từng nhóm và từng sheet（工作表）/ 保留每個組別及工作表自己的表頭。
- Giữ trạng thái ô gộp của mẫu / 保留模板合併儲存格狀態。
- Ảnh giống nhau chỉ lưu một lần bằng hash（內容雜湊值）/ 相同圖片只建立一份索引。
- Báo cáo thống kê được đặt trước các trang nội dung / 統計報告放在裁帶內容頁之前。
- Chỉ mục hiện tại là phiên bản 15 / 目前索引版本為第 15 版。

## Yêu cầu máy tính / 電腦需求

- Hệ điều hành Windows（視窗作業系統）。
- Windows PowerShell 5.1（Windows 命令環境）。
- Trình duyệt Chrome（谷歌瀏覽器）hoặc Edge（微軟瀏覽器）。
- Không cần cài Microsoft Excel（微軟表格程式）để chuyển PDF（可攜式文件）。
- Thư mục OneDrive（雲端同步資料夾）của công cụ phải chọn「Luôn giữ trên thiết bị này / 永遠保留在此裝置」。

## Cách mở hằng ngày / 日常啟動方式

1. Mở thư mục `OneDrive\1MAY9\Cong cu chuyen doi PDF`（OneDrive 裁帶 PDF 工具資料夾）。
2. Nhấp đúp `啟動PDF工具.bat`（PDF 工具啟動批次檔）。
3. Giữ cửa sổ lệnh mở trong thời gian tạo PDF（可攜式文件）。
4. Khi thấy `Da khoi dong cong cu PDF / 已啟動 PDF 工具`，即可回到網頁產生 PDF（可攜式文件）。

## Cách mở từ thư mục dự án / 從專案資料夾啟動

```powershell
cd "C:\Users\ASUS Vivobook\Process-Cost-Management-System"
powershell -ExecutionPolicy Bypass -File .\local-cutting-server.ps1
```

啟動成功後，本機服務位址為：

```text
http://127.0.0.1:8765/
```

## Địa chỉ chức năng / 功能端點

- `/health`（健康檢查）：確認工具是否已啟動。
- `/cutting/cache/status`（快取狀態）：確認模板索引是否已存在。
- `/cutting/cache`（刪除快取）：刪除指定模板的本機索引。
- `/cutting/pdf`（產生 PDF）：接收模板、數量與報告資料並產生 PDF（可攜式文件）。

## Chỉ mục và bộ nhớ đệm / 索引與快取

- Lần đầu dùng một mẫu mới sẽ tạo `cutting-cache`（裁帶快取資料夾）。
- 快取內容包含 `index.json`（索引資料）及去除重複後的圖片。
- 模板編號、更新時間、檔案大小或索引版本改變時，舊索引會失效並重建。
- 網頁確認本機已有有效索引後，不再重送完整模板，因此第二次轉換會較快。
- OneDrive（雲端同步資料夾）內的快取必須保持可在本機讀取，否則可能重新建立或轉換失敗。

## Tệp tạm / 暫存資料

- 每次轉換會在 Windows（視窗作業系統）暫存區建立專用的 `cutting-pdf-`（裁帶 PDF 暫存）資料夾。
- 無論成功或失敗，當次暫存資料都會清除。
- 工具啟動時會清除超過 24 小時的舊裁帶暫存資料。
- 工具只能清除自己建立的專用暫存資料夾。

## Dừng công cụ / 停止工具

在工具命令視窗按 `Ctrl+C`（停止目前命令）即可停止。

不得使用 `taskkill`（強制結束程序）關閉全部 Microsoft Excel（微軟表格程式）或其他不相關程序。

## Kết quả kiểm tra ngày 2026-07-30 / 2026 年 7 月 30 日檢查結果

### Đã xác nhận / 已確認

- PowerShell（命令腳本）語法檢查通過。
- 專案路徑與 OneDrive（雲端同步資料夾）內的 `local-cutting-server.ps1`（本機 PDF 轉檔程式）內容完全相同。
- 工具只綁定 `127.0.0.1`（本機回送位址），不直接對外網路開放。
- 多模板、索引快取、圖片共用、合併儲存格、動態組高及統計報告功能均已存在。
- 網頁匯入端與本機端現在都會把合併範圍解析到左上角來源格；表頭、資料列與寫入位置使用相同規則。
- `IndexVersion 15`（索引版本 15）會讓舊快取自動重建，避免沿用修正前的索引。

### Cần sửa trước khi xem là bản chính thức / 視為正式版前待修正

- Hiện tại phản hồi cho phép mọi nguồn trang web truy cập / 目前允許所有網頁來源呼叫。
- Chưa giới hạn kích thước nội dung yêu cầu / 尚未限制請求內容容量。
- Một số mã lỗi nội bộ chưa chuyển đầy đủ sang tiếng Việt và tiếng Trung / 部分內部錯誤碼尚未完整轉成越文與中文。
- 頁面操作說明使用的啟動檔名稱與實際 `啟動PDF工具.bat`（PDF 工具啟動批次檔）不同。
- 程式仍有少量未使用的繪圖函式、參數及舊計時集合，可以安全清除。

合併儲存格分析規則已完成修正；其餘項目在 2026 年 7 月 30 日只完成檢查與紀錄，尚未修改程式。

## Kiểm tra trước khi sử dụng chính thức / 正式使用前檢查

- 從正式網站確認 Chrome（谷歌瀏覽器）及 Edge（微軟瀏覽器）均能連接本機工具。
- 驗證 1、5、6 個以上款號組別，同組不得跨頁。
- 驗證 B～K 欄合併與未合併的輸出，並確認合併 H 欄不會重複計算。
- 驗證不同工作表表頭與不同圖片。
- 驗證第一次建立索引及第二次使用快取的速度。
- 確認 OneDrive（雲端同步資料夾）內的工具及快取均已下載到本機。

## Tiến độ hiện tại ngày 2026-07-30 / 2026 年 7 月 30 日目前進度

### Đã hoàn thành / 已完成

- Đã thống nhất cách đọc ô gộp giữa trang web và công cụ trên máy / 網頁與本機工具已統一合併儲存格解析規則。
- Ô B, G, H, I đã dùng nội dung và địa chỉ của ô góc trên bên trái / B、G、H、I 欄已使用合併範圍左上角的內容與位置。
- Không cộng lặp số kiện khi nhiều dòng cùng dùng một ô H đã gộp / 多列共用同一個合併 H 欄時不會重複累加每件條數。
- Chỉ mục phiên bản 15 sẽ tự động thay thế bộ nhớ đệm cũ / 索引版本 15 會讓舊快取自動失效並重建。
- Hai bản `local-cutting-server.ps1`（本機 PDF 轉檔程式）trong dự án và OneDrive（雲端同步資料夾）đã kiểm tra cú pháp và có cùng hash（內容雜湊值）/ 專案與 OneDrive 版本已通過語法檢查，內容雜湊值相同。

### Việc cần làm sau khi cập nhật / 更新後要做

- Khởi động lại công cụ PDF（可攜式文件）trên máy / 重新啟動本機 PDF 工具。
- Nhập lại một lần các mẫu được tạo trước phiên bản phân tích ô gộp / 修正前建立的模板需重新匯入一次。
- Dùng mẫu chính thức để kiểm tra chiều cao nhóm, hình ảnh, cỡ chữ và không tách nhóm qua trang / 使用正式模板驗證組高、圖片、字級及同組不跨頁。
