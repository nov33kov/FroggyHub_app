// src/api.ts (добавить хелперы использования токена)
import axios from 'axios';

const api = axios.create({
  baseURL: import.meta.env.VITE_API_BASE_URL || '/.netlify/functions'
});

export const login = async (nickname: string, password: string) => {
  const { data } = await api.post('/local-login', { nickname, password });
  if (data?.token) localStorage.setItem('token', data.token);
  return data;
};

export const getProfile = async () => {
  const token = localStorage.getItem('token');
  const { data } = await api.get('/profile', {
    headers: token ? { Authorization: `Bearer ${token}` } : {}
  });
  return data;
};
