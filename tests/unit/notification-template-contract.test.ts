import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

/**
 * STEP 15E/G2 — Contract guard: the notification-template code paths must
 * target the REAL live table `clinic_notification_templates` with the true
 * columns (template_type/channel/language/subject/body). We assert this on the
 * source files so a regression back to the phantom `notification_templates`
 * table or `name`/`active` columns fails the suite immediately.
 */

const projectRoot = path.resolve(__dirname, '../..');

const routeFile = path.join(
  projectRoot,
  'app/api/clinic/notification-templates/route.ts'
);
const routeItemFile = path.join(
  projectRoot,
  'app/api/clinic/notification-templates/[templateId]/route.ts'
);
const uiFile = path.join(
  projectRoot,
  'components/dashboard/NotificationTemplateManager.tsx'
);

const routeContent = fs.readFileSync(routeFile, 'utf8');
const routeItemContent = fs.readFileSync(routeItemFile, 'utf8');
const uiContent = fs.readFileSync(uiFile, 'utf8');

describe('15E — notification-templates contract on real schema', () => {
  it('routes query the real clinic_notification_templates table (no phantom notification_templates)', () => {
    expect(routeContent).toContain(".from('clinic_notification_templates')");
    expect(routeItemContent).toContain(".from('clinic_notification_templates')");
    expect(routeContent).not.toMatch(/.from\('notification_templates'\)/);
    expect(routeItemContent).not.toMatch(/.from\('notification_templates'\)/);
  });

  it('routes/UI use the real contract fields (template_type/channel/language/subject/body)', () => {
    expect(routeContent).toContain('template_type');
    expect(routeContent).toContain('channel');
    expect(routeContent).toContain('language');
    expect(routeContent).toContain('subject');
    expect(routeContent).toContain('body');
    expect(uiContent).toContain('template_type');
    expect(uiContent).toContain('channel');
    expect(uiContent).toContain('language');
  });

  it('routes/UI no longer reference the phantom name/active columns', () => {
    expect(routeContent).not.toMatch(/\bname:\s/);
    expect(routeContent).not.toMatch(/\bactive:\s/);
    expect(routeItemContent).not.toMatch(/\bupdate\.name\b/);
    expect(routeItemContent).not.toMatch(/\bupdate\.active\b/);
    expect(uiContent).not.toMatch(/\bt\.name\b/);
    expect(uiContent).not.toMatch(/\bt\.active\b/);
  });

  it('enum contract lives in the shared lib (route files must NOT export arbitrary values)', () => {
    const contractFile = path.join(
      projectRoot,
      'lib/notification/templateContract.ts'
    );
    const contractContent = fs.readFileSync(contractFile, 'utf8');
    expect(contractContent).toContain('export const NOTIFICATION_TEMPLATE_TYPES');
    expect(contractContent).toContain('export const NOTIFICATION_CHANNELS');
    expect(contractContent).toContain('export const NOTIFICATION_LANGUAGES');
    // Next.js Route files may only export handlers — the routes must import
    // the contract from the shared lib instead of re-exporting it.
    expect(routeContent).toContain("from '@/lib/notification/templateContract'");
    expect(routeContent).not.toContain('export const NOTIFICATION_TEMPLATE_TYPES');
    expect(routeItemContent).toContain("from '@/lib/notification/templateContract'");
    expect(routeItemContent).not.toContain('export const NOTIFICATION_TEMPLATE_TYPES');
  });

  it('UI template-type labels cover all four DB CHECK values', () => {
    for (const v of [
      'appointment_confirmation',
      'appointment_reminder',
      'appointment_cancellation',
      'appointment_rescheduling',
    ]) {
      expect(uiContent).toContain(v);
    }
  });
});