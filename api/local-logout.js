export async function handler(event) {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }
  const domain = process.env.COOKIE_DOMAIN ? `Domain=${process.env.COOKIE_DOMAIN}; ` : '';
  return {
    statusCode: 204,
    headers: {
      'Set-Cookie': `sb-access-token=; ${domain}HttpOnly; Path=/; Max-Age=0; Secure; SameSite=Lax`
    }
  };
}
