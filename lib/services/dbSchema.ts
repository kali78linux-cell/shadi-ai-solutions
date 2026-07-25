import { supabaseAdmin } from '@/lib/supabase/admin';

export async function migrateDatabaseSchema() {
  const schemaSql = await import('fs/promises').then((fs) =>
    fs.readFile(new URL('../../db/schema.sql', import.meta.url), 'utf8')
  );

  const { data, error } = await supabaseAdmin.rpc('sql', {
    sql: schemaSql,
  } as any);

  if (error) {
    throw new Error(`Schema migration failed: ${error.message}`);
  }

  return data;
}
