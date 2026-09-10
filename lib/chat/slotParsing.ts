/**
 * Slot parsing for the booking API contract (date YYYY-MM-DD, time HH:MM).
 *
 * Root-cause fix for "Invalid booking request": the previous inline logic
 * `slot.split('T')` produced empty time when a slot lacked the 'T' separator
 * (e.g. bare "HH:mm" or "YYYY-MM-DD HH:mm"), which then failed the booking
 * API's Zod `time` regex and surfaced as the generic 400 error. This parser
 * supports the canonical format from suggestFreeSlots
 * ("YYYY-MM-DDTHH:mm:ss.sssZ"), "YYYY-MM-DD HH:mm", and bare "HH:mm" (using
 * the conversation's selected date), and validates ranges before returning.
 */
export function parseSlotDateTime(slot: string | null, fallbackDate: string): { date: string; time: string } | null {
  const s = (slot ?? '').trim();
  if (!s) return null;

  // YYYY-MM-DDTHH:mm or YYYY-MM-DD HH:mm
  const withDate = /^(\d{4}-\d{2}-\d{2})[T ](\d{1,2}):(\d{2})/.exec(s);
  if (withDate) {
    const date = withDate[1];
    const hh = withDate[2].padStart(2, '0');
    const mm = withDate[3];
    if (Number(hh) > 23 || Number(mm) > 59) return null;
    return { date, time: `${hh}:${mm}` };
  }

  // Bare HH:mm (use fallback date)
  const timeOnly = /^(\d{1,2}):(\d{2})/.exec(s);
  if (timeOnly && fallbackDate) {
    const hh = timeOnly[1].padStart(2, '0');
    const mm = timeOnly[2];
    if (Number(hh) > 23 || Number(mm) > 59) return null;
    return { date: fallbackDate, time: `${hh}:${mm}` };
  }

  return null;
}

/**
 * 12-hour Arabic display for a 24-hour HH:mm time — imaging centers run
 * 09:00 → 20:00, and patients must see «9:00 ص … 12:00 م … 8:00 م», never a
 * bare 24-hour clock. Returns the input unchanged when unparseable.
 */
export function formatSlot12(hhmm: string): string {
  const m = /^(\d{1,2}):(\d{2})/.exec((hhmm ?? '').trim());
  if (!m) return hhmm ?? '';
  let h = Number(m[1]);
  const min = m[2];
  const suffix = h >= 12 ? 'م' : 'ص';
  h = h % 12 === 0 ? 12 : h % 12;
  return `${h}:${min} ${suffix}`;
}