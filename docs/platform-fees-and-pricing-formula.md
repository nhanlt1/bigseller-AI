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

## 5. Đối soát doanh thu đơn Shopee

```text
netBase = giá đơn − voucher shop (seller)
platformFees = netBase × (phí cố định% + phí GD% + voucher Xtra% nếu có) + 3.000đ (+ PiShip nếu có)
doanh thu = giá đơn − voucher shop − platformFees
```

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

## 6. Công thức ngược — giá bán để đạt lời/sp

**Lợi nhuận mong muốn = VNĐ trên mỗi sản phẩm.** Đơn `q` SP, đơn giá `p`, không voucher shop:

```text
pMin(q) = ( q × (giáVốn + lợiNhuận/sp) + phíCốĐịnhĐơn ) / ( q × (1 − tổng%Phí) )
```

Giá lẻ: `pMin(1)`.

**Ví dụ:** vốn 6.300, lời 10.000/sp, phí 24,5% + 3.000đ → giá lẻ đề xuất **~25.563đ**. Bậc 2–5 @ 15.000đ → lời **~4.425/sp** (chưa đạt 10.000).

## 7. Extension

Tab tính giá: nút nổi **$** → popup (không blur nền). Logic: `src/pricing/order-profit.ts`, `wholesale-tiers.ts`.
