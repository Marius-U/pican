// SPDX-License-Identifier: AGPL-3.0-or-later
import { h } from 'https://esm.sh/preact@10.19.3';
import { useState } from 'https://esm.sh/preact@10.19.3/hooks';
import htm from 'https://esm.sh/htm@3.1.1';
import { FILTER_PRESETS } from '../utils/can-constants.js';

const html = htm.bind(h);

const DEFAULT_FILTER = { enabled: true, id: '0x000', mask: '0x000', ide: 'both', type: 'both' };

export default function FilterConfig({ filters, onChange }) {
  const [showDiagram, setShowDiagram] = useState(false);
  const [example, setExample] = useState({ id: '0x1A3', mask: '0x7FF' });

  function addFilter() {
    onChange([...filters, { ...DEFAULT_FILTER }]);
  }

  function removeFilter(idx) {
    onChange(filters.filter((_, i) => i !== idx));
  }

  function updateFilter(idx, field, val) {
    const updated = filters.map((f, i) => i === idx ? { ...f, [field]: val } : f);
    onChange(updated);
  }

  function applyPreset(preset) {
    onChange([...filters, { ...DEFAULT_FILTER, id: preset.id, mask: preset.mask }]);
  }

  // Interactive filter diagram
  function checkMatch(testId, filterId, filterMask) {
    try {
      const id = parseInt(testId, 16);
      const fid = parseInt(filterId, 16);
      const mask = parseInt(filterMask, 16);
      return (id & mask) === (fid & mask);
    } catch { return false; }
  }

  // Generate first 20 matching IDs for a filter
  function matchingIds(filterId, filterMask) {
    try {
      const fid = parseInt(filterId, 16);
      const mask = parseInt(filterMask, 16);
      const results = [];
      for (let id = 0; id <= 0x7FF && results.length < 20; id++) {
        if ((id & mask) === (fid & mask)) results.push(`0x${id.toString(16).toUpperCase().padStart(3,'0')}`);
      }
      return results;
    } catch { return []; }
  }

  return html`
    <div>
      <div style="display:flex;gap:8px;align-items:center;margin-bottom:8px">
        <select onChange=${e => { if(e.target.value) { applyPreset(JSON.parse(e.target.value)); e.target.value=''; }}}
          style="width:200px">
          <option value="">Add Preset...</option>
          ${FILTER_PRESETS.map(p => html`
            <option value=${JSON.stringify(p)} key=${p.label}>${p.label}</option>
          `)}
        </select>
        <button class="btn btn-sm" onClick=${addFilter}>+ Add Filter</button>
        <div class="flex-spacer"></div>
        <button class="btn btn-sm" onClick=${() => setShowDiagram(s => !s)}>
          ${showDiagram ? '▲' : '▼'} Explain Filtering
        </button>
      </div>

      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th>En</th><th>#</th><th>CAN ID</th><th>Mask</th><th>IDE</th><th>Type</th><th></th>
            </tr>
          </thead>
          <tbody>
            ${filters.map((f, idx) => html`
              <tr key=${idx}>
                <td><input type="checkbox" checked=${f.enabled} onChange=${e => updateFilter(idx, 'enabled', e.target.checked)} /></td>
                <td class="text-muted">${idx}</td>
                <td><input class="input-hex" value=${f.id} onInput=${e => updateFilter(idx, 'id', e.target.value)} style="width:80px" /></td>
                <td><input class="input-hex" value=${f.mask} onInput=${e => updateFilter(idx, 'mask', e.target.value)} style="width:80px" /></td>
                <td>
                  <select value=${f.ide} onChange=${e => updateFilter(idx, 'ide', e.target.value)}>
                    <option value="both">Both</option>
                    <option value="std">STD</option>
                    <option value="ext">EXT</option>
                  </select>
                </td>
                <td>
                  <select value=${f.type} onChange=${e => updateFilter(idx, 'type', e.target.value)}>
                    <option value="both">Both</option>
                    <option value="classic">Classic</option>
                    <option value="fd">FD</option>
                  </select>
                </td>
                <td><button class="btn btn-sm" onClick=${() => removeFilter(idx)} style="color:var(--accent-red)">✕</button></td>
              </tr>
            `)}
          </tbody>
        </table>
        ${filters.length === 0 && html`
          <div style="padding:12px;color:var(--text-muted);font-size:12px">No filters — all frames pass.</div>
        `}
      </div>

      ${showDiagram && html`
        <div class="panel" style="margin-top:12px">
          <div class="panel-title">Filter Diagram</div>
          <p style="font-size:12px;color:var(--text-secondary);margin-bottom:8px">
            A frame passes if: <code style="font-family:monospace">(frame_id &amp; mask) == (filter_id &amp; mask)</code>.
            Mask bits set to 1 are compared; bits set to 0 are don't-care.
          </p>
          <div style="display:flex;gap:12px;margin-bottom:8px;flex-wrap:wrap">
            <div class="tx-field">
              <label>Filter ID</label>
              <input class="input-hex" value=${example.id} onInput=${e => setExample(ex => ({...ex, id: e.target.value}))} style="width:80px" />
            </div>
            <div class="tx-field">
              <label>Mask</label>
              <input class="input-hex" value=${example.mask} onInput=${e => setExample(ex => ({...ex, mask: e.target.value}))} style="width:80px" />
            </div>
          </div>
          <div style="font-size:12px">
            <div class="text-muted" style="margin-bottom:4px">First matching IDs:</div>
            <div style="font-family:'JetBrains Mono',monospace;color:var(--accent-green)">
              ${matchingIds(example.id, example.mask).join('  ')}
            </div>
          </div>
        </div>
      `}
    </div>
  `;
}
