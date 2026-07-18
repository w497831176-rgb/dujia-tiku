param(
  [string]$SourcePath = ".work/practice-source.json",
  [string]$QuestionOutputPath = "web/practice-questions.json",
  [string]$ExtractOutputPath = "web/practice-extract-all.md"
)

$ErrorActionPreference = "Stop"

function Get-Category([string]$SourceCode) {
  $parts = $SourceCode.Split(".")
  if ($parts.Count -ne 3) {
    throw "Invalid source code: $SourceCode"
  }
  return "$($parts[1]).$($parts[2])"
}

function Get-Domain([string]$Text) {
  if ($Text -match "取色|光谱|Lab色|信用|评分卡") {
    return "business"
  }
  if ($Text -match "图像|吸烟|取色|视觉|目标检测") {
    return "image"
  }
  if ($Text -match "文本|评论|情感|新闻|实体|问答|卖点|回评") {
    return "text"
  }
  if ($Text -match "营销|推荐|客户|用户行为|商品") {
    return "business"
  }
  return "general"
}

function Get-DomainAdvice([string]$Domain) {
  switch ($Domain) {
    "image" {
      return "图像数据需统一格式、分辨率和颜色空间，检查模糊、遮挡、曝光和重复样本；标注时统一类别、边界框或关键区域规则，并覆盖光照、角度、距离和复杂背景等变化。"
    }
    "text" {
      return "文本数据需统一编码和字段格式，处理空值、乱码、HTML、重复文本及异常符号；标注时明确标签定义、边界案例、歧义反馈和一致性抽检规则，并避免训练集与测试集出现近重复文本。"
    }
    "business" {
      return "业务数据需统一用户、商品、订单和行为事件口径，处理缺失值、异常值、重复记录及时间穿越；按时间窗口构造特征，并落实脱敏、权限、留存周期和数据血缘。"
    }
    default {
      return "先统一数据字段、格式、单位和统计口径，再处理缺失、异常、重复与噪声；建立版本、权限、血缘和质量检查规则，确保数据可复现、可追踪、可用于训练与测试。"
    }
  }
}

function Get-KnowledgePoints($Syllabus, [string[]]$Codes) {
  return @(
    foreach ($code in $Codes) {
      $point = $Syllabus | Where-Object { $_.code -eq $code } | Select-Object -First 1
      if (-not $point) {
        throw "Unknown syllabus code: $code"
      }
      [PSCustomObject]@{
        code = $point.code
        name = $point.name
        requirement = $point.requirement
      }
    }
  )
}

