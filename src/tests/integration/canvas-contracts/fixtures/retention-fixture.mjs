import { strict as assert } from "node:assert";
import { randomBytes, randomUUID } from "node:crypto";

/**
 * Shared test setup only. Caller must verify its disposable DB sentinel before SQL.
 * @param {{ownerId:string,locationId:string,key:string,byteLength:number,mimeType:string,sha256:string,publicUrlOrigin:string,leaseMilliseconds?:number,transaction?:boolean,legacy?:{jobId:string,imageId:string}|null,deferBinding?:boolean}} options
 */
export function createRetentionFixture({ ownerId, locationId, key, byteLength, mimeType, sha256, publicUrlOrigin, leaseMilliseconds = 5000, transaction = true, legacy = null, deferBinding = false }) {
  assert.equal(typeof ownerId, "string");
  assert.equal(typeof locationId, "string");
  assert.match(key, /^[A-Za-z0-9][A-Za-z0-9._/-]*$/);
  assert(Number.isInteger(byteLength) && byteLength > 0 && byteLength <= 52428800);
  assert(Number.isInteger(leaseMilliseconds) && leaseMilliseconds >= 100 && leaseMilliseconds <= 10000);
  assert.match(sha256, /^[0-9a-f]{64}$/);
  assert(["image/png", "image/jpeg", "image/webp", "image/gif", "image/avif"].includes(mimeType));
  const origin = new URL(publicUrlOrigin);
  assert(["http:", "https:"].includes(origin.protocol) && !origin.username && !origin.password);
  const ids = { assetId: randomUUID(), objectId: randomUUID(), jobId: randomUUID(), imageId: randomUUID(), reservationId: randomUUID(), writeToken: randomUUID() };
  if (legacy) {
    assert.equal(typeof legacy.jobId, "string"); assert.equal(typeof legacy.imageId, "string");
    ids.jobId = legacy.jobId; ids.imageId = legacy.imageId;
  }
  const publicToken = randomBytes(32).toString("hex");
  const url = `${origin.origin}/media/images/${publicToken}`;
  const quote = (value) => `'${String(value).replaceAll("'", "''")}'`;
  const bindingSql = legacy
    ? `UPDATE "GenerationImage" SET url=${quote(url)},"mediaStorage"='LOCAL',"storageKey"=${quote(key)},"mediaAssetId"=${quote(ids.assetId)}::uuid WHERE id=${quote(ids.imageId)} AND "jobId"=${quote(ids.jobId)} AND "mediaAssetId" IS NULL;`
    : `INSERT INTO "GenerationImage" (id,"jobId",url,"mediaStorage","storageKey","mediaAssetId","createdAt") VALUES (${quote(ids.imageId)},${quote(ids.jobId)},${quote(url)},'LOCAL',${quote(key)},${quote(ids.assetId)}::uuid,clock_timestamp()-interval '40 days');`;
  const sql = `
${transaction ? "BEGIN;" : ""}
DO $$ BEGIN PERFORM image_lock_quota(); END $$;
${legacy ? "" : `INSERT INTO "GenerationJob" (id,"userId","providerMode",model,prompt,size,count,status,"createdAt","updatedAt","completedAt") VALUES (${quote(ids.jobId)},${quote(ownerId)},'BUILT_IN','gpt-image-2','历史图片清理验证','auto',1,'SUCCEEDED',clock_timestamp()-interval '40 days',clock_timestamp(),clock_timestamp()-interval '40 days');`}
INSERT INTO "ImageWriteReservation" (id,token,"ownerId","intentKey",kind,"slotBytes","remainingBytes","leaseExpiresAt")
 VALUES (${quote(ids.reservationId)},${quote(ids.writeToken)},${quote(ownerId)},${quote(`fixture:${ids.reservationId}`)},'INPUT',ARRAY[${byteLength}]::bigint[],${byteLength},clock_timestamp()+interval '${leaseMilliseconds} milliseconds');
INSERT INTO "ImageAsset" (id,"ownerId",purpose,"originId","publicToken","byteLength","mimeType",sha256,"createdAt")
 VALUES (${quote(ids.assetId)},${quote(ownerId)},'GENERATED',${quote(ids.imageId)},${quote(publicToken)},${byteLength},${quote(mimeType)},${quote(sha256)},clock_timestamp()-interval '40 days');
UPDATE "ImageWriteReservation" SET "remainingBytes"=0 WHERE id=${quote(ids.reservationId)}::uuid;
INSERT INTO "ImageObject" (id,"assetId","reservationId",slot,"locationId","physicalNamespace",key,"byteLength","mimeType",sha256,"writeToken","writeExpiresAt")
 SELECT ${quote(ids.objectId)}::uuid,${quote(ids.assetId)}::uuid,r.id,0,l.id,l."physicalNamespace",${quote(key)},${byteLength},${quote(mimeType)},${quote(sha256)},r.token,r."leaseExpiresAt"
 FROM "ImageWriteReservation" r CROSS JOIN "ImageStorageLocation" l WHERE r.id=${quote(ids.reservationId)}::uuid AND l.id=${quote(locationId)};
DO $$ BEGIN
 IF NOT (image_finish_object(${quote(JSON.stringify({ objectId: ids.objectId, writeToken: ids.writeToken, outcome: "CONFIRMED" }))}::jsonb)->>'accepted')::boolean THEN RAISE EXCEPTION 'fixture image write was not confirmed'; END IF;
 PERFORM image_close_reservation(${quote(JSON.stringify({ reservationId: ids.reservationId, token: ids.writeToken }))}::jsonb);
END $$;
${deferBinding ? "" : bindingSql}
DO $$ BEGIN PERFORM image_register_alias(${quote(JSON.stringify({ assetId: ids.assetId, url }))}::jsonb); END $$;
${transaction ? "COMMIT;" : ""}
`;
  return { ...ids, publicToken, url, sql, bindingSql };
}
