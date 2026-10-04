import './style.css';
import {
  CURRENCY_SYMBOLS,
  CYCLE_LABELS,
  calculateValuation,
  formatDate,
  formatMoney,
  generateMarkdownReport,
  getNextBlackFriday,
  parseDateInput,
  parseQuoteValue,
} from './calculator.js';
import { closeExportModal, exportCardAsImage, getHtmlToImage } from './exportImage.js';
import { RateManager } from './rates.js';
import { getStorageWithTTL, setStorageWithTTL } from './storage.js';

const INPUT_CACHE_HOURS = 12;

const els = {
  price: document.getElementById('price'),
  currency: document.getElementById('currency'),
  cycles: document.getElementsByName('cycle'),
  dueDate: document.getElementById('dueDate'),
  tradeDate: document.getElementById('tradeDate'),
  dueDatePicker: document.getElementById('dueDatePicker'),
  tradeDatePicker: document.getElementById('tradeDatePicker'),
  dueDateCalendarBtn: document.getElementById('dueDateCalendarBtn'),
  tradeDateCalendarBtn: document.getElementById('tradeDateCalendarBtn'),
  customRate: document.getElementById('customRate'),
  apiRateDisplay: document.getElementById('apiRateDisplay'),
  refreshBtn: document.getElementById('refreshRateBtn'),
  refreshIcon: document.getElementById('refreshIcon'),
  symbolDisplay: document.querySelector('.symbol-display'),
  finalValue: document.getElementById('finalValue'),
  originalCurrencyValue: document.getElementById('originalCurrencyValue'),
  amountCopyTip: document.getElementById('amountCopyTip'),
  amountCopyTipText: document.getElementById('amountCopyTipText'),
  copyAmountTrigger: document.getElementById('copyAmountTrigger'),
  dailyPricePreview: document.getElementById('dailyPricePreview'),
  premiumInput: document.getElementById('premiumInput'),
  salePriceInput: document.getElementById('salePriceInput'),
  daysRemaining: document.getElementById('daysRemaining'),
  progressBar: document.getElementById('progressBar'),
  progressText: document.getElementById('progressText'),
  priceCNYPreview: document.getElementById('priceCNYPreview'),
  toast: document.getElementById('toast'),
  rateLimitTip: document.getElementById('rateLimitTip'),
  themeToggle: document.getElementById('themeToggle'),
  themeToggleKnob: document.getElementById('themeToggleKnob'),
};

const modal = {
  el: document.getElementById('imageModal'),
  img: document.getElementById('generatedImage'),
  loading: document.getElementById('modalLoading'),
  actions: document.getElementById('modalActions'),
  downloadBtn: document.getElementById('downloadImageBtn'),
  closeBtn: document.getElementById('closeImageModalBtn'),
};

let rateLimitTimer = null;
let toastTimer = null;
let symbolPaddingRaf = 0;
let remainingValueCNY = 0;
let quoteLastEdited = 'premium';
let modalLastFocused = null;

// 初始化汇率管理器
const rateManager = new RateManager({
  onRateUpdate: (rate) => {
    if (!Number.isFinite(rate) || rate <= 0) return;
    els.customRate.value = rate.toFixed(4);
    calculate();
  },
  onStatusChange: ({ loading, text }) => {
    els.apiRateDisplay.textContent = text;
    els.refreshIcon.classList.toggle('animate-spin', loading);
  },
  onToast: (msg) => showToast(msg),
  onRateLimit: () => showRateLimitTip(),
});

window.addEventListener('DOMContentLoaded', () => {
  try {
    initTheme();
    loadInputsFromStorage();
    initQuoteFields();
    initDates();
    rateManager.init(els.currency.value);
    setupEventListeners();
    calculate();
  } finally {
    hideAppLoader();
  }
});

function hideAppLoader() {
  const loader = document.getElementById('appLoader');
  if (!loader) return;
  requestAnimationFrame(() => {
    loader.classList.add('is-hidden');
    window.setTimeout(() => loader.remove(), 180);
  });
}

