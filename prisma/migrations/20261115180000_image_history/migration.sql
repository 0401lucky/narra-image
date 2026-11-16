-- Image history revision 3. No storage IO, policy enablement or source deletion
-- happens in this migration. Historical observations are facts, not PUT grants.
CREATE TABLE "ImageHistoryJob" (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(), "requestId" UUID NOT NULL UNIQUE,
  "actorId" VARCHAR(128) NOT NULL, mode VARCHAR(8) NOT NULL CHECK (mode IN ('ADOPT','COPY')),
  scope VARCHAR(24) NOT NULL CHECK (scope IN ('ALL','GENERATED','CANVAS_IMPORT','REFERENCE_URL')),
  "planDigest" CHAR(64) NOT NULL CHECK ("planDigest" ~ '^[0-9a-f]{64}$'),
  "publicUrlBase" VARCHAR(2048) NOT NULL,
  "sourceBindings" JSONB NOT NULL CHECK (jsonb_typeof("sourceBindings") = 'array' AND jsonb_array_length("sourceBindings") <= 1000),
  "targetLocationId" VARCHAR(128) REFERENCES "ImageStorageLocation"(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  "retireSource" BOOLEAN NOT NULL DEFAULT false, "upperBound" TIMESTAMPTZ(3) NOT NULL,
  cursor TEXT, "scanComplete" BOOLEAN NOT NULL DEFAULT false,
  state VARCHAR(16) NOT NULL DEFAULT 'PLANNED' CHECK (state IN ('PLANNED','RUNNING','WAITING','SUCCEEDED','PARTIAL','CANCELLED')),
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT clock_timestamp(), "updatedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT clock_timestamp(),
  CHECK ((mode = 'COPY') = ("targetLocationId" IS NOT NULL)), CHECK (NOT "retireSource" OR mode = 'COPY')
);
CREATE TABLE "ImageHistoryItem" (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(), "jobId" UUID NOT NULL REFERENCES "ImageHistoryJob"(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  "subjectKind" VARCHAR(24) NOT NULL CHECK ("subjectKind" IN ('GENERATED','CANVAS_IMPORT','REFERENCE_URL','VIDEO')),
  "subjectId" VARCHAR(128) NOT NULL, "ownerId" VARCHAR(128), "exactUrl" TEXT,
  snapshot JSONB NOT NULL CHECK (jsonb_typeof(snapshot) = 'object'), "snapshotHash" CHAR(64) NOT NULL,
  "sourceBinding" JSONB, state VARCHAR(24) NOT NULL DEFAULT 'PENDING' CHECK (state IN ('PENDING','OBSERVED','ADOPTED','COPYING','RECONCILING','BLOCKED','SOURCE_RETAINED','RETIREMENT_REQUESTED','EXCLUDED')),
  "workerId" VARCHAR(128), token UUID, "leaseExpiresAt" TIMESTAMPTZ(3),
  "sourceObservationId" UUID, "assetId" UUID REFERENCES "ImageAsset"(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  "sourceObjectId" UUID REFERENCES "ImageObject"(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  "targetObjectId" UUID REFERENCES "ImageObject"(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  "reservationId" UUID REFERENCES "ImageWriteReservation"(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  attempt INTEGER NOT NULL DEFAULT 0 CHECK (attempt >= 0), "intentKey" VARCHAR(256), "targetKey" VARCHAR(512),
  "replicaVerificationId" UUID REFERENCES "ImageReplicaVerification"(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  "retirementJobId" UUID REFERENCES "ImageMaintenanceJob"(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  "errorCode" VARCHAR(64), "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT clock_timestamp(), "updatedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT "ImageHistoryItem_subject_key" UNIQUE ("jobId","subjectKind","subjectId"),
  CHECK ("snapshotHash" = encode(sha256(convert_to(snapshot::text,'UTF8')),'hex')),
  CHECK (("targetObjectId" IS NULL AND "reservationId" IS NULL AND "intentKey" IS NULL AND "targetKey" IS NULL AND attempt = 0)
    OR ("targetObjectId" IS NOT NULL AND "reservationId" IS NOT NULL AND "intentKey" IS NOT NULL AND "targetKey" IS NOT NULL AND attempt > 0))
);
CREATE INDEX "ImageHistoryItem_queue_idx" ON "ImageHistoryItem" ("jobId",state,"leaseExpiresAt",id);
CREATE TABLE "ImageObjectObservation" (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(), "requestId" UUID NOT NULL UNIQUE,
  "itemId" UUID NOT NULL REFERENCES "ImageHistoryItem"(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  kind VARCHAR(24) NOT NULL CHECK (kind IN ('SOURCE','TARGET_READBACK','WRITE_RECONCILIATION')),
  "sourceSnapshotHash" CHAR(64) NOT NULL, "locationId" VARCHAR(128) NOT NULL,
  "physicalNamespace" VARCHAR(1024) NOT NULL, key VARCHAR(512) NOT NULL,
  "readResult" VARCHAR(16) NOT NULL CHECK ("readResult" IN ('FULL','DECLARED','MISSING','FAILED','UNVERIFIED')),
  "byteLength" BIGINT CHECK ("byteLength" > 0), sha256 CHAR(64), "mimeType" VARCHAR(64),
  "versionEvidence" VARCHAR(16) NOT NULL CHECK ("versionEvidence" IN ('UNVERSIONED','VERSIONED','UNKNOWN')),
  "versionId" VARCHAR(1024), etag VARCHAR(1024), "lastModified" VARCHAR(128),
  "writerEvidence" VARCHAR(24) NOT NULL CHECK ("writerEvidence" IN ('NOT_APPLICABLE','QUIESCED','UNKNOWN')),
  "originalWriteToken" UUID, "writerProofSha256" CHAR(64), "recordedBy" VARCHAR(128) NOT NULL,
  "recordedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT "ImageObjectObservation_location_fkey" FOREIGN KEY ("locationId","physicalNamespace") REFERENCES "ImageStorageLocation"(id,"physicalNamespace") ON DELETE RESTRICT ON UPDATE RESTRICT,
  CHECK ("sourceSnapshotHash" ~ '^[0-9a-f]{64}$'), CHECK (sha256 IS NULL OR sha256 ~ '^[0-9a-f]{64}$'),
  CHECK ("readResult" NOT IN ('FULL','DECLARED') OR ("byteLength" IS NOT NULL AND sha256 IS NOT NULL AND "mimeType" IS NOT NULL AND "mimeType" IN ('image/png','image/jpeg','image/webp','image/gif','image/avif'))),
  CHECK (("versionEvidence" = 'VERSIONED') = ("versionId" IS NOT NULL)),
  CHECK ("writerEvidence" <> 'QUIESCED' OR ("originalWriteToken" IS NOT NULL AND "writerProofSha256" IS NOT NULL AND "writerProofSha256" ~ '^[0-9a-f]{64}$'))
);
ALTER TABLE "ImageHistoryItem" ADD CONSTRAINT "ImageHistoryItem_sourceObservationId_fkey" FOREIGN KEY ("sourceObservationId") REFERENCES "ImageObjectObservation"(id) ON DELETE RESTRICT ON UPDATE RESTRICT;
CREATE INDEX "ImageObjectObservation_item_idx" ON "ImageObjectObservation" ("itemId","recordedAt",id);

-- These roots exist before an alias or history job exists. Permanent job inputs
-- survive deletion of their user/job. Current covers remain replaceable sets.
CREATE TABLE "ImageHistoryReference" (
  "urlHash" CHAR(64) NOT NULL, "exactUrl" TEXT NOT NULL,
  "ownerId" VARCHAR(128) NOT NULL, kind VARCHAR(24) NOT NULL CHECK (kind IN ('JOB_INPUT','SITE_COVER')),
  "referenceKey" VARCHAR(256) NOT NULL, permanent BOOLEAN NOT NULL,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY ("urlHash",kind,"referenceKey"),
  CHECK ("urlHash" = encode(sha256(convert_to("exactUrl",'UTF8')),'hex')),
  CHECK (permanent = (kind = 'JOB_INPUT'))
);
CREATE INDEX "ImageHistoryReference_source_idx" ON "ImageHistoryReference" ("ownerId",kind,"referenceKey");
CREATE TABLE "ImageHistoryHold" (
  "itemId" UUID PRIMARY KEY REFERENCES "ImageHistoryItem"(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  "assetId" UUID REFERENCES "ImageAsset"(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  "canvasImportId" VARCHAR(128) REFERENCES "CanvasImportAsset"(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  "releasedAt" TIMESTAMPTZ(3), "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX "ImageHistoryHold_asset_idx" ON "ImageHistoryHold" ("assetId","releasedAt");
CREATE INDEX "ImageHistoryHold_canvas_idx" ON "ImageHistoryHold" ("canvasImportId","releasedAt");

ALTER TABLE "ImageObject" ADD COLUMN provenance VARCHAR(16) NOT NULL DEFAULT 'WRITE',
  ADD COLUMN "sourceObservationId" UUID UNIQUE REFERENCES "ImageObjectObservation"(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  ADD COLUMN "reconciliationObservationId" UUID UNIQUE REFERENCES "ImageObjectObservation"(id) ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "ImageObject" ALTER COLUMN "reservationId" DROP NOT NULL, ALTER COLUMN slot DROP NOT NULL,
  ALTER COLUMN "writeToken" DROP NOT NULL, ALTER COLUMN "writeExpiresAt" DROP NOT NULL;
ALTER TABLE "ImageAsset" DROP CONSTRAINT "ImageAsset_byteLength_check", ADD CONSTRAINT "ImageAsset_byteLength_check" CHECK ("byteLength" > 0);
ALTER TABLE "ImageObject" DROP CONSTRAINT "ImageObject_byteLength_check", ADD CONSTRAINT "ImageObject_byteLength_check" CHECK ("byteLength" > 0),
  DROP CONSTRAINT "ImageObject_putOutcome_check", ADD CONSTRAINT "ImageObject_putOutcome_check" CHECK ("putOutcome" IN ('NOT_STARTED','CONFIRMED','UNKNOWN','NOT_APPLICABLE')),
  ADD CONSTRAINT "ImageObject_provenance_check" CHECK (
    (provenance = 'WRITE' AND "reservationId" IS NOT NULL AND slot IS NOT NULL AND "writeToken" IS NOT NULL AND "writeExpiresAt" IS NOT NULL AND "sourceObservationId" IS NULL AND "byteLength" <= 52428800 AND "putOutcome" <> 'NOT_APPLICABLE')
    OR (provenance = 'OBSERVED' AND "reservationId" IS NULL AND slot IS NULL AND "writeToken" IS NULL AND "writeExpiresAt" IS NULL AND "sourceObservationId" IS NOT NULL AND "reconciliationObservationId" IS NULL AND "putOutcome" IN ('NOT_APPLICABLE','UNKNOWN'))),
  DROP CONSTRAINT "ImageObject_ready_check", ADD CONSTRAINT "ImageObject_ready_check" CHECK (state <> 'READY' OR
    (accounted AND NOT "needsReconciliation" AND "byteLength" <= 52428800 AND
      ((provenance = 'OBSERVED' AND "putOutcome" = 'NOT_APPLICABLE' AND "versionId" IS NULL)
        OR (provenance = 'WRITE' AND ("putOutcome" = 'CONFIRMED' OR ("reconciliationObservationId" IS NOT NULL AND "versionId" IS NULL)))))),
  DROP CONSTRAINT "ImageObject_accounted_check", ADD CONSTRAINT "ImageObject_accounted_check" CHECK (accounted OR
    (state = 'DELETED' AND ("putOutcome" <> 'UNKNOWN' OR "reconciliationObservationId" IS NOT NULL) AND NOT "needsReconciliation" AND "deleteOutcome" IN ('DELETED','MISSING')));
ALTER TABLE "ImageReplicaVerification" DROP CONSTRAINT "ImageReplicaVerification_readerProtocolRevision_check",
  ADD CONSTRAINT "ImageReplicaVerification_readerProtocolRevision_check" CHECK ("readerProtocolRevision" IN (2,3));

CREATE FUNCTION image_lock_reference_epoch() RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  -- One ordered coordination gate precedes quota, history, reservation, original
  -- Canvas identity, asset and object locks. It also fences pre-alias URL roots.
  PERFORM pg_advisory_xact_lock(182736,3);
END;
$$;
CREATE OR REPLACE FUNCTION image_lock_quota() RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  PERFORM image_lock_reference_epoch();
  PERFORM 1 FROM "ImageQuota" WHERE scope = 'images' FOR UPDATE;
  IF NOT FOUND THEN PERFORM image_raise('IMAGE_INTERNAL_ERROR'); END IF;
END;
$$;
CREATE FUNCTION image_reference_epoch_trigger() RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN PERFORM image_lock_reference_epoch(); RETURN NULL; END;
$$;
CREATE TRIGGER "GenerationJob_image_epoch" BEFORE INSERT OR UPDATE OF "sourceImageUrls" OR DELETE ON "GenerationJob" FOR EACH STATEMENT EXECUTE FUNCTION image_reference_epoch_trigger();
CREATE TRIGGER "GenerationImage_image_epoch" BEFORE INSERT OR UPDATE OF "mediaAssetId","showcaseStatus" OR DELETE ON "GenerationImage" FOR EACH STATEMENT EXECUTE FUNCTION image_reference_epoch_trigger();
CREATE TRIGGER "User_image_epoch" BEFORE DELETE ON "User" FOR EACH STATEMENT EXECUTE FUNCTION image_reference_epoch_trigger();
CREATE TRIGGER "Conversation_image_epoch" BEFORE DELETE ON "Conversation" FOR EACH STATEMENT EXECUTE FUNCTION image_reference_epoch_trigger();
CREATE TRIGGER "Canvas_image_epoch" BEFORE INSERT OR UPDATE OR DELETE ON "Canvas" FOR EACH STATEMENT EXECUTE FUNCTION image_reference_epoch_trigger();
CREATE TRIGGER "CanvasRun_image_epoch" BEFORE INSERT OR UPDATE OR DELETE ON "CanvasRun" FOR EACH STATEMENT EXECUTE FUNCTION image_reference_epoch_trigger();
CREATE TRIGGER "CanvasImportAsset_image_epoch" BEFORE INSERT OR UPDATE OR DELETE ON "CanvasImportAsset" FOR EACH STATEMENT EXECUTE FUNCTION image_reference_epoch_trigger();
CREATE TRIGGER "LoginCoverConfig_image_epoch" BEFORE INSERT OR UPDATE OR DELETE ON "LoginCoverConfig" FOR EACH STATEMENT EXECUTE FUNCTION image_reference_epoch_trigger();
CREATE TRIGGER "ImageUrlAlias_epoch" BEFORE INSERT OR UPDATE OR DELETE ON "ImageUrlAlias" FOR EACH STATEMENT EXECUTE FUNCTION image_reference_epoch_trigger();
CREATE TRIGGER "ImageReference_epoch" BEFORE INSERT OR UPDATE OR DELETE ON "ImageReference" FOR EACH STATEMENT EXECUTE FUNCTION image_reference_epoch_trigger();
CREATE TRIGGER "CanvasSavedAssetUse_image_epoch" BEFORE INSERT OR UPDATE OR DELETE ON "CanvasSavedAssetUse" FOR EACH STATEMENT EXECUTE FUNCTION image_reference_epoch_trigger();
CREATE TRIGGER "CanvasJobAssetUse_image_epoch" BEFORE INSERT OR UPDATE OR DELETE ON "CanvasJobAssetUse" FOR EACH STATEMENT EXECUTE FUNCTION image_reference_epoch_trigger();
CREATE TRIGGER "ImageAsset_epoch" BEFORE INSERT OR UPDATE OR DELETE ON "ImageAsset" FOR EACH STATEMENT EXECUTE FUNCTION image_reference_epoch_trigger();
CREATE TRIGGER "ImageObject_epoch" BEFORE INSERT OR UPDATE OR DELETE ON "ImageObject" FOR EACH STATEMENT EXECUTE FUNCTION image_reference_epoch_trigger();
CREATE TRIGGER "ImageWriteReservation_epoch" BEFORE INSERT OR UPDATE OR DELETE ON "ImageWriteReservation" FOR EACH STATEMENT EXECUTE FUNCTION image_reference_epoch_trigger();
CREATE TRIGGER "ImageHistoryJob_epoch" BEFORE INSERT OR UPDATE OR DELETE ON "ImageHistoryJob" FOR EACH STATEMENT EXECUTE FUNCTION image_reference_epoch_trigger();
CREATE TRIGGER "ImageHistoryItem_epoch" BEFORE INSERT OR UPDATE OR DELETE ON "ImageHistoryItem" FOR EACH STATEMENT EXECUTE FUNCTION image_reference_epoch_trigger();
CREATE TRIGGER "ImageHistoryReference_epoch" BEFORE INSERT OR UPDATE OR DELETE ON "ImageHistoryReference" FOR EACH STATEMENT EXECUTE FUNCTION image_reference_epoch_trigger();
CREATE TRIGGER "ImageHistoryHold_epoch" BEFORE INSERT OR UPDATE OR DELETE ON "ImageHistoryHold" FOR EACH STATEMENT EXECUTE FUNCTION image_reference_epoch_trigger();
CREATE TRIGGER "ImageObjectObservation_epoch" BEFORE INSERT OR UPDATE OR DELETE ON "ImageObjectObservation" FOR EACH STATEMENT EXECUTE FUNCTION image_reference_epoch_trigger();

CREATE FUNCTION image_history_bytes(p_value TEXT) RETURNS BIGINT LANGUAGE plpgsql IMMUTABLE AS $$
BEGIN
  IF p_value IS NULL OR length(p_value) NOT BETWEEN 1 AND 19 OR p_value !~ '^[1-9][0-9]*$' OR p_value ~ '[[:cntrl:]]'
    OR p_value::numeric > 9223372036854775807 THEN PERFORM image_raise('IMAGE_INVALID_INPUT'); END IF;
  RETURN p_value::bigint;
END;
$$;
CREATE FUNCTION image_history_digest(p JSONB) RETURNS TEXT LANGUAGE SQL IMMUTABLE AS $$
  SELECT encode(sha256(convert_to(p::text,'UTF8')),'hex')
$$;
CREATE FUNCTION image_object_verified(o "ImageObject") RETURNS BOOLEAN LANGUAGE SQL STABLE AS $$
  SELECT o."versionId" IS NULL AND NOT o."needsReconciliation" AND o."byteLength" <= 52428800 AND
    ((o.provenance = 'WRITE' AND (o."putOutcome" = 'CONFIRMED' OR EXISTS (
      SELECT 1 FROM "ImageObjectObservation" x WHERE x.id = o."reconciliationObservationId" AND x.kind = 'WRITE_RECONCILIATION'
        AND x."readResult" = 'FULL' AND x."writerEvidence" = 'QUIESCED' AND x."originalWriteToken" = o."writeToken"
        AND x."versionEvidence" = 'UNVERSIONED' AND x."byteLength" = o."byteLength" AND x.sha256 = o.sha256
        AND x."locationId" = o."locationId" AND x.key = o.key)))
    OR (o.provenance = 'OBSERVED' AND o."putOutcome" = 'NOT_APPLICABLE' AND EXISTS (
      SELECT 1 FROM "ImageObjectObservation" x WHERE x.id = o."sourceObservationId" AND x.kind = 'SOURCE'
        AND x."readResult" = 'FULL' AND x."versionEvidence" = 'UNVERSIONED' AND x."byteLength" = o."byteLength"
        AND x.sha256 = o.sha256 AND x."locationId" = o."locationId" AND x.key = o.key)))
$$;

CREATE FUNCTION image_history_guard_immutable() RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  PERFORM image_raise('IMAGE_HISTORY_CONFLICT'); RETURN NULL;
END;
$$;
CREATE TRIGGER "ImageObjectObservation_immutable" BEFORE UPDATE OR DELETE ON "ImageObjectObservation" FOR EACH ROW EXECUTE FUNCTION image_history_guard_immutable();
CREATE FUNCTION image_history_reference_guard() RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'UPDATE' OR (TG_OP = 'DELETE' AND OLD.permanent) THEN PERFORM image_raise('IMAGE_REFERENCE_CONFLICT'); END IF;
  RETURN OLD;
END;
$$;
CREATE TRIGGER "ImageHistoryReference_immutable" BEFORE UPDATE OR DELETE ON "ImageHistoryReference" FOR EACH ROW EXECUTE FUNCTION image_history_reference_guard();
CREATE FUNCTION image_history_job_guard() RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' OR (to_jsonb(NEW)-ARRAY['cursor','scanComplete','state','updatedAt']) IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['cursor','scanComplete','state','updatedAt'])
    OR (OLD."scanComplete" AND NOT NEW."scanComplete") OR (OLD.cursor IS NOT NULL AND (NEW.cursor IS NULL OR NEW.cursor < OLD.cursor))
    OR (OLD.state = 'CANCELLED' AND NEW.state <> 'CANCELLED') THEN PERFORM image_raise('IMAGE_HISTORY_CONFLICT'); END IF;
  NEW."updatedAt" := clock_timestamp(); RETURN NEW;
END;
$$;
CREATE TRIGGER "ImageHistoryJob_guard" BEFORE UPDATE OR DELETE ON "ImageHistoryJob" FOR EACH ROW EXECUTE FUNCTION image_history_job_guard();
CREATE FUNCTION image_history_item_guard() RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' OR (to_jsonb(NEW)-ARRAY['workerId','token','leaseExpiresAt','sourceObservationId','assetId','sourceObjectId','targetObjectId','reservationId','attempt','intentKey','targetKey','replicaVerificationId','retirementJobId','state','errorCode','updatedAt'])
    IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['workerId','token','leaseExpiresAt','sourceObservationId','assetId','sourceObjectId','targetObjectId','reservationId','attempt','intentKey','targetKey','replicaVerificationId','retirementJobId','state','errorCode','updatedAt'])
    OR (OLD."assetId" IS NOT NULL AND NEW."assetId" IS DISTINCT FROM OLD."assetId")
    OR (OLD."sourceObjectId" IS NOT NULL AND NEW."sourceObjectId" IS DISTINCT FROM OLD."sourceObjectId")
    OR (OLD."sourceObservationId" IS NOT NULL AND NEW."sourceObservationId" IS DISTINCT FROM OLD."sourceObservationId")
    OR (OLD."targetObjectId" IS NOT NULL AND (NEW."targetObjectId" IS DISTINCT FROM OLD."targetObjectId" OR NEW."reservationId" IS DISTINCT FROM OLD."reservationId"
      OR NEW."intentKey" IS DISTINCT FROM OLD."intentKey" OR NEW."targetKey" IS DISTINCT FROM OLD."targetKey" OR NEW.attempt <> OLD.attempt))
    OR (OLD."replicaVerificationId" IS NOT NULL AND NEW."replicaVerificationId" IS DISTINCT FROM OLD."replicaVerificationId")
    OR (OLD."retirementJobId" IS NOT NULL AND NEW."retirementJobId" IS DISTINCT FROM OLD."retirementJobId") THEN PERFORM image_raise('IMAGE_HISTORY_CONFLICT'); END IF;
  NEW."updatedAt" := clock_timestamp(); RETURN NEW;
END;
$$;
CREATE TRIGGER "ImageHistoryItem_guard" BEFORE UPDATE OR DELETE ON "ImageHistoryItem" FOR EACH ROW EXECUTE FUNCTION image_history_item_guard();
CREATE FUNCTION image_history_hold_guard() RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE i "ImageHistoryItem"; j "ImageHistoryJob"; a "ImageAsset";
BEGIN
  IF TG_OP = 'DELETE' OR NEW."itemId" <> OLD."itemId" OR NEW."canvasImportId" IS DISTINCT FROM OLD."canvasImportId" OR NEW."createdAt" <> OLD."createdAt"
    OR (OLD."assetId" IS NOT NULL AND NEW."assetId" IS DISTINCT FROM OLD."assetId") OR (OLD."releasedAt" IS NOT NULL AND NEW."releasedAt" IS DISTINCT FROM OLD."releasedAt") THEN PERFORM image_raise('IMAGE_HISTORY_CONFLICT'); END IF;
  IF NEW."releasedAt" IS NOT NULL AND OLD."releasedAt" IS NULL THEN
    SELECT * INTO i FROM "ImageHistoryItem" WHERE id = NEW."itemId";
    SELECT * INTO j FROM "ImageHistoryJob" WHERE id = i."jobId";
    SELECT * INTO a FROM "ImageAsset" WHERE id = i."assetId";
    IF i.state NOT IN ('SOURCE_RETAINED','RETIREMENT_REQUESTED') OR i."assetId" IS DISTINCT FROM NEW."assetId"
      OR a.id IS NULL OR a.state <> 'AVAILABLE' OR i."sourceObservationId" IS NULL OR i."sourceObjectId" IS NULL
      OR (i."subjectKind" = 'GENERATED' AND i."exactUrl" IS NULL)
      OR NOT EXISTS (SELECT 1 FROM "ImageUrlAlias" WHERE url = j."publicUrlBase"||'/media/images/'||a."publicToken" AND "assetId" = a.id)
      OR (i."exactUrl" IS NOT NULL AND NOT EXISTS (SELECT 1 FROM "ImageUrlAlias" WHERE url = i."exactUrl" AND "assetId" = a.id))
      OR (i."subjectKind" = 'GENERATED' AND NOT EXISTS (SELECT 1 FROM "ImageGenerationBinding" WHERE "assetId" = a.id AND "imageId" = i."subjectId" AND "jobId" = i.snapshot->>'jobId'))
      OR (i."subjectKind" = 'CANVAS_IMPORT' AND NOT EXISTS (SELECT 1 FROM "CanvasImportAsset" WHERE id = i."subjectId" AND "mediaAssetId" = a.id))
      OR (j.mode = 'COPY' AND NOT EXISTS (SELECT 1 FROM "ImageReplicaVerification" v WHERE v.id = i."replicaVerificationId" AND v."assetId" = a.id AND v."sourceObjectId" = i."sourceObjectId" AND v."targetObjectId" = a."activeObjectId" AND v."readerProtocolRevision" = 3 AND NOT v.revoked))
      OR EXISTS (SELECT 1 FROM "ImageHistoryReference" r JOIN "ImageUrlAlias" u ON u.url = r."exactUrl" AND u."assetId" = a.id
        WHERE NOT EXISTS (SELECT 1 FROM "ImageReference" f WHERE f."assetId" = a.id AND f.kind = r.kind AND f."referenceKey" = r."referenceKey" AND f."ownerId" = r."ownerId" AND f.permanent = r.permanent))
      THEN PERFORM image_raise('IMAGE_HISTORY_CONFLICT'); END IF;
    NEW."releasedAt" := clock_timestamp();
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER "ImageHistoryHold_guard" BEFORE UPDATE OR DELETE ON "ImageHistoryHold" FOR EACH ROW EXECUTE FUNCTION image_history_hold_guard();

CREATE OR REPLACE FUNCTION image_bridge_job_inputs() RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE v_url TEXT; v_id UUID;
BEGIN
  PERFORM image_lock_reference_epoch();
  FOR v_url IN SELECT DISTINCT u FROM unnest(NEW."sourceImageUrls") u WHERE u ~ '^https?://' ORDER BY u LOOP
    INSERT INTO "ImageHistoryReference" ("urlHash","exactUrl","ownerId",kind,"referenceKey",permanent)
      VALUES (encode(sha256(convert_to(v_url,'UTF8')),'hex'),v_url,NEW."userId",'JOB_INPUT','job:'||NEW.id,true) ON CONFLICT DO NOTHING;
  END LOOP;
  -- Asset ordering is shared with every reference writer and cleanup.
  FOR v_id IN SELECT DISTINCT a."assetId" FROM "ImageUrlAlias" a WHERE a.url = ANY(NEW."sourceImageUrls") ORDER BY a."assetId" LOOP
    INSERT INTO "ImageReference" ("assetId","ownerId",kind,"referenceKey",permanent)
      VALUES (v_id,NEW."userId",'JOB_INPUT','job:'||NEW.id,true) ON CONFLICT DO NOTHING;
  END LOOP;
  RETURN NULL;
END;
$$;
CREATE OR REPLACE FUNCTION image_bridge_site_cover() RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE v_scope TEXT; v_id UUID;
BEGIN
  PERFORM image_lock_reference_epoch(); v_scope := CASE WHEN TG_OP = 'DELETE' THEN OLD.scope ELSE NEW.scope END;
  DELETE FROM "ImageHistoryReference" WHERE "ownerId" = 'site' AND kind = 'SITE_COVER' AND "referenceKey" = 'login-cover:'||v_scope;
  IF TG_OP <> 'DELETE' AND NEW.mode = 'custom' AND NEW."customUrl" ~ '^https?://' THEN
    INSERT INTO "ImageHistoryReference" ("urlHash","exactUrl","ownerId",kind,"referenceKey",permanent)
      VALUES (encode(sha256(convert_to(NEW."customUrl",'UTF8')),'hex'),NEW."customUrl",'site','SITE_COVER','login-cover:'||v_scope,false);
    SELECT "assetId" INTO v_id FROM "ImageUrlAlias" WHERE url = NEW."customUrl";
  END IF;
  PERFORM image_replace_references(jsonb_build_object('ownerId','site','kind','SITE_COVER','referenceKey','login-cover:'||v_scope,'assetIds',CASE WHEN v_id IS NULL THEN '[]'::jsonb ELSE jsonb_build_array(v_id) END));
  RETURN NULL;
END;
$$;
CREATE OR REPLACE FUNCTION image_bridge_alias_history() RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE r "ImageHistoryReference";
BEGIN
  PERFORM image_lock_reference_epoch();
  FOR r IN SELECT * FROM "ImageHistoryReference" WHERE "urlHash" = encode(sha256(convert_to(NEW.url,'UTF8')),'hex') AND "exactUrl" = NEW.url ORDER BY kind,"referenceKey" LOOP
    INSERT INTO "ImageReference" ("assetId","ownerId",kind,"referenceKey",permanent)
      VALUES (NEW."assetId",r."ownerId",r.kind,r."referenceKey",r.permanent) ON CONFLICT DO NOTHING;
  END LOOP;
  PERFORM image_bridge_known_history(NEW."assetId"); RETURN NULL;
END;
$$;
INSERT INTO "ImageHistoryReference" ("urlHash","exactUrl","ownerId",kind,"referenceKey",permanent,"createdAt")
  SELECT DISTINCT encode(sha256(convert_to(u,'UTF8')),'hex'),u,j."userId",'JOB_INPUT','job:'||j.id,true,j."createdAt"
  FROM "GenerationJob" j CROSS JOIN LATERAL unnest(j."sourceImageUrls") u WHERE u ~ '^https?://' ON CONFLICT DO NOTHING;
INSERT INTO "ImageHistoryReference" ("urlHash","exactUrl","ownerId",kind,"referenceKey",permanent)
  SELECT encode(sha256(convert_to("customUrl",'UTF8')),'hex'),"customUrl",'site','SITE_COVER','login-cover:'||scope,false
  FROM "LoginCoverConfig" WHERE mode = 'custom' AND "customUrl" ~ '^https?://' ON CONFLICT DO NOTHING;
INSERT INTO "ImageReference" ("assetId","ownerId",kind,"referenceKey",permanent)
  SELECT a."assetId",r."ownerId",r.kind,r."referenceKey",r.permanent FROM "ImageHistoryReference" r JOIN "ImageUrlAlias" a ON a.url = r."exactUrl"
  JOIN "ImageAsset" x ON x.id = a."assetId" AND x.state = 'AVAILABLE' ON CONFLICT DO NOTHING;

-- Effective C1/C2 guards extended to observed/reconciled provenance.
CREATE OR REPLACE FUNCTION image_raise(p_code TEXT) RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  IF p_code NOT IN ('IMAGE_INVALID_INPUT','IMAGE_QUOTA_EXCEEDED','IMAGE_RESERVATION_CONFLICT','IMAGE_RESERVATION_EXPIRED','IMAGE_WRITE_CONFLICT','IMAGE_UNAVAILABLE','IMAGE_LOCATION_CONFLICT','IMAGE_REFERENCE_CONFLICT','IMAGE_STORAGE_UNAVAILABLE','IMAGE_INTERNAL_ERROR','IMAGE_POLICY_CONFLICT','IMAGE_PREVIEW_EXPIRED','IMAGE_MAINTENANCE_CONFLICT','IMAGE_POLICY_DISABLED','IMAGE_HISTORY_CONFLICT','IMAGE_OBSERVATION_REQUIRED','IMAGE_HISTORY_BLOCKED','IMAGE_READER_INCOMPATIBLE') THEN p_code := 'IMAGE_INTERNAL_ERROR'; END IF;
  RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = p_code, CONSTRAINT = p_code;
END;
$$;

CREATE OR REPLACE FUNCTION image_assert_reservation_balance() RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE v_id UUID; v_res "ImageWriteReservation"; v_expected BIGINT;
BEGIN
  IF TG_TABLE_NAME = 'ImageObject' THEN
    IF NEW.provenance = 'OBSERVED' THEN RETURN NULL; END IF;
    v_id := NEW."reservationId";
  ELSE v_id := NEW.id; END IF;
  SELECT * INTO v_res FROM "ImageWriteReservation" WHERE id = v_id;
  SELECT COALESCE(sum(amount),0) INTO v_expected FROM unnest(v_res."slotBytes") WITH ORDINALITY AS slots(amount,n)
    WHERE NOT EXISTS (SELECT 1 FROM "ImageObject" WHERE "reservationId" = v_id AND slot = slots.n - 1);
  IF v_res.state = 'CLOSED' THEN v_expected := 0; END IF;
  IF v_res.id IS NULL OR v_res."remainingBytes" <> v_expected THEN PERFORM image_raise('IMAGE_RESERVATION_CONFLICT'); END IF;
  RETURN NULL;
END;
$$;

CREATE OR REPLACE FUNCTION image_account_delta() RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE v_used BIGINT := 0; v_reserved BIGINT := 0; v_quota "ImageQuota"; v_limit BIGINT;
BEGIN
  IF TG_TABLE_NAME = 'ImageObject' THEN
    v_used := CASE WHEN NEW.accounted THEN NEW."byteLength" ELSE 0 END - CASE WHEN TG_OP = 'UPDATE' AND OLD.accounted THEN OLD."byteLength" ELSE 0 END;
  ELSE
    v_reserved := NEW."remainingBytes" - CASE WHEN TG_OP = 'UPDATE' THEN OLD."remainingBytes" ELSE 0 END;
  END IF;
  IF v_used = 0 AND v_reserved = 0 THEN RETURN NEW; END IF;
  SELECT * INTO v_quota FROM "ImageQuota" WHERE scope = 'images' FOR UPDATE;
  SELECT "limitBytes" INTO v_limit FROM "ImageStoragePolicy" WHERE scope = 'images';
  IF v_quota.scope IS NULL OR v_limit IS NULL OR v_quota."usedBytes" + v_used < 0 OR v_quota."reservedBytes" + v_reserved < 0 THEN PERFORM image_raise('IMAGE_INTERNAL_ERROR'); END IF;
  IF (v_used > 0 OR v_reserved > 0) AND NOT (TG_TABLE_NAME = 'ImageObject' AND TG_OP = 'INSERT' AND to_jsonb(NEW)->>'provenance' = 'OBSERVED'
    AND EXISTS (SELECT 1 FROM "ImageObjectObservation" x JOIN "ImageHistoryItem" i ON i.id = x."itemId" JOIN "ImageHistoryHold" h ON h."itemId" = i.id
      WHERE x.id = (to_jsonb(NEW)->>'sourceObservationId')::uuid AND x.kind = 'SOURCE' AND x."readResult" IN ('FULL','DECLARED')
        AND i."sourceObservationId" = x.id AND i."assetId" = (to_jsonb(NEW)->>'assetId')::uuid AND h."assetId" = i."assetId" AND h."releasedAt" IS NULL
        AND x."byteLength" = (to_jsonb(NEW)->>'byteLength')::bigint AND x.sha256 = to_jsonb(NEW)->>'sha256'
        AND x."physicalNamespace" = to_jsonb(NEW)->>'physicalNamespace' AND x.key = to_jsonb(NEW)->>'key')) AND v_quota."usedBytes"::numeric + v_quota."reservedBytes" + v_used + v_reserved > v_limit THEN PERFORM image_raise('IMAGE_QUOTA_EXCEEDED'); END IF;
  UPDATE "ImageQuota" SET "usedBytes" = "usedBytes" + v_used, "reservedBytes" = "reservedBytes" + v_reserved WHERE scope = 'images';
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION image_guard_object() RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE v_asset "ImageAsset"; v_res "ImageWriteReservation"; v_provider TEXT; v_observation "ImageObjectObservation"; v_item "ImageHistoryItem"; v_reconciled BOOLEAN := false;
BEGIN
  IF TG_OP = 'DELETE' THEN PERFORM image_raise('IMAGE_WRITE_CONFLICT'); END IF;
  SELECT * INTO v_asset FROM "ImageAsset" WHERE id = NEW."assetId";
  IF v_asset.id IS NULL OR NEW."byteLength" <> v_asset."byteLength" OR NEW.sha256 <> v_asset.sha256 OR NEW."mimeType" <> v_asset."mimeType" THEN PERFORM image_raise('IMAGE_WRITE_CONFLICT'); END IF;
  SELECT provider INTO v_provider FROM "ImageStorageLocation" WHERE id = NEW."locationId";
  IF v_provider = 'LOCAL' AND NEW."versionId" IS NOT NULL THEN PERFORM image_raise('IMAGE_LOCATION_CONFLICT'); END IF;
  IF TG_OP = 'INSERT' AND NEW.provenance = 'OBSERVED' THEN
    SELECT * INTO v_observation FROM "ImageObjectObservation" WHERE id = NEW."sourceObservationId";
    SELECT * INTO v_item FROM "ImageHistoryItem" WHERE id = v_observation."itemId";
    IF v_observation.id IS NULL OR v_observation.kind <> 'SOURCE' OR v_observation."readResult" NOT IN ('FULL','DECLARED')
      OR v_item."sourceObservationId" IS DISTINCT FROM v_observation.id OR v_item."assetId" IS DISTINCT FROM NEW."assetId"
      OR v_item."leaseExpiresAt" <= clock_timestamp() OR NOT EXISTS (SELECT 1 FROM "ImageHistoryHold" WHERE "itemId" = v_item.id AND "assetId" = NEW."assetId" AND "releasedAt" IS NULL)
      OR NEW."byteLength" IS DISTINCT FROM v_observation."byteLength" OR NEW.sha256 IS DISTINCT FROM v_observation.sha256 OR NEW."mimeType" IS DISTINCT FROM v_observation."mimeType"
      OR NEW."locationId" IS DISTINCT FROM v_observation."locationId" OR NEW."physicalNamespace" IS DISTINCT FROM v_observation."physicalNamespace" OR NEW.key IS DISTINCT FROM v_observation.key
      OR NEW."versionId" IS DISTINCT FROM v_observation."versionId" OR NEW.state NOT IN ('READY','UNKNOWN') OR NOT NEW.accounted
      OR NEW."deleteToken" IS NOT NULL OR NEW."deleteOutcome" <> 'NOT_STARTED' OR NEW."reconciliationObservationId" IS NOT NULL
      OR (NEW.state = 'READY' AND (v_observation."readResult" <> 'FULL' OR v_observation."versionEvidence" <> 'UNVERSIONED' OR NEW."needsReconciliation" OR NEW."putOutcome" <> 'NOT_APPLICABLE'))
      OR (NEW.state = 'UNKNOWN' AND NOT NEW."needsReconciliation") THEN PERFORM image_raise('IMAGE_OBSERVATION_REQUIRED'); END IF;
    NEW."updatedAt" := clock_timestamp(); RETURN NEW;
  END IF;
  IF TG_OP = 'INSERT' THEN
    IF NEW.provenance <> 'WRITE' OR NEW."sourceObservationId" IS NOT NULL OR NEW."reconciliationObservationId" IS NOT NULL THEN PERFORM image_raise('IMAGE_WRITE_CONFLICT'); END IF;
    SELECT * INTO v_res FROM "ImageWriteReservation" WHERE id = NEW."reservationId";
    IF v_res.id IS NULL OR v_res.state <> 'ACTIVE' OR v_res.token <> NEW."writeToken" OR v_res."leaseExpiresAt" <= clock_timestamp()
      OR NEW.slot >= cardinality(v_res."slotBytes") OR NEW."byteLength" > v_res."slotBytes"[NEW.slot + 1] OR v_res."ownerId" <> v_asset."ownerId"
      OR NEW.state <> 'WRITING' OR NEW."putOutcome" <> 'NOT_STARTED' OR NOT NEW.accounted OR NEW."writeExpiresAt" IS DISTINCT FROM v_res."leaseExpiresAt" THEN PERFORM image_raise('IMAGE_RESERVATION_CONFLICT'); END IF;
  ELSE
    IF NEW."reconciliationObservationId" IS DISTINCT FROM OLD."reconciliationObservationId" THEN
      SELECT * INTO v_observation FROM "ImageObjectObservation" WHERE id = NEW."reconciliationObservationId";
      SELECT * INTO v_item FROM "ImageHistoryItem" WHERE id = v_observation."itemId";
      IF OLD.provenance <> 'WRITE' OR OLD."reconciliationObservationId" IS NOT NULL OR OLD.state NOT IN ('WRITING','UNKNOWN')
        OR v_item."targetObjectId" IS DISTINCT FROM OLD.id OR v_item.state <> 'RECONCILING' OR v_item."leaseExpiresAt" <= clock_timestamp()
        OR v_observation.kind IS DISTINCT FROM 'WRITE_RECONCILIATION' OR v_observation."readResult" IS DISTINCT FROM 'FULL'
        OR v_observation."writerEvidence" IS DISTINCT FROM 'QUIESCED' OR v_observation."originalWriteToken" IS DISTINCT FROM OLD."writeToken"
        OR v_observation."versionEvidence" IS DISTINCT FROM 'UNVERSIONED' OR v_observation."byteLength" IS DISTINCT FROM OLD."byteLength"
        OR v_observation.sha256 IS DISTINCT FROM OLD.sha256 OR v_observation."mimeType" IS DISTINCT FROM OLD."mimeType"
        OR v_observation."locationId" IS DISTINCT FROM OLD."locationId" OR v_observation.key IS DISTINCT FROM OLD.key
        OR NEW.state <> 'READY' OR NOT NEW.accounted OR NEW."needsReconciliation" OR NEW."putOutcome" IS DISTINCT FROM OLD."putOutcome" THEN PERFORM image_raise('IMAGE_OBSERVATION_REQUIRED'); END IF;
      v_reconciled := true;
    END IF;
    IF NEW.provenance IS DISTINCT FROM OLD.provenance OR NEW."sourceObservationId" IS DISTINCT FROM OLD."sourceObservationId" THEN PERFORM image_raise('IMAGE_WRITE_CONFLICT'); END IF;
    IF NEW.id <> OLD.id OR NEW."assetId" <> OLD."assetId" OR NEW."reservationId" IS DISTINCT FROM OLD."reservationId" OR NEW.slot IS DISTINCT FROM OLD.slot OR NEW."locationId" <> OLD."locationId"
      OR NEW."physicalNamespace" <> OLD."physicalNamespace" OR NEW.key <> OLD.key OR NEW."byteLength" <> OLD."byteLength" OR NEW.sha256 <> OLD.sha256 OR NEW."mimeType" <> OLD."mimeType"
      OR NEW."writeToken" IS DISTINCT FROM OLD."writeToken" OR NEW."writeExpiresAt" IS DISTINCT FROM OLD."writeExpiresAt" OR NEW."createdAt" <> OLD."createdAt"
      OR (OLD."versionId" IS NOT NULL AND NEW."versionId" IS DISTINCT FROM OLD."versionId") OR (NOT OLD.accounted AND NEW.accounted) THEN PERFORM image_raise('IMAGE_WRITE_CONFLICT'); END IF;
    IF OLD."putOutcome" = 'UNKNOWN' AND (NEW."putOutcome" <> 'UNKNOWN' OR ((NOT NEW.accounted OR NOT NEW."needsReconciliation") AND NOT (v_reconciled OR (OLD."reconciliationObservationId" IS NOT NULL AND image_object_verified(OLD))))) THEN PERFORM image_raise('IMAGE_WRITE_CONFLICT'); END IF;
    IF OLD."putOutcome" IN ('CONFIRMED','NOT_APPLICABLE') AND NEW."putOutcome" IS DISTINCT FROM OLD."putOutcome" THEN PERFORM image_raise('IMAGE_WRITE_CONFLICT'); END IF;
    IF NEW.state <> OLD.state AND NOT v_reconciled AND NOT ((OLD.state = 'WRITING' AND NEW.state IN ('READY','UNKNOWN','DELETED')) OR (OLD.state IN ('READY','UNKNOWN') AND NEW.state = 'DELETING') OR (OLD.state = 'DELETING' AND NEW.state = 'DELETED')) THEN PERFORM image_raise('IMAGE_WRITE_CONFLICT'); END IF;
    IF NEW.state <> 'READY' AND OLD.state = 'READY' AND v_asset."activeObjectId" = OLD.id AND v_asset.state = 'AVAILABLE' THEN PERFORM image_raise('IMAGE_REFERENCE_CONFLICT'); END IF;
    IF NEW.state = 'READY' AND OLD.state <> 'READY' AND NOT v_reconciled AND (OLD."writeExpiresAt" <= clock_timestamp() OR OLD."putOutcome" = 'UNKNOWN') THEN PERFORM image_raise('IMAGE_RESERVATION_EXPIRED'); END IF;
    IF OLD.accounted AND NOT NEW.accounted AND NEW."putOutcome" = 'NOT_STARTED' AND OLD."reconciliationObservationId" IS NULL
      AND (OLD.state <> 'WRITING' OR OLD."writeExpiresAt" <= clock_timestamp()) THEN PERFORM image_raise('IMAGE_WRITE_CONFLICT'); END IF;
  END IF;
  NEW."updatedAt" := clock_timestamp(); RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION image_cleanup_reason(p_asset UUID) RETURNS TEXT LANGUAGE plpgsql STABLE AS $$
DECLARE a "ImageAsset"; c "CanvasImportAsset"; v_now TIMESTAMPTZ := clock_timestamp();
BEGIN
  SELECT * INTO a FROM "ImageAsset" WHERE id = p_asset;
  IF a.id IS NULL OR a.state NOT IN ('AVAILABLE','QUARANTINED') THEN RETURN 'UNAVAILABLE'; END IF;
  IF EXISTS (SELECT 1 FROM "ImageHistoryHold" WHERE "assetId" = a.id AND "releasedAt" IS NULL) THEN RETURN 'ADOPTION_PENDING'; END IF;
  IF a."byteLength" > 52428800 THEN RETURN 'UNSUPPORTED_SIZE'; END IF;
  IF image_has_historical_reference(a.id) THEN RETURN 'REFERENCED'; END IF;
  IF a."copyProtectedUntil" > v_now THEN RETURN 'COPYING'; END IF;
  IF NOT EXISTS (SELECT 1 FROM "ImageObject" WHERE "assetId" = a.id AND accounted) THEN RETURN 'NO_OBJECTS'; END IF;
  IF EXISTS (SELECT 1 FROM "ImageObject" WHERE "assetId" = a.id AND accounted AND "versionId" IS NOT NULL) THEN RETURN 'VERSIONED'; END IF;
  IF EXISTS (SELECT 1 FROM "ImageObject" WHERE "assetId" = a.id AND accounted AND (NOT image_object_verified("ImageObject") OR state = 'UNKNOWN')) THEN RETURN 'UNKNOWN_PUT'; END IF;
  IF EXISTS (SELECT 1 FROM "ImageObject" o LEFT JOIN "ImageWriteReservation" r ON r.id = o."reservationId" WHERE o."assetId" = a.id AND o.accounted AND (o.state <> 'READY' OR (o.provenance = 'WRITE' AND (o."writeExpiresAt" > v_now OR r.id IS NULL OR r.state <> 'CLOSED')) )) THEN RETURN 'ACTIVE_WRITE'; END IF;
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

CREATE OR REPLACE FUNCTION image_retirement_reason(p_verification UUID) RETURNS TEXT LANGUAGE plpgsql STABLE AS $$
DECLARE v "ImageReplicaVerification"; a "ImageAsset"; s "ImageObject"; t "ImageObject"; v_now TIMESTAMPTZ := clock_timestamp();
BEGIN
  SELECT * INTO v FROM "ImageReplicaVerification" WHERE id = p_verification;
  IF v.id IS NULL OR v.revoked OR v."readerProtocolRevision" <> 3 THEN RETURN 'VERIFICATION_REQUIRED'; END IF;
  SELECT * INTO a FROM "ImageAsset" WHERE id = v."assetId";
  SELECT * INTO s FROM "ImageObject" WHERE id = v."sourceObjectId";
  SELECT * INTO t FROM "ImageObject" WHERE id = v."targetObjectId";
  IF a.state <> 'AVAILABLE' OR a."activeObjectId" IS DISTINCT FROM t.id OR s.id = t.id OR s."assetId" <> a.id OR t."assetId" <> a.id OR t.state <> 'READY' OR NOT t.accounted
    OR s.state NOT IN ('READY','DELETING') OR NOT s.accounted OR s."byteLength" <> v."byteLength" OR t."byteLength" <> v."byteLength" OR s.sha256 <> v.sha256 OR t.sha256 <> v.sha256 OR s."mimeType" <> t."mimeType" THEN RETURN 'VERIFICATION_REQUIRED'; END IF;
  IF s."versionId" IS NOT NULL OR t."versionId" IS NOT NULL THEN RETURN 'VERSIONED'; END IF;
  IF NOT image_object_verified(s) OR NOT image_object_verified(t) THEN RETURN 'UNKNOWN_PUT'; END IF;
  IF EXISTS (SELECT 1 FROM "ImageHistoryHold" WHERE "assetId" = a.id AND "releasedAt" IS NULL) THEN RETURN 'ADOPTION_PENDING'; END IF;
  IF s."writeExpiresAt" > v_now OR a."copyProtectedUntil" > v_now OR EXISTS (SELECT 1 FROM "ImageObject" WHERE "assetId" = a.id AND accounted AND state IN ('WRITING','UNKNOWN')) THEN RETURN 'COPYING'; END IF;
  IF s."readProtectedUntil" > v_now THEN RETURN 'READING'; END IF;
  IF image_alias_manifest(a.id) <> v."aliasManifest" THEN RETURN 'ALIASES_CHANGED'; END IF;
  RETURN NULL;
END;
$$;

CREATE OR REPLACE FUNCTION image_record_replica_verification(p JSONB) RETURNS JSONB LANGUAGE plpgsql AS $$
DECLARE a "ImageAsset"; s "ImageObject"; t "ImageObject"; v_urls TEXT[]; v_actual TEXT[]; v_id UUID;
BEGIN
  PERFORM image_lock_reference_epoch();
  IF jsonb_typeof(p->'aliasUrls') IS DISTINCT FROM 'array' OR jsonb_array_length(p->'aliasUrls') NOT BETWEEN 0 AND 1000 OR p->>'readerProtocolRevision' IS DISTINCT FROM '3' THEN PERFORM image_raise('IMAGE_INVALID_INPUT'); END IF;
  SELECT * INTO a FROM "ImageAsset" WHERE id = image_uuid(p->>'assetId') FOR UPDATE;
  PERFORM id FROM "ImageObject" WHERE id IN (image_uuid(p->>'sourceObjectId'),image_uuid(p->>'targetObjectId')) ORDER BY id FOR UPDATE;
  SELECT * INTO s FROM "ImageObject" WHERE id = image_uuid(p->>'sourceObjectId'); SELECT * INTO t FROM "ImageObject" WHERE id = image_uuid(p->>'targetObjectId');
  IF a.id IS NULL OR s.id IS NULL OR t.id IS NULL OR a.state <> 'AVAILABLE' OR a."activeObjectId" IS DISTINCT FROM t.id OR s.id = t.id OR s."assetId" <> a.id OR t."assetId" <> a.id
    OR s.state <> 'READY' OR t.state <> 'READY' OR NOT image_object_verified(s) OR NOT image_object_verified(t)
    OR s."byteLength" <> image_bytes(p->>'byteLength') OR t."byteLength" <> s."byteLength" OR p->>'sha256' IS DISTINCT FROM a.sha256 OR s.sha256 <> a.sha256 OR t.sha256 <> a.sha256 THEN PERFORM image_raise('IMAGE_WRITE_CONFLICT'); END IF;
  SELECT COALESCE(array_agg(DISTINCT image_required_text(value,2048) ORDER BY image_required_text(value,2048)),ARRAY[]::text[]) INTO v_urls FROM jsonb_array_elements_text(p->'aliasUrls');
  SELECT COALESCE(array_agg(url ORDER BY url),ARRAY[]::text[]) INTO v_actual FROM "ImageUrlAlias" WHERE "assetId" = a.id;
  IF v_urls IS DISTINCT FROM v_actual THEN PERFORM image_raise('IMAGE_REFERENCE_CONFLICT'); END IF;
  INSERT INTO "ImageReplicaVerification" ("assetId","sourceObjectId","targetObjectId","byteLength",sha256,"aliasUrls","aliasManifest","readerProtocolRevision")
    VALUES (a.id,s.id,t.id,a."byteLength",a.sha256,v_urls,image_alias_manifest(a.id),3) RETURNING id INTO v_id;
  RETURN jsonb_build_object('id',v_id);
END;
$$;

CREATE OR REPLACE FUNCTION image_guard_maintenance_object() RETURNS TRIGGER LANGUAGE plpgsql AS $$
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
      OR NOT image_object_verified(OLD) OR OLD."versionId" IS NOT NULL OR OLD."needsReconciliation" OR OLD."writeExpiresAt" > v_now OR OLD."readProtectedUntil" > v_now
      OR (OLD.state = 'DELETING' AND (OLD."deleteExpiresAt" > v_now OR OLD."nextDeleteAt" > v_now)) THEN PERFORM image_raise('IMAGE_WRITE_CONFLICT'); END IF;
    IF j.mode = 'SOURCE_RETIREMENT' THEN
      IF image_retirement_reason(j."verificationId") IS NOT NULL THEN PERFORM image_raise('IMAGE_WRITE_CONFLICT'); END IF;
    ELSIF a.state <> 'DELETING' OR a."deleteJobId" IS DISTINCT FROM j.id THEN PERFORM image_raise('IMAGE_WRITE_CONFLICT'); END IF;
  END IF;
  IF OLD.state = 'DELETING' AND NOT NEW.accounted THEN
    SELECT * INTO i FROM "ImageMaintenanceItem" WHERE id = OLD."deleteItemId" AND "objectId" = OLD.id;
    IF i.id IS NULL OR i.state <> 'CLAIMED' OR OLD."deleteToken" IS NULL OR NEW."deleteToken" IS DISTINCT FROM OLD."deleteToken" OR OLD."deleteExpiresAt" <= v_now
      OR NEW.state <> 'DELETED' OR NEW."deleteOutcome" NOT IN ('DELETED','MISSING') OR NOT image_object_verified(OLD) OR OLD."needsReconciliation" OR OLD."versionId" IS NOT NULL THEN PERFORM image_raise('IMAGE_WRITE_CONFLICT'); END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION image_finish_maintenance_object(p JSONB) RETURNS JSONB LANGUAGE plpgsql AS $$
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
    IF NOT image_object_verified(o) OR o."needsReconciliation" OR o."versionId" IS NOT NULL THEN PERFORM image_raise('IMAGE_WRITE_CONFLICT'); END IF;
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

CREATE OR REPLACE FUNCTION image_register_alias(p JSONB) RETURNS JSONB LANGUAGE plpgsql AS $$
DECLARE v_id UUID; v_url TEXT; v_existing UUID;
BEGIN
  PERFORM image_lock_reference_epoch();
  v_id := image_uuid(p->>'assetId'); v_url := image_required_text(p->>'url',2048);
  IF octet_length(v_url) > 2048 OR v_url !~ '^https?://' OR v_url ~ '^https?://[^/]*@' THEN PERFORM image_raise('IMAGE_INVALID_INPUT'); END IF;
  PERFORM 1 FROM "ImageAsset" WHERE id = v_id AND state IN ('PENDING','AVAILABLE','QUARANTINED') FOR UPDATE;
  IF NOT FOUND THEN PERFORM image_raise('IMAGE_UNAVAILABLE'); END IF;
  INSERT INTO "ImageUrlAlias" (url,"assetId") VALUES (v_url,v_id) ON CONFLICT (url) DO NOTHING;
  SELECT "assetId" INTO v_existing FROM "ImageUrlAlias" WHERE url = v_url;
  IF v_existing <> v_id THEN PERFORM image_raise('IMAGE_REFERENCE_CONFLICT'); END IF;
  RETURN 'true'::jsonb;
END;
$$;

CREATE OR REPLACE FUNCTION image_replace_references(p JSONB) RETURNS JSONB LANGUAGE plpgsql AS $$
DECLARE v_owner TEXT; v_kind TEXT; v_key TEXT; v_ids UUID[]; v_lock UUID[]; v_asset "ImageAsset";
BEGIN
  PERFORM image_lock_reference_epoch();
  v_owner := image_required_text(p->>'ownerId',128); v_kind := p->>'kind'; v_key := image_required_text(p->>'referenceKey',256);
  IF v_kind IS NULL OR v_kind NOT IN ('JOB_INPUT','CANVAS_SAVED','SHOWCASE','SITE_COVER') OR jsonb_typeof(p->'assetIds') IS DISTINCT FROM 'array' OR jsonb_array_length(p->'assetIds') > 1000 THEN PERFORM image_raise('IMAGE_INVALID_INPUT'); END IF;
  SELECT COALESCE(array_agg(DISTINCT image_uuid(value)),ARRAY[]::uuid[]) INTO v_ids FROM jsonb_array_elements_text(p->'assetIds');
  SELECT COALESCE(array_agg(DISTINCT id ORDER BY id),ARRAY[]::uuid[]) INTO v_lock FROM (
    SELECT unnest(v_ids) AS id UNION SELECT "assetId" FROM "ImageReference" WHERE "ownerId" = v_owner AND kind = v_kind AND "referenceKey" = v_key
  ) AS ids;
  PERFORM id FROM "ImageAsset" WHERE id = ANY(v_lock) ORDER BY id FOR UPDATE;
  IF (SELECT count(*) FROM "ImageAsset" WHERE id = ANY(v_ids)) <> cardinality(v_ids) THEN PERFORM image_raise('IMAGE_UNAVAILABLE'); END IF;
  FOR v_asset IN SELECT * FROM "ImageAsset" WHERE id = ANY(v_ids) ORDER BY id LOOP
    IF v_asset.state <> 'AVAILABLE' THEN PERFORM image_raise('IMAGE_UNAVAILABLE'); END IF;
  END LOOP;
  IF v_kind <> 'JOB_INPUT' THEN DELETE FROM "ImageReference" WHERE "ownerId" = v_owner AND kind = v_kind AND "referenceKey" = v_key AND NOT ("assetId" = ANY(v_ids)); END IF;
  INSERT INTO "ImageReference" ("assetId","ownerId",kind,"referenceKey",permanent)
    SELECT id,v_owner,v_kind,v_key,v_kind = 'JOB_INPUT' FROM unnest(v_ids) AS id ON CONFLICT ("assetId",kind,"referenceKey") DO NOTHING;
  IF EXISTS (SELECT 1 FROM "ImageReference" WHERE "assetId" = ANY(v_ids) AND kind = v_kind AND "referenceKey" = v_key AND "ownerId" <> v_owner) THEN PERFORM image_raise('IMAGE_REFERENCE_CONFLICT'); END IF;
  RETURN 'true'::jsonb;
END;
$$;

CREATE OR REPLACE FUNCTION image_begin_read(p JSONB) RETURNS JSONB LANGUAGE plpgsql AS $$
DECLARE v_id UUID; a "ImageAsset"; o "ImageObject"; v_expiry TIMESTAMPTZ;
BEGIN
  PERFORM image_lock_reference_epoch();
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

CREATE OR REPLACE FUNCTION image_activate_object(p JSONB) RETURNS JSONB LANGUAGE plpgsql AS $$
DECLARE v_asset "ImageAsset"; v_object "ImageObject"; v_asset_id UUID; v_object_id UUID; v_expected UUID;
BEGIN
  PERFORM image_lock_reference_epoch();
  v_asset_id := image_uuid(p->>'assetId'); v_object_id := image_uuid(p->>'objectId');
  IF p->>'expectedObjectId' IS NOT NULL THEN v_expected := image_uuid(p->>'expectedObjectId'); END IF;
  SELECT * INTO v_asset FROM "ImageAsset" WHERE id = v_asset_id FOR UPDATE;
  IF v_asset.id IS NULL OR v_asset.state <> 'AVAILABLE' THEN PERFORM image_raise('IMAGE_UNAVAILABLE'); END IF;
  IF v_asset."activeObjectId" = v_object_id THEN RETURN 'true'::jsonb; END IF;
  IF v_asset."activeObjectId" IS DISTINCT FROM v_expected THEN RETURN 'false'::jsonb; END IF;
  SELECT * INTO v_object FROM "ImageObject" WHERE id = v_object_id AND "assetId" = v_asset_id FOR UPDATE;
  IF v_object.id IS NULL OR v_object.state <> 'READY' OR NOT image_object_verified(v_object) THEN PERFORM image_raise('IMAGE_UNAVAILABLE'); END IF;
  UPDATE "ImageAsset" SET "activeObjectId" = v_object_id WHERE id = v_asset_id;
  RETURN 'true'::jsonb;
END;
$$;

CREATE OR REPLACE FUNCTION image_bridge_known_history(p_asset UUID) RETURNS VOID LANGUAGE plpgsql AS $$
DECLARE v_asset "ImageAsset"; v_binding "ImageGenerationBinding"; v_row RECORD;
BEGIN
  PERFORM image_lock_reference_epoch();
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

CREATE OR REPLACE FUNCTION canvas_lock_owner(p_owner TEXT) RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  PERFORM image_lock_reference_epoch();
  IF NOT canvas_is_canonical_id(p_owner) THEN PERFORM canvas_raise('CANVAS_INVALID_INPUT'); END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('narra.canvas.owner:' || p_owner, 0));
END;
$$;

CREATE OR REPLACE FUNCTION canvas_lock_assets(p_owner TEXT, p_ids TEXT[], p_require_ready BOOLEAN DEFAULT true) RETURNS VOID LANGUAGE plpgsql AS $$
DECLARE asset "CanvasImportAsset"%ROWTYPE; found_ids TEXT[] := ARRAY[]::TEXT[];
BEGIN
  PERFORM image_lock_reference_epoch();
  IF p_owner IS NULL OR p_ids IS NULL OR p_require_ready IS NULL OR array_position(p_ids, NULL) IS NOT NULL THEN PERFORM canvas_raise('CANVAS_INVALID_INPUT'); END IF;
  FOR asset IN SELECT * FROM "CanvasImportAsset" WHERE id = ANY(p_ids) ORDER BY id FOR UPDATE LOOP
    IF asset."ownerId" <> p_owner OR asset.kind <> 'IMPORT' OR (p_require_ready AND asset.state <> 'READY') THEN PERFORM canvas_raise('CANVAS_INPUT_UNAVAILABLE'); END IF;
    IF asset."mediaAssetId" IS NOT NULL AND p_require_ready THEN
      PERFORM 1 FROM "ImageAsset" WHERE id = asset."mediaAssetId" AND "ownerId" = p_owner AND state = 'AVAILABLE' AND "activeObjectId" IS NOT NULL FOR UPDATE;
      IF NOT FOUND THEN PERFORM canvas_raise('CANVAS_INPUT_UNAVAILABLE'); END IF;
    END IF;
    found_ids := found_ids || asset.id;
  END LOOP;
  IF EXISTS (SELECT 1 FROM unnest(p_ids) AS id WHERE NOT id = ANY(found_ids)) THEN PERFORM canvas_raise('CANVAS_INPUT_UNAVAILABLE'); END IF;
END;
$$;

CREATE OR REPLACE FUNCTION canvas_save_snapshot(p_owner TEXT, p_canvas UUID, p_expected_revision INTEGER, p_save_id UUID, p_scene JSONB, p_scene_hash TEXT)
RETURNS TABLE("acknowledgedRevision" INTEGER, "currentRevision" INTEGER, "sceneHash" TEXT, replayed BOOLEAN) LANGUAGE plpgsql AS $$
DECLARE document "Canvas"%ROWTYPE; new_assets TEXT[]; affected_assets TEXT[];
BEGIN
  PERFORM image_lock_reference_epoch();
  SELECT * INTO document FROM "Canvas" WHERE id = p_canvas AND "ownerId" = p_owner FOR UPDATE;
  IF NOT FOUND THEN PERFORM canvas_raise('CANVAS_NOT_FOUND'); END IF;
  IF document."deletedAt" IS NOT NULL THEN PERFORM canvas_raise('CANVAS_DELETED'); END IF;
  IF document."userId" IS NULL THEN PERFORM canvas_raise('CANVAS_NOT_FOUND'); END IF;
  IF p_expected_revision IS NULL OR p_expected_revision < 0 OR p_save_id IS NULL THEN PERFORM canvas_raise('CANVAS_INVALID_INPUT'); END IF;
  PERFORM canvas_assert_scene(p_scene);
  IF p_scene_hash IS NULL OR p_scene_hash !~ '^[a-f0-9]{64}$' THEN PERFORM canvas_raise('CANVAS_INVALID_INPUT'); END IF;
  IF document."lastSaveId" = p_save_id THEN
    IF document."lastSaveHash" IS DISTINCT FROM p_scene_hash OR document.scene IS DISTINCT FROM p_scene THEN PERFORM canvas_raise('CANVAS_SAVE_CONFLICT'); END IF;
    RETURN QUERY SELECT document."lastSaveRevision", document.revision, document."lastSaveHash"::TEXT, true; RETURN;
  END IF;
  IF document.revision <> p_expected_revision THEN PERFORM canvas_raise('CANVAS_REVISION_CONFLICT'); END IF;
  SELECT COALESCE(array_agg(DISTINCT value->'source'->>'assetId' ORDER BY value->'source'->>'assetId'), ARRAY[]::TEXT[]) INTO new_assets FROM jsonb_array_elements(p_scene->'nodes') WHERE value->>'kind' = 'reference';
  SELECT COALESCE(array_agg(DISTINCT id ORDER BY id), ARRAY[]::TEXT[]) INTO affected_assets FROM (SELECT unnest(new_assets) AS id UNION SELECT "assetId" FROM "CanvasSavedAssetUse" WHERE "canvasId" = p_canvas) AS ids;
  PERFORM canvas_lock_assets(p_owner, affected_assets, false);
  PERFORM canvas_lock_assets(p_owner, new_assets);
  PERFORM canvas_validate_scene_resources(p_owner, p_canvas, p_scene);
  DELETE FROM "CanvasSavedAssetUse" WHERE "canvasId" = p_canvas AND NOT "assetId" = ANY(new_assets);
  INSERT INTO "CanvasSavedAssetUse" ("canvasId","assetId","ownerId") SELECT p_canvas, id, p_owner FROM unnest(new_assets) AS id ON CONFLICT ("canvasId","assetId") DO NOTHING;
  UPDATE "Canvas" SET scene = p_scene, revision = revision + 1, "lastSavedAt" = clock_timestamp(), "lastSaveId" = p_save_id, "lastSaveHash" = p_scene_hash, "lastSaveRevision" = revision + 1 WHERE id = p_canvas RETURNING * INTO document;
  RETURN QUERY SELECT document."lastSaveRevision", document.revision, document."lastSaveHash"::TEXT, false;
END;
$$;

CREATE OR REPLACE FUNCTION canvas_delete_document(p_owner TEXT, p_canvas UUID, p_expected_revision INTEGER) RETURNS INTEGER LANGUAGE plpgsql AS $$
DECLARE document "Canvas"%ROWTYPE; asset_ids TEXT[];
BEGIN
  PERFORM image_lock_reference_epoch();
  SELECT * INTO document FROM "Canvas" WHERE id = p_canvas AND "ownerId" = p_owner FOR UPDATE;
  IF NOT FOUND THEN PERFORM canvas_raise('CANVAS_NOT_FOUND'); END IF;
  IF document."deletedAt" IS NOT NULL THEN RETURN document.revision; END IF;
  IF document."userId" IS NULL THEN PERFORM canvas_raise('CANVAS_NOT_FOUND'); END IF;
  IF p_expected_revision IS NULL OR p_expected_revision < 0 THEN PERFORM canvas_raise('CANVAS_INVALID_INPUT'); END IF;
  IF document.revision <> p_expected_revision THEN PERFORM canvas_raise('CANVAS_REVISION_CONFLICT'); END IF;
  SELECT COALESCE(array_agg("assetId" ORDER BY "assetId"), ARRAY[]::TEXT[]) INTO asset_ids FROM "CanvasSavedAssetUse" WHERE "canvasId" = p_canvas;
  PERFORM canvas_lock_assets(p_owner, asset_ids, false);
  DELETE FROM "CanvasSavedAssetUse" WHERE "canvasId" = p_canvas;
  UPDATE "Canvas" SET scene = NULL, "lastSaveId" = NULL, "lastSaveHash" = NULL, "lastSaveRevision" = NULL, "lastSavedAt" = NULL, "deletedAt" = clock_timestamp(), revision = revision + 1 WHERE id = p_canvas RETURNING revision INTO document.revision;
  RETURN document.revision;
END;
$$;

CREATE OR REPLACE FUNCTION canvas_reserve_run(p_owner TEXT, p_canvas UUID, p_node UUID, p_run UUID, p_intent_hash TEXT, p_snapshot JSONB, p_credential_fingerprint TEXT DEFAULT NULL)
RETURNS TABLE(id TEXT, state "CanvasRunState", "preparationToken" UUID, "preparationExpiresAt" TIMESTAMPTZ, "originalJobId" TEXT, "liveJobId" TEXT, replayed BOOLEAN) LANGUAGE plpgsql AS $$
DECLARE run_row "CanvasRun"%ROWTYPE;
BEGIN
  PERFORM image_lock_reference_epoch();
  SELECT * INTO run_row FROM "CanvasRun" AS r WHERE r."ownerId" = p_owner AND r."runId" = p_run;
  IF FOUND THEN
    IF run_row."canvasId" <> p_canvas OR run_row."nodeId" <> p_node OR run_row."intentHash" IS DISTINCT FROM p_intent_hash OR run_row."inputSnapshot" IS DISTINCT FROM p_snapshot OR run_row."credentialFingerprint" IS DISTINCT FROM p_credential_fingerprint THEN PERFORM canvas_raise('CANVAS_RUN_CONFLICT'); END IF;
    IF run_row.state IN ('COMMITTED','REJECTED') THEN
      RETURN QUERY SELECT run_row.id::TEXT, run_row.state, run_row."preparationToken", run_row."preparationExpiresAt", run_row."originalJobId"::TEXT, run_row."liveJobId"::TEXT, true; RETURN;
    END IF;
  END IF;
  PERFORM 1 FROM "Canvas" AS c WHERE c.id = p_canvas AND c."ownerId" = p_owner AND c."userId" IS NOT NULL AND c."deletedAt" IS NULL FOR UPDATE;
  IF NOT FOUND THEN PERFORM canvas_raise('CANVAS_NOT_FOUND'); END IF;
  SELECT * INTO run_row FROM "CanvasRun" AS r WHERE r."ownerId" = p_owner AND r."runId" = p_run FOR UPDATE;
  IF FOUND THEN
    IF run_row."intentHash" IS DISTINCT FROM p_intent_hash OR run_row."inputSnapshot" IS DISTINCT FROM p_snapshot OR run_row."credentialFingerprint" IS DISTINCT FROM p_credential_fingerprint THEN PERFORM canvas_raise('CANVAS_RUN_CONFLICT'); END IF;
    IF run_row.state <> 'PREPARING' OR run_row."preparationExpiresAt" > clock_timestamp() THEN
      RETURN QUERY SELECT run_row.id::TEXT, run_row.state, run_row."preparationToken", run_row."preparationExpiresAt", run_row."originalJobId"::TEXT, run_row."liveJobId"::TEXT, true; RETURN;
    END IF;
    UPDATE "CanvasRun" AS r SET "preparationToken" = gen_random_uuid() WHERE r.id = run_row.id RETURNING r.* INTO run_row;
  ELSE
    INSERT INTO "CanvasRun" (id,"ownerId","userId","canvasId","nodeId","runId","intentHash","credentialFingerprint","inputSnapshot","preparationToken","preparationExpiresAt")
      VALUES (gen_random_uuid()::TEXT,p_owner,p_owner,p_canvas,p_node,p_run,p_intent_hash,p_credential_fingerprint,p_snapshot,gen_random_uuid(),clock_timestamp() + interval '120 seconds') RETURNING * INTO run_row;
  END IF;
  RETURN QUERY SELECT run_row.id::TEXT, run_row.state, run_row."preparationToken", run_row."preparationExpiresAt", run_row."originalJobId"::TEXT, run_row."liveJobId"::TEXT, false;
END;
$$;

CREATE OR REPLACE FUNCTION canvas_commit_run(p_owner TEXT, p_run UUID, p_preparation_token UUID, p_job_id TEXT) RETURNS TEXT LANGUAGE plpgsql AS $$
DECLARE run_row "CanvasRun"%ROWTYPE; assets TEXT[];
BEGIN
  PERFORM image_lock_reference_epoch();
  SELECT * INTO run_row FROM "CanvasRun" WHERE "ownerId" = p_owner AND "runId" = p_run;
  IF NOT FOUND THEN PERFORM canvas_raise('CANVAS_RUN_NOT_FOUND'); END IF;
  IF run_row.state = 'COMMITTED' THEN
    IF run_row."originalJobId" IS DISTINCT FROM p_job_id THEN PERFORM canvas_raise('CANVAS_RUN_CONFLICT'); END IF;
    RETURN run_row."originalJobId";
  END IF;
  PERFORM 1 FROM "Canvas" WHERE id = run_row."canvasId" AND "ownerId" = p_owner AND "userId" IS NOT NULL AND "deletedAt" IS NULL FOR UPDATE;
  IF NOT FOUND THEN PERFORM canvas_raise('CANVAS_NOT_FOUND'); END IF;
  SELECT * INTO run_row FROM "CanvasRun" WHERE "ownerId" = p_owner AND "runId" = p_run FOR UPDATE;
  IF run_row.state = 'COMMITTED' AND run_row."originalJobId" = p_job_id THEN RETURN run_row."originalJobId"; END IF;
  IF run_row.state <> 'PREPARING' OR run_row."preparationToken" IS DISTINCT FROM p_preparation_token OR run_row."preparationExpiresAt" <= clock_timestamp() THEN PERFORM canvas_raise('CANVAS_LEASE_LOST'); END IF;
  SELECT COALESCE(array_agg(value->>'assetId' ORDER BY value->>'assetId'), ARRAY[]::TEXT[]) INTO assets FROM jsonb_array_elements(run_row."inputSnapshot"->'input'->'references') WHERE value->>'kind' = 'imported';
  PERFORM canvas_lock_assets(p_owner, assets);
  UPDATE "CanvasRun" SET state = 'COMMITTED', "originalJobId" = p_job_id, "liveJobId" = p_job_id WHERE id = run_row.id;
  INSERT INTO "CanvasJobAssetUse" (id,"ownerId","runId","assetId","originalJobId","liveJobId",ordinal)
    SELECT gen_random_uuid()::TEXT, p_owner, run_row.id, value->>'assetId', p_job_id, p_job_id, (value->>'ordinal')::INTEGER FROM jsonb_array_elements(run_row."inputSnapshot"->'input'->'references') WHERE value->>'kind' = 'imported';
  RETURN p_job_id;
END;
$$;

CREATE OR REPLACE FUNCTION canvas_reject_run(p_owner TEXT, p_run UUID, p_preparation_token UUID, p_error_code TEXT) RETURNS BOOLEAN LANGUAGE plpgsql AS $$
BEGIN
  PERFORM image_lock_reference_epoch();
  IF p_error_code IS NULL OR p_error_code !~ '^CANVAS_[A-Z_]+$' THEN PERFORM canvas_raise('CANVAS_INVALID_INPUT'); END IF;
  UPDATE "CanvasRun" SET state = 'REJECTED', "rejectionCode" = p_error_code WHERE "ownerId" = p_owner AND "runId" = p_run AND state = 'PREPARING' AND "preparationToken" = p_preparation_token AND "preparationExpiresAt" > clock_timestamp();
  RETURN FOUND;
END;
$$;

CREATE OR REPLACE FUNCTION canvas_acquire_gc_lease_v2(p_token UUID) RETURNS BOOLEAN LANGUAGE plpgsql AS $$
BEGIN
  PERFORM image_lock_reference_epoch();
  IF p_token IS NULL THEN PERFORM canvas_raise('CANVAS_INVALID_INPUT'); END IF;
  UPDATE "CanvasGcLease" SET token = p_token, "expiresAt" = clock_timestamp() + interval '90 seconds', "updatedAt" = clock_timestamp()
    WHERE id = 'canvas-imports' AND (token IS NULL OR "expiresAt" <= clock_timestamp() OR token = p_token);
  RETURN FOUND;
END;
$$;

CREATE OR REPLACE FUNCTION canvas_claim_imports_v2(p_sweep_token UUID, p_storage_location TEXT, p_limit INTEGER DEFAULT 20) RETURNS SETOF "CanvasImportAsset" LANGUAGE plpgsql AS $$
DECLARE asset "CanvasImportAsset"%ROWTYPE; v_now TIMESTAMPTZ;
BEGIN
  PERFORM image_lock_reference_epoch();
  IF p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 100 THEN PERFORM canvas_raise('CANVAS_LIMIT_EXCEEDED'); END IF;
  IF p_storage_location IS NULL OR length(p_storage_location) NOT BETWEEN 1 AND 128 THEN PERFORM canvas_raise('CANVAS_INVALID_INPUT'); END IF;
  PERFORM 1 FROM "CanvasGcLease" WHERE id = 'canvas-imports' AND token = p_sweep_token AND "expiresAt" > clock_timestamp() FOR UPDATE;
  IF NOT FOUND THEN PERFORM canvas_raise('CANVAS_LEASE_LOST'); END IF;
  -- Expired single-PUT reservations are quarantined, never leased to a second PUT.
  FOR asset IN SELECT * FROM "CanvasImportAsset" WHERE NOT EXISTS (SELECT 1 FROM "ImageHistoryHold" h WHERE h."canvasImportId" = "CanvasImportAsset".id AND h."releasedAt" IS NULL) AND "mediaAssetId" IS NULL AND "sourceProvider" = 'S3' AND state = 'UPLOADING' AND "uploadExpiresAt" <= clock_timestamp() ORDER BY id LIMIT p_limit FOR UPDATE SKIP LOCKED LOOP
    UPDATE "CanvasImportAsset" SET state = 'QUARANTINED', "putOutcome" = CASE WHEN "putOutcome" = 'NOT_STARTED' THEN 'UNKNOWN'::"CanvasPutOutcome" ELSE "putOutcome" END WHERE id = asset.id;
  END LOOP;
  FOR asset IN SELECT * FROM "CanvasImportAsset" AS a WHERE NOT EXISTS (SELECT 1 FROM "ImageHistoryHold" h WHERE h."canvasImportId" = a.id AND h."releasedAt" IS NULL) AND a."mediaAssetId" IS NULL AND a."sourceProvider" = 'S3' AND a.kind = 'IMPORT' AND a."storageLocation" = p_storage_location AND a."storageVersionId" IS NULL
    AND a."uploadExpiresAt" <= clock_timestamp() AND (a."preparationExpiresAt" IS NULL OR a."preparationExpiresAt" <= clock_timestamp())
    AND (a."deleteExpiresAt" IS NULL OR a."deleteExpiresAt" <= clock_timestamp()) AND (a."nextDeleteAt" IS NULL OR a."nextDeleteAt" <= clock_timestamp())
    AND ((a.state IN ('READY','QUARANTINED') AND a."detachedAt" + interval '604800 seconds' <= clock_timestamp()) OR a.state = 'DELETING' OR (a.state = 'DELETED' AND a."needsReconciliation"))
    AND NOT EXISTS (SELECT 1 FROM "CanvasSavedAssetUse" WHERE "assetId" = a.id) AND NOT EXISTS (SELECT 1 FROM "CanvasJobAssetUse" WHERE "assetId" = a.id)
    ORDER BY a.id LIMIT p_limit FOR UPDATE SKIP LOCKED LOOP
    v_now := clock_timestamp();
    -- Fresh post-lock root/lease reads fence a stale candidate prefilter.
    IF EXISTS (SELECT 1 FROM "CanvasSavedAssetUse" WHERE "assetId" = asset.id) OR EXISTS (SELECT 1 FROM "CanvasJobAssetUse" WHERE "assetId" = asset.id)
      OR asset."preparationExpiresAt" > v_now OR asset."uploadExpiresAt" > v_now THEN CONTINUE; END IF;
    IF NOT EXISTS (SELECT 1 FROM "CanvasGcLease" WHERE id = 'canvas-imports' AND token = p_sweep_token AND "expiresAt" > v_now) THEN EXIT; END IF;
    UPDATE "CanvasImportAsset" SET state = CASE WHEN state = 'DELETED' THEN state ELSE 'DELETING'::"CanvasImportAssetState" END, "deleteToken" = gen_random_uuid(), "lastStorageErrorCode" = NULL WHERE id = asset.id RETURNING * INTO asset;
    RETURN NEXT asset;
  END LOOP;
END;
$$;

CREATE OR REPLACE FUNCTION canvas_finish_asset_delete_v2(p_asset_id TEXT, p_delete_token UUID, p_outcome "CanvasDeleteOutcome", p_error_code TEXT DEFAULT NULL) RETURNS BOOLEAN LANGUAGE plpgsql AS $$
DECLARE asset "CanvasImportAsset"%ROWTYPE; v_now TIMESTAMPTZ; backoff INTEGER;
BEGIN
  PERFORM image_lock_reference_epoch();
  SELECT * INTO asset FROM "CanvasImportAsset" WHERE id = p_asset_id FOR UPDATE;
  v_now := clock_timestamp();
  IF EXISTS (SELECT 1 FROM "ImageHistoryHold" h WHERE h."canvasImportId" = p_asset_id AND h."releasedAt" IS NULL) THEN PERFORM canvas_raise('CANVAS_LEASE_LOST'); END IF;
  IF NOT FOUND OR asset."mediaAssetId" IS NOT NULL OR asset."sourceProvider" <> 'S3' OR asset.state NOT IN ('DELETING','DELETED') OR asset."storageVersionId" IS NOT NULL OR asset."deleteToken" IS DISTINCT FROM p_delete_token OR asset."deleteExpiresAt" <= v_now THEN RETURN false; END IF;
  IF EXISTS (SELECT 1 FROM "ImageHistoryHold" h WHERE h."canvasImportId" = p_asset_id AND h."releasedAt" IS NULL) THEN PERFORM canvas_raise('CANVAS_LEASE_LOST'); END IF;
  IF p_outcome IN ('DELETED','MISSING') THEN
    UPDATE "CanvasImportAsset" SET state = 'DELETED', "deleteOutcome" = p_outcome, "deleteExpiresAt" = v_now, "physicalBytesAccounted" = ("putOutcome" = 'UNKNOWN'), "needsReconciliation" = ("putOutcome" = 'UNKNOWN'), "nextDeleteAt" = CASE WHEN "putOutcome" = 'UNKNOWN' THEN v_now + interval '86400 seconds' ELSE NULL END, "lastStorageErrorCode" = NULL WHERE id = p_asset_id;
  ELSIF p_outcome IN ('FAILED','UNKNOWN') THEN
    backoff := LEAST(3600, (10 * power(2, LEAST(asset."deleteAttempts" - 1, 8)))::INTEGER);
    UPDATE "CanvasImportAsset" SET "deleteOutcome" = p_outcome, "deleteExpiresAt" = v_now, "nextDeleteAt" = v_now + make_interval(secs => backoff), "lastStorageErrorCode" = p_error_code WHERE id = p_asset_id;
  ELSE PERFORM canvas_raise('CANVAS_INVALID_INPUT'); END IF;
  RETURN true;
END;
$$;

CREATE OR REPLACE FUNCTION canvas_validate_scene_resources(p_owner TEXT, p_canvas UUID, p_scene JSONB) RETURNS VOID LANGUAGE plpgsql AS $$
DECLARE node JSONB; edge JSONB; binding JSONB; output JSONB;
BEGIN
  PERFORM image_lock_reference_epoch();
  FOR node IN SELECT value FROM jsonb_array_elements(p_scene->'nodes') WHERE value->>'kind' = 'result' LOOP
    PERFORM 1 FROM "GenerationImage" AS i JOIN "GenerationJob" AS j ON j.id = i."jobId" WHERE i.id = node->>'imageId' AND j.id = node->>'jobId' AND j."userId" = p_owner AND j.status = 'SUCCEEDED' AND length(i.url) > 0 FOR KEY SHARE OF i, j;
    IF NOT FOUND THEN PERFORM canvas_raise('CANVAS_INPUT_UNAVAILABLE'); END IF;
    IF node ? 'runId' AND NOT EXISTS (SELECT 1 FROM "CanvasRun" WHERE "ownerId" = p_owner AND "canvasId" = p_canvas AND "runId" = (node->>'runId')::UUID AND state = 'COMMITTED' AND "originalJobId" = node->>'jobId') THEN PERFORM canvas_raise('CANVAS_ORIGIN_MISMATCH'); END IF;
  END LOOP;
  FOR binding IN SELECT value FROM jsonb_array_elements(p_scene->'runBindings') LOOP
    IF NOT EXISTS (SELECT 1 FROM "CanvasRun" AS r JOIN "GenerationJob" AS j ON j.id = r."liveJobId" WHERE r."ownerId" = p_owner AND r."canvasId" = p_canvas AND r."nodeId" = (binding->>'nodeId')::UUID AND r."runId" = (binding->>'runId')::UUID AND r.state = 'COMMITTED' AND r."originalJobId" = binding->>'jobId' AND j."userId" = p_owner) THEN PERFORM canvas_raise('CANVAS_ORIGIN_MISMATCH'); END IF;
  END LOOP;
  FOR edge IN SELECT value FROM jsonb_array_elements(p_scene->'edges') WHERE value->>'kind' = 'output-provenance' LOOP
    SELECT value INTO output FROM jsonb_array_elements(p_scene->'nodes') WHERE value->>'id' = edge->>'target';
    IF NOT EXISTS (SELECT 1 FROM "CanvasRun" WHERE "ownerId" = p_owner AND "canvasId" = p_canvas AND "nodeId" = (edge->>'source')::UUID AND "runId" = (output->>'runId')::UUID AND state = 'COMMITTED' AND "originalJobId" = output->>'jobId') THEN PERFORM canvas_raise('CANVAS_ORIGIN_MISMATCH'); END IF;
  END LOOP;
END;
$$;

CREATE OR REPLACE FUNCTION canvas_sync_saved_images(p_owner TEXT, p_canvas UUID, p_scene JSONB) RETURNS VOID LANGUAGE plpgsql AS $$
DECLARE v_ids JSONB;
BEGIN
  PERFORM image_lock_reference_epoch();
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
  PERFORM image_lock_reference_epoch();
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

CREATE OR REPLACE FUNCTION image_storage_revision() RETURNS INTEGER LANGUAGE SQL IMMUTABLE AS $$ SELECT 3 $$;

CREATE FUNCTION image_history_subject_snapshot(p_kind TEXT,p_id TEXT) RETURNS JSONB LANGUAGE SQL STABLE AS $$
  SELECT CASE p_kind
    WHEN 'GENERATED' THEN (SELECT jsonb_build_object('id',i.id,'jobId',i."jobId",'ownerId',j."userId",'url',
      CASE WHEN octet_length(i.url) <= 2048 THEN i.url ELSE NULL END,'urlHash',encode(sha256(convert_to(i.url,'UTF8')),'hex'),
      'mediaStorage',i."mediaStorage",'storageKey',i."storageKey",'mediaAssetId',i."mediaAssetId")
      FROM "GenerationImage" i JOIN "GenerationJob" j ON j.id = i."jobId" WHERE i.id = p_id)
    WHEN 'CANVAS_IMPORT' THEN (SELECT jsonb_build_object('id',c.id,'ownerId',c."ownerId",'uploadId',c."uploadId",'sourceProvider',c."sourceProvider",
      'storageLocation',c."storageLocation",'storageEndpoint',c."storageEndpoint",'storageRegion',c."storageRegion",'storageBucket',c."storageBucket",'storageKey',c."storageKey",
      'byteLength',c."byteLength"::text,'sha256',c.sha256,'mimeType',c."mimeType",'state',c.state,'putOutcome',c."putOutcome",'storageVersionId',c."storageVersionId",
      'needsReconciliation',c."needsReconciliation",'physicalBytesAccounted',c."physicalBytesAccounted",'deleteToken',c."deleteToken",'mediaAssetId',c."mediaAssetId")
      FROM "CanvasImportAsset" c WHERE c.id = p_id)
    WHEN 'REFERENCE_URL' THEN (SELECT jsonb_build_object('url',r."exactUrl") FROM "ImageHistoryReference" r WHERE r."urlHash" = p_id ORDER BY r."createdAt",r.kind,r."referenceKey" LIMIT 1)
    WHEN 'VIDEO' THEN (SELECT jsonb_build_object('id',v.id,'excluded',true) FROM "GeneratedVideo" v WHERE v.id = p_id)
    ELSE NULL END
$$;

CREATE FUNCTION image_scan_history(p JSONB) RETURNS JSONB LANGUAGE plpgsql STABLE AS $$
DECLARE v_scope TEXT := COALESCE(p->>'scope','ALL'); v_cursor TEXT := COALESCE(p->>'cursor','');
  v_limit INTEGER; v_upper TIMESTAMPTZ; v_rows JSONB; v_more BOOLEAN; v_next TEXT;
BEGIN
  IF v_scope NOT IN ('ALL','GENERATED','CANVAS_IMPORT','REFERENCE_URL') OR length(v_cursor) > 160 THEN PERFORM image_raise('IMAGE_INVALID_INPUT'); END IF;
  v_limit := image_management_integer(COALESCE(p->>'limit','100'),1,1000);
  BEGIN v_upper := COALESCE((p->>'upperBound')::timestamptz,date_trunc('milliseconds',clock_timestamp()));
  EXCEPTION WHEN invalid_datetime_format OR datetime_field_overflow THEN PERFORM image_raise('IMAGE_INVALID_INPUT'); END;
  WITH subjects AS (
    SELECT 'GENERATED'::text AS kind,i.id::text AS id,j."userId"::text AS owner,
      CASE WHEN i.url ~ '^https?://' AND octet_length(i.url) <= 2048 THEN i.url ELSE NULL END AS url,i."createdAt" AS created,
      CASE WHEN j."generationType"::text NOT IN ('TEXT_TO_IMAGE','IMAGE_TO_IMAGE') THEN 'VIDEO_EXCLUDED'
        WHEN i."mediaAssetId" IS NOT NULL THEN 'ALREADY_MANAGED' WHEN i.url LIKE 'data:%' THEN 'DATA_URL'
        WHEN i."mediaStorage" = 'S3' AND i."storageKey" IS NOT NULL THEN 'SOURCE_BINDING_REQUIRED' ELSE 'THIRD_PARTY_OR_UNKNOWN' END AS classification
      FROM "GenerationImage" i JOIN "GenerationJob" j ON j.id = i."jobId" WHERE v_scope IN ('ALL','GENERATED') AND i."createdAt" <= v_upper
    UNION ALL SELECT 'CANVAS_IMPORT',c.id,c."ownerId",NULL,c."createdAt",
      CASE WHEN c."mediaAssetId" IS NOT NULL THEN 'ALREADY_MANAGED' WHEN c.state = 'READY' AND c."putOutcome" = 'CONFIRMED' AND c."storageVersionId" IS NULL AND NOT c."needsReconciliation" AND c."deleteToken" IS NULL
        THEN 'SOURCE_BINDING_REQUIRED' ELSE 'CANVAS_UNCERTAIN' END
      FROM "CanvasImportAsset" c WHERE v_scope IN ('ALL','CANVAS_IMPORT') AND c."createdAt" <= v_upper
    UNION ALL SELECT 'REFERENCE_URL',r."urlHash",NULL,min(r."exactUrl"),min(r."createdAt"),
      CASE WHEN EXISTS (SELECT 1 FROM "ImageUrlAlias" a WHERE a.url = min(r."exactUrl")) THEN 'ALREADY_MANAGED' ELSE 'THIRD_PARTY_OR_UNKNOWN' END
      FROM "ImageHistoryReference" r WHERE v_scope IN ('ALL','REFERENCE_URL') AND r."createdAt" <= v_upper AND octet_length(r."exactUrl") <= 2048
        AND NOT EXISTS (SELECT 1 FROM "GeneratedVideo" v WHERE v.url = r."exactUrl" OR v."posterUrl" = r."exactUrl")
      GROUP BY r."urlHash"
    UNION ALL SELECT 'VIDEO',v.id,NULL,NULL,v."createdAt",'VIDEO_EXCLUDED' FROM "GeneratedVideo" v WHERE v_scope = 'ALL' AND v."createdAt" <= v_upper
  ), page AS (SELECT *,kind||':'||id AS cursor FROM subjects WHERE kind||':'||id > v_cursor ORDER BY kind,id LIMIT v_limit+1),
  numbered AS (SELECT *,row_number() OVER (ORDER BY kind,id) AS n FROM page),
  payload AS (SELECT *,image_history_subject_snapshot(kind,id) AS snapshot FROM numbered WHERE n <= v_limit)
  SELECT COALESCE(jsonb_agg(jsonb_build_object('subjectKind',kind,'subjectId',id,'ownerId',owner,'exactUrl',url,'snapshot',snapshot,
      'snapshotHash',image_history_digest(snapshot),'createdAt',created,'classification',classification) ORDER BY kind,id),'[]'::jsonb),
    (SELECT count(*) > v_limit FROM page),max(cursor) INTO v_rows,v_more,v_next FROM payload;
  RETURN jsonb_build_object('candidates',v_rows,'nextCursor',CASE WHEN v_more THEN v_next ELSE NULL END,'upperBound',v_upper);
END;
$$;

CREATE FUNCTION image_history_object_json(p_id UUID) RETURNS JSONB LANGUAGE SQL STABLE AS $$
  SELECT jsonb_build_object('asset',image_asset_json(a),'object',image_object_json(o),'location',to_jsonb(l))
    FROM "ImageObject" o JOIN "ImageAsset" a ON a.id = o."assetId" JOIN "ImageStorageLocation" l ON l.id = o."locationId" WHERE o.id = p_id
$$;
CREATE FUNCTION image_history_item_json(p_id UUID) RETURNS JSONB LANGUAGE SQL STABLE AS $$
  SELECT (to_jsonb(i)-'workerId') || jsonb_build_object('source',image_history_object_json(i."sourceObjectId"),'target',image_history_object_json(i."targetObjectId"))
    FROM "ImageHistoryItem" i WHERE i.id = p_id
$$;
CREATE FUNCTION image_history_job_json(p_id UUID) RETURNS JSONB LANGUAGE SQL STABLE AS $$
  SELECT to_jsonb(j) || jsonb_build_object('totalItems',(SELECT count(*)::integer FROM "ImageHistoryItem" WHERE "jobId" = j.id),
    'completedItems',(SELECT count(*)::integer FROM "ImageHistoryItem" WHERE "jobId" = j.id AND state IN ('SOURCE_RETAINED','RETIREMENT_REQUESTED','EXCLUDED')
      AND NOT (j."retireSource" AND state = 'SOURCE_RETAINED' AND "retirementJobId" IS NULL)),
    'blockedItems',(SELECT count(*)::integer FROM "ImageHistoryItem" WHERE "jobId" = j.id AND state = 'BLOCKED')) FROM "ImageHistoryJob" j WHERE j.id = p_id
$$;
CREATE FUNCTION image_refresh_history_job(p_job UUID) RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  UPDATE "ImageHistoryJob" j SET state = CASE
    WHEN EXISTS (SELECT 1 FROM "ImageHistoryItem" WHERE "jobId" = j.id AND (state NOT IN ('SOURCE_RETAINED','RETIREMENT_REQUESTED','EXCLUDED','BLOCKED') OR (j."retireSource" AND state = 'SOURCE_RETAINED' AND "retirementJobId" IS NULL))) THEN 'RUNNING'
    WHEN EXISTS (SELECT 1 FROM "ImageHistoryItem" WHERE "jobId" = j.id AND state = 'BLOCKED') THEN 'PARTIAL'
    WHEN j."scanComplete" THEN 'SUCCEEDED' ELSE 'RUNNING' END WHERE j.id = p_job AND j.state <> 'CANCELLED';
END;
$$;
CREATE FUNCTION image_begin_history_apply(p JSONB) RETURNS JSONB LANGUAGE plpgsql AS $$
DECLARE j "ImageHistoryJob"; b JSONB; v_upper TIMESTAMPTZ; v_mode TEXT; v_scope TEXT; v_actor TEXT; v_base TEXT;
BEGIN
  PERFORM image_lock_reference_epoch();
  v_actor := image_required_text(p->>'actorId',128); v_scope := COALESCE(p->>'scope','ALL');
  v_base := rtrim(image_required_text(p->>'publicUrlBase',1900),'/');
  IF v_base !~ '^https?://[^/?#@]+(/[^?#]*)?$' THEN PERFORM image_raise('IMAGE_INVALID_INPUT'); END IF;
  IF v_scope NOT IN ('ALL','GENERATED','CANVAS_IMPORT','REFERENCE_URL') OR length(p->>'planDigest') IS DISTINCT FROM 64 OR p->>'planDigest' !~ '^[0-9a-f]{64}$'
    OR jsonb_typeof(p->'sourceBindings') IS DISTINCT FROM 'array' OR jsonb_array_length(p->'sourceBindings') > 1000 OR jsonb_typeof(p->'retireSource') IS DISTINCT FROM 'boolean' THEN PERFORM image_raise('IMAGE_INVALID_INPUT'); END IF;
  BEGIN v_upper := (p->>'upperBound')::timestamptz;
  EXCEPTION WHEN invalid_datetime_format OR datetime_field_overflow THEN PERFORM image_raise('IMAGE_INVALID_INPUT'); END;
  IF v_upper IS NULL OR v_upper > clock_timestamp() THEN PERFORM image_raise('IMAGE_INVALID_INPUT'); END IF;
  v_mode := CASE WHEN p->>'targetLocationId' IS NULL THEN 'ADOPT' ELSE 'COPY' END;
  FOR b IN SELECT value FROM jsonb_array_elements(p->'sourceBindings') LOOP
    IF b->>'subjectKind' NOT IN ('GENERATED','CANVAS_IMPORT','REFERENCE_URL') OR b->>'subjectKind' IS NULL
      OR length(b->>'expectedSnapshotHash') IS DISTINCT FROM 64 OR b->>'expectedSnapshotHash' !~ '^[0-9a-f]{64}$'
      OR NOT EXISTS (SELECT 1 FROM "ImageStorageLocation" WHERE id = b->>'locationId') THEN PERFORM image_raise('IMAGE_INVALID_INPUT'); END IF;
    PERFORM image_required_text(b->>'subjectId',128); PERFORM image_required_text(b->>'ownerId',128); PERFORM image_required_text(b->>'key',512);
    IF b->>'key' !~ '^[A-Za-z0-9][A-Za-z0-9._-]*(/[A-Za-z0-9][A-Za-z0-9._-]*)*$' OR b->>'key' ~ '(^|/)\.{1,2}(/|$)' THEN PERFORM image_raise('IMAGE_INVALID_INPUT'); END IF;
  END LOOP;
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(p->'sourceBindings') AS bindings(value) GROUP BY bindings.value->>'subjectKind',bindings.value->>'subjectId' HAVING count(*) > 1) THEN PERFORM image_raise('IMAGE_INVALID_INPUT'); END IF;
  SELECT * INTO j FROM "ImageHistoryJob" WHERE "requestId" = image_uuid(p->>'requestId') FOR UPDATE;
  IF FOUND THEN
    IF j."actorId" <> v_actor OR j.mode <> v_mode OR j.scope <> v_scope OR j."planDigest" <> p->>'planDigest' OR j."publicUrlBase" <> v_base OR j."sourceBindings" <> p->'sourceBindings'
      OR j."targetLocationId" IS DISTINCT FROM p->>'targetLocationId' OR j."retireSource" <> (p->>'retireSource')::boolean OR j."upperBound" <> v_upper THEN PERFORM image_raise('IMAGE_HISTORY_CONFLICT'); END IF;
    RETURN image_history_job_json(j.id);
  END IF;
  INSERT INTO "ImageHistoryJob" ("requestId","actorId",mode,scope,"planDigest","publicUrlBase","sourceBindings","targetLocationId","retireSource","upperBound")
    VALUES (image_uuid(p->>'requestId'),v_actor,v_mode,v_scope,p->>'planDigest',v_base,p->'sourceBindings',p->>'targetLocationId',(p->>'retireSource')::boolean,v_upper) RETURNING * INTO j;
  RETURN image_history_job_json(j.id);
END;
$$;
CREATE FUNCTION image_get_history_job(p JSONB) RETURNS JSONB LANGUAGE plpgsql STABLE AS $$
DECLARE v_id UUID;
BEGIN
  IF (p->>'jobId' IS NULL) = (p->>'requestId' IS NULL) THEN PERFORM image_raise('IMAGE_INVALID_INPUT'); END IF;
  IF p->>'jobId' IS NOT NULL THEN v_id := image_uuid(p->>'jobId'); ELSE SELECT id INTO v_id FROM "ImageHistoryJob" WHERE "requestId" = image_uuid(p->>'requestId'); END IF;
  RETURN image_history_job_json(v_id);
END;
$$;
CREATE FUNCTION image_get_history_item(p JSONB) RETURNS JSONB LANGUAGE SQL STABLE AS $$ SELECT image_history_item_json(image_uuid(p->>'itemId')) $$;
CREATE FUNCTION image_get_history_aliases(p JSONB) RETURNS JSONB LANGUAGE SQL STABLE AS $$
  SELECT COALESCE(jsonb_agg(url ORDER BY url),'[]'::jsonb) FROM "ImageUrlAlias" WHERE "assetId" = image_uuid(p->>'assetId')
$$;
CREATE FUNCTION image_list_history_items(p JSONB) RETURNS JSONB LANGUAGE plpgsql STABLE AS $$
DECLARE v_limit INTEGER; v_job UUID; v_cursor UUID; v_rows JSONB; v_next UUID; v_more BOOLEAN;
BEGIN
  v_limit := image_management_integer(COALESCE(p->>'limit','100'),1,1000); v_job := image_uuid(p->>'jobId');
  IF p->>'cursor' IS NOT NULL THEN v_cursor := image_uuid(p->>'cursor'); END IF;
  WITH page AS (SELECT id FROM "ImageHistoryItem" WHERE "jobId" = v_job AND (v_cursor IS NULL OR id > v_cursor) ORDER BY id LIMIT v_limit+1),
    limited AS (SELECT id FROM page ORDER BY id LIMIT v_limit)
  SELECT COALESCE(jsonb_agg(image_history_item_json(id) ORDER BY id),'[]'::jsonb),(SELECT id FROM limited ORDER BY id DESC LIMIT 1),(SELECT count(*) > v_limit FROM page)
    INTO v_rows,v_next,v_more FROM limited;
  RETURN jsonb_build_object('items',v_rows,'nextCursor',CASE WHEN v_more THEN v_next ELSE NULL END);
END;
$$;
CREATE FUNCTION image_claim_history_item(p JSONB) RETURNS JSONB LANGUAGE plpgsql AS $$
DECLARE j "ImageHistoryJob"; i "ImageHistoryItem"; v_page JSONB; c JSONB; b JSONB; v_id UUID; v_subject TEXT; v_worker TEXT; v_token UUID; v_asset UUID;
BEGIN
  v_worker := image_required_text(p->>'workerId',128); v_token := image_uuid(p->>'token');
  PERFORM image_lock_quota(); SELECT * INTO j FROM "ImageHistoryJob" WHERE id = image_uuid(p->>'jobId') FOR UPDATE;
  IF j.id IS NULL OR j.state = 'CANCELLED' THEN PERFORM image_raise('IMAGE_HISTORY_CONFLICT'); END IF;
  IF p->>'itemId' IS NOT NULL THEN
    SELECT * INTO i FROM "ImageHistoryItem" WHERE id = image_uuid(p->>'itemId') AND "jobId" = j.id FOR UPDATE;
    IF NOT FOUND THEN PERFORM image_raise('IMAGE_HISTORY_CONFLICT'); END IF;
  ELSE
    SELECT * INTO i FROM "ImageHistoryItem" WHERE "jobId" = j.id AND (state IN ('PENDING','OBSERVED','ADOPTED','COPYING','RECONCILING') OR (j."retireSource" AND state = 'SOURCE_RETAINED' AND "retirementJobId" IS NULL))
      AND ("leaseExpiresAt" IS NULL OR "leaseExpiresAt" <= clock_timestamp() OR token = v_token) ORDER BY "subjectKind","subjectId" LIMIT 1 FOR UPDATE;
    IF NOT FOUND AND NOT j."scanComplete" THEN
      v_page := image_scan_history(jsonb_build_object('scope',j.scope,'cursor',j.cursor,'upperBound',j."upperBound",'limit',100));
      FOR c IN SELECT value FROM jsonb_array_elements(v_page->'candidates') LOOP
        SELECT value INTO b FROM jsonb_array_elements(j."sourceBindings") WHERE value->>'subjectKind' = c->>'subjectKind' AND value->>'subjectId' = c->>'subjectId';
        v_asset := NULL;
        IF c->'snapshot'->>'mediaAssetId' IS NOT NULL THEN v_asset := (c->'snapshot'->>'mediaAssetId')::uuid;
        ELSIF c->>'exactUrl' IS NOT NULL THEN SELECT "assetId" INTO v_asset FROM "ImageUrlAlias" WHERE url = c->>'exactUrl'; END IF;
        INSERT INTO "ImageHistoryItem" ("jobId","subjectKind","subjectId","ownerId","exactUrl",snapshot,"snapshotHash","sourceBinding",state,"errorCode")
          VALUES (j.id,c->>'subjectKind',c->>'subjectId',COALESCE(c->>'ownerId',b->>'ownerId'),c->>'exactUrl',c->'snapshot',c->>'snapshotHash',b,
            CASE WHEN b IS NULL OR c->>'classification' IN ('VIDEO_EXCLUDED','DATA_URL') THEN 'EXCLUDED' ELSE 'PENDING' END,
            CASE WHEN b IS NULL OR c->>'classification' IN ('VIDEO_EXCLUDED','DATA_URL') THEN c->>'classification' ELSE NULL END)
          ON CONFLICT ("jobId","subjectKind","subjectId") DO NOTHING RETURNING id INTO v_id;
        IF v_id IS NOT NULL AND b IS NOT NULL AND c->>'classification' NOT IN ('VIDEO_EXCLUDED','DATA_URL') THEN
          -- Holding an original Canvas ID also excludes it from compatibility GC
          -- while SOURCE IO happens outside this transaction.
          INSERT INTO "ImageHistoryHold" ("itemId","assetId","canvasImportId") VALUES (v_id,v_asset,CASE WHEN c->>'subjectKind' = 'CANVAS_IMPORT' THEN c->>'subjectId' ELSE NULL END);
        END IF;
      END LOOP;
      UPDATE "ImageHistoryJob" SET cursor = COALESCE(v_page->>'nextCursor',(SELECT max(value->>'subjectKind'||':'||(value->>'subjectId')) FROM jsonb_array_elements(v_page->'candidates')),j.cursor),
        "scanComplete" = v_page->>'nextCursor' IS NULL WHERE id = j.id;
      SELECT * INTO i FROM "ImageHistoryItem" WHERE "jobId" = j.id AND state = 'PENDING' ORDER BY "subjectKind","subjectId" LIMIT 1 FOR UPDATE;
    END IF;
  END IF;
  IF i.id IS NULL THEN PERFORM image_refresh_history_job(j.id); RETURN NULL; END IF;
  IF i."leaseExpiresAt" > clock_timestamp() AND i.token IS DISTINCT FROM v_token THEN RETURN NULL; END IF;
  UPDATE "ImageHistoryItem" SET token = v_token,"workerId" = v_worker,"leaseExpiresAt" = clock_timestamp()+interval '90 seconds' WHERE id = i.id;
  PERFORM image_refresh_history_job(j.id); RETURN image_history_item_json(i.id);
END;
$$;
CREATE FUNCTION image_history_lock_item(p JSONB) RETURNS "ImageHistoryItem" LANGUAGE plpgsql AS $$
DECLARE i "ImageHistoryItem"; v_job UUID;
BEGIN
  PERFORM image_lock_quota(); SELECT "jobId" INTO v_job FROM "ImageHistoryItem" WHERE id = image_uuid(p->>'itemId');
  PERFORM 1 FROM "ImageHistoryJob" WHERE id = v_job AND state <> 'CANCELLED' FOR UPDATE;
  IF NOT FOUND THEN PERFORM image_raise('IMAGE_HISTORY_CONFLICT'); END IF;
  SELECT * INTO i FROM "ImageHistoryItem" WHERE id = image_uuid(p->>'itemId') FOR UPDATE;
  IF i.id IS NULL OR i.token IS DISTINCT FROM image_uuid(p->>'token') OR i."leaseExpiresAt" <= clock_timestamp() THEN PERFORM image_raise('IMAGE_HISTORY_CONFLICT'); END IF;
  RETURN i;
END;
$$;
CREATE FUNCTION image_block_history_item(p JSONB) RETURNS JSONB LANGUAGE plpgsql AS $$
DECLARE i "ImageHistoryItem";
BEGIN
  i := image_history_lock_item(p);
  IF p->>'errorCode' NOT IN ('IMAGE_STORAGE_UNAVAILABLE','IMAGE_WRITE_CONFLICT','IMAGE_LOCATION_CONFLICT','IMAGE_QUOTA_EXCEEDED','IMAGE_HISTORY_CONFLICT','IMAGE_OBSERVATION_REQUIRED','IMAGE_HISTORY_BLOCKED','IMAGE_UNAVAILABLE','IMAGE_READER_INCOMPATIBLE') THEN PERFORM image_raise('IMAGE_INVALID_INPUT'); END IF;
  UPDATE "ImageHistoryItem" SET state = 'BLOCKED',"errorCode" = p->>'errorCode',"leaseExpiresAt" = clock_timestamp() WHERE id = i.id;
  PERFORM image_refresh_history_job(i."jobId"); RETURN image_history_item_json(i.id);
END;
$$;

CREATE FUNCTION image_observation_insert_guard() RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE i "ImageHistoryItem"; o "ImageObject"; l "ImageStorageLocation";
BEGIN
  SELECT * INTO i FROM "ImageHistoryItem" WHERE id = NEW."itemId";
  SELECT * INTO l FROM "ImageStorageLocation" WHERE id = NEW."locationId";
  IF i.id IS NULL OR i."leaseExpiresAt" <= clock_timestamp() OR i."workerId" IS DISTINCT FROM NEW."recordedBy" OR NEW."sourceSnapshotHash" IS DISTINCT FROM i."snapshotHash"
    OR l.id IS NULL OR l."physicalNamespace" IS DISTINCT FROM NEW."physicalNamespace" THEN PERFORM image_raise('IMAGE_OBSERVATION_REQUIRED'); END IF;
  IF NEW.kind = 'SOURCE' THEN
    IF i."sourceBinding" IS NULL OR i."sourceBinding"->>'locationId' IS DISTINCT FROM NEW."locationId" OR i."sourceBinding"->>'key' IS DISTINCT FROM NEW.key
      OR i."sourceBinding"->>'expectedSnapshotHash' IS DISTINCT FROM i."snapshotHash" THEN PERFORM image_raise('IMAGE_OBSERVATION_REQUIRED'); END IF;
    IF NEW."readResult" = 'DECLARED' AND (i."subjectKind" <> 'CANVAS_IMPORT' OR NEW."byteLength"::text IS DISTINCT FROM i.snapshot->>'byteLength'
      OR NEW.sha256 IS DISTINCT FROM i.snapshot->>'sha256' OR NEW."mimeType" IS DISTINCT FROM i.snapshot->>'mimeType') THEN PERFORM image_raise('IMAGE_OBSERVATION_REQUIRED'); END IF;
  ELSE
    SELECT * INTO o FROM "ImageObject" WHERE id = i."targetObjectId";
    IF o.id IS NULL OR o."locationId" IS DISTINCT FROM NEW."locationId" OR o.key IS DISTINCT FROM NEW.key
      OR (NEW."originalWriteToken" IS NOT NULL AND NEW."originalWriteToken" IS DISTINCT FROM o."writeToken") THEN PERFORM image_raise('IMAGE_OBSERVATION_REQUIRED'); END IF;
  END IF;
  IF l.provider = 'LOCAL' AND NEW."versionId" IS NOT NULL THEN PERFORM image_raise('IMAGE_LOCATION_CONFLICT'); END IF;
  NEW."recordedAt" := clock_timestamp(); RETURN NEW;
END;
$$;
CREATE TRIGGER "ImageObjectObservation_guard" BEFORE INSERT ON "ImageObjectObservation" FOR EACH ROW EXECUTE FUNCTION image_observation_insert_guard();
CREATE FUNCTION image_record_object_observation(p JSONB) RETURNS JSONB LANGUAGE plpgsql AS $$
DECLARE i "ImageHistoryItem"; x "ImageObjectObservation"; v_size BIGINT; v_namespace TEXT; v_payload JSONB;
BEGIN
  i := image_history_lock_item(p); IF p->>'byteLength' IS NOT NULL THEN v_size := image_history_bytes(p->>'byteLength'); END IF;
  SELECT "physicalNamespace" INTO v_namespace FROM "ImageStorageLocation" WHERE id = p->>'locationId';
  SELECT * INTO x FROM "ImageObjectObservation" WHERE "requestId" = image_uuid(p->>'requestId');
  IF FOUND THEN
    v_payload := to_jsonb(x)-ARRAY['id','physicalNamespace','recordedBy','recordedAt'];
    IF v_payload IS DISTINCT FROM jsonb_build_object('requestId',p->>'requestId','itemId',i.id,'kind',p->>'kind','sourceSnapshotHash',p->>'sourceSnapshotHash',
      'locationId',p->>'locationId','key',p->>'key','readResult',p->>'readResult','byteLength',v_size,'sha256',p->>'sha256','mimeType',p->>'mimeType',
      'versionEvidence',p->>'versionEvidence','versionId',p->>'versionId','etag',p->>'etag','lastModified',p->>'lastModified','writerEvidence',p->>'writerEvidence',
      'originalWriteToken',p->>'originalWriteToken','writerProofSha256',p->>'writerProofSha256') THEN PERFORM image_raise('IMAGE_HISTORY_CONFLICT'); END IF;
    RETURN jsonb_build_object('id',x.id);
  END IF;
  INSERT INTO "ImageObjectObservation" ("requestId","itemId",kind,"sourceSnapshotHash","locationId","physicalNamespace",key,"readResult","byteLength",sha256,"mimeType","versionEvidence","versionId",etag,"lastModified","writerEvidence","originalWriteToken","writerProofSha256","recordedBy")
    VALUES (image_uuid(p->>'requestId'),i.id,p->>'kind',p->>'sourceSnapshotHash',p->>'locationId',v_namespace,p->>'key',p->>'readResult',v_size,p->>'sha256',p->>'mimeType',
      p->>'versionEvidence',p->>'versionId',p->>'etag',p->>'lastModified',p->>'writerEvidence',CASE WHEN p->>'originalWriteToken' IS NULL THEN NULL ELSE image_uuid(p->>'originalWriteToken') END,p->>'writerProofSha256',i."workerId") RETURNING * INTO x;
  RETURN jsonb_build_object('id',x.id);
END;
$$;

CREATE FUNCTION image_adopt_observed_object(p JSONB) RETURNS JSONB LANGUAGE plpgsql AS $$
DECLARE i "ImageHistoryItem"; j "ImageHistoryJob"; x "ImageObjectObservation"; a "ImageAsset"; o "ImageObject"; c "CanvasImportAsset";
  l "ImageStorageLocation"; v_snapshot JSONB; v_ready BOOLEAN; v_delta BIGINT := 0; v_replayed BOOLEAN := false; v_orphan BOOLEAN := false; v_purpose TEXT; v_origin TEXT; v_url TEXT; v_over BOOLEAN;
BEGIN
  i := image_history_lock_item(p); SELECT * INTO j FROM "ImageHistoryJob" WHERE id = i."jobId";
  IF p->>'expectedBusinessSnapshotHash' IS DISTINCT FROM i."snapshotHash" THEN PERFORM image_raise('IMAGE_HISTORY_CONFLICT'); END IF;
  IF i."sourceObjectId" IS NOT NULL THEN
    SELECT q."usedBytes"::numeric+q."reservedBytes" > s."limitBytes" INTO v_over FROM "ImageQuota" q JOIN "ImageStoragePolicy" s USING(scope) WHERE q.scope = 'images';
    RETURN jsonb_build_object('item',image_history_item_json(i.id),'replayed',true,'accountedDelta','0','overLimit',v_over);
  END IF;
  SELECT * INTO x FROM "ImageObjectObservation" WHERE id = image_uuid(p->>'observationId') AND "itemId" = i.id AND kind = 'SOURCE';
  IF x.id IS NULL OR x."sourceSnapshotHash" <> i."snapshotHash" OR x."readResult" NOT IN ('FULL','DECLARED') OR x."byteLength" IS NULL OR x.sha256 IS NULL OR x."mimeType" IS NULL
    OR i."sourceBinding" IS NULL OR i."sourceBinding"->>'expectedSnapshotHash' IS DISTINCT FROM i."snapshotHash" THEN PERFORM image_raise('IMAGE_OBSERVATION_REQUIRED'); END IF;
  -- Snapshot and binding are frozen before IO. Row locks use the same epoch as
  -- Canvas Save/Run, ordinary inputs and current-cover mutations.
  IF i."subjectKind" = 'GENERATED' THEN PERFORM id FROM "GenerationImage" WHERE id = i."subjectId" FOR UPDATE;
  ELSIF i."subjectKind" = 'CANVAS_IMPORT' THEN SELECT * INTO c FROM "CanvasImportAsset" WHERE id = i."subjectId" FOR UPDATE;
  ELSIF i."subjectKind" <> 'REFERENCE_URL' THEN PERFORM image_raise('IMAGE_HISTORY_CONFLICT'); END IF;
  v_snapshot := image_history_subject_snapshot(i."subjectKind",i."subjectId");
  IF v_snapshot IS NULL THEN
    -- The immutable item and SOURCE observation retain the business/key proof
    -- captured before IO. A concurrent business cascade does not erase the
    -- already-existing bytes. Count them, but never resurrect or alias a live
    -- business identity whose final CAS can no longer be established.
    v_orphan := true;
  ELSIF image_history_digest(v_snapshot) <> i."snapshotHash" THEN PERFORM image_raise('IMAGE_HISTORY_CONFLICT'); END IF;
  SELECT * INTO l FROM "ImageStorageLocation" WHERE id = x."locationId";
  IF i."subjectKind" <> 'REFERENCE_URL' AND i."sourceBinding"->>'ownerId' IS DISTINCT FROM i.snapshot->>'ownerId' THEN PERFORM image_raise('IMAGE_HISTORY_CONFLICT'); END IF;
  IF i."subjectKind" = 'GENERATED' AND NOT v_orphan AND NOT EXISTS (SELECT 1 FROM "GenerationJob" WHERE id = i.snapshot->>'jobId' AND "generationType"::text IN ('TEXT_TO_IMAGE','IMAGE_TO_IMAGE')) THEN PERFORM image_raise('IMAGE_HISTORY_CONFLICT'); END IF;
  IF i."subjectKind" = 'GENERATED' AND i.snapshot->>'storageKey' IS NOT NULL AND i.snapshot->>'storageKey' IS DISTINCT FROM x.key THEN PERFORM image_raise('IMAGE_LOCATION_CONFLICT'); END IF;
  IF i."subjectKind" = 'CANVAS_IMPORT' AND (c.id IS NULL OR c."sourceProvider" <> l.provider OR c."storageLocation" <> l.id OR c."storageKey" <> x.key
    OR c."storageEndpoint" IS DISTINCT FROM l.endpoint OR c."storageRegion" IS DISTINCT FROM l.region OR c."storageBucket" IS DISTINCT FROM l.bucket
    OR c."byteLength" <> x."byteLength" OR c.sha256 <> x.sha256 OR c."mimeType" <> x."mimeType") THEN PERFORM image_raise('IMAGE_LOCATION_CONFLICT'); END IF;
  v_purpose := CASE WHEN i."subjectKind" = 'REFERENCE_URL' THEN 'REFERENCE' ELSE i."subjectKind" END;
  v_origin := CASE WHEN i."subjectKind" = 'REFERENCE_URL' THEN 'history-url:'||i."subjectId" ELSE i."subjectId" END;
  v_ready := NOT v_orphan AND x."readResult" = 'FULL' AND x."versionEvidence" = 'UNVERSIONED' AND x."byteLength" <= 52428800;
  -- Missing/oversized original URLs cannot be bridged to an exact alias. Keep
  -- their observed bytes held rather than making frozen inputs depend on a
  -- source that a later switch/retirement could remove.
  IF i."subjectKind" = 'GENERATED' AND i."exactUrl" IS NULL THEN v_ready := false; END IF;
  IF i."subjectKind" = 'CANVAS_IMPORT' AND (c.state <> 'READY' OR c."putOutcome" <> 'CONFIRMED' OR c."storageVersionId" IS NOT NULL OR c."needsReconciliation"
    OR c."deleteToken" IS NOT NULL OR EXISTS (SELECT 1 FROM "CanvasGcLease" WHERE "expiresAt" > clock_timestamp())) THEN v_ready := false; END IF;
  IF i."subjectKind" = 'GENERATED' AND EXISTS (SELECT 1 FROM "GenerationJob" WHERE id = i.snapshot->>'jobId' AND status::text IN ('PENDING','PROCESSING')) THEN v_ready := false; END IF;
  SELECT * INTO o FROM "ImageObject" WHERE "physicalNamespace" = x."physicalNamespace" AND key = x.key;
  -- Physical reuse is not proof of URL ownership. Only a pre-existing exact
  -- alias of this same asset or this source's declared publication may bind.
  IF i."exactUrl" IS NOT NULL
    AND NOT EXISTS (SELECT 1 FROM "ImageUrlAlias" WHERE url = i."exactUrl" AND "assetId" = o."assetId")
    AND i."exactUrl" IS DISTINCT FROM rtrim(l."publicBaseUrl",'/')||'/'||x.key
    AND i."exactUrl" IS DISTINCT FROM l.endpoint||'/'||l.bucket||'/'||x.key THEN PERFORM image_raise('IMAGE_LOCATION_CONFLICT'); END IF;
  IF o.id IS NOT NULL THEN
    SELECT * INTO a FROM "ImageAsset" WHERE id = o."assetId" FOR UPDATE;
    PERFORM id FROM "ImageObject" WHERE id = o.id FOR UPDATE;
    IF o."byteLength" <> x."byteLength" OR o.sha256 <> x.sha256 OR o."mimeType" <> x."mimeType" OR a."ownerId" IS DISTINCT FROM i."sourceBinding"->>'ownerId'
      OR (i."subjectKind" <> 'REFERENCE_URL' AND (a.purpose <> v_purpose OR (a."originId" IS DISTINCT FROM v_origin
        AND NOT (i."subjectKind" = 'GENERATED' AND i.snapshot->>'mediaAssetId' = a.id::text AND a."originId" IS NULL))))
      OR (i."subjectKind" = 'GENERATED' AND EXISTS (SELECT 1 FROM "ImageGenerationBinding" WHERE "assetId" = a.id AND "imageId" <> i."subjectId"))
      OR a.state IN ('DELETING','DELETED') OR o.state IN ('DELETING','DELETED') THEN PERFORM image_raise('IMAGE_HISTORY_CONFLICT'); END IF;
    v_ready := v_ready AND a.state = 'AVAILABLE' AND image_object_verified(o) AND o.state = 'READY'; v_replayed := true;
    UPDATE "ImageHistoryItem" SET "assetId" = a.id,"sourceObservationId" = x.id WHERE id = i.id;
    UPDATE "ImageHistoryHold" SET "assetId" = a.id WHERE "itemId" = i.id;
  ELSE
    IF i.snapshot->>'mediaAssetId' IS NOT NULL THEN PERFORM image_raise('IMAGE_HISTORY_CONFLICT'); END IF;
    INSERT INTO "ImageAsset" ("ownerId",purpose,"originId","byteLength","mimeType",sha256)
      VALUES (i."sourceBinding"->>'ownerId',v_purpose,v_origin,x."byteLength",x."mimeType",x.sha256) RETURNING * INTO a;
    UPDATE "ImageHistoryItem" SET "assetId" = a.id,"sourceObservationId" = x.id WHERE id = i.id;
    UPDATE "ImageHistoryHold" SET "assetId" = a.id WHERE "itemId" = i.id;
    INSERT INTO "ImageObject" ("assetId",provenance,"sourceObservationId","locationId","physicalNamespace",key,"byteLength","mimeType",sha256,state,"putOutcome","versionId","needsReconciliation")
      VALUES (a.id,'OBSERVED',x.id,x."locationId",x."physicalNamespace",x.key,x."byteLength",x."mimeType",x.sha256,
        CASE WHEN v_ready THEN 'READY' ELSE 'UNKNOWN' END,CASE WHEN i."subjectKind" = 'CANVAS_IMPORT' AND c."putOutcome" = 'UNKNOWN' THEN 'UNKNOWN' ELSE 'NOT_APPLICABLE' END,
        x."versionId",NOT v_ready) RETURNING * INTO o;
    v_delta := o."byteLength";
    UPDATE "ImageAsset" SET state = CASE WHEN v_ready THEN 'AVAILABLE' ELSE 'QUARANTINED' END,"activeObjectId" = CASE WHEN v_ready THEN o.id ELSE NULL END,"detachedAt" = clock_timestamp() WHERE id = a.id;
  END IF;
  UPDATE "ImageHistoryItem" SET "sourceObjectId" = o.id,state = CASE WHEN v_ready THEN 'ADOPTED' ELSE 'BLOCKED' END,
    "errorCode" = CASE WHEN v_ready THEN NULL ELSE 'IMAGE_HISTORY_BLOCKED' END WHERE id = i.id;
  IF v_ready THEN
    IF i."subjectKind" = 'GENERATED' THEN
      UPDATE "GenerationImage" SET "mediaAssetId" = a.id WHERE id = i."subjectId" AND ("mediaAssetId" IS NULL OR "mediaAssetId" = a.id);
      IF NOT FOUND THEN PERFORM image_raise('IMAGE_HISTORY_CONFLICT'); END IF;
    ELSIF i."subjectKind" = 'CANVAS_IMPORT' THEN
      UPDATE "CanvasImportAsset" SET "mediaAssetId" = a.id WHERE id = c.id AND ("mediaAssetId" IS NULL OR "mediaAssetId" = a.id);
      IF NOT FOUND THEN PERFORM image_raise('IMAGE_HISTORY_CONFLICT'); END IF;
    END IF;
    IF i."exactUrl" IS NOT NULL THEN PERFORM image_register_alias(jsonb_build_object('assetId',a.id,'url',i."exactUrl")); END IF;
    PERFORM image_register_alias(jsonb_build_object('assetId',a.id,'url',j."publicUrlBase"||'/media/images/'||a."publicToken"));
    IF i."subjectKind" = 'CANVAS_IMPORT' AND l.provider = 'S3' THEN
      v_url := COALESCE(rtrim(l."publicBaseUrl",'/'),l.endpoint||'/'||l.bucket)||'/'||x.key;
      IF octet_length(v_url) <= 2048 THEN PERFORM image_register_alias(jsonb_build_object('assetId',a.id,'url',v_url)); END IF;
    END IF;
    PERFORM image_bridge_known_history(a.id);
    IF j.mode = 'ADOPT' THEN
      UPDATE "ImageHistoryItem" SET state = 'SOURCE_RETAINED',"errorCode" = NULL WHERE id = i.id;
      UPDATE "ImageHistoryHold" SET "releasedAt" = clock_timestamp() WHERE "itemId" = i.id;
    END IF;
  END IF;
  PERFORM image_refresh_history_job(i."jobId");
  SELECT q."usedBytes"::numeric+q."reservedBytes" > s."limitBytes" INTO v_over FROM "ImageQuota" q JOIN "ImageStoragePolicy" s USING(scope) WHERE q.scope = 'images';
  RETURN jsonb_build_object('item',image_history_item_json(i.id),'replayed',v_replayed,'accountedDelta',v_delta::text,'overLimit',v_over);
END;
$$;

CREATE FUNCTION image_prepare_migration_copy(p JSONB) RETURNS JSONB LANGUAGE plpgsql AS $$
DECLARE i "ImageHistoryItem"; j "ImageHistoryJob"; a "ImageAsset"; s "ImageObject"; t "ImageObject"; r "ImageWriteReservation";
  v_res JSONB; v_ticket JSONB; v_intent TEXT; v_key TEXT;
BEGIN
  i := image_history_lock_item(p); SELECT * INTO j FROM "ImageHistoryJob" WHERE id = i."jobId";
  IF j.mode <> 'COPY' OR j."targetLocationId" IS DISTINCT FROM p->>'targetLocationId' OR i."sourceObjectId" IS DISTINCT FROM image_uuid(p->>'expectedSourceObjectId') THEN PERFORM image_raise('IMAGE_HISTORY_CONFLICT'); END IF;
  IF i."targetObjectId" IS NOT NULL THEN
    SELECT * INTO r FROM "ImageWriteReservation" WHERE id = i."reservationId";
    SELECT * INTO t FROM "ImageObject" WHERE id = i."targetObjectId"; SELECT * INTO a FROM "ImageAsset" WHERE id = i."assetId";
    RETURN jsonb_build_object('item',image_history_item_json(i.id),'reservation',image_reservation_json(r),'ticket',jsonb_build_object('asset',image_asset_json(a),'object',image_object_json(t),'writeGranted',false));
  END IF;
  SELECT * INTO a FROM "ImageAsset" WHERE id = i."assetId";
  SELECT * INTO s FROM "ImageObject" WHERE id = i."sourceObjectId";
  IF a.id IS NULL OR a.state <> 'AVAILABLE' OR s.id IS NULL OR s.state <> 'READY' OR NOT image_object_verified(s) OR s."locationId" = j."targetLocationId"
    OR (i."subjectKind" = 'GENERATED' AND i."exactUrl" IS NULL)
    OR i.state NOT IN ('ADOPTED','BLOCKED') THEN PERFORM image_raise('IMAGE_HISTORY_BLOCKED'); END IF;
  IF a."activeObjectId" IS DISTINCT FROM s.id THEN
    SELECT * INTO t FROM "ImageObject" WHERE id = a."activeObjectId" AND "locationId" = j."targetLocationId" AND provenance = 'WRITE';
    SELECT * INTO r FROM "ImageWriteReservation" WHERE id = t."reservationId";
    IF t.id IS NULL OR t.state <> 'READY' OR NOT image_object_verified(t) OR r.state <> 'CLOSED' THEN PERFORM image_raise('IMAGE_HISTORY_BLOCKED'); END IF;
    UPDATE "ImageHistoryItem" SET state = 'COPYING',"reservationId" = r.id,"targetObjectId" = t.id,attempt = 1,"intentKey" = r."intentKey","targetKey" = t.key,"errorCode" = NULL WHERE id = i.id;
    RETURN jsonb_build_object('item',image_history_item_json(i.id),'reservation',image_reservation_json(r),'ticket',jsonb_build_object('asset',image_asset_json(a),'object',image_object_json(t),'writeGranted',false));
  END IF;
  v_intent := 'history-copy:'||i.id::text||':1'; v_key := 'history/'||i.id::text||'/1-'||a.sha256;
  -- Existing gate and begin action remain the sole producers of PUT grants.
  -- The item, attempt, intent, key and physical descriptor commit together.
  v_res := image_prepare_copy(jsonb_build_object('assetId',a.id,'ownerId',a."ownerId",'intentKey',v_intent,'byteLength',a."byteLength"::text,'leaseSeconds',120));
  v_ticket := image_begin_object(jsonb_build_object('reservationId',v_res->>'id','token',v_res->>'token','slot',0,'locationId',j."targetLocationId",'key',v_key,
    'byteLength',a."byteLength"::text,'mimeType',a."mimeType",'sha256',a.sha256,'purpose',a.purpose,'originId',a."originId",'assetId',a.id));
  UPDATE "ImageHistoryItem" SET state = 'COPYING',"reservationId" = (v_res->>'id')::uuid,"targetObjectId" = (v_ticket->'object'->>'id')::uuid,
    attempt = 1,"intentKey" = v_intent,"targetKey" = v_key,"errorCode" = NULL WHERE id = i.id;
  RETURN jsonb_build_object('item',image_history_item_json(i.id),'reservation',v_res,'ticket',v_ticket);
END;
$$;
CREATE FUNCTION image_prepare_copy_reconciliation(p JSONB) RETURNS JSONB LANGUAGE plpgsql AS $$
DECLARE i "ImageHistoryItem"; o "ImageObject"; v_expiry TIMESTAMPTZ;
BEGIN
  i := image_history_lock_item(p);
  IF i."targetObjectId" IS NULL OR i."targetObjectId" IS DISTINCT FROM image_uuid(p->>'expectedTargetObjectId') THEN PERFORM image_raise('IMAGE_HISTORY_CONFLICT'); END IF;
  PERFORM id FROM "ImageWriteReservation" WHERE id = i."reservationId" FOR UPDATE;
  PERFORM id FROM "ImageAsset" WHERE id = i."assetId" FOR UPDATE;
  SELECT * INTO o FROM "ImageObject" WHERE id = i."targetObjectId" FOR UPDATE;
  IF o.state IN ('DELETING','DELETED') OR NOT o.accounted OR o."versionId" IS NOT NULL THEN PERFORM image_raise('IMAGE_HISTORY_BLOCKED'); END IF;
  v_expiry := clock_timestamp()+interval '45 seconds';
  IF o.state = 'READY' THEN UPDATE "ImageObject" SET "readProtectedUntil" = GREATEST("readProtectedUntil",v_expiry) WHERE id = o.id; END IF;
  UPDATE "ImageHistoryItem" SET state = 'RECONCILING',"leaseExpiresAt" = GREATEST("leaseExpiresAt",v_expiry) WHERE id = i.id;
  RETURN jsonb_build_object('item',image_history_item_json(i.id),'readExpiresAt',v_expiry);
END;
$$;
CREATE FUNCTION image_finish_copy_reconciliation(p JSONB) RETURNS JSONB LANGUAGE plpgsql AS $$
DECLARE i "ImageHistoryItem"; o "ImageObject"; x "ImageObjectObservation"; v_accepted BOOLEAN := false;
BEGIN
  i := image_history_lock_item(p);
  PERFORM id FROM "ImageWriteReservation" WHERE id = i."reservationId" FOR UPDATE;
  PERFORM id FROM "ImageAsset" WHERE id = i."assetId" FOR UPDATE;
  SELECT * INTO o FROM "ImageObject" WHERE id = i."targetObjectId" FOR UPDATE;
  SELECT * INTO x FROM "ImageObjectObservation" WHERE id = image_uuid(p->>'observationId') AND "itemId" = i.id;
  IF o.id IS NULL OR o."writeToken" IS DISTINCT FROM image_uuid(p->>'expectedOriginalWriteToken') OR x.id IS NULL THEN PERFORM image_raise('IMAGE_HISTORY_CONFLICT'); END IF;
  IF o."reconciliationObservationId" = x.id AND image_object_verified(o) THEN v_accepted := true;
  ELSIF i.state = 'RECONCILING' AND o.state IN ('WRITING','UNKNOWN') AND o."versionId" IS NULL AND o.accounted AND x.kind = 'WRITE_RECONCILIATION'
    AND x."readResult" = 'FULL' AND x."writerEvidence" = 'QUIESCED' AND x."originalWriteToken" = o."writeToken" AND x."versionEvidence" = 'UNVERSIONED'
    AND x."byteLength" = o."byteLength" AND x.sha256 = o.sha256 AND x."mimeType" = o."mimeType" AND x."locationId" = o."locationId" AND x.key = o.key THEN
    UPDATE "ImageObject" SET state = 'READY',"needsReconciliation" = false,"reconciliationObservationId" = x.id,"lastErrorCode" = NULL WHERE id = o.id;
    v_accepted := true;
  END IF;
  UPDATE "ImageHistoryItem" SET state = CASE WHEN v_accepted THEN 'COPYING' ELSE 'BLOCKED' END,
    "errorCode" = CASE WHEN v_accepted THEN NULL ELSE 'IMAGE_HISTORY_BLOCKED' END WHERE id = i.id;
  PERFORM image_refresh_history_job(i."jobId");
  RETURN jsonb_build_object('accepted',v_accepted,'state',CASE WHEN v_accepted THEN 'READY' ELSE 'BLOCKED' END,'byteDelta','0','item',image_history_item_json(i.id));
END;
$$;
CREATE FUNCTION image_commit_migration_switch(p JSONB) RETURNS JSONB LANGUAGE plpgsql AS $$
DECLARE i "ImageHistoryItem"; a "ImageAsset"; t "ImageObject"; x "ImageObjectObservation"; r "ImageWriteReservation"; v_proof JSONB; v_switched BOOLEAN;
BEGIN
  i := image_history_lock_item(p);
  IF i."replicaVerificationId" IS NOT NULL THEN
    RETURN jsonb_build_object('switched',false,'replayed',true,'replicaVerificationId',i."replicaVerificationId",'item',image_history_item_json(i.id));
  END IF;
  SELECT * INTO x FROM "ImageObjectObservation" WHERE id = image_uuid(p->>'targetReadbackObservationId') AND "itemId" = i.id;
  SELECT * INTO r FROM "ImageWriteReservation" WHERE id = i."reservationId" FOR UPDATE;
  SELECT * INTO a FROM "ImageAsset" WHERE id = i."assetId" FOR UPDATE;
  PERFORM id FROM "ImageObject" WHERE "assetId" = a.id ORDER BY id FOR UPDATE;
  SELECT * INTO t FROM "ImageObject" WHERE id = i."targetObjectId";
  IF x.id IS NULL OR x.kind NOT IN ('TARGET_READBACK','WRITE_RECONCILIATION') OR x."readResult" <> 'FULL' OR x."versionEvidence" <> 'UNVERSIONED'
    OR x."sourceSnapshotHash" <> i."snapshotHash" OR x."byteLength" IS DISTINCT FROM t."byteLength" OR x.sha256 IS DISTINCT FROM t.sha256 OR x."mimeType" IS DISTINCT FROM t."mimeType"
    OR x."locationId" IS DISTINCT FROM t."locationId" OR x.key IS DISTINCT FROM t.key OR t.state <> 'READY' OR NOT image_object_verified(t)
    OR r.state <> 'CLOSED' OR a."activeObjectId" IS DISTINCT FROM image_uuid(p->>'expectedActiveObjectId') OR a."activeObjectId" NOT IN (i."sourceObjectId",t.id)
    OR p->>'readerProtocolRevision' IS DISTINCT FROM '3' THEN PERFORM image_raise('IMAGE_OBSERVATION_REQUIRED'); END IF;
  v_switched := (image_activate_object(jsonb_build_object('assetId',a.id,'objectId',t.id,'expectedObjectId',a."activeObjectId")))::boolean;
  IF NOT v_switched THEN PERFORM image_raise('IMAGE_HISTORY_CONFLICT'); END IF;
  -- C2 verifies the target is already active. Both operations commit atomically;
  -- losing this acknowledgement can only replay this same proof, never copy.
  v_proof := image_record_replica_verification(jsonb_build_object('assetId',a.id,'sourceObjectId',i."sourceObjectId",'targetObjectId',t.id,
    'byteLength',t."byteLength"::text,'sha256',t.sha256,'aliasUrls',p->'aliasUrls','readerProtocolRevision',3));
  UPDATE "ImageHistoryItem" SET state = 'SOURCE_RETAINED',"replicaVerificationId" = (v_proof->>'id')::uuid,"errorCode" = NULL WHERE id = i.id;
  UPDATE "ImageHistoryHold" SET "releasedAt" = clock_timestamp() WHERE "itemId" = i.id;
  PERFORM image_refresh_history_job(i."jobId");
  RETURN jsonb_build_object('switched',true,'replayed',false,'replicaVerificationId',v_proof->>'id','item',image_history_item_json(i.id));
END;
$$;
CREATE FUNCTION image_request_history_source_retirement(p JSONB) RETURNS JSONB LANGUAGE plpgsql AS $$
DECLARE i "ImageHistoryItem"; j "ImageHistoryJob"; v_job JSONB;
BEGIN
  i := image_history_lock_item(p); SELECT * INTO j FROM "ImageHistoryJob" WHERE id = i."jobId";
  IF NOT j."retireSource" OR i."replicaVerificationId" IS NULL THEN PERFORM image_raise('IMAGE_HISTORY_CONFLICT'); END IF;
  v_job := image_request_source_retirement(jsonb_build_object('requestId',i.id,'assetId',i."assetId",'sourceObjectId',i."sourceObjectId",'targetObjectId',i."targetObjectId",'verificationId',i."replicaVerificationId"));
  UPDATE "ImageHistoryItem" SET state = 'RETIREMENT_REQUESTED',"retirementJobId" = (v_job->>'id')::uuid,"errorCode" = NULL WHERE id = i.id;
  PERFORM image_refresh_history_job(i."jobId");
  RETURN jsonb_build_object('item',image_history_item_json(i.id),'job',v_job);
END;
$$;

-- Write acknowledgements cannot mutate observed source provenance.
CREATE OR REPLACE FUNCTION image_finish_object(p JSONB) RETURNS JSONB LANGUAGE plpgsql AS $$
DECLARE v_object "ImageObject"; v_asset "ImageAsset"; v_res "ImageWriteReservation"; v_id UUID; v_token UUID; v_outcome TEXT; v_accepted BOOLEAN := false; v_valid BOOLEAN; v_version TEXT;
BEGIN
  v_id := image_uuid(p->>'objectId'); v_token := image_uuid(p->>'writeToken'); v_outcome := p->>'outcome'; v_version := NULLIF(p->>'versionId','');
  IF v_outcome IS NULL OR v_outcome NOT IN ('CONFIRMED','UNKNOWN','NOT_WRITTEN') OR length(v_version) > 1024 THEN PERFORM image_raise('IMAGE_INVALID_INPUT'); END IF;
  PERFORM image_lock_quota();
  SELECT * INTO v_object FROM "ImageObject" WHERE id = v_id;
  IF NOT FOUND OR v_object.provenance <> 'WRITE' OR v_object."writeToken" IS DISTINCT FROM v_token THEN PERFORM image_raise('IMAGE_WRITE_CONFLICT'); END IF;
  SELECT * INTO v_res FROM "ImageWriteReservation" WHERE id = v_object."reservationId" FOR UPDATE;
  SELECT * INTO v_asset FROM "ImageAsset" WHERE id = v_object."assetId" FOR UPDATE;
  SELECT * INTO v_object FROM "ImageObject" WHERE id = v_id FOR UPDATE;
  v_valid := v_res.state = 'ACTIVE' AND v_res.token = v_token AND v_object."writeExpiresAt" > clock_timestamp();
  IF v_res.kind = 'OUTPUT' THEN v_valid := v_valid AND EXISTS (SELECT 1 FROM "GenerationJob" WHERE id = v_res."outputJobId" AND "workerId" = v_res."workerId" AND status::text = 'PROCESSING'); END IF;
  IF v_object.state = 'READY' THEN
    IF v_version IS NOT NULL AND v_object."versionId" IS DISTINCT FROM v_version THEN PERFORM image_raise('IMAGE_WRITE_CONFLICT'); END IF;
    RETURN jsonb_build_object('asset',image_asset_json(v_asset),'object',image_object_json(v_object),'accepted',true);
  END IF;
  IF v_object.state NOT IN ('WRITING','UNKNOWN') THEN
    RETURN jsonb_build_object('asset',image_asset_json(v_asset),'object',image_object_json(v_object),'accepted',false);
  END IF;
  IF v_outcome = 'NOT_WRITTEN' THEN
    IF NOT v_valid OR v_object."putOutcome" <> 'NOT_STARTED' OR v_version IS NOT NULL THEN PERFORM image_raise('IMAGE_WRITE_CONFLICT'); END IF;
    UPDATE "ImageObject" SET state = 'DELETED',accounted = false,"deleteOutcome" = 'MISSING',"deletedAt" = clock_timestamp() WHERE id = v_id RETURNING * INTO v_object;
    v_accepted := true;
  ELSIF v_outcome = 'CONFIRMED' AND v_valid AND v_object."putOutcome" <> 'UNKNOWN' AND v_version IS NULL THEN
    UPDATE "ImageObject" SET state = 'READY',"putOutcome" = 'CONFIRMED',"versionId" = v_version WHERE id = v_id RETURNING * INTO v_object;
    IF v_asset."activeObjectId" IS NULL AND v_asset.state = 'PENDING' THEN
      UPDATE "ImageAsset" SET state = 'AVAILABLE',"activeObjectId" = v_id,"detachedAt" = clock_timestamp() WHERE id = v_asset.id RETURNING * INTO v_asset;
    END IF;
    v_accepted := true;
  ELSE
    UPDATE "ImageObject" SET state = 'UNKNOWN',"putOutcome" = 'UNKNOWN',"needsReconciliation" = true,
      "versionId" = COALESCE("versionId",v_version),"lastErrorCode" = CASE WHEN p->>'errorCode' IN ('IMAGE_INVALID_INPUT','IMAGE_QUOTA_EXCEEDED','IMAGE_RESERVATION_CONFLICT','IMAGE_RESERVATION_EXPIRED','IMAGE_WRITE_CONFLICT','IMAGE_UNAVAILABLE','IMAGE_LOCATION_CONFLICT','IMAGE_REFERENCE_CONFLICT','IMAGE_STORAGE_UNAVAILABLE','IMAGE_INTERNAL_ERROR') THEN p->>'errorCode' ELSE 'IMAGE_STORAGE_UNAVAILABLE' END
      WHERE id = v_id RETURNING * INTO v_object;
  END IF;
  IF v_asset."activeObjectId" IS NULL AND v_asset.state = 'PENDING' AND v_object.state IN ('UNKNOWN','DELETED') THEN
    UPDATE "ImageAsset" SET state = 'QUARANTINED',"detachedAt" = clock_timestamp() WHERE id = v_asset.id RETURNING * INTO v_asset;
  END IF;
  RETURN jsonb_build_object('asset',image_asset_json(v_asset),'object',image_object_json(v_object),'accepted',v_accepted);
END;
$$;
