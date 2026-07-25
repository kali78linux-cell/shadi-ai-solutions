import { bootstrapSupabase } from '@/lib/services/setup';

export const runtime = 'nodejs';

function jsonResponse(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

export async function POST() {
  try {
    const results = await bootstrapSupabase();
    return jsonResponse({ message: 'تم إنشاء الجداول بنجاح.', results });
  } catch (error) {
    return jsonResponse(
      {
        error: error instanceof Error ? error.message : 'حدث خطأ غير متوقع أثناء إنشاء الجداول.',
      },
      500
    );
  }
}
