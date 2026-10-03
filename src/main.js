import './style.css';

const API_URL = 'https://open.er-api.com/v6/latest/CNY';
// 汇率本地缓存时长（小时）。免费 API 一般每天更新一次，12h 足够。
const RATE_CACHE_HOURS = 12;
// 用户表单本地保存时长（小时）。表单数据属长任务型输入，保存窗口需远大于
// 单次会话；过短会让用户填写的内容静默丢失。
const INPUT_CACHE_HOURS = 12;
// 用户手动刷新汇率次数上限。窗口与缓存时长解耦：6h 内最多 3 次，
// 既避免误触刷爆免费 API 配额，也不会让用户等太久。
const RATE_LIMIT_WINDOW_HOURS = 6;
const MANUAL_REFRESH_LIMIT = 3;
// 付款周期文案映射。复制 Markdown 时按 radio.value 查表取值，
// 不依赖 DOM 层级/innerText（HTML 结构调整不会让复制文本变空）。
const CYCLE_LABELS = {
    '30': '月付',
    '90': '季付',
    '180': '半年',
    '365': '年付',
    '730': '两年',
    '1095': '三年'
};
const SHARE_IMAGE_MIME_TYPE = 'image/webp';
const SHARE_IMAGE_QUALITY = 0.98;
// 导出图片的最低像素比与目标物理宽度。手机端 CSS 宽度通常仅 ~360px，
// 若固定 pixelRatio=2 输出仅 ~720px 会发糊。这里按卡片实际 CSS 宽度动态
// 计算 pixelRatio，保证输出至少 SHARE_IMAGE_MIN_WIDTH 物理像素宽。
const SHARE_IMAGE_MIN_PIXEL_RATIO = 2;
const SHARE_IMAGE_MAX_PIXEL_RATIO = 4;
// 低内存设备（deviceMemory <= 4GB 或窄屏）限制 pixelRatio，避免导出时内存峰值过高造成卡顿
// 股眼几乎看不出 3x 与 4x 的区别
const SHARE_IMAGE_LOW_END_MAX_PIXEL_RATIO = 3;
const SHARE_IMAGE_MIN_WIDTH = 1440;
let htmlToImageModulePromise = null;
let generatedImageUrl = '';

const currencySymbols = {
    'USD': '$', 'EUR': '\u20AC', 'GBP': '\u00A3', 'JPY': '\u00A5',
    'CNY': '\u00A5', 'HKD': 'HK$', 'AUD': 'A$', 'SGD': 'S$',
    'KRW': '\u20A9', 'TWD': 'NT$', 'CAD': 'C$'
};

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
    premiumInput: document.getElementById('premiumInput'),
    salePriceInput: document.getElementById('salePriceInput'),
    daysRemaining: document.getElementById('daysRemaining'),
    progressBar: document.getElementById('progressBar'),
    progressText: document.getElementById('progressText'),
    priceCNYPreview: document.getElementById('priceCNYPreview'),
    toast: document.getElementById('toast'),
    rateLimitTip: document.getElementById('rateLimitTip'),
    themeToggle: document.getElementById('themeToggle'),
    themeToggleKnob: document.getElementById('themeToggleKnob')
};

let rateLimitTimer = null;
let toastTimer = null;
let symbolPaddingRaf = 0;
let remainingValueCNY = 0;
let quoteLastEdited = 'premium';

