import { sql } from './_lib/db.js';
import { ok, bad } from './_lib/http.js';
import bcrypt from 'bcryptjs';

export async function handler(event){
  if(event.httpMethod!=='POST') return bad(405,'Method not allowed');
  const { nickname, password } = JSON.parse(event.body||'{}');
  if(!nickname || !password || password.length<4) return bad(400,'Неверные данные');
  try{
    const hash = await bcrypt.hash(password, 10);
    await sql`insert into users_local (nickname, password_hash) values (${nickname}, ${hash})`;
    return ok({ user:{ nickname }});
  }catch(e){
    if(String(e?.message||'').includes('duplicate key')) return bad(409,'Ник уже занят');
    console.error('auth-register', e);
    return bad(500,'Не удалось зарегистрироваться');
  }
}
