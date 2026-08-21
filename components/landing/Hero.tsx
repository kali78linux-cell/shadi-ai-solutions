'use client';

import { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { landingCopy } from '@/lib/landing/landing-copy';
import LandingButton from './LandingButton';

type ChatStep =
  | { type: 'ai'; text: string }
  | { type: 'patient'; text: string }
  | { type: 'ai-buttons' }
  | { type: 'confirm' }
  | { type: 'reminder' };

// The exact conversation script from the design spec.
const script: ChatStep[] = [
  { type: 'ai', text: 'أهلًا فيك، كيف بقدر أساعدك؟' },
  { type: 'patient', text: 'طاحونتي بتوجعني من مبارح.' },
  { type: 'ai', text: 'سلامتك 🙏 الألم بيزيد مع البارد ولا مستمر طول الوقت؟' },
  { type: 'patient', text: 'الألم مستمر' },
  {
    type: 'ai',
    text: 'تمام. حسب موقعك بشارع النصر بنابلس، أقرب عيادة إلك هي عيادة الدكتورة حلا، ومن أمهر الأطباء بهالمنطقة. بدك أفحصلك أقرب موعد متوفر عندها؟',
  },
  { type: 'patient', text: 'نعم' },
  { type: 'ai', text: 'يوجد موعد اليوم الساعة 2:30، وموعد الساعة 4:20 مساءً. أنهي بتناسبك؟' },
  { type: 'patient', text: 'الساعة 4:20' },
  { type: 'ai', text: 'ممتاز، بس محتاج أكمّل تسجيلك — شو اسمك ورقم هاتفك؟' },
  { type: 'patient', text: 'اسمي أحمد سالم، 059-123-4567' },
  { type: 'ai', text: 'تمام يا أحمد، بأكدلك الحجز عند د. حلا الساعة 4:20 مساءً؟' },
  { type: 'ai-buttons' },
  { type: 'patient', text: 'تأكيد الحجز ✓' },
  { type: 'confirm' },
  { type: 'reminder' },
];

const TYPING_MS = 1500;
const GAP_MS = 1300;
const CONFIRM_DELAY_MS = 1500;
const LOOP_DELAY_MS = 6000;

export default function Hero() {
  const [showTyping, setShowTyping] = useState(false);
  const [messages, setMessages] = useState<ChatStep[]>([]);

  useEffect(() => {
    let cancelled = false;
    let t1: ReturnType<typeof setTimeout>;
    let t2: ReturnType<typeof setTimeout>;
    let t3: ReturnType<typeof setTimeout>;
    let t4: ReturnType<typeof setTimeout>;

    function playLoop() {
      setMessages([]);

      const playNext = (i: number) => {
        if (cancelled) return;
        if (i >= script.length) {
          // Wait, then loop again.
          t4 = setTimeout(playLoop, LOOP_DELAY_MS);
          return;
        }
        const step = script[i];
        if (step.type === 'ai-buttons') {
          setMessages((prev) => [...prev, step]);
          t1 = setTimeout(() => {
            // After the buttons appear, auto-confirm after 1.5s.
            setTimeout(() => playNext(i + 2), CONFIRM_DELAY_MS);
          }, 800);
          return;
        }
        setShowTyping(step.type === 'ai' || step.type === 'confirm' || step.type === 'reminder');
        t1 = setTimeout(() => {
          setShowTyping(false);
          setMessages((prev) => [...prev, step]);
          t2 = setTimeout(() => playNext(i + 1), GAP_MS);
        }, step.type === 'ai' || step.type === 'confirm' || step.type === 'reminder' ? TYPING_MS : 400);
      };

      playNext(0);
    }

    t1 = setTimeout(playLoop, 500);

    return () => {
      cancelled = true;
      clearTimeout(t1);
      clearTimeout(t2);
      clearTimeout(t3);
      clearTimeout(t4);
    };
  }, []);

  return (
    <section className="relative overflow-hidden pt-36 pb-20 lg:pt-44 lg:pb-28">
      {/* Dot-grid + drifting light blobs */}
      <div className="pointer-events-none absolute inset-0 -z-10">
        <div
          className="absolute inset-0 opacity-[0.5]"
          style={{
            backgroundImage: 'radial-gradient(circle, rgba(79,70,229,0.18) 1px, transparent 1px)',
            backgroundSize: '26px 26px',
          }}
        />
        <div className="absolute -left-20 top-10 h-72 w-72 rounded-full bg-landing-indigo/20 blur-3xl animate-blob-drift" />
        <div className="absolute right-0 top-40 h-80 w-80 rounded-full bg-landing-cyan/20 blur-3xl animate-blob-drift [animation-delay:4s]" />
        <div className="absolute bottom-10 left-1/3 h-72 w-72 rounded-full bg-landing-violet/20 blur-3xl animate-blob-drift [animation-delay:8s]" />
      </div>

      <div className="mx-auto grid max-w-7xl gap-12 px-4 sm:px-6 lg:grid-cols-2 lg:items-center lg:px-8">
        {/* Text column (RTL: first) */}
        <motion.div
          initial={{ opacity: 0, y: 24 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.7, ease: [0.22, 1, 0.36, 1] }}
        >
          <h1 className="font-heading text-4xl font-extrabold leading-[1.15] tracking-tight text-landing-text sm:text-5xl lg:text-6xl">
            {landingCopy.hero.headline1}
            <span className="mt-2 block bg-gradient-to-l from-landing-indigo via-landing-violet to-landing-cyan bg-clip-text text-transparent">
              {landingCopy.hero.headline2}
            </span>
          </h1>

          <p className="mt-6 max-w-xl text-lg leading-8 text-landing-text/80">
            {landingCopy.hero.paragraph}
          </p>

          <div className="mt-8 flex flex-col gap-4 sm:flex-row sm:items-center">
            <LandingButton href="/chat" size="lg">
              {landingCopy.hero.ctaPrimary}
            </LandingButton>
            <LandingButton href="#how-it-works" variant="secondary" size="lg">
              {landingCopy.hero.ctaSecondary}
            </LandingButton>
          </div>

          <div className="mt-10 flex flex-wrap gap-8">
            {landingCopy.hero.stats.map((stat) => (
              <div key={stat.label} className="flex items-center gap-3">
                <span className="font-mono text-2xl font-bold text-landing-indigo">{stat.value}</span>
                <span className="text-sm text-landing-text/70">{stat.label}</span>
              </div>
            ))}
          </div>
        </motion.div>

        {/* Phone mockup column */}
        <motion.div
          initial={{ opacity: 0, y: 30 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.8, delay: 0.15, ease: [0.22, 1, 0.36, 1] }}
          className="mx-auto w-full max-w-sm"
        >
          <div className="relative rounded-[2.5rem] border-4 border-landing-dark bg-landing-dark p-3 shadow-2xl">
            <div className="mb-3 flex items-center justify-center">
              <div className="h-1.5 w-16 rounded-full bg-white/20" />
            </div>
            <div className="rounded-[1.8rem] bg-landing-bg-white p-4" style={{ minHeight: 520 }}>
              <div className="mb-4 flex items-center gap-2 border-b border-landing-indigo/10 pb-3">
                <span className="flex h-9 w-9 items-center justify-center rounded-full bg-gradient-to-br from-landing-indigo to-landing-violet text-sm font-bold text-white">
                  D
                </span>
                <div>
                  <p className="text-sm font-bold text-landing-text">الدكتورة حلا</p>
                  <p className="text-xs text-landing-text/60">AI Receptionist</p>
                </div>
              </div>

              <div className="flex flex-col gap-2">
                <AnimatePresence>
                  {messages.map((msg, idx) => {
                    if (msg.type === 'ai-buttons') {
                      return (
                        <motion.div
                          key={`btn-${idx}`}
                          initial={{ opacity: 0, y: 8 }}
                          animate={{ opacity: 1, y: 0 }}
                          className="flex flex-col gap-2 rounded-2xl bg-landing-indigo/5 p-3"
                        >
                          <div className="flex gap-2">
                            <span className="cursor-pointer rounded-xl bg-gradient-to-l from-landing-indigo to-landing-violet px-3 py-2 text-xs font-bold text-white">
                              تأكيد الحجز ✓
                            </span>
                            <span className="cursor-pointer rounded-xl border border-landing-indigo/30 px-3 py-2 text-xs font-semibold text-landing-indigo/50">
                              لأ، لسه بدي أفكر
                            </span>
                          </div>
                        </motion.div>
                      );
                    }
                    if (msg.type === 'confirm') {
                      return (
                        <motion.div
                          key={`c-${idx}`}
                          initial={{ opacity: 0, scale: 0.94 }}
                          animate={{ opacity: 1, scale: 1 }}
                          className="rounded-2xl border border-emerald-300 bg-emerald-50 p-3"
                        >
                          <p className="text-sm font-bold text-emerald-700">✓ تم تأكيد الحجز</p>
                          <div className="mt-2 space-y-1 text-xs text-landing-text/80">
                            <p>العيادة: عيادة الدكتورة حلا - نابلس</p>
                            <p>الموعد: اليوم الساعة 4:20 مساءً</p>
                            <p>الاسم: أحمد سالم</p>
                            <p>الهاتف: 059-123-4567</p>
                          </div>
                        </motion.div>
                      );
                    }
                    if (msg.type === 'reminder') {
                      return (
                        <motion.div
                          key={`r-${idx}`}
                          initial={{ opacity: 0 }}
                          animate={{ opacity: 1 }}
                          className="mt-1 text-center text-xs text-landing-text/60"
                        >
                          ⏰ رح نذكّرك برسالة قبل موعدك بساعة وحدة
                        </motion.div>
                      );
                    }
                    const isAi = msg.type === 'ai';
                    return (
                      <motion.div
                        key={`m-${idx}`}
                        initial={{ opacity: 0, y: 8 }}
                        animate={{ opacity: 1, y: 0 }}
                        className={`max-w-[85%] rounded-2xl px-3 py-2 text-sm leading-6 ${
                          isAi
                            ? 'self-start rounded-bl-md bg-landing-indigo/10 text-landing-text'
                            : 'self-end rounded-br-md bg-gradient-to-l from-landing-indigo to-landing-violet text-white'
                        }`}
                      >
                        {msg.text}
                      </motion.div>
                    );
                  })}
                </AnimatePresence>

                {showTyping && (
                  <div className="flex items-center gap-1 self-start rounded-2xl rounded-bl-md bg-landing-indigo/10 px-3 py-2.5">
                    {[0, 1, 2].map((d) => (
                      <span
                        key={d}
                        className="h-2 w-2 rounded-full bg-landing-indigo/50 animate-dot-pulse"
                        style={{ animationDelay: `${d * 0.2}s` }}
                      />
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
        </motion.div>
      </div>
    </section>
  );
}