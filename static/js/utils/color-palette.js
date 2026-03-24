// SPDX-License-Identifier: AGPL-3.0-or-later
// 16 distinct colors for CAN ID visual grouping
export const PALETTE = [
  '#58a6ff', // blue
  '#3fb950', // green
  '#f78166', // salmon
  '#d2a8ff', // lavender
  '#ffa657', // orange
  '#79c0ff', // sky blue
  '#56d364', // lime
  '#ff7b72', // red-orange
  '#d29922', // amber
  '#bc8cff', // purple
  '#39c5cf', // cyan
  '#f0883e', // burnt orange
  '#a5d6ff', // light blue
  '#7ee787', // light green
  '#e3b341', // gold
  '#ff9898', // pink
];

// Cache: can_id -> color
const _cache = new Map();

export function getColor(canId) {
  if (_cache.has(canId)) return _cache.get(canId);
  const color = PALETTE[canId % PALETTE.length];
  _cache.set(canId, color);
  return color;
}
