/** Only the canonical token path on this application's exact origin is ours.
 * Historical external URLs still require an exact database alias. */
export function managedImagePublicToken(rawUrl: string, appUrl: string): string | null {
  try {
    const base = new URL(appUrl);
    if (!/^https?:\/\//.test(rawUrl)) return null;
    const source = new URL(rawUrl);
    const prefix = `${base.pathname.replace(/\/+$/, "")}/media/images/`;
    // Go's URL.String may retain legal host casing and an explicit default
    // port. Normalize the authority for comparison, but require the original
    // path itself to be canonical (no dot segments, userinfo or extra suffix).
    const literalPath = rawUrl.match(/^https?:\/\/[^/@?#\\]+(\/[^?#]*)$/)?.[1];
    if (source.origin !== base.origin || source.search || source.hash || source.username || source.password
      || !source.pathname.startsWith(prefix) || !/^[0-9a-f]{64}$/.test(source.pathname.slice(prefix.length))
      || literalPath !== source.pathname) return null;
    return source.pathname.slice(prefix.length);
  } catch { return null; }
}

/** Keep registered images on the internal Next fetch path, including when the
 * public APP_URL resolves to a private address behind a reverse proxy. */
export function managedImageOptimizerRewrite(requestUrl: string, appUrl: string): URL | null {
  try {
    const request = new URL(requestUrl);
    const sources = request.searchParams.getAll("url");
    if (sources.length !== 1 || !managedImagePublicToken(sources[0], appUrl)) return null;
    const source = new URL(sources[0]);
    request.searchParams.set("url", source.pathname);
    return request;
  } catch { return null; }
}
