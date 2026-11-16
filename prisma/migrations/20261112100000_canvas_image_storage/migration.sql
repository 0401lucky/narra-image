-- Canvas scene/run wire stays v1. Storage/GC is revision 2.
-- Stop and drain old upload/GC workers before adopting historical objects;
-- no database fence can retract an object DELETE already sent by an old worker.

ALTER TABLE "CanvasImportAsset" DROP CONSTRAINT "CanvasImportAsset_verified_payload_check";
ALTER TABLE "CanvasImportAsset" ADD CONSTRAINT "CanvasImportAsset_verified_payload_check" CHECK (
  kind = 'IMPORT' AND "byteLength" BETWEEN 1 AND 8388608 AND sha256 ~ '^[a-f0-9]{64}$'
  AND "mimeType" IN ('image/png','image/jpeg','image/webp') AND length("storageLocation") > 0 AND length("storageKey") > 0
  AND (("sourceProvider" = 'S3' AND "storageEndpoint" IS NOT NULL AND length("storageEndpoint") > 0
    AND "storageRegion" IS NOT NULL AND length("storageRegion") > 0 AND "storageBucket" IS NOT NULL AND length("storageBucket") > 0)
    OR ("sourceProvider" = 'LOCAL' AND "storageEndpoint" IS NULL AND "storageRegion" IS NULL AND "storageBucket" IS NULL
      AND "storageVersionId" IS NULL AND "mediaAssetId" IS NOT NULL AND "storageLocation" ~ '^local-v1:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'))
);
CREATE UNIQUE INDEX "CanvasImportAsset_location_key" ON "CanvasImportAsset" ("storageLocation", "storageKey");

