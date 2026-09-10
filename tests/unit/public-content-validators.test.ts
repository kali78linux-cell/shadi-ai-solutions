import { describe, it, expect } from 'vitest';
import { isHexColor, validateThemePatch, DEFAULT_THEME } from '@/lib/services/clinicPublicConfig';
import { validateContentInput } from '@/lib/services/clinicPublicContent';

describe('PHASE L — public-page theme validators', () => {
  it('accepts valid hex colors only', () => {
    expect(isHexColor('#0e7490')).toBe(true);
    expect(isHexColor('#ffffff')).toBe(true);
    expect(isHexColor('red')).toBe(false);
    expect(isHexColor('#fff')).toBe(false);
    expect(isHexColor('#gggggg')).toBe(false);
    expect(isHexColor(null)).toBe(false);
  });

  it('accepts a complete valid theme patch', () => {
    const result = validateThemePatch({
      primary_color: '#0e7490',
      background_color: '#f6f8ff',
      text_color: '#0f172a',
      button_shape: 'pill',
      button_size: 'medium',
      button_shadow: true,
      button_zoom: true,
    });
    expect(result.ok).toBe(true);
    if ('value' in result) {
      expect(result.value.primary_color).toBe('#0e7490');
    }
  });

  it('rejects unknown theme keys (no silent coercion)', () => {
    const result = validateThemePatch({ css_injection: 'body{display:none}' });
    expect(result.ok).toBe(false);
    if ('message' in result) expect(result.message).toContain('unknown theme key');
  });

  it('rejects free-form colors and invalid enum values', () => {
    expect(validateThemePatch({ primary_color: 'url(https://evil.example)' }) .ok).toBe(false);
    expect(validateThemePatch({ button_shape: 'jagged' }) .ok).toBe(false);
    expect(validateThemePatch({ button_shadow: 'yes' }) .ok).toBe(false);
  });

  it('default theme is stable and valid', () => {
    expect(isHexColor(DEFAULT_THEME.primary_color)).toBe(true);
    expect(DEFAULT_THEME.button_shape).toBe('pill');
  });
});

describe('PHASE L — public content input validators', () => {
  it('builds a valid achievement payload', () => {
    const result = validateContentInput('achievements', {
      title: 'فحص سعيد',
      value: '+2,000',
      icon: '🩻',
      background_color: '#0e7490',
      font_size: 'medium',
    });
    expect(result.ok).toBe(true);
  });

  it('rejects a non-hex achievement color', () => {
    const result = validateContentInput('achievements', { title: 'x', value: 'y', background_color: 'not-a-color' });
    expect(result.ok).toBe(false);
  });

  it('validates testimonials rating 1-5', () => {
    expect(validateContentInput('testimonials', { patient_name: 'أحمد', content: 'تجربة ممتازة', rating: 5 }) .ok).toBe(true);
    expect(validateContentInput('testimonials', { patient_name: 'أحمد', content: 'x', rating: 9 }) .ok).toBe(false);
  });

  it('validates news speed enum + colors', () => {
    expect(validateContentInput('news', { text: 'عرض خاص', speed: 'fast', background_color: '#0e7490', text_color: '#ffffff' }) .ok).toBe(true);
    expect(validateContentInput('news', { text: 'x', speed: 'instantly' }) .ok).toBe(false);
  });

  it('enforces length limits on free text', () => {
    const long = 'x'.repeat(500);
    expect(validateContentInput('news', { text: long }) .ok).toBe(false);
  });

  it('rejects unknown content types', () => {
    expect(validateContentInput('spam' as never, {}) .ok).toBe(false);
  });
});
