import { serializeAdminWork, serializePublicWorkDetail, serializeWork } from "@/lib/prisma-mappers";
import { workShowcaseStatuses } from "@/lib/work-showcase";

import {
  createPrivacyWork,
  publicWorkDetailKeys,
  workPrivacySentinels,
} from "./helpers/work-privacy-fixtures";

describe("non-owner detail projection", () => {
  it.each(
    workShowcaseStatuses.flatMap((showcaseStatus) =>
      [false, true].map((showPromptPublic) => ({ showcaseStatus, showPromptPublic })),
    ),
  )("applies the existing non-owner prompt policy: $showcaseStatus / $showPromptPublic", (options) => {
    const ownerWork = serializeWork(createPrivacyWork(options));
    const canReadPrompt = options.showcaseStatus === "FEATURED" && options.showPromptPublic;
    const publicWork = serializePublicWorkDetail(ownerWork);

    expect(Object.keys(publicWork).sort()).toEqual(publicWorkDetailKeys);
    expect(publicWork.prompt).toBe(canReadPrompt ? workPrivacySentinels.prompt : null);
    expect(publicWork.negativePrompt).toBe(canReadPrompt ? workPrivacySentinels.negativePrompt : null);
    expect(publicWork.id).toBe(ownerWork.id);
    expect(publicWork.url).toBe(ownerWork.url);
    expect(publicWork.showPromptPublic).toBe(options.showPromptPublic);
  });

  it("builds a new allowlisted object even from a frozen admin result with additional fields", () => {
    const ownerWork = Object.freeze({
      ...serializeAdminWork(createPrivacyWork()),
      futureInternalField: "FUTURE_SECRET_SENTINEL",
    });
    const before = JSON.stringify(ownerWork);
    const publicWork = serializePublicWorkDetail(ownerWork);

    expect(Object.keys(publicWork).sort()).toEqual(publicWorkDetailKeys);
    expect(JSON.stringify(publicWork)).not.toContain("FUTURE_SECRET_SENTINEL");
    expect(publicWork).not.toBe(ownerWork);
    expect(JSON.stringify(ownerWork)).toBe(before);
    expect(ownerWork.prompt).toBe(workPrivacySentinels.prompt);
    expect(ownerWork.negativePrompt).toBe(workPrivacySentinels.negativePrompt);
    expect(ownerWork.reviewer?.email).toBe(workPrivacySentinels.reviewerEmail);
  });
});
