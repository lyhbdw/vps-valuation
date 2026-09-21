# VPS 剩余价值计算器

一个轻量的 VPS 剩余价值与转让溢价回本分析工具。输入购入价格与到期日，即可算出这台 VPS 现在还值多少、转让报价是否存在溢价，以及溢价需要多久才能被续费成本差额覆盖。

适合在 NodeSeek 等服务器交易、续费和转让场景中快速做判断。

![demo](./demo1.webp)

![demo](./demo2.webp)

> 本项目与 NodeSeek 没有官方关联；NodeSeek 仅作为常见的 VPS 交易使用场景举例。

## ✨ 特性

- 💰 **多币种自动汇率**：支持 USD、EUR、GBP、JPY 等，自动获取实时汇率换算
- 📅 **真实日历估值**：按自然日计算剩余天数，正确处理大小月、闰年与月末续费语义
- 📊 **转让溢价回本分析**：给定转让总价，计算溢价金额与回本所需天数
- 🎨 **磨砂玻璃 UI**：支持深色 / 浅色模式切换，适配移动端与 PC 端
- 🖼️ **一键生成交易卡片图片**：纯前端生成，无隐私泄露

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

[![Deploy to Cloudflare Workers](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/Tumb1er1376/vps-valuation)

### 自有服务器

构建后将 `dist/` 交由任意静态服务器（Nginx、Caddy 等）即可，无需 Node.js 运行时。

## 🛠️ 开发与构建

本项目使用 Vite + Tailwind CSS 构建。

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

---

## 📝 许可证

Apache-2.0 License