window.addEventListener('DOMContentLoaded', () => {
    try {
        initTheme();
        loadInputsFromCookie(); 
        initQuoteFields();
        initDates(); 
        initRates(); 
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
    const debouncedSave = debounce(saveInputsToCookie, 500);

    [els.price, els.customRate].forEach(el => el.addEventListener('input', () => {
        calculate();
        debouncedSave();
    }));

    const datePairs = [
        { text: els.dueDate, picker: els.dueDatePicker, btn: els.dueDateCalendarBtn },
        { text: els.tradeDate, picker: els.tradeDatePicker, btn: els.tradeDateCalendarBtn }
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
                    saveInputsToCookie();
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
            saveInputsToCookie();
        });

        text.addEventListener('keydown', (e) => {
            if ((e.altKey && e.key === 'ArrowDown') || e.key === 'F4') {
                e.preventDefault();
                openPicker();
            }
        });
    });

    els.cycles.forEach(radio => radio.addEventListener('change', () => {
        calculate();
        saveInputsToCookie();
    }));

    els.currency.addEventListener('change', () => {
        updateCurrencySymbol();
        initRates(); 
        calculate();
        saveInputsToCookie();
    });

    els.refreshBtn.addEventListener('click', manualRefreshRate); 
    els.themeToggle.addEventListener('click', toggleTheme);
    els.finalValue.addEventListener('click', copyFinalValueAmount);
    els.finalValue.addEventListener('keydown', (e) => {
        if (e.key !== 'Enter' && e.key !== ' ') return;
        e.preventDefault();
        copyFinalValueAmount();
    });

    [els.premiumInput, els.salePriceInput].forEach(el => {
        el.addEventListener('input', () => {
            quoteLastEdited = el === els.salePriceInput ? 'sale' : 'premium';
            syncQuoteFields();
            debouncedSave();
        });

        el.addEventListener('blur', () => {
            syncQuoteFields({ formatActive: true });
            saveInputsToCookie();
        });
    });

    // 价格 / 汇率 输入校验：负数或非法时高亮红边
    [els.price, els.customRate].forEach(el => {
        el.addEventListener('input', () => validateNumberInput(el));
        validateNumberInput(el);
    });

    els.salePriceInput.addEventListener('input', () => validateNumberInput(els.salePriceInput));
    validateNumberInput(els.salePriceInput);

    // ESC 关闭模态 / 限流提示
    document.addEventListener('keydown', (e) => {
        if (e.key !== 'Escape') return;
        if (!modal.el.classList.contains('hidden')) closeImageModal();
        if (els.rateLimitTip.classList.contains('show')) hideRateLimitTip();
    });
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

function parseQuoteValue(value) {
    if (typeof value !== 'string' || value.trim() === '') return NaN;
    return parseFloat(value);
}

function formatMoney(value) {
    return Number.isFinite(value) ? value.toFixed(2) : '';
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
    return function(...args) {
        clearTimeout(timeout);
        timeout = setTimeout(() => func.apply(this, args), wait);
    };
}

