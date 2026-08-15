/**
 * dsh-chat-outline — browser half（手写 bundle，无需构建）。
 *
 * 功能：长对话里不用一直往上翻——在对话栏左侧**常驻**一个「对话大纲」，
 * 按轮次列出每次 user 提问与最后一条 assistant 回复，点击即可把聊天区
 * 滚动定位到对应消息（目标不在已加载窗口时会自动翻页加载更早记录）。
 *
 * 交互约定（按需求）：
 *  - 无开关按钮：面板常驻，占聊天区左侧空白（窗口过窄时自动隐藏，不挡内容）；
 *  - 定位只滚动，不做高亮框；
 *  - 面板内只有列表 + 过滤框，无其它按钮。
 *
 * 机制：
 *  - 浮层挂 shell.overlay，定位在侧边栏右侧（实测侧边栏宽度），宽度按
 *    「聊天内容列左侧空白」自适应；
 *  - 大纲数据来自会话快照 session.getSnapshot().chat：
 *      * kind === "user" / "steering" 的节点 = 一次 user 提问；
 *      * kind === "turn-tail" 的节点 data.closing.finalNode = 该轮最后 assistant 回复；
 *  - 定位目标 = 聊天区 DOM 里 [data-chat-anchor-key="<节点 key>"] 的行
 *    （与官方聊天渲染同一锚点），scrollIntoView 居中；
 *  - 目标不在已加载窗口时，循环 session.loadOlder() 翻页直到出现。
 */
