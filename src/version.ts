/** The SDK version is also asserted by the User-Agent header. */
export const VERSION = '1.0.0'
/** Sent as `User-Agent` on every request. */
export const USER_AGENT = `maukirim-node/${VERSION}`
/** Production origin + version prefix. Override with `baseUrl` for a private deployment. */
export const DEFAULT_BASE_URL = 'https://app.maukirim.com/api/v1'
