/**
 * VPS 剩余价值计算器 - 核心计算与数据处理模块（纯函数，无 DOM 依赖）
 */

export const CURRENCY_SYMBOLS = {
  USD: '$',
  EUR: '€',
  GBP: '£',
  JPY: '¥',
  CNY: '¥',
  HKD: 'HK$',
  AUD: 'A$',
  SGD: 'S$',
  KRW: '₩',
  TWD: 'NT$',
  CAD: 'C$',
};

export const CYCLE_LABELS = {
  '30': '月付',
  '90': '季付',
  '180': '半年',
  '365': '年付',
  '730': '两年',
  '1095': '三年',
};

export function parseDateInput(value) {
  if (typeof value !== 'string') return null;
  const str = value.trim();
  if (!str) return null;

  let y, m, d;
  const sepMatch = str.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/);
  if (sepMatch) {
    y = parseInt(sepMatch[1], 10);
    m = parseInt(sepMatch[2], 10);
    d = parseInt(sepMatch[3], 10);
  } else {
    const compactMatch = str.match(/^(\d{4})(\d{2})(\d{2})$/);
    if (compactMatch) {
      y = parseInt(compactMatch[1], 10);
      m = parseInt(compactMatch[2], 10);
      d = parseInt(compactMatch[3], 10);
    } else {
      return null;
    }
  }

  if (y < 1970 || y > 2100 || m < 1 || m > 12 || d < 1 || d > 31) return null;
  const date = new Date(y, m - 1, d);
  if (date.getFullYear() !== y || date.getMonth() !== m - 1 || date.getDate() !== d) {
    return null;
  }
  const mm = String(m).padStart(2, '0');
  const dd = String(d).padStart(2, '0');
  return `${y}-${mm}-${dd}`;
}

export function formatDate(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function formatDateForDisplay(value) {
  const parsed = parseDateInput(value);
  return parsed || value || 'YYYY-MM-DD';
}

export function getBlackFriday(year) {
  const novemberFirst = new Date(year, 10, 1);
  const firstThursday = 1 + ((4 - novemberFirst.getDay() + 7) % 7);
  const thanksgivingDay = firstThursday + 21;
  return new Date(year, 10, thanksgivingDay + 1);
}

export function getNextBlackFriday(date) {
  const currentYearBlackFriday = getBlackFriday(date.getFullYear());
  return date.getTime() < currentYearBlackFriday.getTime()
    ? currentYearBlackFriday
    : getBlackFriday(date.getFullYear() + 1);
}

export function parseQuoteValue(value) {
  if (typeof value !== 'string' || value.trim() === '') return NaN;
  return parseFloat(value);
}

export function formatMoney(value) {
  if (!Number.isFinite(value)) return '';
  const rounded = Math.round(value * 100) / 100;
  return (Object.is(rounded, -0) ? 0 : rounded).toFixed(2);
}

/**
 * 核心剩余价值计算
 */
export function calculateValuation({ price, rate, cycleDays, dueDateStr, tradeDateStr }) {
  const validPrice = Number.isFinite(price) && price >= 0 ? price : 0;
  const validRate = Number.isFinite(rate) && rate > 0 ? rate : 1;
  const validCycle = cycleDays > 0 ? cycleDays : 365;

  const totalCNY = validPrice * validRate;
  const dailyPrice = validCycle > 0 ? validPrice / validCycle : 0;
  const dailyPriceCNY = validCycle > 0 ? totalCNY / validCycle : 0;

  const dueIso = parseDateInput(dueDateStr);
  const tradeIso = parseDateInput(tradeDateStr);

  if (!dueIso || !tradeIso) {
    return {
      isValidDates: false,
      totalCNY,
      dailyPrice,
      dailyPriceCNY,
      rawDiffDays: 0,
      effectiveDays: 0,
      valOrig: 0,
      valCNY: 0,
      progressPct: 0,
      displayProgressPct: 0,
    };
  }

  const due = new Date(dueIso + 'T00:00:00');
  const trade = new Date(tradeIso + 'T00:00:00');
  const diffTime = due.getTime() - trade.getTime();
  const rawDiffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
  const effectiveDays = Math.max(0, rawDiffDays);

  const valOrig = dailyPrice * effectiveDays;
  const valCNY = valOrig * validRate;

  let displayProgressPct;
  if (rawDiffDays <= 0) {
    displayProgressPct = 0;
  } else {
    displayProgressPct = Math.min(100, Math.max(1, Math.round((rawDiffDays / validCycle) * 100)));
  }

  return {
    isValidDates: true,
    totalCNY,
    dailyPrice,
    dailyPriceCNY,
    rawDiffDays,
    effectiveDays,
    valOrig,
    valCNY,
    progressPct: displayProgressPct,
    displayProgressPct,
  };
}

/**
 * 生成 Markdown 格式的分享文本
 */
export function generateMarkdownReport({
  price,
  currency,
  rate,
  cycleText,
  cycleDays,
  tradeDate,
  dueDate,
  daysRemaining,
  valCNY,
  valOrig,
  premium,
  salePrice,
}) {
  const fmtDate = (v) => {
    const parsed = parseDateInput(v);
    return parsed || v || '未设置';
  };
  const cnyPrice = (parseFloat(price || 0) * parseFloat(rate || 1)).toFixed(2);
  const cycleDaysVal = parseInt(cycleDays || 365, 10);
  const dailyCNYText = cycleDaysVal > 0
    ? ((parseFloat(price || 0) * parseFloat(rate || 1)) / cycleDaysVal).toFixed(2)
    : '0.00';

  const lines = [
    `## 🐔 VPS 剩余价值`,
    `- 📅 交易日期：${fmtDate(tradeDate)}`,
    `- 💹 外币汇率：1 ${currency} ≈ ${rate} CNY`,
    `- 💰 续费价格：${price || 0} ${currency}/${cycleText}（约 ${cnyPrice} 元）`,
    `- ⚡ 日均成本：约 ${dailyCNYText} 元/天`,
  ];

  if (dueDate && parseDateInput(dueDate)) {
    lines.push(`- ⏳ 剩余天数：${daysRemaining} 天（${fmtDate(dueDate)} 到期）`);
  } else {
    lines.push(`- ⏳ 剩余天数：未设置到期日`);
  }

  lines.push(`- 💎 剩余价值：${valCNY} 元（约 ${valOrig} ${currency}）`);

  if (premium === '' && salePrice === '') {
    lines.push(`- 🧾 溢价 / 总价：未设置`);
  } else {
    const premiumText = premium !== '' ? `${premium} 元` : '未设置';
    const saleText = salePrice !== '' ? `${salePrice} 元` : '未设置';
    lines.push(`- 🧾 溢价 / 总价：${premiumText} / ${saleText}`);
  }

  return lines.join('\r\n');
}
