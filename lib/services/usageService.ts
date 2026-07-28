import { supabase } from '@/lib/supabase';

export type ClinicUsageSummary = {
  clinicId: string;
  dateRange: { from: string; to: string };
  totalMessages: number;
  totalTokens: number;
  totalEstimatedCost: number;
};

/**
 * Retrieves a summary of AI usage for a specific clinic within a date range.
 * @param clinicId The ID of the clinic.
 * @param from The start date of the range (ISO string).
 * @param to The end date of the range (ISO string).
 * @returns A summary of the clinic's AI usage.
 */
export async function getClinicUsageSummary(clinicId: string, from: string, to: string): Promise<ClinicUsageSummary> {
  // Fetch total AI-generated messages
  const { count: messageCount, error: messageError } = await supabase
    .from('messages')
    .select('*', { count: 'exact', head: true })
    .eq('clinic_id', clinicId)
    .eq('role', 'assistant')
    .gte('created_at', from)
    .lte('created_at', to);

  if (messageError) throw messageError;

  // Fetch aggregated token and cost data
  const { data: usageData, error: usageError } = await supabase
    .from('ai_usage')
    .select('total_tokens, estimated_cost')
    .eq('clinic_id', clinicId)
    .gte('created_at', from)
    .lte('created_at', to);

  if (usageError) throw usageError;

  const totalTokens = usageData.reduce((sum, row) => sum + (row.total_tokens || 0), 0);
  const totalEstimatedCost = usageData.reduce((sum, row) => sum + (row.estimated_cost || 0), 0);

  return { clinicId, dateRange: { from, to }, totalMessages: messageCount ?? 0, totalTokens, totalEstimatedCost };
}