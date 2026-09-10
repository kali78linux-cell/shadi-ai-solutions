/**
 * PHASE L — PUBLIC PAGE CONTENT service (achievements / testimonials /
 * articles / news ticker).
 *
 * Tenant isolation: every read/write is keyed by clinicId resolved server-side
 * by the caller AFTER authorizeClinicRequest. Binaries (optional images) live
 * in the existing `clinic-public-media` bucket under
 * clinic/{clinic_id}/public-content/... (path passes the existing storage RLS
 * prefix policy); metadata-only columns image_path/image_url are stored here.
 * Colors are bounded hex (never raw CSS); enums are bounded lists.
 */
import { supabaseAdmin } from '@/lib/supabase/admin';
import { isHexColor } from '@/lib/services/clinicPublicConfig';

export type PublicContentType = 'achievements' | 'testimonials' | 'articles' | 'news';

export type FontSize = 'small' | 'medium' | 'large';
export type TickerSpeed = 'slow' | 'medium' | 'fast';

const CONTENT_TABLES: Record<PublicContentType, string> = {
  achievements: 'clinic_achievements',
  testimonials: 'clinic_testimonials',
  articles: 'clinic_articles',
  news: 'clinic_news_ticker',
} as const;

const FONT_SIZES: readonly string[] = ['small', 'medium', 'large'];
const SPEEDS: readonly string[] = ['slow', 'medium', 'fast'];

function hexCheck(key: string, v: unknown): string | null {
  if (v === undefined || v === null) return null;
  if (!isHexColor(v)) return `${key} must be a #rrggbb hex color`;
  return null;
}

/** Validate + sanitize a create payload for a given content type. */
export function validateContentInput(
  type: PublicContentType,
  input: Record<string, unknown>
): { ok: true; value: Record<string, unknown> } | { ok: false; message: string } {
  if (!CONTENT_TABLES[type]) return { ok: false, message: `unknown content type: ${type}` };
  const out: Record<string, unknown> = {};

  const str = (k: string, max: number, required: boolean) => {
    const v = input[k];
    if (v === undefined || v === null) {
      if (required) return `field ${k} is required`;
      return null;
    }
    if (typeof v !== 'string' || v.trim().length === 0) return `field ${k} must be a non-empty string`;
    if (v.length > max) return `field ${k} exceeds max ${max} characters`;
    out[k] = v.trim();
    return null;
  };
  const optStr = (k: string, max: number) => {
    const v = input[k];
    if (v === undefined || v === null) return null;
    if (typeof v !== 'string') return `field ${k} must be a string`;
    if (v.trim().length === 0) { out[k] = null; return null; }
    if (v.length > max) return `field ${k} exceeds max ${max} characters`;
    out[k] = v.trim();
    return null;
  };
  const optBool = (k: string) => {
    const v = input[k];
    if (v === undefined) return null;
    if (typeof v !== 'boolean') return `field ${k} must be a boolean`;
    out[k] = v;
    return null;
  };
  const optInt = (k: string, min: number, max: number) => {
    const v = input[k];
    if (v === undefined || v === null) return null;
    if (typeof v !== 'number' || !Number.isInteger(v) || v < min || v > max) {
      return `field ${k} must be an integer between ${min} and ${max}`;
    }
    out[k] = v;
    return null;
  };

  let err: string | null = null;
  switch (type) {
    case 'achievements':
      err = str('title', 120, true) ?? str('value', 60, true) ?? optStr('icon', 8);
      if (!err && input['background_color'] !== undefined) err = hexCheck('background_color', input['background_color']);
      if (!err) {
        const fs = input['font_size'];
        if (fs !== undefined) {
          if (typeof fs !== 'string' || !FONT_SIZES.includes(fs)) err = 'font_size must be one of small|medium|large';
          else out['font_size'] = fs;
        }
      }
      break;
    case 'testimonials':
      err = str('patient_name', 120, true) ?? str('content', 2000, true) ?? optStr('image_path', 500) ?? optStr('image_url', 900);
      if (!err) err = optInt('rating', 1, 5);
      break;
    case 'articles':
      err = str('title', 200, true) ?? optStr('content', 10000) ?? optStr('category', 80) ?? optStr('image_path', 500) ?? optStr('image_url', 900);
      if (!err && input['title_color'] !== undefined) err = hexCheck('title_color', input['title_color']);
      if (!err) {
        const fs = input['font_size'];
        if (fs !== undefined) {
          if (typeof fs !== 'string' || !FONT_SIZES.includes(fs)) err = 'font_size must be one of small|medium|large';
          else out['font_size'] = fs;
        }
      }
      break;
    case 'news':
      err = str('text', 300, true) ?? optStr('link', 600);
      if (!err && input['background_color'] !== undefined) err = hexCheck('background_color', input['background_color']);
      if (!err && input['text_color'] !== undefined) err = hexCheck('text_color', input['text_color']);
      if (!err) {
        const sp = input['speed'];
        if (sp !== undefined) {
          if (typeof sp !== 'string' || !SPEEDS.includes(sp)) err = 'speed must be one of slow|medium|fast';
          else out['speed'] = sp;
        }
      }
      if (!err) err = optInt('priority', 0, 1000);
      break;
  }

  if (err) return { ok: false, message: err };
  if (!err && input['display_order'] !== undefined) {
    const ord = optInt('display_order', 0, 100000);
    if (ord) return { ok: false, message: ord };
  }
  err = optBool('enabled');
  if (err) return { ok: false, message: err };
  return { ok: true, value: out };
}

export function contentTableFor(type: PublicContentType): string {
  const table = CONTENT_TABLES[type];
  if (!table) throw new Error(`unknown content type: ${type}`);
  return table;
}

export async function listPublicContent(clinicId: string, type: PublicContentType) {
  const table = contentTableFor(type);
  const { data, error } = await supabaseAdmin
    .from(table)
    .select('*')
    .eq('clinic_id', clinicId)
    .order('display_order', { ascending: true });
  if (error) throw new Error(error.message);
  return data ?? [];
}

export async function createPublicContent(
  clinicId: string,
  type: PublicContentType,
  input: Record<string, unknown>
): Promise<{ ok: true; item: Record<string, unknown> } | { ok: false; message: string }> {
  const validation = validateContentInput(type, input);
  if ('message' in validation) return validation;
  const table = contentTableFor(type);
  const { data, error } = await supabaseAdmin
    .from(table)
    .insert({ clinic_id: clinicId, ...validation.value })
    .select('*')
    .single();
  if (error) return { ok: false, message: `Failed to create content: ${error.message}` };
  return { ok: true, item: data as Record<string, unknown> };
}

export async function updatePublicContent(
  clinicId: string,
  type: PublicContentType,
  id: string,
  patch: Record<string, unknown>
): Promise<{ ok: boolean; message?: string }> {
  const validation = validateContentInput(type, patch);
  if ('message' in validation) return { ok: false, message: validation.message };
  const table = contentTableFor(type);
  const { error } = await supabaseAdmin
    .from(table)
    .update(validation.value)
    .eq('clinic_id', clinicId)
    .eq('id', id);
  if (error) return { ok: false, message: error.message };
  return { ok: true };
}

export async function deletePublicContent(
  clinicId: string,
  type: PublicContentType,
  id: string
): Promise<{ ok: boolean; message?: string }> {
  const table = contentTableFor(type);
  const { error } = await supabaseAdmin
    .from(table)
    .delete()
    .eq('clinic_id', clinicId)
    .eq('id', id);
  if (error) return { ok: false, message: error.message };
  return { ok: true };
}
