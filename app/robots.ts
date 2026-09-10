import type { MetadataRoute } from 'next';
import { getAppBaseUrl } from '@/lib/communications/links';

/**
 * PP-8C — robots.txt foundation.
 *
 * Allow public surfaces; disallow authenticated/operational areas. Private
 * doctor profiles resolve to 404 and noindex profiles carry a robots
 * noindex meta — per Google guidance such URLs are NOT blocked here
 * (blocking would prevent crawling the noindex directive).
 * Sitemap points at the indexable-entities-only sitemap (PP-8C).
 */
export default function robots(): MetadataRoute.Robots {
  const base = getAppBaseUrl();
  return {
    rules: [
      {
        userAgent: '*',
        allow: '/',
        disallow: ['/dashboard/', '/portal/', '/api/'],
      },
    ],
    sitemap: `${base}/sitemap.xml`,
  };
}