CREATE OR REPLACE FUNCTION canvas_guard_import_asset() RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE v_now TIMESTAMPTZ; has_roots BOOLEAN; late_version_receipt BOOLEAN := false;
BEGIN
  IF TG_OP = 'DELETE' THEN PERFORM canvas_raise('CANVAS_INVENTORY_IMMUTABLE'); END IF;
  IF TG_OP = 'INSERT' THEN
    PERFORM canvas_lock_owner(NEW."ownerId");
    v_now := date_trunc('milliseconds', clock_timestamp());
    IF NOT canvas_is_canonical_id(NEW.id) OR NOT canvas_is_client_id(NEW."uploadId"::TEXT) OR NEW."userId" IS DISTINCT FROM NEW."ownerId" OR NEW.state <> 'UPLOADING' OR NEW."putOutcome" <> 'NOT_STARTED' OR NOT NEW."physicalBytesAccounted" OR NEW."storageVersionId" IS NOT NULL
      THEN PERFORM canvas_raise('CANVAS_INVALID_INPUT'); END IF;
    IF (SELECT count(*) FROM "CanvasImportAsset" WHERE "ownerId" = NEW."ownerId" AND "physicalBytesAccounted") >= 1000
      OR (SELECT COALESCE(sum("byteLength"),0) FROM "CanvasImportAsset" WHERE "ownerId" = NEW."ownerId" AND "physicalBytesAccounted") + NEW."byteLength" > 1073741824
      OR (SELECT count(*) FROM "CanvasImportAsset" WHERE "ownerId" = NEW."ownerId" AND state = 'UPLOADING' AND "uploadExpiresAt" > v_now) >= 3
      THEN PERFORM canvas_raise('CANVAS_QUOTA_EXCEEDED'); END IF;
    NEW."uploadExpiresAt" := v_now + interval '120 seconds';
    NEW."readyAt" := NULL; NEW."detachedAt" := NULL; NEW."preparationExpiresAt" := NULL;
    NEW."deleteToken" := NULL; NEW."deleteExpiresAt" := NULL; NEW."deleteAttempts" := 0; NEW."nextDeleteAt" := NULL; NEW."deletedAt" := NULL;
    NEW."deleteOutcome" := 'NOT_STARTED'; NEW."needsReconciliation" := false; NEW."createdAt" := v_now;
  ELSE
    v_now := clock_timestamp();
    -- A timed-out original PUT can reveal its version after an unversioned
    -- DELETE was sent. Keep that receipt without reopening any lifecycle fence.
    late_version_receipt := OLD."storageVersionId" IS NULL AND NEW."storageVersionId" IS NOT NULL
      AND OLD.state IN ('DELETING','DELETED') AND OLD."putOutcome" = 'UNKNOWN' AND NEW."putOutcome" = 'UNKNOWN'
      AND NEW."physicalBytesAccounted" AND NEW."needsReconciliation" AND NEW."lastStorageErrorCode" = 'CANVAS_STORAGE_CAPABILITY_INVALID'
      AND (to_jsonb(NEW) - ARRAY['storageVersionId','physicalBytesAccounted','needsReconciliation','lastStorageErrorCode','updatedAt'])
        = (to_jsonb(OLD) - ARRAY['storageVersionId','physicalBytesAccounted','needsReconciliation','lastStorageErrorCode','updatedAt']);
    IF NEW.id IS DISTINCT FROM OLD.id OR NEW."ownerId" IS DISTINCT FROM OLD."ownerId" OR NEW."uploadId" IS DISTINCT FROM OLD."uploadId" OR NEW.kind IS DISTINCT FROM OLD.kind OR NEW.sha256 IS DISTINCT FROM OLD.sha256 OR NEW."byteLength" IS DISTINCT FROM OLD."byteLength" OR NEW."mimeType" IS DISTINCT FROM OLD."mimeType"
      OR NEW."storageLocation" IS DISTINCT FROM OLD."storageLocation" OR NEW."storageEndpoint" IS DISTINCT FROM OLD."storageEndpoint" OR NEW."storageRegion" IS DISTINCT FROM OLD."storageRegion" OR NEW."storageBucket" IS DISTINCT FROM OLD."storageBucket" OR NEW."storageKey" IS DISTINCT FROM OLD."storageKey"
      OR NEW."sourceProvider" IS DISTINCT FROM OLD."sourceProvider"
      OR (OLD."mediaAssetId" IS NOT NULL AND NEW."mediaAssetId" IS DISTINCT FROM OLD."mediaAssetId")
      OR NEW."uploadToken" IS DISTINCT FROM OLD."uploadToken" OR NEW."uploadExpiresAt" IS DISTINCT FROM OLD."uploadExpiresAt" OR NEW."createdAt" IS DISTINCT FROM OLD."createdAt"
      OR (NEW."userId" IS DISTINCT FROM OLD."userId" AND NOT (OLD."userId" IS NOT NULL AND NEW."userId" IS NULL))
      OR (NEW."storageVersionId" IS DISTINCT FROM OLD."storageVersionId" AND (OLD."storageVersionId" IS NOT NULL OR (OLD.state NOT IN ('UPLOADING','QUARANTINED') AND NOT COALESCE(late_version_receipt, false))))
      THEN PERFORM canvas_raise('CANVAS_INVENTORY_IMMUTABLE'); END IF;
    SELECT EXISTS (SELECT 1 FROM "CanvasSavedAssetUse" WHERE "assetId" = OLD.id) OR EXISTS (SELECT 1 FROM "CanvasJobAssetUse" WHERE "assetId" = OLD.id) INTO has_roots;
    IF OLD."putOutcome" = 'CONFIRMED' AND NEW."putOutcome" <> 'CONFIRMED' THEN PERFORM canvas_raise('CANVAS_INVENTORY_IMMUTABLE'); END IF;
    IF OLD.state <> 'UPLOADING' AND NEW."readyAt" IS DISTINCT FROM OLD."readyAt" THEN PERFORM canvas_raise('CANVAS_INVENTORY_IMMUTABLE'); END IF;
    IF NEW.state IS DISTINCT FROM OLD.state AND NOT ((OLD.state = 'UPLOADING' AND NEW.state IN ('READY','QUARANTINED')) OR (OLD.state IN ('READY','QUARANTINED') AND NEW.state = 'DELETING') OR (OLD.state = 'DELETING' AND NEW.state = 'DELETED'))
      THEN PERFORM canvas_raise('CANVAS_INVENTORY_IMMUTABLE'); END IF;
    IF OLD.state = 'UPLOADING' AND NEW.state = 'READY' THEN
      IF OLD."uploadExpiresAt" <= v_now OR NEW."putOutcome" <> 'CONFIRMED' OR NEW."storageVersionId" IS NOT NULL OR NEW."userId" IS NULL THEN PERFORM canvas_raise('CANVAS_LEASE_LOST'); END IF;
      NEW."readyAt" := v_now; NEW."detachedAt" := CASE WHEN has_roots THEN NULL ELSE v_now END;
    ELSIF OLD.state = 'UPLOADING' AND NEW.state = 'QUARANTINED' THEN
      NEW."detachedAt" := v_now;
    ELSIF OLD.state IN ('READY','QUARANTINED') AND NEW.state = 'DELETING' THEN
      IF has_roots OR OLD."detachedAt" IS NULL OR OLD."detachedAt" + interval '604800 seconds' > v_now OR OLD."uploadExpiresAt" > v_now OR OLD."preparationExpiresAt" > v_now OR NEW."storageVersionId" IS NOT NULL
        THEN PERFORM canvas_raise('CANVAS_INPUT_UNAVAILABLE'); END IF;
      NEW."deleteToken" := gen_random_uuid(); NEW."deleteExpiresAt" := v_now + interval '90 seconds'; NEW."deleteAttempts" := OLD."deleteAttempts" + 1;
    ELSIF NEW."deleteToken" IS DISTINCT FROM OLD."deleteToken" THEN
      IF OLD.state NOT IN ('DELETING','DELETED') OR (OLD.state = 'DELETED' AND NOT OLD."needsReconciliation") OR has_roots OR OLD."deleteExpiresAt" > v_now OR OLD."nextDeleteAt" > v_now THEN PERFORM canvas_raise('CANVAS_LEASE_LOST'); END IF;
      NEW."deleteExpiresAt" := v_now + interval '90 seconds'; NEW."deleteAttempts" := OLD."deleteAttempts" + 1;
    END IF;
    IF NEW.state = 'DELETED' AND OLD.state = 'DELETING' THEN
      IF NEW."storageVersionId" IS NOT NULL THEN PERFORM canvas_raise('CANVAS_STORAGE_CAPABILITY_INVALID'); END IF;
      IF OLD."deleteExpiresAt" <= v_now OR NEW."deleteToken" IS DISTINCT FROM OLD."deleteToken" OR NEW."deleteOutcome" NOT IN ('DELETED','MISSING') OR has_roots THEN PERFORM canvas_raise('CANVAS_LEASE_LOST'); END IF;
      NEW."deletedAt" := v_now;
    END IF;
    IF NEW."preparationExpiresAt" IS DISTINCT FROM OLD."preparationExpiresAt" THEN
      IF NEW.state <> 'READY' OR NEW."preparationExpiresAt" IS NULL OR NEW."preparationExpiresAt" < OLD."preparationExpiresAt" OR NEW."preparationExpiresAt" > v_now + interval '120 seconds' THEN PERFORM canvas_raise('CANVAS_LEASE_LOST'); END IF;
    END IF;
    IF NEW."detachedAt" IS DISTINCT FROM OLD."detachedAt" AND NOT (OLD.state = 'UPLOADING' AND NEW.state IN ('READY','QUARANTINED')) THEN
      NEW."detachedAt" := CASE WHEN has_roots THEN NULL ELSE v_now END;
    END IF;
    IF OLD."putOutcome" = 'UNKNOWN' THEN NEW."putOutcome" := 'UNKNOWN'; END IF;
    IF NOT NEW."physicalBytesAccounted" AND (NEW.state <> 'DELETED' OR NEW."deleteOutcome" NOT IN ('DELETED','MISSING') OR NEW."putOutcome" = 'UNKNOWN') THEN PERFORM canvas_raise('CANVAS_INVENTORY_IMMUTABLE'); END IF;
    IF NEW."putOutcome" = 'UNKNOWN' AND NEW.state = 'DELETED' THEN NEW."physicalBytesAccounted" := true; NEW."needsReconciliation" := true; END IF;
  END IF;
  IF NEW."mediaAssetId" IS NOT NULL THEN
    -- Original Canvas identity/tuple remains immutable. The shared ledger owns
    -- physical bytes; this bit continues to count one logical import per owner.
    PERFORM 1 FROM "ImageAsset" AS m WHERE m.id = NEW."mediaAssetId" AND m."ownerId" = NEW."ownerId"
      AND m.purpose = 'CANVAS_IMPORT' AND m."originId" = NEW.id
      AND m."byteLength" = NEW."byteLength" AND m.sha256 = NEW.sha256 AND m."mimeType" = NEW."mimeType" FOR UPDATE;
    IF NOT FOUND THEN PERFORM canvas_raise('CANVAS_INVENTORY_IMMUTABLE'); END IF;
    IF NOT EXISTS (SELECT 1 FROM "ImageObject" AS o JOIN "ImageStorageLocation" AS l ON l.id = o."locationId"
      WHERE o."assetId" = NEW."mediaAssetId" AND o."locationId" = NEW."storageLocation" AND o.key = NEW."storageKey"
        AND l.provider = NEW."sourceProvider" AND l.endpoint IS NOT DISTINCT FROM NEW."storageEndpoint"
        AND l.region IS NOT DISTINCT FROM NEW."storageRegion" AND l.bucket IS NOT DISTINCT FROM NEW."storageBucket")
      THEN PERFORM canvas_raise('CANVAS_INVENTORY_IMMUTABLE'); END IF;
    IF TG_OP = 'UPDATE' AND OLD."mediaAssetId" IS NULL THEN
      IF OLD.state <> 'READY' OR OLD."putOutcome" <> 'CONFIRMED' OR OLD."storageVersionId" IS NOT NULL
        OR OLD."deleteToken" IS NOT NULL OR EXISTS (SELECT 1 FROM "CanvasGcLease" WHERE "expiresAt" > clock_timestamp())
        THEN PERFORM canvas_raise('CANVAS_LEASE_LOST'); END IF;
    END IF;
    IF NEW.state = 'READY' AND (TG_OP = 'INSERT' OR OLD.state <> 'READY' OR OLD."mediaAssetId" IS NULL) THEN
      IF NOT EXISTS (SELECT 1 FROM "ImageAsset" WHERE id = NEW."mediaAssetId" AND state = 'AVAILABLE' AND "activeObjectId" IS NOT NULL)
        THEN PERFORM canvas_raise('CANVAS_INPUT_UNAVAILABLE'); END IF;
    END IF;
    IF NEW.state = 'DELETING' AND NOT EXISTS (SELECT 1 FROM "ImageAsset" WHERE id = NEW."mediaAssetId" AND state = 'DELETING')
      THEN PERFORM canvas_raise('CANVAS_LEASE_LOST'); END IF;
    IF NOT NEW."physicalBytesAccounted" AND (NOT EXISTS (SELECT 1 FROM "ImageAsset" WHERE id = NEW."mediaAssetId" AND state = 'DELETED')
      OR EXISTS (SELECT 1 FROM "ImageObject" WHERE "assetId" = NEW."mediaAssetId" AND (accounted OR "needsReconciliation" OR state <> 'DELETED')))
      THEN PERFORM canvas_raise('CANVAS_INVENTORY_IMMUTABLE'); END IF;
  ELSIF NEW."sourceProvider" <> 'S3' THEN PERFORM canvas_raise('CANVAS_INVENTORY_IMMUTABLE'); END IF;
  NEW."updatedAt" := v_now;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION canvas_lock_assets(p_owner TEXT, p_ids TEXT[], p_require_ready BOOLEAN DEFAULT true) RETURNS VOID LANGUAGE plpgsql AS $$
