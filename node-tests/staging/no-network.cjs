'use strict';
// Test helper: any network attempt is reported and fails loudly.
globalThis.fetch = async () => { console.error('NETWORK_ATTEMPTED'); throw new Error('NETWORK_ATTEMPTED'); };
