import type { DoctorPublicProfile } from '@/lib/services/doctorPublicProfile';

/**
 * PP-8C — schema.org JSON-LD baseline (spec §10.1): Physician inside a
 * Dentist (MedicalBusiness) node. Built ONLY from the allow-listed public
 * projection — no private data can reach structured data. Contact details
 * and prices follow the same opt-in flags as the visible page.
 *
 * Standalone module: Next.js page files may not export arbitrary helpers.
 */

const JSON_LD_DAY_NAMES = [
  'Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday',
];

export function buildDoctorJsonLd(profile: DoctorPublicProfile): Record<string, unknown> {
  const clinicRef = `${profile.clinic.pageUrl}#clinic`;

  const clinicNode: Record<string, unknown> = {
    '@type': 'Dentist',
    '@id': clinicRef,
    name: profile.clinic.name,
    url: profile.clinic.pageUrl,
  };
  if (profile.clinic.city || profile.clinic.area || profile.clinic.address) {
    clinicNode.address = {
      '@type': 'PostalAddress',
      ...(profile.clinic.city ? { addressLocality: profile.clinic.city } : {}),
      ...(profile.clinic.area ? { addressRegion: profile.clinic.area } : {}),
      ...(profile.clinic.address ? { streetAddress: profile.clinic.address } : {}),
    };
  }
  if (profile.clinic.phone) clinicNode.telephone = profile.clinic.phone;
  if (profile.workingHours.length > 0) {
    clinicNode.openingHoursSpecification = profile.workingHours.map((h) => ({
      '@type': 'OpeningHoursSpecification',
      dayOfWeek: JSON_LD_DAY_NAMES[h.weekday] ?? 'Monday',
      opens: h.start_time,
      closes: h.end_time,
    }));
  }
  if (profile.services.length > 0) {
    clinicNode.makesOffer = profile.services.map((s) => ({
      '@type': 'Offer',
      itemOffered: { '@type': 'Service', name: s.name },
    }));
  }

  const physicianNode: Record<string, unknown> = {
    '@type': 'Physician',
    name: profile.name,
    url: profile.pageUrl,
    worksFor: { '@id': clinicRef },
  };
  if (profile.photo_url) physicianNode.image = profile.photo_url;
  if (profile.specialty) physicianNode.medicalSpecialty = profile.specialty;

  return { '@context': 'https://schema.org', '@graph': [physicianNode, clinicNode] };
}
