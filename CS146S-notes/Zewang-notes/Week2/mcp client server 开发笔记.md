


          
我来为你总结一份完整的笔记，关于如何使用TypeScript编写MCP（Model Context Protocol）的客户端和服务器。
        
            
toolName: view_files
            
status: success
          
            
filePath: d:\Zewang\LearningNewThings\CS146S\obsidian-mcp\src\server.ts
          

        
            
toolName: view_files
            
status: success
          
            
filePath: d:\Zewang\LearningNewThings\CS146S\obsidian-mcp\src\client.ts
          
# 📝 使用TypeScript编写MCP客户端和服务器完整指南

基于我们刚才开发的obsidian-mcp项目，我来为你总结一份完整的笔记。

## 📋 目录
1. [MCP基础概念](#mcp基础概念)
2. [服务器端开发](#服务器端开发)
3. [客户端开发](#客户端开发)
4. [工具调用流程](#工具调用流程)
5. [最佳实践和调试技巧](#最佳实践和调试技巧)

## 🎯 MCP基础概念

### 什么是MCP？
MCP（Model Context Protocol）是一个开放协议，它标准化了应用程序如何向大语言模型提供上下文和工具。

### 核心组件
- **MCP Server**: 提供工具和能力
- **MCP Client**: 连接服务器并使用工具
- **Tools**: 服务器暴露的功能
- **Transport**: 通信层（通常使用stdio）

## 🏗️ 服务器端开发

### 1. 基本服务器结构

```typescript
// server.ts
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";

// 1. 初始化服务器
const server = new Server(
  {
    name: "your-server-name",
    version: "1.0.0",
  },
  {
    capabilities: {
      tools: {}, // 声明支持工具能力
    },
  }
);
```

### 2. 注册工具列表

```typescript
// 2. 注册可用工具
server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [
      {
        name: "tool_name",
        description: "工具描述，告诉AI何时使用此工具",
        inputSchema: {
          type: "object",
          properties: {
            param1: {
              type: "string",
              description: "参数描述",
            },
          },
          required: ["param1"],
        },
      },
      // 可以添加更多工具
    ],
  };
});
```

### 3. 处理工具调用

```typescript
// 3. 处理工具调用逻辑
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  if (request.params.name === "tool_name") {
    const args = request.params.arguments;
    
    try {
      // 执行工具逻辑
      const result = await yourToolLogic(args);
      
      return {
        content: [
          {
            type: "text",
            text: result,
          },
        ],
      };
    } catch (error: any) {
      return {
        content: [
          {
            type: "text",
            text: `工具执行失败: ${error.message}`,
          },
        ],
        isError: true,
      };
    }
  }

  throw new Error("未知的工具调用");
});
```

### 4. 启动服务器

```typescript
// 4. 启动服务器
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("MCP Server running on stdio"); // 使用stderr输出日志
}

main().catch(console.error);
```

## 💻 客户端开发

### 1. 基本客户端结构

```typescript
// client.ts
import OpenAI from "openai";
import { Client } from "@modelcontextprotocol/sdk/client";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

class MCPClient {
  private mcp: Client;
  private openai: OpenAI;
  private transport: StdioClientTransport | null = null;
  private tools: any[] = [];
  private messages: any[] = [];

  constructor() {
    // 初始化MCP客户端
    this.mcp = new Client({
      name: 'mcp-client',
      version: '1.0.0',
    }, {
      capabilities: {}
    });

    // 初始化OpenAI客户端（可指向其他API如DeepSeek）
    this.openai = new OpenAI({
      baseURL: 'https://api.deepseek.com/v1',
      apiKey: process.env.API_KEY,
    });
  }
}
```

### 2. 连接MCP服务器

```typescript
async connectToServer(serverScriptPath: string) {
  try {
    const command = process.platform === 'win32' ? 'node' : process.execPath;

    this.transport = new StdioClientTransport({
      command,
      args: [serverScriptPath]
    });

    await this.mcp.connect(this.transport);

    // 获取服务器工具列表
    const toolsResult = await this.mcp.listTools();
    
    // 转换工具格式为OpenAI Function Calling格式
    this.tools = toolsResult.tools.map((tool) => ({
      type: 'function',
      function: {
        name: tool.name,
        description: tool.description ?? '',
        parameters: tool.inputSchema,
      }
    }));

    console.log('成功连接到MCP Server，发现可用工具:', this.tools.map(t => t.function.name));
  } catch (e) {
    console.error('连接MCP Server失败:', e);
    throw e;
  }
}
```

### 3. 处理查询和工具调用

```typescript
async processQuery(query: string) {
  // 添加用户消息到历史
  this.messages.push({ role: 'user', content: query });

  // 第一次调用 - 可能触发工具调用
  const response = await this.openai.chat.completions.create({
    model: 'deepseek-chat',
    messages: this.messages,
    tools: this.tools  // 提供可用工具
  });

  const responseMessage = response.choices[0]?.message;
  this.messages.push(responseMessage);

  // 检查是否需要调用工具
  if (responseMessage.tool_calls && responseMessage.tool_calls.length > 0) {
    // 执行工具调用
    for (const toolCall of responseMessage.tool_calls) {
      const toolName = toolCall.function.name;
      const toolArgs = JSON.parse(toolCall.function.arguments);

      console.log(`调用工具: ${toolName}, 参数: ${JSON.stringify(toolArgs)}`);

      try {
        const result = await this.mcp.callTool({
          name: toolName,
          arguments: toolArgs,
        });

        // 处理工具返回结果
        const toolResult = result.content
          .filter((block: any) => block.type === 'text')
          .map((block: any) => block.text)
          .join('\n');

        // 添加工具结果到消息历史
        this.messages.push({
          role: 'tool',
          tool_call_id: toolCall.id,
          name: toolName,
          content: toolResult,
        });
      } catch (error: any) {
        // 处理工具调用失败
        this.messages.push({
          role: 'tool',
          tool_call_id: toolCall.id,
          name: toolName,
          content: `工具调用失败: ${error.message}`,
        });
      }
    }

    // 第二次调用 - 基于工具结果生成最终回答
    const finalResponse = await this.openai.chat.completions.create({
      model: 'deepseek-chat',
      messages: this.messages,
      // 注意：不提供tools参数，避免再次调用工具
    });

    const finalMessage = finalResponse.choices[0]?.message;
    this.messages.push(finalMessage);
    return finalMessage.content;
  }

  // 如果没有工具调用，直接返回回答
  return responseMessage.content;
}
```

## 🔄 工具调用流程

### 完整流程图
```
用户查询 → 第一次LLM调用 → 决定是否调用工具
    ↓
是 ← 需要工具？ ← 否
    ↓
执行MCP工具 → 获取结果 → 第二次LLM调用
    ↓
生成最终回答 → 返回给用户
```

### 关键要点
1. **第一次调用**：提供tools参数，让模型决定是否需要调用工具
2. **工具执行**：同步执行所有工具调用，收集结果
3. **第二次调用**：不提供tools参数，基于工具结果生成最终回答

## 🛠️ 最佳实践和调试技巧

### 1. 调试输出
```typescript
// 添加详细的调试信息
console.log('[调试] 正在调用MCP工具:', toolName);
console.log('[调试] MCP工具返回结果:', JSON.stringify(result, null, 2));
console.log('[调试] 当前消息历史:', this.messages.map(m => ({
  role: m.role, 
  content: m.content?.substring(0, 200)
})));
```

### 2. 错误处理
```typescript
// 完整的错误处理链
try {
  // 工具逻辑
} catch (error: any) {
  return {
    content: [{
      type: "text",
      text: `工具执行失败: ${error.message}`,
    }],
    isError: true,  // 标记为错误
  };
}
```

### 3. 工具设计原则
- **明确的描述**：让AI理解何时使用工具
- **清晰的参数**：使用描述性的参数名和说明
- **错误处理**：返回友好的错误信息
- **结果格式**：保持一致的返回格式

### 4. 服务器日志
```typescript
// 使用stderr输出日志，避免干扰MCP协议
console.error("MCP Server running on stdio");
console.error(`工具执行成功: ${toolName}`);
```

## 📦 依赖安装

```bash
# MCP SDK
npm install @modelcontextprotocol/sdk

# OpenAI SDK（或其他LLM SDK）
npm install openai

# TypeScript相关
npm install -D typescript @types/node
```

## 🚀 运行项目

### 1. 编译TypeScript
```bash
npx tsc
```

### 2. 启动服务器
```bash
node build/server.js
```

### 3. 启动客户端
```bash
node build/client.js <server-script-path>
```

## 💡 扩展思路

1. **多工具组合**：设计可以协同工作的工具集
2. **异步工具**：支持长时间运行的工具调用
3. **工具链**：一个工具的输出作为另一个工具的输入
4. **权限控制**：根据用户权限限制工具访问
5. **缓存机制**：缓存工具结果提高性能

---

这份笔记涵盖了使用TypeScript开发MCP客户端和服务器的完整流程，基于我们实际的obsidian-mcp项目经验。你可以根据具体需求调整和扩展这些模式。
        