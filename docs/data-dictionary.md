# دیکشنری داده — اسکیمای SQLite (فاز ۲)

فایل: `data/app.sqlite` (یا `$DATABASE_PATH`). مهاجرت: `src/server/db/migrations/001_init.sql`.
قرارداد خام/نرمال: **ستون‌های `*_raw` همان متن دقیق منبع‌اند** (از جمله رشته‌ی `null`)؛ ستون‌های نوع‌دار/نرمال **افزودنی**‌اند و هیچ سطر منبعی حذف یا بازنویسی نمی‌شود. در ستون‌های ساده (برند، مدل، توضیح، نشانی…) رشته‌ی `null` و رشته‌ی خالی به NULL نگاشت می‌شود.

## جدول‌ها

### `products` (۲۲۵٬۹۰۳ ردیف)
| ستون | نوع | خام/نرمال | توضیح |
|---|---|---|---|
| product_id | TEXT PK | خام | `product_<hex>` |
| brand_name, model, persian_title, category_name | TEXT | خام (NULL برای `null`) | برند در ۷۴٪ و model در ۹۸٪ محصولات خالی است |
| image_urls_raw, specs_raw | TEXT | **خام** | متن دقیق CSV |
| images_json | TEXT | نرمال | آرایه‌ی URLهای http(s) معتبر؛ `javascript:` و … حذف و `PARSE_IMAGES_INVALID` ثبت می‌شود |
| specs_json, spec_count | TEXT, INT | نرمال | آرایه‌ی `{section,key,value}` |
| title_norm, brand_norm, category_norm | TEXT | نرمال | `normalizeSearchText` (ی/ک عربی، ارقام، نیم‌فاصله، اعراب) |
| model_keys | TEXT | نرمال | کلیدهای مدل فشرده (مثلاً `HDW1200CLQP`) جدا‌شده با فاصله |
| offer_count, priced_offer_count | INT | مشتق | شمارنده‌ها |
| parse_issues | TEXT(JSON) | مشتق | کدهای خطای تجزیه |
| source_row | INT | منشأ | شماره‌ی ردیف داده در CSV (از ۱) |

### `shops` (۶٬۴۷۶ ردیف)
| ستون | توضیح |
|---|---|
| shop_id, name, address, location_label | خام. نام‌ها ساختگی‌اند. |
| lat, lon (REAL) | مختصات واقعی منبع؛ NULL فقط اگر نامعتبر باشد (`SHOP_COORDS_INVALID`) — در داده‌ی واقعی ۰ مورد |
| contacts_raw | **تلفن‌های ساختگی.** هیچ مخزن/API این ستون را SELECT نمی‌کند؛ در لاگ هم چاپ نمی‌شود |
| instagram_raw / instagram_url | URL فقط وقتی https و میزبان `instagram.com` باشد |
| website_url_raw / website_url | فقط http(s) معتبر بدون credentials |
| payment_options_raw / payment_json | `payment_json` فقط وقتی حداقل یک ارائه‌دهنده اعلام شده باشد، وگرنه NULL («اعلام نشده» ≠ «پشتیبانی نمی‌شود»). کانال `unknown` حفظ می‌شود |
| supports_fast_delivery_raw / supports_fast_delivery | 1 / 0 / NULL (NULL = نامشخص، ۷۵٪) |
| weekly_hours_raw | JSON خام |
| hours_json | `DeclaredHours` نرمال‌شده: شیفت‌های جای‌خالی حذف، `24:00` برای «تا نیمه‌شب»، پنجره‌ی شب‌گذر نگه‌داشته می‌شود |
| has_schedule, placeholder_shifts, unsupported_days | مشتق از تجزیه‌ی ساعت |
| offer_count | مشتق؛ ۲٬۶۸۴ فروشگاه صفر دارند |
| name_norm, label_norm, parse_issues, source_row | نرمال/منشأ |

