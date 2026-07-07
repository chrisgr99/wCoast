// descriptor.js — Quad Function Generator v2. Same module and audio as the
// original 281t; only the faceplate differs (rebuilt on the shared faceplate
// library, panel/*, keeping the original 98mm size and layout). Kept as a
// separate id so both can sit side by side. Reuses the original's ports,
// params, worklet, and factory.
'use strict';

import base from '../function-gen-281t/descriptor.js';

export default {
  ...base,
  id: 'function-gen-281t-v2',
  name: 'Quad Function Generator v2',
  abbreviation: 'Quad Fn v2',
};
