# LoRA Dataset Label Tool

一个用于 LoRA 模型训练数据集管理与打标的本地 Web 工具。支持项目管理、批量图片处理和基于 LM Studio 视觉模型的自动打标。

---

## 功能概览

### 📁 数据集管理
- 新建 / 删除项目，每个项目独立存储图片与标注文件
- 拖拽图片或文件夹批量上传（支持 JPG / PNG / WebP / BMP / GIF）
- 图片网格预览，一眼区分已标注与未标注图片
- 点击图片弹窗查看、编辑或删除对应标注
- 一键清除项目内所有标注文件

### ✂️ 图片处理
类似 [birme.net](https://www.birme.net/) 的批量图片缩放工具。

| 模式 | 说明 |
|------|------|
| 裁剪填充 | 居中裁剪，输出严格等于目标尺寸 |
| 适合框内 | 保留完整画面，等比缩小至框内 |
| 拉伸填充 | 强制拉伸到目标尺寸（可能变形） |
| 填充边距 | 等比缩放后用指定颜色填满空白 |

- 内置常用尺寸预设：512² / 768² / 1024² / 512×768 / 768×512 / 1024×768
- 输出格式：JPG / PNG / WebP / 保持原格式
- 可调节 JPG/WebP 压缩质量
- 可选覆盖原文件或保存为新文件

### 🏷️ 图片打标
通过 LM Studio 本地运行的视觉语言模型（VLM）对图片进行自动打标，生成适用于 LoRA 训练的 tag 标注文件。

**打标模式：**

| 模式 | 适用场景 | 生成内容 |
|------|----------|----------|
| 👩 人物/角色 | 动漫角色、人像 | 发色、发型、眼色、表情、服装、姿势（Danbooru 风格） |
| 📦 物体/产品 | 商品、道具 | 材质、颜色、形状、质感、背景环境 |
| 🎨 风格/画风 | 风格 LoRA | 绘画风格、画法、配色方案、线稿质量 |
| 🌄 场景/风景 | 背景、环境 | 地点、时间、天气、光照、建筑、自然元素 |
| 🔍 通用描述 | 混合内容 | 主体、风格、色彩、构图等综合描述 |
| ✏️ 自定义 | 特殊需求 | 完全由用户指定的提示词 |

**其他打标设置：**
- 前置标签：统一添加在所有生成标签之前（如 `1girl, solo`）
- 后置标签：统一添加在所有生成标签之后（如 `best quality`）
- 最大 Token 数 / 温度参数
- 可选跳过已有标注的图片

---

## 快速开始

### 环境要求
- Python 3.8+
- [LM Studio](https://lmstudio.ai/)（打标功能需要，需加载支持视觉输入的模型）

### 安装与启动

**方式一：双击 `start.bat`**（Windows，自动创建虚拟环境并安装依赖）

**方式二：手动启动**
```bash
# 安装依赖
pip install -r requirements.txt

# 启动服务
python -m uvicorn scripts.server:app --host 0.0.0.0 --port 8000 --reload
```

启动后浏览器访问：**http://localhost:8000**

---

## LM Studio 配置

1. 打开 LM Studio，在 **Local Server** 页面启动服务（默认端口 `1234`）
2. 加载一个支持视觉输入（Vision）的模型，例如：
   - `LLaVA` 系列
   - `Qwen2-VL`
   - `InternVL`
   - `MiniCPM-V`
3. 在打标标签页点击 **测试** 按钮，连接成功后从下拉框选择已加载的模型
4. 选择打标模式，点击 **开始批量打标**

标注结果会以 `.txt` 文件的形式保存在图片同目录下，文件名与图片相同。

---

## 项目结构

```
PlanLabelTool/
├── requirements.txt    # Python 依赖
├── start.bat           # Windows 一键启动脚本
├── scripts/
│   ├── server.py           # FastAPI 主入口与共享工具
│   ├── server_dataset.py   # 数据集管理 API
│   ├── server_resize.py    # 图片处理 API
│   └── server_label.py     # 打标 API
├── static/
│   ├── index.html      # 单页前端应用
│   ├── css/style.css   # 暗色主题样式
│   └── js/app.js       # 前端逻辑（三个功能模块）
└── projects/           # 用户项目数据（图片 + .txt 标注）
    └── {项目名}/
        ├── image.jpg
        └── image.txt   # 对应标注
```

---

## 技术栈

| 层 | 技术 |
|----|------|
| 后端 | Python · FastAPI · Uvicorn |
| 图片处理 | Pillow |
| LM Studio 通信 | httpx（OpenAI 兼容 API）|
| 前端 | 原生 HTML / CSS / JavaScript |
