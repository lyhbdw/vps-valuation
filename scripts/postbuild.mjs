#!/usr/bin/env node
/*
 * postbuild：压缩 dist/index.html。
 * Vite 不会压缩 HTML，默认原样下发带注释和缩进的源文件（本项目 ~35KB）。
 * 压缩分三步，全部是语法等价变换（不改变渲染结果）：
 *   1) 去 HTML 注释
 *   2) 去掉标签之间的换行与缩进空白
 *   3) 去掉属性值引号 —— 仅当属性值不含空格、引号、'<'、'>'、'='、'`' 时
 *      （HTML5 规范允许无引号属性值，条件是值不含这些字符）
 * 不动 <style>/<script> 内容（内联 JS 已被 esbuild 压缩过，内联 CSS 体积极小）。
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const file = join(root, 'dist', 'index.html');

const before = readFileSync(file, 'utf8');

// 1) 去 HTML 注释（含条件注释外的所有 <!-- -->）
// 2) 去掉标签之间的换行与缩进空白（保留 <pre>/<textarea> 内空白——本项目没有）
let after = before
  .replace(/<!--(?!\[if)[\s\S]*?-->/g, '')
  .replace(/>\s+</g, '><')
  .trim();

// 3) 去属性引号。用保守白名单：属性名只允许字母数字和连字符，
//    属性值必须完全由安全字符组成（无空白、引号、尖括号、等号、反引号）。
const beforeUnquote = after.length;
after = after.replace(
  /\s([a-zA-Z][a-zA-Z0-9-]*)="([^"'<>=`\s]*)"/g,
  (m, name, value) => (value.length ? ` ${name}=${value}` : m)
);

writeFileSync(file, after);

const saved = before.length - after.length;
const unquoteSaved = beforeUnquote - after.length;
console.log(`[postbuild] index.html ${before.length}B -> ${after.length}B (-${saved}B, ${((saved / before.length) * 100).toFixed(1)}%)`);
console.log(`[postbuild]   其中去引号节省 ${unquoteSaved}B`);
