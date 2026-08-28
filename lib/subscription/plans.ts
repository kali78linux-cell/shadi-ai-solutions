export type BillingInterval = 'month' | 'year' | 'trial';

export interface SubscriptionPlan {
  id: string;
  name: string;
  nameEn: string;
  pricePerMonth: number; // integer in minor units of `currency`
  currency: string;      // ISO 4217 (e.g. 'ils')
  interval: BillingInterval;
  trialDays: number | null;
  priceId: string | null; // Stripe Price ID (server-side; billing only for paid plans)
  features: string[];
}

export const SUBSCRIPTION_PLANS: SubscriptionPlan[] = [
  {
    id: 'free_trial',
    name: 'تجربة مجانية',
    nameEn: 'Free Trial',
    pricePerMonth: 0,
    currency: 'ils',
    interval: 'trial',
    trialDays: 14,
    priceId: null,
    features: ['1 عيادة', 'حتى 5 مرضى', '5 محادثات AI/يوم', 'قاعدة معرفة أساسية'],
  },
  {
    id: 'starter',
    name: 'الباقة الابتدائية',
    nameEn: 'Starter',
    pricePerMonth: 0,
    currency: 'ils',
    interval: 'month',
    trialDays: null,
    priceId: null,
    features: ['1 عيادة', 'مرضى غير محدود', 'محادثات AI غير محدودة', 'قاعدة معرفة + تقارير'],
  },
  {
    id: 'founding',
    name: 'باقة التأسيس',
    nameEn: 'Founding',
    pricePerMonth: 5000, // 50.00 ILS in minor units — locked lifetime price for the first FOUNDING_SLOTS_TOTAL clinics
    currency: 'ils',
    interval: 'month',
    trialDays: null,
    priceId: process.env.STRIPE_PRICE_FOUNDING_MONTHLY ?? 'price_founding_monthly',
    features: ['سعر تأسيس ثابت مدى الحياة', 'كل مزايا باقة النمو', 'أولوية الدعم التأسيسي'],
  },
  {
    id: 'growth',
    name: 'النمو',
    nameEn: 'Growth',
    pricePerMonth: 12000, // 120.00 ILS in minor units
    currency: 'ils',
    interval: 'month',
    trialDays: null,
    priceId: process.env.STRIPE_PRICE_GROWTH_MONTHLY ?? 'price_growth_monthly',
    features: ['3 عيادات', 'مرضى غير محدود', 'فريق حتى 10 أعضاء', 'إشعارات واتساب/رسائل'],
  },
  {
    id: 'pro',
    name: 'الاحترافية',
    nameEn: 'Pro',
    pricePerMonth: 30000, // 300.00 ILS in minor units
    currency: 'ils',
    interval: 'month',
    trialDays: null,
    priceId: process.env.STRIPE_PRICE_PRO_MONTHLY ?? 'price_pro_monthly',
    features: ['عيادات غير محدودة', 'فريق غير محدود', 'تقارير متقدمة', 'أولوية الدعم'],
  },
];

export const PLAN_BY_ID: Record<string, SubscriptionPlan> = Object.fromEntries(
  SUBSCRIPTION_PLANS.map((p) => [p.id, p])
);

export function getPlan(planId: string | null | undefined): SubscriptionPlan {
  if (planId && PLAN_BY_ID[planId]) return PLAN_BY_ID[planId];
  return SUBSCRIPTION_PLANS[0]; // free trial default
}

/** A paid plan requires a Stripe Price ID and a non-zero amount. */
export function requiresPayment(plan: SubscriptionPlan): boolean {
  return plan.pricePerMonth > 0 && Boolean(plan.priceId);
}