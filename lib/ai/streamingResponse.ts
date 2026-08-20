/**
 * A Response subclass that streams text content to the client.
 *
 * This is a lightweight, dependency-free replacement for the `ai` package's
 * `StreamingTextResponse` (which was removed in `ai` v7). It wraps a
 * `ReadableStream` in a standard `Response` so that the streaming API route
 * can return a proper streaming response without depending on the `ai` package
 * for response construction.
 */
export class StreamingTextResponse extends Response {
  constructor(stream: ReadableStream, options?: ResponseInit) {
    super(stream, {
      ...options,
      headers: {
        'Content-Type': 'text/plain; charset=utf-8',
        'Cache-Control': 'no-cache, no-transform',
        'Transfer-Encoding': 'chunked',
        ...(options?.headers ?? {}),
      },
    });
  }
}