function initTheme() {
    if (localStorage.theme === 'dark' || (!('theme' in localStorage) && window.matchMedia('(prefers-color-scheme: dark)').matches)) {
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

// 注意：函数名沿用历史命名（setCookie / getCookie），实际底层是 localStorage + 过期时间。
function setCookie(name, value, hours) {
    const expiresAt = Date.now() + (hours * 60 * 60 * 1000);
    localStorage.setItem(name, JSON.stringify({ value, expiresAt }));
}

function getCookie(name) {
    const stored = localStorage.getItem(name);
    if (stored) {
        try {
            const parsed = JSON.parse(stored);
            if (!parsed.expiresAt || parsed.expiresAt > Date.now()) {
                return parsed.value || "";
            }
            localStorage.removeItem(name);
        } catch (e) {
            localStorage.removeItem(name);
        }
    }
    return "";
}

async function getHtmlToImage() {
    if (!htmlToImageModulePromise) {
        htmlToImageModulePromise = import('html-to-image');
    }

    return htmlToImageModulePromise;
}

function canvasToBlob(canvas, type, quality) {
    return new Promise((resolve, reject) => {
        canvas.toBlob((blob) => {
            if (blob) {
                resolve(blob);
            } else {
                reject(new Error(`Canvas export failed: ${type}`));
            }
        }, type, quality);
    });
}

function resetGeneratedImage() {
    if (generatedImageUrl) {
        URL.revokeObjectURL(generatedImageUrl);
    }
    generatedImageUrl = '';
}

function formatDateForDisplay(value) {
    const parsed = parseDateInput(value);
    return parsed || value || 'YYYY-MM-DD';
}

/*
 * 导出前的临时 DOM 改写统一走这个工厂：调用方在 visit 里改 DOM 并返回
 * 还原闭包，所有还原任务按相反顺序执行（保证嵌套改动能正确回滚）。
 * 四个 prepare*ForExport 共用同一套累加/回滚逻辑，避免重复四份。
 */
function createExportRestorer(visit) {
    const restoreTasks = [];
    visit((restore) => restoreTasks.push(restore));
    return () => restoreTasks.reverse().forEach((restore) => restore());
}

function prepareDateInputsForExport(node) {
    return createExportRestorer((addRestore) => {
        node.querySelectorAll('.date-input-wrapper').forEach((wrapper) => {
            const input = wrapper.querySelector('input.date-native-input');
            const btn = wrapper.querySelector('.date-input-btn');
            if (btn) {
                btn.style.display = 'none';
                addRestore(() => { btn.style.display = ''; });
            }
            if (input) {
                const display = document.createElement('div');
                display.className = 'date-display-export';
                const cs = window.getComputedStyle(input);
                display.style.paddingLeft = cs.paddingLeft;
                display.style.paddingRight = cs.paddingRight;
                display.textContent = formatDateForDisplay(input.value);
                input.style.display = 'none';
                wrapper.insertBefore(display, input);

                addRestore(() => {
                    input.style.display = '';
                    display.remove();
                });
            }
        });
    });
}

/*
 * html-to-image 序列化时无法可靠保留 -webkit-/-moz-appearance 这类伪元素相关样式，
 * Firefox 截图里 number input 会重新出现上下调节按钮。导出前用 div 替换，导出后还原。
 */
function prepareNumberInputsForExport(node) {
    return createExportRestorer((addRestore) => {
        node.querySelectorAll('input[type="number"]').forEach((input) => {
            const display = document.createElement('div');
            display.className = input.className;
            const cs = window.getComputedStyle(input);
            // 保留输入框的对齐方式（部分 number 框是居中显示的）
            display.style.display = 'flex';
            display.style.alignItems = 'center';
            display.style.justifyContent = cs.textAlign === 'center'
                ? 'center'
                : (cs.textAlign === 'right' ? 'flex-end' : 'flex-start');
            // 保留动态计算的左内边距，防止多字符货币符号（如 NT$）在截图时与数值重叠
            display.style.paddingLeft = cs.paddingLeft;
            display.textContent = input.value || input.placeholder || '';
            input.style.display = 'none';
            input.parentElement && input.parentElement.insertBefore(display, input);

            addRestore(() => {
                input.style.display = '';
                display.remove();
            });
        });
    });
}

/*
 * 用 Canvas 预生成一张卡片投影 PNG 贴到卡片后：html-to-image 渲染的是同一张
 * 位图，不受 Safari 丢弃 box-shadow / 离屏下 filter 不渲染的影响，保证跨端一致。
 */
function prepareExportShadow(root, mainCard) {
    const rootRect = root.getBoundingClientRect();
    const cardRect = mainCard.getBoundingClientRect();
    const pad = 24;
    const width = Math.max(1, Math.ceil(cardRect.width) + pad * 2);
    const height = Math.max(1, Math.ceil(cardRect.height) + pad * 2);
    const radius = 22;
    const isDark = document.documentElement.classList.contains('dark');
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    ctx.save();
    ctx.shadowColor = isDark ? 'rgba(0, 0, 0, 0.42)' : 'rgba(15, 23, 42, 0.2)';
    ctx.shadowBlur = 26;
    ctx.shadowOffsetY = 8;
    ctx.fillStyle = isDark ? '#18181e' : '#f7f8fa';
    const x = pad;
    const y = pad;
    const rw = cardRect.width;
    const rh = cardRect.height;
    ctx.beginPath();
    ctx.moveTo(x + radius, y);
    ctx.arcTo(x + rw, y, x + rw, y + rh, radius);
    ctx.arcTo(x + rw, y + rh, x, y + rh, radius);
    ctx.arcTo(x, y + rh, x, y, radius);
    ctx.arcTo(x, y, x + rw, y, radius);
    ctx.closePath();
    ctx.fill();
    ctx.restore();

    const url = canvas.toDataURL('image/png');
    const shadow = document.createElement('div');
    shadow.className = 'export-card-shadow';
    shadow.style.left = `${cardRect.left - rootRect.left - pad}px`;
    shadow.style.top = `${cardRect.top - rootRect.top - pad}px`;
    shadow.style.width = `${width}px`;
    shadow.style.height = `${height}px`;
    shadow.style.backgroundImage = `url(${url})`;
    root.insertBefore(shadow, mainCard);
    return () => { shadow.remove(); };
}

function prepareQuoteSectionForExport(mainCard) {
    const premium = parseQuoteValue(els.premiumInput.value);
    const shouldHideQuote = !Number.isFinite(premium) || premium === 0;
    mainCard.classList.toggle('quote-export-empty', shouldHideQuote);

    return () => {
        mainCard.classList.remove('quote-export-empty');
    };
}

function prepareSelectInputsForExport(node) {
    return createExportRestorer((addRestore) => {
        node.querySelectorAll('select').forEach((select) => {
            const selectedValue = select.value;
            const selectedIndex = select.selectedIndex;
            const optionSnapshots = Array.from(select.options).map((option) => ({
                defaultSelected: option.defaultSelected,
                hasSelectedAttr: option.hasAttribute('selected')
            }));

            Array.from(select.options).forEach((option) => {
                const isCurrent = option.value === select.value;
                option.defaultSelected = isCurrent;
                option.toggleAttribute('selected', isCurrent);
            });

            addRestore(() => {
                Array.from(select.options).forEach((option, index) => {
                    const snapshot = optionSnapshots[index];
                    option.defaultSelected = snapshot.defaultSelected;
                    option.toggleAttribute('selected', snapshot.hasSelectedAttr);
                });
                select.value = selectedValue;
                if (select.value !== selectedValue) select.selectedIndex = selectedIndex;
            });
        });
    });
}

function saveInputsToCookie() {
    const data = {
        price: els.price.value,
        currency: els.currency.value,
        cycle: Array.from(els.cycles).find(r => r.checked)?.value || "365",
        dueDate: els.dueDate.value,
        tradeDate: els.tradeDate.value,
        customRate: els.customRate.value,
        premium: els.premiumInput.value,
        salePrice: els.salePriceInput.value,
        quoteLastEdited
    };
    // 12 小时：表单是长任务型数据，30 分钟会静默丢失用户输入。
    // 时长用命名常量表达意图，避免再次误写成 0.5（小时）。
    setCookie("vps_inputs", JSON.stringify(data), INPUT_CACHE_HOURS);
}

function loadInputsFromCookie() {
    const saved = getCookie("vps_inputs");
    if (saved) {
        try {
            const data = JSON.parse(saved);
            if(data.price) els.price.value = data.price;
            if(data.currency) els.currency.value = data.currency;
            if(data.dueDate) {
                els.dueDate.value = data.dueDate;
                const parsed = parseDateInput(data.dueDate);
                if (parsed && els.dueDatePicker) els.dueDatePicker.value = parsed;
            }
            if(data.tradeDate) {
                els.tradeDate.value = data.tradeDate;
                const parsed = parseDateInput(data.tradeDate);
                if (parsed && els.tradeDatePicker) els.tradeDatePicker.value = parsed;
            }
            if(data.customRate) els.customRate.value = data.customRate;
            if(data.quoteLastEdited === 'sale' || data.quoteLastEdited === 'premium') {
                quoteLastEdited = data.quoteLastEdited;
                if (quoteLastEdited === 'sale' && data.salePrice) {
                    els.salePriceInput.value = data.salePrice;
                } else if (quoteLastEdited === 'premium' && data.premium && parseFloat(data.premium) !== 0) {
                    els.premiumInput.value = data.premium;
                }
            }
            if(data.cycle) {
                const radio = document.querySelector(`input[name="cycle"][value="${data.cycle}"]`);
                if(radio) radio.checked = true;
            }
            updateCurrencySymbol();
        } catch(e) {
            // 解析失败时忽略旧数据即可，不应把内部错误打到用户控制台
            localStorage.removeItem("vps_inputs");
        }
    }
}

async function initRates() {
    const base = els.currency.value;
    if (base === 'CNY') {
        finishRateUpdate(1);
        return;
    }

    const cacheKey = `vps_rate_${base}`;
    const cachedData = getCookie(cacheKey);

    if (cachedData) {
        let data = null;
        try {
            data = JSON.parse(cachedData);
        } catch (e) {
            data = null;
        }
        // 缓存内容做类型校验：脏数据直接走网络刷新，而不是把异常吞掉后留下空汇率
        if (data && Number.isFinite(data.rate) && data.rate > 0) {
            finishRateUpdate(data.rate);
        } else {
            manualRefreshRate(false);
        }
    } else {
        manualRefreshRate(false);
    }
}

async function manualRefreshRate(isUserClick = true) {
    const base = els.currency.value;
    if (base === 'CNY') return;

    const limitKey = "vps_refresh_limit";
    const rawLimit = getCookie(limitKey);
    let limitData = { count: 0, resetTime: Date.now() + 12*3600*1000 };

    if (rawLimit) {
        try {
            const parsed = JSON.parse(rawLimit);
            if (parsed.resetTime && Date.now() < parsed.resetTime) {
                limitData = parsed;
            } else {
                limitData = { count: 0, resetTime: Date.now() + RATE_LIMIT_WINDOW_HOURS*3600*1000 };
            }
        } catch(e) {}
    }

    if (isUserClick) {
        if (limitData.count >= MANUAL_REFRESH_LIMIT) {
            showRateLimitTip();
            return;
        }
        limitData.count++;
        const hoursLeft = (limitData.resetTime - Date.now()) / (1000*3600);
        setCookie(limitKey, JSON.stringify(limitData), Math.max(0.1, hoursLeft));
    }

    await fetchExchangeRate();
}

async function fetchExchangeRate() {
    const base = els.currency.value;
    els.refreshIcon.classList.add('animate-spin');
    els.apiRateDisplay.textContent = "刷新中";

    // 免费 API 偶发挂起，无超时会让刷新图标永久旋转。8s 足够覆盖正常响应。
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 8000);

    try {
        const response = await fetch(API_URL, { signal: controller.signal });
        const data = await response.json();
        
        if (data.result === "success") {
            const baseInCNY = data.rates && data.rates[base];
            if (typeof baseInCNY === 'number' && baseInCNY > 0 && Number.isFinite(baseInCNY)) {
                const rate = 1 / baseInCNY;
                finishRateUpdate(rate);
                
                const cacheData = JSON.stringify({ rate: rate, time: Date.now() });
                setCookie(`vps_rate_${base}`, cacheData, RATE_CACHE_HOURS);
                saveInputsToCookie();
            } else {
                throw new Error("Invalid rate value");
            }
        } else {
            throw new Error("API Error");
        }
    } catch (error) {
        // 失败已通过 toast 告知用户；控制台不再重复打印堆栈
        els.apiRateDisplay.textContent = "汇率刷新";
        els.refreshIcon.classList.remove('animate-spin');
        showToast(error && error.name === 'AbortError' ? "汇率接口超时" : "获取汇率失败");
    } finally {
        clearTimeout(timeoutId);
    }
}

function finishRateUpdate(rate) {
    // 缓存数据可能被旧版本写坏，显式校验避免把 NaN 之类写进输入框
    if (!Number.isFinite(rate) || rate <= 0) {
        els.refreshIcon.classList.remove('animate-spin');
        return;
    }
    els.customRate.value = rate.toFixed(4);
    els.apiRateDisplay.textContent = "汇率刷新";
    els.refreshIcon.classList.remove('animate-spin');
    calculate();
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
    // 清除上一次的定时器：否则前一个 timer 到期会把当前 toast 提前收起，
    // 导致连续提示时第二条只显示一小段时间。
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
        els.toast.classList.remove('show');
        toastTimer = null;
    }, 2000);
}

