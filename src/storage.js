/**
 * 带过期时间的本地存储抽象（替代原混乱的 Cookie 命名）
 */
export function setStorageWithTTL(name, value, hours) {
  const expiresAt = Date.now() + (hours * 60 * 60 * 1000);
  try {
    localStorage.setItem(name, JSON.stringify({ value, expiresAt }));
  } catch (_) {
    // 忽略 localStorage 满或隐身模式限制
  }
}

export function getStorageWithTTL(name) {
  try {
    const stored = localStorage.getItem(name);
    if (!stored) return '';

    const parsed = JSON.parse(stored);
    if (!parsed.expiresAt || parsed.expiresAt > Date.now()) {
      return parsed.value || '';
    }
    localStorage.removeItem(name);
  } catch (_) {
    try {
      localStorage.removeItem(name);
    } catch (__) {}
  }
  return '';
}

// 兼容别名
export const setCookie = setStorageWithTTL;
export const getCookie = getStorageWithTTL;
