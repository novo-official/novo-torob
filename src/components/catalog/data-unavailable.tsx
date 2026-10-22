import { DatabaseZap } from "lucide-react";
import { ButtonLink, EmptyState } from "@/components/ui";
import { RefreshCatalog } from "./refresh-catalog";

export function DataUnavailable() {
  return (
    <EmptyState icon={<DatabaseZap size={22} />} title="داده‌ی کاتالوگ در این محیط در دسترس نیست" action={<><RefreshCatalog /><ButtonLink href="/data" variant="ghost">دربارهٔ داده‌ها</ButtonLink></>}>
      <p>فعلاً نمی‌توانیم اطلاعات کالاها را نمایش دهیم. کمی بعد دوباره بررسی کنید؛ اطلاعات جایگزین یا قیمت ساختگی نشان داده نمی‌شود.</p>
    </EmptyState>
  );
}
