import { ClinicAISettings, Message } from '@/types/db';
import { RetrievalResult } from '@/lib/services/knowledge/retrieval';

type HistoryMessage = Pick<Message, 'role' | 'content'>;

const DEFAULT_PROMPT_TEMPLATE = `You are a helpful AI assistant for a dental clinic. Your name is {assistant_name}.
Your tone should be {tone}.
You must respond in {language}.

Answer the user's question based ONLY on the following information.
If the information to answer the question is not in the context, say "I'm sorry, I don't have that information." and do not add any other details.
Be concise and professional.

{history}

Context:
---
{context}
---

Question: {question}`;

/**
 * Builds a RAG prompt using a template, retrieved context, and user query.
 * @param settings The clinic's AI settings.
 * @param question The user's original question.
 * @param history The recent conversation history.
 * @param rankedContext The ranked and filtered context chunks from the retrieval service.
 * @returns The final prompt string.
 */
export function buildPrompt(settings: ClinicAISettings | null, question: string, history: HistoryMessage[], rankedContext: RetrievalResult[]): string {
  const assistantName = settings?.assistant_name || 'AI Assistant';
  const tone = settings?.tone || 'professional and friendly';
  const language = settings?.language || 'the user\'s language';

  // Build context string with source citations
  const context = rankedContext
    .map(chunk => `[Source: ${chunk.document?.original_filename || 'knowledge base'}, ID: ${chunk.document_id}, Chunk: ${chunk.chunk_index}]\n${chunk.content}`)
    .join('\n\n');

  const historyString = history.length > 0
    ? 'Here is the recent conversation history:\n' + history.map(msg => `${msg.role === 'patient' ? 'User' : 'Assistant'}: ${msg.content}`).join('\n')
    : '';

  // Hallucination Prevention: If no relevant context is found, instruct the AI to admit it.
  if (!context.trim()) {
    // If no context is found, pass the question through with a basic instruction.
    let fallbackPrompt = `You are a helpful assistant for a dental clinic named {assistant_name}.
Your tone should be {tone}.
You must respond in {language}.
{history}
Answer the user's question. If you don't know the answer, say "I'm sorry, I don't have that information."

Question: {question}`;
    fallbackPrompt = fallbackPrompt.replace('{assistant_name}', assistantName);
    fallbackPrompt = fallbackPrompt.replace('{tone}', tone);
    fallbackPrompt = fallbackPrompt.replace('{language}', language);
    fallbackPrompt = fallbackPrompt.replace('{history}', historyString);
    fallbackPrompt = fallbackPrompt.replace('{question}', question);
    return fallbackPrompt;
  }

  let prompt = DEFAULT_PROMPT_TEMPLATE;
  prompt = prompt.replace('{assistant_name}', assistantName);
  prompt = prompt.replace('{tone}', tone);
  prompt = prompt.replace('{language}', language);
  prompt = prompt.replace('{history}', historyString);
  prompt = prompt.replace('{context}', context);
  prompt = prompt.replace('{question}', question);

  return prompt;
}