// SPDX-License-Identifier: AGPL-3.0-or-later
import { h } from 'https://esm.sh/preact@10.19.3';
import { useState, useEffect, useRef } from 'https://esm.sh/preact@10.19.3/hooks';
import htm from 'https://esm.sh/htm@3.1.1';
import { CLASSIC_DLCS, FD_DLCS, DLC_TO_BYTES } from '../utils/can-constants.js';

const html = htm.bind(h);

export default function TxEditor({ msg, onChange, onSend, onStart, onStop, onDelete, onDuplicate }) {
  const [bytes, setBytes] = useState(() => {
    const arr = msg.data || [];
    const len = DLC_TO_BYTES[msg.dlc] || 8;
    return Array.from({length: len}, (_, i) => (arr[i] ?? 0).toString(16).padStart(2, '0').toUpperCase());
  });

  const inputRefs = useRef([]);

  // Sync DOM values when bytes change (DLC resize, paste, external) — skip focused input
  useEffect(() => {
    bytes.forEach((b, i) => {
      const el = inputRefs.current[i];
      if (el && document.activeElement !== el) el.value = b;
    });
  }, [bytes]);

  useEffect(() => {
    const len = DLC_TO_BYTES[msg.dlc] || 8;
    setBytes(prev => Array.from({length: len}, (_, i) => (prev[i] !== undefined ? prev[i] : '00')));
  }, [msg.dlc]);

  const update = (field, value) => onChange({ ...msg, [field]: value });

  const commitByte = (idx, val) => {
    const raw = val.replace(/[^0-9a-fA-F]/g, '').slice(0, 2).toUpperCase();
    const padded = (raw || '00').padStart(2, '0');
    const newBytes = [...bytes];
    newBytes[idx] = padded;
    setBytes(newBytes);
    onChange({ ...msg, data: newBytes.map(b => parseInt(b, 16)) });
    return padded;
  };

  const onPaste = (e) => {
    const text = (e.clipboardData || window.clipboardData).getData('text');
    const hex = text.replace(/[^0-9a-fA-F]/g, '');
    const len = DLC_TO_BYTES[msg.dlc] || 8;
    const newBytes = Array.from({length: len}, (_, i) =>
      hex.slice(i * 2, i * 2 + 2).padEnd(2, '0').toUpperCase()
    );
    setBytes(newBytes);
    onChange({ ...msg, data: newBytes.map(b => parseInt(b, 16)) });
    e.preventDefault();
  };

  const dlcList = msg.fd ? FD_DLCS : CLASSIC_DLCS;
  const isRunning = msg.status === 'sending';

  return html`
    <div class="tx-row ${isRunning ? 'sending' : ''}">
      <div class="tx-field" style="min-width:16px">
        <label>En</label>
        <input type="checkbox" checked=${msg.enabled !== false}
          onChange=${e => update('enabled', e.target.checked)}
          style="width:16px;height:16px;margin-top:5px"
        />
      </div>

      <div class="tx-field" style="min-width:120px">
        <label>Name</label>
        <input value=${msg.name || ''} onInput=${e => update('name', e.target.value)} style="width:120px" />
      </div>

      <div class="tx-field">
        <label>CAN ID</label>
        <input
          class="input-hex" value=${(msg.can_id ?? 0).toString(16).toUpperCase()}
          onInput=${e => update('can_id', parseInt(e.target.value || '0', 16))}
          style="width:80px"
        />
      </div>

      <div class="tx-field">
        <label>IDE</label>
        <select value=${msg.ide ? 'ext' : 'std'} onChange=${e => update('ide', e.target.value === 'ext')}>
          <option value="std">STD</option>
          <option value="ext">EXT</option>
        </select>
      </div>

      <div class="tx-field">
        <label>Type</label>
        <select value=${msg.fd ? 'fd' : 'classic'} onChange=${e => update('fd', e.target.value === 'fd')}>
          <option value="classic">CAN 2.0</option>
          <option value="fd">CAN-FD</option>
        </select>
      </div>

      ${msg.fd && html`
        <div class="tx-field">
          <label>BRS</label>
          <input type="checkbox" checked=${msg.brs}
            onChange=${e => update('brs', e.target.checked)}
            style="width:16px;height:16px;margin-top:5px"
          />
        </div>
      `}

      <div class="tx-field">
        <label>DLC</label>
        <select value=${msg.dlc ?? 8} onChange=${e => update('dlc', parseInt(e.target.value))}>
          ${dlcList.map(d => html`<option value=${d}>${d}</option>`)}
        </select>
      </div>

      <div class="tx-field" style="flex:1">
        <label>Data</label>
        <div class="tx-data-bytes" onPaste=${onPaste}>
          ${bytes.map((b, i) => html`
            <input
              key=${i}
              class="input-hex"
              defaultValue=${b}
              maxLength="2"
              ref=${el => { inputRefs.current[i] = el; }}
              onBlur=${e => { e.target.value = commitByte(i, e.target.value); }}
              onFocus=${e => e.target.select()}
            />
          `)}
        </div>
      </div>

      <div class="tx-field">
        <label>Mode</label>
        <select value=${msg.mode || 'one-shot'} onChange=${e => update('mode', e.target.value)}>
          <option value="one-shot">One-Shot</option>
          <option value="periodic">Periodic</option>
          <option value="burst">Burst</option>
        </select>
      </div>

      ${msg.mode === 'periodic' && html`
        <div class="tx-field">
          <label>Period (ms)</label>
          <input type="number" min="1" value=${msg.period_ms || 100}
            onInput=${e => update('period_ms', parseInt(e.target.value))}
            style="width:70px"
          />
        </div>
      `}

      ${msg.mode === 'burst' && html`
        <div class="tx-field">
          <label>Count</label>
          <input type="number" min="1" value=${msg.burst_count || 10}
            onInput=${e => update('burst_count', parseInt(e.target.value))}
            style="width:60px"
          />
        </div>
        <div class="tx-field">
          <label>Interval (ms)</label>
          <input type="number" min="1" value=${msg.burst_interval_ms || 10}
            onInput=${e => update('burst_interval_ms', parseInt(e.target.value))}
            style="width:70px"
          />
        </div>
      `}

      <div class="tx-field" style="min-width:50px">
        <label>Status</label>
        <div style="padding-top:5px">
          ${isRunning
            ? html`<span class="badge badge-green pulse">Sending</span>`
            : html`<span class="badge badge-muted">${msg.send_count > 0 ? `Sent:${msg.send_count}` : 'Idle'}</span>`}
        </div>
      </div>

      <div class="tx-actions">
        ${msg.mode === 'one-shot'
          ? html`<button class="btn btn-sm btn-primary" onClick=${onSend} title="Send once">▶</button>`
          : isRunning
            ? html`<button class="btn btn-sm btn-danger" onClick=${onStop} title="Stop">⏸</button>`
            : html`<button class="btn btn-sm btn-success" onClick=${onStart} title="Start">▶</button>`
        }
        <button class="btn btn-sm" onClick=${onDuplicate} title="Duplicate">⧉</button>
        <button class="btn btn-sm" onClick=${onDelete} title="Delete" style="color:var(--accent-red)">🗑</button>
      </div>
    </div>
  `;
}
