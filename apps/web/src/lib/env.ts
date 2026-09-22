const rawOrigin = import.meta.env.VITE_API_ORIGIN;

export const apiOrigin =
  typeof rawOrigin === 'string' && rawOrigin.length > 0 ? rawOrigin.replace(/\/$/, '') : '';
