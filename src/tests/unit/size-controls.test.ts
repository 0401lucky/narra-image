import { describe, expect, it } from "vitest";

import {
  DEFAULT_SIZE_CONTROL_STATE,
  applyDimensionAlignment,
  deriveSizeControlState,
  getSizeControlWarning,
  selectAspectRatio,
  selectResolutionTier,
  swapDimensions,
  toggleAlignMultiple16,
  updateDimensionInputs,
} from "@/components/create/size-controls";

describe("workbench size controls", () => {
  it("computes linked dimensions when picking resolution tiers and aspect ratios", () => {
    const withRatio = selectAspectRatio(DEFAULT_SIZE_CONTROL_STATE, "3:4");
    expect(withRatio).toMatchObject({
      resolutionTier: "1K",
      aspectRatio: "3:4",
      size: "1024x1360",
      widthInput: "1024",
      heightInput: "1360",
    });

    const upgraded2k = selectResolutionTier(withRatio, "2K");
    expect(upgraded2k).toMatchObject({
      resolutionTier: "2K",
      aspectRatio: "3:4",
      size: "1536x2048",
      widthInput: "1536",
      heightInput: "2048",
    });

    const resetAuto = selectResolutionTier(upgraded2k, "auto");
    expect(resetAuto).toMatchObject({
      resolutionTier: "auto",
      aspectRatio: "auto",
      size: "auto",
      widthInput: "",
      heightInput: "",
    });
  });

  it("swaps width/height and reverse-derives presets for config reuse", () => {
    const portrait = selectAspectRatio(selectResolutionTier(DEFAULT_SIZE_CONTROL_STATE, "2K"), "9:16");
    expect(portrait.size).toBe("1152x2048");

    const landscape = swapDimensions(portrait);
    expect(landscape).toMatchObject({
      size: "2048x1152",
      resolutionTier: "2K",
      aspectRatio: "16:9",
      widthInput: "2048",
      heightInput: "1152",
    });

    expect(deriveSizeControlState("2048x1152")).toMatchObject({
      resolutionTier: "2K",
      aspectRatio: "16:9",
      widthInput: "2048",
      heightInput: "1152",
    });
  });

  it("respects 16-multiple alignment toggle and surfaces validation warnings", () => {
    const manualOff = toggleAlignMultiple16(DEFAULT_SIZE_CONTROL_STATE, false);
    const typed = updateDimensionInputs(manualOff, "1000", "1000");
    expect(typed.widthInput).toBe("1000");
    expect(typed.size).toBe("1008x1008");
    expect(getSizeControlWarning(typed)).toContain("16px");

    const aligned = applyDimensionAlignment(toggleAlignMultiple16(typed, true));
    expect(aligned.widthInput).toBe("1008");
    expect(aligned.heightInput).toBe("1008");
    expect(getSizeControlWarning(aligned)).toBeNull();

    const oversized = updateDimensionInputs(manualOff, "5000", "5000");
    expect(getSizeControlWarning(oversized)).toContain("3840px");
  });
});
