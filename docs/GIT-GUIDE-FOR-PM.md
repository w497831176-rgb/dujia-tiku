# Git 与 GitHub 操作手册（产品经理版）

适用项目：独家题库  
适用角色：一人产品、研发、测试、发布与运维

## 1. 先建立正确的心智模型

Git 不是网盘，也不只是“把最新版代码上传到 GitHub”。它是一套可追踪、可比较、可恢复的代码版本系统。

可以把它理解为：

| Git 概念 | 产品经理类比 | 作用 |
| --- | --- | --- |
| Repository（仓库） | 一个产品的完整档案室 | 保存代码和全部版本历史 |
| Working Tree（工作区） | 正在编辑的 PRD | 当前电脑或 NAS 上的文件 |
| Commit（提交） | 一次有编号的需求变更记录 | 固化一组完整且有意义的修改 |
| Branch（分支） | 一条独立的需求试验线 | 新功能开发时不影响稳定版本 |
| Tag（标签） | 正式发布版本号 | 标记 V1.0、V1.1、V1.2 等里程碑 |
| Remote（远程仓库） | 云端档案室 | GitHub 上的仓库 |
| Push（推送） | 上传已归档版本 | 把本地提交发送到 GitHub |
| Pull（拉取） | 同步云端档案 | 获取 GitHub 最新提交 |
| Pull Request（PR） | 上线评审单 | 查看改了什么、检查后合并 |

最重要的区别：Commit 是过程记录，Tag 是发布里程碑。一个版本通常包含多个 Commit，而不是每个版本只能有一个 Commit。

## 2. 本项目的版本结构

当前发布线：

```text
V1.0 历史重建快照 ── V1.1 真实备份恢复 ── V1.2 当前稳定版本（main）
       │                    │                    │
     v1.0.0              v1.1.0              v1.2.0
```

- `main`：永远代表已验收、可以部署的稳定代码。
- `v1.0.0`：根据原始 PRD 重建的基础刷题版本。
- `v1.1.0`：根据 NAS 的 V1.2 前真实备份恢复。
- `v1.2.0`：当前稳定生产基线。
- 后续版本必须由产品负责人明确立项后才创建。

## 3. 版本号怎么读

推荐使用语义化版本：`主版本.次版本.修订版本`。

以 `v1.2.3` 为例：

- `1`：主版本。产品方向或架构发生不兼容变化时增加。
- `2`：次版本。新增一组向后兼容的功能时增加。
- `3`：修订版本。只修 Bug 或做小调整时增加。

示例：

- 新增一个完整功能：`v1.2.0 → v1.3.0`
- 修复 V1.2 的按钮错误：`v1.2.0 → v1.2.1`
- 大规模重做产品：`v1.x → v2.0.0`

不要只写“最新版”“最终版”“最终版2”。版本号必须可排序、可追踪。

## 4. 一人产研的标准流水线

### 第一步：产品立项

先写清楚：

- 用户问题是什么
- 哪些页面或接口会变化
- 验收标准是什么
- 哪些内容明确不做
- 版本号是什么

需求未确认前，不创建版本 Roadmap、不修改生产代码。

### 第二步：创建功能分支

不要直接在 `main` 上开发。

```bash
git switch main
git pull --ff-only origin main
git switch -c feature/功能名称
```

常用分支命名：

- `feature/xxx`：新功能
- `fix/xxx`：Bug 修复
- `docs/xxx`：只改文档
- `release/v1.3.0`：发布前收口
- `hotfix/v1.2.1`：生产紧急修复

### 第三步：让 AI 开发

给 AI 的任务至少包含：

- 需求背景
- 允许修改的范围
- 不允许修改的范围
- 验收条件
- 测试环境地址
- 禁止直接修改生产环境

AI 完成后先看差异：

```bash
git status
git diff
```

不要因为“页面看起来能用”就立即发布。

### 第四步：提交代码

一次 Commit 只表达一个完整意图。

