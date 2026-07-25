import { describe, it, expect } from 'vitest';
import { buildPrompt } from '../../lib/ai/promptManager';
import { ClinicAISettings } from '../../types/db';

describe('Prompt Manager', () => {
  const mockSettings: ClinicAISettings = {
    id: 'settings-1',
    clinic_id: 'clinic-1',
    assistant_name: 'ClinicBot',
    tone: 'very formal',
    language: 'formal English',
    created_at: '',
    updated_at: '',
  };

  const mockHistory = [
    { role: 'patient' as const, content: 'Do you accept Cigna?' },
    { role: 'assistant' as const, content: 'Yes, we do accept Cigna PPO.' },
  ];

  const mockContext = [
    { id: 'chunk-1', content: 'We are in-network with Cigna PPO.', similarity: 0.9 },
  ];

  it('should build a full RAG prompt with history, settings, and context', () => {
    const question = 'Great, what about Aetna?';
    const prompt = buildPrompt(mockSettings, question, mockHistory, mockContext);

    // Check for all components
    expect(prompt).toContain('Your name is ClinicBot');
    expect(prompt).toContain('Your tone should be very formal');
    expect(prompt).toContain('You must respond in formal English');
    expect(prompt).toContain('User: Do you accept Cigna?');
    expect(prompt).toContain('Assistant: Yes, we do accept Cigna PPO.');
    expect(prompt).toContain('Context:\n---\nWe are in-network with Cigna PPO.');
    expect(prompt).toContain('Question: Great, what about Aetna?');
  });

  it('should build a fallback prompt when no context is provided', () => {
    const question = 'What are your hours?';
    const prompt = buildPrompt(mockSettings, question, [], []); // No history, no context

    expect(prompt).not.toContain('Context:');
    expect(prompt).toContain('Your name is ClinicBot');
    expect(prompt).toContain('Answer the user\'s question.');
    expect(prompt).toContain('Question: What are your hours?');
  });

  it('should use default settings if none are provided', () => {
    const question = 'Hi';
    const prompt = buildPrompt(null, question, [], []);

    expect(prompt).toContain('Your name is AI Assistant');
    expect(prompt).toContain('Your tone should be professional and friendly');
    expect(prompt).toContain('You must respond in the user\'s language');
  });
});