<div align="center">

# LoRA Dataset Label Tool

**面向 LoRA 训练的本地数据集管理与打标工具**

[![Python](https://img.shields.io/badge/Python-3.10+-3776AB?style=flat-square&logo=python&logoColor=white)](https://www.python.org/)
[![FastAPI](https://img.shields.io/badge/FastAPI-0.110+-009688?style=flat-square&logo=fastapi&logoColor=white)](https://fastapi.tiangolo.com/)
[![LM Studio](https://img.shields.io/badge/LM_Studio-Compatible-blueviolet?style=flat-square)](https://lmstudio.ai/)
[![License](https://img.shields.io/badge/License-MIT-green?style=flat-square)](LICENSE)

</div>

---


一个运行在本地浏览器里的 Web 工具，专为 LoRA 训练数据准备设计，覆盖从原始图片到可训练数据集的完整流程：

```
上传图片  →  批量处理尺寸  →  AI 批量打标  →  人工修正  
```
---

## 功能概览

| 模块 | 核心能力 |
|:---:|---|
| **数据集管理** | 项目增删、拖拽批量上传（含文件夹递归）、懒加载预览、标签编辑/翻译 |
| **图片处理** | 4 种缩放裁剪模式、尺寸预设、格式转换、逐图调焦、导出 ZIP |
| **图片打标** | 接入 LM Studio Vision 模型、8 种打标模式、批量任务可中止 |

---

## 快速开始

### 环境要求

- Python **3.10+**
- Windows（使用 `start.bat` 一键启动）
- [LM Studio](https://lmstudio.ai/)（使用打标 / 翻译功能时需加载 Vision 模型，目前使用的是Qwen 3.5-35B-a3b，参数Enable Thinking 关闭）

### 方式一：一键启动（推荐）

双击项目根目录的 `start.bat`，脚本会自动完成：

1. 创建 `.venv` 虚拟环境
2. 安装所有依赖
3. 启动服务并打开 `http://localhost:8701`

### 方式二：手动启动

```bash
pip install -r requirements.txt
python -m uvicorn scripts.server:app --host 0.0.0.0 --port 8701 --reload
```

然后在浏览器访问 `http://localhost:8701`。

---

## 使用流程

```
① 数据集管理
   └─ 新建项目 → 拖拽上传图片或文件夹

② 图片处理
   └─ 选择目标尺寸与模式 → 批量处理 → （可选）导出 ZIP

③ 图片打标
   └─ 连接 LM Studio → 选择模式 → 批量打标

④ 人工修正
   └─ 点击任意图片 → 在右侧详情面板编辑/删除/翻译标签
```

---

## 功能详解

### 数据集管理

- **项目管理**：新建、删除，左侧列表切换
- **上传方式**：拖拽多图、拖拽文件夹（递归读取）、按钮选择
- **实时进度**：百分比 + 已传字节显示
- **图片预览**：缩略图懒加载，大量图片也不卡顿
- **详情面板**（点击图片后右侧展开）：
  - 查看尺寸、大小
  - 编辑并保存标签
  - 删除标签 / 删除图片
  - 标签中英互译
- **批量操作**：一键清除项目所有 `.txt` 标签

---

### 图片处理

**输入/输出规则**

- 原图保留在 `projects/{项目名}/original/`（不会被修改）
- 处理结果输出到 `projects/{项目名}/` 根目录
- 输出文件自动顺序编号：`0001.jpg`, `0002.jpg`, ...

**4 种处理模式**

| 模式 | 效果 | 适用场景 |
|:---:|---|---|
| `crop` | 裁剪填充，严格等于目标尺寸 | 训练集统一分辨率 |
| `fit` | 等比缩放，完整保留画面 | 不想裁掉主体 |
| `stretch` | 强制拉伸到目标尺寸 | 特殊预处理需求 |
| `pad` | 等比缩放后补边填充 | 保留内容同时统一尺寸 |

**其他能力**

- 尺寸预设（含方图、竖图、横图）
- 宽高比锁定
- 输出格式：`JPG` / `PNG` / `WebP` / 原格式
- 质量参数（适用于 JPG / WebP）
- `crop` 模式下：逐图拖拽焦点选择裁剪区域
- 顶部固定进度与结果面板（可折叠）
- 处理完成后可直接导出 ZIP

---

### 图片打标

**连接 LM Studio**

1. 在打标页输入 LM Studio 地址（默认 `http://127.0.0.1:1234`）
2. 点击"测试连接"，自动拉取已加载的模型列表
3. 选择模型后即可打标

**8 种打标模式**

| 模式 | 适用内容 |
|:---:|---|
| `character` | 人物/角色图，聚焦人物特征、服饰、姿态与场景 |
| `object` | 物体/产品图，聚焦类别、材质、颜色与结构细节 |
| `style` | 风格参考图，聚焦媒介、渲染、配色与氛围 |
| `scenery` | 场景/背景图，聚焦环境、时间天气、光线与空间感 |
| `fashion` | 服装图，聚焦服饰与配件本体信息 |
| `shoes` | 鞋类训练辅助模式 |
| `general` | 通用，综合描述主体、风格、动作与场景 |
| `custom` | 自定义提示词，完全按用户输入规则生成 |

**可配置参数**

- 前置标签 / 后置标签
- `max_tokens` / `temperature`
- 覆盖已有标注 / 跳过已有标注
- 输出语言：English / 中文
- 批量任务支持随时中止

---

## LM Studio 配置建议

```
1. 打开 LM Studio → 启动本地服务器（默认端口 1234）
2. 加载支持图像输入的 Vision 模型
3. 在打标页点击"测试"，确认模型列表可读
4. 开始批量打标
```

> **注意**：纯文本模型无法理解图片，会导致打标失败或输出混乱。
>
> 若出现 `No valid tags generated`，请优先排查：
> - 模型是否支持视觉输入（Vision）
> - 模型是否已在 LM Studio Server 中真正加载
> - `max_tokens` / `temperature` 是否设置过高

---

## 数据目录结构

```
projects/
└── {项目名}/
    ├── original/          # 上传原图（不会被覆盖）
    │   ├── photo_01.jpg
    │   └── photo_01.txt   # 若在原图层打标
    ├── 0001.jpg            # 批处理输出图
    ├── 0001.txt            # 同名标签文件
    ├── 0002.jpg
    ├── 0002.txt
    └── ...
```

> 项目根目录优先作为"当前训练集"。若根目录无图片，前端自动回退读取 `original/`。

---

## 项目结构

```
PlanLabelTool/
├── start.bat              # 一键启动脚本（Windows）
├── requirements.txt
├── scripts/
│   ├── server.py          # FastAPI 主入口 + 公共工具
│   ├── server_dataset.py  # 数据集管理 API
│   ├── server_resize.py   # 图片处理 API
│   └── server_label.py    # 打标与翻译 API
├── static/
│   ├── index.html
│   ├── css/style.css
│   └── js/
│       ├── app.js         # 全局状态 / 通用工具
│       ├── dataset.js     # 数据集管理逻辑
│       ├── resize.js      # 图片处理逻辑
│       └── label.js       # 打标逻辑
└── projects/              # 用户数据（自动创建）
```

---

## 技术栈

| 层 | 技术 |
|:---:|---|
| 后端框架 | FastAPI + Uvicorn |
| 图片处理 | Pillow |
| 模型通信 | httpx（OpenAI 兼容接口） |
| 前端 | 原生 HTML / CSS / JavaScript |

---

## 常见问题

**Q：上传多图时只进了一张？**

- 优先使用"选择图片"按钮或直接拖拽文件到上传区
- 若拖拽的是文件夹，等待递归读取完成后再上传
- 仅支持：`jpg` / `jpeg` / `png` / `webp` / `bmp` / `gif`

**Q：图片很多时页面卡顿？**

- 已启用缩略图懒加载与分块渲染
- 建议使用中等分辨率原图，避免一次性导入超大图
- 可按主题拆分项目，减少单项目图片数量

**Q：打标结果质量不稳定？**

- 确认已加载 Vision 模型（非纯文本模型）
- 降低 `temperature`（建议 `0.1 ~ 0.3`）
- 控制 `max_tokens` 在合理范围（建议 `200 ~ 600`）
- 切换到 `custom` 模式并收紧提示词描述
