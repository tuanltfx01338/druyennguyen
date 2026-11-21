# Sổ bệnh án Nha khoa

Web app (Google Apps Script) quản lý bệnh án nha khoa: hồ sơ bệnh nhân, nhật ký khám, ảnh gốc, tìm kiếm, nhập dữ liệu cũ.
Dữ liệu nằm trong Google Drive của bác sĩ: `NhaKhoa/BenhAn` (Google Sheet) + `NhaKhoa/BenhNhan/<MãBN>_<Tên>/<ngày khám>/` (ảnh).
Tài liệu: `PRD.md`, `DESIGN.md` (trong Claude Project).

## Cấu trúc
```
src/appsscript.json        manifest (scopes, Drive advanced service v3, webapp MYSELF)
src/server/*.gs            Lib (hàm thuần) · Repo (Sheet) · Main (doGet, setup) · Patients · Visits · Images · Import · Backup
src/client/*.html          Index · Styles · App.js · Upload.js · Import.js
test/                      lib.test.js · server.test.js (fake GAS) · ui.smoke.js (jsdom)
```

## Lệnh
| Lệnh | Việc |
|---|---|
| `npm test` | Unit + integration (server trên fake GAS), không cần cài gì (Node ≥ 18) |
| `npm i && npm run test:ui` | UI smoke test (jsdom) |
| `npx clasp push` | Đẩy code lên Apps Script |

## Cài đặt lần đầu (làm bằng **tài khoản Gmail của bác sĩ**)
> App chạy với quyền "Only myself" → chủ sở hữu script phải là chính bác sĩ, dữ liệu nằm trong Drive của bác sĩ.

1. `npm i` → `npx clasp login` (đăng nhập Gmail bác sĩ). Bật Apps Script API tại https://script.google.com/home/usersettings.
2. `npx clasp create --type standalone --title "So benh an Nha khoa" --rootDir src` → `npx clasp push`.
3. Mở https://script.google.com → project vừa tạo → chọn hàm `setup` → **Run** → cấp quyền.
   Google báo *"Google hasn't verified this app"* → **Advanced → Go to So benh an Nha khoa (unsafe)** (script của chính mình).
   Kết quả: thư mục `NhaKhoa` (BenhNhan, _import, _backup, _system) + Sheet `BenhAn` + trigger sao lưu Chủ nhật 22h.
4. **Deploy → New deployment → Web app**: Execute as **Me**, Who has access **Only myself** → copy URL `/exec`.
5. Điện thoại: mở URL trong Chrome/Safari (đăng nhập Gmail bác sĩ) → *Thêm vào màn hình chính*.

### Cập nhật phiên bản
`npx clasp push` → script.google.com → **Deploy → Manage deployments → ✏️ → Version: New version → Deploy** (giữ nguyên URL).
Rollback: chọn lại version cũ ở bước này.

## Kiểm tra sau cài đặt (bắt buộc, theo DESIGN §1 rủi ro CORS)
1. Tạo 1 bệnh nhân thử → thêm lần khám → chọn 2–3 ảnh từ điện thoại → Lưu.
2. Mở Drive `NhaKhoa/BenhNhan/...` → ảnh có đúng dung lượng gốc.
3. Nếu tải trực tiếp bị trình duyệt chặn, app tự chuyển sang tải qua server (chậm hơn, vẫn giữ ảnh gốc) — không cần làm gì. Ghi lại kết quả để chốt GĐ 8.
4. Xoá hồ sơ thử.

## Nhập dữ liệu cũ
1. Điền `Mau_nhap_benh_nhan_cu.xlsx` (xoá dòng VÍ DỤ).
2. Chép các thư mục ảnh (`0001_Nguyen Van An`, …) vào Drive `NhaKhoa/_import/`.
3. App → **Nhập dữ liệu cũ** → Xem trước → Xác nhận → Kiểm tra thư mục ảnh → Di chuyển ảnh.
Chạy lại an toàn: bệnh nhân đã nhập (theo STT) được bỏ qua.

## Bảo mật & dữ liệu
- Chỉ tài khoản chủ mở được app (Google chặn ở tầng deploy). Không chia sẻ thư mục `NhaKhoa`/Sheet cho ai.
- Xoá trong app là xoá mềm (Sheet còn dòng, cột `deleted=TRUE`); ảnh xoá vào Thùng rác Drive 30 ngày.
- Sheet sao lưu hằng tuần vào `NhaKhoa/_backup` (giữ 8 bản). Ảnh không sao lưu thêm.
- Không commit file Excel/ảnh thật vào Git (`.gitignore`).
