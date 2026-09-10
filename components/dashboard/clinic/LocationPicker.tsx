'use client';

import { useCallback, useState } from 'react';
import LocationMap from './LocationMap';

/** LOCATION PICKER — geolocation + reverse geocoding + map + manual fallback. */

export type LocationValue = {
  latitude: string;
  longitude: string;
  city: string;
  area: string;
  address: string;
  address_detail: string;
};

export default function LocationPicker({
  value,
  onChange,
}: {
  value: LocationValue;
  onChange: (next: LocationValue) => void;
}) {
  const [detecting, setDetecting] = useState(false);
  const [geoError, setGeoError] = useState<string | null>(null);
  const [geocoding, setGeocoding] = useState(false);
  const [mapVersion, setMapVersion] = useState(0);
  const hasCoords = value.latitude !== '' && value.longitude !== '';

  const lat = Number(value.latitude) || 32.2211;
  const lng = Number(value.longitude) || 35.2544;

  const setCoords = useCallback(
    (c: { lat: number; lng: number }) => {
      onChange({ ...value, latitude: String(c.lat.toFixed(6)), longitude: String(c.lng.toFixed(6)) });
      setMapVersion((v) => v + 1);
    },
    [onChange, value]
  );

  const reverseGeocode = useCallback(
    async (c: { lat: number; lng: number }) => {
      setGeocoding(true);
      setGeoError(null);
      try {
        const res = await fetch(`https://nominatim.openstreetmap.org/reverse?lat=${c.lat}&lon=${c.lng}&format=jsonv2&accept-language=ar`, { headers: { Accept: 'application/json' } });
        if (!res.ok) throw new Error('http ' + res.status);
        const j = await res.json();
        const a = j?.address ?? {};
        const city = a.city ?? a.town ?? a.village ?? a.municipality ?? '';
        const area = a.suburb ?? a.neighbourhood ?? a.city_district ?? '';
        const street = [a.road, a.house_number].filter(Boolean).join(' ');
        onChange({
          ...value,
          latitude: String(c.lat.toFixed(6)),
          longitude: String(c.lng.toFixed(6)),
          city: city || value.city,
          area: area || value.area,
          address: street || value.address,
          address_detail: (typeof j?.display_name === 'string' ? j.display_name : '') || value.address_detail,
        });
        setMapVersion((v) => v + 1);
      } catch {
        setGeoError('تعذر تحويل الإحداثيات إلى عنوان — أكمل العنوان يدويًا.');
      } finally {
        setGeocoding(false);
      }
    },
    [onChange, value]
  );
const detectMyLocation = useCallback(() => {
    setGeoError(null);
    if (!('geolocation' in navigator)) {
      setGeoError('متصفحك لا يدعم تحديد الموقع تلقائيًا — أدخل العنوان يدويًا أو حدّده على الخريطة.');
      return;
    }
    setDetecting(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setDetecting(false);
        const c = { lat: pos.coords.latitude, lng: pos.coords.longitude };
        setCoords(c);
        void reverseGeocode(c);
      },
      (err) => {
        setDetecting(false);
        setGeoError(
          err.code === err.PERMISSION_DENIED
            ? 'تم رفض إذن الموقع — أدخل العنوان يدويًا أو حدّده على الخريطة.'
            : 'تعذر تحديد الموقع تلقائيًا — أدخل العنوان يدويًا أو حدّده على الخريطة.'
        );
      },
      { enableHighAccuracy: true, timeout: 10_000, maximumAge: 30_000 }
    );
  }, [reverseGeocode, setCoords]);

  const geocodeAddress = useCallback(async () => {
    const q = [value.address, value.area, value.city].filter(Boolean).join(', ');
    if (!q) return;
    setGeocoding(true);
    setGeoError(null);
    try {
      const res = await fetch(`https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(q)}&format=jsonv2&limit=1&accept-language=ar`);
      const arr = await res.json();
      if (!Array.isArray(arr) || arr.length === 0) {
        setGeoError('تعذر العثور على العنوان — حدّده على الخريطة يدويًا.');
        return;
      }
      setCoords({ lat: Number(arr[0].lat), lng: Number(arr[0].lon) });
    } catch {
      setGeoError('تعذر تحويل العنوان إلى إحداثيات — حدّده على الخريطة يدويًا.');
    } finally {
      setGeocoding(false);
    }
  }, [value.address, value.area, value.city, setCoords]);

  return (
    <div className="rounded-2xl border border-slate-800 bg-slate-950/60 p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm font-semibold text-white">موقع المؤسسة</p>
        <button
          type="button"
          onClick={detectMyLocation}
          disabled={detecting || geocoding}
          className="inline-flex items-center gap-2 rounded-full bg-cyan-500 px-4 py-2 text-xs font-bold text-slate-950 transition hover:bg-cyan-400 disabled:opacity-50"
        >
          {detecting ? 'جارٍ تحديد موقعك…' : '📍 تحديد موقعي تلقائيًا'}
        </button>
      </div>

      {geoError && <p className="mt-3 rounded-xl border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-200">{geoError}</p>}
      {geocoding && <p className="mt-3 text-xs text-cyan-300">جارٍ تحويل العنوان…</p>}

      {hasCoords && (
        <div className="mt-4 overflow-hidden rounded-2xl border border-slate-800">
          <LocationMap key={mapVersion} lat={lat} lng={lng} onPick={(c) => setCoords(c)} />
        </div>
      )}

      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <Field label="المدينة" value={value.city} onChange={(v) => onChange({ ...value, city: v })} />
        <Field label="المنطقة/الحي" value={value.area} onChange={(v) => onChange({ ...value, area: v })} />
        <Field label="الشارع" value={value.address} onChange={(v) => onChange({ ...value, address: v })} />
        <Field label="وصف العنوان" value={value.address_detail} onChange={(v) => onChange({ ...value, address_detail: v })} />
      </div>

      {hasCoords ? (
        <button type="button" onClick={() => void geocodeAddress()} className="mt-3 rounded-full border border-slate-700 px-4 py-1.5 text-xs font-semibold text-slate-200 transition hover:border-cyan-500/70">
          تحديث الإحداثيات من العنوان
        </button>
      ) : (
        <p className="mt-3 text-xs text-slate-500">لم يُحدد الموقع بعد — استخدم «تحديد موقعي تلقائيًا» أو أدخل العنوان يدويًا.</p>
      )}
    </div>
  );
}

function Field({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <label className="block">
      <span className="text-xs text-slate-400">{label}</span>
      <input value={value} onChange={(e) => onChange(e.target.value)} className="mt-1 w-full rounded-2xl border border-slate-800 bg-slate-900 px-4 py-3 text-slate-100" />
    </label>
  );
}