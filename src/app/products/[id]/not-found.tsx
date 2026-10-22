import { PackageSearch } from "lucide-react";
import { ButtonLink, EmptyState } from "@/components/ui";

export default function ProductNotFound() {
  return (
    <EmptyState icon={<PackageSearch size={22} />} title="این محصول در کاتالوگ پیدا نشد" action={<><ButtonLink href="/search">جست‌وجوی مدل</ButtonLink><ButtonLink href="/discover" variant="secondary">کمکم کن انتخاب کنم</ButtonLink></>}>
      <p>شناسه‌ی محصول معتبر نیست یا در داده‌ی انتخابی وجود ندارد.</p>
    </EmptyState>
  );
}