```bash
git add 文件名
git commit -m "feat: 增加错题筛选"
```

推荐提交前缀：

- `feat:` 新功能
- `fix:` 修复问题
- `docs:` 文档
- `refactor:` 重构但不改变功能
- `test:` 测试
- `chore:` 工程或依赖调整
- `release:` 发布版本

不推荐：

- `修改一下`
- `最新版`
- `123`
- `final`

### 第五步：推送分支

```bash
git push -u origin feature/功能名称
```

GitHub 会保存该分支。即使只有一个人，也建议通过 Pull Request 合并，因为 PR 会形成清晰的需求评审记录。

### 第六步：测试环境验收

本项目必须先发布测试环境，再发布生产环境。

至少验证：

- 首页和登录
- 核心业务流程
- 新功能验收标准
- 原有功能回归
- API 健康检查
- 移动端页面
- 错误和空数据状态

测试不通过，继续在功能分支修改；不要拿生产环境试错。

### 第七步：合并 main

通过 GitHub PR 点击 Merge，或使用：

```bash
git switch main
git pull --ff-only origin main
git merge --no-ff feature/功能名称
git push origin main
```

合并前再次确认：

- 没有 `.env`
- 没有 API Key、密码或 Token
- 没有真实数据库
- CHANGELOG 已更新
- 测试已通过

### 第八步：发布 Tag

只有验收并上线的版本才创建 Tag。

```bash
git tag -a v1.2.1 -m "Release v1.2.1"
git push origin v1.2.1
```

Tag 创建后不应随意移动。只有像本项目首次重建历史这样的特殊情况才允许校正标签。

### 第九步：创建 GitHub Release

GitHub 仓库 → Releases → Draft a new release：

- Choose a tag：选择对应 Tag
- Release title：例如 `V1.2.1`
- Description：写新增、优化、修复和部署说明

Release 是给人看的发布说明；Tag 是 Git 用来定位代码的技术标记。

## 5. 在 GitHub 网页上看版本

### 看提交历史

仓库首页点击 `Commits`，可以看到每次提交：

- 谁改的
- 什么时间改的
- 修改说明
- 改了哪些行

### 看某个发布版本

点击仓库右侧 `Releases` 或 `Tags`，选择 `v1.0.0`、`v1.1.0`、`v1.2.0`。

进入标签后看到的是该版本当时的完整代码，不是最新版。

### 比较两个版本

GitHub 地址格式：

```text
https://github.com/账号/仓库/compare/v1.1.0...v1.2.0
```

页面会展示 V1.1 到 V1.2 新增、删除和修改了什么。

## 6. 回退版本：先分清两件事

### 临时查看旧版本

```bash
git switch --detach v1.1.0
```

这只用于查看或测试，不会修改 main。

回到最新版：

```bash
git switch main
```

### 正式回滚生产代码

推荐使用 `git revert`，因为它会新增一个“撤销提交”，保留历史。

```bash
git revert 提交哈希
git push origin main
```

不要轻易使用：

```bash
git reset --hard
git push --force
```

它会改写历史，可能让其他环境和 GitHub 不一致。除非明确进行仓库历史重建，否则禁止使用。

### 回滚到某个发布版本

最安全的产品流程：

1. 从目标 Tag 创建回滚分支。
2. 部署到测试环境验证。
3. 将回滚分支合并回 main。
4. 创建新的修订版本，而不是悄悄移动旧 Tag。

```bash
git switch -c rollback/v1.1.0 v1.1.0
```

例如当前是 V1.2.0，回滚 V1.1 后应发布为新的 V1.2.1 或其他明确版本，并在 CHANGELOG 说明原因。

## 7. 代码回退不等于数据库回退

这是线上系统最重要的风险点之一。

- Git 只管理代码和文档。
- SQLite 数据库被 `.gitignore` 排除，不随代码版本回退。
- 旧代码可能不认识新数据库字段。
- 直接拿旧数据库覆盖生产库可能丢失用户数据。

正确步骤：

