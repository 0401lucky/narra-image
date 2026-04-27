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
      prompt: toNullableString(formData.get("prompt")),
      providerMode: toNullableString(formData.get("providerMode")) || "built_in",
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

  const json = await request.json();
  const body = generateSchema.parse(json);

  return {
    ...body,
    channelId: (json as Record<string, unknown>).channelId as string | undefined,
    image: null,
    images: [],
  };
}
