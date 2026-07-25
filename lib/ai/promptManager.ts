import { ClinicAISettings } from '@/types/db';

export function buildPrompt(settings: Partial<ClinicAISettings> | null, query: string, context: Array<any> = []) {
  const assistantName = settings?.assistant_name || 'Receptionist AI';
  const tone = settings?.tone || 'helpful';
  const language = settings?.language || 'en';
  const greeting = settings?.greeting || '';

  const system = `You are ${assistantName}. Speak in ${language} with a ${tone} tone. Follow clinic-approved knowledge and do not provide diagnoses. When unsure, recommend professional consultation.`;

  const contextText = context
    .map((c: any) => {
      if (c.structured_data) return JSON.stringify(c.structured_data);
      return `${c.title || ''}\n${c.content || ''}`;
    })
    .join('\n\n---\n\n');

  const prompt = [system, greeting, contextText, `User question: ${query}`].filter(Boolean).join('\n\n');
  return prompt;
}
