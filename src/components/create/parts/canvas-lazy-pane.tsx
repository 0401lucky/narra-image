"use client";

import { ArrowLeft, LoaderCircle, RefreshCw } from "lucide-react";
import dynamic from "next/dynamic";
import { Component, type ComponentType } from "react";

import type { CanvasStageProps } from "./canvas-stage";

function createLazyStage() {
  return dynamic<CanvasStageProps>(
    () => import("./canvas-stage").then((module) => module.CanvasStage),
    { ssr: false, loading: () => <div role="status" className="flex flex-1 items-center justify-center gap-2 text-sm text-[var(--ink-soft)]"><LoaderCircle aria-hidden className="size-4 animate-spin" />正在打开画布</div> },
  );
}

const InitialStage = createLazyStage();
type CanvasLazyPaneState = { failure: "chunk" | "renderer" | null; Stage: ComponentType<CanvasStageProps> };

// A fresh React lazy boundary can retry rendering, not Turbopack's cached rejected chunk promise.
export class CanvasLazyPane extends Component<CanvasStageProps, CanvasLazyPaneState> {
  state: CanvasLazyPaneState = { failure: null, Stage: InitialStage };

  static getDerivedStateFromError(error: unknown): Pick<CanvasLazyPaneState, "failure"> {
    return { failure: error instanceof Error && error.name === "ChunkLoadError" ? "chunk" : "renderer" };
  }

  render() {
    if (this.state.failure) {
      return <section role="alert" className="flex min-w-0 flex-1 flex-col items-center justify-center gap-4 p-6 text-center">
        <h2 className="font-serif text-2xl text-[var(--ink)]">画布暂时无法显示</h2>
        <p className="max-w-md text-sm text-[var(--ink-soft)]">{this.state.failure === "chunk"
          ? "画布文件加载失败，当前页面无法直接重试。请先返回对话保留未发送的对话内容，确认画布本地保存完成后，待网络恢复再手动刷新页面。刷新会丢弃仅在内存中的内容；本页不会自动刷新或重新提交任务。"
          : "可以重试或返回对话。工作台中的草稿与已提交任务不会因此清空或重新生成。"}</p>
        <div className="flex flex-wrap justify-center gap-3">
          {this.state.failure !== "chunk" && <button type="button" className="inline-flex items-center gap-2 rounded-xl bg-[var(--accent)] px-4 py-2 text-sm font-semibold text-white" onClick={() => this.setState({ failure: null, Stage: createLazyStage() })}><RefreshCw aria-hidden className="size-4" />重试加载画布</button>}
          <button type="button" className="inline-flex items-center gap-2 rounded-xl border border-[var(--line)] bg-white/80 px-4 py-2 text-sm font-semibold text-[var(--ink)]" onClick={this.props.onReturnToChat}><ArrowLeft aria-hidden className="size-4" />返回对话</button>
        </div>
      </section>;
    }
    const Stage = this.state.Stage;
    return <Stage {...this.props} />;
  }
}
