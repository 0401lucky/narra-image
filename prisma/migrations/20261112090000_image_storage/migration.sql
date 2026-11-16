-- Managed images only. This migration never enables destructive cleanup.
CREATE TABLE "ImageStoragePolicy" (
  scope VARCHAR(16) PRIMARY KEY DEFAULT 'images' CHECK (scope = 'images'),
  version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
  "limitBytes" BIGINT NOT NULL DEFAULT 5000000000 CHECK ("limitBytes" BETWEEN 1 AND 9007199254740991),
  enabled BOOLEAN NOT NULL DEFAULT false,
  "quotaCleanupEnabled" BOOLEAN NOT NULL DEFAULT true,
  "scheduleEnabled" BOOLEAN NOT NULL DEFAULT false,
  "retentionDays" INTEGER NOT NULL DEFAULT 30 CHECK ("retentionDays" BETWEEN 1 AND 3650),
  "intervalSeconds" INTEGER NOT NULL DEFAULT 86400 CHECK ("intervalSeconds" BETWEEN 60 AND 31536000),
  "nextRunAt" TIMESTAMPTZ(3),
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT clock_timestamp(),
  "updatedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT clock_timestamp()
);
CREATE TABLE "ImageQuota" (
  scope VARCHAR(16) PRIMARY KEY DEFAULT 'images' CHECK (scope = 'images'),
  "usedBytes" BIGINT NOT NULL DEFAULT 0 CHECK ("usedBytes" >= 0),
  "reservedBytes" BIGINT NOT NULL DEFAULT 0 CHECK ("reservedBytes" >= 0),
  "updatedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT clock_timestamp()
);
INSERT INTO "ImageStoragePolicy" (scope) VALUES ('images');
INSERT INTO "ImageQuota" (scope) VALUES ('images');

