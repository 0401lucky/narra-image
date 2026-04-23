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

export async function parseGenerateRequest(request: Request | FormData) {
  const parseFormData = (formData: FormData) => {
    const image = formData.get("image");

    if (!(image instanceof File) || image.size === 0) {
      throw new Error("请先上传参考图");
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
      size: "参考图",
    });

    return {
      ...body,
      count: 1,
      image,
    };
  };

  if (request instanceof FormData) {
    return parseFormData(request);
  }

  const contentType = request.headers.get("content-type")?.toLowerCase() ?? "";

  if (contentType.includes("multipart/form-data")) {
    return parseFormData(await request.formData());
  }

  const body = generateSchema.parse(await request.json());

  return {
    ...body,
    image: null,
  };
}