DECLARE asset "CanvasImportAsset"%ROWTYPE; found_ids TEXT[] := ARRAY[]::TEXT[];
BEGIN
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

CREATE OR REPLACE FUNCTION canvas_acquire_gc_lease_v2(p_token UUID) RETURNS BOOLEAN LANGUAGE plpgsql AS $$
BEGIN
  IF p_token IS NULL THEN PERFORM canvas_raise('CANVAS_INVALID_INPUT'); END IF;
  UPDATE "CanvasGcLease" SET token = p_token, "expiresAt" = clock_timestamp() + interval '90 seconds', "updatedAt" = clock_timestamp()
    WHERE id = 'canvas-imports' AND (token IS NULL OR "expiresAt" <= clock_timestamp() OR token = p_token);
  RETURN FOUND;
END;
$$;

CREATE OR REPLACE FUNCTION canvas_claim_imports_v2(p_sweep_token UUID, p_storage_location TEXT, p_limit INTEGER DEFAULT 20) RETURNS SETOF "CanvasImportAsset" LANGUAGE plpgsql AS $$
DECLARE asset "CanvasImportAsset"%ROWTYPE; v_now TIMESTAMPTZ;
BEGIN
  IF p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 100 THEN PERFORM canvas_raise('CANVAS_LIMIT_EXCEEDED'); END IF;
  IF p_storage_location IS NULL OR length(p_storage_location) NOT BETWEEN 1 AND 128 THEN PERFORM canvas_raise('CANVAS_INVALID_INPUT'); END IF;
  PERFORM 1 FROM "CanvasGcLease" WHERE id = 'canvas-imports' AND token = p_sweep_token AND "expiresAt" > clock_timestamp() FOR UPDATE;
  IF NOT FOUND THEN PERFORM canvas_raise('CANVAS_LEASE_LOST'); END IF;
  -- Expired single-PUT reservations are quarantined, never leased to a second PUT.
  FOR asset IN SELECT * FROM "CanvasImportAsset" WHERE "mediaAssetId" IS NULL AND "sourceProvider" = 'S3' AND state = 'UPLOADING' AND "uploadExpiresAt" <= clock_timestamp() ORDER BY id LIMIT p_limit FOR UPDATE SKIP LOCKED LOOP
    UPDATE "CanvasImportAsset" SET state = 'QUARANTINED', "putOutcome" = CASE WHEN "putOutcome" = 'NOT_STARTED' THEN 'UNKNOWN'::"CanvasPutOutcome" ELSE "putOutcome" END WHERE id = asset.id;
  END LOOP;
  FOR asset IN SELECT * FROM "CanvasImportAsset" AS a WHERE a."mediaAssetId" IS NULL AND a."sourceProvider" = 'S3' AND a.kind = 'IMPORT' AND a."storageLocation" = p_storage_location AND a."storageVersionId" IS NULL
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
  SELECT * INTO asset FROM "CanvasImportAsset" WHERE id = p_asset_id FOR UPDATE;
  v_now := clock_timestamp();
  IF NOT FOUND OR asset."mediaAssetId" IS NOT NULL OR asset."sourceProvider" <> 'S3' OR asset.state NOT IN ('DELETING','DELETED') OR asset."storageVersionId" IS NOT NULL OR asset."deleteToken" IS DISTINCT FROM p_delete_token OR asset."deleteExpiresAt" <= v_now THEN RETURN false; END IF;
  IF p_outcome IN ('DELETED','MISSING') THEN
    UPDATE "CanvasImportAsset" SET state = 'DELETED', "deleteOutcome" = p_outcome, "deleteExpiresAt" = v_now, "physicalBytesAccounted" = ("putOutcome" = 'UNKNOWN'), "needsReconciliation" = ("putOutcome" = 'UNKNOWN'), "nextDeleteAt" = CASE WHEN "putOutcome" = 'UNKNOWN' THEN v_now + interval '86400 seconds' ELSE NULL END, "lastStorageErrorCode" = NULL WHERE id = p_asset_id;
  ELSIF p_outcome IN ('FAILED','UNKNOWN') THEN
    backoff := LEAST(3600, (10 * power(2, LEAST(asset."deleteAttempts" - 1, 8)))::INTEGER);
    UPDATE "CanvasImportAsset" SET "deleteOutcome" = p_outcome, "deleteExpiresAt" = v_now, "nextDeleteAt" = v_now + make_interval(secs => backoff), "lastStorageErrorCode" = p_error_code WHERE id = p_asset_id;
  ELSE PERFORM canvas_raise('CANVAS_INVALID_INPUT'); END IF;
  RETURN true;
