# 独家题库 V1.1

V1.1 是根据 NAS 中 V1.2 前真实代码备份恢复的学习增强版本。

## 新增能力

- 题目解析、错误辨析和知识点回顾
- 举一反三变式题
- DeepSeek AI 提炼
- 提炼全集和提炼错题
- 邀请记录、权益状态和演示版自动核销
- 答题音效及移动端交互限制

## 启动

```bash
cp .env.example .env
mkdir -p data logs
docker compose up -d --build
```

本快照不包含真实题库数据库和任何密钥。
