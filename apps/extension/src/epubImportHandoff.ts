export const EPUB_IMPORT_RESULT = "ambra:epub-import-result";
export const LIBRARY_IMPORT_TOKEN_PARAM = "importToken";

export function httpImportOrigins(urls: readonly string[]): string[] | undefined {
  try {
    const parsed = urls.map((url) => new URL(url));
    if (parsed.some((url) => !["http:", "https:"].includes(url.protocol) || url.username || url.password)) {
      return undefined;
    }
    return [...new Set(parsed.map((url) => `${url.protocol}//${url.hostname}/*`))];
  } catch (error) {
    if (error instanceof TypeError) return undefined;
    throw error;
  }
}

export async function hasImportHostAccess(urls: readonly string[]): Promise<boolean> {
  const origins = httpImportOrigins(urls);
  if (!origins?.length) return false;
  try {
    return await chrome.permissions.contains({ origins });
  } catch (error) {
    // Includes a web preview, an unloaded extension, and permission API failures.
    console.warn("Ambra could not check EPUB host access. The browser download was left unchanged.", error);
    return false;
  }
}
