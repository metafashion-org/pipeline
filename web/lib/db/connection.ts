/**
 * Reads and percent-decodes the password out of a Postgres connection string.
 * The `postgres` library sends the password component undecoded, so a password containing a reserved URL character such as "@" fails authentication unless it is decoded and passed as an explicit override.
 * Input: the connection string, possibly empty. Output: the decoded password, or undefined when there is none. Throws a configuration error when the string is not a valid URL, instead of a bare URL parse error at module load.
 */
export function parseConnectionPassword(value: string): string | undefined {
  if (!value) return undefined;
  try {
    return decodeURIComponent(new URL(value).password) || undefined;
  } catch {
    throw new Error("DATABASE_URL is not a valid connection string URL");
  }
}
