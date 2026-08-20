import fs from 'fs';
import { createHash } from 'crypto';
import { createClient } from '@supabase/supabase-js';

// ---------------------------------------------------------------------------
// 1. Config loader (reads .env.local, same convention as scripts/apply-migrations.mjs)
// ---------------------------------------------------------------------------
const envRaw = fs.readFileSync('.env.local', 'utf8');
const getEnv = (key) => {
  const line = envRaw.split('\n').find((l) => l.startsWith(`${key}=`));
  return line ? line.split('=').slice(1).join('=').trim() : '';
};

const supabaseUrl = getEnv('NEXT_PUBLIC_SUPABASE_URL');
const supabaseServiceKey = getEnv('SUPABASE_SERVICE_ROLE_KEY');

if (!supabaseUrl || supabaseUrl.includes('your-') || supabaseUrl.includes('placeholder')) {
  console.log('DEMO SEED: BLOCKED — real NEXT_PUBLIC_SUPABASE_URL missing');
  process.exit(1);
}
if (!supabaseServiceKey || supabaseServiceKey.includes('your-') || supabaseServiceKey.includes('placeholder')) {
  console.log('DEMO SEED: BLOCKED — SUPABASE_SERVICE_ROLE_KEY missing');
  process.exit(1);
}

console.log(`Project ref: ${supabaseUrl.replace('https://', '').split('.')[0]}`);

// ---------------------------------------------------------------------------
// 2. Service-role client (bypasses RLS), same as lib/supabase/admin.ts
// ---------------------------------------------------------------------------
const sb = createClient(supabaseUrl, supabaseServiceKey, {
  auth: { persistSession: false },
});

// ---------------------------------------------------------------------------
// 3. Deterministic demo identifiers (same stable rows across re-seeds)
// ---------------------------------------------------------------------------
function sha256Hex(value) {
  return createHash('sha256').update(value).digest('hex');
}

function demoUuid(seedKey) {
  const hex = sha256Hex(`demo-seed:${seedKey}`).slice(0, 32);
  return `${hex.slice(0,8)}-${hex.slice(8,12)}-${hex.slice(12,16)}-${hex.slice(16,20)}-${hex.slice(20,32)}`;
}

