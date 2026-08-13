/**
 * dsh-chat-outline — host half.
 *
 * 纯客户端插件：host 侧无事可做，apply 为空实现（保持 Cordis 插件形态）。
 * 所有功能都在 lib/client.js（浏览器半边，手写 bundle）。
 */
export const name = "dsh-chat-outline";
export const inject = [];

export function apply() {
	// 客户端功能全部在 browser 半边，这里无需任何 host 逻辑。
}
