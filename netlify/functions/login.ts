import type { Handler } from '@netlify/functions'
import { getClient } from '../../utils/db.js'
import bcrypt from 'bcryptjs'
import jwt from 'jsonwebtoken'

function cors(extra: Record<string,string> = {}) {
  return {
    'Access-Control-Allow-Origin': 'https://froggyhubapp.netlify.app',
    'Access-Control-Allow-Credentials': 'true',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
    ...extra
  }
}

function ok(body: any, status = 200) {
  return { statusCode: status, headers: cors(), body: JSON.stringify(body) }
}

function err(message: string, status = 400) {
  return { statusCode: status, headers: cors(), body: JSON.stringify({ message }) }
}

export const handler: Handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers: cors() }
  }
  if (event.httpMethod !== 'POST') {
    return err('Method not allowed', 405)
  }

  try {
    const { username, password } = JSON.parse(event.body || '{}')
    if (!username || !password) {
      return err('Некорректные данные')
    }

    const client = await getClient()

    try {
      const { rows } = await client.query(
        'SELECT id, username, password_hash FROM local_users WHERE username=$1 LIMIT 1',
        [username]
      )
      if (rows.length === 0) {
        return err('Пользователь не найден', 401)
      }
      const user = rows[0]
      const match = await bcrypt.compare(password, user.password_hash)
      if (!match) {
        return err('Неверный пароль', 401)
      }
      const token = jwt.sign(
        { sub: user.id, username: user.username },
        process.env.JWT_SECRET as string,
        { expiresIn: '7d' }
      )
      return ok({ ok: true, token, user: { id: user.id, username: user.username } })
    } catch (e) {
      return err('Ошибка сервера', 500)
    } finally {
      await client.end()
    }
  } catch (e) {
    return err('Ошибка сервера', 500)
  }
}