function New-SpecialAnswerContent($Question, $Syllabus) {
  $answer = $null
  $points = @()
  $approach = ""
  $codes = @()
  $framework = $null

  switch ($Question.source_code) {
    "9.1.1" {
      $framework = "1.1"
      $codes = @("1.1.1")
      $answer = @"
### 一、采集数据分析

验证码识别需要采集**验证码图像和与图像一一对应的数字标签**。样本应覆盖0—9数字、不同位数、字体、字号、颜色、背景、噪声线、旋转、扭曲、粘连、遮挡及不同清晰度，避免只采集单一样式。每张图像保留唯一编号、来源、采集时间、尺寸和预期标签。

采集规则包括：图像内容合法且不包含真实账号隐私；格式和命名统一；类别与数字组合分布尽量均衡；明显损坏、空白、过小或无法辨认的图像不进入正式样本集；训练、验证和测试来源应避免重复。

### 二、可行采集方法

1. **业务系统采样**：在授权的测试环境或历史样本中截取验证码，自动保存图像、时间戳和真实结果。优点是真实，缺点是数量和分布受线上场景限制。
2. **程序合成**：使用多种字体、背景、颜色、干扰线和几何变换批量生成验证码，并同步生成标签。优点是数量大、标签准确，缺点是需要控制合成数据与真实数据的差异。
3. **公开数据补充**：选用授权明确的验证码或数字图像数据，经格式转换和质量筛选后并入，用于补充稀缺样式。

最终以真实数据为主、合成数据补充，并通过抽样复核确认数据可识别、标签一致和分布合理。
"@
      $points = @(
        "明确采集验证码图像及其数字标签",
        "覆盖字体、颜色、噪声、遮挡和形变等变化",
        "规定格式、命名、合法性和质量要求",
        "至少给出业务采样和程序合成两种方法",
        "说明每种采集方法的优缺点",
        "对类别分布、重复样本和数据隔离进行检查"
      )
      $approach = "先回答采什么、覆盖哪些变化和达到什么质量，再分别说明真实采样与程序合成的步骤、优势和限制。"
    }
    "9.1.2" {
      $framework = "2.1"
      $codes = @("1.1.2", "2.1.1")
      $answer = @"
### 验证码图像清洗方案

1. 只读遍历 `captcha` 目录，识别常见图像格式并记录原始文件总数。
2. 使用Pillow打开图像，读取宽度和高度；当 `min(width, height) < 10` 时判定为像素过小。
3. 删除前先把文件名加入清单，完成后输出删除数量和剩余数量；无法打开的损坏图像单独隔离，不能静默忽略。
4. 将代码、删除文件名、删除数量和清洗前后统计写入指定文档，并保留原始数据备份。

```python
from pathlib import Path
from PIL import Image

removed = []
for path in Path("captcha").iterdir():
    if not path.is_file():
        continue
    try:
        with Image.open(path) as image:
            if min(image.size) < 10:
                removed.append(path.name)
                path.unlink()
    except Exception:
        print("无法读取，需人工复核：", path.name)

print("删除文件：", removed)
print("删除数量：", len(removed))
```

正式操作前应复制数据目录或先以预览模式输出待删除清单，确认规则无误后再执行删除。
"@
      $points = @(
        "遍历captcha目录并读取图像尺寸",
        "使用短边小于10像素作为删除条件",
        "输出被删除图像的名称和数量",
        "损坏或无法读取的图像进入人工复核",
        "保留原始备份和清洗过程记录",
        "代码能够正常运行且路径、异常处理清楚"
      )
      $approach = "把任务拆为遍历、尺寸判断、删除记录、异常处理和结果汇总五步；先预览再删除，避免误清理。"
    }
    "9.2.1" {
      $framework = "2.1"
      $codes = @("2.1.2", "2.2.1")
      $answer = @"
### 一、验证码标注规范

- **标注方法**：以单张图像为标注单位，人工读取完整验证码数字，将文件相对路径与文本标签一一对应写入 `label.txt`。
- **标注范围**：数字内容完整、可辨认的图像必须标注；空白、严重损坏、尺寸异常或无法判断的图像不进入正式数据。
- **标注规则**：保留前导0；标签只允许0—9数字；字符顺序必须与图像一致；不得根据上下文猜测遮挡严重的字符。
- **特殊情况**：模糊、样式异常或多人判断不一致的样本进入疑难池，由负责人裁决，并把结论补充进规范。
- **交付格式**：图像放入 `image` 目录，`label.txt` 每行保存 `文件名 标签`；统一使用UTF-8编码和固定版本号。

### 二、训练集与测试集划分

1. 校验每个图像都有且只有一个标签，删除或隔离缺失配对项。
2. 固定随机种子打乱数据，按8:2划分训练集和测试集；相同或近重复验证码不能跨集合。
3. 分别创建训练和测试目录，复制对应图像并生成各自的 `label.txt`。
4. 输出两部分样本数量、标签分布和划分日志，保存代码截图与最终数据集。
"@
      $points = @(
        "说明标注对象、方法、范围和字符顺序",
        "规定前导0、严重遮挡和疑难样本处理方式",
        "图像与label.txt一一对应且格式明确",
        "训练集与测试集按8:2划分",
        "固定随机种子并避免重复样本跨集合",
        "输出划分数量、标签分布和交付目录"
      )
      $approach = "先制定可执行的标注标准，再做图像和标签配对校验，最后按8:2划分并验证数量与分布。"
    }
    "9.2.2" {
      $framework = "2.2"
      $codes = @("2.2.2", "2.2.3", "2.2.4", "2.2.5")
      $answer = @"
### 一、模型训练

1. 按Notebook说明准备环境，核对训练、验证数据路径和标签文件。
2. 在代码中记录开始时间，执行 `python config/train.py`，训练结束后计算并输出总耗时。
3. 保存训练日志、关键参数和各轮模型文件，将 `epoch_3.pth` 复制到规定目录，并保留代码截图。

```python
import subprocess
import time

started = time.time()
subprocess.run(["python", "config/train.py"], check=True)
print(f"训练时长：{time.time() - started:.2f} 秒")
```

### 二、测试与验证

加载 `model` 目录中的第3轮参数，对 `images` 中的验证码逐张预测，输出图像、预测数字和实际数字；汇总完全匹配准确率，并重点记录易混淆数字。

测试不准确时，从图像清晰度、训练样本覆盖、标签错误、字符分割、模型欠拟合或过拟合等方面分析。对应改进包括补充薄弱样式、修正标签、增加合理的数据增强、调整训练轮次和参数，并使用同一测试集复测。
"@
      $points = @(
        "按指定命令完成模型训练",
        "正确记录并输出训练时长",
        "保存第3轮模型参数和训练证据",
        "加载指定参数测试验证码图像",
        "记录预测结果并判断是否准确",
        "对错误结果给出原因分析和可验证的改进方法"
      )
      $approach = "训练部分强调命令、时间和模型文件；测试部分强调加载指定参数、逐样本预测、记录错误并复测。"
    }
    "9.3.1" {
      $framework = "1.1"
      $codes = @("1.1.3", "2.1.2")
      $answer = @"
### 验证码标注质检方法

1. **全量规则质检**：程序检查图像是否存在、标签是否缺失、标签是否只含数字、字符长度是否合理、文件是否重复。优点是速度快、覆盖全部数据；缺点是无法判断图像中的真实数字是否与标签一致。
2. **人工抽样复核**：按批次、标注员和验证码样式分层抽样，由复核员对照图像检查标签。优点是能发现语义性错标；缺点是成本高且抽样可能漏掉低频问题。
3. **双人一致性复核**：两名人员独立标注同一批样本，计算完全一致率，对不一致项仲裁。优点是质量判断可靠；缺点是人力成本最高。

推荐流程为：规则全检—分层抽样—不合格批次扩大抽检—问题返修—再次验收。质检报告记录检查数量、错误类型、错误率、责任批次和处理结果；疑难案例用于更新标注规范。
"@
      $points = @(
        "至少给出两种标注质检方法",
        "说明全量规则质检的流程和局限",
        "说明人工抽样或双人复核的流程和局限",
        "抽样覆盖批次、标注员和不同样式",
        "不合格批次有扩大抽检和返修机制",
        "质检结果形成报告并更新标注规范"
      )
      $approach = "用自动规则解决格式和完整性，用人工复核解决标签是否正确；对每种方法都写步骤、优点、缺点和适用范围。"
    }
    "9.3.2" {
      $framework = "2.1"
      $codes = @("1.1.2", "2.1.1")
      $answer = @"
### 一、统一转换为JPG

遍历 `captcha` 目录，使用Pillow打开图像并转换为RGB，再保存为JPG。先输出到新目录，成功后再替换原目录；转换失败的文件记录并人工处理。

### 二、按四位数字重新命名

对转换成功的文件按稳定顺序排序，使用临时文件名完成第一阶段重命名，避免新旧名称冲突；第二阶段再改为 `0000.jpg、0001.jpg……`。同时保存“原文件名—新文件名”映射表。

```python
from pathlib import Path
from PIL import Image

source = Path("captcha")
target = Path("captcha_jpg")
target.mkdir(exist_ok=True)

mapping = []
for index, path in enumerate(sorted(p for p in source.iterdir() if p.is_file())):
    new_name = f"{index:04d}.jpg"
    with Image.open(path) as image:
        image.convert("RGB").save(target / new_name, "JPEG", quality=95)
    mapping.append((path.name, new_name))

print("处理数量：", len(mapping))
```

完成后校验文件总数、编号连续性、图像可打开性和标签映射，再提交代码截图、数据集及映射记录。
"@
      $points = @(
        "批量读取图像并转换为RGB JPG",
        "输出到新目录以保护原始数据",
        "新名称从0000开始连续编号",
        "使用稳定排序并避免重命名冲突",
        "保存原文件名与新文件名映射",
        "检查数量、连续性和图像可读取性"
      )
      $approach = "先无损保留原数据，再统一格式、顺序编号、保存映射并做完整性校验。"
    }
    "10.1.1" {
      $framework = "1.1"
      $codes = @("1.1.1", "1.1.2", "1.1.3")
      $answer = @"
### 信用评分数据探索分析

1. **总体客户质量**：统计目标字段 `SeriousDlqin2yrs` 中好客户和坏客户数量，坏客户占比为 `坏客户数 / 总客户数`。
2. **月收入分组**：按 `[0,5000)、[5000,10000)、[10000,15000)、[15000,+∞)` 分箱，分别统计客户数和违约率。
3. **年龄分组**：先核对题目中年龄区间是否重叠，再按确认后的互斥区间分箱，统计各年龄段客户数和违约率。

```python
bad_rate = df["SeriousDlqin2yrs"].mean()
income_bins = [0, 5000, 10000, 15000, float("inf")]
df["income_group"] = pd.cut(df["MonthlyIncome"], income_bins, right=False)
income_report = df.groupby("income_group", observed=False)["SeriousDlqin2yrs"].agg(["count", "mean"])
```

报告需给出数据量、好坏客户数量、整体坏账率、各分组客户数和违约率，并说明高风险人群。由于原始数据未随题目提供，不能编造具体统计结果，应运行代码后填入实际数值。
"@
      $points = @(
        "统计好客户、坏客户数量和整体坏客户占比",
        "按指定收入区间统计客户数和违约率",
        "核对并修正重叠的年龄分组口径",
        "按年龄区间统计客户数和违约率",
        "使用真实数据填表而不编造结果",
        "基于分组结果识别高风险客群"
      )
      $approach = "先核对目标字段和分组口径，再使用分箱加分组聚合计算客户数与违约率，最后解释风险差异。"
    }
    "10.1.2" {
      $framework = "2.1"
      $codes = @("1.1.2", "1.2.1", "1.2.2")
      $answer = @"
### 信用评分数据预处理

1. 复制原始数据，记录初始行数并检查字段类型、缺失率和异常分布。
2. 按题目规则依次剔除：可用额度比值大于1、年龄小于18、三类逾期次数字段大于等于80的记录。每一步都记录删除数量和剩余数量。
3. 对 `MonthlyIncome` 使用非缺失样本训练随机森林回归模型，以其他可用特征预测并填充缺失收入。
4. 对其余仍有缺失的记录按要求删除，输出最终数据量，并再次检查是否还存在缺失和异常。

```python
rules = (
    (df["RevolvingUtilizationOfUnsecuredLines"] <= 1) &
    (df["age"] >= 18) &
    (df["NumberOfTime30-59DaysPastDueNotWorse"] < 80) &
    (df["NumberOfTime60-89DaysPastDueNotWorse"] < 80) &
    (df["NumberOfTimes90DaysLate"] < 80)
)
clean = df.loc[rules].copy()
```

随机森林填充时目标列为 `MonthlyIncome`，训练集只能使用该列非空数据；填充后再删除其他缺失记录。实际剩余条数必须由程序输出，不能预设。
"@
      $points = @(
        "按题目给定的五类异常规则过滤数据",
        "逐步记录删除数量和剩余数量",
        "使用非缺失收入样本训练随机森林回归",
        "使用模型填充MonthlyIncome缺失值",
        "删除其余缺失记录并完成复核",
        "保留处理代码、数据版本和最终统计"
      )
      $approach = "严格按题目阈值先处理异常，再用随机森林填充月收入，最后删除其他缺失并输出真实剩余数量。"
    }
    "10.2.1" {
      $framework = "2.1"
      $codes = @("2.1.1", "2.1.2")
      $answer = @"
### 信用评分特征工程

1. 对题目指定的连续变量采用最优分箱，其余变量采用等距分箱；每个分箱计算好坏客户数量、WOE和IV，并合并样本过少或单一类别的分箱。
2. IV反映变量区分好坏客户的能力。IV小于0.1的变量按题目要求剔除，同时警惕IV异常过高可能存在数据泄漏。
3. 使用清洗后的数据计算相关系数矩阵并绘制热力图；当两个变量相关系数绝对值大于0.6时，结合IV、业务解释性和稳定性保留其中更合适的一个。
4. 输出各变量分箱边界、WOE、IV、相关性结果和最终保留变量清单，训练与后续评分必须使用同一套分箱规则。
"@
      $points = @(
        "指定变量采用最优分箱，其余变量采用等距分箱",
        "正确计算并解释WOE和IV",
        "绘制相关性热力图并按0.6阈值检查",
        "结合IV和业务意义处理高相关变量",
        "剔除IV小于0.1的变量",
        "保存分箱规则和最终特征清单供模型复用"
      )
      $approach = "先分箱计算WOE/IV，再进行相关性和IV双重筛选，最终保留稳定、有效且业务可解释的变量。"
    }
    "10.2.2" {
      $framework = "2.2"
      $codes = @("2.2.1", "2.2.2", "2.2.3", "2.2.4", "2.2.5")
      $answer = @"
### Logistic信用评分模型训练

1. 读取已预处理数据，以 `SeriousDlqin2yrs` 为目标变量，按要求剔除 `DebtRatio`、`MonthlyIncome`、`NumberOfOpenCreditLinesAndLoans`、`NumberRealEstateLoansOrLines` 和 `NumberOfDependents`。
2. 将数据划分为训练集和测试集；在训练集上完成标准化或其他必要处理，并把同一处理器应用到测试集。
3. 训练Logistic回归模型，处理类别不均衡时可设置 `class_weight="balanced"`，记录参数和随机种子。
4. 在测试集输出混淆矩阵、精确率、召回率、F1值、ROC曲线和AUC，并结合坏客户召回率评价风险识别能力。

```python
model = LogisticRegression(max_iter=1000, class_weight="balanced")
model.fit(X_train, y_train)
prob = model.predict_proba(X_test)[:, 1]
```

如坏客户漏判较多，应检查类别不均衡、特征区分度和阈值，并在同一测试集上复测。
"@
      $points = @(
        "正确设置目标变量并剔除题目指定特征",
        "训练集与测试集划分合理",
        "完成Logistic回归模型训练",
        "输出混淆矩阵、F1、ROC和AUC",
        "重点解释坏客户召回率和漏判风险",
        "针对类别不均衡、特征或阈值提出改进"
      )
      $approach = "按指定特征清单训练Logistic模型，用独立测试集评估，重点从坏客户识别和风险成本解释结果。"
    }
    "10.3.1" {
      $framework = "3.1"
      $codes = @("3.1.1", "3.1.2", "3.1.3")
      $answer = @"
### 一、Logistic模型常用评估指标

- **准确率**：整体预测正确比例，类别不均衡时不能单独使用。
- **精确率**：预测为坏客户的人中实际坏客户比例。
- **召回率**：实际坏客户中被识别出的比例，反映漏判风险。
- **F1值**：精确率和召回率的调和平均。
- **混淆矩阵**：展示好坏客户的正确和错误分类。
- **ROC-AUC**：衡量模型对好坏客户的整体区分能力。
- **KS值**：信用评分中常用于衡量好坏客户累计分布的最大差异。

### 二、特征离散化原因

离散化能够缓解极端值影响，表达变量与违约风险之间的非线性关系，提高模型稳定性和可解释性；结合WOE后，系数方向更容易解释，也便于把模型转换成评分卡。分箱应保证样本量充足、坏账率趋势合理，并在训练和预测阶段使用完全相同的边界。
"@
      $points = @(
        "说明准确率、精确率、召回率和F1值",
        "说明混淆矩阵、ROC-AUC和KS的作用",
        "指出类别不均衡时准确率的局限",
        "解释离散化对异常值和非线性的作用",
        "解释离散化对稳定性和可解释性的作用",
        "强调训练与预测使用同一分箱规则"
      )
      $approach = "指标回答要说明含义和业务风险；离散化回答要覆盖非线性、异常值、稳定性、解释性和评分卡落地。"
    }
    "10.3.2" {
      $framework = "3.2"
      $codes = @("3.2.1", "3.2.2")
      $answer = @"
### 使用ROC-AUC评估信用评分模型

1. 加载测试集、已训练模型及与训练阶段一致的特征处理器。
2. 使用 `predict_proba` 获取坏客户概率，不能用0/1预测结果直接绘制完整ROC曲线。
3. 计算假阳性率、真正率和AUC，绘制ROC曲线并标出随机基线。

```python
import matplotlib.pyplot as plt
from sklearn.metrics import roc_curve, roc_auc_score

prob = model.predict_proba(X_test)[:, 1]
fpr, tpr, thresholds = roc_curve(y_test, prob)
auc_value = roc_auc_score(y_test, prob)

plt.plot(fpr, tpr, label=f"AUC={auc_value:.3f}")
plt.plot([0, 1], [0, 1], "--", color="gray")
plt.xlabel("False Positive Rate")
plt.ylabel("True Positive Rate")
plt.legend()
plt.show()
```

AUC越接近1，模型区分好坏客户的能力越强；约等于0.5说明接近随机判断。还应结合坏客户召回率、KS值、阈值和业务误判成本共同决定模型是否可用。
"@
      $points = @(
        "加载模型和与训练一致的测试特征",
        "使用predict_proba取得坏客户概率",
        "正确计算fpr、tpr和AUC",
        "绘制ROC曲线和随机基线",
        "正确解释AUC大小的含义",
        "结合召回率、KS和业务成本综合判断"
      )
      $approach = "用预测概率而不是类别结果计算ROC-AUC，画图后结合风险识别成本解释模型质量。"
    }
  }

  if (-not $framework) {
    return $null
  }

  return [PSCustomObject]@{
    ai_reference_answer = $answer.Trim()
    scoring_points = $points
    answer_approach = $approach
    knowledge_points = Get-KnowledgePoints $Syllabus $codes
    framework_code = $framework
  }
}

