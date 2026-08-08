export function getPublicEnv() {
  return {
    NEXT_PUBLIC_IMAGE_OPTIMIZER_BYPASS_HOSTS:
      process.env.NEXT_PUBLIC_IMAGE_OPTIMIZER_BYPASS_HOSTS ?? "",
  };
}
