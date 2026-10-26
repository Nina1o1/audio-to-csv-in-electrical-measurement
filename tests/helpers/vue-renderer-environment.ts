import type { Environment } from 'vitest/environments'

// Compile SFCs for client rendering; the test itself supplies a minimal Vue host, not a browser DOM.
export default {
  name: 'vue-renderer',
  transformMode: 'web',
  setup() { return { teardown() {} } },
} satisfies Environment
