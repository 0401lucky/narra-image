import {
  applyAdminWorkReview,
  applyUserShowcaseAction,
  canShowWorkPrompt,
  canViewWorkDetail,
  type WorkShowcaseStatus,
} from "@/lib/work-showcase";

describe("作品状态流转", () => {
  const now = new Date("2026-04-23T12:00:00.000Z");

  it("私有作品投稿后进入待审核，并记录提示词公开选项", () => {
    const result = applyUserShowcaseAction({
      action: "submit",
      currentStatus: "PRIVATE",
      now,
      showPromptPublic: true,
    });

    expect(result).toEqual({
      featuredAt: null,
      reviewNote: null,
      reviewedAt: null,
      reviewedById: null,
      showcaseStatus: "PENDING",
      showPromptPublic: true,
      submittedAt: now,
    });
  });

  it("作者撤回投稿后恢复私有状态", () => {
    const result = applyUserShowcaseAction({
      action: "withdraw",
      currentStatus: "PENDING",
      now,
    });

    expect(result).toEqual({
      reviewNote: null,
      reviewedAt: null,
      reviewedById: null,
      showcaseStatus: "PRIVATE",
      submittedAt: null,
    });
  });

  it("已公开作品申请下架后进入待下架状态", () => {
    const result = applyUserShowcaseAction({
      action: "request_unfeature",
      currentStatus: "FEATURED",
    });

    expect(result).toEqual({
      showcaseStatus: "TAKEDOWN_PENDING",
    });
  });

  it("管理员通过投稿后公开作品", () => {
    const result = applyAdminWorkReview({
      action: "approve_feature",
      currentStatus: "PENDING",
      now,
      reviewNote: "构图稳定",
      reviewerId: "admin_1",
    });

    expect(result).toEqual({
      featuredAt: now,
      reviewNote: "构图稳定",
      reviewedAt: now,
      reviewedById: "admin_1",
      showcaseStatus: "FEATURED",
    });
  });

  it("管理员拒绝投稿后退回私有，并保留拒绝原因", () => {
    const result = applyAdminWorkReview({
      action: "reject_feature",
      currentStatus: "PENDING",
      now,
      reviewNote: "内容重复度较高",
      reviewerId: "admin_2",
    });

    expect(result).toEqual({
      featuredAt: null,
      reviewNote: "内容重复度较高",
      reviewedAt: now,
      reviewedById: "admin_2",
      showcaseStatus: "PRIVATE",
    });
  });

  it("管理员拒绝下架申请后恢复公开状态，不重置公开时间", () => {
    const featuredAt = new Date("2026-04-20T09:00:00.000Z");

    const result = applyAdminWorkReview({
      action: "reject_unfeature",
      currentFeaturedAt: featuredAt,
      currentStatus: "TAKEDOWN_PENDING",
      now,
      reviewNote: "",
      reviewerId: "admin_3",
    });

    expect(result).toEqual({
      featuredAt,
      reviewNote: null,
      reviewedAt: now,
      reviewedById: "admin_3",
      showcaseStatus: "FEATURED",
    });
  });

  it("管理员同意下架后回到私有状态，并清空投稿时间避免误判为拒稿", () => {
    const result = applyAdminWorkReview({
      action: "approve_unfeature",
      currentStatus: "TAKEDOWN_PENDING",
      now,
      reviewNote: null,
      reviewerId: "admin_4",
    });

    expect(result).toEqual({
      featuredAt: null,
      reviewNote: null,
      reviewedAt: now,
      reviewedById: "admin_4",
      showcaseStatus: "PRIVATE",
      submittedAt: null,
    });
  });

  it.each([
    ["submit", "PENDING"],
    ["withdraw", "FEATURED"],
    ["request_unfeature", "PRIVATE"],
  ] as const)(
    "非法用户流转会抛错: %s / %s",
    (action, currentStatus) => {
      expect(() =>
        applyUserShowcaseAction({
          action,
          currentStatus,
        }),
      ).toThrowError("当前状态不允许执行该操作");
    },
  );

  it.each([
    ["approve_feature", "FEATURED"],
    ["reject_feature", "PRIVATE"],
    ["approve_unfeature", "PENDING"],
    ["reject_unfeature", "PRIVATE"],
  ] as const)(
    "非法管理员审核会抛错: %s / %s",
    (action, currentStatus) => {
      expect(() =>
        applyAdminWorkReview({
          action,
          currentStatus,
          now,
          reviewerId: "admin_x",
        }),
      ).toThrowError("当前状态不允许执行该审核操作");
    },
  );
});

describe("作品访问与提示词可见性", () => {
  it.each([
    [true, "PRIVATE", true],
    [false, "PRIVATE", false],
    [false, "PENDING", false],
    [false, "TAKEDOWN_PENDING", false],
    [false, "FEATURED", true],
  ] as const)(
    "详情访问控制: owner=%s status=%s => %s",
    (isOwner, showcaseStatus, expected) => {
      expect(canViewWorkDetail({ isOwner, showcaseStatus })).toBe(expected);
    },
  );

  it.each([
    [true, false, true],
    [false, true, true],
    [false, false, false],
  ] as const)(
    "提示词显示控制: owner=%s public=%s => %s",
    (isOwner, showPromptPublic, expected) => {
      expect(
        canShowWorkPrompt({
          isOwner,
          showcaseStatus: "FEATURED",
          showPromptPublic,
        }),
      ).toBe(expected);
    },
  );

  it.each(["PRIVATE", "PENDING", "TAKEDOWN_PENDING"] as WorkShowcaseStatus[])(
    "非公开作品即使设置公开提示词也不对访客展示: %s",
    (showcaseStatus) => {
      expect(
        canShowWorkPrompt({
          isOwner: false,
          showcaseStatus,
          showPromptPublic: true,
        }),
      ).toBe(false);
    },
  );
});
