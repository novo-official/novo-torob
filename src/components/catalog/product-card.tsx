import Link from "next/link";
import type { ReactNode } from "react";
import { ArrowLeft, Info, Store, TriangleAlert } from "lucide-react";
import type { ProductCard as Card } from "@/domain/advisor";
import { Ltr } from "@/components/ui";
import { toFaDigits } from "@/lib/format";
import { CompareToggle } from "./compare-store";
import { PriceLine } from "./price-line";
import { ProductImage } from "./product-image";
import styles from "./product-card.module.css";

export const REDACTED_TITLE = "عنوان حذف‌شده برای انتشار";

/** Shared catalog card. Price/identity warnings stay visible; evidence counts expand on demand. */
export function ProductCardView({ card, href, badge, children, matchNote, headingLevel = 3 }: {
  card: Card; href: string; badge?: ReactNode; children?: ReactNode; matchNote?: string; headingLevel?: 2 | 3;
}) {
  const redacted = card.title === REDACTED_TITLE || !card.title;
  const title = redacted ? "عنوان این محصول در داده حذف شده است" : card.title;
  const shownBrand = card.brandName && !title.includes(card.brandName) ? card.brandName : null;
  const shownModel = card.model && !title.toLowerCase().includes(card.model.toLowerCase()) ? card.model : null;
  const v = card.variants;
  const Heading = headingLevel === 2 ? "h2" : "h3";
  const hasDetails = v.modelMismatch > 0 || v.unitAmbiguous > 0 || v.modelUnconfirmed > 0;
  return (
    <article className={styles.card} data-testid="product-card">
      <div className={styles.body}>
        <Link href={href} tabIndex={-1} aria-hidden className={styles.imageLink}>
          <ProductImage src={card.imageUrl} className={styles.image} />
        </Link>
        <div className={styles.description}>
          <p className={styles.category}>{card.categoryName}</p>
          {badge || matchNote ? <div className={styles.badges}>{badge}{matchNote ? <span className={styles.match}>{matchNote}</span> : null}</div> : null}
          <Heading className={styles.title}><Link href={href}><bdi>{title}</bdi></Link></Heading>
          {shownBrand || shownModel ? <p className={styles.metadata}>
            {shownBrand ? <span>{shownBrand}</span> : null}
            {shownBrand && shownModel ? <span aria-hidden>·</span> : null}
            {shownModel ? <Ltr>{shownModel}</Ltr> : null}
          </p> : null}
          <p className={styles.sellers}><Store aria-hidden size={14} />{card.distinctSellers > 0 ? `${toFaDigits(card.distinctSellers)} فروشنده` : "پیشنهادی ثبت نشده"}<span>موجودی تأییدنشده</span></p>
          {hasDetails ? <div className={styles.warnings}>
            {v.modelMismatch > 0 ? <p><TriangleAlert aria-hidden size={14} />برخی نسخه‌ها متفاوت‌اند</p> : v.modelUnconfirmed > 0 ? <p><Info aria-hidden size={14} />مدل برخی پیشنهادها تأیید نشده</p> : null}
            {v.unitAmbiguous > 0 ? <p><TriangleAlert aria-hidden size={14} />واحد برخی قیمت‌ها نامشخص</p> : null}
          </div> : null}
        </div>
        <div className={styles.purchase}>
          <div className={styles.price}><p className={styles.priceLabel}>قیمت ثبت‌شده</p><PriceLine price={card.price} /></div>
          <div className={styles.actions}>
            <Link href={href} className={styles.detailLink}>مشاهده‌ی جزئیات<ArrowLeft aria-hidden size={16} /></Link>
            <CompareToggle id={card.id} title={redacted ? card.categoryName : card.title} />
          </div>
        </div>
      </div>
      {hasDetails ? <details className={styles.evidence}>
        <summary>جزئیات پیشنهادها و ابهام‌ها</summary>
        <ul>
          {v.modelMismatch > 0 ? <li>{toFaDigits(v.modelMismatch)} پیشنهاد با کد مدل شبیه ولی متفاوت؛ نسخهٔ دقیق را پیش از مقایسه بررسی کنید.</li> : null}
          {v.unitAmbiguous > 0 ? <li>{toFaDigits(v.unitAmbiguous)} پیشنهاد با واحد قیمت نامشخص؛ قیمت عدد، متر یا بسته لزوماً قابل مقایسه نیست.</li> : null}
          {v.modelUnconfirmed > 0 ? <li>مدل {toFaDigits(v.modelUnconfirmed)} پیشنهاد تأیید نشده است.</li> : null}
        </ul>
      </details> : null}
      {children ? <div className={styles.extras}>{children}</div> : null}
    </article>
  );
}
