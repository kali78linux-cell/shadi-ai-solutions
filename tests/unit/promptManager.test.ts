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
    { id: 'chunk-1', document_id: 'doc-1', chunk_index: 0, content: 'We are in-network with Cigna PPO.', similarity: 0.9, type: 'unstructured' as const, document: { id: 'doc-1', original_filename: 'faq.txt', file_type: 'text', mime_type: 'text/plain' } },
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
    expect(prompt).toContain('Context:\n---\n[Source: faq.txt, ID: doc-1, Chunk: 0]\nWe are in-network with Cigna PPO.');
    expect(prompt).toContain('Question: Great, what about Aetna?');
  });

  it('should build a fallback prompt when no context is provided', () => {
    const question = 'What are your hours?';
    const prompt = buildPrompt(mockSettings, question, [], []); // No history, no context

    expect(prompt).not.toContain('Context:');
    expect(prompt).toContain('a dental clinic named ClinicBot');
    // The fallback still instructs the AI to answer naturally while including
    // the general dental knowledge section (Layer 1) and clinic-fact honesty.
    expect(prompt).toContain('General Dental Knowledge');
    expect(prompt).toContain('final assessment must be by a dentist after an examination');
    expect(prompt).toContain('Question: What are your hours?');
  });

  it('should use default settings if none are provided', () => {
    const question = 'Hi';
    const prompt = buildPrompt(null, question, [], []);

    expect(prompt).toContain('a dental clinic named AI Assistant');
    expect(prompt).toContain('Your tone should be professional and friendly');
    expect(prompt).toContain('You must respond in the user\'s language');
  });

  it('should include clinic info, safety rules, and handoff conditions when provided', () => {
    const question = 'Do you accept insurance?';
    const prompt = buildPrompt(mockSettings, question, [], mockContext, undefined, {
      clinicInfo: {
        name: 'Smile Dental Clinic',
        address: '123 Main St',
        phone: '+15551234567',
        website: 'https://smiledental.example.com',
      },
      safetyRules: [
        'Never provide a medical diagnosis.',
        'Never prescribe medication.',
      ],
      answerBoundaries: [
        'Only answer using the provided context.',
      ],
      handoffConditions: [
        'Hand off to a human agent if the patient requests emergency care.',
      ],
      intent: 'insurance_inquiry',
      conversationState: 'ai',
      confidenceThreshold: 0.7,
    });

    expect(prompt).toContain('Clinic Information:');
    expect(prompt).toContain('Name: Smile Dental Clinic');
    expect(prompt).toContain('Address: 123 Main St');
    expect(prompt).toContain('Phone: +15551234567');
    expect(prompt).toContain('Website: https://smiledental.example.com');
    expect(prompt).toContain('Medical Safety Rules:');
    expect(prompt).toContain('Never provide a medical diagnosis.');
    expect(prompt).toContain('Never prescribe medication.');
    expect(prompt).toContain('Answer Boundaries:');
    expect(prompt).toContain('Only answer using the provided context.');
    expect(prompt).toContain('Human Handoff Rules:');
    expect(prompt).toContain('Hand off to a human agent if the patient requests emergency care.');
    expect(prompt).toContain('Conversation Intent: insurance_inquiry');
    expect(prompt).toContain('Conversation State: ai');
    expect(prompt).toContain('Source Citation Instructions:');
  });

  it('should include citations with document and chunk metadata', () => {
    const question = 'What is your pricing?';
    const citations = [{
      documentId: 'doc-1',
      filename: 'pricing.txt',
      chunkId: 'chunk-1',
      chunkIndex: 2,
      pageNumber: 3,
      confidenceScore: 0.92,
      content: 'Cleaning costs $100.',
    }];
    const prompt = buildPrompt(mockSettings, question, [], mockContext, citations, {
      confidenceThreshold: 0.7,
    });

    expect(prompt).toContain('[Source: pricing.txt, ID: doc-1, Chunk: 2]');
    expect(prompt).toContain('[Document ID: doc-1, Chunk ID: chunk-1, Page: 3]');
    expect(prompt).toContain('Confidence: 0.92');
    expect(prompt).toContain('We are in-network with Cigna PPO.');
  });

  it('should include patient context when provided', () => {
    const question = 'I need a root canal';
    const prompt = buildPrompt(mockSettings, question, [], mockContext, undefined, {
      patientContext: {
        name: 'Ahmed',
        requestedService: 'Root canal',
        preferredDate: '2026-08-20',
        preferredTime: '10:00',
      },
    });

    expect(prompt).toContain('Patient Context:');
    expect(prompt).toContain('Name: Ahmed');
    expect(prompt).toContain('Requested service: Root canal');
    expect(prompt).toContain('Preferred date: 2026-08-20');
    expect(prompt).toContain('Preferred time: 10:00');
  });

  it('should omit patient context section when no patient data is provided', () => {
    const question = 'What are your hours?';
    const prompt = buildPrompt(mockSettings, question, [], mockContext, undefined, {
      patientContext: {},
    });

    expect(prompt).not.toContain('Patient Context:');
  });
});

