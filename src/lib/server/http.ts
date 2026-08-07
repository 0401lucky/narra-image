import { NextResponse } from "next/server";
import { ZodError } from "zod";

export function jsonOk<T>(data: T, init?: ResponseInit) {
  return NextResponse.json({ data }, init);
}

export function jsonError(message: string, status = 400, code?: string) {
  return NextResponse.json(
    code ? { code, error: message } : { error: message },
    { status },
  );
}

export async function parseJsonBody<T>(request: Request) {
  try {
    return (await request.json()) as T;
  } catch {
    throw new Error("请求体不是合法 JSON");
  }
}

export function getErrorMessage(error: unknown) {
  if (error instanceof ZodError) {
    return error.issues[0]?.message ?? "参数校验失败";
  }

  if (error instanceof Error) {
    return error.message;
  }

  return "服务器开小差了";
}
