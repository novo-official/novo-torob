import Link from "next/link";
import { ArrowLeft, ArrowUpLeft, Check, ChevronLeft, Compass, Headphones, MapPin, MessageSquareText, PlugZap, ShieldCheck, Sparkles, Store, Video, Zap } from "lucide-react";
import { SearchForm } from "@/components/search-form";
import { StageIcon } from "@/components/stage-icon";
import { STAGES } from "@/lib/constants";
import { toFaDigits } from "@/lib/format";
import styles from "./home.module.css";

const CATEGORIES = [
  { label: "هدفون بی‌سیم", query: "هدفون بی‌سیم", description: "برای موسیقی، ورزش و کار", Icon: Headphones },
  { label: "دوربین مداربسته", query: "دوربین مداربسته", description: "برای خانه و محل کار", Icon: Video },
  { label: "پاوربانک", query: "پاوربانک", description: "شارژ همراه، متناسب با نیاز", Icon: Zap },
  { label: "موتور برق", query: "موتور برق", description: "انتخاب بر اساس توان مصرفی", Icon: PlugZap },
];

export default function HomePage() {
  return (
    <div className={styles.home}>
      <section aria-labelledby="hero-title" className={styles.hero}>
        <div className={styles.heroContent}>
          <p className={styles.eyebrow}><span aria-hidden className={styles.dot} />همراه خرید حضوری شما در تهران</p>
          <h1 id="hero-title" className={styles.title}>انتخاب روشن‌تر،<br /><span>خرید با آمادگی بیشتر.</span></h1>
          <p className={styles.intro}>کالای مناسب را پیدا کنید، فروشنده‌ها را بسنجید و با سؤال‌های درست راهی بازار شوید.</p>
          <div className={styles.searchArea}>
            <label id="home-search-label" htmlFor="home-q" className={styles.searchLabel}>دنبال چه کالایی می‌گردید؟</label>
            <SearchForm id="home-q" labelId="home-search-label" featured />
            <div className={styles.examples}>
              <span>مثلاً</span>
              {["هدفون بی‌سیم", "دوربین مداربسته", "پاوربانک"].map((q) => <Link key={q} href={`/search?q=${encodeURIComponent(q)}`}>{q}<ArrowUpLeft aria-hidden size={12} /></Link>)}
            </div>
          </div>
          <div className={styles.heroLinks}>
            <Link href="/discover" className={styles.guideLink}><Compass aria-hidden size={18} />کمکم کن انتخاب کنم<ArrowLeft aria-hidden size={16} /></Link>
            <Link href="/search" className={styles.knownModel}>مدل محصول رو می‌دونم<ChevronLeft aria-hidden size={15} /></Link>
          </div>
        </div>
        <aside aria-labelledby="journey-preview-title" className={styles.journey}>
          <div className={styles.journeyHeading}><span className={styles.journeyIcon}><MapPin aria-hidden size={21} /></span><div><p className={styles.journeyEyebrow}>قبل از رفتن به بازار</p><h2 id="journey-preview-title">مسیر خریدتان را روشن کنید</h2></div></div>
          <ol className={styles.journeySteps}>
            <li><span className={styles.stepIcon}><Compass aria-hidden size={19} /></span><div><strong>محصول مناسب شما</strong><p>از مدل مشخص یا نیازتان شروع کنید</p></div><span className={styles.stepNumber}>۰۱</span></li>
            <li><span className={styles.stepIcon}><Store aria-hidden size={19} /></span><div><strong>فروشنده‌های نزدیک</strong><p>پیشنهادهای ثبت‌شده را بررسی کنید</p></div><span className={styles.stepNumber}>۰۲</span></li>
            <li><span className={styles.stepIcon}><MessageSquareText aria-hidden size={19} /></span><div><strong>پرسش، پیش از مراجعه</strong><p>متن را آماده کنید و خودتان بپرسید</p></div><span className={styles.stepNumber}>۰۳</span></li>
          </ol>
          <div className={styles.journeyNote}><ShieldCheck aria-hidden size={17} /><p>پیشنهاد ثبت‌شده به معنی موجودی نیست؛<br />قیمت و موجودی امروز را پیش از مراجعه بپرسید.</p></div>
        </aside>
      </section>

      <section aria-label="شروع با گفت‌وگو" className={styles.chatBanner}>
        <span className={styles.optionIcon}><Sparkles aria-hidden size={23} /></span>
        <div><h2>یک نیاز دارید، چند انتخاب پیش رو؟</h2><p>از دستیار بپرسید؛ هر مرحله را هم می‌توانید خودتان ادامه دهید.</p></div>
        <Link href="/assistant" data-testid="home-assistant-link">با دستیار خرید حرف بزنید<ArrowUpLeft aria-hidden size={17} /></Link>
      </section>

      <section aria-labelledby="categories-title">
        <div className={styles.sectionHeading}><div><p className={styles.sectionEyebrow}>از نیازتان شروع کنید</p><h2 id="categories-title">برای چه چیزی برنامه دارید؟</h2></div><Link href="/discover" className={styles.allLink}>راهنمای انتخاب<ChevronLeft aria-hidden size={16} /></Link></div>
        <ul className={styles.categories}>
          {CATEGORIES.map(({ label, query, description, Icon }) => <li key={query}><Link href={`/discover?text=${encodeURIComponent(query)}`} className={styles.category}><span className={styles.categoryTop}><span className={styles.categoryIcon}><Icon aria-hidden size={29} strokeWidth={1.5} /></span><ArrowUpLeft aria-hidden size={18} className={styles.categoryArrow} /></span><h3>{label}</h3><p>{description}</p></Link></li>)}
        </ul>
      </section>

      <section aria-labelledby="stages-title" className={styles.stagesSection}>
        <div className={styles.sectionHeading}><div><p className={styles.sectionEyebrow}>از انتخاب تا مراجعه</p><h2 id="stages-title">هر قدم، یک تصمیم روشن‌تر</h2></div><span className={styles.stageCount}>چهار گام همراه شما</span></div>
        <ol className={styles.stages}>
          {STAGES.map((stage, i) => <li key={stage.id}><Link href={stage.href} className={styles.stage}><div className={styles.stageTop}><span className={styles.stageIcon}><StageIcon name={stage.icon} /></span><span className={styles.stageIndex}>{toFaDigits(i + 1).padStart(2, "۰")}</span></div><h3>{stage.title}</h3><p>{stage.desc}</p><span className={styles.stageAction}>مشاهدهٔ این گام<ArrowLeft aria-hidden size={15} /></span></Link></li>)}
        </ol>
      </section>

      <section aria-labelledby="trust-title" className={styles.trust}>
        <div><span className={styles.trustEyebrow}><ShieldCheck aria-hidden size={19} />شفافیت، در تمام مسیر</span><h2 id="trust-title">با اطلاعات روشن تصمیم بگیرید.</h2><p>قیمت، ساعت و پیشنهادها از داده‌های ثبت‌شده‌اند. محدودیت‌ها را کنار اطلاعات می‌بینید تا بدانید چه چیزی را باید دوباره بپرسید.</p><Link href="/data">دربارهٔ داده‌ها و محدودیت‌ها<ArrowLeft aria-hidden size={16} /></Link></div>
        <ul className={styles.trustChecks}>
          <li><Check aria-hidden size={17} /><span>موجودی و قیمت امروز، نیازمند پرسش شماست.</span></li>
          <li><Check aria-hidden size={17} /><span>پیامی از برنامه به فروشنده ارسال نمی‌شود.</span></li>
          <li><Check aria-hidden size={17} /><span>انتخاب محله کافی است؛ موقعیت‌یابی اختیاری است.</span></li>
        </ul>
      </section>
    </div>
  );
}
