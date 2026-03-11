import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import fs from "fs/promises";
import path from "path";
import core = require("zod/v4/core");

const NOTES_DIR = "D:\\Zewang\\LearningNewThings\\CS146S\\CS146S-notes\\Zewang-notes";
 // 1. init Server
 const server = new Server(
    {
        name: "personal-note-server",
        version: "1.0.0",
    },
    {
        capabilities: {
            tools: {}, // 声明我们支持 Tools 能力 
        },
    }
 );

 // 2. register tools list (告诉大模型我们有什么能力)
server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [
      {
        name: "read_local_note",
        description: "读取本地的 Markdown 笔记文件。当你需要获取用户的私人知识或历史记录时，调用此工具。",
        inputSchema: {
          type: "object",
          properties: {
            filename: {
              type: "string",
              description: "要读取的文件名，包含扩展名，例如 'idea.md'",
            },
          },
          required: ["filename"],
        },
      },
      {
        name: "list_notes",
        description: "列出笔记目录中的所有 Markdown 文件。当用户让你查看笔记内容时，先调用此工具看看有哪些文件可用。",
        inputSchema: {
          type: "object",
          properties: {},
          required: [],
        },
      },
    ],
  };
});

// 3. 处理工具调用 (大模型决定调用时，执行这里的逻辑)
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  if (request.params.name === "read_local_note") {
    const filename = request.params.arguments?.filename as string;
    
    if (!filename) {
      throw new Error("必须提供 filename 参数");
    }

    try {
      const filePath = path.join(NOTES_DIR, filename);
      const content = await fs.readFile(filePath, "utf-8");
      
      // 返回给大模型的结果
      return {
        content: [
          {
            type: "text",
            text: content,
          },
        ],
      };
    } catch (error: any) {
      return {
        content: [
          {
            type: "text",
            text: `读取文件失败: ${error.message}`,
          },
        ],
        isError: true,
      };
    }
  }
  
  if (request.params.name === "list_notes") {
    try {
      const files = await fs.readdir(NOTES_DIR);
      const markdownFiles = files.filter(file => file.endsWith('.md'));
      
      if (markdownFiles.length === 0) {
        return {
          content: [
            {
              type: "text",
              text: "目录中没有找到 Markdown 文件",
            },
          ],
        };
      }
      
      return {
        content: [
          {
            type: "text", 
            text: `找到以下笔记文件：\n${markdownFiles.map(file => `- ${file}`).join('\n')}`,
          },
        ],
      };
    } catch (error: any) {
      return {
        content: [
          {
            type: "text",
            text: `列出文件失败: ${error.message}`,
          },
        ],
        isError: true,
      };
    }
  }

  throw new Error("未知的工具调用");
});

// 4. 启动通信 (使用标准输入输出与 Client 建立连接)
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("Personal Note MCP Server running on stdio"); // 注意：日志必须用 stderr 输出，stdout 被 MCP 协议占用了
}

main().catch(console.error);