/**
 * Reads a displayable message from a value caught in a catch block.
 * Input: the caught value, and the text to use when that value is not an Error. Output: the error's message, or the fallback.
 */
export function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}
