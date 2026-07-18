param(
  [string]$QuestionTextPath = ".work/practice-source.txt",
  [string]$SyllabusTextPath = ".work/practice-syllabus.txt",
  [string]$OutputPath = ".work/practice-source.json"
)

$ErrorActionPreference = "Stop"

function Normalize-Text([string]$Text) {
  if ([string]::IsNullOrWhiteSpace($Text)) {
    return ""
  }

  return (($Text -replace [char]7, " " -replace "\s+", "" -replace "[，。；：、（）()《》/]", "").Trim())
}

function Clean-Block([string]$Text) {
  if ([string]::IsNullOrWhiteSpace($Text)) {
    return ""
  }

  $lines = ($Text -replace [char]7, "`n" -replace "`r", "") -split "`n"
  $cleaned = foreach ($line in $lines) {
    $value = ($line -replace "\s+", " ").Trim()
    if ($value) {
      $value
    }
  }

  return ($cleaned -join "`n").Trim()
}

$knowledgePointNames = @{
  "1.1.1" = "业务数据采集流程设计"
  "1.1.2" = "业务数据处理流程设计"
  "1.1.3" = "业务数据审核流程设计"
  "1.2.1" = "业务模块问题识别"
  "1.2.2" = "业务模块优化方案设计"
  "2.1.1" = "数据清洗和标注流程设计"
  "2.1.2" = "数据清洗和标注规范制定"
  "2.2.1" = "训练集与测试集维护"
  "2.2.2" = "算法训练工具使用"
  "2.2.3" = "人工智能产品测试"
  "2.2.4" = "测试结果分析与报告编写"
  "2.2.5" = "错误案例分析与纠正"
  "3.1.1" = "智能产品数据分析"
  "3.1.2" = "智能产品优化需求"
  "3.1.3" = "智能解决方案设计"
  "3.2.1" = "人机交互方式设计"
  "3.2.2" = "人机交互流程设计"
  "4.1.1" = "初级培训讲义编写"
  "4.1.2" = "知识与技术培训"
  "4.2.1" = "数据采集与处理指导"
  "4.2.2" = "数据标注指导"
}

$questionSource = Get-Content -Raw -Encoding UTF8 $QuestionTextPath
$syllabusSource = (Get-Content -Raw -Encoding UTF8 $SyllabusTextPath) -replace [char]7, "`n"

$syllabusMatches = [regex]::Matches(
  $syllabusSource,
  "(?ms)^\s*(\d+\.\d+\.\d+)\s*$\s*^\s*(能够|能使用|能)([^\r\n]+)"
)

$syllabus = foreach ($match in $syllabusMatches) {
  $code = $match.Groups[1].Value
  $requirement = ($match.Groups[2].Value + $match.Groups[3].Value.Trim()) -replace "\s+", " "
  [PSCustomObject]@{
    code = $code
    name = $knowledgePointNames[$code]
    requirement = $requirement.Trim()
    normalized_requirement = Normalize-Text $requirement
  }
}

$questionMatches = [regex]::Matches(
  $questionSource,
  "试题代码[:：]\s*([0-9]+(?:\.[0-9]+){2})"
)

$codeOccurrences = @{}
$questions = for ($index = 0; $index -lt $questionMatches.Count; $index++) {
  $match = $questionMatches[$index]
  $start = $match.Index
  $end = if ($index + 1 -lt $questionMatches.Count) {
    $questionMatches[$index + 1].Index
  } else {
    $questionSource.Length
  }

  $block = $questionSource.Substring($start, $end - $start)
  $sourceCode = $match.Groups[1].Value
  if (-not $codeOccurrences.ContainsKey($sourceCode)) {
    $codeOccurrences[$sourceCode] = 0
  }
  $codeOccurrences[$sourceCode] += 1

  $title = [regex]::Match($block, "试题名称[:：]\s*([^\r\n]+)").Groups[1].Value.Trim()
  $workTask = [regex]::Match(
    $block,
    "(?s)工作任务\s*(.*?)\s*技能要求"
  ).Groups[1].Value
  $skills = [regex]::Match(
    $block,
    "(?s)技能要求\s*(.*?)\s*(?:\d+[、.]\s*)?质量指标"
  ).Groups[1].Value

  if ([string]::IsNullOrWhiteSpace($skills)) {
    $skills = [regex]::Match(
      $block,
      "(?s)技能要求\s*(.*?)\s*(?:主观评分表|客观评分表)"
    ).Groups[1].Value
  }

  $scoring = [regex]::Match(
    $block,
    "(?s)(?:主观评分表|客观评分表).*"
  ).Value

  $skillsClean = Clean-Block $skills
  $skillsNormalized = Normalize-Text $skillsClean
  $mappedPoints = foreach ($point in $syllabus) {
    if ($skillsNormalized.Contains($point.normalized_requirement)) {
      [PSCustomObject]@{
        code = $point.code
        name = $point.name
        requirement = $point.requirement
      }
    }
  }

  [PSCustomObject]@{
    question_no = $index + 1
    source_code = $sourceCode
    source_variant = $codeOccurrences[$sourceCode]
    title = $title
    stem = Clean-Block $workTask
    skill_requirements = $skillsClean
    scoring_reference = Clean-Block $scoring
    knowledge_points = @($mappedPoints)
  }
}

$result = [PSCustomObject]@{
  subject = [PSCustomObject]@{
    key = "ai-trainer-level-3-practical"
    name = "人工智能训练师（三级）（实操）"
    mode = "static-subjective"
  }
  syllabus = @(
    $syllabus | ForEach-Object {
      [PSCustomObject]@{
        code = $_.code
        name = $_.name
        requirement = $_.requirement
      }
    }
  )
  questions = @($questions)
}

$json = $result | ConvertTo-Json -Depth 10
$resolvedOutput = [System.IO.Path]::GetFullPath((Join-Path (Get-Location) $OutputPath))
$outputDirectory = [System.IO.Path]::GetDirectoryName($resolvedOutput)
[System.IO.Directory]::CreateDirectory($outputDirectory) | Out-Null
[System.IO.File]::WriteAllText($resolvedOutput, $json, [System.Text.UTF8Encoding]::new($false))

$unmapped = @($questions | Where-Object { $_.knowledge_points.Count -eq 0 })
[PSCustomObject]@{
  Questions = $questions.Count
  SyllabusPoints = $syllabus.Count
  UnmappedQuestions = $unmapped.Count
  DuplicateSourceCodes = @($codeOccurrences.GetEnumerator() | Where-Object Value -gt 1).Count
  Output = $resolvedOutput
}
