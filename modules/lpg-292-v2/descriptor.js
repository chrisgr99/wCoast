// descriptor.js — Quad Low Pass Gate v2. Same module and audio as the original
// lpg-292; only the faceplate differs (rebuilt on the shared faceplate library,
// panel/*, ~20mm narrower with evenly-spaced controls). Kept as a separate id so
// both can sit side by side for comparison. Reuses the original's ports, params,
// worklet, and factory.
'use strict';

import base from '../lpg-292/descriptor.js';

export default {
  ...base,
  id: 'lpg-292-v2',
  name: 'Quad Low Pass Gate v2',
  abbreviation: 'Low Gate v2',
};
