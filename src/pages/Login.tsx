// src/pages/Login.tsx
import { login } from '../api';
import axios from 'axios';

export async function doLogin(
  nickname: string,
  password: string,
  setMsg: (s: string) => void
) {
  try {
    const res = await login(nickname, password);
    setMsg('Вход выполнен');
  } catch (e: any) {
    setMsg(e?.response?.data?.error || 'Ошибка входа');
  }
}
