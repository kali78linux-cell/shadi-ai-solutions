/**
 * amal-clinic-seed.mjs — completes the amal-clinic public page data:
 *   7 services (fixed prices/durations) · 1 dentist provider · 7-day schedules
 *   logo + cover · 5 articles · 5 testimonials · 5 achievements · 10 gallery images.
 * Idempotent (deterministic ids + upserts). Usage: node scripts/amal-clinic-seed.mjs
 */
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';

for (const line of readFileSync(new URL('../.env.local', import.meta.url), 'utf8').split('\n')) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)\s*$/);
  if (m) process.env[m[1]] = m[2].trim();
}
const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

const SLUG = 'amal-clinic';
function uuidFromSeed(seed) {
  const h = createHash('sha256').update(seed).digest('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-8${h.slice(17, 20)}-${h.slice(20, 32)}`;
}
function check(label, ok, extra = '') { console.log(`${ok ? '✓' : '✗'} ${label}${extra ? ' — ' + extra : ''}`); if (!ok) process.exitCode = 1; }

const { data: clinic } = await sb.from('clinics').select('id, settings').eq('slug', SLUG).maybeSingle();
if (!clinic) { console.error('amal-clinic not found'); process.exit(1); }
const cid = clinic.id;
const providerId = uuidFromSeed(`${SLUG}:provider:main`);

// 1) Provider (reuses the clinic owner user_id to satisfy the FK)
const { data: owner } = await sb.from('clinic_users').select('user_id').eq('clinic_id', cid).eq('role', 'owner').is('deleted_at', null).limit(1).maybeSingle();
const up = await sb.from('providers').upsert({
  id: providerId,
  clinic_id: cid,
  user_id: owner.user_id,
  provider_type: 'dentist',
  name: 'د. أمال خليل',
  title: 'طبيب أسنان عام',
  specialty: 'طب الأسنان العام والتجميلي',
  bio: 'خبرة أكثر من 10 سنوات في طب وتجميل الأسنان.',
  public_visibility: 'indexable',
  public_slug: 'dr-amalmain1',
}, { onConflict: 'id' });
check('provider upserted', !up.error, up.error?.message);

// 2) Working hours — provider_schedules for all 7 weekdays
const hours = { 0: ['09:00', '20:00'], 1: ['09:00', '20:00'], 2: ['09:00', '20:00'], 3: ['09:00', '20:00'], 4: ['09:00', '20:00'], 5: ['14:00', '20:00'], 6: ['09:00', '20:00'] };
for (const [weekday, [start, end]] of Object.entries(hours)) {
  const r = await sb.from('provider_schedules').upsert({
    id: uuidFromSeed(`${SLUG}:schedule:${providerId}:${weekday}`),
    clinic_id: cid,
    provider_id: providerId,
    weekday: Number(weekday),
    enabled: true,
    start_time: start,
    end_time: end,
    breaks: [],
    appointment_duration_minutes: 30,
    max_appointments_per_day: 20,
  }, { onConflict: 'provider_id,weekday' });
  check(`schedule weekday=${weekday} ${start}-${end}`, !r.error, r.error?.message);
}

// 3) Services (fixed price + duration)
const SERVICES = [
  ['فحص وتشخيص شامل', 'فحص كامل للفم والأسنان مع خطة علاج.', 30, 100],
  ['تنظيف وتلميع الأسنان', 'إزالة الجير والتلميع الاحترافي.', 45, 150],
  ['حشو تجميلي', 'حشو ضوئي بلون السن الطبيعي.', 45, 250],
  ['علاج عصب', 'علاج قناة الجذر بجهاز الروتاري.', 60, 600],
  ['خلع أسنان', 'خلع بسيط أو جراحي بأقل ألم.', 30, 200],
  ['تقويم أسنان', 'تقويم معدني أو شفاف مع متابعة شهرية.', 60, 2500],
  ['زراعة أسنان', 'زراعة تعوض سن مفقود بغرسة تيتانيوم.', 90, 1200],
];
const serviceIds = [];
for (const [name, description, duration, price] of SERVICES) {
  const id = uuidFromSeed(`${SLUG}:service:${name}`);
  serviceIds.push(id);
  const r = await sb.from('clinic_services').upsert({
    id, clinic_id: cid, name, description,
    duration_minutes: duration, price,
    pricing_type: 'fixed', price_visible_to_patients: true, active: true,
  }, { onConflict: 'id' });
  check(`service «${name}»`, !r.error, r.error?.message);
  const link = await sb.from('provider_services').upsert({
    id: uuidFromSeed(`${SLUG}:assignment:${providerId}:${name}`),
    clinic_id: cid, provider_id: providerId, service_id: id,
  }, { onConflict: 'clinic_id,provider_id,service_id' });
  check('  ↳ assigned to provider', !link.error, link.error?.message);
}


// 4) Logo + cover + about/tagline (public_profile JSONB)
const pp = { ...(clinic.settings?.public_profile ?? {}) };
pp.logo_url = 'https://picsum.photos/seed/amal-clinic-logo/400/400';
pp.cover_url = 'https://picsum.photos/seed/amal-clinic-cover/1600/600';
pp.tagline = 'ابتسامة صحية تبدأ من هنا';
pp.about = 'عيادة أمل لطب الأسنان — رعاية شاملة لأسنانك بأحدث التقنيات وفريق متخصص، في بيئة مريحة وآمنة.';
pp.description = pp.description ?? 'عيادة أسنان حديثة في رام الله: فحص، تنظيف، حشو، علاج عصب، تقويم وزراعة.';
pp.show_providers = true;
const settings = { ...(clinic.settings ?? {}), public_profile: pp };
const rpp = await sb.from('clinics').update({ settings }).eq('id', cid);
check('logo + cover + about saved', !rpp.error, rpp.error?.message);

// 5) Articles (5)
const ARTICLES = [
  ['كيف تحافظ على صحة أسنانك يومياً؟', 'نصائح الوقاية', 'التنظيف مرتين يومياً بمعجون يحتوي الفلورايد، واستخدام الخيط الطبي مرة واحدة يومياً، وزيارة طبيب الأسنان كل ستة أشهر هي أساس الوقاية من التسوس وأمراض اللثة. تجنب الإفراط في السكريات والمشروبات الغازية، واستبدلها بالماء والفواكه الطازجة.'],
  ['كل ما تحتاج معرفته عن علاج العصب', 'علاجات', 'علاج العصب ليس مؤلماً كما يُشاع! مع التخدير الحديث وأجهزة الروتاري، تتم جلسة القناة الجذرية براحة تامة في 1-2 جلسة. الهدف إنقاذ السن الطبيعي بدل خلعه، والحفاظ على وظيفة المضغ والابتسامة.'],
  ['التقويم الشفاف مقابل المعدني', 'تجميل الأسنان', 'التقويم الشفاف خيار جمالي شبه غير مرئي وقابل للإزالة عند الأكل، بينما التقويم المعدني أقل تكلفة وأكثر فعالية للحالات المعقدة. في استشارتك الأولى نقيّم حالة الأسنان ونقترح الخيار الأنسب لميزانيتك وجدولك.'],
  ['زراعة الأسنان: الحل الدائم للسن المفقود', 'جراحة', 'الزراعة عبارة عن غرسة تيتانيوم تندمج مع عظم الفك لتعوض الجذر المفقود، ثم يركَّب عليها تاج طبيعي المظهر. نسبة النجاح تتجاوز 95% مع العناية الجيدة، وهي أقرب حل طبيعي للسن الأصلي.'],
  ['أعراض التهاب اللثة ومتى تزور الطبيب؟', 'صحة الفم', 'نزيف عند التنظيف، احمرار وتورم، رائحة فم مستمرة — كلها علامات مبكرة لالتهاب اللثة. التدخل المبكر بالتنظيف العميق يمنع تطور الحالة إلى تصلب اللثة وفقدان الأسنان. لا تؤجل الزيارة إذا لاحظت هذه الأعراض.'],
];
for (let i = 0; i < ARTICLES.length; i++) {
  const [title, category, content] = ARTICLES[i];
  const r = await sb.from('clinic_articles').upsert({
    id: uuidFromSeed(`${SLUG}:article:${i}`),
    clinic_id: cid, title, category, content,
    image_url: `https://picsum.photos/seed/amal-article-${i}/800/500`,
    published_at: new Date(Date.now() - i * 7 * 86400000).toISOString(),
    display_order: i, enabled: true,
  }, { onConflict: 'id' });
  check(`article «${title.slice(0, 24)}…»`, !r.error, r.error?.message);
}

// 6) Testimonials (5)
const TESTIMONIALS = [
  ['محمد عبد الله', 'علاج ممتاز من البداية للنهاية. د. أمال شرحت لي كل خطوة قبل ما تبدأ، والحشو صار ما يُلاحَد أبداً. شكراً من القلب!', 5],
  ['سارة حمدان', 'كنت خايفة جداً من علاج العصب، بس الجلسة كانت مريحة تماماً وبدون أي ألم. الفريق لطيف والعيادة نظيفة ومتقنية.', 5],
  ['أحمد ناصر', 'حجزت التقويم عندهم قبل سنة والنتيجة رائعة. متابعة شهرية منتظمة وأسعار عادلة مقارنة بالعيادات الأخرى.', 5],
  ['ليان إبراهيم', 'تنظيف الأسنان عندهم غيّر إحساسي بابتسامتي. مواعيدهم دقيقة وما في انتظار طويل.', 4],
  ['خالد موسى', 'زرعت عندهم سن بعد سنين من الفقد. العملية كانت أسهل مما توقعت والنتيجة طبيعية 100%.', 5],
];
for (let i = 0; i < TESTIMONIALS.length; i++) {
  const [patient_name, content, rating] = TESTIMONIALS[i];
  const r = await sb.from('clinic_testimonials').upsert({
    id: uuidFromSeed(`${SLUG}:testimonial:${i}`),
    clinic_id: cid, patient_name, content, rating,
    image_url: `https://picsum.photos/seed/amal-patient-${i}/200/200`,
    display_order: i, enabled: true,
  }, { onConflict: 'id' });
  check(`testimonial «${patient_name}»`, !r.error, r.error?.message);
}

// 7) Achievements (5)
const ACHIEVEMENTS = [
  ['سنوات خبرة', '12+', '🏆', '#0e7490'],
  ['ابتسامة سعيدة', '5,000+', '😁', '#059669'],
  ['تقييم المرضى', '4.9★', '⭐', '#7c3aed'],
  ['خدمة مكتملة', '25+', '🦷', '#2563eb'],
  ['علاجات ناجحة', '98%', '✅', '#16a34a'],
];
for (let i = 0; i < ACHIEVEMENTS.length; i++) {
  const [title, value, icon, background_color] = ACHIEVEMENTS[i];
  const r = await sb.from('clinic_achievements').upsert({
    id: uuidFromSeed(`${SLUG}:achievement:${i}`),
    clinic_id: cid, title, value, icon, background_color,
    font_size: 'medium', display_order: i, enabled: true,
  }, { onConflict: 'id' });
  check(`achievement «${title}»`, !r.error, r.error?.message);
}

// 8) Gallery (10 images)
for (let i = 0; i < 10; i++) {
  const r = await sb.from('clinic_public_media').upsert({
    id: uuidFromSeed(`${SLUG}:gallery:${i}`),
    clinic_id: cid,
    media_type: 'image',
    storage_path: `clinic/${cid}/public-content/seed-gallery-${i}.jpg`,
    public_url: `https://picsum.photos/seed/amal-gallery-${i}/900/600`,
    title: `صورة من العيادة ${i + 1}`,
    caption: 'لقطات من عيادتنا وأحدث أجهزتنا',
    alt_text: 'صورة من معرض عيادة أمل لطب الأسنان',
    display_order: i, enabled: true,
    mime_type: 'image/jpeg',
  }, { onConflict: 'id' });
  check(`gallery image ${i + 1}/10`, !r.error, r.error?.message);
}

console.log('\nAMAL-CLINIC SEED DONE');
