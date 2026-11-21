from openpyxl import Workbook
from openpyxl.styles import Font, PatternFill, Alignment, Border, Side
from openpyxl.worksheet.datavalidation import DataValidation
from openpyxl.utils import get_column_letter
from datetime import date

F = "Arial"
N_ROWS = 1000           # số dòng nhập sẵn định dạng/công thức
FIRST, LAST = 3, 3 + N_ROWS - 1
hdr_req = PatternFill("solid", fgColor="FFE699")   # bắt buộc
hdr_opt = PatternFill("solid", fgColor="DDEBF7")   # tuỳ chọn
hdr_auto = PatternFill("solid", fgColor="D9D9D9")  # tự tính
ex_fill = PatternFill("solid", fgColor="F2F2F2")
auto_fill = PatternFill("solid", fgColor="F2F2F2")
thin = Side(style="thin", color="BFBFBF")
border = Border(left=thin, right=thin, top=thin, bottom=thin)

wb = Workbook()

# ---------- BenhNhan ----------
bn = wb.active; bn.title = "BenhNhan"
bn_cols = [  # (header, kind, width, fmt)
    ("STT *", "req", 7, "0"),
    ("Mã BN (để trống)", "opt", 14, "@"),
    ("Họ tên *", "req", 24, "@"),
    ("Ngày sinh", "opt", 12, "dd/mm/yyyy"),
    ("Năm sinh", "opt", 9, "0"),
    ("Giới tính", "opt", 9, "@"),
    ("CCCD", "opt", 15, "@"),
    ("SĐT", "opt", 22, "@"),
    ("Địa chỉ", "opt", 30, "@"),
    ("Dị ứng", "opt", 18, "@"),
    ("Bệnh toàn thân", "opt", 20, "@"),
    ("Thuốc đang dùng", "opt", 20, "@"),
    ("Thư mục ảnh", "opt", 24, "@"),
    ("Ghi chú", "opt", 25, "@"),
    ("Số lần khám (tự tính)", "auto", 11, "0"),
]
bn_ex = [1, None, "Nguyễn Văn An", date(1985, 3, 12), None, "Nam", "079085001234", "0903123456, 0912345678",
         "12 Lê Lợi, P. Bến Thành, TP.HCM", "Penicillin", "Cao huyết áp",
         "Amlodipine 5mg", "0001_Nguyen Van An", "Dòng VÍ DỤ – app bỏ qua dòng có STT = 1 nếu tên là Nguyễn Văn An? Không: xoá dòng này trước khi import"]

# ---------- LanKham ----------
lk_cols = [
    ("STT BN *", "req", 8, "0"),
    ("Họ tên (tự hiện)", "auto", 22, "@"),
    ("Ngày khám *", "req", 12, "dd/mm/yyyy"),
    ("Lý do khám", "opt", 22, "@"),
    ("Chẩn đoán", "opt", 24, "@"),
    ("Răng liên quan (FDI)", "opt", 12, "@"),
    ("Điều trị đã làm", "opt", 28, "@"),
    ("Kế hoạch tiếp", "opt", 22, "@"),
    ("Đơn thuốc", "opt", 22, "@"),
    ("Hẹn tái khám", "opt", 12, "dd/mm/yyyy"),
    ("Ghi chú", "opt", 25, "@"),
]

def setup(ws, cols, title):
    ws["A1"] = title
    ws["A1"].font = Font(name=F, bold=True, size=12)
    for i, (h, kind, w, fmt) in enumerate(cols, 1):
        c = ws.cell(row=2, column=i, value=h)
        c.font = Font(name=F, bold=True, size=10)
        c.fill = {"req": hdr_req, "opt": hdr_opt, "auto": hdr_auto}[kind]
        c.alignment = Alignment(horizontal="center", vertical="center", wrap_text=True)
        c.border = border
        ws.column_dimensions[get_column_letter(i)].width = w
        for r in range(FIRST, LAST + 1):
            cell = ws.cell(row=r, column=i)
            cell.number_format = fmt
            cell.font = Font(name=F, size=10)
            cell.alignment = Alignment(vertical="top", wrap_text=(w >= 20))
            if kind == "auto":
                cell.fill = auto_fill
    ws.row_dimensions[2].height = 32
    ws.freeze_panes = "C3" if ws.title == "BenhNhan" else "D3"
    ws.auto_filter.ref = f"A2:{get_column_letter(len(cols))}{LAST}"

