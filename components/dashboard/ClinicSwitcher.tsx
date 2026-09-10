'use client';

import { useClinicContext } from '@/lib/useClinicContext';

export default function ClinicSwitcher() {
  const { memberships, clinicId, clinicName, setActiveClinicId, loading } = useClinicContext();

  if (loading) return null;
  if (memberships.length === 0) return null;

  return (
    <div className="flex items-center gap-2 rounded-full border border-slate-800 bg-slate-950/80 px-4 py-2">
      <span className="text-xs text-slate-400">المؤسسة:</span>
      <select
        value={clinicId ?? ''}
        onChange={(e) => {
          void setActiveClinicId(e.target.value);
          window.location.reload();
        }}
        className="rounded-full border border-slate-800 bg-slate-950 px-3 py-1 text-sm text-slate-100"
      >
        {memberships.map((m) => (
          <option key={m.clinic_id} value={m.clinic_id}>
            {m.clinic?.name ?? m.clinic_id}
          </option>
        ))}
      </select>
      {clinicName && <span className="hidden text-xs text-slate-500 sm:inline">{clinicName}</span>}
    </div>
  );
}