// ---------------------------------------------------------------------------
// 4. Four demo clinics configuration
// ---------------------------------------------------------------------------
const CLINICS = [
  {
    key: 'demo-dental-clinic',
    name: 'Demo Dental Clinic',
    slug: 'demo-dental-clinic',
    phone: '+970-123-456-789',
    email: 'demo@dentalclinic.example.com',
    address: 'Demo Street 12, Amman, Jordan (DEMO)',
    website: 'https://demo.example.com',
    timezone: 'Asia/Jerusalem',
    defaultDuration: 30,
    providers: [
      { key: 'demo-dr-ahmad-hassan', name: 'Dr. Ahmad Hassan', title: 'Dentist (Demo)', type: 'dentist', email: 'demo.dentist.dr.ahmad@example.com', phone: '+970-555-0001', start: '09:00', end: '17:00', breakStart: '13:00', breakEnd: '14:00', maxPerDay: 12 },
      { key: 'demo-dr-sara-khalil', name: 'Dr. Sara Khalil', title: 'Hygienist (Demo)', type: 'hygienist', email: 'demo.dentist.dr.sara@example.com', phone: '+970-555-0002', start: '10:00', end: '18:00', breakStart: '14:00', breakEnd: '15:00', maxPerDay: 10 },
    ],
    services: [
      { key: 'demo-dental-exam', name: 'Dental Exam', description: 'Comprehensive dental examination of teeth, gums and soft tissue. (Demo)', duration: 30, price: 50 },
      { key: 'demo-teeth-cleaning', name: 'Teeth Cleaning', description: 'Professional teeth cleaning / polishing. (Demo)', duration: 30, price: 70 },
      { key: 'demo-dental-x-ray', name: 'Dental X-Ray', description: 'Intraoral / panoramic X-ray for diagnosis. (Demo)', duration: 20, price: 40 },
      { key: 'demo-root-canal-consultation', name: 'Root Canal Consultation', description: 'Virtual root canal case consultation. (Demo)', duration: 45, price: 120 },
      { key: 'demo-tooth-extraction', name: 'Tooth Extraction', description: 'Simple tooth extraction. (Demo)', duration: 45, price: 90 },
    ],
    assignments: [
      ['demo-dr-ahmad-hassan', 'demo-dental-exam'],
      ['demo-dr-ahmad-hassan', 'demo-dental-x-ray'],
      ['demo-dr-ahmad-hassan', 'demo-root-canal-consultation'],
      ['demo-dr-sara-khalil', 'demo-dental-exam'],
      ['demo-dr-sara-khalil', 'demo-teeth-cleaning'],
      ['demo-dr-sara-khalil', 'demo-tooth-extraction'],
    ],
    patients: [
      { key: 'demo-patient-mohammad-ali', name: 'Mohammad Ali (DEMO)', email: 'demo.mohammad.ali@example.com', phone: '+970-555-0101', notes: 'Demo' },
      { key: 'demo-patient-omar-khaled', name: 'Omar Khaled (DEMO)', email: 'demo.omar.khaled@example.com', phone: '+972-555-0202', dob: '1988-05-10', notes: 'Demo' },
      { key: 'demo-patient-lina-ahmad', name: 'Lina Ahmad (DEMO)', email: 'demo.lina.ahmad@example.com', phone: '+962-555-0303', dob: '1995-09-22', notes: 'Demo' },
    ],
    appointments: [
      { seed: 'tentative-upcoming', patient: 'demo-patient-mohammad-ali', dateOffset: 3, time: '10:00', provider: 'demo-dr-sara-khalil', service: 'demo-teeth-cleaning', status: 'tentative' },
      { seed: 'confirmed-upcoming', patient: 'demo-patient-omar-khaled', dateOffset: 4, time: '11:30', provider: 'demo-dr-ahmad-hassan', service: 'demo-dental-exam', status: 'confirmed' },
      { seed: 'cancelled-future', patient: 'demo-patient-lina-ahmad', dateOffset: 5, time: '14:00', provider: 'demo-dr-sara-khalil', service: 'demo-tooth-extraction', status: 'cancelled' },
      { seed: 'confirmed-past', patient: 'demo-patient-mohammad-ali', dateOffset: -5, time: '12:00', provider: 'demo-dr-ahmad-hassan', service: 'demo-dental-x-ray', status: 'confirmed' },
      { seed: 'tentative-past', patient: 'demo-patient-omar-khaled', dateOffset: -10, time: '15:00', provider: 'demo-dr-sara-khalil', service: 'demo-root-canal-consultation', status: 'tentative' },
    ],
    conversations: [
      {
        key: 'conv:booking',
        session: 'demo-session-booking',
        patient: 'demo-patient-mohammad-ali',
        messages: [
          { role: 'patient', content: 'مرحبا، بدي أحجز موعد لتنظيف الأسنان.' },
          { role: 'assistant', content: 'بالتأكيد. لدينا مواعيد متاحة في عيادتنا. هل تفضل صباحاً أم مساءً؟' },
          { role: 'patient', content: 'صباح الخير.' },
          { role: 'assistant', content: 'تم الحجز كموعد مؤقت لك. يرجى تأكيد الحجز.' },
          { role: 'patient', content: 'ممكن.' },
          { role: 'assistant', content: 'تم تأكيد موعدك بنجاح!' },
        ],
      },
      {
        key: 'conv:pricing',
        session: 'demo-session-pricing',
        patient: 'demo-patient-omar-khaled',
        messages: [
          { role: 'patient', content: 'كم سعر تنظيف الأسنان؟' },
          { role: 'assistant', content: 'تنظيف الأسنان تكلفة 70₪ في عيادتنا التجريبية.' },
        ],
      },
      {
        key: 'conv:cancel',
        session: 'demo-session-cancel',
        patient: 'demo-patient-lina-ahmad',
        messages: [
          { role: 'patient', content: 'بدي ألغي موعدي.' },
          { role: 'assistant', content: 'بالطبع. لتأكيد الإلغاء أرسلنا لك رابط آمناً.' },
        ],
      },
    ],
    knowledge: [
      { key: 'clinic-intro', title: 'تعريف العيادة', content: 'عيادة ديمو لطب الأسنان هي عيادة تجريبية لأغراض العرض. نقدم خدمات فحص الأسنان وتنظيفها وإشعة وصوراً واستشارات.' },
      { key: 'opening-hours', title: 'ساعات العمل', content: 'ساعات عمل العيادة التجريبية: الأحد–الخميس من 9:00 صباحاً حتى 5:00 مساءً. الجمعة والسبت مغلقون.' },
      { key: 'services-pricing', title: 'خدماتنا وأسعارها', content: 'خدماتنا: فحص أسنان (50₪)، تنظيف أسنان (70₪)، أشعة أسنان (40₪)، استشارة عصب الجذر (120₪)، خلع ضرس (90₪).' },
      { key: 'appointment-policy', title: 'سياسة المواعيد', content: 'بإمكان المريض حجز موعد مباشرة، ويبقى مؤقتاً لحين التأكيد. للتأكيد يرجى الضغط على رابط التأكيد الوارد في الرسالة.' },
      { key: 'cancellation-policy', title: 'سياسة الإلغاء', content: 'يمكنك إلغاء موعدك في أي وقت باستخدام الرابط المرسل إليك. المواعيد المؤكدة التي لم تُلغَ قبل 24 ساعة تخضع لسياسة عيادتنا.' },
      { key: 'patient-instructions', title: 'إرشادات المريض', content: 'يرجى الحضور قبل 10 دقائق من موعدك. أحضر بطاقة الهوية السريرية. لأي استفسار اتصل على +970-123-456-789.' },
    ],
    aiSettings: {
      assistant_name: 'ديمة',
      tone: 'friendly',
      language: 'ar',
      greeting: 'أهلاً بك في عيادة ديمة لطب الأسنان. كيف يمكنني مساعدتك؟',
      confidence_threshold: 0.25,
    },
  },
  {
    key: 'smile-care-dental-center',
    name: 'Smile Care Dental Center',
    slug: 'smile-care-dental-center',
    phone: '+970-234-567-890',
    email: 'hello@smilecare.example.com',
    address: 'Smile Street 45, Ramallah, Palestine (DEMO)',
    website: 'https://smilecare.example.com',
    timezone: 'Asia/Jerusalem',
    defaultDuration: 30,
    providers: [
      { key: 'smile-dr-khaled-nasser', name: 'Dr. Khaled Nasser', title: 'Dentist (Demo)', type: 'dentist', email: 'demo.smile.dr.khaled@example.com', phone: '+970-555-0101', start: '08:30', end: '16:30', breakStart: '12:30', breakEnd: '13:30', maxPerDay: 14 },
      { key: 'smile-dr-maya-othman', name: 'Dr. Maya Othman', title: 'Orthodontist (Demo)', type: 'dentist', email: 'demo.smile.dr.maya@example.com', phone: '+970-555-0102', start: '11:00', end: '19:00', breakStart: '15:00', breakEnd: '16:00', maxPerDay: 10 },
    ],
    services: [
      { key: 'smile-dental-exam', name: 'Dental Examination', description: 'Full dental check-up with oral cancer screening. (Demo)', duration: 30, price: 60 },
      { key: 'smile-teeth-cleaning', name: 'Teeth Cleaning', description: 'Ultrasonic scaling and polishing. (Demo)', duration: 30, price: 80 },
      { key: 'smile-dental-x-ray', name: 'Dental X-Ray', description: 'Digital intraoral X-ray. (Demo)', duration: 15, price: 35 },
      { key: 'smile-root-canal', name: 'Root Canal Treatment', description: 'Endodontic treatment for infected teeth. (Demo)', duration: 60, price: 150 },
      { key: 'smile-tooth-extraction', name: 'Tooth Extraction', description: 'Simple and surgical extractions. (Demo)', duration: 45, price: 100 },
    ],
    assignments: [
      ['smile-dr-khaled-nasser', 'smile-dental-exam'],
      ['smile-dr-khaled-nasser', 'smile-dental-x-ray'],
      ['smile-dr-khaled-nasser', 'smile-root-canal'],
      ['smile-dr-maya-othman', 'smile-dental-exam'],
      ['smile-dr-maya-othman', 'smile-teeth-cleaning'],
      ['smile-dr-maya-othman', 'smile-tooth-extraction'],
    ],
    patients: [
      { key: 'smile-patient-layan-khaled', name: 'Layan Khaled (DEMO)', email: 'demo.layan.khaled@example.com', phone: '+970-555-0201', notes: 'Demo' },
      { key: 'smile-patient-yousef-ali', name: 'Yousef Ali (DEMO)', email: 'demo.yousef.ali@example.com', phone: '+970-555-0202', dob: '1992-03-15', notes: 'Demo' },
      { key: 'smile-patient-huda-sami', name: 'Huda Sami (DEMO)', email: 'demo.huda.sami@example.com', phone: '+970-555-0203', dob: '1998-11-02', notes: 'Demo' },
    ],
    appointments: [
      { seed: 'smile-tentative-upcoming', patient: 'smile-patient-layan-khaled', dateOffset: 2, time: '09:30', provider: 'smile-dr-maya-othman', service: 'smile-teeth-cleaning', status: 'tentative' },
      { seed: 'smile-confirmed-upcoming', patient: 'smile-patient-yousef-ali', dateOffset: 3, time: '10:30', provider: 'smile-dr-khaled-nasser', service: 'smile-dental-exam', status: 'confirmed' },
      { seed: 'smile-cancelled-future', patient: 'smile-patient-huda-sami', dateOffset: 6, time: '13:00', provider: 'smile-dr-maya-othman', service: 'smile-tooth-extraction', status: 'cancelled' },
      { seed: 'smile-confirmed-past', patient: 'smile-patient-layan-khaled', dateOffset: -3, time: '11:00', provider: 'smile-dr-khaled-nasser', service: 'smile-dental-x-ray', status: 'confirmed' },
    ],
    conversations: [
      {
        key: 'smile:conv:hours',
        session: 'smile-demo-session-hours',
        patient: 'smile-patient-layan-khaled',
        messages: [
          { role: 'patient', content: 'مرحبا، بدي أعرف ساعات عمل العيادة' },
          { role: 'assistant', content: 'ساعات عمل عيادة Smile Care: الأحد–الخميس من 8:30 صباحاً حتى 4:30 مساءً.' },
          { role: 'patient', content: 'بدي أحجز موعد فحص' },
          { role: 'assistant', content: 'بالتأكيد. لدينا مواعيد متاحة لفحص الأسنان. هل تفضل صباحاً أم مساءً؟' },
        ],
      },
      {
        key: 'smile:conv:pricing',
        session: 'smile-demo-session-pricing',
        patient: 'smile-patient-yousef-ali',
        messages: [
          { role: 'patient', content: 'كم سعر تنظيف الأسنان؟' },
          { role: 'assistant', content: 'تنظيف الأسنان في Smile Care يكلف 80₪.' },
        ],
      },
    ],
    knowledge: [
      { key: 'smile-clinic-intro', title: 'تعريف العيادة', content: 'مركز Smile Care لطب الأسنان هو عيادة تجريبية متخصصة في طب الأسنان التجميلي وتقويم الأسنان.' },
      { key: 'smile-opening-hours', title: 'ساعات العمل', content: 'ساعات عمل Smile Care: الأحد–الخميس من 8:30 صباحاً حتى 4:30 مساءً. الجمعة والسبت مغلقون.' },
      { key: 'smile-services-pricing', title: 'خدماتنا وأسعارها', content: 'خدماتنا: فحص أسنان (60₪)، تنظيف أسنان (80₪)، أشعة أسنان (35₪)، علاج عصب (150₪)، خلع ضرس (100₪).' },
      { key: 'smile-appointment-policy', title: 'سياسة المواعيد', content: 'يمكن حجز المواعيد مباشرة. تبقى المواعيد مؤقتة حتى التأكيد عبر الرابط المرسل.' },
      { key: 'smile-cancellation-policy', title: 'سياسة الإلغاء', content: 'يمكن إلغاء المواعيد عبر الرابط المرسل. الإلغاء قبل 24 ساعة من الموعد.' },
    ],
    aiSettings: {
      assistant_name: 'سمايل',
      tone: 'professional',
      language: 'ar',
      greeting: 'أهلاً بك في Smile Care Dental Center. كيف يمكنني مساعدتك؟',
      confidence_threshold: 0.3,
    },
  },
  {
    key: 'bright-teeth-clinic',
    name: 'Bright Teeth Clinic',
    slug: 'bright-teeth-clinic',
    phone: '+972-345-678-901',
    email: 'info@brightteeth.example.com',
    address: 'Bright Avenue 78, Tel Aviv, Israel (DEMO)',
    website: 'https://brightteeth.example.com',
    timezone: 'Asia/Jerusalem',
    defaultDuration: 30,
    providers: [
      { key: 'bright-dr-dan-cohen', name: 'Dr. Dan Cohen', title: 'Dentist (Demo)', type: 'dentist', email: 'demo.bright.dr.dan@example.com', phone: '+972-555-0301', start: '09:00', end: '17:00', breakStart: '13:00', breakEnd: '14:00', maxPerDay: 12 },
      { key: 'bright-dr-rachel-levi', name: 'Dr. Rachel Levi', title: 'Hygienist (Demo)', type: 'hygienist', email: 'demo.bright.dr.rachel@example.com', phone: '+972-555-0302', start: '10:00', end: '18:00', breakStart: '14:00', breakEnd: '15:00', maxPerDay: 10 },
    ],
    services: [
      { key: 'bright-dental-exam', name: 'Dental Examination', description: 'Comprehensive dental check-up. (Demo)', duration: 30, price: 55 },
      { key: 'bright-teeth-cleaning', name: 'Teeth Cleaning', description: 'Professional cleaning and polishing. (Demo)', duration: 30, price: 65 },
      { key: 'bright-dental-x-ray', name: 'Dental X-Ray', description: 'Digital X-ray imaging. (Demo)', duration: 20, price: 45 },
      { key: 'bright-root-canal', name: 'Root Canal Consultation', description: 'Endodontic consultation. (Demo)', duration: 45, price: 130 },
      { key: 'bright-tooth-extraction', name: 'Tooth Extraction', description: 'Simple extraction. (Demo)', duration: 45, price: 95 },
    ],
    assignments: [
      ['bright-dr-dan-cohen', 'bright-dental-exam'],
      ['bright-dr-dan-cohen', 'bright-dental-x-ray'],
      ['bright-dr-dan-cohen', 'bright-root-canal'],
      ['bright-dr-rachel-levi', 'bright-dental-exam'],
      ['bright-dr-rachel-levi', 'bright-teeth-cleaning'],
      ['bright-dr-rachel-levi', 'bright-tooth-extraction'],
    ],
    patients: [
      { key: 'bright-patient-john-miller', name: 'John Miller (DEMO)', email: 'demo.john.miller@example.com', phone: '+972-555-0401', notes: 'Demo' },
      { key: 'bright-patient-sarah-green', name: 'Sarah Green (DEMO)', email: 'demo.sarah.green@example.com', phone: '+972-555-0402', dob: '1990-07-20', notes: 'Demo' },
      { key: 'bright-patient-david-smith', name: 'David Smith (DEMO)', email: 'demo.david.smith@example.com', phone: '+972-555-0403', dob: '1985-01-12', notes: 'Demo' },
    ],
    appointments: [
      { seed: 'bright-tentative-upcoming', patient: 'bright-patient-john-miller', dateOffset: 3, time: '10:00', provider: 'bright-dr-rachel-levi', service: 'bright-teeth-cleaning', status: 'tentative' },
      { seed: 'bright-confirmed-upcoming', patient: 'bright-patient-sarah-green', dateOffset: 4, time: '11:30', provider: 'bright-dr-dan-cohen', service: 'bright-dental-exam', status: 'confirmed' },
      { seed: 'bright-cancelled-future', patient: 'bright-patient-david-smith', dateOffset: 5, time: '14:00', provider: 'bright-dr-rachel-levi', service: 'bright-tooth-extraction', status: 'cancelled' },
      { seed: 'bright-confirmed-past', patient: 'bright-patient-john-miller', dateOffset: -4, time: '12:00', provider: 'bright-dr-dan-cohen', service: 'bright-dental-x-ray', status: 'confirmed' },
    ],
    conversations: [
      {
        key: 'bright:conv:hello',
        session: 'bright-demo-session-hello',
        patient: 'bright-patient-john-miller',
        messages: [
          { role: 'patient', content: 'Hello' },
          { role: 'assistant', content: 'Hello! Welcome to Bright Teeth Clinic. How can I help you today?' },
          { role: 'patient', content: 'How much is teeth cleaning?' },
          { role: 'assistant', content: 'Teeth cleaning at Bright Teeth Clinic costs 65₪.' },
          { role: 'patient', content: 'I want to book an appointment.' },
          { role: 'assistant', content: 'Of course. We have available slots. Would you prefer morning or afternoon?' },
        ],
      },
      {
        key: 'bright:conv:pricing',
        session: 'bright-demo-session-pricing',
        patient: 'bright-patient-sarah-green',
        messages: [
          { role: 'patient', content: 'How much is teeth cleaning?' },
          { role: 'assistant', content: 'Teeth cleaning at Bright Teeth Clinic costs 65₪.' },
        ],
      },
    ],
    knowledge: [
      { key: 'bright-clinic-intro', title: 'Clinic Introduction', content: 'Bright Teeth Clinic is a demo dental clinic offering comprehensive dental care in a modern setting.' },
      { key: 'bright-opening-hours', title: 'Opening Hours', content: 'Bright Teeth Clinic opening hours: Sunday–Thursday from 9:00 AM to 5:00 PM. Friday and Saturday closed.' },
      { key: 'bright-services-pricing', title: 'Services and Pricing', content: 'Our services: Dental Examination (55₪), Teeth Cleaning (65₪), Dental X-Ray (45₪), Root Canal Consultation (130₪), Tooth Extraction (95₪).' },
      { key: 'bright-appointment-policy', title: 'Appointment Policy', content: 'Patients can book directly. Appointments remain tentative until confirmed via the secure link.' },
      { key: 'bright-cancellation-policy', title: 'Cancellation Policy', content: 'You can cancel your appointment anytime using the link sent to you. Confirmed appointments not cancelled 24 hours in advance are subject to our policy.' },
    ],
    aiSettings: {
      assistant_name: 'Bright Assistant',
      tone: 'warm',
      language: 'en',
      greeting: 'Hello! Welcome to Bright Teeth Clinic. How can I help you today?',
      confidence_threshold: 0.25,
    },
  },
  {
    key: 'noura-dental-imaging',
    name: 'Noura Dental & Imaging Center',
    slug: 'noura-dental-imaging',
    phone: '+962-456-789-012',
    email: 'care@nouradental.example.com',
    address: 'Noura Street 3, Amman, Jordan (DEMO)',
    website: 'https://nouradental.example.com',
    timezone: 'Asia/Amman',
    defaultDuration: 30,
    providers: [
      { key: 'noura-dr-omar-haddad', name: 'Dr. Omar Haddad', title: 'Dentist (Demo)', type: 'dentist', email: 'demo.noura.dr.omar@example.com', phone: '+962-555-0501', start: '09:00', end: '17:00', breakStart: '13:00', breakEnd: '14:00', maxPerDay: 12 },
      { key: 'noura-dr-noor-issa', name: 'Dr. Noor Issa', title: 'Radiologist (Demo)', type: 'staff', email: 'demo.noura.dr.noor@example.com', phone: '+962-555-0502', start: '10:00', end: '18:00', breakStart: '14:00', breakEnd: '15:00', maxPerDay: 10 },
    ],
    services: [
      { key: 'noura-dental-exam', name: 'Dental Examination', description: 'Comprehensive dental examination. (Demo)', duration: 30, price: 45 },
      { key: 'noura-teeth-cleaning', name: 'Teeth Cleaning', description: 'Professional cleaning. (Demo)', duration: 30, price: 75 },
      { key: 'noura-dental-x-ray', name: 'Dental X-Ray', description: 'Digital X-ray imaging. (Demo)', duration: 20, price: 45 },
      { key: 'noura-panoramic-xray', name: 'Panoramic X-Ray', description: 'Full-mouth panoramic imaging. (Demo)', duration: 25, price: 85 },
      { key: 'noura-root-canal', name: 'Root Canal Consultation', description: 'Endodontic consultation. (Demo)', duration: 45, price: 110 },
      { key: 'noura-tooth-extraction', name: 'Tooth Extraction', description: 'Simple extraction. (Demo)', duration: 45, price: 85 },
    ],
    assignments: [
      ['noura-dr-omar-haddad', 'noura-dental-exam'],
      ['noura-dr-omar-haddad', 'noura-dental-x-ray'],
      ['noura-dr-omar-haddad', 'noura-root-canal'],
      ['noura-dr-omar-haddad', 'noura-tooth-extraction'],
      ['noura-dr-noor-issa', 'noura-dental-exam'],
      ['noura-dr-noor-issa', 'noura-teeth-cleaning'],
      ['noura-dr-noor-issa', 'noura-panoramic-xray'],
    ],
    patients: [
      { key: 'noura-patient-amal-hussein', name: 'Amal Hussein (DEMO)', email: 'demo.amal.hussein@example.com', phone: '+962-555-0601', notes: 'Demo' },
      { key: 'noura-patient-karim-farhan', name: 'Karim Farhan (DEMO)', email: 'demo.karim.farhan@example.com', phone: '+962-555-0602', dob: '1987-09-05', notes: 'Demo' },
      { key: 'noura-patient-rasha-nabil', name: 'Rasha Nabil (DEMO)', email: 'demo.rasha.nabil@example.com', phone: '+962-555-0603', dob: '1993-04-18', notes: 'Demo' },
    ],
    appointments: [
      { seed: 'noura-tentative-upcoming', patient: 'noura-patient-amal-hussein', dateOffset: 3, time: '10:00', provider: 'noura-dr-noor-issa', service: 'noura-teeth-cleaning', status: 'tentative' },
      { seed: 'noura-confirmed-upcoming', patient: 'noura-patient-karim-farhan', dateOffset: 4, time: '11:30', provider: 'noura-dr-omar-haddad', service: 'noura-dental-exam', status: 'confirmed' },
      { seed: 'noura-cancelled-future', patient: 'noura-patient-rasha-nabil', dateOffset: 5, time: '14:00', provider: 'noura-dr-noor-issa', service: 'noura-panoramic-xray', status: 'cancelled' },
      { seed: 'noura-confirmed-past', patient: 'noura-patient-amal-hussein', dateOffset: -6, time: '12:00', provider: 'noura-dr-omar-haddad', service: 'noura-dental-x-ray', status: 'confirmed' },
    ],
    conversations: [
      {
        key: 'noura:conv:booking',
        session: 'noura-demo-session-booking',
        patient: 'noura-patient-amal-hussein',
        messages: [
          { role: 'patient', content: 'مرحبا، بدي أحجز موعد' },
          { role: 'assistant', content: 'أهلاً بك في مركز نورا لطب الأسنان والتصوير. ما الخدمة التي تحتاجها؟' },
          { role: 'patient', content: 'بدي أشعة بانوراما' },
          { role: 'assistant', content: 'بالتأكيد. لدينا مواعيد متاحة للأشعة البانورامية.' },
        ],
      },
      {
        key: 'noura:conv:pricing',
        session: 'noura-demo-session-pricing',
        patient: 'noura-patient-karim-farhan',
        messages: [
          { role: 'patient', content: 'كم سعر الأشعة البانورامية؟' },
          { role: 'assistant', content: 'الأشعة البانورامية في مركز نورا تكلف 85₪.' },
        ],
      },
    ],
    knowledge: [
      { key: 'noura-clinic-intro', title: 'تعريف المركز', content: 'مركز نورا لطب الأسنان والتصوير هو مركز تجريبي متخصص في طب الأسنان والتصوير الشعاعي المتقدم.' },
      { key: 'noura-opening-hours', title: 'ساعات العمل', content: 'ساعات عمل مركز نورا: الأحد–الخميس من 9:00 صباحاً حتى 5:00 مساءً. الجمعة والسبت مغلقون.' },
      { key: 'noura-services-pricing', title: 'خدماتنا وأسعارها', content: 'خدماتنا: فحص أسنان (45₪)، تنظيف أسنان (75₪)، أشعة أسنان (45₪)، أشعة بانوراما (85₪)، استشارة عصب (110₪)، خلع ضرس (85₪).' },
      { key: 'noura-appointment-policy', title: 'سياسة المواعيد', content: 'يمكن حجز المواعيد مباشرة. تبقى المواعيد مؤقتة حتى التأكيد عبر الرابط المرسل.' },
      { key: 'noura-cancellation-policy', title: 'سياسة الإلغاء', content: 'يمكن إلغاء المواعيد عبر الرابط المرسل. الإلغاء قبل 24 ساعة من الموعد.' },
    ],
    aiSettings: {
      assistant_name: 'نورا',
      tone: 'friendly',
      language: 'ar',
      greeting: 'أهلاً بك في مركز نورا لطب الأسنان والتصوير. كيف يمكنني مساعدتك؟',
      confidence_threshold: 0.25,
    },
  },
];

