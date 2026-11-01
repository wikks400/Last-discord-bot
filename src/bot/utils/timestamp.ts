/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Robust timestamp parser supporting OpenSea ISO strings, numeric timestamp strings, and unix numbers
 */
export function parseEventTimestamp(rawTime: string | number | undefined | null): { iso: string; unix: number } {
  if (!rawTime) {
    const now = Math.floor(Date.now() / 1000);
    return { iso: new Date(now * 1000).toISOString(), unix: now };
  }

  // Handle numeric strings like "1793228537.0" or numbers like 1793228537
  const num = typeof rawTime === 'number' ? rawTime : Number(rawTime);
  if (!isNaN(num) && num > 0) {
    const unix = num > 1e11 ? Math.floor(num / 1000) : Math.floor(num);
    const dateObj = new Date(unix * 1000);
    return {
      iso: isNaN(dateObj.getTime()) ? new Date().toISOString() : dateObj.toISOString(),
      unix,
    };
  }

  // Handle standard ISO date strings like "2026-10-28T19:20:00Z"
  const parsed = Date.parse(String(rawTime));
  if (!isNaN(parsed)) {
    const unix = Math.floor(parsed / 1000);
    return {
      iso: new Date(parsed).toISOString(),
      unix,
    };
  }

  const fallback = Math.floor(Date.now() / 1000);
  return { iso: new Date(fallback * 1000).toISOString(), unix: fallback };
}
