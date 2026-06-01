// 视频工作区前端类型。
export type VideoChannelInfo = {
  id: string;
  name: string;
  defaultModel: string;
  models: string[];
  videoCreditCost: number;
};

export type VideoReferenceImage = {
  file: File;
  previewUrl: string;
};

export type VideoAspectRatio = "16:9" | "9:16" | "1:1";
export type VideoResolution = "720p" | "1080p";
