// descriptor.js — Complex Oscillator v2. Same module and audio as the original
// 259t; only the faceplate differs (rebuilt entirely on the shared faceplate
// library, panel/*). Kept as a separate module id so both can be added side by
// side for comparison. Reuses the original's params, ports, worklet, and factory.
'use strict';

import base from '../complex-oscillator-259t/descriptor.js';

export default {
  ...base,
  id: 'wcoast.complexOsc259t.v2',
  name: 'Complex Oscillator v2',
  abbreviation: 'Cpx Osc v2',
};
