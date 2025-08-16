import { sql } from './_lib/db.js';
import { ok, bad } from './_lib/http.js';
import bcrypt from 'bcryptjs';

export async function handler(event){
  if(event.httpMethod!=='POST') return bad(405,'Method not allowed');
  const { nickname, password } = JSON.parse(event.body||'{}');
  if(!nickname || !password) return bad(400,'Неверные данные');
  try{
    const rows = await sql`select id, password_hash from users_local where nickname = ${nickname} limit 1`;
    if(!rows.length) return bad(401,'Неверный ник или пароль');
    const okPass = await bcrypt.compare(password, rows[0].password_hash);
    if(!okPass) return bad(401,'Неверный ник или пароль');
    // простая сессия в localStorage на фронте — вернём минимум
    return ok({ user:{ id: rows[0].id, nickname }});
  }catch(e){
    console.error('auth-login', e);
    return bad(500,'Не удалось войти');
  }
}
