import type { Handler } from '@netlify/functions'
import { getClient } from '../../utils/db.js'
import bcrypt from 'bcryptjs'

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
    const { nickname, password } = JSON.parse(event.body || '{}')
    if (!nickname || !password) {
      return err('Некорректные данные')
    }

    const client = await getClient()

    try {
      const hash = await bcrypt.hash(password, 10)
      await client.query(
        'INSERT INTO users_local (nickname, password_hash) VALUES ($1, $2)',
        [nickname, hash]
      )
      return ok({ ok: true, message: 'Регистрация успешна' })
    } catch (e: any) {
      if (e.code === '23505') {
        return err('Такой ник уже есть')
      }
      return err('Ошибка сервера', 500)
    } finally {
      await client.end()
    }
  } catch (e) {
    return err('Ошибка сервера', 500)
  }
}

