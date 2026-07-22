/**
 * chat-completion-patch.js - 已弃用
 *
 * 原计划通过 import('/scripts/openai.js') 获取 ChatCompletion 类并 monkey-patch
 * 其原型方法，在 populateChatHistory 内部裁剪对话轮数。
 *
 * 弃用原因：
 * 1. NE-Memory 通过内联脚本从 CDN 加载 dist/index.js（IIFE 格式），不是 ST 标准扩展。
 *    manifest.json 中的 generate_interceptor 从未被 ST 发现和调用。
 * 2. import() 的基 URL 是脚本自身的 CDN URL，而非 ST 服务器。
 *    window.location.origin 在此上下文中返回 "null"，无法构造正确的 ST URL。
 * 3. 即使 import() 成功，monkey-patch 原型方法的方式也比直接修改事件数据更脆弱。
 *
 * 替代方案：
 * 对话轮数裁剪改为在 CHAT_COMPLETION_PROMPT_READY 事件中直接修改 data.chat 数组。
 * 见 index.js 中的 trimDialogRounds 函数。
 */

export async function applyChatCompletionPatch() {
    return false;
}
