# 授权图片区域修复

纯前端单图工具。图片、遮罩和结果只保存在当前浏览器页面内存中；OpenCV.js 仅在用户开始修复时从同源静态资源加载。

## 开发

```bash
npm install
npm run dev
```

## 验证

```bash
npm run lint
npm run typecheck
npm test
npm run check:opencv
npm run build
```

`npm run dev` 和 `npm run build` 会先把已锁定 npm 包中的 OpenCV.js 与许可证复制到 `public/vendor/opencv/`。该目录是生成产物，不提交到 Git。
