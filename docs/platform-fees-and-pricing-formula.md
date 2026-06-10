# Ma trận phí sàn & công thức tính giá (Shopee / TikTok Shop VN)

Cập nhật tham chiếu: 06/2026. Tra [Học viện Shopee](https://banhang.shopee.vn/edu) và [TikTok Seller University VN](https://seller-vn.tiktok.com/university/) trước khi áp dụng.

---

## 1. Shopee — phí bắt buộc (trên đơn)

| Biến | Tên | Mức tham chiếu |
|------|-----|----------------|
| `commissionRate` | Phí cố định | Theo ngành (VD **13%** trên đơn mẫu) |
| `paymentFeeRate` | Phí xử lý giao dịch | **4,91%** (bảng); đơn thực tế có thể **~6%** |
| `infrastructureFee` | Phí hạ tầng | **3.000đ/đơn** (từ 01/07/2025) |

## 2. Shopee — phí không bắt buộc (khi tham gia)

| Biến | Mức (2026) |
|------|------------|
| `voucherXtraRate` | **5,5%**/SP, max 50.000đ (từ 23/05/2026) |
| `piShipFee` | **2.700đ/đơn** (từ 23/05/2026) |
| `displayRetentionRate` | ~1%+ doanh thu đơn (QC, tùy shop) |

## 3. Gói đã ngừng — không đưa vào công thức 2026

- **Freeship Xtra Plus** — ngừng 08/09/2025 (Mall).
- **Content Xtra** — kết thúc 15/09/2025 (gộp Voucher Xtra).
- **Freeship Xtra % riêng** — từ 01/04/2025 gộp vào phí cố định / mã toàn sàn.
- **Phí rút tiền** — không tính theo đơn (theo lần rút).

## 4. TikTok Shop

**Bắt buộc:** Platform commission (theo ngành), Transaction fee **6%** (từ 09/05/2026), Order processing **3.000đ/đơn**.

**Tùy chọn:** Affiliate, phí ship phạt. **SFP:** chương trình còn; phí dịch vụ SFP Mall hủy từ 27/10/2025; Marketplace **0%**.

---

## 5. Đối soát doanh thu đơn Shopee (trang chi tiết đơn)

**Voucher Xtra** (từ 23/05/2026): **5,5% giá trị mỗi sản phẩm**, tối đa **50.000đ/SP** — tính trên đơn giao thành công ([TukiGroup](https://tukigroup.vn/quan-trong-cap-nhat-ve-phi-danh-cho-nguoi-ban-thuoc-shopee-mall-tu-ngay-29-05-2026/), [Effitrack](https://effitrack.me/phi-san-shopee-2026-cap-nhat-moi-nhat-anh-huong/)).

```text
Phụ phí = phí cố định + Phí DV (3.000 + VX) + phí GD + PiShip (DOM) + Tiếp thị liên kết (DOM) + NTTD 1%×tiền hàng (chỉ khi đơn có dòng NTTD)
Thuế = 1% GTGT×tiền hàng + 0,5% TNCN×tiền hàng
Thu nhập = tiền hàng + seller chịu ship − Phụ phí − Thuế
```

Chi tiết ship/voucher trong `income-group[1]` **không** cộng vào thu nhập.

**Trang đối soát đơn:** map theo nhãn `.income-label-text`. Thứ tự Phụ phí (2026+): **Phí cố định** → **Phí Dịch Vụ** → **Phí xử lý GD** → **Hoa hồng Tiếp thị liên kết** (DOM, seller cài) → **Phí NTTD** (chỉ khi cột Shopee có dòng: lấy số đơn hoặc 1%×tiền hàng). Tính extension: Phí Dịch Vụ (3.000 + VX) + thuế. Cột Kiểm tra ($) căn từng dòng.

### Đơn mẫu (đã kiểm chứng)

| Khoản | Số tiền |
|-------|---------|
| Giá SP | 51.960 |
| Voucher shop | −1.559 |
| netBase | 50.401 |
| Phí cố định 13% | −6.552 |
| Phí xử lý GD 6% | −3.024 |
| Phí DV (3.000 + VX 5,5%) | −5.772 |
| **Doanh thu** | **35.053** |

---

## 6. Công thức ngược — giá bán (popup **$**, cùng đối soát đơn)

**Lợi nhuận mong muốn = VNĐ/sp.** Extension tìm `p` sao cho:

```text
Thu nhập(p×q) = q×(vốn + lời/sp)
Thu nhập = p×q + sellerShip − Phụ phí − Thuế
```

`Phụ phí` = phí cố định%×tiền hàng + (3.000 + VX) + phí GD%×(tiền hàng + ship khách) + NTTD 1%×tiền hàng (popup $ luôn cộng; đối soát đơn chỉ khi có dòng Shopee).  
`Thuế` = GTGT%×tiền hàng + TNCN%×tiền hàng.

Popup **$**: nhập **lợi nhuận/sp** hoặc (nếu để trống lợi nhuận) **giá muốn nhận về/sp** — thu nhập sau phí sàn, chưa trừ vốn. Ship do sàn tự chọn, không nhập. % phí lấy từ danh mục SP khi có.

## 7. Phí cố định theo danh mục (trang sản phẩm)

Nguồn: [Cập nhật phí seller thường 23/05/2026](https://banhang.shopee.vn/edu/article/27540) + [biểu phí PDF](https://mms.file.susercontent.com/api/v4/11195002/mms/vn-11195002-bmlg7-mo9l5o5t9kaz4f) (~1594 dòng L1–L3).

Ví dụ **Sở thích & Sưu tầm > Quà Lưu Niệm > Móc khóa**: **16%** (từ 23/05/2026; trước đó khoảng 13–14%).

Extension đọc danh mục trên **Shopee** (`.product-category-text`) hoặc **BigSeller** (cascade `ant-select` trong `.page_edit_item`), hiển thị **Phí cố định: …%** (đỏ) cạnh danh mục và tự điền % vào popup **$** / `platformFeeConfig.commissionRate`. BigSeller chỉ hiện tên lá (vd `Bút Chì`) vẫn tra được qua so khớp mờ với biểu phí.

Tái tạo `src/pricing/data/shopee-category-fees.data.js` (file duy nhất, nhóm theo %, chữ không dấu): `node scripts/parse-shopee-category-fees.mjs` (nguồn: `src/pricing/data/danh mục ngành hàng.xlsx`).

## 8. Extension

Tab tính giá: nút nổi **$** → popup (không blur nền). Logic: `src/pricing/order-profit.js`, `category-commission.js`, `wholesale-tiers.js`.