function setupEventListeners() {
  const debouncedSave = debounce(saveInputsToStorage, 500);

  [els.price, els.customRate].forEach((el) => {
    el.addEventListener('input', () => {
      calculate();
      debouncedSave();
    });
  });

  const datePairs = [
    { text: els.dueDate, picker: els.dueDatePicker, btn: els.dueDateCalendarBtn },
    { text: els.tradeDate, picker: els.tradeDatePicker, btn: els.tradeDateCalendarBtn },
  ];

  datePairs.forEach(({ text, picker, btn }) => {
    const openPicker = () => {
      if (!picker) return;
      const parsed = parseDateInput(text.value);
      if (parsed) picker.value = parsed;
      try {
        if (typeof picker.showPicker === 'function') {
          picker.showPicker();
        } else {
          picker.focus();
        }
      } catch (_) {
        picker.focus();
      }
    };

    if (btn) {
      btn.addEventListener('click', (e) => {
        e.preventDefault();
        openPicker();
      });
    }

    if (picker) {
      picker.addEventListener('change', () => {
        if (picker.value) {
          text.value = picker.value;
          text.classList.remove('input-invalid');
          calculate();
          saveInputsToStorage();
        }
      });
    }

    text.addEventListener('input', () => {
      const val = text.value.trim();
      const parsed = parseDateInput(val);
      if (parsed) {
        text.classList.remove('input-invalid');
        if (picker) picker.value = parsed;
      } else if (val.length >= 8) {
        text.classList.add('input-invalid');
      } else {
        text.classList.remove('input-invalid');
      }
      calculate();
      debouncedSave();
    });

    text.addEventListener('paste', () => {
      setTimeout(() => {
        const val = text.value.trim();
        const parsed = parseDateInput(val);
        if (parsed) {
          text.value = parsed;
          text.classList.remove('input-invalid');
          if (picker) picker.value = parsed;
          calculate();
          debouncedSave();
        }
      }, 0);
    });

    text.addEventListener('blur', () => {
      const val = text.value.trim();
      if (val === '') {
        text.classList.remove('input-invalid');
      } else {
        const parsed = parseDateInput(val);
        if (parsed) {
          text.value = parsed;
          text.classList.remove('input-invalid');
          if (picker) picker.value = parsed;
        } else {
          text.classList.add('input-invalid');
        }
      }
      calculate();
      saveInputsToStorage();
    });

    text.addEventListener('keydown', (e) => {
      if ((e.altKey && e.key === 'ArrowDown') || e.key === 'F4') {
        e.preventDefault();
        openPicker();
      }
    });
  });

  els.cycles.forEach((radio) => radio.addEventListener('change', () => {
    calculate();
    saveInputsToStorage();
  }));

  els.currency.addEventListener('change', () => {
    updateCurrencySymbol();
    rateManager.init(els.currency.value);
    calculate();
    saveInputsToStorage();
  });

  els.refreshBtn.addEventListener('click', () => rateManager.refresh(els.currency.value, true));
  els.themeToggle.addEventListener('click', toggleTheme);

  const copyAmountHandler = (e) => {
    if (e.type === 'keydown' && e.key !== 'Enter' && e.key !== ' ') return;
    if (e.type === 'keydown') e.preventDefault();
    copyFinalValueAmount();
  };

  els.finalValue.addEventListener('click', copyAmountHandler);
  els.finalValue.addEventListener('keydown', copyAmountHandler);
  if (els.copyAmountTrigger) {
    els.copyAmountTrigger.addEventListener('click', copyAmountHandler);
    els.copyAmountTrigger.addEventListener('keydown', copyAmountHandler);
  }

  [els.premiumInput, els.salePriceInput].forEach((el) => {
    el.addEventListener('input', () => {
      quoteLastEdited = el === els.salePriceInput ? 'sale' : 'premium';
      syncQuoteFields();
      debouncedSave();
    });

    el.addEventListener('blur', () => {
      syncQuoteFields({ formatActive: true });
      saveInputsToStorage();
    });
  });

  [els.price, els.customRate].forEach((el) => {
    el.addEventListener('input', () => validateNumberInput(el));
    validateNumberInput(el);
  });

  els.salePriceInput.addEventListener('input', () => validateNumberInput(els.salePriceInput));
  validateNumberInput(els.salePriceInput);

  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    if (!modal.el.classList.contains('hidden')) {
      closeExportModal(modal, modalLastFocused);
    }
    if (els.rateLimitTip.classList.contains('show')) hideRateLimitTip();
  });

  bindActionButtons();
}

