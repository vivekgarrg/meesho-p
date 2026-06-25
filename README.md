# Meesho Profit Calculator

A full-stack Django + React application that parses Meesho's SP_ORDER_ADS_REFERRAL_PAYMENT Excel files and calculates your net profit.

---

## Architecture

```
meesho_profit/
├── backend/                  # Django REST API
│   ├── meesho_app/
│   │   ├── models.py         # 4 MySQL tables
│   │   ├── views.py          # Upload + profit endpoints
│   │   ├── serializers.py
│   │   ├── urls.py
│   │   └── migrations/
│   ├── meesho_project/
│   │   ├── settings.py
│   │   └── urls.py
│   ├── manage.py
│   └── requirements.txt
└── frontend/                 # React + Vite dashboard
    ├── src/
    │   ├── App.jsx
    │   ├── main.jsx
    │   └── index.css
    ├── package.json
    └── vite.config.js
```

---

## Database Schema

### 1. `order_payments` (Primary: `sub_order_no`)
Maps to **Order Payments** sheet — all 43 columns including:
- Order details: sub_order_no, order_date, product_name, supplier_sku, catalog_id
- Payment: transaction_id, payment_date, final_settlement_amount
- Revenue: total_sale_amount, total_sale_return_amount
- Deductions: meesho_commission_incl_gst, meesho_gold_platform_fee, meesho_mall_platform_fee
- Other charges: shipping_charge_incl_gst, warehousing_fee
- TCS & TDS: tcs, tds_rate_percent, tds
- Compensation/Recovery: compensation, claims, recovery (with reasons)

### 2. `ads_cost`
Maps to **Ads Cost** sheet:
- deduction_duration, deduction_date, campaign_id
- ad_cost, credits_waivers_discounts, ad_cost_incl_credits_waivers
- gst, total_ads_cost

### 3. `referral_payments` (Primary: `reward_id`)
Maps to **Referral Payments** sheet:
- reward_id, payment_date, store_name, reason
- net_referral_amount, taxes_gst_tds

### 4. `compensation_recovery`
Maps to **Compensation and Recovery** sheet:
- date, program_name, reason, amount_incl_gst

---

## Profit Formula

```
Net Profit = Net Settlement Amount
           + Total Ads Cost          (already negative)
           + Total Referral Income
           + Total Compensation/Recovery (can be negative)
```

---

## Setup

### 1. MySQL Database

```sql
CREATE DATABASE meesho_profit CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE USER 'meesho'@'localhost' IDENTIFIED BY 'yourpassword';
GRANT ALL PRIVILEGES ON meesho_profit.* TO 'meesho'@'localhost';
FLUSH PRIVILEGES;
```

### 2. Django Backend

```bash
cd backend

# Install dependencies
pip install -r requirements.txt

# Set environment variables (or edit settings.py directly for dev)
export DB_ENGINE=mysql
export DB_NAME=meesho_profit
export DB_USER=meesho
export DB_PASSWORD=root
export DB_HOST=localhost
export DB_PORT=3306

# Run migrations
python manage.py migrate

# Start server
python manage.py runserver 8000
```

> **SQLite fallback**: If you skip the DB_ENGINE env var, Django uses SQLite (`db.sqlite3`) — great for quick testing.

### 3. React Frontend

```bash
cd frontend
npm install
npm run dev
# Opens at http://localhost:3000
```

---

## API Endpoints

| Method | URL | Description |
|--------|-----|-------------|
| POST | `/api/upload/` | Upload Meesho Excel file (multipart/form-data, field: `file`) |
| GET | `/api/profit/` | Get profit summary |
| GET | `/api/orders/?page=1&page_size=50&status=DELIVERED` | Paginated orders |
| GET | `/api/orders/status-breakdown/` | Count + revenue by status |
| GET | `/api/ads/` | All ads cost records |
| GET | `/api/referrals/` | All referral payments |
| GET | `/api/compensation/` | All compensation/recovery records |

---

## Upload

Upload your file via the React UI (Upload tab) or directly via curl:

```bash
curl -X POST http://localhost:8000/api/upload/ \
  -F "file=@3564327_SP_ORDER_ADS_REFERRAL_PAYMENT_FILE_PREVIOUS_PAYMENT_2026-05-01_2026-05-31.xlsx"
```

Response:
```json
{
  "success": true,
  "results": {
    "order_payments": { "created": 245, "updated": 0 },
    "ads_cost": { "created": 3 },
    "referral_payments": { "created": 0 },
    "compensation_recovery": { "created": 1 }
  }
}
```

The upload uses `update_or_create` for orders and referrals (idempotent by primary key), so re-uploading the same file is safe.
