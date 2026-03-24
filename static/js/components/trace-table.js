// SPDX-License-Identifier: AGPL-3.0-or-later
import { h } from 'https://esm.sh/preact@10.19.3';
import { useState, useEffect, useRef, useCallback } from 'https://esm.sh/preact@10.19.3/hooks';
import htm from 'https://esm.sh/htm@3.1.1';
import { getColor } from '../utils/color-palette.js';
import { fmtTimestamp, fmtHex, parseIdFilter } from '../utils/formatters.js';

const html = htm.bind(h);

const ROW_HEIGHT = 24;
const BUFFER_ROWS = 20;

export default function TraceTable({ messages, filters, config, autoScroll, onAutoScrollChange }) {
  const scrollRef = useRef(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [containerHeight, setContainerHeight] = useState(600);
  const [expandedRows, setExpandedRows] = useState(new Set());
  const [manualScrolled, setManualScrolled] = useState(false);
  const prevLenRef = useRef(0);

  // Filter messages
  const filtered = useFiltered(messages, filters);

  // Auto-scroll
  useEffect(() => {
    if (!autoScroll || manualScrolled || !scrollRef.current) return;
    if (filtered.length !== prevLenRef.current) {
      prevLenRef.current = filtered.length;
      scrollRef.current.scrollTop = filtered.length * ROW_HEIGHT;
    }
  });

  // Measure container
  useEffect(() => {
    if (!scrollRef.current) return;
    const ro = new ResizeObserver(entries => {
      for (const entry of entries) {
        setContainerHeight(entry.contentRect.height);
      }
    });
    ro.observe(scrollRef.current);
    return () => ro.disconnect();
  }, []);

  const onScroll = useCallback((e) => {
    const st = e.currentTarget.scrollTop;
    setScrollTop(st);

    // Detect manual scroll (not from auto-scroll)
    const isAtBottom = st + containerHeight >= filtered.length * ROW_HEIGHT - ROW_HEIGHT * 2;
    if (!isAtBottom && filtered.length > 0) {
      setManualScrolled(true);
      onAutoScrollChange && onAutoScrollChange(false);
    }
  }, [containerHeight, filtered.length, onAutoScrollChange]);

  const resumeScroll = useCallback(() => {
    setManualScrolled(false);
    onAutoScrollChange && onAutoScrollChange(true);
    if (scrollRef.current) {
      scrollRef.current.scrollTop = filtered.length * ROW_HEIGHT;
    }
  }, [filtered.length, onAutoScrollChange]);

  const toggleRow = (idx) => {
    setExpandedRows(prev => {
      const next = new Set(prev);
      if (next.has(idx)) next.delete(idx);
      else next.add(idx);
      return next;
    });
  };

  // Calculate visible range
  const visibleStart = Math.max(0, Math.floor(scrollTop / ROW_HEIGHT) - BUFFER_ROWS);
  const visibleCount = Math.ceil(containerHeight / ROW_HEIGHT) + BUFFER_ROWS * 2;
  const visibleEnd = Math.min(filtered.length, visibleStart + visibleCount);

  const totalHeight = filtered.length * ROW_HEIGHT;
  const offsetY = visibleStart * ROW_HEIGHT;

  const hex_upper = config?.hex_uppercase !== false;

  return html`
    <div class="trace-container">
      <div class="trace-header">
        <div class="col col-num">#</div>
        <div class="col col-ts">Timestamp</div>
        <div class="col col-ch">Ch</div>
        <div class="col col-id">CAN ID</div>
        <div class="col col-dir">Dir</div>
        <div class="col col-ide">IDE</div>
        <div class="col col-type">Type</div>
        <div class="col col-fdf">FDF</div>
        <div class="col col-brs">BRS</div>
        <div class="col col-dlc">DLC</div>
        <div class="col col-data">Data</div>
        <div class="col col-name">Name</div>
        <div class="col col-status">Status</div>
      </div>

      <div class="trace-scroll" ref=${scrollRef} onScroll=${onScroll}>
        <div class="trace-total-height" style="height:${totalHeight}px">
          <div class="trace-visible" style="top:${offsetY}px">
            ${filtered.slice(visibleStart, visibleEnd).map((msg, i) => {
              const absIdx = visibleStart + i;
              const numId = parseInt(msg.id, 16);
              const color = getColor(numId);
              const isExpanded = expandedRows.has(absIdx);
              const isExt = msg.ide === 1;

              return html`
                <div key=${absIdx}>
                  <div
                    class="trace-row ${msg.dir === 'tx' ? 'tx' : ''} ${msg.s === 'error' ? 'error-frame' : ''}"
                    onClick=${() => msg.signals && toggleRow(absIdx)}
                  >
                    <div class="col col-num">${msg.n}</div>
                    <div class="col col-ts">${fmtTimestamp(msg.ts, config?.timestamp_format)}</div>
                    <div class="col col-ch">can0</div>
                    <div class="col col-id">
                      <div class="id-dot" style="background:${color}"></div>
                      <span>${isExt ? msg.id.padStart(8,'0') : msg.id.padStart(3,'0')}</span>
                    </div>
                    <div class="col col-dir ${msg.dir === 'tx' ? 'dir-tx' : 'dir-rx'}">${msg.dir?.toUpperCase()}</div>
                    <div class="col col-ide">${isExt ? 'EXT' : 'STD'}</div>
                    <div class="col col-type">${msg.fdf ? 'CAN-FD' : 'CAN2.0'}</div>
                    <div class="col col-fdf">${msg.fdf || 0}</div>
                    <div class="col col-brs">${msg.brs || 0}</div>
                    <div class="col col-dlc">${msg.dlc}</div>
                    <div class="col col-data">${fmtHex(msg.data, hex_upper)}</div>
                    <div class="col col-name">${msg.name || ''}</div>
                    <div class="col col-status">
                      ${msg.s === 'error'
                        ? html`<span class="badge badge-red">Err</span>`
                        : html`<span class="badge badge-muted">OK</span>`}
                    </div>
                  </div>
                  ${isExpanded && msg.signals && html`
                    <div class="signal-sub-row">
                      ${Object.entries(msg.signals).map(([name, sig]) => html`
                        <div class="signal-chip" key=${name}>
                          <span class="name">${name}</span>
                          <span class="value">${sig.phys?.toFixed(2) ?? '—'}</span>
                          ${sig.unit && html`<span class="unit">${sig.unit}</span>`}
                        </div>
                      `)}
                    </div>
                  `}
                </div>
              `;
            })}
          </div>
        </div>
      </div>

      ${manualScrolled && html`
        <button class="resume-scroll-btn" onClick=${resumeScroll}>
          ↓ Resume auto-scroll
        </button>
      `}
    </div>
  `;
}

function useFiltered(messages, filters) {
  if (!filters) return messages;

  const { idFilter, typeFilter, dirFilter, nameFilter } = filters;
  const idTest = idFilter ? parseIdFilter(idFilter) : null;

  return messages.filter(msg => {
    if (idTest && !idTest(parseInt(msg.id, 16))) return false;
    if (typeFilter && typeFilter !== 'all') {
      const isFd = msg.fdf === 1;
      if (typeFilter === 'fd' && !isFd) return false;
      if (typeFilter === 'classic' && isFd) return false;
    }
    if (dirFilter && dirFilter !== 'all' && msg.dir !== dirFilter) return false;
    if (nameFilter && nameFilter.trim()) {
      const name = (msg.name || '').toLowerCase();
      if (!name.includes(nameFilter.toLowerCase())) return false;
    }
    return true;
  });
}
