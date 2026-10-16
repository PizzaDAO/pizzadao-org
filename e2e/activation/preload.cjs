// Production UI tests mock browser APIs. SSR metadata must not depend on live sheets.
const originalFetch = globalThis.fetch;
globalThis.fetch = function (input, init) {
  const url = new URL(typeof input === 'string' ? input : input.url || input);
  if (!['localhost', '127.0.0.1'].includes(url.hostname)) return Promise.reject(new Error('External SSR fetch disabled in browser tests'));
  return originalFetch(input, init);
};