function New-AnswerContent($Question, $Syllabus) {
  $special = New-SpecialAnswerContent $Question $Syllabus
  if ($special) {
    return $special
  }

  $category = Get-Category $Question.source_code
  $context = "$($Question.title)`n$($Question.stem)"
  $domain = Get-Domain $context
  $domainAdvice = Get-DomainAdvice $domain
  $topic = $Question.title

  switch ($category) {
    "1.1" {
      $codes = @("1.1.1", "1.1.2", "1.1.3")
      $answer = @"
### 一、业务数据采集流程

1. **明确目标和口径**：围绕“$topic”的业务目标确定预测或分析对象、使用场景、核心指标、数据粒度和时间范围。
2. **盘点数据来源**：识别内部业务系统、用户行为日志、设备或平台数据以及必要的外部数据，形成字段清单和数据字典。
3. **设计采集方式**：根据数据实时性选择接口、埋点、日志、批量文件或数据库同步；规定采集频率、唯一标识、时间戳和失败补采机制。
4. **安全入库**：采集前取得合法授权，对个人或敏感字段脱敏；数据进入分层存储区，并记录来源、版本、责任人和更新时间。

### 二、业务数据处理流程

1. 进行格式、类型、编码和单位统一，删除重复记录并处理缺失值、异常值和无效样本。
2. 依据业务口径完成数据关联、标签构造、特征转换和样本筛选，避免使用预测时不可获得的未来信息。
3. $domainAdvice
4. 将处理规则固化为可重复执行的流程，保留处理前后数据量、规则命中量和版本记录。

### 三、业务数据审核流程

1. **审核指标**：完整性、准确性、一致性、唯一性、及时性、有效性及类别分布。
2. **审核方法**：规则校验、跨表核对、抽样复核、统计分布对比和异常检测。
3. **结果处理**：合格数据进入训练区；可修复数据退回清洗；严重异常数据隔离；问题形成清单并追踪闭环。
4. **持续监控**：设置质量阈值和告警，按批次输出质量报告，规则变化后重新抽检。
"@
      $points = @(
        "明确业务目标、数据范围和字段口径",
        "说明数据来源、采集方式、存储和更新机制",
        "覆盖缺失、异常、重复、格式统一和特征处理",
        "给出完整性、准确性、一致性等审核指标",
        "给出规则校验、抽样复核和异常检测方法",
        "说明不合格数据的修复、隔离和闭环机制"
      )
      $approach = "按「目标与口径—数据来源—采集入库—清洗加工—质量审核—问题闭环」展开。回答时先写完整流程，再补充与题目场景匹配的数据字段、质量风险和安全要求。"
    }
    "1.2" {
      $codes = @("1.2.1", "1.2.2")
      $answer = @"
### 一、问题识别与原因分析

围绕“$topic”，先从数据、模型、流程和业务应用四层排查：

1. **数据层**：数据量不足、样本分布偏斜、标签错误、字段缺失、数据延迟或训练与线上口径不一致。
2. **模型层**：特征不足、参数不合适、过拟合或欠拟合、评估指标与业务目标不一致。
3. **流程层**：采集、清洗、标注、训练、发布和反馈之间缺少责任人、版本记录或质量门槛。
4. **业务层**：目标用户、触发时机、输出方式或人工使用流程设计不合理，导致模型结果不能转化为业务价值。

定位时使用数据分布对比、错误案例分析、流程访谈、日志排查和分模块指标对照，确认问题出现的环节和根因。

### 二、业务模块优化方案

1. **目标**：把问题转换成可量化指标，例如提升数据完整率和关键类别召回率、降低误报率、缩短处理时延。
2. **数据优化**：补充薄弱场景样本，修订清洗和标注规范，建立质量阈值与版本管理。
3. **模型优化**：改进特征、调整参数、处理类别不均衡，并按业务场景选择准确率、精确率、召回率或F1值。
4. **流程优化**：增加上线前验证、灰度发布、人工复核、异常回退和线上监控。
5. **验证方式**：使用同一基准集进行前后对比，必要时开展A/B测试，并按错误类型复盘。
6. **预期结果**：模型指标和业务指标同步改善，问题可监控、可追踪、可持续迭代。
"@
      $points = @(
        "至少识别数据、模型、流程或业务使用中的两个问题",
        "问题与原因之间具有明确因果关系",
        "优化方案包含目标、方法、实施步骤和责任环节",
        "给出数据、模型及业务流程中的针对性优化动作",
        "使用基准对比或A/B测试验证效果",
        "说明可量化的预期结果和持续监控机制"
      )
      $approach = "先把现象拆成数据、模型、流程、业务四层，再用证据定位根因。优化方案必须和根因一一对应，并写清目标、动作、验证指标和预期结果。"
    }
    "2.1" {
      $codes = @("2.1.1", "2.1.2")
      $answer = @"
### 一、数据清洗与处理流程

1. 读取原始数据并检查字段、类型、编码、样本量和标签分布，保留原始文件只读备份。
2. 处理空值、重复值、异常值、格式错误和无效记录，所有删除与修改都记录规则和数量。
3. $domainAdvice
4. 清洗完成后进行抽样核验，输出处理日志、质量统计和可复现的清洗脚本，再保存为规定格式。

### 二、数据标注规范

1. **标注对象与范围**：明确标注单位、包含与排除条件以及是否允许多标签。
2. **标签体系**：每个标签给出定义、正例、反例和容易混淆的边界案例。
3. **标注格式**：规定字段名、数据类型、文件格式、命名和版本规则。
4. **执行流程**：培训与试标—正式标注—交叉复核—抽样质检—问题返修—验收交付。
5. **质量控制**：计算标注一致率和抽检准确率；低于阈值时返修并更新规范。
6. **特殊情况**：无法判断的样本进入疑难池，由负责人确认后同步给所有标注人员。
"@
      $points = @(
        "保留原始数据并完成字段、格式和分布检查",
        "合理处理缺失、异常、重复和无效样本",
        "给出与题目数据类型匹配的专项清洗规则",
        "标注规范包含对象、标签定义、正反例和边界案例",
        "规定交付格式、版本命名和疑难反馈流程",
        "通过交叉复核、抽检和一致率控制标注质量"
      )
      $approach = "清洗回答突出「不能误删、过程可追溯」；标注回答突出「标签定义清楚、边界案例一致、疑难问题能闭环」。所有规则都要能落到字段、格式或样本上。"
    }
    "2.2" {
      $codes = @("2.2.1", "2.2.2", "2.2.3", "2.2.4", "2.2.5")
      $answer = @"
### 一、训练集与测试集维护

1. 完成数据清洗后按业务要求划分训练集、验证集和测试集，分类任务优先分层抽样；时间序列数据按时间划分，避免未来数据泄漏。
2. 固定随机种子，记录样本数量、标签分布、文件版本和划分脚本；测试集独立保存，不参与训练和调参。

### 二、模型训练

1. 建立可复现环境，加载训练数据并完成必要的特征处理。
2. 选择与任务匹配的基线算法，使用训练集拟合、验证集调参，记录参数、特征、模型版本和训练指标。
3. 对类别不均衡可采用类别权重、重采样或阈值调整，但必须只在训练数据上实施。

### 三、测试与结果分析

1. 使用独立测试集输出准确率、精确率、召回率、F1值及混淆矩阵；回归或其他任务改用对应指标。
2. 对比训练集与测试集表现判断过拟合或欠拟合，并按类别分析误报与漏报。
3. 报告中写明数据版本、环境、模型参数、指标结果、风险和改进建议，不编造未实际运行的数据。

### 四、错误案例分析

抽取错误样本，核对原始数据和标签，归类为数据质量、标签歧义、样本不足、特征缺失、模型能力或阈值设置等原因；针对原因采取修正标签、补充样本、改进特征、调整模型或增加人工复核，并重新测试验证。
"@
      $points = @(
        "训练、验证和测试数据划分合理且无数据泄漏",
        "训练过程记录环境、特征、参数和模型版本",
        "测试指标与任务类型匹配并输出混淆矩阵或对应结果",
        "能够分析过拟合、欠拟合、误报和漏报",
        "测试报告包含数据、方法、结果、风险和建议",
        "至少分析一个错误案例的现象、原因和纠正方法"
      )
      $approach = "按「数据划分—模型训练—独立测试—指标解释—错误案例—纠正复测」作答。涉及实际文件或运行结果时只给可执行步骤和判断方法，不虚构数值。"
    }
    "3.1" {
      $codes = @("3.1.1", "3.1.2", "3.1.3")
      $answer = @"
### 一、智能产品数据分析

1. 明确产品目标、用户角色和关键流程，确定业务指标、模型指标、系统指标和体验指标。
2. 对使用量、成功率、响应时延、标签或类别分布、用户反馈和异常日志进行统计，并按时间、用户群和场景分层。
3. 结合趋势、占比、漏斗、对比和错误案例定位主要问题，报告中区分事实、判断和待验证假设。

### 二、优化需求

将分析发现转成需求条目，每条包含问题证据、影响用户、优先级、目标指标、验收条件和风险。优先处理高频、高影响且可验证的问题，例如数据质量、识别效果、交互效率、异常兜底和监控缺失。

### 三、智能解决方案

1. **数据层**：完善采集、清洗、反馈回流和质量监控。
2. **模型层**：补充薄弱样本，优化特征、模型或阈值，并建立版本评估。
3. **应用层**：设计输入、输出、人工确认、异常回退和结果解释。
4. **系统层**：增加权限、安全、日志、监控、告警和灰度发布。
5. **验证层**：通过离线基准测试、业务验收和小流量验证确认效果，达不到阈值时回滚。
"@
      $points = @(
        "分析指标覆盖业务、模型、系统和用户体验",
        "使用趋势、占比、分层或错误案例形成有证据的结论",
        "优化需求包含问题、用户影响、优先级和验收指标",
        "解决方案覆盖数据、模型、应用和系统环节",
        "设计人工确认、异常兜底和安全控制",
        "给出离线测试、业务验收或灰度验证方案"
      )
      $approach = "先用数据说明问题，再把问题转成可验收需求，最后给出端到端解决方案。答案要形成「分析证据—优化需求—方案模块—效果验证」的闭环。"
    }
    "3.2" {
      $codes = @("3.2.1", "3.2.2")
      $answer = @"
### 一、人机交互最优方式

“$topic”应采用**AI优先处理、人工监督确认、低置信度转人工、结果持续回流**的协同方式。

1. AI负责高频、规则明确、可批量处理的识别、推荐、生成或预警任务。
2. 人工负责目标设定、复杂判断、低置信度结果、敏感场景和最终责任。
3. 页面展示输入依据、AI结果、置信度或风险提示，并提供确认、修改、驳回和转人工操作。
4. 对高风险动作设置强制人工确认，系统异常时可回退到人工流程。

### 二、人机交互流程

1. 用户提交任务，系统完成格式、权限和完整性校验。
2. AI执行分析并返回结果、依据和置信度。
3. 高置信度低风险结果进入人工快速确认；低置信度、高风险或规则冲突结果自动转人工复核。
4. 人工确认、修改或驳回，系统记录操作原因和最终结果。
5. 结果回写业务系统；经脱敏和审核后的反馈进入样本池，用于规则和模型迭代。
6. 监控处理时长、人工接管率、修改率、准确率和用户满意度，持续优化阈值与分工。
"@
      $points = @(
        "明确AI和人工各自负责的任务边界",
        "根据置信度、风险或规则冲突决定是否转人工",
        "提供确认、修改、驳回和异常回退机制",
        "流程覆盖输入校验、AI处理、人工复核和结果回写",
        "人工反馈经过审核后形成改进闭环",
        "设置接管率、修改率、时延和效果等监控指标"
      )
      $approach = "先判断哪些任务适合AI、哪些必须人工负责，再用置信度和风险等级设计分流。流程必须有输入校验、人工接管、结果回写、反馈学习和异常兜底。"
    }
    "4.1" {
      $codes = @("4.1.1", "4.1.2")
      $answer = @"
### 一、培训讲义目录

1. 培训目标、对象和前置知识
2. “$topic”相关基础概念和业务场景
3. 标准工作流程与岗位分工
4. 工具、数据和操作步骤演示
5. 常见问题、质量要求与安全规范
6. 完整案例练习
7. 结果检查、答疑和考核

内容应由浅入深，每个章节包含目标、重点、示例、操作步骤和检查标准。

### 二、培训方法

- **讲授法**：用于解释概念、标准和注意事项。
- **演示法**：教师按标准流程操作，学员观察关键步骤。
- **练习与研讨**：学员完成案例，讨论异常情况和解决办法。
- **视听法**：展示流程录像、错误示例或工具界面。

采用“讲解—演示—练习—纠错—考核”组合方式。培训结束后通过知识测验和实操任务评价效果，对未达标内容再次辅导。
"@
      $points = @(
        "讲义目录结构完整并由浅入深",
        "培训目标、对象和前置知识明确",
        "内容覆盖概念、流程、工具、质量和安全",
        "选择讲授、演示、研讨或练习等合适方法",
        "说明所选培训方法与内容的匹配原因",
        "包含练习、纠错、考核和培训效果评估"
      )
      $approach = "目录先解决「教什么」，培训方法再解决「怎么教」。按目标、知识、流程、工具、案例、问题和考核组织内容，并说明不同方法适合的环节。"
    }
    "4.2" {
      $codes = @("4.2.1", "4.2.2")
      $answer = @"
### 一、数据采集与处理问题指导

常见问题包括采集字段缺失、口径不一致、接口失败、重复数据、异常值、格式错误和处理结果不可复现。指导时先复现问题并确认影响范围，再检查数据源、字段字典、采集日志和处理规则；按照标准流程修复，最后重新抽检并记录原因和处理结果。

可重点指导：

1. 明确数据需求、来源、字段、频率和权限。
2. 使用日志和样本核对采集完整性。
3. 按规则处理缺失、重复、异常和格式问题。
4. 保留原始数据、脚本版本和处理记录。

### 二、数据标注问题指导

常见问题包括标签定义不清、边界案例理解不同、漏标错标、格式不统一和疑难样本无人确认。指导方向为：重申标签定义和正反例，开展小批量试标与交叉复核，计算一致率，对低一致率类别重新培训；疑难样本进入问题池，由负责人统一裁决并更新标注规范。

指导过程采用“问题诊断—标准示范—学员练习—结果复核—规范更新”的闭环，并形成可查询的问题案例库。
"@
      $points = @(
        "能够列出数据采集、处理中的典型问题",
        "按复现、定位、修复和复核步骤进行指导",
        "强调原始数据、规则和版本记录",
        "能够列出标注定义、边界和一致性问题",
        "使用试标、交叉复核和一致率控制质量",
        "疑难案例有统一裁决和规范更新机制"
      )
      $approach = "指导题不要只罗列答案，要体现带教过程：先让学员复现问题，再解释标准、示范操作、让学员练习，最后复核结果并沉淀规范。"
    }
    default {
      throw "Unsupported category $category for question $($Question.question_no)"
    }
  }

  return [PSCustomObject]@{
    ai_reference_answer = $answer.Trim()
    scoring_points = $points
    answer_approach = $approach
    knowledge_points = Get-KnowledgePoints $Syllabus $codes
    framework_code = $category
  }
}