// ---------------------------------------------------------------------------
// 5. Helper functions
// ---------------------------------------------------------------------------
function clinicId(key) { return demoUuid(key); }
function providerId(clinicKey, providerKey) { return demoUuid(`${clinicKey}:${providerKey}`); }
function serviceId(clinicKey, serviceKey) { return demoUuid(`${clinicKey}:${serviceKey}`); }
function patientId(clinicKey, patientKey) { return demoUuid(`${clinicKey}:${patientKey}`); }
function appointmentId(clinicKey, seed) { return demoUuid(`${clinicKey}:appointment:${seed}`); }
function conversationId(clinicKey, key) { return demoUuid(`${clinicKey}:${key}`); }
function messageId(clinicKey, convKey, m) { return demoUuid(`${clinicKey}:message:${convKey}:${m}`); }
function knowledgeId(clinicKey, key) { return demoUuid(`${clinicKey}:knowledge:${key}`); }
function documentId(clinicKey, key) { return demoUuid(`${clinicKey}:document:${key}`); }
function scheduleId(clinicKey, providerKey, weekday) { return demoUuid(`${clinicKey}:schedule:${providerKey}:${weekday}`); }
function assignmentId(clinicKey, providerKey, serviceKey) { return demoUuid(`${clinicKey}:assign:${providerKey}:${serviceKey}`); }
function commSettingsId(clinicKey) { return demoUuid(`${clinicKey}:communication-settings`); }
function aiSettingsId(clinicKey) { return demoUuid(`${clinicKey}:clinic-ai-settings`); }
function notifId(clinicKey, seed) { return demoUuid(`${clinicKey}:notif:${seed}`); }
function clinicUserId(clinicKey) { return demoUuid(`${clinicKey}:clinic-user`); }
function clinicOwnerId(clinicKey) { return demoUuid(`${clinicKey}:clinic-owner`); }

