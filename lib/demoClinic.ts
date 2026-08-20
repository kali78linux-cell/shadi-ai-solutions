// Shared helper for resolving the active demo clinic across dashboard pages.
// The user can switch between 4 demo clinics; the selection is stored in localStorage.

export const DEMO_CLINICS = [
  { id: 'c92da4ab-9a27-a35c-ec35-f511c0110811', slug: 'demo-dental-clinic', name: 'Demo Dental Clinic' },
  { id: 'dd9fffaa-1d42-e0c1-8917-0e96378f2e92', slug: 'smile-care-dental-center', name: 'Smile Care Dental Center' },
  { id: '1b60de66-1290-77c7-7e5b-fadf42434e7b', slug: 'bright-teeth-clinic', name: 'Bright Teeth Clinic' },
  { id: '16d269d4-0ac8-8881-ace9-33b1e0a749a3', slug: 'noura-dental-imaging', name: 'Noura Dental & Imaging Center' },
];

const STORAGE_KEY = 'dentalai_demo_clinic_id';

export function isDemoSession(): boolean {
  if (typeof window === 'undefined') return false;
  return localStorage.getItem('dentalai_demo_session') === 'true' || localStorage.getItem('dentalai_demo_session') === '1';
}

export function getDemoClinicId(): string {
  if (typeof window === 'undefined') return DEMO_CLINICS[0].id;
  const saved = localStorage.getItem(STORAGE_KEY);
  if (saved && DEMO_CLINICS.some((c) => c.id === saved)) return saved;
  return DEMO_CLINICS[0].id;
}

export function setDemoClinicId(id: string): void {
  if (typeof window === 'undefined') return;
  if (DEMO_CLINICS.some((c) => c.id === id)) {
    localStorage.setItem(STORAGE_KEY, id);
  }
}

export function demoHeaders(): Record<string, string> {
  if (isDemoSession()) {
    return { 'x-demo-session': 'true' };
  }
  return {};
}