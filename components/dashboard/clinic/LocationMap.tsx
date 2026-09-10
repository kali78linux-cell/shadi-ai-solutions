'use client';

import { useCallback, useState } from 'react';

/**
 * Interactive OpenStreetMap (Leaflet via CDN — no npm dependency).
 * Click-to-move marker + draggable marker. Isolated so the main bundle and
 * SSR are unaffected; the map loads only when rendered (inside the picker).
 */
export default function LocationMap({
  lat,
  lng,
  onPick,
}: {
  lat: number;
  lng: number;
  onPick: (c: { lat: number; lng: number }) => void;
}) {
  const [ready, setReady] = useState(false);

  // Load Leaflet CSS/JS once per page.
  if (typeof window !== 'undefined') {
    const w = window as unknown as { __leafletLoading?: boolean; L?: unknown };
    if (!w.L && !w.__leafletLoading) {
      w.__leafletLoading = true;
      const css = document.createElement('link');
      css.rel = 'stylesheet';
      css.href = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css';
      document.head.appendChild(css);
      const js = document.createElement('script');
      js.src = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js';
      js.onload = () => setReady(true);
      js.onerror = () => {
        (window as unknown as { __leafletLoading?: boolean }).__leafletLoading = false;
      };
      document.head.appendChild(js);
    } else if (w.L) {
      if (!ready) setReady(true);
    }
  }

  const initRef = useCallback(
    (el: HTMLDivElement | null) => {
      if (!el || !ready) return;
      const w = window as unknown as { L?: any };
      if (!w.L || (el as any).__mapInit) return;
      (el as any).__mapInit = true;
      const map = w.L.map(el).setView([lat, lng], 15);
      w.L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { attribution: '© OpenStreetMap' }).addTo(map);
      const marker = w.L.marker([lat, lng], { draggable: true }).addTo(map);
      marker.on('dragend', () => {
        const p = marker.getLatLng();
        onPick({ lat: p.lat, lng: p.lng });
      });
      map.on('click', (e: any) => {
        marker.setLatLng(e.latlng);
        onPick({ lat: e.latlng.lat, lng: e.latlng.lng });
      });
    },
    [ready, lat, lng, onPick]
  );

  return (
    <div>
      <div ref={initRef} style={{ height: 280, width: '100%' }} />
      <p className="bg-slate-900 px-3 py-1.5 text-[10px] text-slate-500">اضغط على الخريطة أو اسحب العلامة لضبط الموقع بدقة.</p>
    </div>
  );
}