import { requireSupabaseConfig } from '@/lib/config';
import { supabaseAdmin } from '@/lib/supabase/admin';

export async function bootstrapSupabase() {
  requireSupabaseConfig();

  const { error } = await supabaseAdmin.from('appointments').select('id').limit(1);

  if (error) {
    throw new Error(
      `Supabase data access failed. تأكد من أن إعدادات Supabase صحيحة ومفاتيح الخدمة تعمل. ${error.message}`
    );
  }

  return {
    message: 'تم التحقق من إعداد Supabase بنجاح. يمكن الوصول إلى جدول المواعيد.',
  };
}