1. 发布前备份生产数据库。
2. 记录数据库结构是否变化。
3. 优先设计向后兼容的迁移。
4. 代码回滚前确认旧代码能否读取当前数据库。
5. 数据库回退必须单独审批和验证。

本项目禁止用测试数据库覆盖生产数据库。

## 8. 紧急修复 Hotfix

生产发现严重问题时：

```bash
git switch main
git pull --ff-only origin main
git switch -c hotfix/问题名称
```

只修问题，不顺手加入新需求。测试通过后合并 main，并发布修订版本，例如 `v1.2.1`。

## 9. 常用命令速查

```bash
# 当前状态
git status

# 查看未提交差异
git diff

# 查看历史
git log --oneline --graph --decorate --all

# 同步 main
git switch main
git pull --ff-only origin main

# 新建分支
git switch -c feature/名称

# 提交
git add 文件名
git commit -m "feat: 功能说明"

# 推送
git push -u origin 分支名

# 查看标签
git tag -n

# 创建发布标签
git tag -a v1.2.1 -m "Release v1.2.1"
git push origin v1.2.1

# 暂存未完成修改
git stash push -m "临时说明"
git stash pop
```

## 10. 常见状态是什么意思

### `untracked file`

新文件尚未加入 Git。确认不是密钥或数据库后，再决定是否 `git add`。

### `modified`

文件被修改但尚未提交。先用 `git diff` 查看。

### `ahead of origin/main`

本地有提交尚未推送。

### `behind origin/main`

GitHub 有更新，本地尚未拉取。

### `merge conflict`

两个修改同时改了相同位置，Git 无法自动判断。不要盲目选择“全部接受”，应逐段核对产品逻辑。

### `detached HEAD`

当前正在查看某个历史 Tag，不在正式分支上。查看完执行 `git switch main`。

## 11. 敏感信息管理

绝不能提交：

- `.env`
- API Key
- GitHub Token
- NAS 密码
- 用户数据库
- 生产日志
- 私钥

提交前检查：

```bash
git status
git diff --cached
```

如果密钥已经提交，即使随后删除文件，密钥仍可能存在于 Git 历史中。正确处理方式是立即撤销密钥并重建，而不是只删最新文件。

Deploy Key 的私钥只保留在 NAS；GitHub 中保存的是公钥。

## 12. 一人产研建议的最小制度

即使团队只有一个人，也遵守：

1. main 永远可部署。
2. 一个需求一个分支。
3. 一个 Commit 一个明确意图。
4. 先测试后生产。
5. 发布必须有 Tag 和 CHANGELOG。
6. 改数据库前必须备份。
7. 密钥绝不进入 Git。
8. AI 不能自行决定产品范围或版本号。
9. 历史不可伪造；重建内容必须明确标注。
10. 生产回滚需要同时评估代码与数据。

## 13. 每次发布检查表

### 产品

- [ ] PRD 已确认
- [ ] 版本号已确认
- [ ] 验收标准已确认
- [ ] 明确本次不做什么

### 开发

- [ ] 使用独立分支
- [ ] Commit 信息清楚
- [ ] 没有敏感文件
- [ ] CHANGELOG 已更新

### 测试

- [ ] 测试环境部署成功
- [ ] 新功能验收通过
- [ ] 核心流程回归通过
- [ ] 移动端验证通过
- [ ] API 健康检查通过

### 发布

- [ ] 生产数据库已备份
- [ ] main 已合并并推送
- [ ] 生产部署成功
- [ ] Tag 已创建并推送
- [ ] GitHub Release 已填写
- [ ] 生产健康检查通过

## 14. 本项目的决策权限

- 产品负责人决定：需求范围、版本号、交互、价格和上线时间。
- AI 可以建议：技术方案、风险、测试和实现顺序。
- AI 不得擅自创建下一版本规划或扩大需求范围。
- 未经确认的想法只能作为对话建议，不能写入正式 Roadmap、CHANGELOG 或代码。