function validateNumberInput(el) {
  const raw = el.value.trim();
  if (raw === '') {
    el.classList.remove('input-invalid');
    return true;
  }
  const v = parseFloat(raw);
  const ok = Number.isFinite(v) && v >= 0;
  el.classList.toggle('input-invalid', !ok);
  return ok;
}

function initQuoteFields() {
  updateQuotePlaceholders();
  syncQuoteFields();
}

function updatePremiumTone(value) {
  els.premiumInput.classList.remove('premium-positive', 'premium-negative', 'premium-neutral');
  if (!Number.isFinite(value) || value === 0) {
    els.premiumInput.classList.add('premium-neutral');
  } else if (value > 0) {
    els.premiumInput.classList.add('premium-positive');
  } else {
    els.premiumInput.classList.add('premium-negative');
  }
}

function updateSaleTone(isNeutral) {
  els.salePriceInput.classList.toggle('sale-neutral', isNeutral);
}

function updateQuotePlaceholders() {
  els.premiumInput.placeholder = '0.00';
  els.salePriceInput.placeholder = formatMoney(remainingValueCNY) || '0.00';
}

function syncQuoteFields(options = {}) {
  const { formatActive = false } = options;
  const premiumRaw = els.premiumInput.value.trim();
  const saleRaw = els.salePriceInput.value.trim();

  updateQuotePlaceholders();

  if (quoteLastEdited === 'sale') {
    const salePrice = parseQuoteValue(saleRaw);
    if (Number.isFinite(salePrice)) {
      const premium = salePrice - remainingValueCNY;
      els.premiumInput.value = formatMoney(premium);
      if (formatActive) els.salePriceInput.value = formatMoney(salePrice);
      updatePremiumTone(premium);
      updateSaleTone(false);
    } else {
      els.premiumInput.value = '';
      updatePremiumTone(NaN);
      updateSaleTone(true);
    }
    return;
  }

  const premium = premiumRaw === '' ? 0 : parseQuoteValue(els.premiumInput.value);

  if (Number.isFinite(premium)) {
    if (premiumRaw === '') {
      els.salePriceInput.value = '';
      updatePremiumTone(0);
      updateSaleTone(true);
      return;
    }

    const salePrice = remainingValueCNY + premium;
    els.salePriceInput.value = formatMoney(salePrice);
    if (formatActive) els.premiumInput.value = formatMoney(premium);
    updatePremiumTone(premium);
    updateSaleTone(premiumRaw === '' || premium === 0);
  } else {
    els.salePriceInput.value = '';
    updatePremiumTone(NaN);
    updateSaleTone(true);
  }
}

function debounce(func, wait) {
  let timeout;
  return function (...args) {
    clearTimeout(timeout);
    timeout = setTimeout(() => func.apply(this, args), wait);
  };
}

function initTheme() {
  if (
    localStorage.theme === 'dark' ||
    (!('theme' in localStorage) && window.matchMedia('(prefers-color-scheme: dark)').matches)
  ) {
    document.documentElement.classList.add('dark');
    updateToggleUI(true);
  } else {
    document.documentElement.classList.remove('dark');
    updateToggleUI(false);
  }
}

function toggleTheme() {
  const isDark = document.documentElement.classList.toggle('dark');
  localStorage.theme = isDark ? 'dark' : 'light';
  updateToggleUI(isDark);
}

