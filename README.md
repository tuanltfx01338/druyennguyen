# Sổ bệnh án Nha khoa

Web app (Google Apps Script) quản lý bệnh án nha khoa: hồ sơ bệnh nhân, nhật ký khám, ảnh gốc, tìm kiếm, nhập dữ liệu cũ.
Dữ liệu nằm trong Google Drive của **tài khoản chủ app** (hiện là Gmail của Tuấn, gói 200 GB): `NhaKhoa/BenhAn` (Google Sheet) + `NhaKhoa/BenhNhan/<MãBN>_<Tên>/<ngày khám>/` (ảnh).
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
| `npm ci && npm run test:ui` | UI smoke test (jsdom) |
| `npx clasp push` | Đẩy code lên Apps Script |
| `node tools/build-demo.js` | Trang xem thử `dist/demo.html` (dữ liệu giả) |
| `python3 tools/build-template.py out.xlsx` | Tạo file Excel mẫu nhập dữ liệu cũ |

## Cài đặt lần đầu (làm bằng **tài khoản Google chủ app** — hiện là Gmail của Tuấn)
> App chạy "Execute as Me" + "Only myself" → chỉ đúng tài khoản chủ app mở được; script, Sheet và ảnh đều nằm trong Drive của tài khoản đó.
> Điện thoại/máy của bác sĩ phải **đăng nhập tài khoản chủ app** để dùng (xem mục *Thiết bị của bác sĩ*).

1. `npm i` → `npx clasp login` (đăng nhập tài khoản chủ app). Bật Apps Script API tại https://script.google.com/home/usersettings.
2. `npx clasp create --type standalone --title "So benh an Nha khoa" --rootDir src` → `npx clasp push`.
3. Mở https://script.google.com → project vừa tạo → chọn hàm `setup` → **Run** → cấp quyền.
   Google báo *"Google hasn't verified this app"* → **Advanced → Go to So benh an Nha khoa (unsafe)** (script của chính mình).
   Kết quả: thư mục `NhaKhoa` (BenhNhan, _import, _backup, _system) + Sheet `BenhAn` + trigger sao lưu Chủ nhật 22h.
4. **Deploy → New deployment → Web app**: Execute as **Me**, Who has access **Only myself** → copy URL `/exec`.
5. Điện thoại: mở URL trong Chrome/Safari (đã đăng nhập tài khoản chủ app) → *Thêm vào màn hình chính*.

### Thiết bị của bác sĩ
- Đăng nhập tài khoản chủ app trong trình duyệt của bác sĩ. Nên dùng **một Chrome profile riêng** (hoặc Safari chỉ đăng nhập tài khoản này):
  Apps Script hay báo *"Sorry, unable to open the file at this time"* khi trình duyệt đăng nhập nhiều Google account cùng lúc mà tài khoản chủ app không phải account mặc định.
- Bật khoá màn hình cho thiết bị; trình duyệt này có quyền vào toàn bộ Drive của tài khoản chủ app.

### Chuyển sang tài khoản khác sau này (ví dụ Gmail của bác sĩ)
1. Tài khoản cũ: chia sẻ thư mục `NhaKhoa` cho tài khoản mới rồi **chuyển quyền sở hữu** (Drive → Share → Transfer ownership; tài khoản mới chấp nhận) cho thư mục, Sheet `BenhAn` và toàn bộ ảnh. Cách này giữ nguyên ID file/thư mục mà Sheet đang tham chiếu. **Không** dùng Takeout/tải về rồi upload lại: ID đổi, app mất liên kết ảnh.
2. Tài khoản mới: làm bước 1–2 ở trên, rồi trong Apps Script → Project Settings → **Script properties** thêm `ROOT_ID` (ID thư mục `NhaKhoa`) và `SHEET_ID` (ID Sheet `BenhAn`) **trước** khi chạy `setup` (nếu không, `setup` tạo thư mục mới trống). Sau đó chạy `setup`, deploy như bước 3–4.
3. Đổi biến `APP_URL` trên GitHub sang link `/exec` mới → chạy lại workflow Pages. Link github.io giữ nguyên.


### Cập nhật phiên bản
`npx clasp push` → script.google.com → **Deploy → Manage deployments → ✏️ → Version: New version → Deploy** (giữ nguyên URL).
Rollback: chọn lại version cũ ở bước này.

## GitHub (repo public) + link `https://<tài-khoản>.github.io/<repo>/`
Repo public **chỉ chứa mã nguồn** — dữ liệu bệnh nhân nằm trong Drive/Sheet của tài khoản chủ app, không bao giờ vào repo
(`.gitignore` chặn `*.xlsx`, `.clasp.json`, `.clasprc.json`). App vẫn chạy trên Apps Script với quyền "Only myself";
trang github.io chỉ là **lối vào**: mở ra sẽ chuyển sang link `script.google.com/.../exec` của app.

1. Tạo repo **public** trên GitHub (ví dụ `nhakhoa`), rồi trong thư mục này:
   ```bash
   git remote add origin https://github.com/<tài-khoản>/nhakhoa.git
   git push -u origin main
   ```
2. **Settings → Pages → Build and deployment → Source: GitHub Actions.**
3. **Settings → Secrets and variables → Actions → Variables → New variable**: `APP_URL` = link `/exec` của web app
   (Apps Script → Deploy → Manage deployments → Web app URL).
4. **Actions → Pages → Run workflow** (lần đầu; sau đó tự chạy khi sửa `site/`).
   Link: `https://<tài-khoản>.github.io/nhakhoa/` → trên điện thoại mở link này → *Thêm vào màn hình chính*.
5. Workflow **CI** tự chạy test mỗi lần push.

Trang lối vào có `noindex` (Google không lập chỉ mục), chỉ chấp nhận link dạng `https://script.google.com/macros/s/…/exec`.

### (Tuỳ chọn) Tự deploy Apps Script khi push
Mặc định **tắt**. Bật bằng cách thêm: secret `CLASPRC_JSON` (nội dung `~/.clasprc.json` sau `npx clasp login` bằng tài khoản chủ app),
variables `SCRIPT_ID` (trong `.clasp.json`) và `DEPLOYMENT_ID` (Manage deployments → Deployment ID).
Workflow sẽ `clasp push` + `clasp deploy -i <DEPLOYMENT_ID>` (giữ nguyên link).
**Lưu ý bảo mật:** secret này là phiên đăng nhập Google của tài khoản chủ app (cả Gmail/Drive cá nhân); ai có quyền admin repo đều có thể dùng nó.
Nên thêm *required reviewer* cho environment `apps-script` (Settings → Environments), hoặc không bật và deploy thủ công từ máy mình.

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