END;
$$;

-- Old mutation signatures are explicit fences, including already-held leases.
CREATE OR REPLACE FUNCTION canvas_acquire_gc_lease(p_token UUID) RETURNS BOOLEAN LANGUAGE plpgsql AS $$
BEGIN
  PERFORM canvas_raise('CANVAS_VERSION_UNSUPPORTED'); RETURN false;
END;
$$;
CREATE OR REPLACE FUNCTION canvas_claim_imports(p_sweep_token UUID, p_storage_location TEXT, p_limit INTEGER DEFAULT 20) RETURNS SETOF "CanvasImportAsset" LANGUAGE plpgsql AS $$
BEGIN
  PERFORM canvas_raise('CANVAS_VERSION_UNSUPPORTED'); RETURN;
END;
$$;
CREATE OR REPLACE FUNCTION canvas_finish_asset_delete(p_asset_id TEXT, p_delete_token UUID, p_outcome "CanvasDeleteOutcome", p_error_code TEXT DEFAULT NULL) RETURNS BOOLEAN LANGUAGE plpgsql AS $$
BEGIN
  PERFORM canvas_raise('CANVAS_VERSION_UNSUPPORTED'); RETURN false;
END;
$$;

CREATE FUNCTION canvas_sync_saved_images(p_owner TEXT, p_canvas UUID, p_scene JSONB) RETURNS VOID LANGUAGE plpgsql AS $$
DECLARE v_ids JSONB;
BEGIN
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

