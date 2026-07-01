# 独家题库 V1.0

V1.0 是基础刷题系统的历史重建快照，依据原始 PRD 恢复，用于版本追溯和回退演示。

## 功能

- 用户注册与登录
- 题库刷题和答案解析
- 答题进度与正确率
- 错题集
- 移动端布局

## 启动

```bash
cp .env.example .env
mkdir -p data logs
docker compose up -d --build
```

本快照不包含真实题库数据库和任何密钥。