function todayOffset(days) {
  const d = new Date();
  d.setUTCHours(0,0,0,0);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0,10);
}

function serviceLabel(clinic, serviceKey) {
  const svc = clinic.services.find((s) => s.key === serviceKey);
  return svc ? svc.name : 'Dental Service';
}

// ---------------------------------------------------------------------------
// 6. Seed functions (per clinic)
// ---------------------------------------------------------------------------
async function seedClinic(clinic) {
  const cid = clinicId(clinic.key);
  const { error } = await sb
    .from('clinics')
    .upsert({
      id: cid,
      name: clinic.name,
      slug: clinic.slug,
      address: clinic.address,
      phone: clinic.phone,
      website: clinic.website,
      logo: null,
      settings: {
        timezone: clinic.timezone,
        default_appointment_duration_minutes: clinic.defaultDuration,
        demo: true,
      },
    })
    .eq('id', cid)
    .select('id')
    .single();
  if (error) throw new Error(`Failed to seed clinic ${clinic.name}: ${error.message}`);

  // Clinic member (owner)
  const { error: cuErr } = await sb
    .from('clinic_users')
    .upsert({
      id: clinicOwnerId(clinic.key),
      clinic_id: cid,
      user_id: clinicUserId(clinic.key),
      role: 'owner',
    })
    .eq('id', clinicOwnerId(clinic.key));
  if (cuErr) throw new Error(`Failed to seed clinic owner for ${clinic.name}: ${cuErr.message}`);
}

