// Mock pdf-parse to prevent memory exhaustion during tests
export default async (buffer: Buffer) => {
  // Return mock PDF content instead of actually parsing
  // This prevents memory issues while maintaining test functionality
  return {
    text: 'BrightSmile Dental Clinic - Emergency Visits Available\nRoot Canal Treatment\nSame-Day Emergency Service',
    numpages: 1,
    info: {},
  };
};
