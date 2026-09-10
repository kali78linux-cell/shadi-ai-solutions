import { describe, it, expect } from 'vitest';
import {
  validateMedicalFile,
  buildMedicalFileStoragePath,
  getMedicalSizeLimit,
  getAllMedicalSizeLimits,
  magicBytesMatch,
} from '@/lib/services/medicalFiles';

describe('medical files — private bucket validation (Phase 14/15)', () => {
  it('accepts every clinically required type: JPG, PNG, WEBP, PDF, MP4, DICOM', () => {
    const cases: Array<[string, string]> = [
      ['scan.jpg', 'image/jpeg'],
      ['scan.png', 'image/png'],
      ['scan.webp', 'image/webp'],
      ['report.pdf', 'application/pdf'],
      ['study.mp4', 'video/mp4'],
      ['study.dcm', 'application/dicom'],
    ];
    for (const [name, type] of cases) {
      const result = validateMedicalFile({ name, type, size: 1024 });
      expect(result.ok, `${name}/${type} should be accepted`).toBe(true);
    }
  });

  it('is NOT image-only: PDF and video pass (fixes the image-only upload path)', () => {
    expect(validateMedicalFile({ name: 'a.pdf', type: 'application/pdf', size: 1024 }).ok).toBe(true);
    expect(validateMedicalFile({ name: 'a.mp4', type: 'video/mp4', size: 1024 }).ok).toBe(true);
    expect(validateMedicalFile({ name: 'a.mov', type: 'video/quicktime', size: 1024 }).ok).toBe(true);
    expect(validateMedicalFile({ name: 'a.webm', type: 'video/webm', size: 1024 }).ok).toBe(true);
  });

  it('rejects unsupported MIME types (e.g. executables)', () => {
    const result = validateMedicalFile({ name: 'evil.exe', type: 'application/x-msdownload', size: 1024 });
    expect(result.ok).toBe(false);
    if ('message' in result) expect(result.message).toContain('نوع الملف غير مدعوم');
  });

  it('rejects a type/extension mismatch attempt for unsupported extensions', () => {
    const result = validateMedicalFile({ name: 'shell.php', type: 'application/pdf', size: 1024 });
    expect(result.ok).toBe(false);
  });

  it('rejects empty files', () => {
    const result = validateMedicalFile({ name: 'x.png', type: 'image/png', size: 0 });
    expect(result.ok).toBe(false);
  });

  it('enforces per-type size limits (images tighter than video/DICOM)', () => {
    const overImage = validateMedicalFile({ name: 'x.png', type: 'image/png', size: getMedicalSizeLimit('image') + 1 });
    expect(overImage.ok).toBe(false);

    const okVideo = validateMedicalFile({ name: 'x.mp4', type: 'video/mp4', size: getMedicalSizeLimit('image') + 1 });
    expect(okVideo.ok).toBe(true); // video limit is larger than image limit

    const overVideo = validateMedicalFile({ name: 'x.mp4', type: 'video/mp4', size: getMedicalSizeLimit('video') + 1 });
    expect(overVideo.ok).toBe(false);
  });

  it('builds tenant-isolated random storage paths (never the original filename)', () => {
    const p1 = buildMedicalFileStoragePath('clinic-1', 'patient-1', '.pdf');
    const p2 = buildMedicalFileStoragePath('clinic-1', 'patient-1', '.pdf');
    expect(p1.startsWith('medical/clinic-1/patient-1/')).toBe(true);
    expect(p1.endsWith('.pdf')).toBe(true);
    expect(p1).not.toBe(p2); // random UUID key
    expect(p1).not.toContain('original');
  });
});
it('magicBytesMatch: true for a valid PDF header, false for a spoofed one', () => {
    expect(magicBytesMatch('application/pdf', '25504446')).toBe(true); // %PDF
    expect(magicBytesMatch('application/pdf', '89504e470d0a1a0a')).toBe(false); // PNG header under PDF MIME
  });

  it('magicBytesMatch: DICM prefix for DICOM, JPEG ffd8 prefix', () => {
    expect(magicBytesMatch('application/dicom', '4449434d')).toBe(true); // DICM
    expect(magicBytesMatch('image/jpeg', 'ffd8ff')).toBe(true);
    expect(magicBytesMatch('image/jpeg', '89504e470d0a1a0a')).toBe(false);
  });

  it('magicBytesMatch: absent magic is NOT a blocker (unknown-but-allowed)', () => {
    expect(magicBytesMatch('application/pdf', null)).toBe(true);
    expect(magicBytesMatch('video/mp4', undefined)).toBe(true);
  });

  it('size limits are configurable via env override', () => {
    const previous = process.env.MEDICAL_MAX_MEDICAL_IMAGE_BYTES;
    process.env.MEDICAL_MAX_MEDICAL_IMAGE_BYTES = '5368709120'; // 5 GiB override
    expect(getAllMedicalSizeLimits().medical_image).toBe(5368709120);
    if (previous === undefined) delete process.env.MEDICAL_MAX_MEDICAL_IMAGE_BYTES;
    else process.env.MEDICAL_MAX_MEDICAL_IMAGE_BYTES = previous;
  });

  it('DICOM medical_image default ceiling is large (>= 1 GiB) for radiology studies', () => {
    expect(getMedicalSizeLimit('medical_image')).toBeGreaterThanOrEqual(1024 * 1024 * 1024);
    expect(getMedicalSizeLimit('video')).toBeGreaterThanOrEqual(256 * 1024 * 1024);
  });