import type { ImageMaintenanceMode, ImageMaintenanceState } from "@/lib/storage/image-maintenance-types";

export const STORAGE_POLL_INTERVAL_MS = 1500;
export const STORAGE_REQUEST_TIMEOUT_MS = 30000;
export const STORAGE_JOB_LABELS: Record<ImageMaintenanceState, string> = {
  PREVIEW: "待确认", QUEUED: "排队中", RUNNING: "清理中", WAITING: "等待重试",
  SUCCEEDED: "已完成", PARTIAL: "部分完成", CANCELLED: "已停止", EXPIRED: "预览已过期",
};
export const STORAGE_MODE_LABELS: Record<ImageMaintenanceMode, string> = {
  MANUAL_AGE: "按保留天数清理", MANUAL_ALL: "清理全部可清理图片", SCHEDULE: "定时清理",
  QUOTA: "容量回收", SOURCE_RETIREMENT: "迁移源副本清理",
};
export const STORAGE_ACTIVE_STATES: readonly ImageMaintenanceState[] = ["QUEUED", "RUNNING", "WAITING"];
export const STORAGE_REASON_LABELS: Record<string, string> = {
  REFERENCED: "正在使用", ACTIVE_WRITE: "写入中", ACTIVE_JOB: "生成任务未结束",
  READING: "读取中", COPYING: "迁移中", CANVAS_GRACE: "画布原图宽限期",
  UNKNOWN_PUT: "写入结果待核实", VERSIONED: "存储版本状态不可清理", STORAGE_UNAVAILABLE: "存储暂不可用",
  SNAPSHOT_CHANGED: "预览后图片状态已变化", POLICY_CHANGED: "清理策略已变化", ALREADY_CLAIMED: "其他任务处理中",
  IMAGE_STORAGE_UNAVAILABLE: "存储暂不可用", IMAGE_REFERENCE_CONFLICT: "新增使用关系，已保护",
  CANCELLED: "已停止后续清理", POLICY_DISABLED: "清理已暂停",
};
