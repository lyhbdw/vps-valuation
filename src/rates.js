/**
 * 实时汇率管理模块（支持缓存、限流与内置基准兜底）
 */
import { getStorageWithTTL, setStorageWithTTL } from './storage.js';

const API_URL = 'https://open.er-api.com/v6/latest/CNY';
const RATE_CACHE_HOURS = 12;
const RATE_LIMIT_WINDOW_HOURS = 6;
const MANUAL_REFRESH_LIMIT = 3;

// 当网络完全不可用或 API 挂掉时的静态兜底汇率（1 外币 = ? 人民币）
export const FALLBACK_RATES = {
  CNY: 1.0,
  USD: 7.20,
  EUR: 7.80,
  GBP: 9.35,
  JPY: 0.048,
  HKD: 0.92,
  AUD: 4.80,
  SGD: 5.55,
  KRW: 0.0053,
  TWD: 0.225,
  CAD: 5.25,
};

export class RateManager {
  constructor(options = {}) {
    this.onRateUpdate = options.onRateUpdate || (() => {});
    this.onStatusChange = options.onStatusChange || (() => {});
    this.onToast = options.onToast || (() => {});
    this.onRateLimit = options.onRateLimit || (() => {});
  }

  async init(currencyCode) {
    if (currencyCode === 'CNY') {
      this.onRateUpdate(1.0);
      return;
    }

    const cacheKey = `vps_rate_${currencyCode}`;
    const cachedData = getStorageWithTTL(cacheKey);

    if (cachedData) {
      try {
        const data = JSON.parse(cachedData);
        if (data && Number.isFinite(data.rate) && data.rate > 0) {
          this.onRateUpdate(data.rate);
          return;
        }
      } catch (_) {}
    }

    // 无缓存或缓存损坏时静默刷新
    await this.refresh(currencyCode, false);
  }

  async refresh(currencyCode, isUserClick = true) {
    if (currencyCode === 'CNY') return;

    const limitKey = 'vps_refresh_limit';
    const rawLimit = getStorageWithTTL(limitKey);
    let limitData = { count: 0, resetTime: Date.now() + RATE_LIMIT_WINDOW_HOURS * 3600 * 1000 };

    if (rawLimit) {
      try {
        const parsed = JSON.parse(rawLimit);
        if (parsed.resetTime && Date.now() < parsed.resetTime) {
          limitData = parsed;
        }
      } catch (_) {}
    }

    if (isUserClick) {
      if (limitData.count >= MANUAL_REFRESH_LIMIT) {
        this.onRateLimit();
        return;
      }
      limitData.count++;
      const hoursLeft = (limitData.resetTime - Date.now()) / (1000 * 3600);
      setStorageWithTTL(limitKey, JSON.stringify(limitData), Math.max(0.1, hoursLeft));
    }

    await this._fetch(currencyCode);
  }

  async _fetch(currencyCode) {
    this.onStatusChange({ loading: true, text: '刷新中' });

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 8000);

    try {
      const response = await fetch(API_URL, { signal: controller.signal });
      const data = await response.json();

      if (data.result === 'success') {
        const baseInCNY = data.rates && data.rates[currencyCode];
        if (typeof baseInCNY === 'number' && baseInCNY > 0 && Number.isFinite(baseInCNY)) {
          const rate = 1 / baseInCNY;
          this.onRateUpdate(rate);

          const cacheData = JSON.stringify({ rate, time: Date.now() });
          setStorageWithTTL(`vps_rate_${currencyCode}`, cacheData, RATE_CACHE_HOURS);
          this.onStatusChange({ loading: false, text: '汇率刷新' });
          return;
        }
      }
      throw new Error('API Error');
    } catch (error) {
      this.onStatusChange({ loading: false, text: '汇率刷新' });

      // 使用内置兜底汇率，防止空白
      const fallback = FALLBACK_RATES[currencyCode];
      if (fallback) {
        this.onRateUpdate(fallback);
        this.onToast(error && error.name === 'AbortError' ? '汇率超时，已使用基准汇率' : '获取汇率失败，已使用基准汇率');
      } else {
        this.onToast('获取汇率失败');
      }
    } finally {
      clearTimeout(timeoutId);
    }
  }
}
