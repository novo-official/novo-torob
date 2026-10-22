import type { Metadata } from "next";
import { AgentChat } from "@/components/agent/agent-chat";
import { PageHeader } from "@/components/ui";
import { publicStatus } from "@/server/agent/config";
import { getRuntime } from "@/server/agent/runtime";

export const metadata: Metadata = { title: "دستیار خرید" };
export const dynamic = "force-dynamic";

/** The assistant is an ADDITION to the explicit pages (/discover, /sellers, /compare…): every card links to them and nothing needs chat. */
export default function AssistantPage() {
  return (
    <>
      <PageHeader eyebrow="دستیار خرید حضوری" title="از نیاز تا پرسش از فروشنده، در یک گفت‌وگو">
        دستیار فقط از ابزارهای داده‌ی رسمی ترب استفاده می‌کند، شواهد را نشان می‌دهد و هر جا مطمئن نباشد می‌گوید. پیشنهاد ثبت‌شده، موجودی نیست و هیچ پیامی به فروشنده ارسال نمی‌شود.
      </PageHeader>
      <AgentChat status={publicStatus(getRuntime().config)} />
    </>
  );
}