describe('Prompt Manager — receptionist grounding (no-hallucination behavior)', () => {
  const settings: ClinicAISettings = { id: 's1', clinic_id: 'c1', assistant_name: 'Bot', tone: 'friendly', language: 'ar', created_at: '', updated_at: '' };

  it('injects the real clinic profile and forbids location inference / invented facts', () => {
    const prompt = buildPrompt(settings, 'وين العيادة؟', [], [], undefined, {
      clinicInfo: { name: 'Demo Dental Clinic', address: 'Demo Street 12, Amman, Jordan', phone: '+970-' },
    });
    expect(prompt).toContain('Name: Demo Dental Clinic');
    expect(prompt).toContain('Address: Demo Street 12, Amman, Jordan');
    expect(prompt).toContain('NEVER infer the clinic location from the patient');
    expect(prompt).toContain('NEVER invent a clinic name/address');
  });

  it('never invents descriptors/adjectives beyond the clinic data', () => {
    const prompt = buildPrompt(settings, 'بدي اعمل زراعة', [], [], undefined, {
      clinicInfo: { name: 'Demo' },
      receptionistState: {
        state: 'RECOMMENDING_PROVIDER',
        recommended_service_id: null,
        recommended_provider_id: null,
        patient_confirmed_booking: false,
        pending_question: '',
        booking: { service_id: null, provider_id: null, slot: null, patient_name: null, phone: null, email: null },
      },
    });
    expect(prompt).toContain('STRICT GROUNDING');
    expect(prompt).toMatch(/متميز/); // the guard explicitly forbids this word
    expect(prompt).toContain('NEVER add descriptive words like');
  });

  it('renders the REAL proposed slot so follow-up "أي ساعة؟" answers are grounded (not invented)', () => {
    const prompt = buildPrompt(settings, 'أي ساعة متوفر؟', [], [], undefined, {
      receptionistState: {
        state: 'AWAITING_BOOKING_CONFIRMATION',
        recommended_service_id: 'svc',
        recommended_provider_id: 'p1',
        patient_confirmed_booking: false,
        pending_question: '',
        booking: { service_id: 'svc', provider_id: 'p1', slot: '2026-09-04T13:30:00.000Z', patient_name: null, phone: null, email: null },
      },
    });
    expect(prompt).toContain('REAL proposed slot');
    expect(prompt).toContain('2026-09-04T13:30:00.000Z');
    expect(prompt).toContain('NEVER invent another slot');
  });
});

