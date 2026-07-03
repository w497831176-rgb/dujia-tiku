# 独家题库

一个可自行部署的移动端刷题 Web 应用，后端使用 Node.js、Express 与 SQLite。

## 版本

- 当前稳定基线：`V1.2.0`
- 完整演进记录：[版本历史](docs/VERSION-HISTORY.md)

## 快速部署

```bash
cp .env.example .env
# 编辑 .env，填写 AI_API_KEY 与 JWT_SECRET
mkdir -p data logs
docker compose up -d --build
```

首次启动会自动创建空数据库。仓库不包含真实题库、用户、购买记录或密钥；可将 `data/sample-questions.json` 提交到 `/api/questions/seed` 体验页面。

生产与测试建议使用不同目录、容器、环境变量和数据库。

## 目录

- `web/index.html`：前端页面、样式与交互
- `api/src`：认证、题库、答题、错题、购买、邀请与 AI 提炼接口
- `data/sample-questions.json`：可公开的最小示例题目
- `data/du-tiku.db`：运行时数据库，被 Git 忽略
- `nginx`：静态页面与 `/api` 反向代理
- `scripts`：部署、健康检查和端到端测试
- `docs/UI-PARITY.md`：界面和交互基线
- `docs/VERSION-HISTORY.md`：V1.0—V1.2 产品演进
- `docs/GIT-GUIDE-FOR-PM.md`：面向产品经理的一人产研 Git 操作手册

## AI 配置

默认使用 DeepSeek OpenAI 兼容接口：

- 模型：`deepseek-v4-pro`
- 思考模式：`enabled`
- 推理强度：`high`

真实密钥只保存在本地 `.env`，不得写入仓库。

## 界面基线

- 移动端内容最大宽度：480px
- 页面：登录/注册、题库、错题、提炼、我的
- 演示版自动核销等交互按原版保留

## 开源范围

代码使用 MIT License。真实题库内容、数据库、账号、部署域名与 API Key 不属于开源内容。
