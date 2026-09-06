# Công cụ PDF cắt chi tiết trên máy / 裁片 PDF 本機工具

Cập nhật lần cuối / 最後整理：2026-09-06

## Mục đích / 用途

Công cụ này phục vụ riêng trang `Xuất phiếu cắt chi tiết / 裁片出單`, nhận dữ liệu đã được hệ thống tổng hợp và tạo PDF（tệp tài liệu / 可攜式文件）A4 ngang trên máy người dùng.

本工具只服務裁片出單頁，接收系統已完成加總的資料，於使用者電腦產生 A4 橫式 PDF。它與裁帶工具完全獨立，不共用程式、服務位置、快取或暫存資料。

## Thư mục chạy chính thức / 正式執行資料夾

```text
OneDrive\1MAY9\Công cụ chuyển đổi PDF chi tiết cắt
```

Thư mục cần có bốn tệp / 資料夾內應有 4 個檔案：

- `local-piece-cutting-server.ps1`：dịch vụ tạo PDF / 裁片 PDF 轉檔服務。
- `local-piece-cutting-launcher.ps1`：đăng ký và mở công cụ / 登記並啟動工具。
- `Khởi động công cụ PDF cắt chi tiết.bat`：thiết lập lần đầu và khởi động / 第一次設定及啟動。
- `Hủy đường dẫn công cụ PDF cắt chi tiết.bat`：hủy đường dẫn đã đăng ký / 取消已登記路徑。

Mỗi máy tính và mỗi tài khoản Windows cần nhấp đúp tệp khởi động một lần / 每台電腦、每個 Windows 帳號都要各自雙擊啟動檔設定一次。

## Dịch vụ độc lập / 獨立服務

- Cắt dây / 裁帶：`127.0.0.1:8765`，`cuttingpdf://`。
- Cắt chi tiết / 裁片：`127.0.0.1:8766`，`piececuttingpdf://`。

Số `8765` và `8766` là cổng nội bộ trên chính máy tính, dùng để phân biệt hai công cụ; không phải địa chỉ Internet và không mở cho máy khác / 8765 與 8766 是同一台電腦內用來區分兩個工具的連接埠，不是外部網址，也不開放其他電腦連線。

## Cách sử dụng / 使用流程

1. Đặt thư mục OneDrive ở trạng thái `Luôn giữ trên thiết bị này / 永遠保留在此裝置`。
2. Nhấp đúp `Khởi động công cụ PDF cắt chi tiết.bat`。
3. Mở trang `Xuất phiếu cắt chi tiết / 裁片出單` và nhấn `Mở công cụ PDF / 啟動 PDF 工具`。
4. Kiểm tra trạng thái; giữ cửa sổ PowerShell mở khi tạo PDF。

Nếu đường dẫn OneDrive thay đổi, chạy tệp hủy đường dẫn tại vị trí cũ rồi chạy lại tệp khởi động tại vị trí mới / OneDrive 路徑變更時，先取消舊路徑，再於新位置重新執行啟動檔。

## Điểm chức năng / 功能端點

| Đường dẫn / 路徑 | Công dụng / 用途 |
|---|---|
| `/health` | Kiểm tra đúng công cụ cắt chi tiết / 確認是裁片工具且已啟動 |
| `/piece-cutting/cache/status` | Kiểm tra bộ nhớ đệm theo mã nội dung / 依內容驗證碼確認快取 |
| `/piece-cutting/cache` | Xóa bộ nhớ đệm được chỉ định / 清除指定裁片快取 |
| `/piece-cutting/pdf` | Nhận dữ liệu và tạo PDF / 接收資料並產生 PDF |

## Cache và tệp tạm / 快取與暫存

- Chỉ mục và hình ảnh dùng thư mục `piece-cutting-cache` / 索引與圖片使用 `piece-cutting-cache`。
- Mỗi lần chuyển đổi dùng thư mục tạm bắt đầu bằng `piece-cutting-pdf-` / 每次轉檔使用 `piece-cutting-pdf-`開頭的專用暫存資料夾。
- Thành công hoặc thất bại đều dọn dữ liệu tạm; cache hợp lệ được giữ để lần sau không cần gửi lại toàn bộ mẫu / 成功或失敗都會清理當次暫存；有效快取會保留，避免下次重送完整主檔。
- Không xóa thủ công một phần cache khi công cụ đang chạy / 工具運作中不要手動刪除部分快取。

## Quy tắc tạo trang / 頁面產生規則