describe('Prompt Manager — STEP 4 source separation & anti-hallucination', () => {
  const settings: ClinicAISettings = { id: 's1', clinic_id: 'c1', assistant_name: 'Bot', tone: 'friendly', language: 'ar', created_at: '', updated_at: '' };
  const ctx = [
    { id: 'chunk-1', document_id: 'doc-1', chunk_index: 0, content: 'قائمة الأسعار', similarity: 0.9, type: 'unstructured' as const, document: { id: 'doc-1', original_filename: 'pricing.txt', file_type: 'text', mime_type: 'text/plain' } },
  ];
  const citations = [{
    documentId: 'doc-1', filename: 'pricing.txt', chunkId: 'chunk-1', chunkIndex: 0, pageNumber: null, confidenceScore: 0.4, content: 'قائمة الأسعار',
  }];

describe('Prompt Manager — STEP 5 Network Discovery Mode', () => {
  const settings5: ClinicAISettings = {
    id: 'settings-5',
    clinic_id: 'clinic-1',
    assistant_name: 'مساعد العيادة',
    tone: 'friendly',
    language: 'Arabic',
    created_at: '',
    updated_at: '',
  };

  const baseReceptionState = {
    state: 'RECOMMENDING_PROVIDER' as const,
    recommended_service_id: null,
    recommended_provider_id: null,
    patient_confirmed_booking: false,
    pending_question: '',
    booking: { service_id: null, provider_id: null, slot: null, patient_name: null, phone: null, email: null },
  };

  it('renders the per-turn discovery note ONLY when present (Clinic Reception Mode is the default)', () => {
    const withGuidance = buildPrompt(settings5, 'وين عيادة ثانية؟', [], [], undefined, {
      receptionistState: {
        ...baseReceptionState,
        discovery_guidance: 'Network Discovery Mode (this turn only): REAL directory matches: عيادة النور (نابلس) — 12.3 km.',
      },
    });
    expect(withGuidance).toContain('Network Discovery Mode (this turn only)');
    expect(withGuidance).toContain('عيادة النور');
    expect(withGuidance).toContain('This clinic remains the default');

    const withoutGuidance = buildPrompt(settings5, 'مرحبا', [], [], undefined, {
      receptionistState: { ...baseReceptionState },
    });
    expect(withoutGuidance).not.toContain('Network Discovery Mode');
  });
});

  it('injects the DATA SOURCE SEPARATION directive when context exists', () => {
    const prompt = buildPrompt(settings, 'كم سعر التنظيف؟', [], ctx, citations, { confidenceThreshold: 0.7 });
    expect(prompt).toContain('DATA SOURCE SEPARATION');
    expect(prompt).toContain('ClinicFacts');
    expect(prompt).toContain('OperatingData');
    expect(prompt).toContain('General Dental Knowledge');
    expect(prompt).toContain('patient_location is about the PATIENT');
    expect(prompt).toContain('NEVER calculate availability, timezones, or slots');
  });

  it('injects the no-RAG variant when there is no context', () => {
    const prompt = buildPrompt(settings, 'وين العيادة؟', [], [], undefined, { clinicInfo: { name: 'Demo' } });
    expect(prompt).toContain('DATA SOURCE SEPARATION');
    expect(prompt).toContain('none was retrieved for this turn');
    expect(prompt).toContain('RAG / Clinic Knowledge');
  });

  it('forbids stating low-confidence RAG as a confirmed clinic fact', () => {
    const prompt = buildPrompt(settings, 'كم سعر التنظيف؟', [], ctx, citations, { confidenceThreshold: 0.7 });
    expect(prompt).toContain('Confidence is below the threshold');
    expect(prompt).toContain('must NOT state it as a confirmed clinic fact');
  });

  it('never lets General Dental Knowledge become clinic policy/price/doctor/availability', () => {
    const prompt = buildPrompt(settings, 'بدي زراعة', [], [], undefined, {});
    expect(prompt).toMatch(/General Dental Knowledge: ONLY for educational answers/);
    expect(prompt).toMatch(/final assessment is made by a dentist after an examination/);
  });
});