function Escape-MarkdownCell([string]$Text) {
  return (($Text -replace "\|", "\|" -replace "`r?`n", " ").Trim())
}

$source = Get-Content -Raw -Encoding UTF8 $SourcePath | ConvertFrom-Json
$seenQuestions = @{}
$uniqueQuestions = foreach ($question in $source.questions) {
  $dedupeKey = "$($question.source_code)|$($question.title)|$($question.stem)"
  if (-not $seenQuestions.ContainsKey($dedupeKey)) {
    $seenQuestions[$dedupeKey] = $true
    $question
  }
}

$enrichedQuestions = foreach ($question in $uniqueQuestions) {
  $content = New-AnswerContent $question $source.syllabus
  [PSCustomObject]@{
    question_no = 0
    source_code = $question.source_code
    source_variant = [int]$question.source_variant
    title = $question.title
    stem = $question.stem
    ai_reference_answer = $content.ai_reference_answer
    scoring_points = @($content.scoring_points)
    answer_approach = $content.answer_approach
    knowledge_points = @($content.knowledge_points)
    framework_code = $content.framework_code
  }
}

for ($index = 0; $index -lt $enrichedQuestions.Count; $index++) {
  $enrichedQuestions[$index].question_no = $index + 1
}

$questionPayload = [PSCustomObject]@{
  version = "v1.5"
  subject = $source.subject
  generated_at = (Get-Date).ToString("yyyy-MM-dd")
  source_note = "根据操作技能复习题与操作技能考核要素细目表离线整理"
  questions = @($enrichedQuestions)
}

