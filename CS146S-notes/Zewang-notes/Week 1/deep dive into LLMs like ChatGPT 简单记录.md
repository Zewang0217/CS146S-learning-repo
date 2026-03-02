
- url: https://www.youtube.com/watch?v=7xTGNNLPyMI

# 一. 预处理

## Step1: 下载并处理internet

- 互联网上的网页仅针对文本进行了各种过滤,现在已经有了大量40TB的文本,

![image](assets/image-20260302193155-h7c67bu.png)

## Step2: tokenization

- 一个分词器地址:[ https://tiktokenizer.vercel.app/](https://tiktokenizer.vercel.app/)

- text 和 sequences of symbols(tokens)的互相转化
- run the byte pair encoding algorithm

## Step3: 神经网络训练

![image](assets/image-20260302200055-u7mh00o.png)

![image](assets/image-20260302200446-when9p1.png)

---

## [notebookllm总结](obsidian://open?vault=CS146S&file=Week%201%2Fdeep%20dive%20into%20LLMs%20like%20ChatGPT%2F%E9%A2%84%E5%A4%84%E7%90%86)

---
# 二. 后训练和监督微调（SFT)

## 幻觉解决

### 措施一
- 解决: 让 model 对不知道的模型回答"不知道"
- 例子: 给定一段上下文,让llm生成几个问题和正确答案;跳转到另外一个model,问他问题(多次),对比答案与正确答案是否相符,如果不符合(回答错误),代表model不知道这问题的答案,于是新增一个训练数据为: 该问题 & "我不清楚这问题的答案"

 ### 措施二
- 联网搜索(工具)
- 大量重复使用搜索工具的训练数据

## 记忆
- 神经网络参数中的知识只是模糊的记忆,
- 构成上下文窗口的标记中的知识,就是工作记忆

## models need tokens to think
- 直接给答案 -> 不好
- 过程 -> 答案,  ok 
- 创造中间结果 & 使用工具(use code),效果会更好
### models can't count

### models are not good with spelling