function updateToggleUI(isDark) {
  if (isDark) {
    els.themeToggleKnob.classList.add('translate-x-6');
    els.themeToggleKnob.classList.remove('translate-x-1');
  } else {
    els.themeToggleKnob.classList.remove('translate-x-6');
    els.themeToggleKnob.classList.add('translate-x-1');
  }
}

function saveInputsToStorage() {
  const data = {
    price: els.price.value,
    currency: els.currency.value,
    cycle: Array.from(els.cycles).find((r) => r.checked)?.value || '365',
    dueDate: els.dueDate.value,
    tradeDate: els.tradeDate.value,
    customRate: els.customRate.value,
    premium: els.premiumInput.value,
    salePrice: els.salePriceInput.value,
    quoteLastEdited,
  };
  setStorageWithTTL('vps_inputs', JSON.stringify(data), INPUT_CACHE_HOURS);
}

function loadInputsFromStorage() {
  const saved = getStorageWithTTL('vps_inputs');
  if (!saved) return;

  try {
    const data = JSON.parse(saved);
    if (data.price) els.price.value = data.price;
    if (data.currency) els.currency.value = data.currency;
    if (data.dueDate) {
      els.dueDate.value = data.dueDate;
      const parsed = parseDateInput(data.dueDate);
      if (parsed && els.dueDatePicker) els.dueDatePicker.value = parsed;
    }
    if (data.tradeDate) {
      els.tradeDate.value = data.tradeDate;
      const parsed = parseDateInput(data.tradeDate);
      if (parsed && els.tradeDatePicker) els.tradeDatePicker.value = parsed;
    }
    if (data.customRate) els.customRate.value = data.customRate;
    if (data.quoteLastEdited === 'sale' || data.quoteLastEdited === 'premium') {
      quoteLastEdited = data.quoteLastEdited;
      if (quoteLastEdited === 'sale' && data.salePrice) {
        els.salePriceInput.value = data.salePrice;
      } else if (
        quoteLastEdited === 'premium' &&
        data.premium &&
        parseFloat(data.premium) !== 0
      ) {
        els.premiumInput.value = data.premium;
      }
    }
    if (data.cycle) {
      const radio = document.querySelector(`input[name="cycle"][value="${data.cycle}"]`);
      if (radio) radio.checked = true;
    }
    updateCurrencySymbol();
  } catch (_) {
    localStorage.removeItem('vps_inputs');
  }
}

function showRateLimitTip() {
  els.rateLimitTip.classList.add('show');
  if (rateLimitTimer) clearTimeout(rateLimitTimer);
  rateLimitTimer = setTimeout(() => {
    hideRateLimitTip();
  }, 2000);
}

function hideRateLimitTip() {
  els.rateLimitTip.classList.remove('show');
  if (rateLimitTimer) {
    clearTimeout(rateLimitTimer);
    rateLimitTimer = null;
  }
}

function showToast(msg) {
  els.toast.textContent = msg;
  els.toast.classList.add('show');
  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    els.toast.classList.remove('show');
    toastTimer = null;
  }, 2000);
}

function initDates() {
  const now = new Date();
  const todayStr = formatDate(now);
  if (!els.tradeDate.value) {
    els.tradeDate.value = todayStr;
  }
  const tradeParsed = parseDateInput(els.tradeDate.value);
  if (tradeParsed) {
    els.tradeDate.value = tradeParsed;
    if (els.tradeDatePicker) els.tradeDatePicker.value = tradeParsed;
  }

  if (!els.dueDate.value) {
    const targetDueDate = getNextBlackFriday(now);
    const targetStr = formatDate(targetDueDate);
    els.dueDate.value = targetStr;
  }
  const dueParsed = parseDateInput(els.dueDate.value);
  if (dueParsed) {
    els.dueDate.value = dueParsed;
    if (els.dueDatePicker) els.dueDatePicker.value = dueParsed;
  }
}

