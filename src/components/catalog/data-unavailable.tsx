import { DatabaseZap } from "lucide-react";
import { EmptyState } from "@/components/ui";

export function DataUnavailable() {
  return (
    <EmptyState icon={<DatabaseZap size={22} />} title="داده‌ی کاتالوگ در این محیط در دسترس نیست">
      <p>پایگاه داده هنوز ساخته نشده است. برای ساخت آن دستور <code dir="ltr">npm run db:import</code> را اجرا کنید (راهنما در README). هیچ داده‌ی جایگزینی نمایش داده نمی‌شود.</p>
    </EmptyState>
  );
}