- Mỗi trang chỉ có một nội dung hình thực tế và một vật liệu; nhiều mã dùng chung hình chỉ hiển thị một ảnh đại diện / 每頁只包含一種實際圖片內容與一種布料；共用圖片的多款號只顯示一張代表照片。
- Công cụ dùng SHA-256 của nội dung hình để hợp nhất các vùng hình khác nhau nhưng có ảnh hoàn toàn giống nhau; cùng vật liệu nhưng ảnh khác phải tách trang / 工具以圖片內容的 SHA-256（內容驗證碼）合併分處不同範圍但完全相同的圖片；相同布料但圖片不同時必須分頁。
- Ảnh giữ nguyên hướng gốc khi Excel không đặt góc xoay; chỉ áp dụng góc xoay và vùng cắt được lưu rõ ràng trong Excel, không tự đoán theo chiều rộng hoặc chiều cao / Excel 沒有設定旋轉時保持原圖；只套用 Excel 明確保存的旋轉角度與裁切範圍，不依寬高自行猜測方向。
- Số lượng chi tiết = số lượng đơn hàng × `SỐ KIỆN` / 裁片數量＝訂單數量 × `SỐ KIỆN`。
- Trang A4 ngang có chiều rộng cột cố định; nội dung dài tự xuống dòng và tăng chiều cao hàng, nhưng một hàng chi tiết không bị chia qua hai trang / A4 橫式採固定欄寬；長內容自動換行並增加列高，但同一裁片列不會拆到兩頁。
- Phần dưới cố định: bảng `GHI CHÚ` bên trái và khung `HÌNH ẢNH` bên phải. Khi không có ghi chú vẫn giữ tiêu đề và khung trống; ảnh giữ đúng tỷ lệ, không kéo giãn hoặc cắt xén / 下方固定為左側備註表與右側照片框；沒有備註仍保留表頭與空框，照片等比例縮放且不拉伸、不裁切。
- Ghi chú hiển thị mã hàng, kích thước, bộ phận cắt và nội dung. Ghi chú dài sẽ làm giảm số hàng chi tiết trên trang; trường hợp đặc biệt mới tạo trang ghi chú tiếp theo mà không lặp số lượng / 備註顯示款號、尺寸、裁片與內容；備註較多時減少本頁裁片列，極端情況才建立不重複數量的備註延續頁。
- Cỡ chữ của toàn trang được cố định theo bản in A4: tiêu đề khoảng 22 pt; nhãn và số trang 9 pt; mã hàng và đơn hàng 13 pt đậm; tiêu đề bảng 10.5 pt đậm; vật liệu, bộ phận và ghi chú 10–10.5 pt; kích thước và số lượng 14 pt đậm. Chỉ số lượng quá dài mới giảm xuống khoảng 13 hoặc 12 pt / 全頁字級按 A4 固定：標題約 22 pt；標籤與頁碼 9 pt；款號與訂單 13 pt 粗體；表頭 10.5 pt 粗體；布料、裁片、備註 10–10.5 pt；尺寸與數量 14 pt 粗體。只有過長數量會降至約 13 或 12 pt。
- Khi một nhóm cần nhiều trang, số trang được tính riêng như `Trang 1/2`, `Trang 2/2` / 同一組需要延續頁時，頁碼依該組獨立計算。
- Nội dung PDF chỉ dùng tiếng Việt / PDF 內容只使用越文。
- Công cụ chỉ xử lý nhóm có trong đơn hàng, dùng lại cache hình ảnh phiên bản 3 đã lưu trang tính, góc xoay, vùng cắt và mã kiểm tra của ảnh hiển thị; không mở Excel hoặc Word để chuyển đổi / 工具只處理訂單用到的群組，重用保存工作表身分、旋轉、裁切及顯示圖片驗證碼的第三版圖片快取，且不開啟 Excel 或 Word 進行轉檔。

## Giới hạn an toàn / 安全限制

- Dịch vụ chỉ nghe tại `127.0.0.1（địa chỉ vòng lặp máy / 本機回送位址）`。
- Chỉ nhận yêu cầu từ trang chính thức và nguồn kiểm tra nội bộ được cho phép / 只接受正式網站與核准的本機測試來源。
- Dung lượng mỗi yêu cầu tối đa 200 MB（megabyte / 百萬位元組）/ 單次要求上限 200 MB。
- Công cụ không thay thế đăng nhập, quyền chức năng hoặc Firestore Security Rules（quy tắc bảo mật / 雲端資料庫安全規則）/ 本機工具不取代登入、功能權限或安全規則。

## Xử lý sự cố / 故障排除

- Báo chưa chạy: nhấp lại tệp khởi động, cho phép trình duyệt mở `piececuttingpdf://`, rồi kiểm tra trạng thái / 顯示未啟動時，重新執行啟動檔，允許瀏覽器開啟專用連結後再檢查狀態。
- Bị từ chối nguồn: chỉ dùng trang chính thức; không mở giới hạn cho tất cả trang / 來源被拒絕時只使用正式網站，不可全面開放來源。
- OneDrive chỉ trực tuyến: chọn luôn giữ trên thiết bị rồi khởi động lại / OneDrive 只有線上檔案時，先設為永遠保留在此裝置再重啟。
- PDF cũ hoặc lỗi cache: đóng công cụ, mở lại và dùng chức năng xóa cache của hệ thống / PDF 仍為舊版或快取異常時，關閉工具、重新啟動，再使用系統的清除快取功能。

## Đồng bộ khi sửa / 修改後同步

Tệp trong dự án là nguồn phát triển; bốn tệp trong OneDrive là bản chạy chính thức. Mỗi lần sửa phải đồng bộ đúng tệp và so sánh lại hash（giá trị băm / 雜湊值）hiện tại / 專案是開發來源，OneDrive 的 4 個檔案是正式執行版本；每次修改都必須重新同步並比對目前檔案雜湊值。
