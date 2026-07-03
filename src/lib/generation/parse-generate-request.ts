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

function getReferenceImageUrls(formData: FormData): string[] {
  return formData
    .getAll("referenceImageUrls")
    .filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0);
}

export async function parseGenerateRequest(request: Request | FormData) {
  const parseFormData = (formData: FormData) => {
    const images = getReferenceImages(formData);
    const imageUrls = getReferenceImageUrls(formData);

    if (images.length === 0 && imageUrls.length === 0) {
      throw new Error("请先上传参考图");
    }

    if (images.length + imageUrls.length > 16) {
      throw new Error("参考图最多支持 16 张");
    }

    if (images.some((image) => !image.type.startsWith("image/"))) {
      throw new Error("参考图必须是图片文件");
    }

    const providerMode = toNullableString(formData.get("providerMode")) || "built_in";
    const customApiKey = toNullableString(formData.get("customApiKey"));
    const customModels = (() => {
      const raw = toNullableString(formData.get("customModels"));
      if (!raw) return [] as string[];
      try {
        const parsed = JSON.parse(raw) as unknown;
        return Array.isArray(parsed)
          ? parsed.filter((item): item is string => typeof item === "string" && item.trim().length > 0)
          : [];
      } catch {
        return [] as string[];
      }
    })();

    const body = generateSchema.parse({
      count: 1,
      customProvider:
        providerMode === "custom" && customApiKey
          ? {
              apiKey: customApiKey,
              baseUrl: toNullableString(formData.get("customBaseUrl")),
              label: toNullableString(formData.get("customLabel")) || "我的渠道",
              model: toNullableString(formData.get("customModel")) || toNullableString(formData.get("model")),
              models: customModels,
              remember: toBoolean(formData.get("rememberProvider")),
            }
          : null,
      generationType: toNullableString(formData.get("generationType")) || "image_to_image",
      durationSeconds: toNullableNumber(formData.get("durationSeconds")),
      aspectRatio: toNullableString(formData.get("aspectRatio")),
      model: toNullableString(formData.get("model")),
      negativePrompt: null,
      outputCompression: toNullableNumber(formData.get("outputCompression"))
        ?? toNullableNumber(formData.get("output_compression")),
      outputFormat: firstString(formData.get("outputFormat"), formData.get("output_format")) || "png",
      prompt: toNullableString(formData.get("prompt")),
      providerMode,
      quality: toNullableString(formData.get("quality")) || "auto",
      moderation: toNullableString(formData.get("moderation")) || "auto",
      seed: null,
      size: toNullableString(formData.get("size")) || "auto",
    });

    return {
      ...body,
      channelId: toNullableString(formData.get("channelId")) || undefined,
      conversationId: toNullableString(formData.get("conversationId")) || undefined,
      count: 1,
      image: images[0] ?? null,
      imageUrls,
      images,
      replaceGenerationId: toNullableString(formData.get("replaceGenerationId")) || undefined,
      turnstileToken: toNullableString(formData.get("turnstileToken")) || undefined,
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
    conversationId: typeof json.conversationId === "string" ? json.conversationId : undefined,
    image: null,
    imageUrls: [] as string[],
    images: [],
    replaceGenerationId:
      typeof json.replaceGenerationId === "string" && json.replaceGenerationId.trim()
        ? json.replaceGenerationId.trim()
        : undefined,
    turnstileToken:
      typeof json.turnstileToken === "string" && json.turnstileToken.trim()
        ? json.turnstileToken.trim()
        : undefined,
  };
}