async function seedProviders(clinic) {
  const cid = clinicId(clinic.key);

  for (const provider of clinic.providers) {
    const { error } = await sb
      .from('providers')
      .upsert({
        id: providerId(clinic.key, provider.key),
        clinic_id: cid,
        user_id: demoUuid(`${clinic.key}:provider-user:${provider.key}`),
        provider_type: provider.type,
        name: provider.name,
        title: provider.title,
        email: provider.email,
        phone: provider.phone,
      }, { onConflict: 'id' });
    if (error) throw new Error(`Failed to seed provider ${provider.name}: ${error.message}`);
  }

  // Provider schedules (weekdays 1-5)
  for (const provider of clinic.providers) {
    for (let weekday = 1; weekday <= 5; weekday++) {
      const { error } = await sb
        .from('provider_schedules')
        .upsert({
          id: scheduleId(clinic.key, provider.key, weekday),
          clinic_id: cid,
          provider_id: providerId(clinic.key, provider.key),
          weekday,
          enabled: true,
          start_time: provider.start,
          end_time: provider.end,
          breaks: [{ start: provider.breakStart, end: provider.breakEnd }],
          appointment_duration_minutes: clinic.defaultDuration,
          max_appointments_per_day: provider.maxPerDay,
        }, { onConflict: 'id' });
      if (error) throw new Error(`Failed to seed schedule for ${provider.name}: ${error.message}`);
    }
  }

  // Provider vacation (next Friday)
  const d = new Date();
  d.setUTCHours(0, 0, 0, 0);
  const daysUntilFriday = (5 - d.getUTCDay() + 7) % 7 || 7;
  d.setUTCDate(d.getUTCDate() + daysUntilFriday);
  const futureFri = d.toISOString().slice(0, 10);
  const { error: vacErr } = await sb.from('provider_vacations').upsert({
    id: demoUuid(`${clinic.key}:vacation:${clinic.providers[0].key}:friday`),
    clinic_id: cid,
    provider_id: providerId(clinic.key, clinic.providers[0].key),
    vacation_date: futureFri,
  }, { onConflict: 'id' });
  if (vacErr) throw new Error(`Failed to seed provider vacation for ${clinic.name}: ${vacErr.message}`);

  // Clinic holiday (past)
  const holidayPast = todayOffset(-40);
  const { error: holErr } = await sb.from('clinic_holidays').upsert({
    id: demoUuid(`${clinic.key}:holiday:past`),
    clinic_id: cid,
    holiday_date: holidayPast,
    name: 'Public Holiday (Demo)',
  }, { onConflict: 'id' });
  if (holErr) throw new Error(`Failed to seed clinic holiday for ${clinic.name}: ${holErr.message}`);

  // Communication settings (unique on clinic_id)
  const { error: commErr } = await sb.from('clinic_communication_settings').upsert({
    id: commSettingsId(clinic.key),
    clinic_id: cid,
    reminders_enabled: true,
    reminder_offset_minutes_1: 1440,
    reminder_offset_minutes_2: 120,
    confirmation_notifications: true,
    cancellation_notifications: true,
    rescheduling_notifications: true,
    notification_language: clinic.aiSettings.language === 'en' ? 'en' : 'ar',
  }, { onConflict: 'clinic_id' });
  if (commErr) throw new Error(`Failed to seed communication settings for ${clinic.name}: ${commErr.message}`);
}