function updateCurrencySymbol() {
  const code = els.currency.value;
  const sym = CURRENCY_SYMBOLS[code] || code;
  els.symbolDisplay.textContent = sym;
  if (symbolPaddingRaf) cancelAnimationFrame(symbolPaddingRaf);
  symbolPaddingRaf = requestAnimationFrame(() => {
    symbolPaddingRaf = 0;
    const symRect = els.symbolDisplay.getBoundingClientRect();
    const inputRect = els.price.getBoundingClientRect();
    const neededPad = symRect.right - inputRect.left + 6;
    els.price.style.paddingLeft = `${Math.max(neededPad, 32)}px`;
  });
}

function calculate() {
  const priceRaw = parseFloat(els.price.value);
  const rateRaw = parseFloat(els.customRate.value);
  const price = Number.isFinite(priceRaw) && priceRaw >= 0 ? priceRaw : 0;
  const rate = Number.isFinite(rateRaw) && rateRaw > 0 ? rateRaw : 0;

  let cycleDays = 365;
  for (const radio of els.cycles) {
    if (radio.checked) {
      cycleDays = parseInt(radio.value, 10);
      break;
    }
  }

  const result = calculateValuation({
    price,
    rate,
    cycleDays,
    dueDateStr: els.dueDate.value,
    tradeDateStr: els.tradeDate.value,
  });

  els.priceCNYPreview.textContent = `≈${result.totalCNY.toFixed(2)}元`;

  if (els.dailyPricePreview) {
    if (price > 0 && cycleDays > 0) {
      const sym = CURRENCY_SYMBOLS[els.currency.value] || els.currency.value;
      if (els.currency.value === 'CNY') {
        els.dailyPricePreview.textContent = `日均 ≈ ¥${result.dailyPriceCNY.toFixed(2)}/天`;
      } else {
        els.dailyPricePreview.textContent = `日均 ≈ ¥${result.dailyPriceCNY.toFixed(2)}/天（${sym}${result.dailyPrice.toFixed(2)}）`;
      }
    } else {
      els.dailyPricePreview.textContent = `日均 ≈ ¥0.00/天`;
    }
  }

  if (!result.isValidDates) {
    remainingValueCNY = 0;
    setFinalValueDisplay('0.00');
    els.originalCurrencyValue.textContent = '请填写到期日 / 交易日';
    els.daysRemaining.textContent = '--';
    els.progressBar.style.width = '0%';
    els.progressText.textContent = '--';
    syncQuoteFields();
    return;
  }

  els.progressBar.style.width = `${result.progressPct}%`;
  remainingValueCNY = result.valCNY;
  setFinalValueDisplay(result.valCNY.toFixed(2));
  els.originalCurrencyValue.textContent = `≈ ${result.valOrig.toFixed(2)} ${els.currency.value}`;
  els.daysRemaining.textContent = result.rawDiffDays > 0 ? String(result.rawDiffDays) : '0';
  els.progressText.textContent = `${result.displayProgressPct}%`;
  syncQuoteFields();
}

function setFinalValueDisplay(value) {
  els.finalValue.textContent = value;
  const numericLength = value.replace(/[^0-9]/g, '').length;
  const isLongValue = numericLength >= 7;
  els.finalValue.classList.toggle('final-value-long', isLongValue);
  els.finalValue.closest('.result-amount-row')?.classList.toggle('final-value-row-long', isLongValue);
}

function copyResult() {
  const cycleRadio = Array.from(els.cycles).find((r) => r.checked);
  const cycleText = (cycleRadio && CYCLE_LABELS[cycleRadio.value]) || '年付';

  const report = generateMarkdownReport({
    price: els.price.value,
    currency: els.currency.value,
    rate: els.customRate.value,
    cycleText,
    cycleDays: cycleRadio?.value || 365,
    tradeDate: els.tradeDate.value,
    dueDate: els.dueDate.value,
    daysRemaining: els.daysRemaining.textContent,
    valCNY: els.finalValue.textContent,
    valOrig: els.originalCurrencyValue.textContent.replace('≈', '').trim().split(' ')[0],
    premium: els.premiumInput.value.trim(),
    salePrice: els.salePriceInput.value.trim(),
  });

  copyTextToClipboard(report, flashCopyButton);
}