$questionJson = $questionPayload | ConvertTo-Json -Depth 12
$questionOutput = [System.IO.Path]::GetFullPath((Join-Path (Get-Location) $QuestionOutputPath))
[System.IO.File]::WriteAllText($questionOutput, $questionJson, [System.Text.UTF8Encoding]::new($false))

$frameworkTitles = @{
  "1.1" = "业务流程设计"
  "1.2" = "业务模块效果优化"
  "2.1" = "数据处理规范制定"
  "2.2" = "算法训练、测试与错误分析"
  "3.1" = "智能系统监控和优化"
  "3.2" = "人机交互流程设计"
  "4.1" = "培训"
  "4.2" = "指导"
}

$markdown = New-Object System.Text.StringBuilder
[void]$markdown.AppendLine("# 人工智能训练师（三级）实操AI提炼全集")
[void]$markdown.AppendLine()
[void]$markdown.AppendLine("> 本资料根据操作技能复习题和《操作技能考核要素细目表》离线整理，共覆盖 $($enrichedQuestions.Count) 份试题单、$($source.syllabus.Count) 个考纲认定点。")
[void]$markdown.AppendLine()
[void]$markdown.AppendLine("## 一、考纲知识点与题目分布")
[void]$markdown.AppendLine()
[void]$markdown.AppendLine("| 考纲代码 | 知识点 | 技能要求 | 对应题号 |")
[void]$markdown.AppendLine("| --- | --- | --- | --- |")
foreach ($point in $source.syllabus) {
  $related = @(
    $enrichedQuestions | Where-Object {
      @($_.knowledge_points.code) -contains $point.code
    } | Select-Object -ExpandProperty question_no
  )
  [void]$markdown.AppendLine("| $($point.code) | $(Escape-MarkdownCell $point.name) | $(Escape-MarkdownCell $point.requirement) | $($related -join '、') |")
}

