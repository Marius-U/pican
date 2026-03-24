// SPDX-License-Identifier: AGPL-3.0-or-later
// Valid CAN-FD DLC values (Classic: 0-8, FD: 0-8,12,16,20,24,32,48,64)
export const CLASSIC_DLCS = [0,1,2,3,4,5,6,7,8];
export const FD_DLCS = [0,1,2,3,4,5,6,7,8,12,16,20,24,32,48,64];

// Map DLC value to actual data byte count
export const DLC_TO_BYTES = {
  0:0, 1:1, 2:2, 3:3, 4:4, 5:5, 6:6, 7:7, 8:8,
  12:12, 16:16, 20:20, 24:24, 32:32, 48:48, 64:64,
};

// Standard bitrate presets with timing for 40MHz oscillator
export const BITRATE_PRESETS = [
  { label: '10 kbit/s',   value: 10000   },
  { label: '20 kbit/s',   value: 20000   },
  { label: '33.333 kbit/s', value: 33333 },
  { label: '50 kbit/s',   value: 50000   },
  { label: '83.333 kbit/s', value: 83333 },
  { label: '100 kbit/s',  value: 100000  },
  { label: '125 kbit/s',  value: 125000  },
  { label: '250 kbit/s',  value: 250000  },
  { label: '500 kbit/s',  value: 500000  },
  { label: '800 kbit/s',  value: 800000  },
  { label: '1 Mbit/s',    value: 1000000 },
];

export const DATA_BITRATE_PRESETS = [
  { label: '500 kbit/s',  value: 500000  },
  { label: '1 Mbit/s',    value: 1000000 },
  { label: '2 Mbit/s',    value: 2000000 },
  { label: '4 Mbit/s',    value: 4000000 },
  { label: '5 Mbit/s',    value: 5000000 },
  { label: '8 Mbit/s',    value: 8000000 },
];

// Operating modes
export const OPERATING_MODES = [
  {
    value: 'normal',
    label: 'Normal',
    description: 'Full TX/RX, participates in bus arbitration and acknowledgement.',
  },
  {
    value: 'listen-only',
    label: 'Listen Only',
    description: 'Receives all frames, does not transmit, does not send ACK bits. Use for passive bus monitoring without affecting bus behavior.',
  },
  {
    value: 'loopback',
    label: 'Internal Loopback',
    description: 'TX is internally routed to RX without going on the physical bus. Useful for software testing without any bus connection.',
  },
  {
    value: 'loopback-external',
    label: 'External Loopback',
    description: 'TX is sent on the bus and simultaneously looped back to RX. Useful for hardware self-test.',
  },
];

// Filter presets
export const FILTER_PRESETS = [
  { label: 'Pass All',              id: '0x000', mask: '0x000' },
  { label: 'OBD-II Responses',      id: '0x7E0', mask: '0x7F8' },
  { label: 'ID Range 0x100–0x1FF',  id: '0x100', mask: '0x700' },
  { label: 'ID Range 0x600–0x6FF',  id: '0x600', mask: '0x700' },
  { label: 'CANopen Heartbeats',    id: '0x700', mask: '0x780' },
];