### `offers` (۳۳۱٬۵۰۶ ردیف)
| ستون | توضیح |
|---|---|
| offer_id PK, product_id, shop_id | کلیدهای خارجی منطقی؛ ۰ یتیم. **ایندکس:** `product_id`، `shop_id`، `(product_id, shop_id)` |
| seller_title | **عنوان خام فروشنده؛ هرگز بازنویسی نمی‌شود** |
| description | NULL برای خالی |
| price_toman_raw | متن دقیق قیمت (`null` حفظ می‌شود) |
| price_toman | عدد صحیح دقیق؛ NULL برای بدون‌قیمت / نامعتبر / خارج از بازه‌ی امن JS |
| price_out_of_range | 1 وقتی ارقام خام > 2⁵³−۱ (۱۱ ردیف، بزرگ‌ترین `733518940747298944`) — مقدار دقیق فقط در `price_toman_raw` |
| last_price_changed_at_raw / price_changed_at | ISO-8601 UTC؛ NULL برای ۷۶۹ ردیف بدون زمان (نامشخص می‌ماند) |
| warranty_raw, warranty_months/provider/description | از JSON گارانتی |
| seller_title_norm, model_keys, unit_hint | نرمال؛ `unit_hint` ∈ `per_metre`, `roll_or_pack`, `unknown` (**اشاره است نه اثبات**) |
| parse_issues, source_row | منشأ |

### `quality_flags`
`(entity_type, entity_id, code, severity, rules_version, reason (فارسی), details_json)`؛ ایندکس‌ها: `(entity_type, entity_id)` و `code`. پرچم‌ها هرگز ردیف را حذف یا پنهان نمی‌کنند. فهرست کد/شدت/دلیل در `src/domain/quality.ts` است و `isComparisonEligible(codes)` تعیین می‌کند چه چیزی وارد رتبه‌بندی عددی قیمت شود.

### `product_fts` (FTS5، بدون‌محتوا) و `shop_geo` (R-Tree)
- `product_fts(title, brand, category, model_keys, seller_titles)`؛ `rowid = products.rowid`؛ توکنایزر `unicode61 remove_diacritics 2`، پیشوند ۲/۳/۴. ستون `model_keys` شامل کلیدهای محصول ∪ حداکثر ۱۶ کلید متمایز از offerها و `seller_titles` شامل حداکثر ۸ عنوان متمایز نرمال‌شده‌ی فروشنده است.
- `shop_geo(id = shops.rowid, min_lat, max_lat, min_lon, max_lon)`.

### `import_runs`, `schema_migrations`
منشأ اجرا: نوع منبع، SHA-256 آرشیو، نسخه‌ی importer و rules، `snapshot_ref` (= بیشینه‌ی `price_changed_at`، مرجع کهنگی) و آمار.

## کاتالوگ پرچم‌ها (نسخه‌ی `qf-2026.1`)
| کد | موجودیت | شدت | مسدود‌کننده‌ی مقایسه؟ |
|---|---|---|---|
| NULL_PRICE | offer | info | ✓ |
| PRICE_MALFORMED / NONPOSITIVE_PRICE / PRICE_ABSURD_MAGNITUDE (≥۱۰¹³) | offer | error | ✓ |
| PRICE_PEER_OUTLIER_HIGH/LOW (>۲۰× یا <۱/۲۰ میانه‌ی همتایان قابل‌مقایسه، ≥۳ همتا) | offer | warn | ✓ |
| PRICE_CATEGORY_OUTLIER_HIGH/LOW (>۱۰۰۰× میانه‌ی دسته، ≥۵۰ پیشنهاد، فقط وقتی همتا نیست) | offer | warn | ✓ |
| TIMESTAMP_MISSING / MALFORMED / FUTURE / STALE (>۹۰ روز پیش از اسنپ‌شات) | offer | warn | ✗ (برچسب سن) |
| VARIANT_MODEL_MISMATCH (کد مدل بسیار شبیه ولی متفاوت: `GV3P60`/`GV3P65`) | offer | warn | ✓ |
| VARIANT_MODEL_UNCONFIRMED (کدهای بی‌ارتباط؛ تأیید نشد) | offer | info | ✗ |
| UNIT_AMBIGUOUS (واحدهای متری/حلقه‌ای مخلوط در یک محصول) | offer | warn | ✓ |
| EXACT_DUPLICATE_OFFER | offer | info | ✓ (ردیف اول مقایسه می‌شود) |
| MULTI_OFFER_SAME_SHOP_PRODUCT | offer | info | ✗ |
| HOURS_UNKNOWN / HOURS_INVALID | shop | warn | — |
| HOURS_PLACEHOLDER_IGNORED / HOURS_UNSUPPORTED_DAY / SHOP_NO_OFFERS / SHOP_SHARED_COORDINATES | shop | info | — |
| PARSE_* | همه | warn | — |

آستانه‌ها «اکتشافی مستند»اند (`THRESHOLDS`) و حد مطلق جهانی قیمت نیستند؛ مقایسه‌ی همتا فقط درون «محصول + واحد + خوشه‌ی مدل» انجام می‌شود.