async function seedServices(clinic) {
  const cid = clinicId(clinic.key);

  for (const service of clinic.services) {
    const { error } = await sb.from('clinic_services').upsert({
      id: serviceId(clinic.key, service.key),
      clinic_id: cid,
      name: service.name,
      description: service.description,
      duration_minutes: service.duration,
      price: service.price,
      active: true,
    }, { onConflict: 'id' });
    if (error) throw new Error(`Failed to seed service ${service.name}: ${error.message}`);
  }

  // Provider ↔ service assignments
  for (const [providerKey, serviceKey] of clinic.assignments) {
    const { error } = await sb.from('provider_services').upsert({
      id: assignmentId(clinic.key, providerKey, serviceKey),
      clinic_id: cid,
      provider_id: providerId(clinic.key, providerKey),
      service_id: serviceId(clinic.key, serviceKey),
    }, { onConflict: 'id' });
    if (error) throw new Error(`Failed to assign provider ${providerKey} → ${serviceKey}: ${error.message}`);
  }
}

async function seedPatientsAndAppointments(clinic) {
  const cid = clinicId(clinic.key);

  // First soft-delete existing demo appointments for this clinic so we can re-create
  // appointments that reference the new deterministic patient IDs.
  await sb
    .from('appointments')
    .update({ deleted_at: new Date().toISOString() })
    .eq('clinic_id', cid)
    .is('deleted_at', null);

  // Soft-delete existing demo conversations/messages (they reference old patient IDs)
  await sb
    .from('messages')
    .update({ deleted_at: new Date().toISOString() })
    .eq('clinic_id', cid)
    .is('deleted_at', null);
  await sb
    .from('conversations')
    .update({ deleted_at: new Date().toISOString() })
    .eq('clinic_id', cid)
    .is('deleted_at', null);

  // Map of patient seed key → actual stored patient id (in case the patient
  // already existed from a previous seed with a different deterministic id)
  // Exported via module-level variable so conversations/notifications can use it too.
  const patientIdMap = {};
  global.__patientIdMap = patientIdMap;

  for (const patient of clinic.patients) {
    const row = {
      clinic_id: cid,
      full_name: patient.name,
      email: patient.email,
      phone_number: patient.phone,
      notes: patient.notes,
    };
    if (patient.dob) row.date_of_birth = patient.dob;

    // Check if a patient with this clinic_id+email already exists (unique index, not constraint)
    const { data: existing } = await sb
      .from('patients')
      .select('id')
      .eq('clinic_id', cid)
      .eq('email', patient.email)
      .maybeSingle();

    if (existing) {
      // Update only non-PK fields; preserve the existing id so FK constraints remain valid.
      const { error } = await sb.from('patients').update(row).eq('id', existing.id);
      if (error) throw new Error(`Failed to update patient ${patient.name}: ${error.message}`);
      patientIdMap[patient.key] = existing.id;
    } else {
      const insertRow = { ...row, id: patientId(clinic.key, patient.key) };
      const { error } = await sb.from('patients').insert(insertRow);
      if (error) throw new Error(`Failed to seed patient ${patient.name}: ${error.message}`);
      patientIdMap[patient.key] = insertRow.id;
    }
  }

  const tokenHash = (value) => createHash('sha256').update(value).digest('hex');

  for (const appt of clinic.appointments) {
    const date = todayOffset(appt.dateOffset);
    const row = {
      id: appointmentId(clinic.key, appt.seed),
      clinic_id: cid,
      provider_id: providerId(clinic.key, appt.provider),
      patient_id: patientIdMap[appt.patient],
      service: serviceLabel(clinic, appt.service),
      appointment_date: date,
      scheduled_at: `${date}T${appt.time}:00.000Z`,
      duration_minutes: clinic.defaultDuration,
      status: appt.status,
      booking_token: tokenHash(`demo-booking-token-${clinic.key}-${appt.seed}`),
      notes: 'Demo appointment',
    };
    const { error } = await sb.from('appointments').upsert(row, { onConflict: 'id' });
    if (error) throw new Error(`Failed to seed appointment ${appt.seed}: ${error.message}`);
  }

  // One demo lead
  const { error: leadErr } = await sb.from('leads').upsert({
    id: demoUuid(`${clinic.key}:lead:demo`),
    clinic_id: cid,
    patient_id: patientIdMap[clinic.patients[0].key],
    source: 'demo',
    status: 'new',
  }, { onConflict: 'id' });
  if (leadErr) throw new Error(`Failed to seed lead for ${clinic.name}: ${leadErr.message}`);
}