CREATE TABLE "ImageStorageLocation" (
  id VARCHAR(128) PRIMARY KEY,
  provider VARCHAR(8) NOT NULL CONSTRAINT "ImageStorageLocation_provider_kind_check" CHECK (provider IN ('S3','LOCAL')),
  endpoint VARCHAR(512), region VARCHAR(128), bucket VARCHAR(255), "volumeId" UUID,
  "publicBaseUrl" VARCHAR(2048), "physicalNamespace" VARCHAR(1024) NOT NULL,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT "ImageStorageLocation_namespace_key" UNIQUE (id,"physicalNamespace"),
  CONSTRAINT "ImageStorageLocation_provider_check" CHECK (
    (provider = 'LOCAL' AND endpoint IS NULL AND region IS NULL AND bucket IS NULL AND "volumeId" IS NOT NULL
      AND "publicBaseUrl" IS NULL AND id = 'local-v1:' || "volumeId"::text
      AND "physicalNamespace" = 'local:' || "volumeId"::text)
    OR (provider = 'S3' AND endpoint IS NOT NULL AND region IS NOT NULL AND bucket IS NOT NULL AND "volumeId" IS NULL
      AND endpoint ~ '^https?://([a-z0-9.-]+|\[[a-f0-9:]+\])(:[1-9][0-9]{0,4})?$'
      AND region ~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$' AND bucket ~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,254}$'
      AND id = 's3-v1:' || encode(sha256(convert_to('["' || endpoint || '","' || region || '","' || bucket || '"]','UTF8')),'hex')
      AND "physicalNamespace" = 's3:' || endpoint || '/' || bucket)
  ),
  CONSTRAINT "ImageStorageLocation_public_url_check" CHECK ("publicBaseUrl" IS NULL OR
    (octet_length("publicBaseUrl") <= 2048 AND "publicBaseUrl" ~ '^https?://' AND "publicBaseUrl" !~ '^https?://[^/]*@' AND "publicBaseUrl" !~ '[?#]'))
);
CREATE TABLE "ImageWriteReservation" (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(), token UUID NOT NULL DEFAULT gen_random_uuid(),
  "ownerId" VARCHAR(128) NOT NULL CHECK (length("ownerId") BETWEEN 1 AND 128),
  "intentKey" VARCHAR(256) NOT NULL CHECK (length("intentKey") BETWEEN 1 AND 256),
  kind VARCHAR(16) NOT NULL CHECK (kind IN ('OUTPUT','INPUT','COPY')),
  "slotBytes" BIGINT[] NOT NULL,
  "remainingBytes" BIGINT NOT NULL CHECK ("remainingBytes" >= 0),
  state VARCHAR(16) NOT NULL DEFAULT 'ACTIVE' CHECK (state IN ('ACTIVE','CLOSED')),
  "outputJobId" VARCHAR(128) UNIQUE, "workerId" VARCHAR(128),
  "leaseExpiresAt" TIMESTAMPTZ(3) NOT NULL,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT clock_timestamp(),
  "updatedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT "ImageWriteReservation_intent_key" UNIQUE ("ownerId","intentKey"),
  CONSTRAINT "ImageWriteReservation_slots_check" CHECK (
    array_ndims("slotBytes") = 1 AND array_lower("slotBytes",1) = 1 AND cardinality("slotBytes") BETWEEN 1 AND 4
    AND array_position("slotBytes",NULL) IS NULL AND 1 <= ALL("slotBytes") AND 52428800 >= ALL("slotBytes")
    AND ((kind = 'OUTPUT' AND 52428800 = ALL("slotBytes")) OR (kind <> 'OUTPUT' AND cardinality("slotBytes") = 1))
    AND ("outputJobId" IS NULL OR kind = 'OUTPUT') AND (state <> 'CLOSED' OR "remainingBytes" = 0)
  )
);
CREATE INDEX "ImageWriteReservation_expiry_idx" ON "ImageWriteReservation" (state,"leaseExpiresAt");
CREATE TABLE "ImageAsset" (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "ownerId" VARCHAR(128) NOT NULL CHECK (length("ownerId") BETWEEN 1 AND 128),
  purpose VARCHAR(24) NOT NULL CHECK (purpose IN ('GENERATED','REFERENCE','CANVAS_IMPORT')),
  "originId" VARCHAR(128),
  "publicToken" VARCHAR(64) NOT NULL UNIQUE DEFAULT replace(gen_random_uuid()::text || gen_random_uuid()::text,'-',''),
  "byteLength" BIGINT NOT NULL CHECK ("byteLength" BETWEEN 1 AND 52428800),
  "mimeType" VARCHAR(64) NOT NULL CHECK ("mimeType" IN ('image/png','image/jpeg','image/webp','image/gif','image/avif')),
  sha256 CHAR(64) NOT NULL CHECK (sha256 ~ '^[0-9a-f]{64}$'),
  state VARCHAR(24) NOT NULL DEFAULT 'PENDING' CHECK (state IN ('PENDING','AVAILABLE','QUARANTINED','DELETING','DELETED')),
  "activeObjectId" UUID, "detachedAt" TIMESTAMPTZ(3), "deletedAt" TIMESTAMPTZ(3), "deleteReason" VARCHAR(64),
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT clock_timestamp(),
  "updatedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT "ImageAsset_token_check" CHECK ("publicToken" ~ '^[0-9a-f]{64}$'),
  CONSTRAINT "ImageAsset_origin_key" UNIQUE ("ownerId",purpose,"originId"),
  CONSTRAINT "ImageAsset_active_object_key" UNIQUE ("activeObjectId",id)
);
CREATE INDEX "ImageAsset_owner_idx" ON "ImageAsset" ("ownerId","createdAt");
CREATE INDEX "ImageAsset_cleanup_idx" ON "ImageAsset" (state,"createdAt",id);
CREATE TABLE "ImageObject" (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "assetId" UUID NOT NULL REFERENCES "ImageAsset"(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  "reservationId" UUID NOT NULL REFERENCES "ImageWriteReservation"(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  slot INTEGER NOT NULL CHECK (slot BETWEEN 0 AND 3),
  "locationId" VARCHAR(128) NOT NULL, "physicalNamespace" VARCHAR(1024) NOT NULL,
  key VARCHAR(512) NOT NULL CHECK (octet_length(key) BETWEEN 1 AND 512 AND key ~ '^[A-Za-z0-9][A-Za-z0-9._-]*(/[A-Za-z0-9][A-Za-z0-9._-]*)*$'
    AND key !~ '(^|/)\.{1,2}(/|$)' AND key !~ '//' AND right(key,1) <> '/'),
  "byteLength" BIGINT NOT NULL CHECK ("byteLength" BETWEEN 1 AND 52428800),
  "mimeType" VARCHAR(64) NOT NULL, sha256 CHAR(64) NOT NULL CHECK (sha256 ~ '^[0-9a-f]{64}$'),
  state VARCHAR(24) NOT NULL DEFAULT 'WRITING' CHECK (state IN ('WRITING','READY','UNKNOWN','DELETING','DELETED')),
  "writeToken" UUID NOT NULL, "writeExpiresAt" TIMESTAMPTZ(3) NOT NULL,
  "putOutcome" VARCHAR(16) NOT NULL DEFAULT 'NOT_STARTED' CHECK ("putOutcome" IN ('NOT_STARTED','CONFIRMED','UNKNOWN')),
  "versionId" VARCHAR(1024), accounted BOOLEAN NOT NULL DEFAULT true,
  "needsReconciliation" BOOLEAN NOT NULL DEFAULT false,
  "deleteToken" UUID, "deleteExpiresAt" TIMESTAMPTZ(3),
  "deleteOutcome" VARCHAR(16) NOT NULL DEFAULT 'NOT_STARTED' CHECK ("deleteOutcome" IN ('NOT_STARTED','DELETED','MISSING','FAILED','UNKNOWN')),
  "deleteAttempts" INTEGER NOT NULL DEFAULT 0 CHECK ("deleteAttempts" >= 0), "nextDeleteAt" TIMESTAMPTZ(3),
  "deletedAt" TIMESTAMPTZ(3), "lastErrorCode" VARCHAR(64),
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT clock_timestamp(),
  "updatedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT "ImageObject_asset_key" UNIQUE (id,"assetId"),
  CONSTRAINT "ImageObject_physical_key" UNIQUE ("physicalNamespace",key),
  CONSTRAINT "ImageObject_slot_key" UNIQUE ("reservationId",slot),
  CONSTRAINT "ImageObject_location_fkey" FOREIGN KEY ("locationId","physicalNamespace") REFERENCES "ImageStorageLocation"(id,"physicalNamespace") ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT "ImageObject_accounted_check" CHECK (accounted OR
    (state = 'DELETED' AND "putOutcome" <> 'UNKNOWN' AND NOT "needsReconciliation" AND "deleteOutcome" IN ('DELETED','MISSING'))),
  CONSTRAINT "ImageObject_ready_check" CHECK (state <> 'READY' OR ("putOutcome" = 'CONFIRMED' AND accounted AND NOT "needsReconciliation"))
);
ALTER TABLE "ImageAsset" ADD CONSTRAINT "ImageAsset_active_object_fkey" FOREIGN KEY ("activeObjectId",id) REFERENCES "ImageObject"(id,"assetId") ON DELETE RESTRICT ON UPDATE RESTRICT;
CREATE INDEX "ImageObject_asset_state_idx" ON "ImageObject" ("assetId",state);
CREATE INDEX "ImageObject_cleanup_idx" ON "ImageObject" (state,"nextDeleteAt","createdAt");
CREATE TABLE "ImageReference" (
  "assetId" UUID NOT NULL REFERENCES "ImageAsset"(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  "ownerId" VARCHAR(128) NOT NULL CHECK (length("ownerId") BETWEEN 1 AND 128),
  kind VARCHAR(24) NOT NULL CHECK (kind IN ('JOB_INPUT','CANVAS_SAVED','SHOWCASE','SITE_COVER')),
  "referenceKey" VARCHAR(256) NOT NULL CHECK (length("referenceKey") BETWEEN 1 AND 256),
  permanent BOOLEAN NOT NULL DEFAULT false CHECK (permanent = (kind = 'JOB_INPUT')),
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY ("assetId",kind,"referenceKey")
);
CREATE INDEX "ImageReference_source_idx" ON "ImageReference" ("ownerId",kind,"referenceKey");
CREATE TABLE "ImageUrlAlias" (
  url VARCHAR(2048) PRIMARY KEY CHECK (octet_length(url) BETWEEN 1 AND 2048 AND url ~ '^https?://' AND url !~ '^https?://[^/]*@'),
  "assetId" UUID NOT NULL REFERENCES "ImageAsset"(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX "ImageUrlAlias_asset_idx" ON "ImageUrlAlias" ("assetId");

ALTER TABLE "GenerationImage" ADD COLUMN "mediaAssetId" UUID;
CREATE UNIQUE INDEX "GenerationImage_mediaAssetId_key" ON "GenerationImage" ("mediaAssetId");
ALTER TABLE "GenerationImage" ADD CONSTRAINT "GenerationImage_mediaAssetId_fkey" FOREIGN KEY ("mediaAssetId") REFERENCES "ImageAsset"(id) ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "CanvasImportAsset" ADD COLUMN "sourceProvider" VARCHAR(8) NOT NULL DEFAULT 'S3', ADD COLUMN "mediaAssetId" UUID;
ALTER TABLE "CanvasImportAsset" ALTER COLUMN "storageEndpoint" DROP NOT NULL, ALTER COLUMN "storageRegion" DROP NOT NULL, ALTER COLUMN "storageBucket" DROP NOT NULL;
CREATE UNIQUE INDEX "CanvasImportAsset_mediaAssetId_key" ON "CanvasImportAsset" ("mediaAssetId");
ALTER TABLE "CanvasImportAsset" ADD CONSTRAINT "CanvasImportAsset_mediaAssetId_fkey" FOREIGN KEY ("mediaAssetId") REFERENCES "ImageAsset"(id) ON DELETE RESTRICT ON UPDATE RESTRICT;

CREATE FUNCTION image_raise(p_code TEXT) RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  IF p_code NOT IN ('IMAGE_INVALID_INPUT','IMAGE_QUOTA_EXCEEDED','IMAGE_RESERVATION_CONFLICT','IMAGE_RESERVATION_EXPIRED','IMAGE_WRITE_CONFLICT','IMAGE_UNAVAILABLE','IMAGE_LOCATION_CONFLICT','IMAGE_REFERENCE_CONFLICT','IMAGE_STORAGE_UNAVAILABLE','IMAGE_INTERNAL_ERROR') THEN p_code := 'IMAGE_INTERNAL_ERROR'; END IF;
  RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = p_code, CONSTRAINT = p_code;
END;
$$;
CREATE FUNCTION image_uuid(p_value TEXT) RETURNS UUID LANGUAGE plpgsql IMMUTABLE AS $$
BEGIN
  IF p_value IS NULL OR length(p_value) <> 36 OR p_value !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN PERFORM image_raise('IMAGE_INVALID_INPUT'); END IF;
  RETURN p_value::uuid;
END;
$$;
CREATE FUNCTION image_bytes(p_value TEXT) RETURNS BIGINT LANGUAGE plpgsql IMMUTABLE AS $$
BEGIN
  IF p_value IS NULL OR length(p_value) NOT BETWEEN 1 AND 19 OR p_value ~ '[^0-9]' OR left(p_value,1) = '0' THEN PERFORM image_raise('IMAGE_INVALID_INPUT'); END IF;
  IF p_value::numeric > 52428800 THEN PERFORM image_raise('IMAGE_INVALID_INPUT'); END IF;
  RETURN p_value::bigint;
END;
$$;
CREATE FUNCTION image_required_text(p_value TEXT, p_max INTEGER) RETURNS TEXT LANGUAGE plpgsql IMMUTABLE AS $$
BEGIN
  IF p_value IS NULL OR length(p_value) NOT BETWEEN 1 AND p_max OR p_value <> btrim(p_value) OR p_value ~ '[[:cntrl:]]' THEN PERFORM image_raise('IMAGE_INVALID_INPUT'); END IF;
  RETURN p_value;
END;
$$;
CREATE FUNCTION image_lease_seconds(p_value TEXT) RETURNS INTEGER LANGUAGE plpgsql IMMUTABLE AS $$
BEGIN
  IF p_value IS NULL THEN RETURN 1200; END IF;
  IF length(p_value) NOT BETWEEN 1 AND 4 OR p_value ~ '[^0-9]' OR left(p_value,1) = '0' THEN PERFORM image_raise('IMAGE_INVALID_INPUT'); END IF;
  IF p_value::integer NOT BETWEEN 30 AND 3600 THEN PERFORM image_raise('IMAGE_INVALID_INPUT'); END IF;
  RETURN p_value::integer;
END;
$$;
CREATE FUNCTION image_lock_quota() RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  PERFORM 1 FROM "ImageQuota" WHERE scope = 'images' FOR UPDATE;
  IF NOT FOUND THEN PERFORM image_raise('IMAGE_INTERNAL_ERROR'); END IF;
END;
$$;

-- The only quota writers are accounting triggers. Direct updates cannot silently
-- falsify usage; every object/reservation mutation participates in this gate.
CREATE FUNCTION image_guard_quota() RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' OR pg_trigger_depth() < 2 THEN PERFORM image_raise('IMAGE_WRITE_CONFLICT'); END IF;
  NEW."updatedAt" := clock_timestamp(); RETURN NEW;
END;
$$;
CREATE TRIGGER "ImageQuota_write_guard" BEFORE UPDATE OR DELETE ON "ImageQuota" FOR EACH ROW EXECUTE FUNCTION image_guard_quota();
CREATE FUNCTION image_account_delta() RETURNS TRIGGER LANGUAGE plpgsql AS $$
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
  IF (v_used > 0 OR v_reserved > 0) AND v_quota."usedBytes"::numeric + v_quota."reservedBytes" + v_used + v_reserved > v_limit THEN PERFORM image_raise('IMAGE_QUOTA_EXCEEDED'); END IF;
  UPDATE "ImageQuota" SET "usedBytes" = "usedBytes" + v_used, "reservedBytes" = "reservedBytes" + v_reserved WHERE scope = 'images';
  RETURN NEW;
END;
$$;
CREATE TRIGGER "ImageObject_accounting" AFTER INSERT OR UPDATE ON "ImageObject" FOR EACH ROW EXECUTE FUNCTION image_account_delta();
CREATE TRIGGER "ImageWriteReservation_accounting" AFTER INSERT OR UPDATE ON "ImageWriteReservation" FOR EACH ROW EXECUTE FUNCTION image_account_delta();

CREATE FUNCTION image_guard_reservation() RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN PERFORM image_raise('IMAGE_RESERVATION_CONFLICT'); END IF;
  IF TG_OP = 'UPDATE' THEN
    IF NEW.id <> OLD.id OR NEW."ownerId" <> OLD."ownerId" OR NEW."intentKey" <> OLD."intentKey" OR NEW.kind <> OLD.kind OR NEW."slotBytes" IS DISTINCT FROM OLD."slotBytes" OR NEW."createdAt" <> OLD."createdAt"
      OR (OLD."outputJobId" IS NOT NULL AND NEW."outputJobId" IS DISTINCT FROM OLD."outputJobId") OR NEW."remainingBytes" > OLD."remainingBytes"
      OR (OLD.state = 'CLOSED' AND (NEW.state <> 'CLOSED' OR NEW.token <> OLD.token OR NEW."outputJobId" IS DISTINCT FROM OLD."outputJobId")) THEN PERFORM image_raise('IMAGE_RESERVATION_CONFLICT'); END IF;
  END IF;
  NEW."updatedAt" := clock_timestamp(); RETURN NEW;
END;
$$;
CREATE TRIGGER "ImageWriteReservation_guard" BEFORE INSERT OR UPDATE OR DELETE ON "ImageWriteReservation" FOR EACH ROW EXECUTE FUNCTION image_guard_reservation();

CREATE FUNCTION image_guard_asset() RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN PERFORM image_raise('IMAGE_WRITE_CONFLICT'); END IF;
  IF TG_OP = 'UPDATE' THEN
    IF NEW.id <> OLD.id OR NEW."ownerId" <> OLD."ownerId" OR NEW.purpose <> OLD.purpose OR NEW."originId" IS DISTINCT FROM OLD."originId" OR NEW."publicToken" <> OLD."publicToken"
      OR NEW."byteLength" <> OLD."byteLength" OR NEW."mimeType" <> OLD."mimeType" OR NEW.sha256 <> OLD.sha256 OR NEW."createdAt" <> OLD."createdAt" THEN PERFORM image_raise('IMAGE_WRITE_CONFLICT'); END IF;
    IF NEW.state <> OLD.state AND NOT ((OLD.state = 'PENDING' AND NEW.state IN ('AVAILABLE','QUARANTINED')) OR (OLD.state IN ('AVAILABLE','QUARANTINED') AND NEW.state = 'DELETING') OR (OLD.state = 'DELETING' AND NEW.state = 'DELETED')) THEN PERFORM image_raise('IMAGE_WRITE_CONFLICT'); END IF;
    IF NEW.state IN ('DELETING','DELETED') AND EXISTS (SELECT 1 FROM "ImageReference" WHERE "assetId" = OLD.id) THEN PERFORM image_raise('IMAGE_REFERENCE_CONFLICT'); END IF;
    IF OLD.state = 'DELETED' AND to_jsonb(NEW) - 'updatedAt' IS DISTINCT FROM to_jsonb(OLD) - 'updatedAt' THEN PERFORM image_raise('IMAGE_WRITE_CONFLICT'); END IF;
  END IF;
  IF NEW.state = 'AVAILABLE' THEN
    IF NEW."activeObjectId" IS NULL OR NOT EXISTS (SELECT 1 FROM "ImageObject" o WHERE o.id = NEW."activeObjectId" AND o."assetId" = NEW.id AND o.state = 'READY' AND o."byteLength" = NEW."byteLength" AND o.sha256 = NEW.sha256 AND o."mimeType" = NEW."mimeType") THEN PERFORM image_raise('IMAGE_UNAVAILABLE'); END IF;
  END IF;
  IF NEW.state = 'DELETED' AND EXISTS (SELECT 1 FROM "ImageObject" WHERE "assetId" = NEW.id AND (accounted OR "needsReconciliation")) THEN PERFORM image_raise('IMAGE_WRITE_CONFLICT'); END IF;
  NEW."updatedAt" := clock_timestamp(); RETURN NEW;
END;
$$;
CREATE TRIGGER "ImageAsset_guard" BEFORE INSERT OR UPDATE OR DELETE ON "ImageAsset" FOR EACH ROW EXECUTE FUNCTION image_guard_asset();

CREATE FUNCTION image_guard_object() RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE v_asset "ImageAsset"; v_res "ImageWriteReservation"; v_provider TEXT;
BEGIN
  IF TG_OP = 'DELETE' THEN PERFORM image_raise('IMAGE_WRITE_CONFLICT'); END IF;
  SELECT * INTO v_asset FROM "ImageAsset" WHERE id = NEW."assetId";
  IF v_asset.id IS NULL OR NEW."byteLength" <> v_asset."byteLength" OR NEW.sha256 <> v_asset.sha256 OR NEW."mimeType" <> v_asset."mimeType" THEN PERFORM image_raise('IMAGE_WRITE_CONFLICT'); END IF;
  SELECT provider INTO v_provider FROM "ImageStorageLocation" WHERE id = NEW."locationId";
  IF v_provider = 'LOCAL' AND NEW."versionId" IS NOT NULL THEN PERFORM image_raise('IMAGE_LOCATION_CONFLICT'); END IF;
  IF TG_OP = 'INSERT' THEN
    SELECT * INTO v_res FROM "ImageWriteReservation" WHERE id = NEW."reservationId";
    IF v_res.id IS NULL OR v_res.state <> 'ACTIVE' OR v_res.token <> NEW."writeToken" OR v_res."leaseExpiresAt" <= clock_timestamp()
      OR NEW.slot >= cardinality(v_res."slotBytes") OR NEW."byteLength" > v_res."slotBytes"[NEW.slot + 1] OR v_res."ownerId" <> v_asset."ownerId"
      OR NEW.state <> 'WRITING' OR NEW."putOutcome" <> 'NOT_STARTED' OR NOT NEW.accounted OR NEW."writeExpiresAt" IS DISTINCT FROM v_res."leaseExpiresAt" THEN PERFORM image_raise('IMAGE_RESERVATION_CONFLICT'); END IF;
  ELSE
    IF NEW.id <> OLD.id OR NEW."assetId" <> OLD."assetId" OR NEW."reservationId" <> OLD."reservationId" OR NEW.slot <> OLD.slot OR NEW."locationId" <> OLD."locationId"
      OR NEW."physicalNamespace" <> OLD."physicalNamespace" OR NEW.key <> OLD.key OR NEW."byteLength" <> OLD."byteLength" OR NEW.sha256 <> OLD.sha256 OR NEW."mimeType" <> OLD."mimeType"
      OR NEW."writeToken" <> OLD."writeToken" OR NEW."writeExpiresAt" <> OLD."writeExpiresAt" OR NEW."createdAt" <> OLD."createdAt"
      OR (OLD."versionId" IS NOT NULL AND NEW."versionId" IS DISTINCT FROM OLD."versionId") OR (NOT OLD.accounted AND NEW.accounted) THEN PERFORM image_raise('IMAGE_WRITE_CONFLICT'); END IF;
    IF OLD."putOutcome" = 'UNKNOWN' AND (NEW."putOutcome" <> 'UNKNOWN' OR NOT NEW.accounted OR NOT NEW."needsReconciliation") THEN PERFORM image_raise('IMAGE_WRITE_CONFLICT'); END IF;
    IF OLD."putOutcome" = 'CONFIRMED' AND NEW."putOutcome" <> 'CONFIRMED' THEN PERFORM image_raise('IMAGE_WRITE_CONFLICT'); END IF;
    IF NEW.state <> OLD.state AND NOT ((OLD.state = 'WRITING' AND NEW.state IN ('READY','UNKNOWN','DELETED')) OR (OLD.state IN ('READY','UNKNOWN') AND NEW.state = 'DELETING') OR (OLD.state = 'DELETING' AND NEW.state = 'DELETED')) THEN PERFORM image_raise('IMAGE_WRITE_CONFLICT'); END IF;
    IF NEW.state <> 'READY' AND OLD.state = 'READY' AND v_asset."activeObjectId" = OLD.id AND v_asset.state = 'AVAILABLE' THEN PERFORM image_raise('IMAGE_REFERENCE_CONFLICT'); END IF;
    IF NEW.state = 'READY' AND OLD.state <> 'READY' AND (OLD."writeExpiresAt" <= clock_timestamp() OR OLD."putOutcome" = 'UNKNOWN') THEN PERFORM image_raise('IMAGE_RESERVATION_EXPIRED'); END IF;
    IF OLD.accounted AND NOT NEW.accounted AND NEW."putOutcome" = 'NOT_STARTED' AND (OLD.state <> 'WRITING' OR OLD."writeExpiresAt" <= clock_timestamp()) THEN PERFORM image_raise('IMAGE_WRITE_CONFLICT'); END IF;
  END IF;
  NEW."updatedAt" := clock_timestamp(); RETURN NEW;
END;
$$;
CREATE TRIGGER "ImageObject_guard" BEFORE INSERT OR UPDATE OR DELETE ON "ImageObject" FOR EACH ROW EXECUTE FUNCTION image_guard_object();

-- Deferred balance proof allows a single transaction to move a slot from
-- reserved budget to an exact-byte object without permitting an unmatched refund.
CREATE FUNCTION image_assert_reservation_balance() RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE v_id UUID; v_res "ImageWriteReservation"; v_expected BIGINT;
BEGIN
  IF TG_TABLE_NAME = 'ImageObject' THEN v_id := NEW."reservationId"; ELSE v_id := NEW.id; END IF;
  SELECT * INTO v_res FROM "ImageWriteReservation" WHERE id = v_id;
  SELECT COALESCE(sum(amount),0) INTO v_expected FROM unnest(v_res."slotBytes") WITH ORDINALITY AS slots(amount,n)
    WHERE NOT EXISTS (SELECT 1 FROM "ImageObject" WHERE "reservationId" = v_id AND slot = slots.n - 1);
  IF v_res.state = 'CLOSED' THEN v_expected := 0; END IF;
  IF v_res.id IS NULL OR v_res."remainingBytes" <> v_expected THEN PERFORM image_raise('IMAGE_RESERVATION_CONFLICT'); END IF;
  RETURN NULL;
END;
$$;
CREATE CONSTRAINT TRIGGER "ImageWriteReservation_balance" AFTER INSERT OR UPDATE ON "ImageWriteReservation" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION image_assert_reservation_balance();
CREATE CONSTRAINT TRIGGER "ImageObject_reservation_balance" AFTER INSERT OR UPDATE ON "ImageObject" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION image_assert_reservation_balance();

CREATE FUNCTION image_guard_location() RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' OR (to_jsonb(NEW) - 'publicBaseUrl') IS DISTINCT FROM (to_jsonb(OLD) - 'publicBaseUrl') THEN PERFORM image_raise('IMAGE_LOCATION_CONFLICT'); END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER "ImageStorageLocation_guard" BEFORE UPDATE OR DELETE ON "ImageStorageLocation" FOR EACH ROW EXECUTE FUNCTION image_guard_location();
CREATE FUNCTION image_guard_alias() RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' OR to_jsonb(NEW) IS DISTINCT FROM to_jsonb(OLD) THEN PERFORM image_raise('IMAGE_REFERENCE_CONFLICT'); END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER "ImageUrlAlias_guard" BEFORE UPDATE OR DELETE ON "ImageUrlAlias" FOR EACH ROW EXECUTE FUNCTION image_guard_alias();
CREATE FUNCTION image_guard_reference() RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE v_asset "ImageAsset";
BEGIN
  IF TG_OP <> 'INSERT' THEN
    IF TG_OP = 'UPDATE' OR OLD.permanent THEN PERFORM image_raise('IMAGE_REFERENCE_CONFLICT'); END IF;
    PERFORM 1 FROM "ImageAsset" WHERE id = OLD."assetId" FOR UPDATE;
    RETURN OLD;
  END IF;
  SELECT * INTO v_asset FROM "ImageAsset" WHERE id = NEW."assetId" FOR UPDATE;
  IF v_asset.id IS NULL OR v_asset.state <> 'AVAILABLE' THEN PERFORM image_raise('IMAGE_UNAVAILABLE'); END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER "ImageReference_guard" BEFORE INSERT OR UPDATE OR DELETE ON "ImageReference" FOR EACH ROW EXECUTE FUNCTION image_guard_reference();
CREATE FUNCTION image_refresh_detached() RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE v_id UUID;
BEGIN
  v_id := CASE WHEN TG_OP = 'DELETE' THEN OLD."assetId" ELSE NEW."assetId" END;
  UPDATE "ImageAsset" SET "detachedAt" = CASE WHEN EXISTS (SELECT 1 FROM "ImageReference" WHERE "assetId" = v_id) THEN NULL ELSE clock_timestamp() END WHERE id = v_id;
  RETURN NULL;
END;
$$;
CREATE TRIGGER "ImageReference_detached" AFTER INSERT OR DELETE ON "ImageReference" FOR EACH ROW EXECUTE FUNCTION image_refresh_detached();

CREATE FUNCTION image_asset_json(p_row "ImageAsset") RETURNS JSONB LANGUAGE SQL STABLE AS $$
  SELECT to_jsonb(p_row) || jsonb_build_object('byteLength',p_row."byteLength"::text)
$$;
CREATE FUNCTION image_object_json(p_row "ImageObject") RETURNS JSONB LANGUAGE SQL STABLE AS $$
  SELECT to_jsonb(p_row) || jsonb_build_object('byteLength',p_row."byteLength"::text)
$$;
CREATE FUNCTION image_reservation_json(p_row "ImageWriteReservation") RETURNS JSONB LANGUAGE SQL STABLE AS $$
  SELECT to_jsonb(p_row) || jsonb_build_object('remainingBytes',p_row."remainingBytes"::text,'slotBytes',to_jsonb(p_row."slotBytes"::text[]))
$$;

CREATE FUNCTION image_register_location(p JSONB) RETURNS JSONB LANGUAGE plpgsql AS $$
DECLARE v_row "ImageStorageLocation"; v_provider TEXT; v_namespace TEXT; v_volume UUID;
BEGIN
  IF jsonb_typeof(p) IS DISTINCT FROM 'object' THEN PERFORM image_raise('IMAGE_INVALID_INPUT'); END IF;
  v_provider := p->>'provider';
  IF v_provider = 'LOCAL' THEN
    v_volume := image_uuid(p->>'volumeId'); v_namespace := 'local:' || v_volume::text;
  ELSIF v_provider = 'S3' THEN
    v_namespace := 's3:' || image_required_text(p->>'endpoint',512) || '/' || image_required_text(p->>'bucket',255);
  ELSE PERFORM image_raise('IMAGE_LOCATION_CONFLICT'); END IF;
  INSERT INTO "ImageStorageLocation" (id,provider,endpoint,region,bucket,"volumeId","publicBaseUrl","physicalNamespace")
    VALUES (image_required_text(p->>'id',128),v_provider,p->>'endpoint',p->>'region',p->>'bucket',v_volume,p->>'publicBaseUrl',v_namespace)
    ON CONFLICT (id) DO UPDATE SET "publicBaseUrl" = EXCLUDED."publicBaseUrl"
    RETURNING * INTO v_row;
  IF v_row.provider IS DISTINCT FROM v_provider OR v_row.endpoint IS DISTINCT FROM p->>'endpoint' OR v_row.region IS DISTINCT FROM p->>'region'
    OR v_row.bucket IS DISTINCT FROM p->>'bucket' OR v_row."volumeId" IS DISTINCT FROM v_volume THEN PERFORM image_raise('IMAGE_LOCATION_CONFLICT'); END IF;
  RETURN to_jsonb(v_row);
EXCEPTION WHEN check_violation THEN
  IF SQLERRM LIKE 'IMAGE_%' THEN RAISE; END IF;
  PERFORM image_raise('IMAGE_LOCATION_CONFLICT');
END;
$$;

CREATE FUNCTION image_reserve_write(p JSONB) RETURNS JSONB LANGUAGE plpgsql AS $$
DECLARE v_owner TEXT; v_intent TEXT; v_kind TEXT; v_slots BIGINT[]; v_total BIGINT; v_lease INTEGER; v_res "ImageWriteReservation";
BEGIN
  IF jsonb_typeof(p) IS DISTINCT FROM 'object' OR jsonb_typeof(p->'slotBytes') IS DISTINCT FROM 'array' THEN PERFORM image_raise('IMAGE_INVALID_INPUT'); END IF;
  v_owner := image_required_text(p->>'ownerId',128); v_intent := image_required_text(p->>'intentKey',256); v_kind := p->>'kind';
  IF v_kind IS NULL OR v_kind NOT IN ('OUTPUT','INPUT','COPY') OR jsonb_array_length(p->'slotBytes') NOT BETWEEN 1 AND 4 THEN PERFORM image_raise('IMAGE_INVALID_INPUT'); END IF;
  SELECT array_agg(image_bytes(value #>> '{}') ORDER BY n), sum(image_bytes(value #>> '{}')) INTO v_slots,v_total FROM jsonb_array_elements(p->'slotBytes') WITH ORDINALITY AS slots(value,n);
  IF (v_kind = 'OUTPUT' AND NOT (52428800 = ALL(v_slots))) OR (v_kind <> 'OUTPUT' AND cardinality(v_slots) <> 1) THEN PERFORM image_raise('IMAGE_INVALID_INPUT'); END IF;
  v_lease := image_lease_seconds(p->>'leaseSeconds');
  PERFORM image_lock_quota();
  SELECT * INTO v_res FROM "ImageWriteReservation" WHERE "ownerId" = v_owner AND "intentKey" = v_intent FOR UPDATE;
  IF FOUND THEN
    IF v_res.kind <> v_kind OR v_res."slotBytes" IS DISTINCT FROM v_slots THEN PERFORM image_raise('IMAGE_RESERVATION_CONFLICT'); END IF;
    IF v_res.state = 'ACTIVE' AND v_res."leaseExpiresAt" <= clock_timestamp() THEN PERFORM image_raise('IMAGE_RESERVATION_EXPIRED'); END IF;
    RETURN image_reservation_json(v_res);
  END IF;
  -- enabled is deliberately absent: it only gates destructive maintenance.
  INSERT INTO "ImageWriteReservation" ("ownerId","intentKey",kind,"slotBytes","remainingBytes","leaseExpiresAt")
    VALUES (v_owner,v_intent,v_kind,v_slots,v_total,clock_timestamp() + make_interval(secs => v_lease)) RETURNING * INTO v_res;
  RETURN image_reservation_json(v_res);
END;
$$;

CREATE FUNCTION image_bind_reservation(p JSONB) RETURNS JSONB LANGUAGE plpgsql AS $$
DECLARE v_res "ImageWriteReservation"; v_job "GenerationJob"; v_id UUID; v_token UUID; v_owner TEXT; v_job_id TEXT;
BEGIN
  v_id := image_uuid(p->>'reservationId'); v_token := image_uuid(p->>'token'); v_owner := image_required_text(p->>'ownerId',128); v_job_id := image_required_text(p->>'jobId',128);
  SELECT * INTO v_res FROM "ImageWriteReservation" WHERE id = v_id FOR UPDATE;
  SELECT * INTO v_job FROM "GenerationJob" WHERE id = v_job_id;
  IF v_res.id IS NULL OR v_res."ownerId" <> v_owner OR v_res.kind <> 'OUTPUT' OR v_res.token <> v_token OR v_res.state <> 'ACTIVE'
    OR v_job.id IS NULL OR v_job."userId" <> v_owner OR v_job."generationType"::text NOT IN ('TEXT_TO_IMAGE','IMAGE_TO_IMAGE') OR v_job.count <> cardinality(v_res."slotBytes")
    OR (v_res."outputJobId" IS NOT NULL AND v_res."outputJobId" <> v_job_id) THEN PERFORM image_raise('IMAGE_RESERVATION_CONFLICT'); END IF;
  IF v_res."leaseExpiresAt" <= clock_timestamp() THEN PERFORM image_raise('IMAGE_RESERVATION_EXPIRED'); END IF;
  UPDATE "ImageWriteReservation" SET "outputJobId" = v_job_id WHERE id = v_id RETURNING * INTO v_res;
  RETURN image_reservation_json(v_res);
END;
$$;

CREATE FUNCTION image_acquire_for_job(p JSONB) RETURNS JSONB LANGUAGE plpgsql AS $$
DECLARE v_job "GenerationJob"; v_res "ImageWriteReservation"; v_job_id TEXT; v_worker TEXT; v_lease INTEGER; v_json JSONB;
BEGIN
  v_job_id := image_required_text(p->>'jobId',128); v_worker := image_required_text(p->>'workerId',128); v_lease := image_lease_seconds(p->>'leaseSeconds');
  PERFORM image_lock_quota();
  SELECT * INTO v_job FROM "GenerationJob" WHERE id = v_job_id;
  IF v_job.id IS NULL OR v_job.status::text <> 'PROCESSING' OR v_job."workerId" IS DISTINCT FROM v_worker OR v_job."generationType"::text NOT IN ('TEXT_TO_IMAGE','IMAGE_TO_IMAGE') OR v_job.count NOT BETWEEN 1 AND 4 THEN PERFORM image_raise('IMAGE_RESERVATION_CONFLICT'); END IF;
  SELECT * INTO v_res FROM "ImageWriteReservation" WHERE "outputJobId" = v_job_id FOR UPDATE;
  IF NOT FOUND THEN
    v_json := image_reserve_write(jsonb_build_object('ownerId',v_job."userId",'intentKey','job:' || v_job_id,'kind','OUTPUT','slotBytes',to_jsonb(array_fill('52428800'::text,ARRAY[v_job.count])),'leaseSeconds',v_lease));
    SELECT * INTO v_res FROM "ImageWriteReservation" WHERE id = (v_json->>'id')::uuid FOR UPDATE;
  END IF;
  IF v_res.state <> 'ACTIVE' OR v_res."ownerId" <> v_job."userId" OR v_res.kind <> 'OUTPUT' OR cardinality(v_res."slotBytes") <> v_job.count THEN PERFORM image_raise('IMAGE_RESERVATION_CONFLICT'); END IF;
  UPDATE "ImageWriteReservation" SET "outputJobId" = v_job_id,
    token = CASE WHEN "workerId" IS DISTINCT FROM v_worker OR "leaseExpiresAt" <= clock_timestamp() THEN gen_random_uuid() ELSE token END,
    "workerId" = v_worker, "leaseExpiresAt" = clock_timestamp() + make_interval(secs => v_lease)
    WHERE id = v_res.id RETURNING * INTO v_res;
  RETURN image_reservation_json(v_res);
END;
$$;

CREATE FUNCTION image_close_reservation(p JSONB) RETURNS JSONB LANGUAGE plpgsql AS $$
DECLARE v_res "ImageWriteReservation"; v_id UUID; v_token UUID;
BEGIN
  v_id := image_uuid(p->>'reservationId'); v_token := image_uuid(p->>'token');
  PERFORM image_lock_quota();
  SELECT * INTO v_res FROM "ImageWriteReservation" WHERE id = v_id FOR UPDATE;
  IF v_res.id IS NULL OR v_res.token <> v_token THEN PERFORM image_raise('IMAGE_RESERVATION_CONFLICT'); END IF;
  IF v_res.state = 'CLOSED' THEN RETURN 'true'::jsonb; END IF;
  IF v_res."outputJobId" IS NOT NULL AND EXISTS (SELECT 1 FROM "GenerationJob" WHERE id = v_res."outputJobId" AND status::text IN ('PENDING','PROCESSING')) THEN PERFORM image_raise('IMAGE_RESERVATION_CONFLICT'); END IF;
  UPDATE "ImageWriteReservation" SET state = 'CLOSED', "remainingBytes" = 0 WHERE id = v_id;
  RETURN 'true'::jsonb;
END;
$$;

CREATE FUNCTION image_begin_object(p JSONB) RETURNS JSONB LANGUAGE plpgsql AS $$
DECLARE v_res "ImageWriteReservation"; v_asset "ImageAsset"; v_object "ImageObject"; v_location "ImageStorageLocation";
  v_id UUID; v_token UUID; v_asset_id UUID; v_slot INTEGER; v_size BIGINT; v_purpose TEXT; v_key TEXT; v_sha TEXT; v_mime TEXT;
BEGIN
  v_id := image_uuid(p->>'reservationId'); v_token := image_uuid(p->>'token');
  IF p->>'slot' IS NULL OR p->>'slot' !~ '^[0-3]$' THEN PERFORM image_raise('IMAGE_INVALID_INPUT'); END IF;
  v_slot := (p->>'slot')::integer; v_size := image_bytes(p->>'byteLength'); v_purpose := p->>'purpose';
  v_key := image_required_text(p->>'key',512); v_sha := p->>'sha256'; v_mime := p->>'mimeType';
  IF v_purpose IS NULL OR v_purpose NOT IN ('GENERATED','REFERENCE','CANVAS_IMPORT') OR v_sha IS NULL OR length(v_sha) <> 64 OR v_sha !~ '^[0-9a-f]{64}$'
    OR v_mime IS NULL OR v_mime NOT IN ('image/png','image/jpeg','image/webp','image/gif','image/avif') THEN PERFORM image_raise('IMAGE_INVALID_INPUT'); END IF;
  IF p->>'assetId' IS NOT NULL THEN v_asset_id := image_uuid(p->>'assetId'); END IF;
  PERFORM image_lock_quota();
  SELECT * INTO v_res FROM "ImageWriteReservation" WHERE id = v_id FOR UPDATE;
  IF v_res.id IS NULL OR v_res.token <> v_token OR v_slot >= cardinality(v_res."slotBytes") OR v_size > v_res."slotBytes"[v_slot+1] THEN PERFORM image_raise('IMAGE_RESERVATION_CONFLICT'); END IF;
  SELECT * INTO v_object FROM "ImageObject" WHERE "reservationId" = v_id AND slot = v_slot;
  IF FOUND THEN
    SELECT * INTO v_asset FROM "ImageAsset" WHERE id = v_object."assetId";
    IF v_object.key <> v_key OR v_object."locationId" IS DISTINCT FROM p->>'locationId' OR v_object."byteLength" <> v_size OR v_object.sha256 <> v_sha
      OR v_object."mimeType" <> v_mime OR v_asset.purpose <> v_purpose OR (v_asset_id IS NOT NULL AND v_asset.id <> v_asset_id) THEN PERFORM image_raise('IMAGE_WRITE_CONFLICT'); END IF;
    RETURN jsonb_build_object('asset',image_asset_json(v_asset),'object',image_object_json(v_object),'writeGranted',false);
  END IF;
  IF v_res.state <> 'ACTIVE' THEN PERFORM image_raise('IMAGE_RESERVATION_CONFLICT'); END IF;
  IF v_res."leaseExpiresAt" <= clock_timestamp() THEN PERFORM image_raise('IMAGE_RESERVATION_EXPIRED'); END IF;
  IF v_res.kind = 'OUTPUT' AND (v_purpose <> 'GENERATED' OR v_res."outputJobId" IS NULL OR v_res."workerId" IS NULL OR NOT EXISTS (
    SELECT 1 FROM "GenerationJob" WHERE id = v_res."outputJobId" AND "workerId" = v_res."workerId" AND status::text = 'PROCESSING')) THEN PERFORM image_raise('IMAGE_RESERVATION_CONFLICT'); END IF;
  -- Existing legacy backfill creates a new physical copy, with the same quota
  -- gate as any input. It must prove the original unassociated image identity;
  -- this is not adoption of an already-existing physical object.
  IF v_res.kind = 'INPUT' AND v_purpose = 'GENERATED' AND (
    p->>'originId' IS NULL OR v_res."intentKey" IS DISTINCT FROM 'backfill-image:' || (p->>'originId') OR NOT EXISTS (
      SELECT 1 FROM "GenerationImage" i JOIN "GenerationJob" j ON j.id = i."jobId"
      WHERE i.id = p->>'originId' AND i."mediaAssetId" IS NULL AND i."mediaStorage" IS NULL
        AND j."userId" = v_res."ownerId" AND j."generationType"::text IN ('TEXT_TO_IMAGE','IMAGE_TO_IMAGE')
    )
  ) THEN PERFORM image_raise('IMAGE_INVALID_INPUT'); END IF;
  SELECT * INTO v_location FROM "ImageStorageLocation" WHERE id = p->>'locationId';
  IF NOT FOUND THEN PERFORM image_raise('IMAGE_LOCATION_CONFLICT'); END IF;
  IF v_asset_id IS NOT NULL THEN SELECT * INTO v_asset FROM "ImageAsset" WHERE id = v_asset_id FOR UPDATE; END IF;
  IF v_asset.id IS NULL THEN
    IF v_res.kind = 'COPY' THEN PERFORM image_raise('IMAGE_UNAVAILABLE'); END IF;
    INSERT INTO "ImageAsset" (id,"ownerId",purpose,"originId","byteLength","mimeType",sha256)
      VALUES (COALESCE(v_asset_id,gen_random_uuid()),v_res."ownerId",v_purpose,p->>'originId',v_size,v_mime,v_sha) RETURNING * INTO v_asset;
  ELSE
    IF v_res.kind <> 'COPY' OR v_asset.state <> 'AVAILABLE' OR v_asset."ownerId" <> v_res."ownerId" OR v_asset.purpose <> v_purpose OR v_asset."byteLength" <> v_size
      OR v_asset.sha256 <> v_sha OR v_asset."mimeType" <> v_mime THEN PERFORM image_raise('IMAGE_WRITE_CONFLICT'); END IF;
  END IF;
  UPDATE "ImageWriteReservation" SET "remainingBytes" = "remainingBytes" - "slotBytes"[v_slot+1] WHERE id = v_id;
  INSERT INTO "ImageObject" ("assetId","reservationId",slot,"locationId","physicalNamespace",key,"byteLength","mimeType",sha256,"writeToken","writeExpiresAt")
    VALUES (v_asset.id,v_id,v_slot,v_location.id,v_location."physicalNamespace",v_key,v_size,v_mime,v_sha,v_token,v_res."leaseExpiresAt") RETURNING * INTO v_object;
  RETURN jsonb_build_object('asset',image_asset_json(v_asset),'object',image_object_json(v_object),'writeGranted',true);
EXCEPTION WHEN unique_violation THEN PERFORM image_raise('IMAGE_WRITE_CONFLICT');
END;
$$;

CREATE FUNCTION image_finish_object(p JSONB) RETURNS JSONB LANGUAGE plpgsql AS $$
DECLARE v_object "ImageObject"; v_asset "ImageAsset"; v_res "ImageWriteReservation"; v_id UUID; v_token UUID; v_outcome TEXT; v_accepted BOOLEAN := false; v_valid BOOLEAN; v_version TEXT;
BEGIN
  v_id := image_uuid(p->>'objectId'); v_token := image_uuid(p->>'writeToken'); v_outcome := p->>'outcome'; v_version := NULLIF(p->>'versionId','');
  IF v_outcome IS NULL OR v_outcome NOT IN ('CONFIRMED','UNKNOWN','NOT_WRITTEN') OR length(v_version) > 1024 THEN PERFORM image_raise('IMAGE_INVALID_INPUT'); END IF;
  PERFORM image_lock_quota();
  SELECT * INTO v_object FROM "ImageObject" WHERE id = v_id;
  IF NOT FOUND OR v_object."writeToken" <> v_token THEN PERFORM image_raise('IMAGE_WRITE_CONFLICT'); END IF;
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
  ELSIF v_outcome = 'CONFIRMED' AND v_valid AND v_object."putOutcome" <> 'UNKNOWN' THEN
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

CREATE FUNCTION image_activate_object(p JSONB) RETURNS JSONB LANGUAGE plpgsql AS $$
DECLARE v_asset "ImageAsset"; v_object "ImageObject"; v_asset_id UUID; v_object_id UUID; v_expected UUID;
BEGIN
  v_asset_id := image_uuid(p->>'assetId'); v_object_id := image_uuid(p->>'objectId');
  IF p->>'expectedObjectId' IS NOT NULL THEN v_expected := image_uuid(p->>'expectedObjectId'); END IF;
  SELECT * INTO v_asset FROM "ImageAsset" WHERE id = v_asset_id FOR UPDATE;
  IF v_asset.id IS NULL OR v_asset.state <> 'AVAILABLE' THEN PERFORM image_raise('IMAGE_UNAVAILABLE'); END IF;
  IF v_asset."activeObjectId" = v_object_id THEN RETURN 'true'::jsonb; END IF;
  IF v_asset."activeObjectId" IS DISTINCT FROM v_expected THEN RETURN 'false'::jsonb; END IF;
  SELECT * INTO v_object FROM "ImageObject" WHERE id = v_object_id AND "assetId" = v_asset_id FOR UPDATE;
  IF v_object.id IS NULL OR v_object.state <> 'READY' OR v_object."putOutcome" <> 'CONFIRMED' OR v_object."needsReconciliation" THEN PERFORM image_raise('IMAGE_UNAVAILABLE'); END IF;
  UPDATE "ImageAsset" SET "activeObjectId" = v_object_id WHERE id = v_asset_id;
  RETURN 'true'::jsonb;
END;
$$;

CREATE FUNCTION image_register_alias(p JSONB) RETURNS JSONB LANGUAGE plpgsql AS $$
DECLARE v_id UUID; v_url TEXT; v_existing UUID;
BEGIN
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

CREATE FUNCTION image_replace_references(p JSONB) RETURNS JSONB LANGUAGE plpgsql AS $$
DECLARE v_owner TEXT; v_kind TEXT; v_key TEXT; v_ids UUID[]; v_lock UUID[]; v_asset "ImageAsset";
BEGIN
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

CREATE FUNCTION image_get_asset(p_asset_id UUID,p_owner_id TEXT DEFAULT NULL) RETURNS JSONB LANGUAGE SQL STABLE AS $$
  SELECT jsonb_build_object('asset',image_asset_json(a),'object',CASE WHEN o.id IS NULL THEN NULL ELSE image_object_json(o) END,'location',CASE WHEN l.id IS NULL THEN NULL ELSE to_jsonb(l) END)
  FROM "ImageAsset" a LEFT JOIN "ImageObject" o ON o.id = a."activeObjectId" AND o."assetId" = a.id AND o.state = 'READY' AND a.state = 'AVAILABLE'
  LEFT JOIN "ImageStorageLocation" l ON l.id = o."locationId"
  WHERE a.id = p_asset_id AND (p_owner_id IS NULL OR a."ownerId" = p_owner_id)
$$;
CREATE FUNCTION image_get_by_token(p_token TEXT) RETURNS JSONB LANGUAGE SQL STABLE AS $$
  SELECT image_get_asset(id,NULL) FROM "ImageAsset" WHERE "publicToken" = p_token
$$;
CREATE FUNCTION image_resolve_url(p_url TEXT,p_owner_id TEXT DEFAULT NULL) RETURNS JSONB LANGUAGE SQL STABLE AS $$
  SELECT image_get_asset("assetId",p_owner_id) FROM "ImageUrlAlias" WHERE url = p_url
$$;
CREATE FUNCTION image_get_reservation_by_job(p_job_id TEXT) RETURNS JSONB LANGUAGE SQL STABLE AS $$
  SELECT image_reservation_json(r) FROM "ImageWriteReservation" r WHERE "outputJobId" = p_job_id
$$;
CREATE FUNCTION image_get_usage() RETURNS JSONB LANGUAGE SQL STABLE AS $$
  SELECT jsonb_build_object('policy',to_jsonb(p) || jsonb_build_object('limitBytes',p."limitBytes"::text),'usedBytes',q."usedBytes"::text,'reservedBytes',q."reservedBytes"::text,
    'assetCount',(SELECT count(*)::text FROM "ImageAsset" WHERE state <> 'DELETED'), 'objectCount',(SELECT count(*)::text FROM "ImageObject" WHERE accounted))
  FROM "ImageQuota" q JOIN "ImageStoragePolicy" p USING(scope) WHERE q.scope = 'images'
$$;

-- Existing business entrypoints all receive the same transactional roots.
-- Unknown URLs and legacy rows without an image binding remain untouched.
CREATE FUNCTION image_bridge_job_inputs() RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE v_ids JSONB;
BEGIN
  SELECT COALESCE(jsonb_agg(DISTINCT a."assetId"), '[]'::jsonb) INTO v_ids FROM "ImageUrlAlias" a WHERE a.url = ANY(NEW."sourceImageUrls");
  IF jsonb_array_length(v_ids) > 0 THEN
    PERFORM image_replace_references(jsonb_build_object('ownerId',NEW."userId",'kind','JOB_INPUT','referenceKey','job:' || NEW.id,'assetIds',v_ids));
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER "GenerationJob_image_inputs" AFTER INSERT OR UPDATE OF "sourceImageUrls" ON "GenerationJob" FOR EACH ROW EXECUTE FUNCTION image_bridge_job_inputs();

CREATE FUNCTION image_guard_generation_binding() RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE v_asset "ImageAsset"; v_owner TEXT;
BEGIN
  IF TG_OP = 'UPDATE' AND OLD."mediaAssetId" IS NOT NULL AND NEW."mediaAssetId" IS DISTINCT FROM OLD."mediaAssetId" THEN PERFORM image_raise('IMAGE_WRITE_CONFLICT'); END IF;
  IF NEW."mediaAssetId" IS NULL THEN RETURN NEW; END IF;
  SELECT * INTO v_asset FROM "ImageAsset" WHERE id = NEW."mediaAssetId" FOR UPDATE;
  SELECT "userId" INTO v_owner FROM "GenerationJob" WHERE id = NEW."jobId";
  IF v_asset.id IS NULL OR v_owner IS NULL OR v_asset."ownerId" <> v_owner OR v_asset.purpose <> 'GENERATED' OR (v_asset."originId" IS NOT NULL AND v_asset."originId" <> NEW.id) THEN PERFORM image_raise('IMAGE_WRITE_CONFLICT'); END IF;
  IF (TG_OP = 'INSERT' OR OLD."mediaAssetId" IS NULL) AND v_asset.state <> 'AVAILABLE' THEN PERFORM image_raise('IMAGE_UNAVAILABLE'); END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER "GenerationImage_asset_binding" BEFORE INSERT OR UPDATE OF "mediaAssetId","jobId" ON "GenerationImage" FOR EACH ROW EXECUTE FUNCTION image_guard_generation_binding();

CREATE FUNCTION image_bridge_showcase() RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE v_asset_id UUID; v_owner TEXT; v_ids JSONB; v_key TEXT;
BEGIN
  IF TG_OP = 'DELETE' THEN
    v_asset_id := OLD."mediaAssetId"; v_key := 'image:' || OLD.id; v_ids := '[]'::jsonb;
  ELSE
    v_asset_id := NEW."mediaAssetId"; v_key := 'image:' || NEW.id;
    v_ids := CASE WHEN NEW."showcaseStatus"::text IN ('FEATURED','PENDING','TAKEDOWN_PENDING') AND v_asset_id IS NOT NULL THEN jsonb_build_array(v_asset_id) ELSE '[]'::jsonb END;
  END IF;
  IF v_asset_id IS NULL THEN RETURN NULL; END IF;
  SELECT "ownerId" INTO v_owner FROM "ImageAsset" WHERE id = v_asset_id;
  IF v_owner IS NOT NULL THEN PERFORM image_replace_references(jsonb_build_object('ownerId',v_owner,'kind','SHOWCASE','referenceKey',v_key,'assetIds',v_ids)); END IF;
  RETURN NULL;
END;
$$;
CREATE TRIGGER "GenerationImage_image_showcase" AFTER INSERT OR UPDATE OF "mediaAssetId","showcaseStatus" OR DELETE ON "GenerationImage" FOR EACH ROW EXECUTE FUNCTION image_bridge_showcase();

CREATE FUNCTION image_bridge_site_cover() RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE v_ids JSONB := '[]'::jsonb; v_scope TEXT;
BEGIN
  IF TG_OP = 'DELETE' THEN v_scope := OLD.scope;
  ELSE
    v_scope := NEW.scope;
    IF NEW.mode = 'custom' AND NEW."customUrl" IS NOT NULL THEN SELECT COALESCE(jsonb_agg("assetId"),'[]'::jsonb) INTO v_ids FROM "ImageUrlAlias" WHERE url = NEW."customUrl"; END IF;
  END IF;
  PERFORM image_replace_references(jsonb_build_object('ownerId','site','kind','SITE_COVER','referenceKey','login-cover:' || v_scope,'assetIds',v_ids));
  RETURN NULL;
END;
$$;
CREATE TRIGGER "LoginCoverConfig_image_cover" AFTER INSERT OR UPDATE OF mode,"customUrl" OR DELETE ON "LoginCoverConfig" FOR EACH ROW EXECUTE FUNCTION image_bridge_site_cover();

CREATE FUNCTION image_storage_revision() RETURNS INTEGER LANGUAGE SQL IMMUTABLE AS $$ SELECT 1 $$;
