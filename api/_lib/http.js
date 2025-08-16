export const ok   = (body={}) => ({ statusCode:200, headers: h(), body: JSON.stringify({ ok:true, ...body }) });
export const bad  = (code=400,msg='Bad request') => ({ statusCode:code, headers: h(), body: JSON.stringify({ ok:false, error: msg }) });
const h = ()=>({ 'Content-Type':'application/json', 'Cache-Control':'no-store', 'Access-Control-Allow-Origin':'*' });
