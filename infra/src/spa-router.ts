/** Viewer redirects happen before the SPA loads, keeping PKCE state on the canonical origin. */
export function spaRouterCode(domainName?: string): string {
  if (!domainName) return "function handler(event) { var request = event.request; if (!request.uri.split('/').pop().includes('.')) request.uri = '/index.html'; return request; }";
  return `function handler(event) {
    var request = event.request;
    if (request.headers.host.value.toLowerCase() !== ${JSON.stringify(domainName)}) {
      var pairs = [];
      for (var key in request.querystring) {
        var field = request.querystring[key];
        var values = field.multiValue || [field];
        for (var i = 0; i < values.length; i++) pairs.push(key + '=' + values[i].value);
      }
      var query = pairs.length ? '?' + pairs.join('&') : '';
      return { statusCode: 302, statusDescription: 'Found', headers: {
        location: { value: 'https://' + ${JSON.stringify(domainName)} + request.uri + query },
        'cache-control': { value: 'no-store' }
      } };
    }
    if (!request.uri.split('/').pop().includes('.')) request.uri = '/index.html';
    return request;
  }`;
}
