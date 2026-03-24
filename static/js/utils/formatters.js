// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * Format a timestamp based on display mode.
 * @param {number} ts - relative elapsed seconds from capture start
 * @param {string} format - 'relative' | 'absolute' | 'delta'
 * @param {number} prevTs - previous message timestamp (for delta)
 * @param {number} absoluteBase - Unix epoch start time
 */
export function fmtTimestamp(ts, format = 'relative', prevTs = 0, absoluteBase = 0) {
  if (format === 'delta') {
    const delta = ts - prevTs;
    return `+${delta.toFixed(4)}`;
  }
  if (format === 'absolute' && absoluteBase) {
    const abs = new Date((absoluteBase + ts) * 1000);
    const hh = abs.getHours().toString().padStart(2, '0');
    const mm = abs.getMinutes().toString().padStart(2, '0');
    const ss = abs.getSeconds().toString().padStart(2, '0');
    const ms = abs.getMilliseconds().toString().padStart(3, '0');
    return `${hh}:${mm}:${ss}.${ms}`;
  }
  // relative: ss.mmm.µµµ
  const secs = Math.floor(ts);
  const frac = ts - secs;
  const ms = Math.floor(frac * 1000).toString().padStart(3, '0');
  const us = Math.floor((frac * 1000000) % 1000).toString().padStart(3, '0');
  return `${secs.toString().padStart(4, ' ')}.${ms}.${us}`;
}

/**
 * Format byte array as hex string.
 * @param {string} hexStr - hex string like 'A1B2C3...'
 * @param {boolean} uppercase
 */
export function fmtHex(hexStr, uppercase = true) {
  if (!hexStr) return '';
  const s = uppercase ? hexStr.toUpperCase() : hexStr.toLowerCase();
  // Add spaces every 2 chars
  return s.replace(/(.{2})/g, '$1 ').trim();
}

/**
 * Format a CAN ID.
 * @param {number|string} id - numeric or hex string
 * @param {boolean} isExtended
 */
export function fmtId(id, isExtended = false) {
  const num = typeof id === 'string' ? parseInt(id, 16) : id;
  if (isExtended) {
    return `0x${num.toString(16).toUpperCase().padStart(8, '0')}`;
  }
  return `0x${num.toString(16).toUpperCase().padStart(3, '0')}`;
}

/**
 * Format byte count to human readable.
 */
export function fmtBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

/**
 * Format duration in seconds to HH:MM:SS.
 */
export function fmtDuration(secs) {
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  const s = Math.floor(secs % 60);
  if (h > 0) return `${h}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

/**
 * Parse an ID filter string into a test function.
 * Supports: '0x1A3', '0x100,0x200', '0x100-0x1FF', '0x7E*'
 */
export function parseIdFilter(filterStr) {
  if (!filterStr || !filterStr.trim()) return null;
  const parts = filterStr.split(',').map(s => s.trim()).filter(Boolean);
  const tests = parts.map(part => {
    if (part.includes('-')) {
      const [lo, hi] = part.split('-').map(s => parseInt(s, 16));
      return id => id >= lo && id <= hi;
    }
    if (part.endsWith('*')) {
      const prefix = part.slice(0, -1).toLowerCase();
      return id => id.toString(16).padStart(8, '0').startsWith(prefix.replace('0x', ''));
    }
    const target = parseInt(part, 16);
    return id => id === target;
  });
  return id => tests.some(t => t(id));
}
