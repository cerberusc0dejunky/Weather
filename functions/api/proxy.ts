// Cloudflare Pages Function — CORS proxy for NWS and Windy API requests
// Replaces the Express app.post('/api/proxy') route from server.ts

export async function onRequestPost(context: any) {
  try {
    const { request } = context;
    const reqBody = await request.json();
    const { url, method = 'GET', headers = {}, body = null } = reqBody;

    if (!url) {
      return new Response(JSON.stringify({ error: 'URL is required' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const fetchOptions: any = {
      method,
      headers: {
        ...headers,
      },
    };

    // Default server User-Agent for NWS (required by api.weather.gov)
    if (!fetchOptions.headers['User-Agent']) {
      fetchOptions.headers['User-Agent'] = '(DAISY Storm Tracker App Server, cerberus@c0dejunky.com)';
    }

    if (body && ['POST', 'PUT', 'PATCH'].includes(method.toUpperCase())) {
      fetchOptions.body = JSON.stringify(body);
      if (!fetchOptions.headers['Content-Type']) {
        fetchOptions.headers['Content-Type'] = 'application/json';
      }
    }

    const response = await fetch(url, fetchOptions);
    const contentType = response.headers.get('content-type');
    let responseData;

    if (contentType && contentType.includes('json')) {
      responseData = await response.json();
    } else {
      responseData = await response.text();
    }

    if (response.ok) {
      const payload = {
        status: response.status,
        headers: Object.fromEntries(response.headers),
        data: responseData,
      };
      return new Response(JSON.stringify(payload), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    } else {
      return new Response(
        JSON.stringify({ status: response.status, error: responseData }),
        {
          status: response.status,
          headers: { 'Content-Type': 'application/json' },
        }
      );
    }
  } catch (error: any) {
    return new Response(
      JSON.stringify({ error: error.message || 'Internal proxy error' }),
      {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      }
    );
  }
}
