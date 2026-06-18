import { createContext, useContext } from "react";

// 页面作为「聊天框内的卡片」嵌入渲染时置 true：Layout 据此走紧凑排版
// （更小标题、去掉 max-w-7xl 与大留白），以适配对话框尺寸、尽量精简。
export const EmbeddedCtx = createContext(false);
export const useEmbedded = () => useContext(EmbeddedCtx);
