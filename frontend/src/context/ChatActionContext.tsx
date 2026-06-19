import { createContext, useContext } from "react";

// 让右侧面板等子组件能把一条消息发进对话（如「接入某应用」的引导）。
export const ChatActionCtx = createContext<{ ask: (text: string) => void }>({ ask: () => {} });
export const useChatAction = () => useContext(ChatActionCtx);