function copyTextToClipboard(text, done) {
  const fallbackCopy = () => {
    const textArea = document.createElement('textarea');
    textArea.value = text;
    textArea.setAttribute('readonly', '');
    textArea.style.position = 'fixed';
    textArea.style.opacity = '0';
    document.body.appendChild(textArea);
    textArea.select();
    try {
      document.execCommand('copy');
    } catch (_) {}
    document.body.removeChild(textArea);
  };

  if (navigator.clipboard && window.isSecureContext) {
    navigator.clipboard
      .writeText(text)
      .then(done)
      .catch(() => {
        fallbackCopy();
        done();
      });
  } else {
    fallbackCopy();
    done();
  }
}

function copyFinalValueAmount() {
  const amount = els.finalValue.textContent.trim();
  if (!amount) return;
  copyTextToClipboard(amount, flashAmountCopyTip);
}

function flashAmountCopyTip() {
  if (!els.amountCopyTip) return;
  const textEl = document.getElementById('amountCopyTipText');
  const originalText = textEl ? textEl.textContent : '点击复制';
  if (textEl) textEl.textContent = '已复制 ✓';
  els.amountCopyTip.classList.add('amount-copied');
  clearTimeout(flashAmountCopyTip._t);
  flashAmountCopyTip._t = setTimeout(() => {
    if (textEl) textEl.textContent = originalText;
    els.amountCopyTip.classList.remove('amount-copied');
  }, 1500);
}

function flashCopyButton() {
  const btn = document.getElementById('copyBtn');
  if (!btn) return;
  const label = btn.querySelector('span');
  const originalText = label ? label.textContent : '';
  btn.classList.add('btn-copied');
  if (label) label.textContent = '已复制 ✓';
  clearTimeout(flashCopyButton._t);
  flashCopyButton._t = setTimeout(() => {
    btn.classList.remove('btn-copied');
    if (label) label.textContent = originalText;
  }, 1500);
}

// 绑定操作按钮
function bindActionButtons() {
  const copyBtn = document.getElementById('copyBtn');
  if (copyBtn) copyBtn.addEventListener('click', copyResult);

  const imgBtn = document.getElementById('imgBtn');
  if (imgBtn) {
    imgBtn.addEventListener('click', () => {
      exportCardAsImage({
        captureRoot: document.getElementById('captureRoot'),
        mainCard: document.getElementById('mainCard'),
        premiumInputValue: els.premiumInput.value,
        dueDateValue: els.dueDate.value,
        modal,
        onToast: showToast,
      });
    });

    const prefetch = () => {
      imgBtn.removeEventListener('pointerenter', prefetch);
      imgBtn.removeEventListener('focus', prefetch);
      try {
        getHtmlToImage();
      } catch (_) {}
    };
    imgBtn.addEventListener('pointerenter', prefetch, { once: true });
    imgBtn.addEventListener('focus', prefetch, { once: true });
  }

  const closeBtn = document.getElementById('closeImageModalBtn');
  if (closeBtn) {
    closeBtn.addEventListener('click', () => closeExportModal(modal, modalLastFocused));
  }

  modal.el.addEventListener('click', (e) => {
    if (e.target === modal.el) closeExportModal(modal, modalLastFocused);
  });

  // 焦点陷阱
  modal.el.addEventListener('keydown', (e) => {
    if (e.key !== 'Tab' || modal.el.classList.contains('hidden')) return;
    const focusables = modal.el.querySelectorAll('button, a[href], [tabindex]:not([tabindex="-1"])');
    if (!focusables.length) return;
    const first = focusables[0];
    const last = focusables[focusables.length - 1];
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  });
}
