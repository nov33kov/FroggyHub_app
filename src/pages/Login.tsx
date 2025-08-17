// src/pages/Login.tsx
import { login } from '../api';

export async function doLogin(
  username: string,
  password: string,
  setMsg: (s: string) => void
) {
  try {
    const res = await login(username, password);
    setMsg('Вход выполнен');
  } catch (e: any) {
    setMsg(e?.response?.data?.error || 'Ошибка входа');
  }
}
