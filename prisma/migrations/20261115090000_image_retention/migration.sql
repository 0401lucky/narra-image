-- Image-only maintenance. Existing policy stays disabled until an administrator
-- explicitly enables it; inventory/accounting and permanent roots remain intact.
CREATE TABLE "ImageMaintenanceJob" (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "requesterId" VARCHAR(128) NOT NULL, "requestKey" VARCHAR(256) NOT NULL UNIQUE,
  intent JSONB NOT NULL CHECK (jsonb_typeof(intent) = 'object'),
  mode VARCHAR(24) NOT NULL CHECK (mode IN ('MANUAL_AGE','MANUAL_ALL','SCHEDULE','QUOTA','SOURCE_RETIREMENT')),
  state VARCHAR(16) NOT NULL DEFAULT 'PREVIEW' CHECK (state IN ('PREVIEW','QUEUED','RUNNING','WAITING','SUCCEEDED','PARTIAL','CANCELLED','EXPIRED')),
  "policyVersion" INTEGER NOT NULL CHECK ("policyVersion" > 0), "ageCutoff" TIMESTAMPTZ(3),
  "neededBytes" BIGINT NOT NULL DEFAULT 0 CHECK ("neededBytes" >= 0),
  "reclaimTargetBytes" BIGINT NOT NULL DEFAULT 0 CHECK ("reclaimTargetBytes" >= 0),
  "previewExpiresAt" TIMESTAMPTZ(3), "confirmedRequestId" UUID UNIQUE, "confirmedAt" TIMESTAMPTZ(3),
  "nextAttemptAt" TIMESTAMPTZ(3), "completedAt" TIMESTAMPTZ(3),
  "cancelRequested" BOOLEAN NOT NULL DEFAULT false, truncated BOOLEAN NOT NULL DEFAULT false,
  "verificationId" UUID,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT clock_timestamp(),
  "updatedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX "ImageMaintenanceJob_queue_idx" ON "ImageMaintenanceJob" (state,"nextAttemptAt","createdAt",id);

CREATE TABLE "ImageMaintenanceItem" (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "jobId" UUID NOT NULL REFERENCES "ImageMaintenanceJob"(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  "assetId" UUID NOT NULL REFERENCES "ImageAsset"(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  "objectId" UUID NOT NULL REFERENCES "ImageObject"(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  "byteLength" BIGINT NOT NULL CHECK ("byteLength" BETWEEN 1 AND 52428800),
  "assetCreatedAt" TIMESTAMPTZ(3) NOT NULL, "expectedActiveObjectId" UUID,
  manifest CHAR(64) NOT NULL CHECK (manifest ~ '^[0-9a-f]{64}$'),
  state VARCHAR(16) NOT NULL DEFAULT 'CANDIDATE' CHECK (state IN ('CANDIDATE','CLAIMED','RETRY','DONE','SKIPPED')),
  reason VARCHAR(64), "releasedBytes" BIGINT NOT NULL DEFAULT 0 CHECK ("releasedBytes" >= 0 AND "releasedBytes" <= "byteLength"),
  "completedAt" TIMESTAMPTZ(3),
  CONSTRAINT "ImageMaintenanceItem_job_object_key" UNIQUE ("jobId","objectId")
);
CREATE INDEX "ImageMaintenanceItem_pending_idx" ON "ImageMaintenanceItem" ("jobId",state,"assetCreatedAt","assetId",id);

CREATE TABLE "ImageMaintenanceLease" (
  scope VARCHAR(16) PRIMARY KEY DEFAULT 'images' CHECK (scope = 'images'),
  "workerId" VARCHAR(128), token UUID, "expiresAt" TIMESTAMPTZ(3)
);
INSERT INTO "ImageMaintenanceLease" (scope) VALUES ('images');

CREATE TABLE "ImageReplicaVerification" (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "assetId" UUID NOT NULL REFERENCES "ImageAsset"(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  "sourceObjectId" UUID NOT NULL REFERENCES "ImageObject"(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  "targetObjectId" UUID NOT NULL REFERENCES "ImageObject"(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  "byteLength" BIGINT NOT NULL CHECK ("byteLength" BETWEEN 1 AND 52428800),
  sha256 CHAR(64) NOT NULL CHECK (sha256 ~ '^[0-9a-f]{64}$'),
  "aliasUrls" TEXT[] NOT NULL, "aliasManifest" CHAR(64) NOT NULL,
  "readerProtocolRevision" INTEGER NOT NULL CHECK ("readerProtocolRevision" = 2),
  revoked BOOLEAN NOT NULL DEFAULT false,
  "verifiedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT clock_timestamp(),
  CHECK ("sourceObjectId" <> "targetObjectId")
);
ALTER TABLE "ImageMaintenanceJob" ADD CONSTRAINT "ImageMaintenanceJob_verificationId_fkey"
  FOREIGN KEY ("verificationId") REFERENCES "ImageReplicaVerification"(id) ON DELETE RESTRICT ON UPDATE RESTRICT;

-- The immutable business identity lets permanent Canvas run snapshots still
-- resolve a generated image after the original user/job/image was cascaded away.
CREATE TABLE "ImageGenerationBinding" (
  "assetId" UUID PRIMARY KEY REFERENCES "ImageAsset"(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  "imageId" VARCHAR(128) NOT NULL UNIQUE, "jobId" VARCHAR(128) NOT NULL, "ownerId" VARCHAR(128) NOT NULL,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT clock_timestamp()
);

ALTER TABLE "ImageAsset" ADD COLUMN "deleteJobId" UUID REFERENCES "ImageMaintenanceJob"(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  ADD COLUMN "copyReservationId" UUID REFERENCES "ImageWriteReservation"(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  ADD COLUMN "copyProtectedUntil" TIMESTAMPTZ(3);
ALTER TABLE "ImageObject" ADD COLUMN "deleteItemId" UUID REFERENCES "ImageMaintenanceItem"(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  ADD COLUMN "readProtectedUntil" TIMESTAMPTZ(3);

CREATE OR REPLACE FUNCTION image_raise(p_code TEXT) RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  IF p_code NOT IN ('IMAGE_INVALID_INPUT','IMAGE_QUOTA_EXCEEDED','IMAGE_RESERVATION_CONFLICT','IMAGE_RESERVATION_EXPIRED','IMAGE_WRITE_CONFLICT','IMAGE_UNAVAILABLE','IMAGE_LOCATION_CONFLICT','IMAGE_REFERENCE_CONFLICT','IMAGE_STORAGE_UNAVAILABLE','IMAGE_INTERNAL_ERROR','IMAGE_POLICY_CONFLICT','IMAGE_PREVIEW_EXPIRED','IMAGE_MAINTENANCE_CONFLICT','IMAGE_POLICY_DISABLED') THEN p_code := 'IMAGE_INTERNAL_ERROR'; END IF;
  RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = p_code, CONSTRAINT = p_code;
END;
$$;
CREATE FUNCTION image_management_integer(p_value TEXT, p_min INTEGER, p_max INTEGER) RETURNS INTEGER LANGUAGE plpgsql IMMUTABLE AS $$
BEGIN
  IF p_value IS NULL OR length(p_value) > 10 OR p_value !~ '^(0|[1-9][0-9]*)$' OR p_value::numeric NOT BETWEEN p_min AND p_max THEN PERFORM image_raise('IMAGE_INVALID_INPUT'); END IF;
  RETURN p_value::integer;
END;
$$;
CREATE FUNCTION image_management_bytes(p_value TEXT) RETURNS BIGINT LANGUAGE plpgsql IMMUTABLE AS $$
BEGIN
  IF p_value IS NULL OR length(p_value) > 16 OR p_value !~ '^(0|[1-9][0-9]*)$' OR p_value::numeric > 9007199254740991 THEN PERFORM image_raise('IMAGE_INVALID_INPUT'); END IF;
  RETURN p_value::bigint;
END;
$$;

-- Internal maintenance/fencing fields are not added to the stable read DTO.
CREATE OR REPLACE FUNCTION image_asset_json(p_row "ImageAsset") RETURNS JSONB LANGUAGE SQL STABLE AS $$
  SELECT (to_jsonb(p_row) - ARRAY['deleteJobId','copyReservationId','copyProtectedUntil']) || jsonb_build_object('byteLength',p_row."byteLength"::text)
$$;
CREATE OR REPLACE FUNCTION image_object_json(p_row "ImageObject") RETURNS JSONB LANGUAGE SQL STABLE AS $$
  SELECT (to_jsonb(p_row) - ARRAY['deleteItemId','readProtectedUntil']) || jsonb_build_object('byteLength',p_row."byteLength"::text)
$$;

CREATE FUNCTION image_has_historical_reference(p_asset UUID) RETURNS BOOLEAN LANGUAGE SQL STABLE AS $$
  SELECT EXISTS (SELECT 1 FROM "ImageReference" WHERE "assetId" = p_asset)
    OR EXISTS (SELECT 1 FROM "ImageGenerationBinding" b JOIN "Canvas" c ON c."ownerId" = b."ownerId" AND c."deletedAt" IS NULL
      CROSS JOIN LATERAL jsonb_array_elements(c.scene->'nodes') n
      WHERE b."assetId" = p_asset AND n->>'kind' = 'result' AND n->>'imageId' = b."imageId" AND n->>'jobId' = b."jobId")
    OR EXISTS (SELECT 1 FROM "ImageGenerationBinding" b JOIN "CanvasRun" r ON r."ownerId" = b."ownerId" AND r.state = 'COMMITTED'
      CROSS JOIN LATERAL jsonb_array_elements(r."inputSnapshot"->'input'->'references') n
      WHERE b."assetId" = p_asset AND n->>'kind' = 'result' AND n->>'imageId' = b."imageId" AND n->>'jobId' = b."jobId")
    OR EXISTS (SELECT 1 FROM "ImageUrlAlias" a JOIN "GenerationJob" j ON a.url = ANY(j."sourceImageUrls") WHERE a."assetId" = p_asset)
    OR EXISTS (SELECT 1 FROM "GenerationImage" WHERE "mediaAssetId" = p_asset AND "showcaseStatus"::text IN ('FEATURED','PENDING','TAKEDOWN_PENDING'))
    OR EXISTS (SELECT 1 FROM "ImageUrlAlias" a JOIN "LoginCoverConfig" c ON c.mode = 'custom' AND c."customUrl" = a.url WHERE a."assetId" = p_asset)
$$;

CREATE FUNCTION image_bridge_known_history(p_asset UUID) RETURNS VOID LANGUAGE plpgsql AS $$
DECLARE v_asset "ImageAsset"; v_binding "ImageGenerationBinding"; v_row RECORD;
BEGIN
  SELECT * INTO v_asset FROM "ImageAsset" WHERE id = p_asset FOR UPDATE;
  IF v_asset.id IS NULL OR v_asset.state <> 'AVAILABLE' THEN RETURN; END IF;
  SELECT * INTO v_binding FROM "ImageGenerationBinding" WHERE "assetId" = p_asset;
  IF FOUND THEN
    FOR v_row IN SELECT DISTINCT c.id,c."ownerId" FROM "Canvas" c
      CROSS JOIN LATERAL jsonb_array_elements(c.scene->'nodes') n
      WHERE c."deletedAt" IS NULL AND c."ownerId" = v_binding."ownerId" AND n->>'kind' = 'result'
        AND n->>'imageId' = v_binding."imageId" AND n->>'jobId' = v_binding."jobId" LOOP
      INSERT INTO "ImageReference" ("assetId","ownerId",kind,"referenceKey",permanent)
        VALUES (p_asset,v_row."ownerId",'CANVAS_SAVED','canvas:' || v_row.id::text,false) ON CONFLICT DO NOTHING;
    END LOOP;
    FOR v_row IN SELECT DISTINCT r.id,r."ownerId" FROM "CanvasRun" r
      CROSS JOIN LATERAL jsonb_array_elements(r."inputSnapshot"->'input'->'references') n
      WHERE r.state = 'COMMITTED' AND r."ownerId" = v_binding."ownerId" AND n->>'kind' = 'result'
        AND n->>'imageId' = v_binding."imageId" AND n->>'jobId' = v_binding."jobId" LOOP
      INSERT INTO "ImageReference" ("assetId","ownerId",kind,"referenceKey",permanent)
        VALUES (p_asset,v_row."ownerId",'JOB_INPUT','canvas-run:' || v_row.id,true) ON CONFLICT DO NOTHING;
    END LOOP;
  END IF;
  FOR v_row IN SELECT DISTINCT j.id,j."userId" FROM "GenerationJob" j JOIN "ImageUrlAlias" a ON a.url = ANY(j."sourceImageUrls") WHERE a."assetId" = p_asset LOOP
    INSERT INTO "ImageReference" ("assetId","ownerId",kind,"referenceKey",permanent)
      VALUES (p_asset,v_row."userId",'JOB_INPUT','job:' || v_row.id,true) ON CONFLICT DO NOTHING;
  END LOOP;
  FOR v_row IN SELECT scope FROM "LoginCoverConfig" c JOIN "ImageUrlAlias" a ON a.url = c."customUrl" WHERE c.mode = 'custom' AND a."assetId" = p_asset LOOP
    INSERT INTO "ImageReference" ("assetId","ownerId",kind,"referenceKey",permanent)
      VALUES (p_asset,'site','SITE_COVER','login-cover:' || v_row.scope,false) ON CONFLICT DO NOTHING;
  END LOOP;
END;
$$;
CREATE FUNCTION image_bridge_generation_history() RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE v_owner TEXT; v_url TEXT;
BEGIN
  IF NEW."mediaAssetId" IS NULL THEN RETURN NULL; END IF;
  SELECT "userId" INTO v_owner FROM "GenerationJob" WHERE id = NEW."jobId";
  INSERT INTO "ImageGenerationBinding" ("assetId","imageId","jobId","ownerId")
    VALUES (NEW."mediaAssetId",NEW.id,NEW."jobId",v_owner) ON CONFLICT ("assetId") DO NOTHING;
  IF NOT EXISTS (SELECT 1 FROM "ImageGenerationBinding" WHERE "assetId" = NEW."mediaAssetId" AND "imageId" = NEW.id AND "jobId" = NEW."jobId" AND "ownerId" = v_owner) THEN PERFORM image_raise('IMAGE_WRITE_CONFLICT'); END IF;
  -- An actual backfill copy proves the precise previous URL's bytes. Capture
  -- that alias in the same binding transaction before exposing cleanup.
  FOR v_url IN SELECT DISTINCT url FROM unnest(ARRAY[NEW.url,CASE WHEN TG_OP = 'UPDATE' THEN OLD.url ELSE NULL END]) AS url
    WHERE url ~ '^https?://' AND octet_length(url) <= 2048 AND url !~ '^https?://[^/]*@' LOOP
    PERFORM image_register_alias(jsonb_build_object('assetId',NEW."mediaAssetId",'url',v_url));
  END LOOP;
  PERFORM image_bridge_known_history(NEW."mediaAssetId");
  RETURN NULL;
END;
$$;
CREATE TRIGGER "GenerationImage_image_history" AFTER INSERT OR UPDATE OF "mediaAssetId" ON "GenerationImage" FOR EACH ROW EXECUTE FUNCTION image_bridge_generation_history();
CREATE FUNCTION image_bridge_alias_history() RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  PERFORM image_bridge_known_history(NEW."assetId"); RETURN NULL;
END;
$$;
CREATE TRIGGER "ImageUrlAlias_history" AFTER INSERT ON "ImageUrlAlias" FOR EACH ROW EXECUTE FUNCTION image_bridge_alias_history();
CREATE FUNCTION image_guard_generation_history() RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  PERFORM image_raise('IMAGE_WRITE_CONFLICT'); RETURN NULL;
END;
$$;
CREATE TRIGGER "ImageGenerationBinding_immutable" BEFORE UPDATE OR DELETE ON "ImageGenerationBinding" FOR EACH ROW EXECUTE FUNCTION image_guard_generation_history();

INSERT INTO "ImageGenerationBinding" ("assetId","imageId","jobId","ownerId")
  SELECT i."mediaAssetId",i.id,i."jobId",j."userId" FROM "GenerationImage" i JOIN "GenerationJob" j ON j.id = i."jobId" WHERE i."mediaAssetId" IS NOT NULL;
DO $$ DECLARE v_id UUID; BEGIN
  FOR v_id IN SELECT id FROM "ImageAsset" WHERE state = 'AVAILABLE' ORDER BY id LOOP PERFORM image_bridge_known_history(v_id); END LOOP;
END $$;

CREATE FUNCTION image_cleanup_reason(p_asset UUID) RETURNS TEXT LANGUAGE plpgsql STABLE AS $$
DECLARE a "ImageAsset"; c "CanvasImportAsset"; v_now TIMESTAMPTZ := clock_timestamp();
BEGIN
  SELECT * INTO a FROM "ImageAsset" WHERE id = p_asset;
  IF a.id IS NULL OR a.state NOT IN ('AVAILABLE','QUARANTINED') THEN RETURN 'UNAVAILABLE'; END IF;
  IF image_has_historical_reference(a.id) THEN RETURN 'REFERENCED'; END IF;
  IF a."copyProtectedUntil" > v_now THEN RETURN 'COPYING'; END IF;
  IF NOT EXISTS (SELECT 1 FROM "ImageObject" WHERE "assetId" = a.id AND accounted) THEN RETURN 'NO_OBJECTS'; END IF;
  IF EXISTS (SELECT 1 FROM "ImageObject" WHERE "assetId" = a.id AND accounted AND ("putOutcome" <> 'CONFIRMED' OR "needsReconciliation" OR state = 'UNKNOWN')) THEN RETURN 'UNKNOWN_PUT'; END IF;
  IF EXISTS (SELECT 1 FROM "ImageObject" WHERE "assetId" = a.id AND accounted AND "versionId" IS NOT NULL) THEN RETURN 'VERSIONED'; END IF;
  IF EXISTS (SELECT 1 FROM "ImageObject" o JOIN "ImageWriteReservation" r ON r.id = o."reservationId" WHERE o."assetId" = a.id AND o.accounted AND (o.state <> 'READY' OR o."writeExpiresAt" > v_now OR r.state <> 'CLOSED')) THEN RETURN 'ACTIVE_WRITE'; END IF;
  IF EXISTS (SELECT 1 FROM "ImageObject" WHERE "assetId" = a.id AND accounted AND "readProtectedUntil" > v_now) THEN RETURN 'READING'; END IF;
  IF EXISTS (SELECT 1 FROM "ImageGenerationBinding" b JOIN "GenerationJob" j ON j.id = b."jobId" WHERE b."assetId" = a.id AND j.status::text IN ('PENDING','PROCESSING'))
    OR EXISTS (SELECT 1 FROM "ImageObject" o JOIN "ImageWriteReservation" r ON r.id = o."reservationId" JOIN "GenerationJob" j ON j.id = r."outputJobId" WHERE o."assetId" = a.id AND j.status::text IN ('PENDING','PROCESSING')) THEN RETURN 'ACTIVE_JOB'; END IF;
  IF a.purpose = 'CANVAS_IMPORT' THEN
    SELECT * INTO c FROM "CanvasImportAsset" WHERE "mediaAssetId" = a.id;
    IF c.id IS NULL OR c.state NOT IN ('READY','QUARANTINED') OR c."putOutcome" <> 'CONFIRMED' OR c."needsReconciliation" OR c."storageVersionId" IS NOT NULL THEN RETURN 'CANVAS_UNVERIFIED'; END IF;
    IF EXISTS (SELECT 1 FROM "CanvasSavedAssetUse" WHERE "assetId" = c.id) OR EXISTS (SELECT 1 FROM "CanvasJobAssetUse" WHERE "assetId" = c.id) THEN RETURN 'REFERENCED'; END IF;
    IF c."detachedAt" IS NULL OR a."detachedAt" IS NULL OR GREATEST(c."detachedAt",a."detachedAt") + interval '604800 seconds' > v_now
      OR c."uploadExpiresAt" > v_now OR c."preparationExpiresAt" > v_now THEN RETURN 'CANVAS_GRACE'; END IF;
  END IF;
  RETURN NULL;
END;
$$;
CREATE FUNCTION image_asset_manifest(p_asset UUID) RETURNS TEXT LANGUAGE SQL STABLE AS $$
  SELECT encode(sha256(convert_to(COALESCE(jsonb_agg(jsonb_build_array(id,"locationId",key,"byteLength",sha256,accounted) ORDER BY id),'[]'::jsonb)::text,'UTF8')),'hex') FROM "ImageObject" WHERE "assetId" = p_asset
$$;
CREATE FUNCTION image_alias_manifest(p_asset UUID) RETURNS TEXT LANGUAGE SQL STABLE AS $$
  SELECT encode(sha256(convert_to(COALESCE(jsonb_agg(url ORDER BY url),'[]'::jsonb)::text,'UTF8')),'hex') FROM "ImageUrlAlias" WHERE "assetId" = p_asset
$$;

CREATE FUNCTION image_maintenance_job_json(p_job UUID, p_cursor UUID DEFAULT NULL, p_limit INTEGER DEFAULT 0) RETURNS JSONB LANGUAGE SQL STABLE AS $$
  SELECT jsonb_build_object('id',j.id,'mode',j.mode,'state',j.state,'policyVersion',j."policyVersion",'createdAt',j."createdAt",'confirmedAt',j."confirmedAt",
    'expiresAt',j."previewExpiresAt",'completedAt',j."completedAt",'nextAttemptAt',j."nextAttemptAt",'truncated',j.truncated,
    'estimatedBytes',COALESCE(sum(i."byteLength"),0)::text,'releasedBytes',COALESCE(sum(i."releasedBytes"),0)::text,
    'totalItems',count(i.id),'completedItems',count(i.id) FILTER (WHERE i.state = 'DONE'),'skippedItems',count(i.id) FILTER (WHERE i.state = 'SKIPPED'),
    'failedItems',count(i.id) FILTER (WHERE i.state = 'RETRY'),'pendingItems',count(i.id) FILTER (WHERE i.state IN ('CANDIDATE','CLAIMED','RETRY')),
    'items',COALESCE((SELECT jsonb_agg(jsonb_build_object('id',x.id,'assetId',x."assetId",'state',x.state,'byteLength',x."byteLength"::text,'releasedBytes',x."releasedBytes"::text,'reason',x.reason) ORDER BY x.id)
      FROM (SELECT * FROM "ImageMaintenanceItem" WHERE "jobId" = p_job AND (p_cursor IS NULL OR id > p_cursor) ORDER BY id LIMIT p_limit) x),'[]'::jsonb),
    'nextCursor',CASE WHEN p_limit > 0 AND (SELECT count(*) FROM "ImageMaintenanceItem" WHERE "jobId" = p_job AND (p_cursor IS NULL OR id > p_cursor)) > p_limit
      THEN (SELECT id FROM "ImageMaintenanceItem" WHERE "jobId" = p_job AND (p_cursor IS NULL OR id > p_cursor) ORDER BY id OFFSET GREATEST(0,p_limit-1) LIMIT 1) ELSE NULL END)
  FROM "ImageMaintenanceJob" j LEFT JOIN "ImageMaintenanceItem" i ON i."jobId" = j.id WHERE j.id = p_job GROUP BY j.id
$$;
CREATE FUNCTION image_preview_json(p_job UUID) RETURNS JSONB LANGUAGE SQL STABLE AS $$
  SELECT jsonb_build_object('previewId',j.id,'policyVersion',j."policyVersion",'expiresAt',j."previewExpiresAt",'truncated',j.truncated,
    'assetCount',count(DISTINCT i."assetId"),'objectCount',count(i.id),'estimatedBytes',COALESCE(sum(i."byteLength"),0)::text)
  FROM "ImageMaintenanceJob" j LEFT JOIN "ImageMaintenanceItem" i ON i."jobId" = j.id WHERE j.id = p_job GROUP BY j.id
$$;
CREATE FUNCTION image_snapshot_cleanup(p_job UUID) RETURNS VOID LANGUAGE plpgsql AS $$
DECLARE j "ImageMaintenanceJob"; a "ImageAsset"; v_count INTEGER := 0;
BEGIN
  SELECT * INTO j FROM "ImageMaintenanceJob" WHERE id = p_job;
  FOR a IN SELECT * FROM "ImageAsset" WHERE (j."ageCutoff" IS NULL OR "createdAt" <= j."ageCutoff") AND image_cleanup_reason(id) IS NULL ORDER BY "createdAt",id LIMIT 1001 LOOP
    v_count := v_count + 1;
    IF v_count > 1000 THEN UPDATE "ImageMaintenanceJob" SET truncated = true WHERE id = p_job; EXIT; END IF;
    INSERT INTO "ImageMaintenanceItem" ("jobId","assetId","objectId","byteLength","assetCreatedAt","expectedActiveObjectId",manifest)
      SELECT p_job,a.id,o.id,o."byteLength",a."createdAt",a."activeObjectId",image_asset_manifest(a.id) FROM "ImageObject" o WHERE o."assetId" = a.id AND o.accounted ORDER BY o.id;
  END LOOP;
END;
$$;
CREATE FUNCTION image_refresh_maintenance_job(p_job UUID) RETURNS VOID LANGUAGE plpgsql AS $$
DECLARE j "ImageMaintenanceJob"; v_pending INTEGER; v_retry INTEGER; v_skipped INTEGER; v_claimed INTEGER; v_next TIMESTAMPTZ;
BEGIN
  SELECT * INTO j FROM "ImageMaintenanceJob" WHERE id = p_job FOR UPDATE;
  IF j.state IN ('PREVIEW','EXPIRED') THEN RETURN; END IF;
  SELECT count(*) FILTER (WHERE i.state IN ('CANDIDATE','CLAIMED','RETRY')),count(*) FILTER (WHERE i.state = 'RETRY'),count(*) FILTER (WHERE i.state = 'SKIPPED' AND i.reason <> 'QUOTA_MET'),count(*) FILTER (WHERE i.state = 'CLAIMED'),
    min(CASE WHEN i.state = 'RETRY' THEN o."nextDeleteAt" WHEN i.state = 'CLAIMED' THEN o."deleteExpiresAt" END)
    INTO v_pending,v_retry,v_skipped,v_claimed,v_next FROM "ImageMaintenanceItem" i JOIN "ImageObject" o ON o.id = i."objectId" WHERE i."jobId" = p_job;
  UPDATE "ImageMaintenanceJob" SET state = CASE WHEN v_pending = 0 THEN CASE WHEN j."cancelRequested" THEN 'CANCELLED' WHEN v_skipped > 0 THEN 'PARTIAL' ELSE 'SUCCEEDED' END
      WHEN v_claimed > 0 THEN 'RUNNING' WHEN v_retry > 0 THEN 'WAITING' ELSE 'QUEUED' END,
    "completedAt" = CASE WHEN v_pending = 0 THEN COALESCE("completedAt",clock_timestamp()) ELSE NULL END,
    "nextAttemptAt" = CASE WHEN v_claimed > 0 OR v_retry > 0 THEN v_next ELSE NULL END,"updatedAt" = clock_timestamp() WHERE id = p_job;
END;
$$;

CREATE FUNCTION image_get_storage_overview() RETURNS JSONB LANGUAGE SQL STABLE AS $$
  WITH eligible AS (SELECT id FROM "ImageAsset" WHERE image_cleanup_reason(id) IS NULL), totals AS (
    SELECT COALESCE(sum(o."byteLength"),0) AS bytes,count(DISTINCT e.id) AS assets,count(o.id) AS objects FROM eligible e JOIN "ImageObject" o ON o."assetId" = e.id AND o.accounted
  ) SELECT image_get_usage() || jsonb_build_object('cleanableBytes',t.bytes::text,'cleanableAssetCount',t.assets::text,'cleanableObjectCount',t.objects::text,
    'protectedBytes',GREATEST(0,q."usedBytes"-t.bytes)::text,
    'unmanagedImageCount',((SELECT count(*) FROM "GenerationImage" i JOIN "GenerationJob" j ON j.id = i."jobId" WHERE i."mediaAssetId" IS NULL AND j."generationType"::text IN ('TEXT_TO_IMAGE','IMAGE_TO_IMAGE')) + (SELECT count(*) FROM "CanvasImportAsset" WHERE "mediaAssetId" IS NULL))::text,
    'locations',COALESCE((SELECT jsonb_agg(jsonb_build_object('id',x.id,'provider',x.provider,'objectCount',x.objects::text,'usedBytes',x.bytes::text) ORDER BY x.id) FROM
      (SELECT l.id,l.provider,count(o.id) FILTER (WHERE o.accounted) AS objects,COALESCE(sum(o."byteLength") FILTER (WHERE o.accounted),0) AS bytes FROM "ImageStorageLocation" l LEFT JOIN "ImageObject" o ON o."locationId" = l.id GROUP BY l.id) x),'[]'::jsonb),
    'recentJobs',COALESCE((SELECT jsonb_agg(image_maintenance_job_json(x.id) ORDER BY x."createdAt" DESC,x.id DESC) FROM
      (SELECT id,"createdAt" FROM "ImageMaintenanceJob" WHERE state <> 'PREVIEW' ORDER BY "createdAt" DESC,id DESC LIMIT 10) x),'[]'::jsonb))
  FROM totals t CROSS JOIN "ImageQuota" q WHERE q.scope = 'images'
$$;
CREATE FUNCTION image_update_storage_policy(p JSONB) RETURNS JSONB LANGUAGE plpgsql AS $$
DECLARE v_policy "ImageStoragePolicy"; v_limit BIGINT; v_days INTEGER; v_interval INTEGER; v_version INTEGER; v_field TEXT;
BEGIN
  v_version := image_management_integer(p->>'expectedVersion',1,2147483646); v_limit := image_management_bytes(p->>'limitBytes');
  v_days := image_management_integer(p->>'retentionDays',1,3650); v_interval := image_management_integer(p->>'intervalSeconds',60,31536000);
  IF v_limit = 0 THEN PERFORM image_raise('IMAGE_INVALID_INPUT'); END IF;
  FOREACH v_field IN ARRAY ARRAY['enabled','quotaCleanupEnabled','scheduleEnabled'] LOOP IF jsonb_typeof(p->v_field) IS DISTINCT FROM 'boolean' THEN PERFORM image_raise('IMAGE_INVALID_INPUT'); END IF; END LOOP;
  PERFORM image_lock_quota(); SELECT * INTO v_policy FROM "ImageStoragePolicy" WHERE scope = 'images' FOR UPDATE;
  IF v_policy.version <> v_version THEN PERFORM image_raise('IMAGE_POLICY_CONFLICT'); END IF;
  UPDATE "ImageStoragePolicy" SET version = version + 1,"limitBytes" = v_limit,enabled = (p->>'enabled')::boolean,"quotaCleanupEnabled" = (p->>'quotaCleanupEnabled')::boolean,
    "scheduleEnabled" = (p->>'scheduleEnabled')::boolean,"retentionDays" = v_days,"intervalSeconds" = v_interval,
    "nextRunAt" = CASE WHEN (p->>'enabled')::boolean AND (p->>'scheduleEnabled')::boolean THEN clock_timestamp() + make_interval(secs => v_interval) ELSE NULL END,
    "updatedAt" = clock_timestamp() WHERE scope = 'images' RETURNING * INTO v_policy;
  RETURN to_jsonb(v_policy) || jsonb_build_object('limitBytes',v_policy."limitBytes"::text);
END;
$$;
CREATE FUNCTION image_preview_cleanup(p JSONB) RETURNS JSONB LANGUAGE plpgsql AS $$
DECLARE v_policy "ImageStoragePolicy"; j "ImageMaintenanceJob"; v_actor TEXT; v_request UUID; v_days INTEGER; v_intent JSONB;
BEGIN
  v_actor := image_required_text(p->>'actorId',128); v_request := image_uuid(p->>'previewRequestId');
  IF p->>'mode' IS NULL OR p->>'mode' NOT IN ('MANUAL_AGE','MANUAL_ALL') THEN PERFORM image_raise('IMAGE_INVALID_INPUT'); END IF;
  PERFORM image_lock_quota(); SELECT * INTO v_policy FROM "ImageStoragePolicy" WHERE scope = 'images' FOR UPDATE;
  IF v_policy.version <> image_management_integer(p->>'expectedPolicyVersion',1,2147483646) THEN PERFORM image_raise('IMAGE_POLICY_CONFLICT'); END IF;
  v_days := image_management_integer(COALESCE(p->>'retentionDays',v_policy."retentionDays"::text),1,3650);
  v_intent := jsonb_build_object('actorId',v_actor,'mode',p->>'mode','retentionDays',CASE WHEN p->>'mode' = 'MANUAL_AGE' THEN v_days ELSE NULL END,'policyVersion',v_policy.version);
  SELECT * INTO j FROM "ImageMaintenanceJob" WHERE "requestKey" = 'preview:' || v_request::text FOR UPDATE;
  IF FOUND THEN IF j.intent <> v_intent THEN PERFORM image_raise('IMAGE_MAINTENANCE_CONFLICT'); END IF; RETURN image_preview_json(j.id); END IF;
  INSERT INTO "ImageMaintenanceJob" ("requesterId","requestKey",intent,mode,"policyVersion","ageCutoff","previewExpiresAt")
    VALUES (v_actor,'preview:' || v_request::text,v_intent,p->>'mode',v_policy.version,CASE WHEN p->>'mode' = 'MANUAL_AGE' THEN clock_timestamp() - make_interval(days => v_days) ELSE NULL END,clock_timestamp() + interval '600 seconds') RETURNING * INTO j;
  PERFORM image_snapshot_cleanup(j.id); RETURN image_preview_json(j.id);
END;
$$;
CREATE FUNCTION image_confirm_cleanup(p JSONB) RETURNS JSONB LANGUAGE plpgsql AS $$
DECLARE v_policy "ImageStoragePolicy"; j "ImageMaintenanceJob"; v_request UUID; v_id UUID; v_actor TEXT;
BEGIN
  v_request := image_uuid(p->>'requestId'); v_id := image_uuid(p->>'previewId'); v_actor := image_required_text(p->>'actorId',128);
  PERFORM image_lock_quota(); SELECT * INTO v_policy FROM "ImageStoragePolicy" WHERE scope = 'images' FOR UPDATE;
  SELECT * INTO j FROM "ImageMaintenanceJob" WHERE id = v_id FOR UPDATE;
  IF j.id IS NULL OR j."requesterId" <> v_actor OR j.mode NOT IN ('MANUAL_AGE','MANUAL_ALL') THEN PERFORM image_raise('IMAGE_MAINTENANCE_CONFLICT'); END IF;
  IF j."confirmedRequestId" IS NOT NULL THEN
    IF j."confirmedRequestId" <> v_request THEN PERFORM image_raise('IMAGE_MAINTENANCE_CONFLICT'); END IF;
    RETURN image_maintenance_job_json(j.id);
  END IF;
  IF NOT v_policy.enabled THEN PERFORM image_raise('IMAGE_POLICY_DISABLED'); END IF;
  IF j."policyVersion" <> v_policy.version OR v_policy.version <> image_management_integer(p->>'expectedPolicyVersion',1,2147483646) THEN PERFORM image_raise('IMAGE_POLICY_CONFLICT'); END IF;
  IF j.state <> 'PREVIEW' OR j."previewExpiresAt" <= clock_timestamp() THEN PERFORM image_raise('IMAGE_PREVIEW_EXPIRED'); END IF;
  UPDATE "ImageMaintenanceJob" SET state = 'QUEUED',"confirmedRequestId" = v_request,"confirmedAt" = clock_timestamp(),"updatedAt" = clock_timestamp() WHERE id = j.id;
  PERFORM image_refresh_maintenance_job(j.id); RETURN image_maintenance_job_json(j.id);
EXCEPTION WHEN unique_violation THEN PERFORM image_raise('IMAGE_MAINTENANCE_CONFLICT');
END;
$$;
CREATE FUNCTION image_get_maintenance_job(p JSONB) RETURNS JSONB LANGUAGE plpgsql STABLE AS $$
DECLARE v_id UUID; v_cursor UUID; v_limit INTEGER;
BEGIN
  v_id := image_uuid(p->>'jobId'); IF p->>'cursor' IS NOT NULL THEN v_cursor := image_uuid(p->>'cursor'); END IF;
  v_limit := image_management_integer(COALESCE(p->>'limit','20'),1,100);
  RETURN image_maintenance_job_json(v_id,v_cursor,v_limit);
END;
$$;
CREATE FUNCTION image_cancel_maintenance(p JSONB) RETURNS JSONB LANGUAGE plpgsql AS $$
DECLARE j "ImageMaintenanceJob"; v_id UUID;
BEGIN
  v_id := image_uuid(p->>'jobId'); PERFORM image_uuid(p->>'requestId'); PERFORM image_required_text(p->>'actorId',128);
  PERFORM image_lock_quota(); SELECT * INTO j FROM "ImageMaintenanceJob" WHERE id = v_id FOR UPDATE;
  IF j.id IS NULL THEN PERFORM image_raise('IMAGE_MAINTENANCE_CONFLICT'); END IF;
  IF j.state IN ('SUCCEEDED','PARTIAL','CANCELLED','EXPIRED') THEN RETURN image_maintenance_job_json(j.id); END IF;
  UPDATE "ImageMaintenanceJob" SET "cancelRequested" = true,state = CASE WHEN state = 'PREVIEW' THEN 'QUEUED' ELSE state END WHERE id = j.id;
  UPDATE "ImageMaintenanceItem" SET state = 'SKIPPED',reason = 'CANCELLED',"completedAt" = clock_timestamp() WHERE "jobId" = j.id AND state = 'CANDIDATE';
  PERFORM image_refresh_maintenance_job(j.id); RETURN image_maintenance_job_json(j.id);
END;
$$;

CREATE OR REPLACE FUNCTION image_storage_revision() RETURNS INTEGER LANGUAGE SQL IMMUTABLE AS $$ SELECT 2 $$;

CREATE FUNCTION image_begin_read(p JSONB) RETURNS JSONB LANGUAGE plpgsql AS $$
DECLARE v_id UUID; a "ImageAsset"; o "ImageObject"; v_expiry TIMESTAMPTZ;
BEGIN
  IF (CASE WHEN p->>'assetId' IS NOT NULL THEN 1 ELSE 0 END + CASE WHEN p->>'publicToken' IS NOT NULL THEN 1 ELSE 0 END + CASE WHEN p->>'url' IS NOT NULL THEN 1 ELSE 0 END) <> 1 THEN PERFORM image_raise('IMAGE_INVALID_INPUT'); END IF;
  IF p->>'assetId' IS NOT NULL THEN v_id := image_uuid(p->>'assetId');
  ELSIF p->>'publicToken' IS NOT NULL THEN
    IF length(p->>'publicToken') <> 64 OR p->>'publicToken' !~ '^[0-9a-f]{64}$' THEN PERFORM image_raise('IMAGE_INVALID_INPUT'); END IF;
    SELECT id INTO v_id FROM "ImageAsset" WHERE "publicToken" = p->>'publicToken';
  ELSE SELECT "assetId" INTO v_id FROM "ImageUrlAlias" WHERE url = p->>'url'; END IF;
  SELECT * INTO a FROM "ImageAsset" WHERE id = v_id AND (p->>'ownerId' IS NULL OR "ownerId" = p->>'ownerId') FOR UPDATE;
  IF NOT FOUND THEN RETURN NULL; END IF;
  IF a.state <> 'AVAILABLE' OR a."activeObjectId" IS NULL THEN PERFORM image_raise('IMAGE_UNAVAILABLE'); END IF;
  SELECT * INTO o FROM "ImageObject" WHERE id = a."activeObjectId" FOR UPDATE;
  IF o.state <> 'READY' OR NOT o.accounted OR o."needsReconciliation" THEN PERFORM image_raise('IMAGE_UNAVAILABLE'); END IF;
  v_expiry := clock_timestamp() + interval '45 seconds';
  UPDATE "ImageObject" SET "readProtectedUntil" = GREATEST("readProtectedUntil",v_expiry) WHERE id = o.id;
  RETURN jsonb_build_object('image',image_get_asset(a.id,NULL),'readExpiresAt',v_expiry);
END;
$$;
CREATE FUNCTION image_prepare_copy(p JSONB) RETURNS JSONB LANGUAGE plpgsql AS $$
DECLARE a "ImageAsset"; r "ImageWriteReservation"; v_json JSONB; v_size BIGINT; v_owner TEXT; v_asset UUID;
BEGIN
  v_asset := image_uuid(p->>'assetId'); v_owner := image_required_text(p->>'ownerId',128); v_size := image_bytes(p->>'byteLength');
  PERFORM image_lock_quota();
  v_json := image_reserve_write(jsonb_build_object('ownerId',v_owner,'intentKey',image_required_text(p->>'intentKey',256),'kind','COPY','slotBytes',jsonb_build_array(v_size::text),'leaseSeconds',image_lease_seconds(p->>'leaseSeconds')));
  SELECT * INTO r FROM "ImageWriteReservation" WHERE id = (v_json->>'id')::uuid FOR UPDATE;
  SELECT * INTO a FROM "ImageAsset" WHERE id = v_asset FOR UPDATE;
  IF a.id IS NULL OR a.state <> 'AVAILABLE' OR a."ownerId" <> v_owner OR a."byteLength" <> v_size THEN PERFORM image_raise('IMAGE_UNAVAILABLE'); END IF;
  IF a."copyReservationId" = r.id THEN RETURN image_reservation_json(r); END IF;
  IF r.state <> 'ACTIVE' OR a."copyProtectedUntil" > clock_timestamp() OR EXISTS (SELECT 1 FROM "ImageObject" WHERE "assetId" = a.id AND accounted AND (state IN ('WRITING','UNKNOWN','DELETING') OR "needsReconciliation")) THEN PERFORM image_raise('IMAGE_WRITE_CONFLICT'); END IF;
  UPDATE "ImageAsset" SET "copyReservationId" = r.id,"copyProtectedUntil" = r."leaseExpiresAt" WHERE id = a.id;
  RETURN image_reservation_json(r);
END;
$$;
CREATE OR REPLACE FUNCTION image_close_reservation(p JSONB) RETURNS JSONB LANGUAGE plpgsql AS $$
DECLARE v_res "ImageWriteReservation"; v_id UUID; v_token UUID;
BEGIN
  v_id := image_uuid(p->>'reservationId'); v_token := image_uuid(p->>'token');
  PERFORM image_lock_quota(); SELECT * INTO v_res FROM "ImageWriteReservation" WHERE id = v_id FOR UPDATE;
  IF v_res.id IS NULL OR v_res.token <> v_token THEN PERFORM image_raise('IMAGE_RESERVATION_CONFLICT'); END IF;
  IF v_res."outputJobId" IS NOT NULL AND EXISTS (SELECT 1 FROM "GenerationJob" WHERE id = v_res."outputJobId" AND status::text IN ('PENDING','PROCESSING')) THEN PERFORM image_raise('IMAGE_RESERVATION_CONFLICT'); END IF;
  IF v_res.state <> 'CLOSED' THEN UPDATE "ImageWriteReservation" SET state = 'CLOSED',"remainingBytes" = 0 WHERE id = v_id; END IF;
  IF v_res.kind = 'COPY' AND NOT EXISTS (SELECT 1 FROM "ImageObject" WHERE "reservationId" = v_id AND (state IN ('WRITING','UNKNOWN') OR "needsReconciliation")) THEN
    UPDATE "ImageAsset" SET "copyReservationId" = NULL,"copyProtectedUntil" = NULL WHERE "copyReservationId" = v_id;
  END IF;
  RETURN 'true'::jsonb;
END;
$$;
CREATE FUNCTION image_close_expired_reservations(p JSONB) RETURNS JSONB LANGUAGE plpgsql AS $$
DECLARE r "ImageWriteReservation"; v_limit INTEGER; v_count INTEGER := 0; v_bytes BIGINT := 0;
BEGIN
  v_limit := image_management_integer(COALESCE(p->>'limit','100'),1,1000); PERFORM image_lock_quota();
  FOR r IN SELECT * FROM "ImageWriteReservation" x WHERE x.state = 'ACTIVE' AND x."leaseExpiresAt" <= clock_timestamp()
    AND NOT EXISTS (SELECT 1 FROM "GenerationJob" j WHERE j.id = x."outputJobId" AND j.status::text IN ('PENDING','PROCESSING')) ORDER BY x.id LIMIT v_limit FOR UPDATE SKIP LOCKED LOOP
    PERFORM image_close_reservation(jsonb_build_object('reservationId',r.id,'token',r.token)); v_count := v_count + 1; v_bytes := v_bytes + r."remainingBytes";
  END LOOP;
  RETURN jsonb_build_object('closed',v_count,'releasedBytes',v_bytes::text);
END;
$$;
CREATE FUNCTION image_request_quota_cleanup(p JSONB) RETURNS JSONB LANGUAGE plpgsql AS $$
DECLARE v_policy "ImageStoragePolicy"; q "ImageQuota"; j "ImageMaintenanceJob"; v_request UUID; v_owner TEXT; v_intent_key TEXT; v_needed BIGINT; v_deficit BIGINT; v_key TEXT; v_intent JSONB;
BEGIN
  v_request := image_uuid(p->>'requestId'); v_owner := image_required_text(p->>'ownerId',128); v_intent_key := image_required_text(p->>'intentKey',256); v_needed := image_management_bytes(p->>'neededBytes');
  PERFORM image_lock_quota(); SELECT * INTO q FROM "ImageQuota" WHERE scope = 'images'; SELECT * INTO v_policy FROM "ImageStoragePolicy" WHERE scope = 'images' FOR UPDATE;
  IF NOT v_policy.enabled OR NOT v_policy."quotaCleanupEnabled" THEN RETURN NULL; END IF;
  v_intent := jsonb_build_object('ownerId',v_owner,'intentKey',v_intent_key,'neededBytes',v_needed::text);
  v_key := 'quota:' || encode(sha256(convert_to(jsonb_build_array(v_owner,v_intent_key)::text,'UTF8')),'hex');
  SELECT * INTO j FROM "ImageMaintenanceJob" WHERE "requestKey" = v_key FOR UPDATE;
  IF FOUND THEN IF j.intent <> v_intent THEN PERFORM image_raise('IMAGE_MAINTENANCE_CONFLICT'); END IF; RETURN image_maintenance_job_json(j.id); END IF;
  v_deficit := GREATEST(0,q."usedBytes" + q."reservedBytes" + v_needed - v_policy."limitBytes");
  IF v_deficit = 0 THEN RETURN NULL; END IF;
  INSERT INTO "ImageMaintenanceJob" ("requesterId","requestKey",intent,mode,state,"policyVersion","neededBytes","reclaimTargetBytes","confirmedRequestId","confirmedAt")
    VALUES (v_owner,v_key,v_intent,'QUOTA','QUEUED',v_policy.version,v_needed,v_deficit,v_request,clock_timestamp()) RETURNING * INTO j;
  PERFORM image_snapshot_cleanup(j.id); PERFORM image_refresh_maintenance_job(j.id);
  IF NOT EXISTS (SELECT 1 FROM "ImageMaintenanceItem" WHERE "jobId" = j.id) THEN UPDATE "ImageMaintenanceJob" SET state = 'PARTIAL' WHERE id = j.id; END IF;
  RETURN image_maintenance_job_json(j.id);
END;
$$;
CREATE FUNCTION image_enqueue_due_cleanup() RETURNS JSONB LANGUAGE plpgsql AS $$
DECLARE v_policy "ImageStoragePolicy"; q "ImageQuota"; j "ImageMaintenanceJob"; v_key TEXT; v_due TIMESTAMPTZ; v_json JSONB;
BEGIN
  PERFORM image_lock_quota(); SELECT * INTO v_policy FROM "ImageStoragePolicy" WHERE scope = 'images' FOR UPDATE;
  UPDATE "ImageMaintenanceJob" SET state = 'EXPIRED',"completedAt" = clock_timestamp() WHERE state = 'PREVIEW' AND "previewExpiresAt" <= clock_timestamp();
  IF NOT v_policy.enabled THEN RETURN NULL; END IF;
  SELECT * INTO q FROM "ImageQuota" WHERE scope = 'images';
  IF v_policy."quotaCleanupEnabled" AND q."usedBytes" + q."reservedBytes" > v_policy."limitBytes"
    AND NOT EXISTS (SELECT 1 FROM "ImageMaintenanceJob" WHERE mode = 'QUOTA' AND (state IN ('QUEUED','RUNNING','WAITING') OR "createdAt" > clock_timestamp() - interval '60 seconds')) THEN
    v_json := image_request_quota_cleanup(jsonb_build_object('requestId',gen_random_uuid(),'ownerId','system','intentKey','converge:' || gen_random_uuid()::text,'neededBytes','0'));
    IF v_json IS NOT NULL THEN RETURN v_json; END IF;
  END IF;
  IF NOT v_policy."scheduleEnabled" OR v_policy."nextRunAt" IS NULL OR v_policy."nextRunAt" > clock_timestamp() THEN RETURN NULL; END IF;
  v_due := v_policy."nextRunAt"; v_key := 'schedule:' || v_policy.version::text || ':' || v_due::text;
  UPDATE "ImageStoragePolicy" SET "nextRunAt" = clock_timestamp() + make_interval(secs => "intervalSeconds"),"updatedAt" = clock_timestamp() WHERE scope = 'images';
  SELECT * INTO j FROM "ImageMaintenanceJob" WHERE "requestKey" = v_key;
  IF FOUND THEN RETURN image_maintenance_job_json(j.id); END IF;
  INSERT INTO "ImageMaintenanceJob" ("requesterId","requestKey",intent,mode,state,"policyVersion","ageCutoff","confirmedAt")
    VALUES ('system',v_key,jsonb_build_object('scheduledFor',v_due,'policyVersion',v_policy.version),'SCHEDULE','QUEUED',v_policy.version,clock_timestamp() - make_interval(days => v_policy."retentionDays"),clock_timestamp()) RETURNING * INTO j;
  PERFORM image_snapshot_cleanup(j.id); PERFORM image_refresh_maintenance_job(j.id); RETURN image_maintenance_job_json(j.id);
END;
$$;
CREATE FUNCTION image_acquire_maintenance_lease(p JSONB) RETURNS JSONB LANGUAGE plpgsql AS $$
DECLARE v_token UUID; v_worker TEXT;
BEGIN
  v_token := image_uuid(p->>'token'); v_worker := image_required_text(p->>'workerId',128);
  UPDATE "ImageMaintenanceLease" SET token = v_token,"workerId" = v_worker,"expiresAt" = clock_timestamp() + interval '90 seconds'
    WHERE scope = 'images' AND (token IS NULL OR "expiresAt" <= clock_timestamp() OR (token = v_token AND "workerId" = v_worker));
  RETURN to_jsonb(FOUND);
END;
$$;
CREATE FUNCTION image_release_maintenance_lease(p JSONB) RETURNS JSONB LANGUAGE plpgsql AS $$
BEGIN
  UPDATE "ImageMaintenanceLease" SET token = NULL,"workerId" = NULL,"expiresAt" = NULL WHERE scope = 'images' AND token = image_uuid(p->>'token') AND "workerId" = image_required_text(p->>'workerId',128);
  RETURN to_jsonb(FOUND);
END;
$$;
CREATE FUNCTION image_list_maintenance_locations() RETURNS JSONB LANGUAGE SQL STABLE AS $$
  SELECT COALESCE(jsonb_agg(to_jsonb(l) ORDER BY l.id),'[]'::jsonb) FROM (
    SELECT x.* FROM "ImageStorageLocation" x WHERE EXISTS (SELECT 1 FROM "ImageStoragePolicy" WHERE scope = 'images' AND enabled) AND EXISTS (
      SELECT 1 FROM "ImageObject" o JOIN "ImageMaintenanceItem" i ON i."objectId" = o.id JOIN "ImageMaintenanceJob" j ON j.id = i."jobId"
      WHERE o."locationId" = x.id AND o.accounted AND i.state IN ('CANDIDATE','CLAIMED','RETRY') AND j.state IN ('QUEUED','RUNNING','WAITING')
        AND (j."nextAttemptAt" IS NULL OR j."nextAttemptAt" <= clock_timestamp())
    ) ORDER BY x.id LIMIT 1000
  ) l
$$;

CREATE FUNCTION image_retirement_reason(p_verification UUID) RETURNS TEXT LANGUAGE plpgsql STABLE AS $$
DECLARE v "ImageReplicaVerification"; a "ImageAsset"; s "ImageObject"; t "ImageObject"; v_now TIMESTAMPTZ := clock_timestamp();
BEGIN
  SELECT * INTO v FROM "ImageReplicaVerification" WHERE id = p_verification;
  IF v.id IS NULL OR v.revoked OR v."readerProtocolRevision" <> 2 THEN RETURN 'VERIFICATION_REQUIRED'; END IF;
  SELECT * INTO a FROM "ImageAsset" WHERE id = v."assetId";
  SELECT * INTO s FROM "ImageObject" WHERE id = v."sourceObjectId";
  SELECT * INTO t FROM "ImageObject" WHERE id = v."targetObjectId";
  IF a.state <> 'AVAILABLE' OR a."activeObjectId" IS DISTINCT FROM t.id OR s.id = t.id OR s."assetId" <> a.id OR t."assetId" <> a.id OR t.state <> 'READY' OR NOT t.accounted
    OR s.state NOT IN ('READY','DELETING') OR NOT s.accounted OR s."byteLength" <> v."byteLength" OR t."byteLength" <> v."byteLength" OR s.sha256 <> v.sha256 OR t.sha256 <> v.sha256 OR s."mimeType" <> t."mimeType" THEN RETURN 'VERIFICATION_REQUIRED'; END IF;
  IF s."putOutcome" <> 'CONFIRMED' OR t."putOutcome" <> 'CONFIRMED' OR s."needsReconciliation" OR t."needsReconciliation" THEN RETURN 'UNKNOWN_PUT'; END IF;
  IF s."versionId" IS NOT NULL OR t."versionId" IS NOT NULL THEN RETURN 'VERSIONED'; END IF;
  IF s."writeExpiresAt" > v_now OR a."copyProtectedUntil" > v_now OR EXISTS (SELECT 1 FROM "ImageObject" WHERE "assetId" = a.id AND accounted AND state IN ('WRITING','UNKNOWN')) THEN RETURN 'COPYING'; END IF;
  IF s."readProtectedUntil" > v_now THEN RETURN 'READING'; END IF;
  IF image_alias_manifest(a.id) <> v."aliasManifest" THEN RETURN 'ALIASES_CHANGED'; END IF;
  RETURN NULL;
END;
$$;
CREATE FUNCTION image_record_replica_verification(p JSONB) RETURNS JSONB LANGUAGE plpgsql AS $$
DECLARE a "ImageAsset"; s "ImageObject"; t "ImageObject"; v_urls TEXT[]; v_actual TEXT[]; v_id UUID;
BEGIN
  IF jsonb_typeof(p->'aliasUrls') IS DISTINCT FROM 'array' OR jsonb_array_length(p->'aliasUrls') NOT BETWEEN 1 AND 1000 OR p->>'readerProtocolRevision' IS DISTINCT FROM '2' THEN PERFORM image_raise('IMAGE_INVALID_INPUT'); END IF;
  SELECT * INTO a FROM "ImageAsset" WHERE id = image_uuid(p->>'assetId') FOR UPDATE;
  PERFORM id FROM "ImageObject" WHERE id IN (image_uuid(p->>'sourceObjectId'),image_uuid(p->>'targetObjectId')) ORDER BY id FOR UPDATE;
  SELECT * INTO s FROM "ImageObject" WHERE id = image_uuid(p->>'sourceObjectId'); SELECT * INTO t FROM "ImageObject" WHERE id = image_uuid(p->>'targetObjectId');
  IF a.id IS NULL OR s.id IS NULL OR t.id IS NULL OR a.state <> 'AVAILABLE' OR a."activeObjectId" IS DISTINCT FROM t.id OR s.id = t.id OR s."assetId" <> a.id OR t."assetId" <> a.id
    OR s.state <> 'READY' OR t.state <> 'READY' OR s."putOutcome" <> 'CONFIRMED' OR t."putOutcome" <> 'CONFIRMED' OR s."needsReconciliation" OR t."needsReconciliation"
    OR s."byteLength" <> image_bytes(p->>'byteLength') OR t."byteLength" <> s."byteLength" OR p->>'sha256' IS DISTINCT FROM a.sha256 OR s.sha256 <> a.sha256 OR t.sha256 <> a.sha256 THEN PERFORM image_raise('IMAGE_WRITE_CONFLICT'); END IF;
  SELECT array_agg(DISTINCT image_required_text(value,2048) ORDER BY image_required_text(value,2048)) INTO v_urls FROM jsonb_array_elements_text(p->'aliasUrls');
  SELECT array_agg(url ORDER BY url) INTO v_actual FROM "ImageUrlAlias" WHERE "assetId" = a.id;
  IF v_urls IS DISTINCT FROM v_actual THEN PERFORM image_raise('IMAGE_REFERENCE_CONFLICT'); END IF;
  INSERT INTO "ImageReplicaVerification" ("assetId","sourceObjectId","targetObjectId","byteLength",sha256,"aliasUrls","aliasManifest","readerProtocolRevision")
    VALUES (a.id,s.id,t.id,a."byteLength",a.sha256,v_urls,image_alias_manifest(a.id),2) RETURNING id INTO v_id;
  RETURN jsonb_build_object('id',v_id);
END;
$$;
CREATE FUNCTION image_request_source_retirement(p JSONB) RETURNS JSONB LANGUAGE plpgsql AS $$
DECLARE v "ImageReplicaVerification"; a "ImageAsset"; s "ImageObject"; j "ImageMaintenanceJob"; v_policy "ImageStoragePolicy"; v_key TEXT; v_intent JSONB; v_reason TEXT;
BEGIN
  v_key := 'retire:' || image_uuid(p->>'requestId')::text;
  PERFORM image_lock_quota(); SELECT * INTO v_policy FROM "ImageStoragePolicy" WHERE scope = 'images' FOR UPDATE;
  SELECT * INTO v FROM "ImageReplicaVerification" WHERE id = image_uuid(p->>'verificationId');
  IF v.id IS NULL OR v."assetId" <> image_uuid(p->>'assetId') OR v."sourceObjectId" <> image_uuid(p->>'sourceObjectId') OR v."targetObjectId" <> image_uuid(p->>'targetObjectId') THEN PERFORM image_raise('IMAGE_MAINTENANCE_CONFLICT'); END IF;
  v_intent := jsonb_build_object('assetId',v."assetId",'sourceObjectId',v."sourceObjectId",'targetObjectId',v."targetObjectId",'verificationId',v.id);
  SELECT * INTO j FROM "ImageMaintenanceJob" WHERE "requestKey" = v_key FOR UPDATE;
  IF FOUND THEN IF j.intent <> v_intent THEN PERFORM image_raise('IMAGE_MAINTENANCE_CONFLICT'); END IF; RETURN image_maintenance_job_json(j.id); END IF;
  IF NOT v_policy.enabled THEN PERFORM image_raise('IMAGE_POLICY_DISABLED'); END IF;
  SELECT * INTO a FROM "ImageAsset" WHERE id = v."assetId" FOR UPDATE;
  SELECT * INTO s FROM "ImageObject" WHERE id = v."sourceObjectId" FOR UPDATE;
  v_reason := image_retirement_reason(v.id);
  IF v_reason IS NOT NULL AND v_reason NOT IN ('READING','COPYING') THEN PERFORM image_raise('IMAGE_WRITE_CONFLICT'); END IF;
  INSERT INTO "ImageMaintenanceJob" ("requesterId","requestKey",intent,mode,state,"policyVersion","verificationId","confirmedAt")
    VALUES (a."ownerId",v_key,v_intent,'SOURCE_RETIREMENT','QUEUED',v_policy.version,v.id,clock_timestamp()) RETURNING * INTO j;
  INSERT INTO "ImageMaintenanceItem" ("jobId","assetId","objectId","byteLength","assetCreatedAt","expectedActiveObjectId",manifest)
    VALUES (j.id,a.id,s.id,s."byteLength",a."createdAt",a."activeObjectId",image_asset_manifest(a.id));
  RETURN image_maintenance_job_json(j.id);
END;
$$;

CREATE FUNCTION image_guard_maintenance_asset() RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE j "ImageMaintenanceJob"; r "ImageWriteReservation";
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW."deleteJobId" IS NOT NULL OR NEW."copyReservationId" IS NOT NULL OR NEW."copyProtectedUntil" IS NOT NULL THEN PERFORM image_raise('IMAGE_WRITE_CONFLICT'); END IF;
    RETURN NEW;
  END IF;
  IF OLD."deleteJobId" IS NOT NULL AND NEW."deleteJobId" IS DISTINCT FROM OLD."deleteJobId" THEN PERFORM image_raise('IMAGE_WRITE_CONFLICT'); END IF;
  IF NEW.state = 'DELETING' AND OLD.state <> 'DELETING' THEN
    SELECT * INTO j FROM "ImageMaintenanceJob" WHERE id = NEW."deleteJobId";
    IF j.id IS NULL OR j.mode = 'SOURCE_RETIREMENT' OR j.state <> 'RUNNING' OR image_cleanup_reason(OLD.id) IS NOT NULL THEN PERFORM image_raise('IMAGE_REFERENCE_CONFLICT'); END IF;
    IF EXISTS (SELECT 1 FROM "ImageObject" o WHERE o."assetId" = OLD.id AND o.accounted AND NOT EXISTS (SELECT 1 FROM "ImageMaintenanceItem" i WHERE i."jobId" = j.id AND i."objectId" = o.id)) THEN PERFORM image_raise('IMAGE_WRITE_CONFLICT'); END IF;
  END IF;
  IF NEW."activeObjectId" IS DISTINCT FROM OLD."activeObjectId" AND NEW.state = 'AVAILABLE'
    AND EXISTS (SELECT 1 FROM "ImageObject" WHERE "assetId" = OLD.id AND accounted AND state = 'DELETING') THEN PERFORM image_raise('IMAGE_WRITE_CONFLICT'); END IF;
  IF NEW."copyReservationId" IS DISTINCT FROM OLD."copyReservationId" OR NEW."copyProtectedUntil" IS DISTINCT FROM OLD."copyProtectedUntil" THEN
    IF NEW."copyReservationId" IS NOT NULL THEN
      SELECT * INTO r FROM "ImageWriteReservation" WHERE id = NEW."copyReservationId";
      IF NEW.state <> 'AVAILABLE' OR r.id IS NULL OR r.kind <> 'COPY' OR r.state <> 'ACTIVE' OR r."ownerId" <> NEW."ownerId" OR NEW."copyProtectedUntil" IS DISTINCT FROM r."leaseExpiresAt"
        OR (OLD."copyProtectedUntil" > clock_timestamp() AND OLD."copyReservationId" IS DISTINCT FROM NEW."copyReservationId") THEN PERFORM image_raise('IMAGE_WRITE_CONFLICT'); END IF;
    ELSIF NEW."copyProtectedUntil" IS NOT NULL OR EXISTS (SELECT 1 FROM "ImageWriteReservation" WHERE id = OLD."copyReservationId" AND state <> 'CLOSED') THEN PERFORM image_raise('IMAGE_WRITE_CONFLICT'); END IF;
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER "ImageAsset_maintenance_guard" BEFORE INSERT OR UPDATE ON "ImageAsset" FOR EACH ROW EXECUTE FUNCTION image_guard_maintenance_asset();

CREATE FUNCTION image_guard_maintenance_object() RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE a "ImageAsset"; r "ImageWriteReservation"; i "ImageMaintenanceItem"; j "ImageMaintenanceJob"; v_now TIMESTAMPTZ := clock_timestamp();
BEGIN
  SELECT * INTO a FROM "ImageAsset" WHERE id = NEW."assetId";
  SELECT * INTO r FROM "ImageWriteReservation" WHERE id = NEW."reservationId";
  IF TG_OP = 'INSERT' THEN
    IF NEW."deleteItemId" IS NOT NULL OR NEW."readProtectedUntil" IS NOT NULL THEN PERFORM image_raise('IMAGE_WRITE_CONFLICT'); END IF;
    IF r.kind = 'COPY' AND (a."copyReservationId" IS DISTINCT FROM r.id OR a."copyProtectedUntil" <= v_now) THEN PERFORM image_raise('IMAGE_WRITE_CONFLICT'); END IF;
    RETURN NEW;
  END IF;
  IF OLD."deleteItemId" IS NOT NULL AND NEW."deleteItemId" IS DISTINCT FROM OLD."deleteItemId" THEN PERFORM image_raise('IMAGE_WRITE_CONFLICT'); END IF;
  IF NEW."readProtectedUntil" IS DISTINCT FROM OLD."readProtectedUntil" THEN
    IF NEW.state <> 'READY' OR NEW."readProtectedUntil" IS NULL OR NEW."readProtectedUntil" < OLD."readProtectedUntil" OR NEW."readProtectedUntil" > v_now + interval '45001 milliseconds' THEN PERFORM image_raise('IMAGE_WRITE_CONFLICT'); END IF;
  END IF;
  IF NEW.state = 'DELETING' AND (OLD.state <> 'DELETING' OR NEW."deleteToken" IS DISTINCT FROM OLD."deleteToken") THEN
    SELECT * INTO i FROM "ImageMaintenanceItem" WHERE id = NEW."deleteItemId" AND "objectId" = OLD.id;
    SELECT * INTO j FROM "ImageMaintenanceJob" WHERE id = i."jobId";
    IF i.id IS NULL OR i.state <> 'CLAIMED' OR j.id IS NULL OR NEW."deleteToken" IS NULL OR NEW."deleteExpiresAt" <= v_now OR NEW."deleteExpiresAt" > v_now + interval '90001 milliseconds'
      OR OLD."putOutcome" <> 'CONFIRMED' OR OLD."versionId" IS NOT NULL OR OLD."needsReconciliation" OR OLD."writeExpiresAt" > v_now OR OLD."readProtectedUntil" > v_now
      OR (OLD.state = 'DELETING' AND (OLD."deleteExpiresAt" > v_now OR OLD."nextDeleteAt" > v_now)) THEN PERFORM image_raise('IMAGE_WRITE_CONFLICT'); END IF;
    IF j.mode = 'SOURCE_RETIREMENT' THEN
      IF image_retirement_reason(j."verificationId") IS NOT NULL THEN PERFORM image_raise('IMAGE_WRITE_CONFLICT'); END IF;
    ELSIF a.state <> 'DELETING' OR a."deleteJobId" IS DISTINCT FROM j.id THEN PERFORM image_raise('IMAGE_WRITE_CONFLICT'); END IF;
  END IF;
  IF OLD.state = 'DELETING' AND NOT NEW.accounted THEN
    SELECT * INTO i FROM "ImageMaintenanceItem" WHERE id = OLD."deleteItemId" AND "objectId" = OLD.id;
    IF i.id IS NULL OR i.state <> 'CLAIMED' OR OLD."deleteToken" IS NULL OR NEW."deleteToken" IS DISTINCT FROM OLD."deleteToken" OR OLD."deleteExpiresAt" <= v_now
      OR NEW.state <> 'DELETED' OR NEW."deleteOutcome" NOT IN ('DELETED','MISSING') OR OLD."putOutcome" <> 'CONFIRMED' OR OLD."needsReconciliation" OR OLD."versionId" IS NOT NULL THEN PERFORM image_raise('IMAGE_WRITE_CONFLICT'); END IF;
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER "ImageObject_maintenance_guard" BEFORE INSERT OR UPDATE ON "ImageObject" FOR EACH ROW EXECUTE FUNCTION image_guard_maintenance_object();

CREATE FUNCTION image_guard_maintenance_item() RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN PERFORM image_raise('IMAGE_MAINTENANCE_CONFLICT'); END IF;
  IF TG_OP = 'UPDATE' THEN
    IF (to_jsonb(NEW) - ARRAY['state','reason','releasedBytes','completedAt']) IS DISTINCT FROM (to_jsonb(OLD) - ARRAY['state','reason','releasedBytes','completedAt']) THEN PERFORM image_raise('IMAGE_MAINTENANCE_CONFLICT'); END IF;
    IF OLD.state IN ('DONE','SKIPPED') AND NEW IS DISTINCT FROM OLD THEN PERFORM image_raise('IMAGE_MAINTENANCE_CONFLICT'); END IF;
    IF NEW.state <> OLD.state AND NOT ((OLD.state = 'CANDIDATE' AND NEW.state IN ('CLAIMED','SKIPPED')) OR (OLD.state = 'CLAIMED' AND NEW.state IN ('RETRY','DONE')) OR (OLD.state = 'RETRY' AND NEW.state = 'CLAIMED')) THEN PERFORM image_raise('IMAGE_MAINTENANCE_CONFLICT'); END IF;
    IF NEW."releasedBytes" <> OLD."releasedBytes" AND (OLD."releasedBytes" <> 0 OR NEW.state <> 'DONE' OR NEW."releasedBytes" <> OLD."byteLength"
      OR NOT EXISTS (SELECT 1 FROM "ImageObject" WHERE id = OLD."objectId" AND "deleteItemId" = OLD.id AND state = 'DELETED' AND NOT accounted)) THEN PERFORM image_raise('IMAGE_MAINTENANCE_CONFLICT'); END IF;
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER "ImageMaintenanceItem_guard" BEFORE UPDATE OR DELETE ON "ImageMaintenanceItem" FOR EACH ROW EXECUTE FUNCTION image_guard_maintenance_item();
CREATE FUNCTION image_guard_maintenance_job() RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN PERFORM image_raise('IMAGE_MAINTENANCE_CONFLICT'); END IF;
  IF (to_jsonb(NEW) - ARRAY['state','confirmedRequestId','confirmedAt','nextAttemptAt','completedAt','cancelRequested','truncated','updatedAt'])
    IS DISTINCT FROM (to_jsonb(OLD) - ARRAY['state','confirmedRequestId','confirmedAt','nextAttemptAt','completedAt','cancelRequested','truncated','updatedAt'])
    OR (OLD."confirmedRequestId" IS NOT NULL AND NEW."confirmedRequestId" IS DISTINCT FROM OLD."confirmedRequestId") OR (OLD."cancelRequested" AND NOT NEW."cancelRequested") THEN PERFORM image_raise('IMAGE_MAINTENANCE_CONFLICT'); END IF;
  NEW."updatedAt" := clock_timestamp(); RETURN NEW;
END;
$$;
CREATE TRIGGER "ImageMaintenanceJob_guard" BEFORE UPDATE OR DELETE ON "ImageMaintenanceJob" FOR EACH ROW EXECUTE FUNCTION image_guard_maintenance_job();
CREATE FUNCTION image_guard_replica_verification() RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' OR (to_jsonb(NEW) - 'revoked') IS DISTINCT FROM (to_jsonb(OLD) - 'revoked') OR (OLD.revoked AND NOT NEW.revoked) THEN PERFORM image_raise('IMAGE_WRITE_CONFLICT'); END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER "ImageReplicaVerification_immutable" BEFORE UPDATE OR DELETE ON "ImageReplicaVerification" FOR EACH ROW EXECUTE FUNCTION image_guard_replica_verification();

CREATE FUNCTION image_claim_maintenance(p JSONB) RETURNS JSONB LANGUAGE plpgsql AS $$
DECLARE v_token UUID; v_locations TEXT[]; v_policy "ImageStoragePolicy"; j "ImageMaintenanceJob"; i "ImageMaintenanceItem"; first_item "ImageMaintenanceItem";
  a "ImageAsset"; o "ImageObject"; l "ImageStorageLocation"; v_reason TEXT; v_result JSONB := '[]'::jsonb; v_released BIGINT; v_deficit BIGINT; v_now TIMESTAMPTZ;
BEGIN
  v_token := image_uuid(p->>'executorToken');
  IF jsonb_typeof(p->'verifiedLocationIds') IS DISTINCT FROM 'array' OR jsonb_array_length(p->'verifiedLocationIds') > 1000 THEN PERFORM image_raise('IMAGE_INVALID_INPUT'); END IF;
  SELECT COALESCE(array_agg(image_required_text(value,128)),ARRAY[]::text[]) INTO v_locations FROM jsonb_array_elements_text(p->'verifiedLocationIds');
  PERFORM image_lock_quota(); SELECT * INTO v_policy FROM "ImageStoragePolicy" WHERE scope = 'images' FOR UPDATE;
  PERFORM 1 FROM "ImageMaintenanceLease" WHERE scope = 'images' AND token = v_token AND "expiresAt" > clock_timestamp() FOR UPDATE;
  IF NOT FOUND THEN PERFORM image_raise('IMAGE_MAINTENANCE_CONFLICT'); END IF;
  IF NOT v_policy.enabled THEN RETURN v_result; END IF;
  FOR j IN SELECT * FROM "ImageMaintenanceJob" WHERE state IN ('QUEUED','RUNNING','WAITING') AND ("nextAttemptAt" IS NULL OR "nextAttemptAt" <= clock_timestamp()) ORDER BY "createdAt",id LIMIT 20 FOR UPDATE SKIP LOCKED LOOP
    IF j."policyVersion" <> v_policy.version OR j."cancelRequested" OR (j.mode = 'QUOTA' AND NOT v_policy."quotaCleanupEnabled") THEN
      UPDATE "ImageMaintenanceItem" SET state = 'SKIPPED',reason = CASE WHEN j."cancelRequested" THEN 'CANCELLED' ELSE 'POLICY_CHANGED' END,"completedAt" = clock_timestamp() WHERE "jobId" = j.id AND state = 'CANDIDATE';
    END IF;
    SELECT * INTO first_item FROM "ImageMaintenanceItem" WHERE "jobId" = j.id AND state IN ('CANDIDATE','CLAIMED','RETRY')
      ORDER BY CASE WHEN state = 'CANDIDATE' THEN 1 ELSE 0 END,"assetCreatedAt","assetId",id LIMIT 1 FOR UPDATE;
    IF NOT FOUND THEN PERFORM image_refresh_maintenance_job(j.id); CONTINUE; END IF;
    IF j.mode = 'QUOTA' AND first_item.state = 'CANDIDATE' THEN
      SELECT COALESCE(sum("releasedBytes"),0) INTO v_released FROM "ImageMaintenanceItem" WHERE "jobId" = j.id;
      SELECT GREATEST(0,"usedBytes" + "reservedBytes" + j."neededBytes" - v_policy."limitBytes") INTO v_deficit FROM "ImageQuota" WHERE scope = 'images';
      IF v_deficit = 0 OR v_released >= j."reclaimTargetBytes" THEN
        UPDATE "ImageMaintenanceItem" SET state = 'SKIPPED',reason = 'QUOTA_MET',"completedAt" = clock_timestamp() WHERE "jobId" = j.id AND state = 'CANDIDATE';
        PERFORM image_refresh_maintenance_job(j.id); CONTINUE;
      END IF;
    END IF;
    -- Match existing writer and Canvas order; never lock a Canvas document or
    -- owner while holding the global quota. Every I/O happens after this returns.
    PERFORM id FROM "ImageMaintenanceItem" WHERE "jobId" = j.id AND "assetId" = first_item."assetId" ORDER BY id FOR UPDATE;
    PERFORM r.id FROM "ImageWriteReservation" r WHERE EXISTS (SELECT 1 FROM "ImageObject" x WHERE x."assetId" = first_item."assetId" AND x."reservationId" = r.id) ORDER BY r.id FOR UPDATE;
    PERFORM id FROM "CanvasImportAsset" WHERE "mediaAssetId" = first_item."assetId" ORDER BY id FOR UPDATE;
    SELECT * INTO a FROM "ImageAsset" WHERE id = first_item."assetId" FOR UPDATE;
    PERFORM id FROM "ImageObject" WHERE "assetId" = a.id ORDER BY id FOR UPDATE;
    v_now := clock_timestamp(); v_reason := NULL;
    IF first_item.state = 'CANDIDATE' THEN
      v_reason := CASE WHEN j.mode = 'SOURCE_RETIREMENT' THEN image_retirement_reason(j."verificationId") ELSE image_cleanup_reason(a.id) END;
      IF v_reason IS NULL AND (a."activeObjectId" IS DISTINCT FROM first_item."expectedActiveObjectId" OR image_asset_manifest(a.id) <> first_item.manifest) THEN v_reason := 'SNAPSHOT_CHANGED'; END IF;
      IF v_reason IS NULL AND EXISTS (SELECT 1 FROM "ImageMaintenanceItem" x JOIN "ImageObject" y ON y.id = x."objectId" WHERE x."jobId" = j.id AND x."assetId" = a.id AND NOT y."locationId" = ANY(v_locations)) THEN v_reason := 'STORAGE_UNAVAILABLE'; END IF;
      IF j.mode = 'SOURCE_RETIREMENT' AND v_reason IN ('READING','COPYING') THEN
        UPDATE "ImageMaintenanceJob" SET state = 'WAITING',"nextAttemptAt" = v_now + interval '1 second' WHERE id = j.id; CONTINUE;
      END IF;
      IF v_reason IS NOT NULL THEN
        UPDATE "ImageMaintenanceItem" SET state = 'SKIPPED',reason = v_reason,"completedAt" = v_now WHERE "jobId" = j.id AND "assetId" = a.id AND state = 'CANDIDATE';
        PERFORM image_refresh_maintenance_job(j.id); CONTINUE;
      END IF;
      UPDATE "ImageMaintenanceJob" SET state = 'RUNNING',"nextAttemptAt" = NULL WHERE id = j.id;
      IF j.mode <> 'SOURCE_RETIREMENT' THEN
        UPDATE "ImageAsset" SET state = 'DELETING',"deleteJobId" = j.id WHERE id = a.id;
        UPDATE "CanvasImportAsset" SET state = 'DELETING' WHERE "mediaAssetId" = a.id;
      END IF;
    ELSE
      IF j.mode <> 'SOURCE_RETIREMENT' AND (a.state <> 'DELETING' OR a."deleteJobId" IS DISTINCT FROM j.id) THEN PERFORM image_raise('IMAGE_MAINTENANCE_CONFLICT'); END IF;
      IF j.mode = 'SOURCE_RETIREMENT' AND image_retirement_reason(j."verificationId") IS NOT NULL THEN
        UPDATE "ImageMaintenanceJob" SET state = 'WAITING',"nextAttemptAt" = v_now + interval '10 seconds' WHERE id = j.id; CONTINUE;
      END IF;
      IF EXISTS (SELECT 1 FROM "ImageMaintenanceItem" x JOIN "ImageObject" y ON y.id = x."objectId" WHERE x."jobId" = j.id AND x."assetId" = a.id AND x.state IN ('CLAIMED','RETRY')
        AND (y."deleteExpiresAt" > v_now OR y."nextDeleteAt" > v_now)) THEN
        PERFORM image_refresh_maintenance_job(j.id); CONTINUE;
      END IF;
      IF EXISTS (SELECT 1 FROM "ImageMaintenanceItem" x JOIN "ImageObject" y ON y.id = x."objectId" WHERE x."jobId" = j.id AND x."assetId" = a.id AND x.state IN ('CLAIMED','RETRY') AND NOT y."locationId" = ANY(v_locations)) THEN
        UPDATE "ImageObject" SET "nextDeleteAt" = v_now + interval '10 seconds' WHERE id IN (SELECT "objectId" FROM "ImageMaintenanceItem" WHERE "jobId" = j.id AND "assetId" = a.id AND state IN ('CLAIMED','RETRY'));
        UPDATE "ImageMaintenanceItem" SET state = 'RETRY',reason = 'STORAGE_UNAVAILABLE' WHERE "jobId" = j.id AND "assetId" = a.id AND state IN ('CLAIMED','RETRY');
        PERFORM image_refresh_maintenance_job(j.id); CONTINUE;
      END IF;
    END IF;
    FOR i IN SELECT * FROM "ImageMaintenanceItem" WHERE "jobId" = j.id AND "assetId" = a.id AND state IN ('CANDIDATE','CLAIMED','RETRY') ORDER BY id LOOP
      UPDATE "ImageMaintenanceItem" SET state = 'CLAIMED',reason = NULL WHERE id = i.id;
      UPDATE "ImageObject" SET state = 'DELETING',"deleteItemId" = i.id,"deleteToken" = gen_random_uuid(),"deleteExpiresAt" = clock_timestamp() + interval '90 seconds',
        "deleteAttempts" = "deleteAttempts" + 1,"nextDeleteAt" = NULL,"lastErrorCode" = NULL WHERE id = i."objectId" RETURNING * INTO o;
      SELECT * INTO l FROM "ImageStorageLocation" WHERE id = o."locationId";
      v_result := v_result || jsonb_build_array(jsonb_build_object('jobId',j.id,'itemId',i.id,'mode',j.mode,'object',image_object_json(o),'location',to_jsonb(l),'deleteToken',o."deleteToken",'deleteExpiresAt',o."deleteExpiresAt"));
    END LOOP;
    PERFORM image_refresh_maintenance_job(j.id); RETURN v_result;
  END LOOP;
  RETURN v_result;
END;
$$;

CREATE FUNCTION image_finish_maintenance_object(p JSONB) RETURNS JSONB LANGUAGE plpgsql AS $$
DECLARE j "ImageMaintenanceJob"; i "ImageMaintenanceItem"; a "ImageAsset"; o "ImageObject"; c "CanvasImportAsset";
  v_job UUID; v_item UUID; v_object UUID; v_token UUID; v_outcome TEXT; v_released BIGINT := 0; v_now TIMESTAMPTZ; v_backoff INTEGER;
BEGIN
  v_job := image_uuid(p->>'jobId'); v_item := image_uuid(p->>'itemId'); v_object := image_uuid(p->>'objectId'); v_token := image_uuid(p->>'deleteToken'); v_outcome := p->>'outcome';
  IF v_outcome IS NULL OR v_outcome NOT IN ('DELETED','MISSING','FAILED','UNKNOWN') THEN PERFORM image_raise('IMAGE_INVALID_INPUT'); END IF;
  PERFORM image_lock_quota();
  SELECT * INTO j FROM "ImageMaintenanceJob" WHERE id = v_job FOR UPDATE;
  SELECT * INTO i FROM "ImageMaintenanceItem" WHERE id = v_item AND "jobId" = v_job AND "objectId" = v_object FOR UPDATE;
  IF j.id IS NULL OR i.id IS NULL THEN PERFORM image_raise('IMAGE_MAINTENANCE_CONFLICT'); END IF;
  PERFORM id FROM "CanvasImportAsset" WHERE "mediaAssetId" = i."assetId" ORDER BY id FOR UPDATE;
  SELECT * INTO a FROM "ImageAsset" WHERE id = i."assetId" FOR UPDATE;
  SELECT * INTO o FROM "ImageObject" WHERE id = v_object FOR UPDATE;
  IF i.state = 'DONE' AND NOT o.accounted AND o."deleteToken" = v_token THEN
    RETURN jsonb_build_object('accepted',true,'replayed',true,'releasedBytes','0','job',image_maintenance_job_json(j.id));
  END IF;
  v_now := clock_timestamp();
  IF i.state <> 'CLAIMED' OR o.state <> 'DELETING' OR o."deleteItemId" IS DISTINCT FROM i.id OR o."deleteToken" IS DISTINCT FROM v_token OR o."deleteExpiresAt" <= v_now THEN
    RETURN jsonb_build_object('accepted',false,'replayed',false,'releasedBytes','0','job',image_maintenance_job_json(j.id));
  END IF;
  IF v_outcome IN ('DELETED','MISSING') THEN
    IF o."putOutcome" <> 'CONFIRMED' OR o."needsReconciliation" OR o."versionId" IS NOT NULL THEN PERFORM image_raise('IMAGE_WRITE_CONFLICT'); END IF;
    IF o.accounted THEN v_released := o."byteLength"; END IF;
    UPDATE "ImageObject" SET state = 'DELETED',accounted = false,"deleteOutcome" = v_outcome,"deletedAt" = v_now,"deleteExpiresAt" = v_now,"nextDeleteAt" = NULL,"lastErrorCode" = NULL WHERE id = o.id;
    UPDATE "ImageMaintenanceItem" SET state = 'DONE',"releasedBytes" = v_released,"completedAt" = v_now,reason = NULL WHERE id = i.id;
    IF j.mode <> 'SOURCE_RETIREMENT' AND NOT EXISTS (SELECT 1 FROM "ImageObject" WHERE "assetId" = a.id AND (accounted OR "needsReconciliation")) THEN
      SELECT * INTO c FROM "CanvasImportAsset" WHERE "mediaAssetId" = a.id;
      -- Renew while both logical rows are still DELETING: the Canvas guard
      -- requires that peer state, and its terminal receipt checks OLD expiry.
      IF c.id IS NOT NULL AND c."deleteExpiresAt" <= clock_timestamp() THEN
        UPDATE "CanvasImportAsset" SET "deleteToken" = gen_random_uuid() WHERE id = c.id;
      END IF;
      UPDATE "ImageAsset" SET state = 'DELETED',"activeObjectId" = NULL,"deletedAt" = v_now,"deleteReason" = 'RETENTION' WHERE id = a.id;
      IF c.id IS NOT NULL THEN
        UPDATE "CanvasImportAsset" SET state = 'DELETED',"deleteOutcome" = 'DELETED',"physicalBytesAccounted" = false,"needsReconciliation" = false,"nextDeleteAt" = NULL WHERE id = c.id;
      END IF;
    END IF;
  ELSE
    v_backoff := LEAST(3600,(10 * power(2,LEAST(GREATEST(o."deleteAttempts"-1,0),8)))::integer);
    UPDATE "ImageObject" SET "deleteOutcome" = v_outcome,"deleteExpiresAt" = v_now,"nextDeleteAt" = v_now + make_interval(secs => v_backoff),
      "lastErrorCode" = CASE WHEN p->>'errorCode' ~ '^IMAGE_[A-Z_]{1,50}$' THEN p->>'errorCode' ELSE 'IMAGE_STORAGE_UNAVAILABLE' END WHERE id = o.id;
    UPDATE "ImageMaintenanceItem" SET state = 'RETRY',reason = CASE WHEN v_outcome = 'UNKNOWN' THEN 'UNKNOWN_DELETE' ELSE 'DELETE_FAILED' END WHERE id = i.id;
  END IF;
  PERFORM image_refresh_maintenance_job(j.id);
  RETURN jsonb_build_object('accepted',true,'replayed',false,'releasedBytes',v_released::text,'job',image_maintenance_job_json(j.id));
END;
$$;

CREATE OR REPLACE FUNCTION canvas_sync_saved_images(p_owner TEXT, p_canvas UUID, p_scene JSONB) RETURNS VOID LANGUAGE plpgsql AS $$
DECLARE v_ids JSONB;
BEGIN
  -- Serialize a late media binding with Save/Run before deciding that a legacy
  -- result has no managed identity. The binder never locks the Canvas row.
  PERFORM i.id FROM jsonb_array_elements(p_scene->'nodes') n
    JOIN "GenerationImage" i ON n->>'kind' = 'result' AND i.id = n->>'imageId' AND i."jobId" = n->>'jobId'
    JOIN "GenerationJob" j ON j.id = i."jobId" WHERE j."userId" = p_owner ORDER BY i.id FOR SHARE OF i;
  SELECT COALESCE(jsonb_agg(DISTINCT id), '[]'::jsonb) INTO v_ids FROM (
    SELECT a."mediaAssetId" AS id FROM jsonb_array_elements(p_scene->'nodes') AS n
      JOIN "CanvasImportAsset" AS a ON n->>'kind' = 'reference' AND a.id = n->'source'->>'assetId'
      WHERE a."ownerId" = p_owner AND a."mediaAssetId" IS NOT NULL
    UNION
    SELECT i."mediaAssetId" AS id FROM jsonb_array_elements(p_scene->'nodes') AS n
      JOIN "GenerationImage" AS i ON n->>'kind' = 'result' AND i.id = n->>'imageId' AND i."jobId" = n->>'jobId'
      JOIN "GenerationJob" AS j ON j.id = i."jobId"
      WHERE j."userId" = p_owner AND i."mediaAssetId" IS NOT NULL
  ) AS assets;
  PERFORM image_replace_references(jsonb_build_object('ownerId',p_owner,'kind','CANVAS_SAVED','referenceKey','canvas:' || p_canvas::text,'assetIds',v_ids));
END;
$$;

CREATE OR REPLACE FUNCTION canvas_sync_run_images(p_owner TEXT, p_run TEXT, p_snapshot JSONB) RETURNS VOID LANGUAGE plpgsql AS $$
DECLARE v_ids JSONB;
BEGIN
  -- Serialize a late media binding with Save/Run before deciding that a legacy
  -- result has no managed identity. The binder never locks the Canvas row.
  PERFORM i.id FROM jsonb_array_elements(p_snapshot->'input'->'references') n
    JOIN "GenerationImage" i ON n->>'kind' = 'result' AND i.id = n->>'imageId' AND i."jobId" = n->>'jobId'
    JOIN "GenerationJob" j ON j.id = i."jobId" WHERE j."userId" = p_owner ORDER BY i.id FOR SHARE OF i;
  SELECT COALESCE(jsonb_agg(DISTINCT id), '[]'::jsonb) INTO v_ids FROM (
    SELECT a."mediaAssetId" AS id FROM jsonb_array_elements(p_snapshot->'input'->'references') AS r
      JOIN "CanvasImportAsset" AS a ON r->>'kind' = 'imported' AND a.id = r->>'assetId'
      WHERE a."ownerId" = p_owner AND a."mediaAssetId" IS NOT NULL
    UNION
    SELECT i."mediaAssetId" AS id FROM jsonb_array_elements(p_snapshot->'input'->'references') AS r
      JOIN "GenerationImage" AS i ON r->>'kind' = 'result' AND i.id = r->>'imageId' AND i."jobId" = r->>'jobId'
      JOIN "GenerationJob" AS j ON j.id = i."jobId"
      WHERE j."userId" = p_owner AND i."mediaAssetId" IS NOT NULL
  ) AS assets;
  -- Only actual inputs become permanent. A run's generated output provenance
  -- does not create an input root and does not keep every output forever.
  PERFORM image_replace_references(jsonb_build_object('ownerId',p_owner,'kind','JOB_INPUT','referenceKey','canvas-run:' || p_run,'assetIds',v_ids));
END;
$$;