async function seedConversations(clinic) {
  const cid = clinicId(clinic.key);
  const patientIdMap = global.__patientIdMap || {};

  for (const conv of clinic.conversations) {
    const convId = conversationId(clinic.key, conv.key);
    const { error: convErr } = await sb.from('conversations').upsert({
      id: convId,
      clinic_id: cid,
      patient_id: patientIdMap[conv.patient] || patientId(clinic.key, conv.patient),
      session_id: conv.session,
      status: 'open',
      started_at: new Date().toISOString(),
      metadata: { demo: true },
    }, { onConflict: 'id' });
    if (convErr) throw new Error(`Failed to seed conversation ${conv.key}: ${convErr.message}`);

    let seq = 0;
    for (const m of conv.messages) {
      const { error: msgErr } = await sb.from('messages').upsert({
        id: messageId(clinic.key, conv.key, `m${seq++}`),
        conversation_id: convId,
        clinic_id: cid,
        role: m.role,
        content: m.content,
        created_at: new Date(Date.now() - seq * 60000).toISOString(),
      }, { onConflict: 'id' });
      if (msgErr) throw new Error(`Failed to seed messages for ${conv.key}: ${msgErr.message}`);
    }
  }
}

async function seedKnowledge(clinic) {
  const cid = clinicId(clinic.key);

  for (const row of clinic.knowledge) {
    const { error } = await sb.from('clinic_ai_knowledge').upsert({
      id: knowledgeId(clinic.key, row.key),
      clinic_id: cid,
      type: 'structured',
      subtype: 'faq',
      title: row.title,
      content: row.content,
      metadata: { demo: true, language: clinic.aiSettings.language },
      deleted_at: null,
    }, { onConflict: 'id' });
    if (error) throw new Error(`Failed to seed knowledge row ${row.key}: ${error.message}`);
  }

  // Knowledge documents (short TXT demo docs)
  const docs = [
    { key: 'clinic-intro-doc', orig: 'clinic-intro.txt', mime: 'text/plain', size: 320, content: `${clinic.name}. Contact us by phone or website.` },
    { key: 'services-doc', orig: 'services.txt', mime: 'text/plain', size: 610, content: `Services: ${clinic.services.map((s) => s.name).join(', ')}.` },
    { key: 'hours-doc', orig: 'hours.txt', mime: 'text/plain', size: 260, content: `Open Sunday-Thursday ${clinic.providers[0].start}-${clinic.providers[0].end}.` },
  ];
  for (const doc of docs) {
    const { error } = await sb.from('clinic_knowledge_documents').upsert({
      id: documentId(clinic.key, doc.key),
      clinic_id: cid,
      uploaded_by: null,
      filename: doc.orig,
      original_filename: doc.orig,
      file_type: 'txt',
      mime_type: 'text/plain',
      file_size: doc.size,
      checksum: sha256Hex(doc.content),
      language: clinic.aiSettings.language,
      storage_path: null,
      upload_status: 'success',
      processing_status: 'indexed',
      chunk_count: 1,
      embedding_model: 'demo',
      uploaded_at: new Date().toISOString(),
      indexed_at: new Date().toISOString(),
      deleted_at: null,
    }, { onConflict: 'id' });
    if (error) throw new Error(`Failed to seed knowledge doc ${doc.key}: ${error.message}`);
  }

  // AI settings row (unique on clinic_id)
  const { error: settingsErr } = await sb.from('clinic_ai_settings').upsert({
    id: aiSettingsId(clinic.key),
    clinic_id: cid,
    assistant_name: clinic.aiSettings.assistant_name,
    tone: clinic.aiSettings.tone,
    language: clinic.aiSettings.language,
    greeting: clinic.aiSettings.greeting,
    safety_controls: { demo: true },
    confidence_threshold: clinic.aiSettings.confidence_threshold,
  }, { onConflict: 'clinic_id' });
  if (settingsErr) throw new Error(`Failed to seed AI settings for ${clinic.name}: ${settingsErr.message}`);
}

