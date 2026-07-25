// Mock mammoth to provide deterministic DOCX parsing
export default {
  extractRawText: async ({ buffer }: { buffer: Buffer }) => {
    // Return mock DOCX content
    return {
      value: 'Emergency Visits Available\nSame-Day Appointments\nDental Care',
      messages: [],
    };
  },
};
