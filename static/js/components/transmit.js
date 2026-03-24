// SPDX-License-Identifier: AGPL-3.0-or-later
import { h } from 'https://esm.sh/preact@10.19.3';
import { useState, useEffect, useCallback } from 'https://esm.sh/preact@10.19.3/hooks';
import htm from 'https://esm.sh/htm@3.1.1';
import TxEditor from './tx-editor.js';
import { getState, subscribe } from '../app.js';

const html = htm.bind(h);

export default function Transmit() {
  const [messages, setMessages] = useState([]);
  const [templates, setTemplates] = useState([]);
  const [loading, setLoading] = useState(false);
  const [dbcMessages, setDbcMessages] = useState([]);
  const [showCompose, setShowCompose] = useState(false);

  useEffect(() => { loadMessages(); loadTemplates(); }, []);

  // Listen for tx_status updates from WS
  useEffect(() => {
    return subscribe(() => {/* state changes handled internally */});
  }, []);

  async function loadMessages() {
    try {
      const r = await fetch('/api/tx/messages');
      const d = await r.json();
      setMessages(d.messages || []);
    } catch(e) { console.error('Failed to load TX messages:', e); }
  }

  async function loadTemplates() {
    try {
      const r = await fetch('/api/tx/templates');
      const d = await r.json();
      setTemplates(d.templates || []);
    } catch(e) {}
  }

  async function addMessage() {
    const r = await fetch('/api/tx/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'New Message', can_id: 0x100, dlc: 8, data: [0,0,0,0,0,0,0,0] }),
    });
    const d = await r.json();
    setMessages(m => [...m, d.message]);
  }

  async function updateMessage(id, updates) {
    const r = await fetch(`/api/tx/messages/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(updates),
    });
    if (r.ok) {
      setMessages(msgs => msgs.map(m => m.id === id ? { ...m, ...updates } : m));
    }
  }

  async function deleteMessage(id) {
    await fetch(`/api/tx/messages/${id}`, { method: 'DELETE' });
    setMessages(msgs => msgs.filter(m => m.id !== id));
  }

  async function sendMessage(id) {
    await fetch(`/api/tx/messages/${id}/send`, { method: 'POST' });
    setMessages(msgs => msgs.map(m => m.id === id ? { ...m, send_count: (m.send_count || 0) + 1 } : m));
  }

  async function startMessage(id) {
    await fetch(`/api/tx/messages/${id}/start`, { method: 'POST' });
    setMessages(msgs => msgs.map(m => m.id === id ? { ...m, status: 'sending' } : m));
  }

  async function stopMessage(id) {
    await fetch(`/api/tx/messages/${id}/stop`, { method: 'POST' });
    setMessages(msgs => msgs.map(m => m.id === id ? { ...m, status: 'idle' } : m));
  }

  async function duplicateMessage(id) {
    const original = messages.find(m => m.id === id);
    if (!original) return;
    const r = await fetch('/api/tx/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...original, name: `${original.name} (copy)`, id: undefined }),
    });
    if (r.ok) {
      const d = await r.json();
      setMessages(msgs => [...msgs, d.message]);
    }
  }

  async function loadTemplate(tpl) {
    const r = await fetch('/api/tx/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(tpl),
    });
    if (r.ok) {
      const d = await r.json();
      setMessages(msgs => [...msgs, d.message]);
    }
  }

  async function startAll() { await fetch('/api/tx/start-all', { method: 'POST' }); loadMessages(); }
  async function stopAll() { await fetch('/api/tx/stop-all', { method: 'POST' }); loadMessages(); }

  async function exportMessages() {
    const r = await fetch('/api/tx/export');
    const blob = await r.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = 'tx-messages.json'; a.click();
    URL.revokeObjectURL(url);
  }

  async function importMessages(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    const text = await file.text();
    const data = JSON.parse(text);
    await fetch('/api/tx/import', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
    loadMessages();
  }

  return html`
    <div class="tab-pane">
      <div class="toolbar">
        <button class="btn btn-success btn-sm" onClick=${addMessage}>+ Add Message</button>
        <div class="separator"></div>
        <button class="btn btn-sm" onClick=${startAll}>▶ Start All</button>
        <button class="btn btn-sm" onClick=${stopAll}>⏹ Stop All</button>
        <div class="separator"></div>
        <select onChange=${e => { if(e.target.value) { loadTemplate(JSON.parse(e.target.value)); e.target.value=''; }}}
          style="width:160px">
          <option value="">Load Template...</option>
          ${(templates || []).map(t => html`
            <option value=${JSON.stringify(t)} key=${t.name}>${t.name}</option>
          `)}
        </select>
        <div class="separator"></div>
        <button class="btn btn-sm" onClick=${exportMessages}>↑ Export</button>
        <label class="btn btn-sm" style="cursor:pointer">
          ↓ Import
          <input type="file" accept=".json" onChange=${importMessages} style="display:none" />
        </label>
      </div>

      <div class="tx-table">
        ${messages.length === 0 && html`
          <div style="padding:32px;text-align:center;color:var(--text-muted)">
            No TX messages. Click "+ Add Message" or load a template to start.
          </div>
        `}
        ${messages.map(msg => html`
          <${TxEditor}
            key=${msg.id}
            msg=${msg}
            onChange=${updates => updateMessage(msg.id, updates)}
            onSend=${() => sendMessage(msg.id)}
            onStart=${() => startMessage(msg.id)}
            onStop=${() => stopMessage(msg.id)}
            onDelete=${() => deleteMessage(msg.id)}
            onDuplicate=${() => duplicateMessage(msg.id)}
          />
        `)}
      </div>
    </div>
  `;
}