CREATE FUNCTION canvas_bridge_saved_images() RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  PERFORM canvas_sync_saved_images(NEW."ownerId", NEW.id, CASE WHEN NEW."deletedAt" IS NULL THEN NEW.scene ELSE NULL END);
  RETURN NULL;
END;
$$;
CREATE TRIGGER "Canvas_image_saved_roots" AFTER INSERT OR UPDATE OF scene,"deletedAt" ON "Canvas" FOR EACH ROW EXECUTE FUNCTION canvas_bridge_saved_images();

CREATE FUNCTION canvas_sync_run_images(p_owner TEXT, p_run TEXT, p_snapshot JSONB) RETURNS VOID LANGUAGE plpgsql AS $$
DECLARE v_ids JSONB;
BEGIN
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

CREATE FUNCTION canvas_bridge_run_images() RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.state = 'COMMITTED' AND (TG_OP = 'INSERT' OR OLD.state <> 'COMMITTED') THEN
    PERFORM canvas_sync_run_images(NEW."ownerId", NEW.id, NEW."inputSnapshot");
  END IF;
  RETURN NULL;
END;
$$;
CREATE TRIGGER "CanvasRun_image_input_roots" AFTER INSERT OR UPDATE OF state ON "CanvasRun" FOR EACH ROW EXECUTE FUNCTION canvas_bridge_run_images();

