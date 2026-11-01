// @vitest-environment node

import { PassThrough, Readable } from "node:stream";
import type { S3ClientConfig } from "@aws-sdk/client-s3";
import { beforeEach, describe, expect, it, vi } from "vitest";

const wire = vi.hoisted(() => ({ handle: vi.fn(), destroy: vi.fn(), options: vi.fn() }));
vi.mock("@aws-sdk/client-s3", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@aws-sdk/client-s3")>();
  return {
    ...actual,
    S3Client: class extends actual.S3Client {
      constructor(options: S3ClientConfig) {
        super({ ...options, requestHandler: { handle: wire.handle, destroy: wire.destroy } });
        wire.options(options);
      }
    },
  };
});
vi.mock("@/lib/env", () => ({ getEnv: () => ({}) }));

import { GetBucketVersioningCommand, S3Client } from "@aws-sdk/client-s3";
import { createCanvasStorageAdapter, verifyCanvasStorageCapability } from "@/lib/canvas/storage";

const environment = {
  S3_ENDPOINT: "http://127.0.0.1:1",
  S3_REGION: "us-east-1",
  S3_BUCKET: "canvas-wire-tests",
  S3_ACCESS_KEY_ID: "fake-access",
  S3_SECRET_ACCESS_KEY: "fake-secret",
  S3_PUBLIC_BASE_URL: "",
};
const namespace = "http://s3.amazonaws.com/doc/2006-03-01/";
const unversioned = `<VersioningConfiguration xmlns="${namespace}"/>`;
const bodyLimit = 16 * 1024;
const validEnvelopes = [
  ["S3 namespace", unversioned],
  ["bare provider envelope", "<VersioningConfiguration/>"],
  ["explicit empty namespace", '<VersioningConfiguration xmlns=""/>'],
  ["paired root", "<VersioningConfiguration> \r\n\t </VersioningConfiguration>"],
  ["prefixed root", `<s3:VersioningConfiguration xmlns:s3="${namespace}"></s3:VersioningConfiguration>`],
  ["namespace aliases", `<s3:VersioningConfiguration xmlns:s3='${namespace}' xmlns='${namespace}' xmlns:alias='${namespace}' />`],
  ["BOM, declaration and comments", `\ufeff<?xml version="1.0" encoding="UTF-8"?>\n<!--before--><VersioningConfiguration><!--empty--></VersioningConfiguration>\n<!--after-->`],
  ["declaration variants", `<?xml version = '1.0' encoding = 'utf-8' standalone = 'yes' ?>${unversioned}`],
  ["standalone declaration", `<?xml version="1.0" standalone="no"?>${unversioned}`],
  ["inert comment contents", `<!--& <![CDATA[ <!DOCTYPE &external; -->${unversioned}`],
  ["UTF-8 comment", `<!--\u4e2d\u6587 \ud83c\udf0d-->${unversioned}`],
  ["exact byte cap", unversioned + " ".repeat(bodyLimit - Buffer.byteLength(unversioned))],
] as const;
const invalidEnvelopes: Array<[string, string | Buffer]> = [
  ["empty body", ""],
  ["only whitespace", " \r\n\t "],
  ["HTML response", "<html/>"],
  ["unsupported operation error", "<Error><Code>NotImplemented</Code></Error>"],
  ["wrong root case", "<versioningConfiguration/>"],
  ["similar root name", "<VersioningConfigurationOther/>"],
  ["nested root spoof", `<html>${unversioned}</html>`],
  ["plain text spoof", `not XML ${unversioned}`],
  ["comment-only spoof", `<!--${unversioned}-->`],
  ["truncated opening", "<VersioningConfiguration"],
  ["unclosed root", `<VersioningConfiguration xmlns="${namespace}">`],
  ["wrong closing root", "<VersioningConfiguration></Other>"],
  ["trailing bytes", `${unversioned}trailing`],
  ["multiple roots", unversioned + unversioned],
  ["non-whitespace text", "<VersioningConfiguration>unknown</VersioningConfiguration>"],
  ["non-ASCII whitespace", "<VersioningConfiguration>\u00a0</VersioningConfiguration>"],
  ["enabled versioning", "<VersioningConfiguration><Status>Enabled</Status></VersioningConfiguration>"],
  ["suspended versioning", "<VersioningConfiguration><Status>Suspended</Status></VersioningConfiguration>"],
  ["unknown versioning", "<VersioningConfiguration><Status>Unknown</Status></VersioningConfiguration>"],
  ["empty Status", "<VersioningConfiguration><Status/></VersioningConfiguration>"],
  ["blank Status", "<VersioningConfiguration><Status> </Status></VersioningConfiguration>"],
  ["duplicate Status", "<VersioningConfiguration><Status>Enabled</Status><Status/></VersioningConfiguration>"],
  ["unexpected child", "<VersioningConfiguration><MFADelete>Disabled</MFADelete></VersioningConfiguration>"],
  ["nested fake Status", "<VersioningConfiguration><Other><Status>Enabled</Status></Other></VersioningConfiguration>"],
  ["unknown namespace", '<VersioningConfiguration xmlns="https://unknown.invalid/"/>'],
  ["unused unknown namespace", '<VersioningConfiguration xmlns:other="https://unknown.invalid/"/>'],
  ["unbound prefix", "<other:VersioningConfiguration/>"],
  ["empty prefixed namespace", '<other:VersioningConfiguration xmlns:other=""/>'],
  ["ordinary attribute", '<VersioningConfiguration Status="Enabled"/>'],
  ["duplicate namespace", `<VersioningConfiguration xmlns="${namespace}" xmlns="${namespace}"/>`],
  ["duplicate prefixed namespace", `<s3:VersioningConfiguration xmlns:s3="${namespace}" xmlns:s3="${namespace}"/>`],
  ["xml prefix rebinding", `<xml:VersioningConfiguration xmlns:xml="${namespace}"/>`],
  ["xmlns prefix rebinding", `<xmlns:VersioningConfiguration xmlns:xmlns="${namespace}"/>`],
  ["invalid prefix name", `<1s3:VersioningConfiguration xmlns:1s3="${namespace}"/>`],
  ["extra prefix colon", `<s3:VersioningConfiguration xmlns:s3:bad="${namespace}"/>`],
  ["missing attribute separator", `<VersioningConfiguration xmlns="${namespace}"xmlns:s3="${namespace}"/>`],
  ["mismatched namespace quotes", `<VersioningConfiguration xmlns="${namespace}'/>`],
  ["unquoted namespace", `<VersioningConfiguration xmlns=${namespace}/>`],
  ["closing prefix mismatch", `<s3:VersioningConfiguration xmlns:s3="${namespace}"></VersioningConfiguration>`],
  ["duplicate BOM", `\ufeff\ufeff${unversioned}`],
  ["misplaced BOM", ` ${"\ufeff"}${unversioned}`],
  ["truncated comment", `<!--${unversioned}`],
  ["invalid comment dashes", `<!--bad--comment-->${unversioned}`],
  ["invalid comment ending", `<!--bad--->${unversioned}`],
  ["invalid XML character in comment", `<!--\u0000-->${unversioned}`],
  ["invalid XML control in root comment", "<VersioningConfiguration><!--\u001f--></VersioningConfiguration>"],
  ["invalid XML noncharacter in trailing comment", `${unversioned}<!--\ufffe-->`],
  ["invalid XML noncharacter in leading comment", `<!--\uffff-->${unversioned}`],
  ["invalid UTF-8 in comment", Buffer.concat([Buffer.from("<!--"), Buffer.from([0xff]), Buffer.from(`-->${unversioned}`)])],
  ["UTF-16 bytes", Buffer.from(`\ufeff${unversioned}`, "utf16le")],
  ["declaration after whitespace", ` <?xml version="1.0"?>${unversioned}`],
  ["declaration after comment", `<!--first--><?xml version="1.0"?>${unversioned}`],
  ["declaration after root", `${unversioned}<?xml version="1.0"?>`],
  ["duplicate declaration", `<?xml version="1.0"?><?xml version="1.0"?>${unversioned}`],
  ["malformed declaration", `<?xml?>${unversioned}`],
  ["unsupported XML version", `<?xml version="1.1"?>${unversioned}`],
  ["unsupported encoding", `<?xml version="1.0" encoding="UTF-16"?>${unversioned}`],
  ["unexpected declaration field", `<?xml version="1.0" extra="yes"?>${unversioned}`],
  ["wrong declaration order", `<?xml encoding="UTF-8" version="1.0"?>${unversioned}`],
  ["processing instruction", `<?other invalid?>${unversioned}`],
  ["DTD", `<!DOCTYPE VersioningConfiguration>${unversioned}`],
  ["external entity declaration", '<!DOCTYPE VersioningConfiguration [<!ENTITY source SYSTEM "http://127.0.0.1:1/external">]><VersioningConfiguration>&source;</VersioningConfiguration>'],
  ["XInclude", '<VersioningConfiguration xmlns:xi="http://www.w3.org/2001/XInclude"><xi:include href="http://127.0.0.1:1/external"/></VersioningConfiguration>'],
  ["empty CDATA", "<VersioningConfiguration><![CDATA[]]></VersioningConfiguration>"],
  ["whitespace CDATA", "<VersioningConfiguration><![CDATA[ ]]></VersioningConfiguration>"],
  ["whitespace entity", "<VersioningConfiguration>&#32;</VersioningConfiguration>"],
  ["escaped namespace", '<VersioningConfiguration xmlns="http://s3.amazonaws.com/doc/2006-03-01&#47;"/>'],
  ["oversized body", unversioned + " ".repeat(bodyLimit)],
  ["oversized UTF-8 comment", `<!--${"\u00e9".repeat(bodyLimit / 2)}-->${unversioned}`],
];

