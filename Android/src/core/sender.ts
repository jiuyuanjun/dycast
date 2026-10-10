/**
 * 统一发送层：所有对外发送动作（手动弹幕 / 自动回复 / 未来新增的发送功能）收敛到本模块。
 *
 * 使用方式：`sendText(content)` 即可发送当前直播间弹幕。上下文（roomId / secUid / webRid）
 * 由 `configure(ctx)` 注入 —— store 在连接成功后调用一次，发送层内部自取，调用方无需关心参数。
 *
 * 约定：
 *  - 发送前校验上下文完整（roomId + secUid），缺任一直接返回失败原因，不静默吞错；
 *  - 返回统一结果 { ok, msg }，调用方按 msg 提示用户；
 *  - 未来新增发送类型（如礼物）在下方扩展新方法，现有调用方不受影响。
 */

import { sendChatMessage as sendChatMessageImpl } from './sendMessage';

export interface SenderContext {
  /** 直播间 room_id（19 位数字，发弹幕接口需要；与 webRid 形态不同） */
  roomId: string;
  /** 直播间 web_rid（短房间号，Android 隐藏 WebView 加载页面用） */
  webRid?: string;
  /** 当前登录用户 sec_uid（未登录时无法发送） */
  secUid?: string;
}

export interface SendResult {
  ok: boolean;
  msg: string;
}

let context: SenderContext | null = null;

/** 注入发送上下文（store 在连接成功 / 切房间后调用） */
export function configureSender(ctx: SenderContext | null): void {
  context = ctx;
}

/** 获取当前发送上下文 */
export function getSenderContext(): SenderContext | null {
  return context;
}

/** 上下文是否就绪（roomId + secUid 均存在） */
export function isSenderReady(): boolean {
  return !!context?.roomId && !!context?.secUid;
}

/**
 * 发送弹幕（统一入口：手动输入框 / 自动回复 / 后续扩展都调这里）。
 * @param content 弹幕内容（前后空白会被去除；空内容直接失败）
 */
export async function sendText(content: string): Promise<SendResult> {
  const text = (content || '').trim();
  if (!text) return { ok: false, msg: '消息内容为空' };
  if (!context?.roomId) return { ok: false, msg: '直播间未连接，无法发送' };
  if (!context.secUid) return { ok: false, msg: '账号信息未就绪，请到「设置 → 登录/更换账号」重新登录一次后再发送' };
  return sendChatMessageImpl(context.roomId, text, context.secUid, context.webRid);
}