CREATE FUNCTION canvas_bridge_adopted_import() RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE v_document "Canvas"; v_run "CanvasRun";
BEGIN
  IF NEW."mediaAssetId" IS NULL OR OLD."mediaAssetId" IS NOT NULL THEN RETURN NULL; END IF;
  -- Historical source adoption preserves all saved and completed-job roots.
  -- The lifecycle guard above requires a drained old GC and a verified source.
  FOR v_document IN SELECT c.* FROM "Canvas" AS c JOIN "CanvasSavedAssetUse" AS u ON u."canvasId" = c.id
    WHERE u."assetId" = NEW.id AND c."deletedAt" IS NULL ORDER BY c.id LOOP
    PERFORM canvas_sync_saved_images(v_document."ownerId", v_document.id, v_document.scene);
  END LOOP;
  FOR v_run IN SELECT DISTINCT r.* FROM "CanvasRun" AS r JOIN "CanvasJobAssetUse" AS u ON u."runId" = r.id
    WHERE u."assetId" = NEW.id ORDER BY r.id LOOP
    PERFORM canvas_sync_run_images(v_run."ownerId", v_run.id, v_run."inputSnapshot");
  END LOOP;
  RETURN NULL;
END;
$$;
CREATE TRIGGER "CanvasImportAsset_image_adoption_roots" AFTER UPDATE OF "mediaAssetId" ON "CanvasImportAsset" FOR EACH ROW EXECUTE FUNCTION canvas_bridge_adopted_import();
