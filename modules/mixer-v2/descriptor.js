// descriptor.js — Mixer v2. Same module and audio as the original mixer; only the
// faceplate differs (rebuilt on the shared faceplate library, panel/*, keeping the
// original 103mm size and layout). Kept as a separate id so both can sit side by
// side for comparison. Reuses the original's ports, params, worklet, and factory.
'use strict';

import base from '../mixer/descriptor.js';

export default {
  ...base,
  id: 'mixer-v2',
  name: 'Mixer v2',
  abbreviation: 'Mix v2',
};