[void]$markdown.AppendLine()
[void]$markdown.AppendLine("## 二、八类实操题通用答题范式")
[void]$markdown.AppendLine()
foreach ($category in @("1.1", "1.2", "2.1", "2.2", "3.1", "3.2", "4.1", "4.2")) {
  $sample = $enrichedQuestions | Where-Object framework_code -eq $category | Select-Object -First 1
  [void]$markdown.AppendLine("### $category $($frameworkTitles[$category])")
  [void]$markdown.AppendLine()
  [void]$markdown.AppendLine("**答题主线：** $($sample.answer_approach)")
  [void]$markdown.AppendLine()
  [void]$markdown.AppendLine("| 必写得分点 |")
  [void]$markdown.AppendLine("| --- |")
  foreach ($point in $sample.scoring_points) {
    [void]$markdown.AppendLine("| $(Escape-MarkdownCell $point) |")
  }
  [void]$markdown.AppendLine()
}

[void]$markdown.AppendLine("## 三、考场作答结构")
[void]$markdown.AppendLine()
[void]$markdown.AppendLine("| 题型 | 推荐结构 |")
[void]$markdown.AppendLine("| --- | --- |")
[void]$markdown.AppendLine("| 流程设计题 | 目标与口径 → 数据来源 → 执行步骤 → 质量控制 → 结果闭环 |")
[void]$markdown.AppendLine("| 问题优化题 | 问题现象 → 原因证据 → 优化目标 → 优化动作 → 验证指标 |")
[void]$markdown.AppendLine("| 规范制定题 | 对象范围 → 规则定义 → 操作流程 → 质量检查 → 异常处理 |")
[void]$markdown.AppendLine("| 算法测试题 | 数据划分 → 模型训练 → 独立测试 → 指标解释 → 错误案例纠正 |")
[void]$markdown.AppendLine("| 系统方案题 | 数据分析 → 优化需求 → 数据/模型/应用/系统方案 → 验收 |")
[void]$markdown.AppendLine("| 人机交互题 | 人机分工 → 风险分级 → 人工接管 → 结果回写 → 反馈闭环 |")
[void]$markdown.AppendLine("| 培训指导题 | 目标对象 → 标准讲解 → 操作示范 → 学员练习 → 复核改进 |")
[void]$markdown.AppendLine()
[void]$markdown.AppendLine("## 四、全部题目答题范式索引")
[void]$markdown.AppendLine()
[void]$markdown.AppendLine("| 题号 | 题目 | 考纲知识点 | 答题范式 |")
[void]$markdown.AppendLine("| --- | --- | --- | --- |")
foreach ($question in $enrichedQuestions) {
  $knowledge = ($question.knowledge_points | ForEach-Object { "$($_.code) $($_.name)" }) -join "；"
  [void]$markdown.AppendLine("| $($question.question_no) | $(Escape-MarkdownCell $question.title) | $(Escape-MarkdownCell $knowledge) | $(Escape-MarkdownCell $question.answer_approach) |")
}

$extractOutput = [System.IO.Path]::GetFullPath((Join-Path (Get-Location) $ExtractOutputPath))
[System.IO.File]::WriteAllText($extractOutput, $markdown.ToString(), [System.Text.UTF8Encoding]::new($false))

[PSCustomObject]@{
  Questions = $enrichedQuestions.Count
  Frameworks = @($enrichedQuestions.framework_code | Sort-Object -Unique).Count
  SyllabusPoints = $source.syllabus.Count
  QuestionOutput = $questionOutput
  ExtractOutput = $extractOutput
}