setup(bn, bn_cols, "DANH SÁCH BỆNH NHÂN CŨ — mỗi dòng 1 bệnh nhân (dòng 3 là VÍ DỤ, xoá trước khi import)")
lk = wb.create_sheet("LanKham")
setup(lk, lk_cols, "NHẬT KÝ CÁC LẦN KHÁM — mỗi dòng 1 lần khám, nối với bệnh nhân qua cột STT BN (dòng 3 là VÍ DỤ)")

# Công thức tự tính
for r in range(FIRST, LAST + 1):
    bn[f"O{r}"] = f'=IF(A{r}="","",COUNTIF(LanKham!$A${FIRST}:$A${LAST},A{r}))'
    lk[f"B{r}"] = (f'=IF(A{r}="","",IFERROR(INDEX(BenhNhan!$C${FIRST}:$C${LAST},'
                   f'MATCH(A{r},BenhNhan!$A${FIRST}:$A${LAST},0)),"⚠ Không có STT này"))')

# Dòng ví dụ
bn_ex[-1] = "VÍ DỤ – xoá dòng này trước khi import"
for i, v in enumerate(bn_ex, 1):
    if v is not None:
        bn.cell(row=3, column=i, value=v)
lk_ex = {1: 1, 3: date(2024, 5, 20), 4: "Đau răng hàm dưới phải", 5: "Viêm tuỷ không hồi phục R46",
         6: "46", 7: "Lấy tuỷ, trám tạm", 8: "Hẹn chữa tuỷ lần 2, làm sứ",
         9: "Clindamycin 300mg x 15v; Paracetamol 500mg x 10v", 10: date(2024, 5, 27),
         11: "VÍ DỤ – xoá dòng này trước khi import"}
for col, v in lk_ex.items():
    lk.cell(row=3, column=col, value=v)
for ws, n in ((bn, len(bn_cols)), (lk, len(lk_cols))):
    for i in range(1, n + 1):
        c = ws.cell(row=3, column=i)
        c.fill = ex_fill
        c.font = Font(name=F, size=10, italic=True, color="7F7F7F")

# ---------- Data validation ----------
def dv(ws, ref, **kw):
    d = DataValidation(showErrorMessage=True, **kw); d.add(ref); ws.add_data_validation(d)

rng = lambda col: f"{col}{FIRST}:{col}{LAST}"
dv(bn, rng("A"), type="custom", formula1=f"AND(ISNUMBER(A{FIRST}),A{FIRST}>=1,A{FIRST}=INT(A{FIRST}),COUNTIF($A${FIRST}:$A${LAST},A{FIRST})=1)",
   errorTitle="STT không hợp lệ", error="STT phải là số nguyên ≥ 1 và không trùng.")
dv(bn, rng("D"), type="date", operator="between", formula1="DATE(1900,1,1)", formula2="TODAY()",
   errorTitle="Ngày sinh", error="Nhập ngày dạng dd/mm/yyyy, không sau hôm nay.")
dv(bn, rng("E"), type="whole", operator="between", formula1="1900", formula2="2100",
   errorTitle="Năm sinh", error="Nhập năm 4 chữ số, VD 1985.")
dv(bn, rng("F"), type="list", formula1='"Nam,Nữ"', allow_blank=True,
   errorTitle="Giới tính", error="Chọn Nam hoặc Nữ.")
dv(bn, rng("G"), type="custom", formula1=f'OR(G{FIRST}="",AND(LEN(SUBSTITUTE(G{FIRST}," ",""))=12,ISNUMBER(--SUBSTITUTE(G{FIRST}," ","")),COUNTIF($G${FIRST}:$G${LAST},G{FIRST})=1))',
   errorTitle="CCCD", error="Số CCCD gồm 12 chữ số và không được trùng.")
dv(lk, rng("A"), type="custom", formula1=f"COUNTIF(BenhNhan!$A${FIRST}:$A${LAST},A{FIRST})>0",
   errorTitle="STT BN", error="STT này chưa có trong sheet BenhNhan.")
for col in ("C", "J"):
    dv(lk, rng(col), type="date", operator="between", formula1="DATE(1990,1,1)", formula2="DATE(2100,12,31)",
       errorTitle="Ngày", error="Nhập ngày dạng dd/mm/yyyy.")

