import OpenAI from "openai";
import { Client } from "@modelcontextprotocol/sdk/client";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import readline from "readline/promises";

const DEEPSEEK_MODEL = 'deepseek-chat';

class DeepSeekMCPClient {
    private mcp: Client;
    private openai: OpenAI;
    private transport: StdioClientTransport | null = null;
    private tools: any[] = [];
    // 维护对话上下文历史
    private messages: any[] = [];

    constructor() {
        // 1. 初始化 MCP Client
        this.mcp = new Client({
            name: 'deepseek-mcp-client',
            version: '1.0.0',
        }, {
            capabilities: {}
        });

        // 2. 初始化 OpenAI SDK，但将 baseURL 指向 DeepSeek
        this.openai = new OpenAI({
            baseURL: 'https://api.deepseek.com/v1',
            apiKey: process.env.DEEPSEEK_API_KEY || 'sk-faf7d8e04a2e44cfbac77b3aa2d13107',
        })
    }

    async connectToServer(serverScriptPath: string) {
        try {
            const command = process.platform === 'win32' ? 'node' : process.execPath;

            this.transport = new StdioClientTransport({
                command,
                args: [serverScriptPath]
            });

            await this.mcp.connect(this.transport);

            // 获取 MCP Server 的工具列表
            const toolsResult = await this.mcp.listTools();

            // 【关键修改点 1】：将 MCP 工具格式转换为 OpenAI/DeepSeek 要求的 Function Calling 格式
            this.tools = toolsResult.tools.map((tool) => ({
                type: 'function',
                function: {
                    name: tool.name,
                    description: tool.description ?? '',
                    parameters: tool.inputSchema,
                }
            }));

            console.log('成功连接到 MCP Server，发现可用工具:', this.tools.map(t => t.function.name));
        } catch (e) {
            console.error('连接 MCP Server 失败:', e);
            throw e;
        }
    }

    async processQuery(query: string) {
        // 将用户输入加入历史记录
        this.messages.push({ role: 'user', content: query });

        // 第一次调用 DeepSeek
        console.log(`[调试] 正在调用DeepSeek，消息历史:`, this.messages.map(m => ({role: m.role, content: m.content?.substring(0, 100)})));
        const response = await this.openai.chat.completions.create({
            model: DEEPSEEK_MODEL,
            messages: this.messages,
            ...(this.tools.length > 0 && { tools: this.tools})
        });

        const responseMessage = response.choices[0]?.message;
        console.log(`[调试] DeepSeek响应:`, JSON.stringify(responseMessage, null, 2));
        if (!responseMessage) {
            throw new Error('DeepSeek 响应为空');
        }

        // 把大模型的回复（包括它打算调用的工具记录）加入历史上下文
        this.messages.push(responseMessage);

        // 【关键修改点 2】：检查 DeepSeek 是否决定调用工具 (OpenAI 格式使用 tool_calls)
        if (responseMessage.tool_calls && responseMessage.tool_calls.length > 0) {
            for (const toolCall of responseMessage.tool_calls) {
                const toolName = (toolCall as any).function.name;
                // 解析大模型传入的参数
                const toolArgs = JSON.parse((toolCall as any).function.arguments);

                console.log(`\n[DeepSeek 正在调用本地工具: ${toolName}, 参数: ${JSON.stringify(toolArgs)}]`);

                // 核心：触发 MCP Client 去调用本地 Server 的功能
                let toolResultText = "";
                try {
                    console.log(`[调试] 正在调用MCP工具: ${toolName}`);
                    const result = await this.mcp.callTool({
                        name: toolName,
                        arguments: toolArgs,
                    });

                    console.log(`[调试] MCP工具返回结果:`, JSON.stringify(result, null, 2));
                    
                    toolResultText = (result.content as any[])
                        .filter((block: any) => block.type === 'text')
                        .map((block: any) => block.text)
                        .join('\n');
                } catch (error: any) {
                    toolResultText = `工具调用失败: ${error.message}`;
                }

                // 将工具的执行结果追加到上下文中 (角色必须是 'tool')
                this.messages.push({
                    role: 'tool',
                    tool_call_id: (toolCall as any).id,
                    name: toolName,
                    content: toolResultText,
                });
            }

            // 第二次调用 DeepSeek：带着工具执行的结果，让它生成最终的回答
            console.log(`[调试] 正在进行第二次DeepSeek调用，消息历史包含工具结果`);
            console.log(`[调试] 当前消息历史:`, this.messages.map(m => ({role: m.role, content: m.content?.substring(0, 200), tool_calls: m.tool_calls})));
            const finalResponse = await this.openai.chat.completions.create({
                model: DEEPSEEK_MODEL,
                messages: this.messages,
            });

            const finalMessage = finalResponse.choices[0]?.message;
            console.log(`[调试] 第二次DeepSeek响应:`, JSON.stringify(finalMessage, null, 2));
            this.messages.push(finalMessage);
            if (!finalMessage) {
                throw new Error('DeepSeek 最终响应为空');
            }
            return finalMessage.content;
        }

        // 如果没有调用工具，直接返回文本
        return responseMessage.content;
    }

    async chatLoop() {
        const rl = readline.createInterface({
            input: process.stdin,
            output: process.stdout,
        });

        try {
            console.log('\nDeepSeek MCP Client 已启动！');
            console.log('输入你的问题，或输入 "quit" 退出。');

            while (true) {
                const message = await rl.question('\n用户: ');
                if (message.toLowerCase() === 'quit') {
                    break;
                }
                const response = await this.processQuery(message);
                console.log(`\nDeepSeek: ${response}`);
            }
        } finally {
            rl.close();
        }
    }

    async cleanup() {
        if (this.transport) {
            await this.transport.close();
        }
    }
}

async function main() {
    if (process.argv.length < 3) {
        console.log('用法: node build/index.js <你的_mcp_server_脚本绝对路径>');
        return;
    }

    const serverScriptPath = process.argv[2];
    if (!serverScriptPath) {
        console.log('错误: 未提供 MCP Server 脚本路径');
        return;
    }

    const client = new DeepSeekMCPClient();
    try {
        await client.connectToServer(serverScriptPath);
        await client.chatLoop();
    } catch (e) {
        console.error('Fatal Error:', e);
    } finally {
        await client.cleanup();
    }
}

main();