/**
 * 分享图片导出模块（处理 html-to-image 跨浏览器排版兼容、Canvas 阴影与弹窗展示）
 */
import { formatDateForDisplay, parseQuoteValue } from './calculator.js';

const SHARE_IMAGE_MIME_TYPE = 'image/webp';
const SHARE_IMAGE_QUALITY = 0.98;
const SHARE_IMAGE_MIN_PIXEL_RATIO = 2;
const SHARE_IMAGE_MAX_PIXEL_RATIO = 4;
const SHARE_IMAGE_LOW_END_MAX_PIXEL_RATIO = 3;
const SHARE_IMAGE_MIN_WIDTH = 1440;

let htmlToImageModulePromise = null;
let generatedImageUrl = '';

export async function getHtmlToImage() {
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

function prepareNumberInputsForExport(node) {
  return createExportRestorer((addRestore) => {
    node.querySelectorAll('input[type="number"]').forEach((input) => {
      const display = document.createElement('div');
      display.className = input.className;
      const cs = window.getComputedStyle(input);
      display.style.display = 'flex';
      display.style.alignItems = 'center';
      display.style.justifyContent = cs.textAlign === 'center'
        ? 'center'
        : (cs.textAlign === 'right' ? 'flex-end' : 'flex-start');
      display.style.paddingLeft = cs.paddingLeft;
      display.textContent = input.value || input.placeholder || '';
      input.style.display = 'none';
      if (input.parentElement) {
        input.parentElement.insertBefore(display, input);
      }

      addRestore(() => {
        input.style.display = '';
        display.remove();
      });
    });
  });
}

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
  ctx.shadowColor = isDark ? 'rgba(0, 0, 0, 0.42)' : 'rgba(44, 40, 37, 0.12)';
  ctx.shadowBlur = 26;
  ctx.shadowOffsetY = 8;
  ctx.fillStyle = isDark ? '#1c1b19' : '#f7f5f0';
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

function prepareQuoteSectionForExport(mainCard, premiumInputValue) {
  const premium = parseQuoteValue(premiumInputValue);
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
        hasSelectedAttr: option.hasAttribute('selected'),
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

/**
 * 导出分享图片
 */
export async function exportCardAsImage({
  captureRoot,
  mainCard,
  premiumInputValue,
  dueDateValue,
  modal,
  onToast,
}) {
  if (!modal.el.classList.contains('hidden')) return;

  const modalLastFocused = document.activeElement;
  modal.el.classList.remove('hidden');
  void modal.el.offsetWidth; // 触发 reflow
  modal.el.classList.add('opacity-100');

  setTimeout(async () => {
    captureRoot.classList.add('exporting');
    mainCard.classList.add('exporting');
    const restoreQuoteSection = prepareQuoteSectionForExport(mainCard, premiumInputValue);
    const restoreDateInputs = prepareDateInputsForExport(mainCard);
    const restoreNumberInputs = prepareNumberInputsForExport(mainCard);
    const restoreSelectInputs = prepareSelectInputsForExport(mainCard);
    const restoreExportShadow = prepareExportShadow(captureRoot, mainCard);

    try {
      const htmlToImage = await getHtmlToImage();
      const rect = captureRoot.getBoundingClientRect();
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
      const rawRatio = Math.max(SHARE_IMAGE_MIN_PIXEL_RATIO, widthBasedRatio);
      const pixelRatio = Math.min(maxRatio, Math.ceil(rawRatio));

      const canvas = await htmlToImage.toCanvas(captureRoot, {
        width: Math.ceil(rect.width),
        height: Math.ceil(rect.height),
        pixelRatio,
        filter: (element) => {
          if (!element || !element.id) return true;
          return !['themeToggle', 'btnContainer', 'footerWrap'].includes(element.id);
        },
        style: {
          transform: 'scale(1)',
        },
      });

      const blob = await canvasToBlob(canvas, SHARE_IMAGE_MIME_TYPE, SHARE_IMAGE_QUALITY);
      resetGeneratedImage();
      generatedImageUrl = URL.createObjectURL(blob);

      modal.img.src = generatedImageUrl;
      if (modal.downloadBtn) {
        modal.downloadBtn.href = generatedImageUrl;
        modal.downloadBtn.download = `vps-value-${dueDateValue || 'share'}.webp`;
      }
      modal.loading.classList.add('hidden');
      modal.img.classList.remove('hidden');
      modal.actions.classList.remove('hidden');
      if (modal.closeBtn) modal.closeBtn.focus();
    } catch (_) {
      closeExportModal(modal, modalLastFocused);
      onToast('生成出错');
    } finally {
      restoreSelectInputs();
      restoreNumberInputs();
      restoreDateInputs();
      restoreQuoteSection();
      restoreExportShadow();
      mainCard.classList.remove('exporting');
      captureRoot.classList.remove('exporting');
    }
  }, 100);
}

export function closeExportModal(modal, modalLastFocused) {
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
    }
  }, 300);
}
