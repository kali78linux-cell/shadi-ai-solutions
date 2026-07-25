import { describe, it, expect } from 'vitest'
import fs from 'fs'
import path from 'path'
import { extractTextFromBuffer, chunkText } from '../../lib/ai/docParser'

describe('docParser', () => {
  it('parses plain text file and chunks', async () => {
    const fixture = fs.readFileSync(path.resolve(__dirname, '../fixtures/dental_services.txt'))
    const text = await extractTextFromBuffer(fixture, 'dental_services.txt')
    expect(text.length).toBeGreaterThan(10)

    const chunks = chunkText(text, 100, 20)
    expect(Array.isArray(chunks)).toBe(true)
    expect(chunks.join('')).toContain('Root Canal')
  })

  it('returns one chunk for text shorter than the default chunk size', () => {
    expect(chunkText('short text')).toEqual(['short text'])
  })
})
