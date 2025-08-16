export async function handler(event) {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }
  return {
    statusCode: 204,
    headers: {
      'Set-Cookie': 'sb-access-token=; HttpOnly; Path=/; Max-Age=0'
    }
  };
}
