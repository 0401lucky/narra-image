import { GALLERY_REQUEST_TIMEOUT_MS } from "./gallery-constants";

export class GalleryRequestError extends Error {
  constructor(
    readonly reason: "http" | "timeout" | "aborted",
    readonly status?: number,
  ) {
    super(reason);
    this.name = "GalleryRequestError";
  }
}

type GalleryRequestOptions = {
  controller: AbortController;
  method?: "GET" | "PUT";
};

// fetch 与 JSON 共用截止；即使底层忽略 abort，调用方也能结束等待。
// 迟到的网络 continuation 只读取数据，不拥有任何组件状态写入权。
export async function requestGalleryJson(
  url: string,
  { controller, method = "GET" }: GalleryRequestOptions,
): Promise<unknown> {
  const { signal } = controller;
  const assertActive = () => {
    if (signal.aborted) {
      throw signal.reason ?? new GalleryRequestError("aborted");
    }
  };
  assertActive();

  let rejectAbort: (reason: unknown) => void = () => {};
  const interrupted = new Promise<never>((_resolve, reject) => {
    rejectAbort = reject;
  });
  const onAbort = () => rejectAbort(signal.reason ?? new GalleryRequestError("aborted"));
  signal.addEventListener("abort", onAbort, { once: true });
  const timeout = setTimeout(() => {
    controller.abort(new GalleryRequestError("timeout"));
  }, GALLERY_REQUEST_TIMEOUT_MS);

  try {
    const read = async () => {
      const response = await fetch(url, {
        method,
        credentials: "same-origin",
        signal,
      });
      assertActive();
      if (!response.ok) throw new GalleryRequestError("http", response.status);
      const payload: unknown = await response.json();
      assertActive();
      return payload;
    };
    return await Promise.race([read(), interrupted]);
  } finally {
    clearTimeout(timeout);
    signal.removeEventListener("abort", onAbort);
  }
}
