# VPS 剩余价值计算器

一个轻量的 VPS 剩余价值与转让溢价分析工具。输入续费价格、付款周期与到期日，即可算出这台 VPS 现在还值多少、转让报价是否存在溢价，帮助你在二手服务器交易中快速定价与砍价。

适合在 NodeSeek 等服务器交易、续费和转让场景中快速做判断。

> 本项目与 NodeSeek 没有官方关联；NodeSeek 仅作为常见的 VPS 交易使用场景举例。

**在线使用：** [https://jsq.xbibi.de](https://jsq.xbibi.de)

## ✨ 特性

- 💰 **多币种自动汇率**：支持 CNY、USD、EUR、GBP、JPY、KRW 等 11 种货币，自动获取实时汇率换算，也可手动覆盖
- 📅 **真实日历估值**：按自然日计算剩余天数，正确处理大小月、闰年与月末续费语义；月付到三年付共 6 档周期
- 📊 **溢价 / 总价双向联动**：输入溢价自动算总价，输入总价自动算溢价，正溢价红色、折价绿色一目了然
- 🎨 **Vercel 风格 Bento Grid UI**：Geist 字体 + 黑白极简设计，深色 / 浅色模式切换，适配移动端与 PC 端
- 🖼️ **一键生成交易卡片图片**：纯前端生成（WebP），无隐私泄露，可直接分享到社区
- 📋 **一键复制交易摘要**：生成 Markdown 格式的完整交易信息，方便发帖
- 💾 **输入自动保存**：表单数据本地保存 12 小时，刷新页面不丢失
- ⚡ **轻量快速**：纯静态站点，首屏 JS 仅 ~20KB（gzip ~7KB），无任何服务端依赖

## 🧮 计算方式

- 剩余价值 = 周期价格 × 剩余自然日 ÷ 周期自然日（剩余天数收敛到一个周期内，避免超期机器估值溢出）
- 外币价格按实时汇率换算为 CNY，汇率来自 [open.er-api.com](https://open.er-api.com)（12 小时本地缓存）
- 溢价 = 转让总价 − 剩余价值

## 🚀 部署

### Cloudflare Pages / Vercel / EdgeOne Pages

本项目是纯静态网站，支持直接部署到任何静态托管平台。

- **构建命令**: `npm run build`
- **输出目录**: `dist`

### Cloudflare Workers

已配置 `wrangler.toml`，支持通过 Workers 部署静态资源：

```bash
npx wrangler deploy
```

#### 一键 Cloudflare 部署：

[![Deploy to Cloudflare Workers](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/lyhbdw/vps-valuation)

### 自有服务器

构建后将 `dist/` 交由任意静态服务器（Nginx、Caddy 等）即可，无需 Node.js 运行时。

## 🛠️ 开发与构建

本项目使用 Vite + Tailwind CSS 构建，UI 采用 Vercel 风格的 Bento Grid 设计系统（Geist / Geist Mono 字体）。

1. 安装依赖：

   ```bash
   npm install
   ```

2. 启动本地开发服务器：

   ```bash
   npm run dev
   ```

3. 构建生产环境代码（生成 `dist/` 目录）：

   ```bash
   npm run build
   ```

构建后会自动压缩 `dist/index.html`（去注释、标签间空白、安全属性去引号）。

## 📁 项目结构

```
├── index.html          # 页面结构（Bento Grid 布局）
├── src/
│   ├── main.js         # 应用装配、事件绑定与交互编排
│   ├── calculator.js   # 核心剩余价值、日均摊算法与日期推导（纯函数）
│   ├── rates.js        # 实时汇率管理（带 TTL 缓存、频控与内置基准兜底）
│   ├── exportImage.js  # 分享图片导出（html-to-image 跨端适配与 Canvas 阴影补偿）
│   ├── storage.js      # 本地持久化抽象（带 TTL 过期机制）
│   └── style.css       # Vercel Bento Grid 设计系统（CSS 变量规范化）
├── scripts/postbuild.mjs  # HTML 生产产物压缩
├── vite.config.js      # Vite 配置
└── tailwind.config.js  # Tailwind 配置
```

---

## 📝 许可证

Apache-2.0 License
