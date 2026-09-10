import type { MetadataRoute } from 'next';
import { getAppBaseUrl } from '@/lib/communications/links';
import { getPublicProfileSeoEntries } from '@/lib/services/doctorPublicProfile';
import { getActivitySpaceEntries } from '@/lib/services/activityPublicSpace';

/**
 * PP-8C / Digital Healthcare Space — sitemap.xml.
 *
 * Contains ONLY indexable public surfaces:
 *   - landing page
 *   - doctor public profiles (visibility = indexable, PP-8B)
 *   - activity public spaces (/{slug}) that are discovery-opted-in and
 *     subscribed (Phase C generalization — clinic / imaging / dental lab)
 *
 * Legacy `/c/{slug}` is deliberately NOT listed (it is noindex + canonical to
 * /{slug} since Phase E). Private/noindex surfaces never appear (AC-8).
 */
export const dynamic = 'force-dynamic';

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const base = getAppBaseUrl();

  const entries: MetadataRoute.Sitemap = [
    { url: `${base}/`, changeFrequency: 'weekly', priority: 1 },
  ];

  for (const entry of await getPublicProfileSeoEntries()) {
    entries.push({
      url: `${base}/d/${encodeURIComponent(entry.slug)}`,
      lastModified: entry.lastModified ?? undefined,
      changeFrequency: 'monthly',
      priority: 0.8,
    });
  }

  for (const space of await getActivitySpaceEntries()) {
    entries.push({
      url: `${base}/${encodeURIComponent(space.slug)}`,
      changeFrequency: 'monthly',
      priority: 0.8,
    });
  }

  return entries;
}
