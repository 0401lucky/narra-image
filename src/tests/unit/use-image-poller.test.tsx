import { render, screen, waitFor } from "@testing-library/react";
import { useState } from "react";

import { useImagePoller } from "@/components/create/hooks/use-image-poller";
import type { GenerationItem } from "@/components/create/types";

const pendingGeneration: GenerationItem = {
  count: 1,
  createdAt: "2026-04-23T08:00:00.000Z",
  creditsSpent: 5,
  generationType: "text_to_image",
  id: "job_pending",
  images: [],
  model: "gpt-image-2",
  negativePrompt: null,
  prompt: "切页恢复轮询",
  providerMode: "built_in",
  size: "1024x1024",
  sourceImageUrl: null,
  status: "pending",
};

const succeededGeneration: GenerationItem = {
  ...pendingGeneration,
  images: [{ id: "image_done", url: "https://example.com/done.png" }],
  status: "succeeded",
};

function PollerProbe() {
  const [generations, setGenerations] = useState([pendingGeneration]);
  useImagePoller({
    generations,
    onUpdate: (updated) => {
      setGenerations((current) =>
        current.map((generation) => (generation.id === updated.id ? updated : generation)),
      );
    },
  });

  const generation = generations[0];
  return (
    <div>
      <span>{generation.status}</span>
      <span>{generation.images[0]?.url ?? "no-image"}</span>
    </div>
  );
}

describe("useImagePoller", () => {
  let documentHidden = false;

  beforeEach(() => {
    documentHidden = false;
    Object.defineProperty(document, "hidden", {
      configurable: true,
      get: () => documentHidden,
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        json: async () => ({
          data: {
            generation: succeededGeneration,
          },
        }),
        ok: true,
      })),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("页面恢复可见时立即补拉 pending 任务状态", async () => {
    documentHidden = true;
    render(<PollerProbe />);

    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(fetch).not.toHaveBeenCalled();

    documentHidden = false;
    document.dispatchEvent(new Event("visibilitychange"));

    await waitFor(() => {
      expect(screen.getByText("succeeded")).toBeInTheDocument();
    });
    expect(screen.getByText("https://example.com/done.png")).toBeInTheDocument();
    expect(fetch).toHaveBeenCalledWith("/api/me/generations/job_pending");
  });
});
