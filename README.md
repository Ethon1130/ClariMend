# 授权图片区域修复

纯前端单图工具。图片、遮罩和结果只保存在当前浏览器页面内存中；OpenCV.js 仅在用户开始快速修复时从同源静态资源加载。

编辑器提供可撤销的克隆图章，以及实验性的 LaMa ONNX 智能修复。智能修复首次使用前会确认下载约 208 MB 的开源模型，推理仍在浏览器本地完成；模型文件不会提交到仓库。部署环境可通过 `NEXT_PUBLIC_LAMA_MODEL_URL` 替换为审核并自托管的同源模型地址。

## 开发

```bash
npm install
npm run dev
```

生产运行：

```bash
npm run build
npm start
```

## 验证

```bash
npm run lint
npm run typecheck
npm test
npm run check:opencv
npm run build
```

`npm run dev` 和 `npm run build` 会先把已锁定 npm 包中的 OpenCV.js、ONNX Runtime Web WASM 与许可证复制到 `public/vendor/`。该目录是生成产物，不提交到 Git。
