import { generateSchema } from "@/lib/validators";

function toNullableString(value: FormDataEntryValue | null) {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function toBoolean(value: FormDataEntryValue | null) {
  return value === "true";
}

function toNullableNumber(value: FormDataEntryValue | null) {
  if (typeof value !== "string" || !value.trim()) {
    return null;
  }

  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function firstString(...values: Array<FormDataEntryValue | null>) {
  for (const value of values) {
    const normalized = toNullableString(value);
    if (normalized) return normalized;
  }

  return null;
}

function getReferenceImages(formData: FormData) {
  const entries = [
    ...formData.getAll("referenceImages"),
    ...formData.getAll("images"),
    ...formData.getAll("image"),
  ];

  return entries.filter((entry): entry is File => entry instanceof File && entry.size > 0);
}

export async function parseGenerateRequest(request: Request | FormData) {
  const parseFormData = (formData: FormData) => {
    const images = getReferenceImages(formData);

    if (images.length === 0) {
      throw new Error("请先上传参考图");
    }

    if (images.length > 16) {
      throw new Error("参考图最多支持 16 张");
    }

    if (images.some((image) => !image.type.startsWith("image/"))) {
      throw new Error("参考图必须是图片文件");
    }

    const body = generateSchema.parse({
      count: 1,
      customProvider:
        toNullableString(formData.get("providerMode")) === "custom"
          ? {
              apiKey: toNullableString(formData.get("customApiKey")),
              baseUrl: toNullableString(formData.get("customBaseUrl")),
              label: "我的渠道",
              model: toNullableString(formData.get("customModel")) || toNullableString(formData.get("model")),
              models: [],
              remember: toBoolean(formData.get("rememberProvider")),
            }
          : null,
      generationType: toNullableString(formData.get("generationType")) || "image_to_image",
      model: toNullableString(formData.get("model")),
      negativePrompt: null,
      outputCompression: toNullableNumber(formData.get("outputCompression"))
        ?? toNullableNumber(formData.get("output_compression")),
      outputFormat: firstString(formData.get("outputFormat"), formData.get("output_format")) || "png",
      prompt: toNullableString(formData.get("prompt")),
      providerMode: toNullableString(formData.get("providerMode")) || "built_in",
      quality: toNullableString(formData.get("quality")) || "auto",
      moderation: toNullableString(formData.get("moderation")) || "auto",
      seed: null,
      size: toNullableString(formData.get("size")) || "auto",
    });

    return {
      ...body,
      channelId: toNullableString(formData.get("channelId")) || undefined,
      count: 1,
      image: images[0] ?? null,
      images,
    };
  };

  if (request instanceof FormData) {
    return parseFormData(request);
  }

  const contentType = request.headers.get("content-type")?.toLowerCase() ?? "";

  if (contentType.includes("multipart/form-data")) {
    return parseFormData(await request.formData());
  }

  const json = await request.json() as Record<string, unknown>;
  const body = generateSchema.parse({
    ...json,
    outputCompression: json.outputCompression ?? json.output_compression,
    outputFormat: json.outputFormat ?? json.output_format,
  });

  return {
    ...body,
    channelId: json.channelId as string | undefined,
    image: null,
    images: [],
  };
}