async function seedNotifications(clinic) {
  const cid = clinicId(clinic.key);
  const patientIdMap = global.__patientIdMap || {};
  const confirmedAppt = clinic.appointments.find((a) => a.status === 'confirmed' && a.dateOffset > 0);
  if (!confirmedAppt) return;

  const apptId = appointmentId(clinic.key, confirmedAppt.seed);
  const { error } = await sb.from('notification_queue').upsert({
    id: notifId(clinic.key, 'confirmed'),
    clinic_id: cid,
    appointment_id: apptId,
    patient_id: patientIdMap[confirmedAppt.patient] || patientId(clinic.key, confirmedAppt.patient),
    channel: 'email',
    type: 'appointment_reminder',
    payload: { status: 'confirmed', demo: true },
    status: 'pending',
    scheduled_for: new Date(Date.now() + 1000 * 60).toISOString(),
    created_at: new Date().toISOString(),
  }, { onConflict: 'id' });
  if (error) throw new Error(`Failed to seed notification queue for ${clinic.name}: ${error.message}`);
}

// ---------------------------------------------------------------------------
// 7. Top-level orchestration
// ---------------------------------------------------------------------------
async function main() {
  console.log('Demo seed started (4 clinics)...');

  for (const clinic of CLINICS) {
    const cid = clinicId(clinic.key);
    console.log(`\nSeeding: ${clinic.name} (${clinic.slug})`);

    // Ensure clinic is not soft-deleted
    await sb.from('clinics').update({ deleted_at: null }).eq('id', cid);

    await seedClinic(clinic);
    console.log('  Clinic seeded.');
    await seedProviders(clinic);
    console.log('  Providers + schedules + assignments seeded.');
    await seedServices(clinic);
    console.log('  Services seeded.');
    await seedPatientsAndAppointments(clinic);
    console.log('  Patients + appointments seeded.');
    await seedConversations(clinic);
    console.log('  Conversations seeded.');
    await seedKnowledge(clinic);
    console.log('  Knowledge + docs seeded.');
    await seedNotifications(clinic);
    console.log('  Notification queue seeded.');
  }

  console.log('\nDemo Seed complete.');
  console.log('Clinics:');
  for (const clinic of CLINICS) {
    console.log(`  ${clinic.name} — slug: ${clinic.slug} — id: ${clinicId(clinic.key)}`);
  }
}

main().catch((err) => {
  console.error(`DEMO SEED FAILED: ${err.message}`);
  process.exit(1);
});