// Mock jszip to avoid hanging on DOCX parsing
export default class MockJSZip {
  static loadAsync = async (buffer: Buffer) => {
    // Return a mock zip that will fail, causing fallback to mammoth
    throw new Error('JSZip mocked - use mammoth fallback');
  };

  files = {};
}