function getBlackFriday(year) {
    const novemberFirst = new Date(year, 10, 1);
    const firstThursday = 1 + ((4 - novemberFirst.getDay() + 7) % 7);
    const thanksgivingDay = firstThursday + 21;
    return new Date(year, 10, thanksgivingDay + 1);
}

function getNextBlackFriday(date) {
    const currentYearBlackFriday = getBlackFriday(date.getFullYear());
    return date.getTime() < currentYearBlackFriday.getTime()
        ? currentYearBlackFriday
        : getBlackFriday(date.getFullYear() + 1);
}

function parseDateInput(value) {
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

function formatDate(date) {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
}

function updateCurrencySymbol() {
    const code = els.currency.value;
    const sym = currencySymbols[code] || code;
    els.symbolDisplay.textContent = sym;
    // 取消上一次未执行的回调：连续切换币种时只按最新符号量一次 padding，
    // 避免旧回调覆盖新结果造成符号与输入文本重叠。
    if (symbolPaddingRaf) cancelAnimationFrame(symbolPaddingRaf);
    symbolPaddingRaf = requestAnimationFrame(() => {
        symbolPaddingRaf = 0;
        const symRect = els.symbolDisplay.getBoundingClientRect();
        const inputRect = els.price.getBoundingClientRect();
        const neededPad = symRect.right - inputRect.left + 6;
        els.price.style.paddingLeft = Math.max(neededPad, 32) + 'px';
    });
}

function calculate() {
    const priceRaw = parseFloat(els.price.value);
    const rateRaw = parseFloat(els.customRate.value);
    const price = Number.isFinite(priceRaw) && priceRaw >= 0 ? priceRaw : 0;
    const rate = Number.isFinite(rateRaw) && rateRaw > 0 ? rateRaw : 0;
    const dueIso = parseDateInput(els.dueDate.value);
    const tradeIso = parseDateInput(els.tradeDate.value);

    let cycleDays = 365;
    for (const radio of els.cycles) {
        if (radio.checked) { cycleDays = parseInt(radio.value); break; }
    }

    const totalCNY = price * rate;
    els.priceCNYPreview.textContent = `≈${totalCNY.toFixed(2)}元`;

    // 空 / 非法日期：清空结果区，给出占位提示
    if (!dueIso || !tradeIso) {
        remainingValueCNY = 0;
        setFinalValueDisplay('0.00');
        els.originalCurrencyValue.textContent = '请填写到期日 / 交易日';
        els.daysRemaining.textContent = '--';
        els.progressBar.style.width = '0%';
        els.progressText.textContent = '--';
        syncQuoteFields();
        return;
    }

    const due = new Date(dueIso + 'T00:00:00');
    const trade = new Date(tradeIso + 'T00:00:00');

    const diffTime = due - trade;
    const rawDiffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
    const dailyPrice = cycleDays > 0 ? price / cycleDays : 0;

    let valOrig = 0, valCNY = 0;

    // 支持提前续费 / 续费多年：当剩余天数超过单期付款周期时（如年付机器续费了两年），
    // 剩余价值按实际剩余天数完整计算（日单价 * 剩余天数），不截断为单期周期上限。
    const effectiveDays = Math.max(0, rawDiffDays);

    if (effectiveDays > 0) {
        valOrig = dailyPrice * effectiveDays;
        valCNY = valOrig * rate;
    }

    // 进度条语义：当前续费周期内的「剩余比例」。剩余天数如实展示（rawDiffDays），
    // 但百分比必须收敛到 [0, 100]：避免进度条视觉溢出。
    let progressPct;
    let displayProgressPct;
    if (rawDiffDays <= 0) {
        progressPct = 0;
        displayProgressPct = 0;
    } else {
        displayProgressPct = Math.min(100, Math.max(1, Math.round((rawDiffDays / cycleDays) * 100)));
        progressPct = displayProgressPct;
    }

    els.progressBar.style.width = `${progressPct}%`;
    remainingValueCNY = valCNY;
    setFinalValueDisplay(valCNY.toFixed(2));
    els.originalCurrencyValue.textContent = `≈ ${valOrig.toFixed(2)} ${els.currency.value}`;
    els.daysRemaining.textContent = rawDiffDays > 0 ? rawDiffDays : '0';
    els.progressText.textContent = `${displayProgressPct}%`;
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
    const price = els.price.value || "0";
    const currency = els.currency.value;
    const rateNum = parseFloat(els.customRate.value);
    const rate = Number.isFinite(rateNum) && rateNum > 0 ? els.customRate.value : "1";
    const days = els.daysRemaining.textContent;
    const valCNY = els.finalValue.textContent;
    const valOrig = els.originalCurrencyValue.textContent.replace('≈', '').trim().split(' ')[0];
    const premium = els.premiumInput.value.trim();
    const salePrice = els.salePriceInput.value.trim();
    const tradeDate = els.tradeDate.value;
    const dueDate = els.dueDate.value;

    // 按 radio.value 查表，避免依赖 label 的 innerText（DOM 重构会让文案变空）
    const cycleRadio = Array.from(els.cycles).find(r => r.checked);
    const cycleText = (cycleRadio && CYCLE_LABELS[cycleRadio.value]) || "年付";

    // 日期格式固定为 YYYY-MM-DD
    const fmtDate = (v) => {
        const parsed = parseDateInput(v);
        return parsed || v || '未设置';
    };
    const cnyPrice = (parseFloat(price) * parseFloat(rate)).toFixed(2);

    const lines = [
        `## 🐔 VPS 剩余价值`,
        `- 📅 交易日期：${fmtDate(tradeDate)}`,
        `- 💹 外币汇率：1 ${currency} ≈ ${rate} CNY`,
        `- 💰 续费价格：${price} ${currency}/${cycleText}（约 ${cnyPrice} 元）`
    ];

    // 到期日未填时不输出“--天（ 到期）”这类无意义内容
    if (dueDate && parseDateInput(dueDate)) {
        lines.push(`- ⏳ 剩余天数：${days} 天（${fmtDate(dueDate)} 到期）`);
    } else {
        lines.push(`- ⏳ 剩余天数：未设置到期日`);
    }

    lines.push(`- 💎 剩余价值：${valCNY} 元（约 ${valOrig} ${currency}）`);

    // 溢价与总价均未填时不输出“0.00 / 123.07”——那会被读成明确结论
    if (premium === '' && salePrice === '') {
        lines.push(`- 🧾 溢价 / 总价：未设置`);
    } else {
        const premiumText = premium !== '' ? `${premium} 元` : '未设置';
        const saleText = salePrice !== '' ? `${salePrice} 元` : '未设置';
        lines.push(`- 🧾 溢价 / 总价：${premiumText} / ${saleText}`);
    }

    copyTextToClipboard(lines.join(String.fromCharCode(13, 10)), flashCopyButton);
}

function copyTextToClipboard(text, done) {
    const fallbackCopy = () => {
        const textArea = document.createElement("textarea");
        textArea.value = text;
        textArea.setAttribute('readonly', '');
        textArea.style.position = 'fixed';
        textArea.style.opacity = '0';
        document.body.appendChild(textArea);
        textArea.select();
        try { document.execCommand("copy"); } catch (_) {}
        document.body.removeChild(textArea);
    };

    if (navigator.clipboard && window.isSecureContext) {
        navigator.clipboard.writeText(text).then(done).catch(() => { fallbackCopy(); done(); });
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
    els.amountCopyTip.classList.add('show');
    clearTimeout(flashAmountCopyTip._t);
    flashAmountCopyTip._t = setTimeout(() => {
        els.amountCopyTip.classList.remove('show');
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

const modal = {
    el: document.getElementById('imageModal'),
    img: document.getElementById('generatedImage'),
    loading: document.getElementById('modalLoading'),
    actions: document.getElementById('modalActions'),
    downloadBtn: document.getElementById('downloadImageBtn'),
    closeBtn: document.getElementById('closeImageModalBtn')
};

// 打开/关闭时把焦点移入/移出 modal，避免 Tab 跑到背景控件上（aria-modal 的基本要求）
let modalLastFocused = null;

function closeImageModal() {
    modal.el.classList.remove('opacity-100');
    setTimeout(() => {
        modal.el.classList.add('hidden');
        modal.img.classList.add('hidden');
        modal.actions.classList.add('hidden');
        modal.loading.classList.remove('hidden');
        modal.img.src = '';
        resetGeneratedImage();
        if (modalLastFocused && typeof modalLastFocused.focus === 'function') {
            modalLastFocused.focus();
            modalLastFocused = null;
        }
    }, 300);
}

// Close modal on background click
modal.el.addEventListener('click', (e) => {
    if (e.target === modal.el) closeImageModal();
});

// 焦点陷阱：打开期间 Tab 只在 modal 内循环
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

async function generateImage() {
    // Show modal immediately to indicate processing
    if (!modal.el.classList.contains('hidden')) return; // 防止重复点击叠加生成
    if (document.activeElement && typeof document.activeElement.focus === 'function') {
        modalLastFocused = document.activeElement;
    }
    modal.el.classList.remove('hidden');
    // Force reflow
    void modal.el.offsetWidth;
    modal.el.classList.add('opacity-100');
    
    // Use setTimeout to allow UI to update before heavy lifting
    setTimeout(async () => {
        const node = document.getElementById('captureRoot');
        const mainCard = document.getElementById('mainCard');
        node.classList.add('exporting');
        mainCard.classList.add('exporting');
        const restoreQuoteSection = prepareQuoteSectionForExport(mainCard);
        const restoreDateInputs = prepareDateInputsForExport(mainCard);
        const restoreNumberInputs = prepareNumberInputsForExport(mainCard);
        const restoreSelectInputs = prepareSelectInputsForExport(mainCard);
        const restoreExportShadow = prepareExportShadow(node, mainCard);

        try {
            const htmlToImage = await getHtmlToImage();
            const rect = node.getBoundingClientRect();
            const cssWidth = Math.max(1, Math.ceil(rect.width));
            const widthBasedRatio = SHARE_IMAGE_MIN_WIDTH / cssWidth;
            const isLowEndDevice = (typeof navigator !== 'undefined'
                && typeof navigator.deviceMemory === 'number'
                && navigator.deviceMemory > 0
                && navigator.deviceMemory <= 4)
                || (typeof window !== 'undefined' && window.innerWidth < 400);
            const maxRatio = isLowEndDevice
                ? SHARE_IMAGE_LOW_END_MAX_PIXEL_RATIO
                : SHARE_IMAGE_MAX_PIXEL_RATIO;
            // WebKit/Safari 对非整数 pixelRatio 的 box-shadow 与网格平铺渲染不准确，
            // 会导致导出样式与 Chromium 不一致；这里向上取整为整数，保证跨浏览器一致。
            const rawRatio = Math.max(SHARE_IMAGE_MIN_PIXEL_RATIO, widthBasedRatio);
            const pixelRatio = Math.min(maxRatio, Math.ceil(rawRatio));
            const canvas = await htmlToImage.toCanvas(node, {
                width: Math.ceil(rect.width),
                height: Math.ceil(rect.height),
                pixelRatio,
                filter: (element) => {
                    if (!element || !element.id) return true;
                    return !['themeToggle', 'btnContainer', 'footerWrap'].includes(element.id);
                },
                style: {
                    transform: 'scale(1)',
                }
            });
            const blob = await canvasToBlob(canvas, SHARE_IMAGE_MIME_TYPE, SHARE_IMAGE_QUALITY);
            resetGeneratedImage();
            generatedImageUrl = URL.createObjectURL(blob);

            modal.img.src = generatedImageUrl;
            if (modal.downloadBtn) {
                modal.downloadBtn.href = generatedImageUrl;
                modal.downloadBtn.download = `vps-value-${els.dueDate.value || 'share'}.webp`;
            }
            modal.loading.classList.add('hidden');
            modal.img.classList.remove('hidden');
            modal.actions.classList.remove('hidden');
            // 生成完成后把焦点交给关闭按钮，键盘用户可直接 Tab 到下载
            if (modal.closeBtn) modal.closeBtn.focus();
        } catch (e) {
            // 错误已通过 toast 告知用户，控制台不再重复打印
            closeImageModal();
            showToast('生成出错');
        } finally {
            restoreSelectInputs();
            restoreNumberInputs();
            restoreDateInputs();
            restoreQuoteSection();
            restoreExportShadow();
            mainCard.classList.remove('exporting');
            node.classList.remove('exporting');
        }
    }, 100);
}

// 用 addEventListener 绑定（替代 inline onclick），保持 HTML 与逻辑解耦
function bindActionButtons() {
    const map = [
        ['copyBtn', copyResult],
        ['imgBtn', generateImage],
        ['closeImageModalBtn', closeImageModal],
    ];
    for (const [id, fn] of map) {
        const el = document.getElementById(id);
        if (el) el.addEventListener('click', fn);
    }

    // 鼠标悬停 / 键盘聚焦时预热 html-to-image，点击瞬间减少等待。仅触发一次。
    const imgBtn = document.getElementById('imgBtn');
    if (imgBtn) {
        const prefetch = () => {
            imgBtn.removeEventListener('pointerenter', prefetch);
            imgBtn.removeEventListener('focus', prefetch);
            try { getHtmlToImage(); } catch (_) {}
        };
        imgBtn.addEventListener('pointerenter', prefetch, { once: true });
        imgBtn.addEventListener('focus', prefetch, { once: true });
    }
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bindActionButtons);
} else {
    bindActionButtons();
}