# ---------- HuongDan ----------
hd = wb.create_sheet("HuongDan", 0)
hd.column_dimensions["A"].width = 26; hd.column_dimensions["B"].width = 95
rows = [
    ("MẪU NHẬP DỮ LIỆU BỆNH NHÂN CŨ — Sổ bệnh án Nha khoa", None, "title"),
    (None, None, None),
    ("Chú thích màu tiêu đề", None, "h"),
    ("", "Cột BẮT BUỘC nhập (có dấu *)", "req"),
    ("", "Cột tuỳ chọn – có thì nhập, không có để trống", "opt"),
    ("", "Cột TỰ TÍNH – không nhập, app bỏ qua khi import", "auto"),
    ("", "Dòng 3 mỗi sheet là VÍ DỤ (chữ xám nghiêng) – xem để biết định dạng, XOÁ trước khi import", "ex"),
    (None, None, None),
    ("Cách nhập", None, "h"),
    ("1. Sheet BenhNhan", "Mỗi dòng 1 bệnh nhân. Cột STT đánh 1, 2, 3… không trùng – đây là khoá để nối với sheet LanKham.", None),
    ("2. Sheet LanKham", "Mỗi dòng 1 lần khám. Cột STT BN ghi đúng STT của bệnh nhân bên sheet BenhNhan; cột Họ tên sẽ tự hiện để kiểm tra. Một bệnh nhân có thể có nhiều dòng.", None),
    ("Mã BN", "Để trống. Khi import, app tự cấp mã NKyy-nnnn với yy = năm của lần khám ĐẦU TIÊN (không có lần khám thì dùng năm import).", None),
    ("Ngày sinh / Năm sinh", "Biết ngày đầy đủ thì nhập Ngày sinh (dd/mm/yyyy); chỉ biết năm thì nhập Năm sinh.", None),
    ("Ngày tháng", "Gõ dạng 12/03/1985 – Excel phải hiểu là ngày (căn phải). Nếu bị căn trái nghĩa là đang là chữ, cần gõ lại.", None),
    ("CCCD", "Số căn cước công dân 12 chữ số (gõ như chữ, giữ số 0 đầu). Mỗi người một số, không được trùng. Trẻ em chưa có thì để trống.", None),
    ("SĐT", "Giữ số 0 đầu, VD 0903123456. Nhiều số cách nhau dấu phẩy: 0903123456, 0912345678.", None),
    ("Răng liên quan (FDI)", "Số răng theo FDI, nhiều răng cách nhau dấu phẩy, VD 16, 17, 46.", None),
    ("Hẹn tái khám", "Chỉ cần ngày; khi import thành lịch hẹn chưa đặt giờ (ngày đã qua được đánh dấu Đã đến).", None),
    ("Ngày khám không rõ", "Nhập ngày gần đúng và ghi 'ngày ước lượng' vào Ghi chú.", None),
    (None, None, None),
    ("Ảnh cũ trên laptop", None, "h"),
    ("Đặt tên thư mục", "Mỗi bệnh nhân 1 thư mục, đặt tên theo dạng STT_HoTen không dấu, VD 0001_Nguyen Van An (STT 4 chữ số).", None),
    ("Cột Thư mục ảnh", "Ghi đúng tên thư mục đó vào cột Thư mục ảnh của bệnh nhân. App ghép ảnh theo cột này (không đoán theo tên).", None),
    ("Đưa lên Drive", "Chép toàn bộ các thư mục vào Google Drive: NhaKhoa/_import/. Ảnh cũ sẽ gắn vào lần khám 'Dữ liệu cũ' của từng bệnh nhân, giữ nguyên bản gốc.", None),
    (None, None, None),
    ("Lưu ý bảo mật", None, "h"),
    ("", "File chứa dữ liệu sức khỏe của bệnh nhân. Không gửi qua Zalo/email cho người khác; xoá bản trên laptop/USB sau khi import xong và đã kiểm tra.", None),
]
fills = {"req": hdr_req, "opt": hdr_opt, "auto": hdr_auto, "ex": ex_fill}
for r, (a, b, kind) in enumerate(rows, 1):
    ca, cb = hd.cell(row=r, column=1, value=a), hd.cell(row=r, column=2, value=b)
    for c in (ca, cb):
        c.font = Font(name=F, size=10); c.alignment = Alignment(vertical="top", wrap_text=True)
    if kind == "title": ca.font = Font(name=F, bold=True, size=14)
    elif kind == "h": ca.font = Font(name=F, bold=True, size=11, color="1F4E78")
    elif kind in fills:
        ca.fill = fills[kind]; ca.border = border
        if kind == "ex": cb.font = Font(name=F, size=10, italic=True, color="7F7F7F")
    elif a: ca.font = Font(name=F, bold=True, size=10)

wb.active = 0
import sys
out = sys.argv[1] if len(sys.argv) > 1 else "Mau_nhap_benh_nhan_cu.xlsx"
wb.save(out); print(out)