window.__ModuleLoader__.load({
	id: "dsh-chat-outline",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		let react = require("react");
		let primitives = require("@deepseek-ai/dsh-client-ui-primitives");

		// 头像：用户 = 官方人形图标（蓝底白图标），assistant = 官方鲸鱼 logo（蓝色）
		const IconUser = primitives.IconUserOutline16 !== void 0 ? primitives.IconUserOutline16 : null;
		const WhaleLogo = primitives.FishLogo !== void 0 ? primitives.FishLogo : null;

		// ── 文案 ────────────────────────────────────────────────────────────────
		const NS = "chatOutline";
		const zh = {
			"panel.title": "对话定位",
			"panel.filterPlaceholder": "过滤提问 / 回复…",
			"panel.empty": "还没有对话内容。",
			"panel.noMatch": "没有匹配的记录。",
			"panel.loadingOlder": "正在加载更早记录…",
			"panel.loadingHistory": "正在加载全部记录…",
			"panel.notFound": "没找到这条记录（可能已被压缩或删除）",
			"panel.noTrajectory": "当前会话没有轨迹视图",
			"panel.trajectoryJump": "正在轨迹中定位…",
			"panel.running": "回复进行中…",
			"panel.count": "{count} 轮",
			"panel.user": "我",
			"panel.assistant": "助手",
			"panel.nonText": "（非文本消息）"
		};
		const en = {
			"panel.title": "Conversation Outline",
			"panel.filterPlaceholder": "Filter questions / replies…",
			"panel.empty": "No conversation yet.",
			"panel.noMatch": "No matching records.",
			"panel.loadingOlder": "Loading older records…",
			"panel.loadingHistory": "Loading all records…",
			"panel.notFound": "Record not found (compacted or removed)",
			"panel.noTrajectory": "Trajectory view unavailable",
			"panel.trajectoryJump": "Locating in trajectory…",
			"panel.running": "Replying…",
			"panel.count": "{count} turns",
			"panel.user": "Me",
			"panel.assistant": "AI",
			"panel.nonText": "(non-text message)"
		};

		// ── 小工具 ────────────────────────────────────────────────────────────────
		/** user/message content parts → 纯文本。 */
		function partsText(parts) {
			if (!Array.isArray(parts)) return "";
			return parts
				.filter((part) => part && part.type === "text" && typeof part.text === "string")
				.map((part) => part.text)
				.join("");
		}
		/** assistant blocks（finalNode.blocks）→ 纯文本。 */
		function blocksText(blocks) {
			if (!Array.isArray(blocks)) return "";
			return blocks
				.filter((block) => block && block.kind === "text" && typeof block.text === "string")
				.map((block) => block.text)
				.join("\n");
		}
		/** 取第一行非空文本，作为列表摘要。 */
		function firstLine(text) {
			if (typeof text !== "string") return "";
			for (const line of text.split("\n")) {
				const trimmed = line.trim();
				if (trimmed !== "") return trimmed;
			}
			return "";
		}

		/**
		 * 大纲数据抓取（内存友好版）：
		 * 用 api.sessions.history 分页抓全量历史，但**就地抽取精简字段后即弃页**——
		 * 不把事件注入会话 store，也不保留 chunk 等大事件，内存只留大纲本身。
		 * 跳转到未加载的旧记录时再由 jumpTo 按需翻页。
		 * 注意：host 按「消息数」分页（maxMessages: 50），每页约 50 条消息
		 * 加上其全部 chunk 事件，逐页处理即可，不能展开成一个大数组（实测
		 * 单页可达 13 万事件，展开即栈溢出）。
		 */
		const MAX_HISTORY_PAGES = 2000; // 每页 50 条消息，上限 10 万条消息
		/** 会话切换后的稳定期（毫秒）：过渡期内的滚动/渲染变化不触发位置追踪。 */
		const SETTLE_MS = 600;

		/** 兼容两种响应形状：{ok,value|error} 或 {result:{ok,value|error}}。 */
		function foldResult(response) {
			const r = response && response.result !== void 0 ? response.result : response;
			return r && r.ok === true && r.value !== void 0
				? { ok: true, value: r.value }
				: { ok: false, error: r && r.error ? r.error : { message: String(r) } };
		}

		/** 从 sessions.history 响应里取出事件数组（每项可能是 {event,view} 包装）。 */
		function extractEvents(response) {
			const folded = foldResult(response);
			if (!folded.ok) return [];
			const value = folded.value;
			const unwrap = (row) => (row && row.event ? row.event : row);
			if (Array.isArray(value.events)) return value.events.map(unwrap).filter(Boolean);
			if (Array.isArray(value.rows)) return value.rows.map(unwrap).filter(Boolean);
			return [];
		}

		/** 官方事件引擎的 Context key：`${kind.length}:${kind}${id}`（与聊天节点 key 一致）。 */
		function conversationContextKey(kind, id) {
			return `${kind.length}:${kind}${id}`;
		}

		/**
		 * 分页抓取全量历史并抽取精简大纲源：{ messages, turnEnds }。
		 * 只保留 user/assistant 消息的少量字段与 turn/end 标记，逐页丢弃原始事件。
		 * @returns 按时间升序的精简记录数组。
		 */
		async function fetchOutlineSource(api, sessionId, report) {
			const messages = []; // { seq, kind: "user"|"assistant", id?, turn?, step?, text }
			const turnEnds = []; // { turn, seq }
			let beforeSeq;
			for (let i = 0; i < MAX_HISTORY_PAGES; i++) {
				report && report(i);
				let response;
				try {
					response = await api.sessions.history({
						sessionId,
						maxMessages: 50,
						...(beforeSeq === void 0 ? {} : { beforeSeq })
					});
				} catch (error) {
					console.error("[dsh-chat-outline] history fetch failed:", error);
					break;
				}
				const page = extractEvents(response);
				if (page.length === 0) break;
				const firstSeq = page[0].seq;
				const extracted = [];
				for (const ev of page) {
					if (!ev || typeof ev.type !== "string") continue;
					if (ev.type === "user/message") {
						const source = ev.data && ev.data.source;
						if (source && source.kind === "user") {
							extracted.push({
								seq: ev.seq,
								kind: "user",
								id: String(ev.data.id),
								text: partsText(ev.data.content)
							});
						}
					} else if (ev.type === "assistant/message") {
						const text = partsText(ev.data && ev.data.message && ev.data.message.content);
						if (text.trim() !== "") {
							extracted.push({
								seq: ev.seq,
								kind: "assistant",
								turn: ev.data.turn,
								step: ev.data.step,
								text
							});
						}
					} else if (ev.type === "turn/end") {
						turnEnds.push({ turn: ev.data.turn, seq: ev.seq });
					}
				}
				messages.unshift(...extracted); // 每页只有几十条精简记录，unshift 无压力
				const folded = foldResult(response);
				if (!folded.ok || folded.value.hasMore !== true) break;
				beforeSeq = firstSeq;
			}
			return { messages, turnEnds };
		}

		/**
		 * 从精简大纲源构建大纲（key 与聊天区完全一致）。
		 *  - 每条 user 消息开一条记录；
		 *  - 该轮「最后一条」文本回复 = 该轮最后一条文本型 assistant 消息；
		 *    轮次已关闭用 turn-tail key，未关闭（进行中）用 assistant-step key。
		 */
		function buildOutlineFromSource(source) {
			const entries = [];
			const messages = source && Array.isArray(source.messages) ? source.messages : [];
			const turnEnds = source && Array.isArray(source.turnEnds) ? source.turnEnds : [];
			const closedTurns = new Set(turnEnds.map((t) => t.turn));
			const perTurnReply = new Map();
			for (const m of messages) {
				if (m.kind === "assistant") {
					perTurnReply.set(m.turn, { seq: m.seq, text: firstLine(m.text), turn: m.turn, step: m.step });
				}
			}
			const replies = [...perTurnReply.values()].sort((a, b) => a.seq - b.seq);
			let cursor = 0;
			for (const m of messages) {
				if (m.kind !== "user") continue;
				while (cursor < replies.length && replies[cursor].seq <= m.seq) cursor += 1;
				const reply = replies[cursor];
				const entry = {
					key: conversationContextKey("input-message", m.id),
					seq: m.seq,
					text: firstLine(m.text),
					assistantKey: null,
					assistantText: "",
					running: false
				};
				if (reply !== void 0) {
					entry.assistantText = reply.text;
					if (closedTurns.has(reply.turn)) {
						entry.assistantKey = conversationContextKey("turn-tail", String(reply.turn));
					} else {
						entry.assistantKey = conversationContextKey("assistant-step", `${reply.turn}:${reply.step}`);
						entry.running = true;
					}
				} else {
					// 无文本回复：其后出现过 turn/end 说明该轮已结束（无文本），否则可能仍在进行
					entry.running = !turnEnds.some((t) => t.seq > m.seq);
				}
				entries.push(entry);
			}
			return entries;
		}

		/**
		 * 合并两份大纲：实时快照优先（进行中的轮次/刚发的新消息以快照为准），
		 * 全量历史补足长尾；key 空间一致，按 key 去重、按 seq 排序。
		 */
		function mergeOutlines(historyEntries, snapshotEntries) {
			const byKey = new Map();
			for (const entry of snapshotEntries) byKey.set(entry.key, entry);
			for (const entry of historyEntries) {
				if (!byKey.has(entry.key)) byKey.set(entry.key, entry);
			}
			return [...byKey.values()].sort((a, b) => (a.seq ?? 0) - (b.seq ?? 0));
		}

		/**
		 * 从 chat 快照构建大纲。
		 * 每个 user/steering 节点开一条记录；turn-tail 的 closing.finalNode
		 * 是该轮「最后一条 assistant 回复」（与聊天区渲染同一来源）。
		 * 进行中的轮次（还没有 turn-tail）回退到最后一个带文本的 assistant-step。
		 *
		 * 注意：snapshot.chat.nodes 是官方 MutableChatNodeStore（带 get/values 的
		 * 自定义类，不是原生 Map），只依赖其 .get() 接口。
		 */
		function buildOutline(chat) {
			const entries = [];
			if (!chat || !chat.nodes || typeof chat.nodes.get !== "function") return entries;
			const order = Array.isArray(chat.order) ? chat.order : [];
			let last = null;
			for (const key of order) {
				const node = chat.nodes.get(key);
				if (!node || !node.data) continue;
				if (node.kind === "user" || node.kind === "steering") {
					last = {
						key,
						index: entries.length,
						seq: node.data.seq,
						text: firstLine(partsText(node.data.content)),
						assistantKey: null,
						assistantText: "",
						running: true
					};
					entries.push(last);
				} else if (node.kind === "turn-tail" && last !== null) {
					// 轮次已关闭：既有条目全部完成（它们都早于这个 turn-tail——
					// 包括同一轮内多条 steering 的前置条目），避免它们永远显示
					// 「回复进行中…」；有文本才把回复挂到最近一条上
					for (const entry of entries) entry.running = false;
					const closing = node.data.closing;
					const finalNode = closing && closing.finalNode;
					if (finalNode) {
						const text = firstLine(blocksText(finalNode.blocks));
						if (text !== "") {
							last.assistantKey = key;
							last.assistantText = text;
						}
					}
				} else if (node.kind === "assistant-step" && last !== null && node.visibility !== "hidden") {
					// 进行中的轮次：用最后一个带文本的 assistant step 兜底
					const finalNode = node.data && node.data.finalNode;
					if (finalNode && Array.isArray(finalNode.blocks)) {
						const text = firstLine(blocksText(finalNode.blocks));
						if (text !== "") {
							last.assistantKey = key;
							last.assistantText = text;
						}
					}
				}
			}
			return entries;
		}

		// ── 跳转定位（DOM 层，与官方聊天区同一锚点机制）────────────────────────
		const MAX_PAGES = 500; // 每页 50 条，最多 ~25000 条消息

		function frame(count) {
			return new Promise((resolve) => {
				let remaining = Math.max(1, count || 1);
				const step = () => {
					remaining -= 1;
					if (remaining <= 0) resolve();
					else requestAnimationFrame(step);
				};
				requestAnimationFrame(step);
			});
		}

		function findAnchor(key) {
			for (const row of document.querySelectorAll("[data-chat-anchor-key]")) {
				if (row.dataset.chatAnchorKey === key) return row;
			}
			return null;
		}

		function chatScrollport() {
			return document.querySelector("[data-conversation-scroll]") ?? null;
		}

		/** 聊天视图是否渲染中（chat 标签页激活且会话非空白）。 */
		function chatFlowPresent() {
			return document.querySelector("[data-chat-flow]") !== null;
		}

		/**
		 * 确保处于 chat 视图：若聊天 DOM 未渲染，则点击标题栏的「对话」标签页。
		 * 优先用 conversation 命名空间的翻译，兜底常见文案。
		 */
		async function ensureChatView(getChatTabLabels) {
			if (chatFlowPresent()) return true;
			const candidates = [];
			try {
				const labels = getChatTabLabels();
				for (const label of labels) {
					if (typeof label === "string" && label !== "" && label !== "view.chat") candidates.push(label);
				}
			} catch {
				// 忽略：字典未就绪时走兜底文案
			}
			candidates.push("对话", "Chat", "聊天", "chat", "会话", "Conversation", "Dialogue", "Dialogs");
			const seen = new Set();
			for (const label of candidates) {
				if (seen.has(label)) continue;
				seen.add(label);
				for (const tab of document.querySelectorAll('button[role="tab"]')) {
					if ((tab.textContent || "").trim() === label) {
						tab.click();
						await frame(3);
						return true;
					}
				}
			}
			return false;
		}

		/**
		 * 定位到指定 chat 节点 key（只滚动，不高亮）：
		 *  1) 会话未打开则先 open（拉取尾部窗口）；
		 *  2) 确保 chat 视图可见（必要时切标签页）；
		 *  3) 目标不在已加载窗口时循环 loadOlder() 翻页；
		 *  4) 等 DOM 行出现后滚动定位（align 决定停靠位置）。
		 * @param align - "top"：目标行滚到视口顶部（上面的内容刚好被挡住，
		 *                 用于定位用户消息）；"center"（默认）：居中。
		 */
		async function jumpTo(session, key, getChatTabLabels, report, align) {
			let snapshot = session.getSnapshot();
			if (snapshot.openState === "cold" || snapshot.openState === "error") {
				report && report("open");
				try {
					await session.open();
				} catch (error) {
					console.error("[dsh-chat-outline] session.open failed:", error);
				}
			}
			await ensureChatView(getChatTabLabels);

			// 翻页直到 key 进入已加载窗口（与自动翻页并发时等待 + 无进展保护）
			let found = false;
			for (let i = 0; i < MAX_PAGES; i++) {
				snapshot = session.getSnapshot();
				const chat = snapshot.chat;
				if (chat && Array.isArray(chat.order) && chat.order.includes(key)) {
					found = true;
					break;
				}
				if (snapshot.hasMore !== true) break;
				if (snapshot.loadingOlder) {
					await frame(2); // 自动翻页正在加载：等它完成，避免 loadOlder 静默空转
					continue;
				}
				report && report("loading");
				const before = chat && Array.isArray(chat.order) ? chat.order[0] : void 0;
				try {
					await session.loadOlder();
				} catch (error) {
					console.error("[dsh-chat-outline] loadOlder failed:", error);
					break;
				}
				await frame(1);
				const after = session.getSnapshot().chat;
				const afterFirst = after && Array.isArray(after.order) ? after.order[0] : void 0;
				if (afterFirst === before) break; // 无进展，避免空转到上限
			}
			if (!found) {
				// 已加载窗口仍没有：说明该节点被压缩/删除，或超出可加载范围
				return false;
			}

			// 等 React 把行渲染进 DOM
			let row = null;
			for (let i = 0; i < 60 && row === null; i++) {
				row = findAnchor(key);
				if (row === null) await frame(2);
			}
			if (row === null) return false;

			scrollToRow(row, align);
			return true;
		}

		/**
		 * 滚动定位到某行：
		 *  - "top"：目标行的上边缘对齐滚动区顶部（留 8px），上面的内容刚好被挡住
		 *    ——定位用户消息时用，让用户输入在最上面；
		 *  - 其它（默认 "center"）：居中。
		 */
		function scrollToRow(row, mode) {
			const scrollport = row.closest("[data-conversation-scroll]") ?? chatScrollport();
			if (mode === "top" && scrollport) {
				const rowRect = row.getBoundingClientRect();
				const portRect = scrollport.getBoundingClientRect();
				const target = scrollport.scrollTop + (rowRect.top - portRect.top) - 8;
				scrollport.scrollTo({ top: Math.max(0, target), behavior: "smooth" });
				return;
			}
			row.scrollIntoView({ behavior: "smooth", block: "center" });
		}

		// ── 轨迹定位（Ctrl/Shift+单击 大纲条目 → 跳到轨迹对应位置）───────────────
		// 桥接原理（与官方实现同一套编号，逐行验证）：
		//  - chat 节点的 anchorSeq = 事件 seq：用户消息节点 = input-message 事件 seq，
		//    turn-tail 节点 = turn/end 事件 seq，和轨迹快照里是同一把尺子；
		//  - 轨迹快照 session.getSnapshot().views.get("trajectory") 提供 eventNodes
		//    （带 kind/turn/step/seq）供解析目标行；
		//  - 轨迹表格每行带 data-trajectory-row-key，就是 encodeURIComponent(
		//    trajectoryRecordId(cell))：
		//      * 用户行 cell.kind === "user"，recordId = `user\0seq\0{seq}`；
		//      * 回复行（assistant message cell）recordId = `assistant\0{turn}\0{step}`；
		//  - 记录 ≤100 条时表格全量渲染，直接按行 key 查 DOM 定位；
		//    超过则虚拟化（行不在 DOM），按目标 seq 比例先跳大致位置再翻页逼近。
		const TRAJECTORY_TAB_CANDIDATES = ["轨迹", "Trajectory", "trajectory", "Trace"];

		async function ensureTrajectoryView(getTrajectoryTabLabels) {
			if (document.querySelector('tr[data-trajectory-row-key]') !== null) return true;
			const candidates = [];
			try {
				const labels = getTrajectoryTabLabels();
				for (const label of labels) {
					if (typeof label === "string" && label !== "" && label !== "view.trajectory") candidates.push(label);
				}
			} catch {
				// 字典未就绪时走兜底文案
			}
			candidates.push(...TRAJECTORY_TAB_CANDIDATES);
			const seen = new Set();
			for (const label of candidates) {
				if (seen.has(label)) continue;
				seen.add(label);
				for (const tab of document.querySelectorAll('button[role="tab"]')) {
					if ((tab.textContent || "").trim() !== label) continue;
					if (tab.getAttribute("aria-selected") === "true") return true; // 已在轨迹视图
					tab.click();
					for (let i = 0; i < 60; i++) {
						if (document.querySelector('tr[data-trajectory-row-key]') !== null) return true;
						await frame(2);
					}
					return document.querySelector('tr[data-trajectory-row-key]') !== null;
				}
			}
			return false;
		}

		function findTrajectoryRow(rowKey) {
			return document.querySelector(`tr[data-trajectory-row-key="${rowKey}"]`) ?? null;
		}

		/** 轨迹表格的滚动容器（从任意行/表格向上找到 overflow 滚动的祖先）。 */
		function trajectoryPaneFrom(row) {
			const table = row ? row.closest("table") : null;
			const first = table ?? document.querySelector('tr[data-trajectory-row-key]');
			if (first === null) return null;
			let el = first.closest("table").parentElement;
			for (let i = 0; i < 8 && el; i++) {
				const style = window.getComputedStyle(el);
				if (style.overflowY === "auto" || style.overflowY === "scroll") return el;
				el = el.parentElement;
			}
			return null;
		}

		/** 从行 key 提取内嵌的源 seq（user/tool 行才有；assistant 行没有）。 */
		function seqFromRowKey(key) {
			if (typeof key !== "string") return null;
			const m = /seq%00(\d+)/.exec(key);
			return m ? Number(m[1]) : null;
		}

		/** 目标行不在 DOM（虚拟化）时，按 seq 比例先跳大致位置再翻页逼近。 */
		async function pageTrajectoryToRow(pane, rowKey, targetSeq, seqMin, seqMax, report) {
			report && report("loading");
			const stepPx = Math.max(120, Math.round((pane.clientHeight || 600) * 0.8));
			const span = Math.max(1, seqMax - seqMin);
			const fraction = targetSeq === null ? 0.5 : Math.min(0.95, Math.max(0.05, (targetSeq - seqMin) / span));
			pane.scrollTop = Math.round(fraction * Math.max(0, pane.scrollHeight - pane.clientHeight));
			await frame(3);
			let row = findTrajectoryRow(rowKey);
			for (let i = 0; i < 12 && row === null; i++) {
				const before = pane.scrollTop;
				pane.scrollBy({ top: stepPx, behavior: "auto" });
				await frame(2);
				row = findTrajectoryRow(rowKey);
				if (pane.scrollTop === before) break; // 已到底
			}
			for (let i = 0; i < 24 && row === null; i++) {
				const before = pane.scrollTop;
				pane.scrollBy({ top: -stepPx, behavior: "auto" });
				await frame(2);
				row = findTrajectoryRow(rowKey);
				if (pane.scrollTop === before) break; // 已到顶
			}
			return row;
		}

		/** 在轨迹表格内把某行滚动到视口中央（只滚表格，不带动外层页面）。 */
		function scrollTrajectoryToRow(row) {
			const pane = trajectoryPaneFrom(row);
			if (pane) {
				const rowRect = row.getBoundingClientRect();
				const paneRect = pane.getBoundingClientRect();
				const target = pane.scrollTop + (rowRect.top - paneRect.top) - (pane.clientHeight - rowRect.height) / 2;
				pane.scrollTo({ top: Math.max(0, target), behavior: "smooth" });
				return;
			}
			row.scrollIntoView({ behavior: "smooth", block: "center" });
		}

		/** 解析回复行的回合/步骤（assistantKey 形如 9:turn-tail3 / 14:assistant-step3:1）。 */
		function parseAssistantTarget(entry) {
			const key = entry.assistantKey;
			if (typeof key !== "string") return null;
			if (key.startsWith("9:turn-tail")) return { turn: Number(key.slice(11)), step: null };
			if (key.startsWith("14:assistant-step")) {
				const rest = key.slice(17);
				const sep = rest.indexOf(":");
				if (sep === -1) return { turn: Number(rest), step: null };
				return { turn: Number(rest.slice(0, sep)), step: Number(rest.slice(sep + 1)) };
			}
			return null;
		}

		/**
		 * Ctrl/Shift+单击 大纲条目：切到轨迹视图并定位到对应位置。
		 *  - 用户行 → 轨迹的用户消息行（key = user%00seq%00{seq}）；
		 *  - 回复行 → 该回合最后一条 assistant 消息行（key = assistant%00{turn}%00{step}），
		 *    轨迹数据不可用时回退到同条目用户行；
		 *  - 超过 100 条记录（表格虚拟化）时按 seq 比例先跳位再翻页逼近。
		 */
		async function jumpToTrajectory(session, entry, which, getTrajectoryTabLabels, report) {
			let snapshot;
			try {
				snapshot = session.getSnapshot();
			} catch {
				snapshot = null;
			}
			if (snapshot && (snapshot.openState === "cold" || snapshot.openState === "error")) {
				try {
					await session.open();
				} catch (error) {
					console.error("[dsh-chat-outline] session.open failed:", error);
				}
			}
			let traj = null;
			try {
				snapshot = session.getSnapshot();
				if (snapshot.views && typeof snapshot.views.get === "function") traj = snapshot.views.get("trajectory") ?? null;
			} catch {
				traj = null;
			}
			const nodes = traj && Array.isArray(traj.eventNodes) ? traj.eventNodes : [];
			let rowKey = null;
			let targetSeq = null;
			if (which === "user") {
				rowKey = `user%00seq%00${entry.seq}`;
				targetSeq = entry.seq;
			} else {
				const parsed = parseAssistantTarget(entry);
				let best = null;
				if (parsed !== null) {
					for (const node of nodes) {
						if (!node || node.kind !== "assistant" || node.turn !== parsed.turn) continue;
						if (best === null || node.step > best.step) best = node;
					}
				}
				if (parsed !== null && best !== null) {
					const step = parsed.step !== null ? parsed.step : best.step;
					rowKey = `assistant%00${parsed.turn}%00${step}`;
					targetSeq = best.seq;
				}
				if (rowKey === null) {
					// 轨迹数据不可用：回退到同条目用户行（同一回合的区域）
					rowKey = `user%00seq%00${entry.seq}`;
					targetSeq = entry.seq;
				}
			}
			if (!(await ensureTrajectoryView(getTrajectoryTabLabels))) {
				report && report("noTrajectory");
				return false;
			}
			let row = findTrajectoryRow(rowKey);
			if (row === null) {
				const pane = trajectoryPaneFrom(null);
				const seqMin = nodes.length > 0 && typeof nodes[0].seq === "number" ? nodes[0].seq : targetSeq;
				const seqMax = nodes.length > 0 && typeof nodes[nodes.length - 1].seq === "number" ? nodes[nodes.length - 1].seq : targetSeq;
				if (pane !== null) row = await pageTrajectoryToRow(pane, rowKey, targetSeq, seqMin, seqMax, report);
			}
			if (row === null) {
				report && report("notfound");
				return false;
			}
			scrollTrajectoryToRow(row);
			return true;
		}

		/** 聊天区当前可见位置对应的锚点 key（大纲蓝框用）。
		 *  用扫描法（与官方 pagingAnchor 相同思路）：取视口中线以上最后一条
		 *  **能映射到大纲条目**的 [data-chat-anchor-key] 行（工具调用、错误、
		 *  压缩摘要等无对应条目的行跳过）；没有聊天视图时返回 null。
		 *  @param accept - 可选：key 是否对应大纲条目（不通过则跳过该行）。
		 */
		function currentAnchorKey(accept) {
			const flow = document.querySelector("[data-chat-flow]");
			if (!flow) return null;
			const scrollport = flow.closest("[data-conversation-scroll]") ?? chatScrollport();
			if (!scrollport) return null;
			const viewport = scrollport.getBoundingClientRect();
			if (viewport.height <= 0) return null;
			const mid = viewport.top + viewport.height / 2;
			// 只此一种判定：取视口中线以上最后一条可映射到大纲条目的行。
			// 不用 elementsFromPoint 打点——探测返回的是「中线那个点所在的行」，
			// 与扫描的「中线以上最后一条」在行边界处会给出相邻两条，两种方法
			// 切换会造成蓝框来回抖。
			let current = null;
			for (const row of flow.querySelectorAll("[data-chat-anchor-key]")) {
				const rect = row.getBoundingClientRect();
				if (rect.height === 0 && rect.width === 0) continue; // 尚未渲染
				if (rect.top > mid) break; // 后面的行都在中线以下
				if (accept && !accept(row.dataset.chatAnchorKey)) continue; // 无大纲条目：跳过
				current = row.dataset.chatAnchorKey;
			}
			return current;
		}

		// ── 样式（内联 + 少量 hover 用 style 标签）──────────────────────────────
		// 主题强调色：浅色 deepseek-500 / 深色 deepseek-400，随明暗自适应
		// （注意：--dsw-specific-strong-accent 并非 DSH 的 token，之前用了它导致
		// 颜色永远落在硬编码 fallback 上，不随主题变化）
		const ACCENT = "var(--dsw-alias-state-business-primary, #4176e6)";
		// 用户消息气泡（与聊天区用户气泡同一 token，浅色=淡蓝、深色=深蓝灰）
		const BUBBLE = "var(--dsw-specific-bubble, #edf3fe)";
		const BUBBLE_EDGE = "var(--dsw-specific-bubble-highlight, #d3e2ff)";
		const s = {
			panel: { position: "absolute", bottom: 0, width: 300, zIndex: 1001, display: "flex", flexDirection: "column", background: "var(--dsw-alias-bg-base, #fff)", borderRight: "1px solid var(--dsw-alias-border-l1, rgba(0,0,0,.12))", fontFamily: "var(--dsw-font-family, system-ui)", color: "var(--dsw-alias-label-primary, #111)" },
			header: { display: "flex", alignItems: "center", gap: 8, padding: "12px 14px 10px", borderBottom: "1px solid var(--dsw-alias-border-l1, rgba(0,0,0,.08))" },
			headerTitle: { flex: 1, minWidth: 0, fontWeight: 600, fontSize: 14, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" },
			headerCount: { flex: "none", fontSize: 12, fontWeight: 500, color: "var(--dsw-alias-label-caption, #999)" },
			filter: { margin: "8px 12px 4px", padding: "6px 10px", borderRadius: 8, border: "1px solid var(--dsw-alias-border-l2, rgba(0,0,0,.2))", fontSize: 13, background: "var(--dsw-alias-bg-base, #fff)", color: "var(--dsw-alias-label-primary, #111)", fontFamily: "inherit" },
			notice: { margin: "2px 14px 4px", fontSize: 12, color: ACCENT, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" },
			noticeError: { color: "var(--dsw-alias-state-error-primary, #d33)" },
			list: { flex: 1, overflowY: "auto", padding: "4px 8px 12px", display: "flex", flexDirection: "column", gap: 2 },
			// 激活态 = 完整蓝框（border 简写，宽度恒定 1px，不引起布局跳动）
			entry: { display: "flex", flexDirection: "column", borderRadius: 10, padding: "4px 6px", border: "1px solid transparent" },
			entryActive: { background: "var(--dsw-alias-interactive-bg-hover-solid, rgba(128,128,128,.08))", border: `1px solid ${ACCENT}` },
			line: { display: "flex", alignItems: "flex-start", gap: 8, width: "100%", textAlign: "left", border: "none", background: "transparent", padding: "4px 2px", borderRadius: 6, cursor: "pointer", font: "inherit", color: "inherit" },
			badge: { flex: "none", width: 18, height: 18, display: "inline-flex", alignItems: "center", justifyContent: "center", marginTop: 1 },
			// 用户头像：蓝底白图标（圆形）
			badgeUser: { borderRadius: "50%", background: ACCENT, color: "#fff" },
			// assistant 头像：蓝色鲸鱼 logo（无底色，颜色随主题强调蓝）
			badgeAssistant: { color: ACCENT },
			lineText: { flex: 1, minWidth: 0, fontSize: 13, lineHeight: "20px", color: "var(--dsw-alias-label-primary, #111)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" },
			// 用户行文本：复刻聊天区用户气泡（主题 token，明暗自适应），一眼可辨
			userBubble: { flex: 1, minWidth: 0, fontSize: 13, lineHeight: "20px", color: "var(--dsw-alias-label-primary, #111)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", background: BUBBLE, border: `1px solid ${BUBBLE_EDGE}`, borderRadius: 10, padding: "1px 8px" },
			// 助手行文本：弱化（三级文字色），与用户气泡形成对比
			lineTextAssistant: { color: "var(--dsw-alias-label-tertiary, #888)" },
			jumpingTag: { flex: "none", fontSize: 11, color: ACCENT, alignSelf: "center" },
			meta: { fontSize: 12, color: "var(--dsw-alias-label-caption, #999)", padding: "2px 4px 4px 28px" },
			empty: { padding: "24px 16px", textAlign: "center", fontSize: 13, color: "var(--dsw-alias-label-caption, #999)", lineHeight: "20px" }
		};

		const hoverCss =
			'[data-chat-outline-line]:hover{background:var(--dsw-alias-interactive-bg-hover, rgba(128,128,128,.1))}' +
			'[data-chat-outline-line]:disabled{opacity:.6;cursor:default}' +
			'[data-chat-outline-entry]{scroll-margin:8px}';
		if (typeof document !== "undefined" && document.querySelector("style[data-plugin-css=\"dsh-chat-outline\"]") === null) {
			const tag = document.createElement("style");
			tag.dataset.plugin = "dsh-chat-outline";
			tag.dataset.pluginCss = "dsh-chat-outline";
			tag.textContent = hoverCss;
			document.head.appendChild(tag);
		}

		// ── 左侧常驻面板 ─────────────────────────────────────────────────────────
		/**
		 * props（slot 平铺）：t / sessions / getChatTabLabels / jumpTo。
		 * 常驻：无开关、无遮罩、无关闭/其它按钮；占对话栏左侧空白。
		 * 大纲直接来自会话快照（与聊天区同一数据源），面板可见时后台自动
		 * 翻页加载完整历史，保证所有对话记录都在列表里。
		 */
		function OutlinePanel({ t: tProp, sessions, api, getChatTabLabels, getTrajectoryTabLabels, jumpTo: doJump, jumpToTrajectory: doTrajectoryJump }) {
			const t = typeof tProp === "function" ? tProp : (key) => zh[key] ?? key;
			const [filter, setFilter] = react.useState("");
			const [activeKey, setActiveKey] = react.useState(null);
			const [jumpingKey, setJumpingKey] = react.useState(null);
			const [notice, setNotice] = react.useState("");
			const [noticeError, setNoticeError] = react.useState(false);
			const [geometry, setGeometry] = react.useState(null); // { left, width, visible }
			// 是否处于「对话」标签页（聊天流渲染中）：轨迹等其它视图下不显示大纲
			const [chatActive, setChatActive] = react.useState(() => chatFlowPresent());
			const [sessionId, setSessionId] = react.useState(() => {
				try {
					return sessions.list.getSnapshot().current ?? null;
				} catch {
					return null;
				}
			});
			const listRef = react.useRef(null);
			const listHoverRef = react.useRef(false);
			// 已提交的当前高亮 key（供跟踪器做「连续两次一致才移动」的比较）
			const activeKeyRef = react.useRef(null);
			// 大纲 key → 条目索引（跟踪器用它对扫描结果过滤：工具调用等无条目
			// 的行不参与定位，蓝框只落在有对应大纲条目的行上）
			const keyToIndexRef = react.useRef(new Map());
			// 记录当前会话，用于检测「真的切换了会话」（而非列表刷新）
			const lastSessionIdRef = react.useRef(sessionId);
			// 会话切换的时间戳：过渡期（DOM 换血 + 滚动恢复）内暂停位置追踪
			const settleAtRef = react.useRef(0);

			// 自动翻页加载完整历史的进行中标志
			const [historyLoading, setHistoryLoading] = react.useState(false);
			// 全量历史抓取的精简大纲源（只含 user/assistant 消息与 turn/end，不驻留大事件）
			const [outlineSource, setOutlineSource] = react.useState(null);

			// 当前会话；切换会话时立即清掉旧会话的高亮/跳转状态——
			// 轮次号在每个会话里重新编号（如 9:turn-tail3），旧的 activeKey
			// 会误匹配新会话的第 3 轮，造成高亮来回乱闪。
			react.useEffect(
				() =>
					sessions.list.subscribe((snapshot) => {
						const next = snapshot && snapshot.current ? snapshot.current : null;
						if (next !== lastSessionIdRef.current) {
							lastSessionIdRef.current = next;
							settleAtRef.current = Date.now();
							activeKeyRef.current = null;
							setActiveKey(null);
							setJumpingKey(null);
							setNotice("");
							setNoticeError(false);
						}
						setSessionId(next);
					}),
				[sessions]
			);

			// 面板常驻可见时，后台自动翻页加载完整历史（token 防串台）
			const panelVisible = geometry !== null && geometry.visible === true;

			const session = react.useMemo(
				() => (sessionId === null ? null : sessions.binding(sessionId)?.session ?? null),
				[sessionId, sessions]
			);

			const subscribeSession = react.useCallback(
				(listener) => (session ? session.subscribe(listener) : () => {}),
				[session]
			);
			const snapshot = react.useSyncExternalStore(subscribeSession, () =>
				session ? session.getSnapshot() : null
			);

			const chat = snapshot && snapshot.chat ? snapshot.chat : null;
			const snapshotEntries = react.useMemo(() => (chat ? buildOutline(chat) : []), [chat]);
			const historyEntries = react.useMemo(
				() => (outlineSource ? buildOutlineFromSource(outlineSource) : []),
				[outlineSource]
			);
			const entries = react.useMemo(() => {
				const merged = mergeOutlines(historyEntries, snapshotEntries);
				merged.forEach((entry, index) => {
					entry.index = index;
				});
				return merged;
			}, [historyEntries, snapshotEntries]);

			const filtered = react.useMemo(() => {
				const query = filter.trim().toLowerCase();
				if (query === "") return entries;
				return entries.filter(
					(entry) =>
						entry.text.toLowerCase().includes(query) ||
						entry.assistantText.toLowerCase().includes(query)
				);
			}, [entries, filter]);

			const keyToIndex = react.useMemo(() => {
				const map = new Map();
				for (const entry of entries) {
					if (entry.key) map.set(entry.key, entry.index);
					if (entry.assistantKey) map.set(entry.assistantKey, entry.index);
				}
				return map;
			}, [entries]);
			keyToIndexRef.current = keyToIndex;
			const activeIndex = activeKey === null ? -1 : (keyToIndex.get(activeKey) ?? -1);

			// 面板常驻可见时，抓取全量历史构建大纲（内存友好：只保留精简字段，
			// 不注入会话 store；跳转到未加载的旧记录时由 jumpTo 按需翻页）
			react.useEffect(() => {
				if (sessionId === null || !panelVisible) {
					// 无会话或面板隐藏：清掉抓取结果与加载标志
					setOutlineSource(null);
					setHistoryLoading(false);
					return;
				}
				let cancelled = false;
				setHistoryLoading(true);
				fetchOutlineSource(api, sessionId, () => {})
					.then((source) => {
						if (!cancelled) setOutlineSource(source);
					})
					.catch((error) => {
						console.error("[dsh-chat-outline] outline fetch failed:", error);
					})
					.finally(() => {
						if (!cancelled) setHistoryLoading(false);
					});
				return () => {
					cancelled = true;
				};
			}, [sessionId, panelVisible, api]);

			// 会话尚未打开（cold/error）时，主动拉一次尾部窗口
			react.useEffect(() => {
				if (!session) return;
				const state = session.getSnapshot();
				if (state.openState === "cold" || state.openState === "error") {
					session.open().catch(() => {});
				}
			}, [session]);

			// 几何：面板贴在侧边栏右侧，宽度取「聊天内容列左侧空白」自适应；
			// 空白不够（窗口过窄）时隐藏，不遮挡聊天内容。
			react.useEffect(() => {
				if (sessionId === null) {
					setGeometry(null);
					return;
				}
				let observer = null;
				let retries = 0;
				let timer = null;
				let disposed = false;
				const measure = () => {
					const overlay = document.querySelector("[data-shell-overlay]");
					const frame = overlay && overlay.parentElement;
					const sidebarCol = frame && frame.firstElementChild;
					const scrollport = document.querySelector("[data-conversation-scroll]");
					if (!sidebarCol || !scrollport) {
						setGeometry(null);
						if (!disposed && retries < 30) {
							retries += 1;
							timer = window.setTimeout(measure, 100);
						}
						return;
					}
					const sidebarWidth = sidebarCol.getBoundingClientRect().width;
					// 面板从对话头部（标题/标签栏）下方开始，不压住顶部内容
					const frameRect = frame.getBoundingClientRect();
					const scrollportRect = scrollport.getBoundingClientRect();
					const top = Math.max(0, scrollportRect.top - frameRect.top);
					let chatWidth = 748;
					try {
						const raw = window
							.getComputedStyle(scrollport)
							.getPropertyValue("--dsh-chat-content-width")
							.trim();
						const parsed = raw ? Number.parseFloat(raw) : NaN;
						if (!Number.isNaN(parsed) && parsed > 0) chatWidth = parsed;
					} catch {
						// 忽略：回退默认 748
					}
					const scrollWidth = scrollport.clientWidth;
					const gutter = Math.max(0, (scrollWidth - chatWidth) / 2);
					const width = Math.min(300, Math.max(200, gutter - 24));
					const visible = gutter >= 224;
					setGeometry({ left: sidebarWidth + 12, top, width, visible });
					if (observer === null && typeof ResizeObserver !== "undefined") {
						observer = new ResizeObserver(() => measure());
						observer.observe(scrollport);
					}
				};
				measure();
				window.addEventListener("resize", measure);
				return () => {
					disposed = true;
					if (timer !== null) window.clearTimeout(timer);
					if (observer !== null) observer.disconnect();
					window.removeEventListener("resize", measure);
				};
			}, [sessionId]);

			// 位置跟踪：让蓝框稳定地「跟着跑」且**永不消失**——
			//  - 滚动（rAF 节流）+ 800ms 轮询驱动扫描；
			//  - 「连续两次扫描一致才移动」：滚动经过多个条目时不会逐个闪动，
			//    只在位置稳定后把蓝框挪到目标（快滚动时蓝框等停稳再跟上）；
			//  - 跳转不加锁、不瞬移：蓝框跟着跳转的滚动自然移动；
			//  - 扫描不到位置（切到轨迹页、过渡期、加载中）时**保留现有蓝框**，
			//    只在切换会话（大纲整体换掉）时才会重置；
			//  - 面板隐藏/后台标签页时不空转。
			react.useEffect(() => {
				if (!session || !panelVisible) return;
				let raf = null;
				let timer = null;
				let settleTimer = null; // 滚动停稳检测
				let pendingKey = null; // 待确认的新位置
				const track = () => {
					// 刷新「是否在对话标签页」（interval 每 800ms 必到，切换视图后随之更新）
					setChatActive(chatFlowPresent());
					if (typeof document !== "undefined" && document.hidden) return; // 后台标签页
					if (Date.now() - settleAtRef.current < SETTLE_MS) return; // 会话切换过渡期
					const state = session.getSnapshot();
					if (state.openState !== "open") {
						pendingKey = null; // 会话未打开：保留现有蓝框，不清空
						return;
					}
					// 只接受能映射到大纲条目的 key：工具调用/错误/压缩摘要等行
					// 没有对应条目，若让它们参与定位，蓝框会被顶到 -1 而消失
					const key = currentAnchorKey((candidate) => keyToIndexRef.current.has(candidate));
					if (key === null) {
						pendingKey = null; // 扫描不到可映射的位置：蓝框留在原地，不清空
						return;
					}
					if (key === activeKeyRef.current) {
						pendingKey = null;
						return;
					}
					if (key !== pendingKey) {
						pendingKey = key; // 第一次出现，等下一次确认（跟随动画的关键）
						return;
					}
					pendingKey = null;
					activeKeyRef.current = key;
					setActiveKey(key);
				};
				const onScroll = () => {
					if (raf !== null) return;
					raf = requestAnimationFrame(() => {
						raf = null;
						track();
					});
					// 停稳检测：最后一次滚动后 ~120ms 无新滚动，补一次确认扫描，
					// 让蓝框在停止后马上落位（不用等 800ms 轮询）
					if (settleTimer !== null) window.clearTimeout(settleTimer);
					settleTimer = window.setTimeout(() => {
						settleTimer = null;
						track();
					}, 120);
				};
				const scrollport = chatScrollport();
				if (scrollport) scrollport.addEventListener("scroll", onScroll, { passive: true });
				timer = window.setInterval(track, 800);
				track();
				return () => {
					pendingKey = null;
					if (settleTimer !== null) window.clearTimeout(settleTimer);
					if (scrollport) scrollport.removeEventListener("scroll", onScroll);
					if (raf !== null) cancelAnimationFrame(raf);
					if (timer !== null) window.clearInterval(timer);
				};
			}, [session, panelVisible]);

			// 大纲自动跟随当前阅读位置（列表未被悬停时）
			react.useEffect(() => {
				if (!geometry || !geometry.visible || activeIndex < 0 || listHoverRef.current || !listRef.current) return;
				const item = listRef.current.querySelector(
					`[data-chat-outline-index="${activeIndex}"]`
				);
				if (item && typeof item.scrollIntoView === "function") {
					item.scrollIntoView({ block: "nearest" });
				}
			}, [geometry, activeIndex, filtered.length]);

			const showNotice = (message, isError) => {
				setNotice(message);
				setNoticeError(isError === true);
				window.setTimeout(() => {
					setNotice((current) => (current === message ? "" : current));
				}, 2600);
			};

			const jump = async (entry, targetKey, align) => {
				if (!session || jumpingKey !== null) return;
				// 不加跳转锁、不瞬移蓝框：让蓝框跟着跳转的滚动自然移动，
				// 由跟踪器（连续两次扫描一致才移动）平滑地带到目标
				setJumpingKey(entry.key);
				setNotice("");
				try {
					const ok = await doJump(session, targetKey, getChatTabLabels, (phase) => {
						if (phase === "loading") showNotice(t("panel.loadingOlder"), false);
					}, align);
					if (!ok) showNotice(t("panel.notFound"), true);
				} catch (error) {
					console.error("[dsh-chat-outline] jump failed:", error);
					showNotice(String(error && error.message ? error.message : error), true);
				} finally {
					setJumpingKey(null);
				}
			};

			// Ctrl/Shift+单击：切到轨迹视图并定位到对应位置（跳转后面板随
			// 视图切换隐藏，符合「大纲只在对话视图出现」的约定）
			const jumpTrajectory = async (entry, which) => {
				if (!session || jumpingKey !== null) return;
				setJumpingKey(entry.key);
				setNotice("");
				try {
					await doTrajectoryJump(session, entry, which, getTrajectoryTabLabels, (phase) => {
						if (phase === "loading") showNotice(t("panel.trajectoryJump"), false);
						else if (phase === "notfound") showNotice(t("panel.notFound"), true);
						else if (phase === "noTrajectory") showNotice(t("panel.noTrajectory"), true);
					});
				} catch (error) {
					console.error("[dsh-chat-outline] trajectory jump failed:", error);
					showNotice(String(error && error.message ? error.message : error), true);
				} finally {
					setJumpingKey(null);
				}
			};

			// 无会话、无空间，或不在「对话」标签页（如轨迹视图）时整体隐藏
			if (session === null || geometry === null || !geometry.visible || !chatActive) return null;

			const userLabel = t("panel.user");
			const assistantLabel = t("panel.assistant");

			return react.createElement(
				"div",
				{
					style: { ...s.panel, left: geometry.left, top: geometry.top, width: geometry.width },
					"data-chat-outline-panel": true
				},
				react.createElement(
					"div",
					{ style: s.header },
					react.createElement("span", { style: s.headerTitle }, t("panel.title")),
					entries.length > 0 &&
						react.createElement(
							"span",
							{ style: s.headerCount },
							t("panel.count", { count: entries.length })
						)
				),
				historyLoading &&
					react.createElement(
						"div",
						{ style: { ...s.notice, margin: "8px 14px 0" } },
						t("panel.loadingHistory")
					),
				react.createElement("input", {
					style: s.filter,
					type: "search",
					placeholder: t("panel.filterPlaceholder"),
					value: filter,
					onChange: (event) => setFilter(event.target.value)
				}),
				notice !== "" &&
					react.createElement(
						"div",
						{ style: { ...s.notice, ...(noticeError ? s.noticeError : {}) } },
						notice
					),
				react.createElement(
					"div",
					{
						ref: listRef,
						style: s.list,
						onMouseEnter: () => {
							listHoverRef.current = true;
						},
						onMouseLeave: () => {
							listHoverRef.current = false;
						}
					},
					filtered.length === 0
						? react.createElement(
								"div",
								{ style: s.empty },
								filter.trim() !== "" ? t("panel.noMatch") : t("panel.empty")
							)
						: filtered.map((entry) =>
								react.createElement(
									"div",
									{
										key: entry.key,
										"data-chat-outline-entry": true,
										"data-chat-outline-index": entry.index,
										style: { ...s.entry, ...(entry.index === activeIndex ? s.entryActive : {}) }
									},
									react.createElement(
										"button",
										{
											type: "button",
											"data-chat-outline-line": true,
											style: s.line,
											title: entry.text || t("panel.nonText"),
											disabled: jumpingKey !== null,
											// 单击定位用户消息（滚到视口顶部）；Ctrl/Shift+单击跳到轨迹对应位置
											onClick: (event) => {
												if (event.ctrlKey || event.metaKey || event.shiftKey) {
													event.preventDefault();
													void jumpTrajectory(entry, "user");
												} else {
													void jump(entry, entry.key, "top");
												}
											}
										},
										react.createElement(
											"span",
											{ style: { ...s.badge, ...s.badgeUser } },
											IconUser !== null
												? react.createElement(IconUser, { size: 12 })
												: userLabel.slice(0, 1)
										),
										react.createElement(
											"span",
											{ style: s.userBubble },
											entry.text !== "" ? entry.text : t("panel.nonText")
										),
										jumpingKey === entry.key &&
											react.createElement("span", { style: s.jumpingTag }, t("panel.jumping"))
									),
									entry.assistantKey
										? react.createElement(
												"button",
												{
													type: "button",
													"data-chat-outline-line": true,
													style: { ...s.line, paddingLeft: 2 },
													title: entry.assistantText,
													disabled: jumpingKey !== null,
													// 单击定位 assistant 回复（居中）；Ctrl/Shift+单击跳到轨迹对应位置
													onClick: (event) => {
														if (event.ctrlKey || event.metaKey || event.shiftKey) {
															event.preventDefault();
															void jumpTrajectory(entry, "assistant");
														} else {
															void jump(entry, entry.assistantKey, "center");
														}
													}
												},
												react.createElement(
													"span",
													{ style: { ...s.badge, ...s.badgeAssistant } },
													WhaleLogo !== null
														? react.createElement(WhaleLogo, { size: 14 })
														: assistantLabel.slice(0, 1)
												),
												react.createElement(
													"span",
													{ style: { ...s.lineText, ...s.lineTextAssistant } },
													entry.assistantText !== "" ? entry.assistantText : t("panel.running")
												)
											)
										: entry.running
											? react.createElement("div", { style: s.meta }, t("panel.running"))
											: null
								)
							)
				)
			);
		}

		// ── 客户端插件体 ──────────────────────────────────────────────────────────
		const inject = ["slots", "sessions", "locale", "connection"];

		function apply(ctx) {
			ctx.effect(() => ctx.locale.register(NS, { zh, en }), "chat-outline: dictionaries");
			const sessions = ctx.sessions;
			const { api } = ctx.get("connection");
			/** chat 标签页文案（conversation 命名空间，懒绑定避免字典注册时序问题）。 */
			const getChatTabLabels = () => {
				try {
					const t = ctx.locale.bind("conversation");
					const label = t("view.chat");
					return [label];
				} catch {
					return [];
				}
			};
			/** 轨迹标签页文案（trajectory 命名空间）。 */
			const getTrajectoryTabLabels = () => {
				try {
					const t = ctx.locale.bind("trajectory");
					const label = t("view.trajectory");
					return [label];
				} catch {
					return [];
				}
			};

			// 常驻左侧面板（shell.overlay；窗口有空间时始终显示，无需开关）
			ctx.slots.inject("shell.overlay", () =>
				ctx.slots.register(
					{
						name: "shell.overlay",
						id: "dsh-chat-outline-panel",
						order: 30,
						locale: NS,
						inject: () => ({
							sessions,
							api,
							getChatTabLabels,
							getTrajectoryTabLabels,
							jumpTo,
							jumpToTrajectory
						})
					},
					OutlinePanel
				)
			);
		}

		exports.apply = apply;
		exports.inject = inject;
		return module.exports;
	}
});