function response(body: string | Buffer | Readable, statusCode = 200) {
  return { response: { statusCode, headers: { "content-type": "application/xml" }, body: body instanceof Readable ? body : Readable.from([Buffer.from(body)]) } };
}

beforeEach(() => { vi.clearAllMocks(); wire.handle.mockReset(); });

describe("canvas versioning capability with real SDK deserialization", () => {
  it.each(invalidEnvelopes)("fails closed on HTTP 200 with %s", async (_name, body) => {
    wire.handle.mockImplementation(async () => response(body));
    const adapter = createCanvasStorageAdapter(environment);
    try {
      await expect(verifyCanvasStorageCapability(adapter)).rejects.toMatchObject({ code: "CANVAS_STORAGE_CAPABILITY_INVALID" });
      expect(wire.handle).toHaveBeenCalledOnce();
      expect(wire.handle.mock.calls[0][0]).toMatchObject({ method: "GET", hostname: "127.0.0.1", query: { versioning: "" } });
    } finally { adapter.close?.(); }
    expect(wire.destroy).toHaveBeenCalledOnce();
  });

  it.each(validEnvelopes)("accepts a genuine successful empty envelope: %s", async (_name, body) => {
    wire.handle.mockImplementation(async () => response(body));
    const adapter = createCanvasStorageAdapter(environment);
    try {
      await expect(verifyCanvasStorageCapability(adapter)).resolves.toBeUndefined();
      expect(wire.options).toHaveBeenCalledWith(expect.objectContaining({ maxAttempts: 1, forcePathStyle: true }));
      expect(wire.handle).toHaveBeenCalledOnce();
    } finally { adapter.close?.(); }
    expect(wire.destroy).toHaveBeenCalledOnce();
  });

  it.each([201, 204, 301, 403, 404, 500, 501])("rejects HTTP %i even with the correct envelope, without retrying or issuing PUT", async (status) => {
    wire.handle.mockImplementation(async () => response(unversioned, status));
    const adapter = createCanvasStorageAdapter(environment);
    try {
      await expect(verifyCanvasStorageCapability(adapter)).rejects.toMatchObject({ code: "CANVAS_STORAGE_CAPABILITY_INVALID" });
      expect(wire.handle).toHaveBeenCalledOnce();
      expect(wire.handle.mock.calls[0][0].method).toBe("GET");
    } finally { adapter.close?.(); }
  });

  it("does not reuse an earlier probe's verified receipt", async () => {
    wire.handle.mockImplementationOnce(async () => response(unversioned)).mockImplementationOnce(async () => response("<html/>"));
    const adapter = createCanvasStorageAdapter(environment);
    try {
      await expect(adapter.getBucketVersioning(new AbortController().signal)).resolves.toEqual({ locationId: adapter.location.id, verified: true, status: undefined });
      await expect(adapter.getBucketVersioning(new AbortController().signal)).rejects.toMatchObject({ code: "CANVAS_STORAGE_CAPABILITY_INVALID" });
      expect(wire.handle).toHaveBeenCalledTimes(2);
    } finally { adapter.close?.(); }
  });

  it("checks location mismatch before any SDK request", async () => {
    const adapter = createCanvasStorageAdapter(environment);
    try {
      await expect(verifyCanvasStorageCapability(adapter, { ...adapter.location, bucket: "changed-bucket" })).rejects.toMatchObject({ code: "CANVAS_STORAGE_CAPABILITY_INVALID" });
      expect(wire.handle).not.toHaveBeenCalled();
    } finally { adapter.close?.(); }
    expect(wire.destroy).toHaveBeenCalledOnce();
  });

  it("handles chunk boundaries through BOM, UTF-8 comments and XML tokens", async () => {
    const bytes = Buffer.from(`\ufeff<?xml version="1.0" encoding="UTF-8"?><!--\u4e2d\u6587-->${unversioned}`);
    const body = Readable.from(Array.from(bytes, (byte) => Buffer.from([byte])));
    wire.handle.mockResolvedValue(response(body));
    const adapter = createCanvasStorageAdapter(environment);
    try {
      await expect(verifyCanvasStorageCapability(adapter)).resolves.toBeUndefined();
      expect(body.destroyed).toBe(true);
    } finally { adapter.close?.(); }
  });

  it.each([200, 403, 500])("stops an oversized HTTP %i stream before EOF, regardless of Content-Length", async (status) => {
    const body = new PassThrough();
    body.write(unversioned + " ".repeat(bodyLimit));
    const result = response(body, status);
    wire.handle.mockResolvedValue({ response: { ...result.response, headers: { ...result.response.headers, "content-length": "1" } } });
    const adapter = createCanvasStorageAdapter(environment);
    try {
      await expect(verifyCanvasStorageCapability(adapter, adapter.location, 1000)).rejects.toMatchObject({ code: "CANVAS_STORAGE_CAPABILITY_INVALID" });
      expect(wire.handle).toHaveBeenCalledOnce();
      expect(wire.handle.mock.calls[0][1].abortSignal.aborted).toBe(false);
      expect(body.destroyed).toBe(true);
    } finally { body.destroy(); adapter.close?.(); }
  });

  it("aborts and destroys a body stalled after a valid prefix instead of accepting the prefix", async () => {
    const body = new PassThrough();
    body.write(unversioned);
    wire.handle.mockResolvedValue(response(body));
    const adapter = createCanvasStorageAdapter(environment);
    try {
      await expect(verifyCanvasStorageCapability(adapter, adapter.location, 100)).rejects.toMatchObject({ code: "CANVAS_STORAGE_CAPABILITY_INVALID" });
      expect(wire.handle).toHaveBeenCalledOnce();
      expect(wire.handle.mock.calls[0][1].abortSignal.aborted).toBe(true);
      expect(body.destroyed).toBe(true);
    } finally { body.destroy(); adapter.close?.(); }
    expect(wire.destroy).toHaveBeenCalledOnce();
  });

  it("does not accept a valid prefix followed by a stream error", async () => {
    const body = Readable.from((async function* () {
      yield Buffer.from(unversioned);
      throw new Error("private provider stream error");
    })());
    wire.handle.mockResolvedValue(response(body));
    const adapter = createCanvasStorageAdapter(environment);
    try {
      await expect(verifyCanvasStorageCapability(adapter)).rejects.toMatchObject({ code: "CANVAS_STORAGE_CAPABILITY_INVALID" });
      expect(body.destroyed).toBe(true);
      expect(wire.handle).toHaveBeenCalledOnce();
    } finally { adapter.close?.(); }
  });

  it.each(["", "<html/>"])("demonstrates why bare SDK metadata and absent Status are insufficient: %j", async (body) => {
    wire.handle.mockImplementation(async () => response(body));
    const client = new S3Client({
      endpoint: environment.S3_ENDPOINT, region: environment.S3_REGION, forcePathStyle: true, maxAttempts: 1,
      credentials: { accessKeyId: environment.S3_ACCESS_KEY_ID, secretAccessKey: environment.S3_SECRET_ACCESS_KEY },
    });
    try {
      const result = await client.send(new GetBucketVersioningCommand({ Bucket: environment.S3_BUCKET }));
      expect(result.$metadata.httpStatusCode).toBe(200);
      expect(result.Status).toBeUndefined();
    } finally { client.destroy(); }
  });
});
