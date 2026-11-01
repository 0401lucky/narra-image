-- CreateEnum
CREATE TYPE "CanvasImportAssetState" AS ENUM ('UPLOADING', 'READY', 'QUARANTINED', 'DELETING', 'DELETED');

-- CreateEnum
CREATE TYPE "CanvasRunState" AS ENUM ('PREPARING', 'COMMITTED', 'REJECTED');

-- CreateEnum
CREATE TYPE "CanvasPutOutcome" AS ENUM ('NOT_STARTED', 'CONFIRMED', 'UNKNOWN');

-- CreateEnum
CREATE TYPE "CanvasDeleteOutcome" AS ENUM ('NOT_STARTED', 'DELETED', 'MISSING', 'FAILED', 'UNKNOWN');

-- CreateTable
CREATE TABLE "Canvas" (
    "id" UUID NOT NULL,
    "ownerId" VARCHAR(128) NOT NULL,
    "userId" TEXT,
    "title" VARCHAR(120) NOT NULL,
    "revision" INTEGER NOT NULL DEFAULT 0,
    "scene" JSONB,
    "lastSavedAt" TIMESTAMPTZ(3),
    "lastSaveId" UUID,
    "lastSaveHash" CHAR(64),
    "lastSaveRevision" INTEGER,
    "deletedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT clock_timestamp(),
    "updatedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT clock_timestamp(),

    CONSTRAINT "Canvas_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CanvasImportAsset" (
    "id" VARCHAR(128) NOT NULL,
    "ownerId" VARCHAR(128) NOT NULL,
    "userId" TEXT,
    "uploadId" UUID NOT NULL,
    "kind" VARCHAR(16) NOT NULL DEFAULT 'IMPORT',
    "sha256" CHAR(64) NOT NULL,
    "byteLength" INTEGER NOT NULL,
    "mimeType" VARCHAR(64) NOT NULL,
    "storageLocation" VARCHAR(128) NOT NULL,
    "storageEndpoint" VARCHAR(512) NOT NULL,
    "storageRegion" VARCHAR(128) NOT NULL,
    "storageBucket" VARCHAR(255) NOT NULL,
    "storageKey" VARCHAR(512) NOT NULL,
    "storageVersionId" VARCHAR(1024),
    "state" "CanvasImportAssetState" NOT NULL DEFAULT 'UPLOADING',
    "uploadToken" UUID NOT NULL,
    "uploadExpiresAt" TIMESTAMPTZ(3) NOT NULL,
    "preparationExpiresAt" TIMESTAMPTZ(3),
    "readyAt" TIMESTAMPTZ(3),
    "detachedAt" TIMESTAMPTZ(3),
    "putOutcome" "CanvasPutOutcome" NOT NULL DEFAULT 'NOT_STARTED',
    "deleteOutcome" "CanvasDeleteOutcome" NOT NULL DEFAULT 'NOT_STARTED',
    "deleteToken" UUID,
    "deleteExpiresAt" TIMESTAMPTZ(3),
    "deleteAttempts" INTEGER NOT NULL DEFAULT 0,
    "nextDeleteAt" TIMESTAMPTZ(3),
    "deletedAt" TIMESTAMPTZ(3),
    "lastStorageErrorCode" VARCHAR(64),
    "physicalBytesAccounted" BOOLEAN NOT NULL DEFAULT true,
    "needsReconciliation" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT clock_timestamp(),
    "updatedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT clock_timestamp(),

    CONSTRAINT "CanvasImportAsset_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CanvasSavedAssetUse" (
    "canvasId" UUID NOT NULL,
    "assetId" VARCHAR(128) NOT NULL,
    "ownerId" VARCHAR(128) NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT clock_timestamp(),

    CONSTRAINT "CanvasSavedAssetUse_pkey" PRIMARY KEY ("canvasId","assetId")
);

-- CreateTable
CREATE TABLE "CanvasRun" (
    "id" VARCHAR(128) NOT NULL,
    "ownerId" VARCHAR(128) NOT NULL,
    "userId" TEXT,
    "canvasId" UUID NOT NULL,
    "nodeId" UUID NOT NULL,
    "runId" UUID NOT NULL,
    "intentHash" CHAR(64) NOT NULL,
    "credentialFingerprint" CHAR(64),
    "inputSnapshot" JSONB NOT NULL,
    "state" "CanvasRunState" NOT NULL DEFAULT 'PREPARING',
    "preparationToken" UUID NOT NULL,
    "preparationExpiresAt" TIMESTAMPTZ(3) NOT NULL,
    "originalJobId" VARCHAR(128),
    "liveJobId" TEXT,
    "rejectionCode" VARCHAR(64),
    "committedAt" TIMESTAMPTZ(3),
    "rejectedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT clock_timestamp(),
    "updatedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT clock_timestamp(),

    CONSTRAINT "CanvasRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CanvasJobAssetUse" (
    "id" VARCHAR(128) NOT NULL,
    "ownerId" VARCHAR(128) NOT NULL,
    "runId" VARCHAR(128) NOT NULL,
    "assetId" VARCHAR(128) NOT NULL,
    "originalJobId" VARCHAR(128) NOT NULL,
    "liveJobId" TEXT,
    "ordinal" INTEGER NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT clock_timestamp(),

    CONSTRAINT "CanvasJobAssetUse_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CanvasGcLease" (
    "id" VARCHAR(64) NOT NULL DEFAULT 'canvas-imports',
    "token" UUID,
    "expiresAt" TIMESTAMPTZ(3),
    "updatedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT clock_timestamp(),

    CONSTRAINT "CanvasGcLease_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Canvas_owner_metadata_idx" ON "Canvas"("ownerId", "deletedAt", "updatedAt" DESC, "id" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "Canvas_id_owner_key" ON "Canvas"("id", "ownerId");

-- CreateIndex
CREATE INDEX "CanvasImportAsset_owner_quota_idx" ON "CanvasImportAsset"("ownerId", "physicalBytesAccounted");

-- CreateIndex
CREATE INDEX "CanvasImportAsset_owner_upload_idx" ON "CanvasImportAsset"("ownerId", "state", "uploadExpiresAt");

-- CreateIndex
CREATE INDEX "CanvasImportAsset_gc_idx" ON "CanvasImportAsset"("storageLocation", "state", "nextDeleteAt", "detachedAt");

-- CreateIndex
CREATE UNIQUE INDEX "CanvasImportAsset_id_owner_key" ON "CanvasImportAsset"("id", "ownerId");

-- CreateIndex
CREATE UNIQUE INDEX "CanvasImportAsset_owner_upload_key" ON "CanvasImportAsset"("ownerId", "uploadId");

-- CreateIndex
CREATE UNIQUE INDEX "CanvasImportAsset_physical_key" ON "CanvasImportAsset"("storageEndpoint", "storageBucket", "storageKey");

-- CreateIndex
CREATE INDEX "CanvasSavedAssetUse_asset_idx" ON "CanvasSavedAssetUse"("assetId");

-- CreateIndex
CREATE UNIQUE INDEX "CanvasRun_original_job_key" ON "CanvasRun"("originalJobId");

-- CreateIndex
CREATE UNIQUE INDEX "CanvasRun_live_job_key" ON "CanvasRun"("liveJobId");

-- CreateIndex
CREATE INDEX "CanvasRun_node_admission_idx" ON "CanvasRun"("canvasId", "nodeId", "state", "preparationExpiresAt");

-- CreateIndex
CREATE INDEX "CanvasRun_owner_canvas_idx" ON "CanvasRun"("ownerId", "canvasId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "CanvasRun_id_owner_key" ON "CanvasRun"("id", "ownerId");

-- CreateIndex
CREATE UNIQUE INDEX "CanvasRun_owner_run_key" ON "CanvasRun"("ownerId", "runId");

-- CreateIndex
CREATE INDEX "CanvasJobAssetUse_asset_idx" ON "CanvasJobAssetUse"("assetId");

-- CreateIndex
CREATE INDEX "CanvasJobAssetUse_original_job_idx" ON "CanvasJobAssetUse"("originalJobId");

-- CreateIndex
CREATE UNIQUE INDEX "CanvasJobAssetUse_run_ordinal_key" ON "CanvasJobAssetUse"("runId", "ordinal");

-- CreateIndex
CREATE UNIQUE INDEX "CanvasJobAssetUse_run_asset_key" ON "CanvasJobAssetUse"("runId", "assetId");

-- AddForeignKey
ALTER TABLE "Canvas" ADD CONSTRAINT "Canvas_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "CanvasImportAsset" ADD CONSTRAINT "CanvasImportAsset_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "CanvasSavedAssetUse" ADD CONSTRAINT "CanvasSavedAssetUse_canvasId_ownerId_fkey" FOREIGN KEY ("canvasId", "ownerId") REFERENCES "Canvas"("id", "ownerId") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "CanvasSavedAssetUse" ADD CONSTRAINT "CanvasSavedAssetUse_assetId_ownerId_fkey" FOREIGN KEY ("assetId", "ownerId") REFERENCES "CanvasImportAsset"("id", "ownerId") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "CanvasRun" ADD CONSTRAINT "CanvasRun_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "CanvasRun" ADD CONSTRAINT "CanvasRun_canvasId_ownerId_fkey" FOREIGN KEY ("canvasId", "ownerId") REFERENCES "Canvas"("id", "ownerId") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "CanvasRun" ADD CONSTRAINT "CanvasRun_liveJobId_fkey" FOREIGN KEY ("liveJobId") REFERENCES "GenerationJob"("id") ON DELETE SET NULL ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "CanvasJobAssetUse" ADD CONSTRAINT "CanvasJobAssetUse_runId_ownerId_fkey" FOREIGN KEY ("runId", "ownerId") REFERENCES "CanvasRun"("id", "ownerId") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "CanvasJobAssetUse" ADD CONSTRAINT "CanvasJobAssetUse_assetId_ownerId_fkey" FOREIGN KEY ("assetId", "ownerId") REFERENCES "CanvasImportAsset"("id", "ownerId") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "CanvasJobAssetUse" ADD CONSTRAINT "CanvasJobAssetUse_liveJobId_fkey" FOREIGN KEY ("liveJobId") REFERENCES "GenerationJob"("id") ON DELETE SET NULL ON UPDATE RESTRICT;

-- Canvas inventories keep immutable principals/keys; nullable live FKs preserve
-- the existing account/job delete paths without erasing submitted-input roots.
CREATE FUNCTION canvas_raise(p_code TEXT) RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = p_code, CONSTRAINT = p_code;
END;
$$;

CREATE FUNCTION canvas_is_canonical_id(p_value TEXT) RETURNS BOOLEAN LANGUAGE sql IMMUTABLE AS $$
  SELECT p_value IS NOT NULL AND length(p_value) BETWEEN 1 AND 128
    AND p_value ~ '^[A-Za-z0-9][A-Za-z0-9._:-]*$';
$$;

CREATE FUNCTION canvas_is_client_id(p_value TEXT) RETURNS BOOLEAN LANGUAGE sql IMMUTABLE AS $$
  SELECT p_value IS NOT NULL AND p_value ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$';
$$;

CREATE FUNCTION canvas_assert_keys(p_value JSONB, p_required TEXT[], p_allowed TEXT[]) RETURNS VOID LANGUAGE plpgsql IMMUTABLE AS $$
BEGIN
  IF jsonb_typeof(p_value) IS DISTINCT FROM 'object' THEN
    PERFORM canvas_raise('CANVAS_INVALID_INPUT');
  END IF;
  IF EXISTS (SELECT 1 FROM jsonb_object_keys(p_value) AS k WHERE k <> ALL(p_allowed))
    OR EXISTS (SELECT 1 FROM unnest(p_required) AS k WHERE NOT p_value ? k)
  THEN PERFORM canvas_raise('CANVAS_INVALID_INPUT'); END IF;
END;
$$;

CREATE FUNCTION canvas_assert_parameters(p_value JSONB, p_run BOOLEAN DEFAULT false, p_images INTEGER DEFAULT 0) RETURNS VOID LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE
  fields TEXT[] := ARRAY['providerMode','channelId','model','size','quality','outputFormat','outputCompression','moderation','count','negativePrompt','seed'];
BEGIN
  IF p_run THEN fields := fields || ARRAY['generationType']; END IF;
  PERFORM canvas_assert_keys(p_value, fields, fields);
  IF jsonb_typeof(p_value->'providerMode') IS DISTINCT FROM 'string'
    OR p_value->>'providerMode' NOT IN ('built_in','custom')
    OR jsonb_typeof(p_value->'model') IS DISTINCT FROM 'string'
    OR length(btrim(p_value->>'model')) NOT BETWEEN 1 AND 200
    OR jsonb_typeof(p_value->'size') IS DISTINCT FROM 'string'
    OR NOT (p_value->>'size' = 'auto' OR p_value->>'size' ~ '^[0-9]+x[0-9]+$')
    OR jsonb_typeof(p_value->'quality') IS DISTINCT FROM 'string'
    OR p_value->>'quality' NOT IN ('auto','low','medium','high')
    OR jsonb_typeof(p_value->'outputFormat') IS DISTINCT FROM 'string'
    OR p_value->>'outputFormat' NOT IN ('png','jpeg','webp')
    OR jsonb_typeof(p_value->'moderation') IS DISTINCT FROM 'string'
    OR p_value->>'moderation' NOT IN ('auto','low')
    OR jsonb_typeof(p_value->'count') IS DISTINCT FROM 'number'
  THEN PERFORM canvas_raise('CANVAS_INVALID_INPUT'); END IF;
  IF (p_value->>'count')::NUMERIC NOT BETWEEN 1 AND 4
    OR trunc((p_value->>'count')::NUMERIC) <> (p_value->>'count')::NUMERIC
  THEN PERFORM canvas_raise('CANVAS_INVALID_INPUT'); END IF;
  IF p_value->'channelId' <> 'null'::JSONB AND (jsonb_typeof(p_value->'channelId') <> 'string' OR NOT canvas_is_canonical_id(p_value->>'channelId'))
    THEN PERFORM canvas_raise('CANVAS_INVALID_INPUT'); END IF;
  IF p_value->'negativePrompt' <> 'null'::JSONB AND (jsonb_typeof(p_value->'negativePrompt') <> 'string' OR length(p_value->>'negativePrompt') > 1000)
    THEN PERFORM canvas_raise('CANVAS_INVALID_INPUT'); END IF;
  IF p_value->'seed' <> 'null'::JSONB THEN
    IF jsonb_typeof(p_value->'seed') <> 'number' THEN PERFORM canvas_raise('CANVAS_INVALID_INPUT'); END IF;
    IF (p_value->>'seed')::NUMERIC NOT BETWEEN 1 AND 2147483647 OR trunc((p_value->>'seed')::NUMERIC) <> (p_value->>'seed')::NUMERIC
      THEN PERFORM canvas_raise('CANVAS_INVALID_INPUT'); END IF;
  END IF;
  IF p_value->>'outputFormat' = 'png' THEN
    IF p_value->'outputCompression' <> 'null'::JSONB THEN PERFORM canvas_raise('CANVAS_INVALID_INPUT'); END IF;
  ELSE
    IF jsonb_typeof(p_value->'outputCompression') IS DISTINCT FROM 'number' THEN PERFORM canvas_raise('CANVAS_INVALID_INPUT'); END IF;
    IF (p_value->>'outputCompression')::NUMERIC NOT BETWEEN 0 AND 100 OR trunc((p_value->>'outputCompression')::NUMERIC) <> (p_value->>'outputCompression')::NUMERIC
      THEN PERFORM canvas_raise('CANVAS_INVALID_INPUT'); END IF;
  END IF;
  IF p_run AND (p_images NOT BETWEEN 0 AND 16 OR p_value->>'generationType' IS DISTINCT FROM CASE WHEN p_images = 0 THEN 'text_to_image' ELSE 'image_to_image' END
    OR (p_images > 0 AND ((p_value->>'count')::INTEGER <> 1 OR p_value->'negativePrompt' <> 'null'::JSONB OR p_value->'seed' <> 'null'::JSONB)))
  THEN PERFORM canvas_raise('CANVAS_INVALID_INPUT'); END IF;
END;
$$;

CREATE FUNCTION canvas_assert_run_snapshot(p_value JSONB) RETURNS VOID LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE
  ref JSONB;
  ordinal INTEGER := 0;
  identity TEXT;
  seen_sources TEXT[] := ARRAY[]::TEXT[];
  seen_identities TEXT[] := ARRAY[]::TEXT[];
BEGIN
  PERFORM canvas_assert_keys(p_value, ARRAY['canvasId','nodeId','runId','input','parameters'], ARRAY['canvasId','nodeId','runId','input','parameters']);
  IF NOT canvas_is_client_id(p_value->>'canvasId') OR NOT canvas_is_client_id(p_value->>'nodeId') OR NOT canvas_is_client_id(p_value->>'runId')
    THEN PERFORM canvas_raise('CANVAS_INVALID_INPUT'); END IF;
  PERFORM canvas_assert_keys(p_value->'input', ARRAY['prompt','references'], ARRAY['prompt','references']);
  PERFORM canvas_assert_keys(p_value->'input'->'prompt', ARRAY['sourceNodeId','text'], ARRAY['sourceNodeId','text']);
  IF NOT canvas_is_client_id(p_value->'input'->'prompt'->>'sourceNodeId')
    OR p_value->'input'->'prompt'->>'sourceNodeId' = p_value->>'nodeId'
    OR jsonb_typeof(p_value->'input'->'prompt'->'text') IS DISTINCT FROM 'string'
    OR length(btrim(p_value->'input'->'prompt'->>'text')) NOT BETWEEN 2 AND 8000
    OR jsonb_typeof(p_value->'input'->'references') IS DISTINCT FROM 'array'
  THEN PERFORM canvas_raise('CANVAS_INVALID_INPUT'); END IF;
  IF jsonb_array_length(p_value->'input'->'references') > 16 OR octet_length(p_value::TEXT) > 65536
    THEN PERFORM canvas_raise('CANVAS_LIMIT_EXCEEDED'); END IF;
  FOR ref IN SELECT value FROM jsonb_array_elements(p_value->'input'->'references') LOOP
    ordinal := ordinal + 1;
    IF jsonb_typeof(ref->'ordinal') IS DISTINCT FROM 'number' OR (ref->>'ordinal')::NUMERIC <> ordinal
      THEN PERFORM canvas_raise('CANVAS_REFERENCE_ORDER_INVALID'); END IF;
    IF ref->>'kind' = 'imported' THEN
      PERFORM canvas_assert_keys(ref, ARRAY['sourceNodeId','ordinal','kind','assetId'], ARRAY['sourceNodeId','ordinal','kind','assetId']);
      IF NOT canvas_is_client_id(ref->>'sourceNodeId') OR NOT canvas_is_canonical_id(ref->>'assetId')
        THEN PERFORM canvas_raise('CANVAS_INVALID_INPUT'); END IF;
      identity := 'imported:' || (ref->>'assetId');
    ELSIF ref->>'kind' = 'result' THEN
      PERFORM canvas_assert_keys(ref, ARRAY['sourceNodeId','ordinal','kind','jobId','imageId'], ARRAY['sourceNodeId','ordinal','kind','jobId','imageId']);
      IF NOT canvas_is_canonical_id(ref->>'jobId') OR NOT canvas_is_canonical_id(ref->>'imageId') OR ref->>'sourceNodeId' IS DISTINCT FROM 'result:' || (ref->>'imageId')
        THEN PERFORM canvas_raise('CANVAS_ORIGIN_MISMATCH'); END IF;
      identity := 'result:' || (ref->>'imageId');
    ELSE PERFORM canvas_raise('CANVAS_INVALID_INPUT'); END IF;
    IF ref->>'sourceNodeId' = p_value->>'nodeId' OR ref->>'sourceNodeId' = p_value->'input'->'prompt'->>'sourceNodeId'
      THEN PERFORM canvas_raise('CANVAS_INVALID_CONNECTION'); END IF;
    IF ref->>'sourceNodeId' = ANY(seen_sources) OR identity = ANY(seen_identities) THEN PERFORM canvas_raise('CANVAS_DUPLICATE_INPUT'); END IF;
    seen_sources := seen_sources || (ref->>'sourceNodeId');
    seen_identities := seen_identities || identity;
  END LOOP;
  PERFORM canvas_assert_parameters(p_value->'parameters', true, ordinal);
END;
$$;

CREATE FUNCTION canvas_assert_position(p_value JSONB, p_viewport BOOLEAN DEFAULT false) RETURNS VOID LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE fields TEXT[] := ARRAY['x','y'];
BEGIN
  IF p_viewport THEN fields := fields || ARRAY['zoom']; END IF;
  PERFORM canvas_assert_keys(p_value, fields, fields);
  IF jsonb_typeof(p_value->'x') IS DISTINCT FROM 'number' OR jsonb_typeof(p_value->'y') IS DISTINCT FROM 'number'
    THEN PERFORM canvas_raise('CANVAS_INVALID_INPUT'); END IF;
  IF abs((p_value->>'x')::NUMERIC) > 1.7976931348623157e308::NUMERIC OR abs((p_value->>'y')::NUMERIC) > 1.7976931348623157e308::NUMERIC
    THEN PERFORM canvas_raise('CANVAS_INVALID_INPUT'); END IF;
  IF p_viewport THEN
    IF jsonb_typeof(p_value->'zoom') IS DISTINCT FROM 'number' THEN PERFORM canvas_raise('CANVAS_INVALID_INPUT'); END IF;
    IF (p_value->>'zoom')::NUMERIC <= 0 OR (p_value->>'zoom')::NUMERIC > 1.7976931348623157e308::NUMERIC
      THEN PERFORM canvas_raise('CANVAS_INVALID_INPUT'); END IF;
  END IF;
END;
$$;

CREATE FUNCTION canvas_assert_scene(p_scene JSONB) RETURNS VOID LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE
  node JSONB;
  edge JSONB;
  binding JSONB;
  source_node JSONB;
  target_node JSONB;
  kind TEXT;
  identity TEXT;
  target_id TEXT;
  node_ids TEXT[] := ARRAY[]::TEXT[];
  edge_ids TEXT[] := ARRAY[]::TEXT[];
  edge_identities TEXT[] := ARRAY[]::TEXT[];
  input_identities TEXT[] := ARRAY[]::TEXT[];
  input_ordinals TEXT[] := ARRAY[]::TEXT[];
  binding_nodes TEXT[] := ARRAY[]::TEXT[];
  binding_runs TEXT[] := ARRAY[]::TEXT[];
  input_count INTEGER;
BEGIN
  PERFORM canvas_assert_keys(p_scene, ARRAY['schemaVersion','nodes','edges','viewport','runBindings'], ARRAY['schemaVersion','nodes','edges','viewport','runBindings']);
  IF p_scene->'schemaVersion' IS DISTINCT FROM '1'::JSONB THEN PERFORM canvas_raise('CANVAS_VERSION_UNSUPPORTED'); END IF;
  IF jsonb_typeof(p_scene->'nodes') IS DISTINCT FROM 'array' OR jsonb_typeof(p_scene->'edges') IS DISTINCT FROM 'array' OR jsonb_typeof(p_scene->'runBindings') IS DISTINCT FROM 'array'
    THEN PERFORM canvas_raise('CANVAS_INVALID_INPUT'); END IF;
  -- JSONB adds separator whitespace; transport enforces the exact 512 KiB
  -- normalized UTF-8 limit, while this bound also rejects unbounded SQL writers.
  IF jsonb_array_length(p_scene->'nodes') > 200 OR jsonb_array_length(p_scene->'edges') > 400 OR jsonb_array_length(p_scene->'runBindings') > 200 OR octet_length(p_scene::TEXT) > 540672
    THEN PERFORM canvas_raise('CANVAS_LIMIT_EXCEEDED'); END IF;
  PERFORM canvas_assert_position(p_scene->'viewport', true);
  FOR node IN SELECT value FROM jsonb_array_elements(p_scene->'nodes') LOOP
    kind := node->>'kind';
    IF kind = 'prompt' THEN
      PERFORM canvas_assert_keys(node, ARRAY['id','kind','position','text'], ARRAY['id','kind','position','text']);
      IF jsonb_typeof(node->'text') IS DISTINCT FROM 'string' OR length(node->>'text') > 8000 THEN PERFORM canvas_raise('CANVAS_INVALID_INPUT'); END IF;
    ELSIF kind = 'reference' THEN
      PERFORM canvas_assert_keys(node, ARRAY['id','kind','position','source'], ARRAY['id','kind','position','source']);
      PERFORM canvas_assert_keys(node->'source', ARRAY['kind','assetId'], ARRAY['kind','assetId']);
      IF node->'source'->>'kind' IS DISTINCT FROM 'imported' OR NOT canvas_is_canonical_id(node->'source'->>'assetId') THEN PERFORM canvas_raise('CANVAS_INVALID_INPUT'); END IF;
    ELSIF kind = 'generation' THEN
      PERFORM canvas_assert_keys(node, ARRAY['id','kind','position','parameters'], ARRAY['id','kind','position','parameters']);
      PERFORM canvas_assert_parameters(node->'parameters');
    ELSIF kind = 'result' THEN
      PERFORM canvas_assert_keys(node, ARRAY['id','kind','position','jobId','imageId'], ARRAY['id','kind','position','jobId','imageId','runId']);
      IF NOT canvas_is_canonical_id(node->>'jobId') OR NOT canvas_is_canonical_id(node->>'imageId') OR node->>'id' IS DISTINCT FROM 'result:' || (node->>'imageId')
        OR (node ? 'runId' AND NOT canvas_is_client_id(node->>'runId')) THEN PERFORM canvas_raise('CANVAS_ORIGIN_MISMATCH'); END IF;
    ELSE PERFORM canvas_raise('CANVAS_INVALID_INPUT'); END IF;
    IF kind <> 'result' AND NOT canvas_is_client_id(node->>'id') THEN PERFORM canvas_raise('CANVAS_INVALID_INPUT'); END IF;
    IF node->>'id' = ANY(node_ids) THEN PERFORM canvas_raise('CANVAS_DUPLICATE_INPUT'); END IF;
    node_ids := node_ids || (node->>'id');
    PERFORM canvas_assert_position(node->'position');
  END LOOP;
  FOR edge IN SELECT value FROM jsonb_array_elements(p_scene->'edges') LOOP
    kind := edge->>'kind';
    IF kind = 'image-input' THEN
      PERFORM canvas_assert_keys(edge, ARRAY['id','kind','source','target','ordinal'], ARRAY['id','kind','source','target','ordinal']);
    ELSE PERFORM canvas_assert_keys(edge, ARRAY['id','kind','source','target'], ARRAY['id','kind','source','target']); END IF;
    IF NOT canvas_is_client_id(edge->>'id') OR edge->>'source' = edge->>'target' THEN PERFORM canvas_raise('CANVAS_INVALID_CONNECTION'); END IF;
    SELECT value INTO source_node FROM jsonb_array_elements(p_scene->'nodes') WHERE value->>'id' = edge->>'source';
    SELECT value INTO target_node FROM jsonb_array_elements(p_scene->'nodes') WHERE value->>'id' = edge->>'target';
    IF source_node IS NULL OR target_node IS NULL THEN PERFORM canvas_raise('CANVAS_INVALID_CONNECTION'); END IF;
    identity := kind || '|' || (edge->>'source') || '|' || (edge->>'target');
    IF edge->>'id' = ANY(edge_ids) OR identity = ANY(edge_identities) THEN PERFORM canvas_raise('CANVAS_DUPLICATE_INPUT'); END IF;
    edge_ids := edge_ids || (edge->>'id'); edge_identities := edge_identities || identity;
    IF kind = 'prompt-input' THEN
      IF source_node->>'kind' <> 'prompt' OR target_node->>'kind' <> 'generation' THEN PERFORM canvas_raise('CANVAS_INVALID_CONNECTION'); END IF;
      SELECT count(*) INTO input_count FROM jsonb_array_elements(p_scene->'edges') WHERE value->>'kind' = 'prompt-input' AND value->>'target' = edge->>'target';
      IF input_count > 1 THEN PERFORM canvas_raise('CANVAS_DUPLICATE_INPUT'); END IF;
    ELSIF kind = 'image-input' THEN
      IF source_node->>'kind' NOT IN ('reference','result') OR target_node->>'kind' <> 'generation' THEN PERFORM canvas_raise('CANVAS_INVALID_CONNECTION'); END IF;
      IF jsonb_typeof(edge->'ordinal') IS DISTINCT FROM 'number' THEN PERFORM canvas_raise('CANVAS_REFERENCE_ORDER_INVALID'); END IF;
      IF (edge->>'ordinal')::NUMERIC NOT BETWEEN 1 AND 16 OR trunc((edge->>'ordinal')::NUMERIC) <> (edge->>'ordinal')::NUMERIC THEN PERFORM canvas_raise('CANVAS_REFERENCE_ORDER_INVALID'); END IF;
      identity := (edge->>'target') || '|' || CASE WHEN source_node->>'kind' = 'reference' THEN 'imported:' || (source_node->'source'->>'assetId') ELSE 'result:' || (source_node->>'imageId') END;
      IF identity = ANY(input_identities) THEN PERFORM canvas_raise('CANVAS_DUPLICATE_INPUT'); END IF;
      input_identities := input_identities || identity;
      identity := (edge->>'target') || '|' || (edge->>'ordinal');
      IF identity = ANY(input_ordinals) THEN PERFORM canvas_raise('CANVAS_REFERENCE_ORDER_INVALID'); END IF;
      input_ordinals := input_ordinals || identity;
    ELSIF kind = 'output-provenance' THEN
      IF source_node->>'kind' <> 'generation' OR target_node->>'kind' <> 'result' OR NOT target_node ? 'runId' THEN PERFORM canvas_raise('CANVAS_INVALID_CONNECTION'); END IF;
    ELSE PERFORM canvas_raise('CANVAS_INVALID_CONNECTION'); END IF;
  END LOOP;
  FOR target_id IN SELECT DISTINCT value->>'target' FROM jsonb_array_elements(p_scene->'edges') WHERE value->>'kind' = 'image-input' LOOP
    SELECT count(*) INTO input_count FROM jsonb_array_elements(p_scene->'edges') WHERE value->>'kind' = 'image-input' AND value->>'target' = target_id;
    IF input_count > 16 THEN PERFORM canvas_raise('CANVAS_LIMIT_EXCEEDED'); END IF;
    IF EXISTS (SELECT 1 FROM jsonb_array_elements(p_scene->'edges') WHERE value->>'kind' = 'image-input' AND value->>'target' = target_id AND (value->>'ordinal')::INTEGER > input_count)
      THEN PERFORM canvas_raise('CANVAS_REFERENCE_ORDER_INVALID'); END IF;
  END LOOP;
  FOR binding IN SELECT value FROM jsonb_array_elements(p_scene->'runBindings') LOOP
    PERFORM canvas_assert_keys(binding, ARRAY['runId','nodeId','jobId','outputsHandled'], ARRAY['runId','nodeId','jobId','outputsHandled']);
    IF NOT canvas_is_client_id(binding->>'runId') OR NOT canvas_is_client_id(binding->>'nodeId') OR NOT canvas_is_canonical_id(binding->>'jobId') OR jsonb_typeof(binding->'outputsHandled') IS DISTINCT FROM 'boolean'
      OR NOT EXISTS (SELECT 1 FROM jsonb_array_elements(p_scene->'nodes') WHERE value->>'id' = binding->>'nodeId' AND value->>'kind' = 'generation')
      THEN PERFORM canvas_raise('CANVAS_ORIGIN_MISMATCH'); END IF;
    IF binding->>'nodeId' = ANY(binding_nodes) OR binding->>'runId' = ANY(binding_runs) THEN PERFORM canvas_raise('CANVAS_DUPLICATE_INPUT'); END IF;
    binding_nodes := binding_nodes || (binding->>'nodeId'); binding_runs := binding_runs || (binding->>'runId');
  END LOOP;
END;
$$;

CREATE FUNCTION canvas_lock_owner(p_owner TEXT) RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  IF NOT canvas_is_canonical_id(p_owner) THEN PERFORM canvas_raise('CANVAS_INVALID_INPUT'); END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('narra.canvas.owner:' || p_owner, 0));
END;
$$;

CREATE FUNCTION canvas_lock_assets(p_owner TEXT, p_ids TEXT[], p_require_ready BOOLEAN DEFAULT true) RETURNS VOID LANGUAGE plpgsql AS $$
DECLARE asset "CanvasImportAsset"%ROWTYPE; found_ids TEXT[] := ARRAY[]::TEXT[];
BEGIN
  IF p_owner IS NULL OR p_ids IS NULL OR p_require_ready IS NULL OR array_position(p_ids, NULL) IS NOT NULL THEN PERFORM canvas_raise('CANVAS_INVALID_INPUT'); END IF;
  FOR asset IN SELECT * FROM "CanvasImportAsset" WHERE id = ANY(p_ids) ORDER BY id FOR UPDATE LOOP
    IF asset."ownerId" <> p_owner OR asset.kind <> 'IMPORT' OR (p_require_ready AND asset.state <> 'READY') THEN PERFORM canvas_raise('CANVAS_INPUT_UNAVAILABLE'); END IF;
    found_ids := found_ids || asset.id;
  END LOOP;
  IF EXISTS (SELECT 1 FROM unnest(p_ids) AS id WHERE NOT id = ANY(found_ids)) THEN PERFORM canvas_raise('CANVAS_INPUT_UNAVAILABLE'); END IF;
END;
$$;

CREATE FUNCTION canvas_guard_document() RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN PERFORM canvas_raise('CANVAS_INVENTORY_IMMUTABLE'); END IF;
  IF TG_OP = 'INSERT' THEN
    PERFORM canvas_lock_owner(NEW."ownerId");
    IF NOT canvas_is_client_id(NEW.id::TEXT) OR NEW."userId" IS DISTINCT FROM NEW."ownerId" OR NEW.scene IS NOT NULL OR NEW.revision <> 0 OR NEW."deletedAt" IS NOT NULL
      OR NEW."lastSaveId" IS NOT NULL OR NEW."lastSaveHash" IS NOT NULL OR NEW."lastSaveRevision" IS NOT NULL OR NEW."lastSavedAt" IS NOT NULL
      THEN PERFORM canvas_raise('CANVAS_INVALID_INPUT'); END IF;
    IF (SELECT count(*) FROM "Canvas" WHERE "ownerId" = NEW."ownerId" AND "deletedAt" IS NULL) >= 100 THEN PERFORM canvas_raise('CANVAS_QUOTA_EXCEEDED'); END IF;
    NEW."createdAt" := clock_timestamp();
  ELSE
    IF NEW.id <> OLD.id OR NEW."ownerId" <> OLD."ownerId" OR NEW."createdAt" <> OLD."createdAt"
      OR (NEW."userId" IS DISTINCT FROM OLD."userId" AND NOT (OLD."userId" IS NOT NULL AND NEW."userId" IS NULL)) THEN PERFORM canvas_raise('CANVAS_INVENTORY_IMMUTABLE'); END IF;
    IF OLD."deletedAt" IS NOT NULL AND (NEW."deletedAt" IS DISTINCT FROM OLD."deletedAt" OR NEW.title <> OLD.title OR NEW.revision <> OLD.revision OR NEW.scene IS DISTINCT FROM OLD.scene)
      THEN PERFORM canvas_raise('CANVAS_DELETED'); END IF;
    IF (NEW.title IS DISTINCT FROM OLD.title OR NEW.scene IS DISTINCT FROM OLD.scene OR NEW."deletedAt" IS DISTINCT FROM OLD."deletedAt" OR NEW."lastSaveId" IS DISTINCT FROM OLD."lastSaveId") THEN
      IF NEW.revision <> OLD.revision + 1 THEN PERFORM canvas_raise('CANVAS_REVISION_CONFLICT'); END IF;
    ELSIF NEW.revision NOT IN (OLD.revision, OLD.revision + 1) THEN PERFORM canvas_raise('CANVAS_REVISION_CONFLICT'); END IF;
    IF OLD."deletedAt" IS NULL AND NEW."deletedAt" IS NOT NULL THEN NEW."deletedAt" := clock_timestamp(); END IF;
  END IF;
  IF length(btrim(NEW.title)) NOT BETWEEN 1 AND 120 OR NEW.title <> btrim(NEW.title) THEN PERFORM canvas_raise('CANVAS_INVALID_INPUT'); END IF;
  IF NEW.scene IS NOT NULL THEN
    PERFORM canvas_assert_scene(NEW.scene);
    IF TG_OP = 'UPDATE' AND NEW.scene IS DISTINCT FROM OLD.scene THEN PERFORM canvas_validate_scene_resources(NEW."ownerId", NEW.id, NEW.scene); END IF;
  END IF;
  NEW."updatedAt" := clock_timestamp();
  RETURN NEW;
END;
$$;
CREATE TRIGGER "Canvas_document_guard" BEFORE INSERT OR UPDATE OR DELETE ON "Canvas" FOR EACH ROW EXECUTE FUNCTION canvas_guard_document();

CREATE FUNCTION canvas_guard_import_asset() RETURNS TRIGGER LANGUAGE plpgsql AS $$
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
    IF NEW.id <> OLD.id OR NEW."ownerId" <> OLD."ownerId" OR NEW."uploadId" <> OLD."uploadId" OR NEW.kind <> OLD.kind OR NEW.sha256 <> OLD.sha256 OR NEW."byteLength" <> OLD."byteLength" OR NEW."mimeType" <> OLD."mimeType"
      OR NEW."storageLocation" <> OLD."storageLocation" OR NEW."storageEndpoint" <> OLD."storageEndpoint" OR NEW."storageRegion" <> OLD."storageRegion" OR NEW."storageBucket" <> OLD."storageBucket" OR NEW."storageKey" <> OLD."storageKey"
      OR NEW."uploadToken" <> OLD."uploadToken" OR NEW."uploadExpiresAt" <> OLD."uploadExpiresAt" OR NEW."createdAt" <> OLD."createdAt"
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
  NEW."updatedAt" := v_now;
  RETURN NEW;
END;
$$;
CREATE TRIGGER "CanvasImportAsset_lifecycle_guard" BEFORE INSERT OR UPDATE OR DELETE ON "CanvasImportAsset" FOR EACH ROW EXECUTE FUNCTION canvas_guard_import_asset();

CREATE FUNCTION canvas_refresh_asset_detach() RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE asset_id TEXT := CASE WHEN TG_OP = 'DELETE' THEN OLD."assetId" ELSE NEW."assetId" END; rooted BOOLEAN;
BEGIN
  PERFORM 1 FROM "CanvasImportAsset" WHERE id = asset_id FOR UPDATE;
  SELECT EXISTS (SELECT 1 FROM "CanvasSavedAssetUse" WHERE "assetId" = asset_id) OR EXISTS (SELECT 1 FROM "CanvasJobAssetUse" WHERE "assetId" = asset_id) INTO rooted;
  UPDATE "CanvasImportAsset" SET "detachedAt" = CASE WHEN rooted THEN NULL ELSE clock_timestamp() END WHERE id = asset_id;
  RETURN NULL;
END;
$$;

CREATE FUNCTION canvas_guard_saved_asset_use() RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN PERFORM canvas_raise('CANVAS_INVENTORY_IMMUTABLE'); END IF;
  IF TG_OP = 'INSERT' THEN
    PERFORM 1 FROM "Canvas" WHERE id = NEW."canvasId" AND "ownerId" = NEW."ownerId" AND "deletedAt" IS NULL AND "userId" IS NOT NULL FOR UPDATE;
    IF NOT FOUND THEN PERFORM canvas_raise('CANVAS_NOT_FOUND'); END IF;
    PERFORM canvas_lock_assets(NEW."ownerId", ARRAY[NEW."assetId"]);
    NEW."createdAt" := clock_timestamp(); RETURN NEW;
  END IF;
  PERFORM canvas_lock_assets(OLD."ownerId", ARRAY[OLD."assetId"], false);
  RETURN OLD;
END;
$$;
CREATE TRIGGER "CanvasSavedAssetUse_ready_guard" BEFORE INSERT OR UPDATE OR DELETE ON "CanvasSavedAssetUse" FOR EACH ROW EXECUTE FUNCTION canvas_guard_saved_asset_use();
CREATE TRIGGER "CanvasSavedAssetUse_detach_guard" AFTER INSERT OR DELETE ON "CanvasSavedAssetUse" FOR EACH ROW EXECUTE FUNCTION canvas_refresh_asset_detach();

CREATE FUNCTION canvas_guard_run() RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE v_now TIMESTAMPTZ := clock_timestamp(); refs TEXT[]; refreshing BOOLEAN := false;
BEGIN
  IF TG_OP = 'DELETE' THEN PERFORM canvas_raise('CANVAS_INVENTORY_IMMUTABLE'); END IF;
  IF TG_OP = 'UPDATE' THEN
    IF NEW.id <> OLD.id OR NEW."ownerId" <> OLD."ownerId" OR NEW."canvasId" <> OLD."canvasId" OR NEW."nodeId" <> OLD."nodeId" OR NEW."runId" <> OLD."runId" OR NEW."intentHash" <> OLD."intentHash" OR NEW."credentialFingerprint" IS DISTINCT FROM OLD."credentialFingerprint" OR NEW."inputSnapshot" IS DISTINCT FROM OLD."inputSnapshot" OR NEW."createdAt" <> OLD."createdAt"
      OR (OLD."originalJobId" IS NOT NULL AND NEW."originalJobId" IS DISTINCT FROM OLD."originalJobId")
      OR (NEW."userId" IS DISTINCT FROM OLD."userId" AND NOT (OLD."userId" IS NOT NULL AND NEW."userId" IS NULL))
      OR (NEW."liveJobId" IS DISTINCT FROM OLD."liveJobId" AND OLD."liveJobId" IS NOT NULL AND NEW."liveJobId" IS NOT NULL)
      THEN PERFORM canvas_raise('CANVAS_INVENTORY_IMMUTABLE'); END IF;
    IF OLD.state <> 'PREPARING' AND (NEW.state <> OLD.state OR NEW."preparationToken" <> OLD."preparationToken" OR NEW."preparationExpiresAt" <> OLD."preparationExpiresAt" OR NEW."originalJobId" IS DISTINCT FROM OLD."originalJobId" OR (OLD."liveJobId" IS NULL AND NEW."liveJobId" IS NOT NULL)) THEN PERFORM canvas_raise('CANVAS_INVENTORY_IMMUTABLE'); END IF;
    IF OLD.state = 'PREPARING' AND NEW.state IN ('COMMITTED','REJECTED') AND (OLD."preparationExpiresAt" <= v_now OR NEW."preparationToken" <> OLD."preparationToken") THEN PERFORM canvas_raise('CANVAS_LEASE_LOST'); END IF;
    IF OLD.state = 'PREPARING' AND NEW.state = 'PREPARING' AND NEW."preparationToken" <> OLD."preparationToken" THEN
      IF OLD."preparationExpiresAt" > v_now THEN PERFORM canvas_raise('CANVAS_NODE_BUSY'); END IF;
      refreshing := true;
    ELSIF NEW."preparationExpiresAt" <> OLD."preparationExpiresAt" THEN PERFORM canvas_raise('CANVAS_LEASE_LOST'); END IF;
  ELSE
    IF NEW."userId" IS DISTINCT FROM NEW."ownerId" OR NEW.state <> 'PREPARING' OR NEW."originalJobId" IS NOT NULL OR NEW."liveJobId" IS NOT NULL THEN PERFORM canvas_raise('CANVAS_INVALID_INPUT'); END IF;
    refreshing := true;
  END IF;
  IF TG_OP = 'INSERT' OR (TG_OP = 'UPDATE' AND OLD.state = 'PREPARING' AND (NEW.state = 'COMMITTED' OR NEW."preparationToken" <> OLD."preparationToken")) THEN
    PERFORM 1 FROM "Canvas" WHERE id = NEW."canvasId" AND "ownerId" = NEW."ownerId" AND "userId" IS NOT NULL AND "deletedAt" IS NULL FOR UPDATE;
    IF NOT FOUND THEN PERFORM canvas_raise('CANVAS_NOT_FOUND'); END IF;
    v_now := date_trunc('milliseconds', clock_timestamp());
    IF refreshing THEN NEW."preparationExpiresAt" := v_now + interval '120 seconds'; END IF;
    IF TG_OP = 'INSERT' THEN NEW."createdAt" := v_now; END IF;
    IF EXISTS (SELECT 1 FROM "CanvasRun" AS r LEFT JOIN "GenerationJob" AS j ON j.id = r."liveJobId" WHERE r."canvasId" = NEW."canvasId" AND r."nodeId" = NEW."nodeId" AND r."runId" <> NEW."runId" AND ((r.state = 'PREPARING' AND r."preparationExpiresAt" > clock_timestamp()) OR (r.state = 'COMMITTED' AND j.status IN ('PENDING','PROCESSING')))) THEN PERFORM canvas_raise('CANVAS_NODE_BUSY'); END IF;
    PERFORM canvas_assert_run_snapshot(NEW."inputSnapshot");
    IF (NEW."inputSnapshot"->>'canvasId')::UUID <> NEW."canvasId" OR (NEW."inputSnapshot"->>'nodeId')::UUID <> NEW."nodeId" OR (NEW."inputSnapshot"->>'runId')::UUID <> NEW."runId" THEN PERFORM canvas_raise('CANVAS_ORIGIN_MISMATCH'); END IF;
    SELECT COALESCE(array_agg(value->>'assetId' ORDER BY value->>'assetId'), ARRAY[]::TEXT[]) INTO refs FROM jsonb_array_elements(NEW."inputSnapshot"->'input'->'references') WHERE value->>'kind' = 'imported';
    PERFORM canvas_lock_assets(NEW."ownerId", refs);
    -- The fence must still be valid AFTER blocking on all input locks.
    v_now := clock_timestamp();
    IF NEW."preparationExpiresAt" <= v_now THEN PERFORM canvas_raise('CANVAS_LEASE_LOST'); END IF;
    IF (SELECT COALESCE(sum("byteLength"), 0) FROM "CanvasImportAsset" WHERE id = ANY(refs)) > 33554432 THEN PERFORM canvas_raise('CANVAS_LIMIT_EXCEEDED'); END IF;
    IF NEW.state = 'PREPARING' THEN
      UPDATE "CanvasImportAsset" SET "preparationExpiresAt" = GREATEST("preparationExpiresAt", NEW."preparationExpiresAt") WHERE id = ANY(refs);
    END IF;
    IF EXISTS (SELECT 1 FROM jsonb_array_elements(NEW."inputSnapshot"->'input'->'references') AS ref WHERE ref->>'kind' = 'result' AND NOT EXISTS (SELECT 1 FROM "GenerationImage" AS i JOIN "GenerationJob" AS j ON j.id = i."jobId" WHERE i.id = ref->>'imageId' AND j.id = ref->>'jobId' AND j."userId" = NEW."ownerId" AND j.status = 'SUCCEEDED' AND length(i.url) > 0)) THEN PERFORM canvas_raise('CANVAS_INPUT_UNAVAILABLE'); END IF;
  END IF;
  IF NEW.state = 'COMMITTED' AND (TG_OP = 'INSERT' OR OLD.state <> 'COMMITTED') THEN
    IF NEW."originalJobId" IS NULL OR NEW."liveJobId" IS DISTINCT FROM NEW."originalJobId" OR NOT EXISTS (SELECT 1 FROM "GenerationJob" WHERE id = NEW."originalJobId" AND "userId" = NEW."ownerId") THEN PERFORM canvas_raise('CANVAS_ORIGIN_MISMATCH'); END IF;
    NEW."committedAt" := v_now;
  ELSIF NEW.state = 'REJECTED' AND (TG_OP = 'INSERT' OR OLD.state <> 'REJECTED') THEN NEW."rejectedAt" := v_now; END IF;
  NEW."updatedAt" := v_now; RETURN NEW;
END;
$$;
CREATE TRIGGER "CanvasRun_lifecycle_guard" BEFORE INSERT OR UPDATE OR DELETE ON "CanvasRun" FOR EACH ROW EXECUTE FUNCTION canvas_guard_run();

CREATE FUNCTION canvas_guard_job_asset_use() RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE run_row "CanvasRun"%ROWTYPE; ref JSONB;
BEGIN
  IF TG_OP = 'DELETE' THEN PERFORM canvas_raise('CANVAS_INVENTORY_IMMUTABLE'); END IF;
  IF TG_OP = 'UPDATE' THEN
    IF NEW.id <> OLD.id OR NEW."ownerId" <> OLD."ownerId" OR NEW."runId" <> OLD."runId" OR NEW."assetId" <> OLD."assetId" OR NEW."originalJobId" <> OLD."originalJobId" OR NEW.ordinal <> OLD.ordinal OR NEW."createdAt" <> OLD."createdAt" OR (NEW."liveJobId" IS DISTINCT FROM OLD."liveJobId" AND NOT (OLD."liveJobId" IS NOT NULL AND NEW."liveJobId" IS NULL)) THEN PERFORM canvas_raise('CANVAS_INVENTORY_IMMUTABLE'); END IF;
    RETURN NEW;
  END IF;
  SELECT * INTO run_row FROM "CanvasRun" WHERE id = NEW."runId" AND "ownerId" = NEW."ownerId";
  IF NOT FOUND THEN PERFORM canvas_raise('CANVAS_ORIGIN_MISMATCH'); END IF;
  PERFORM 1 FROM "Canvas" WHERE id = run_row."canvasId" AND "deletedAt" IS NULL FOR UPDATE;
  IF NOT FOUND THEN PERFORM canvas_raise('CANVAS_NOT_FOUND'); END IF;
  PERFORM 1 FROM "CanvasRun" WHERE id = NEW."runId" FOR UPDATE;
  SELECT * INTO run_row FROM "CanvasRun" WHERE id = NEW."runId" AND "ownerId" = NEW."ownerId";
  SELECT value INTO ref FROM jsonb_array_elements(run_row."inputSnapshot"->'input'->'references') WHERE (value->>'ordinal')::INTEGER = NEW.ordinal;
  IF run_row.state <> 'COMMITTED' OR run_row."originalJobId" IS DISTINCT FROM NEW."originalJobId" OR NEW."liveJobId" IS DISTINCT FROM run_row."liveJobId" OR ref->>'kind' IS DISTINCT FROM 'imported' OR ref->>'assetId' IS DISTINCT FROM NEW."assetId" THEN PERFORM canvas_raise('CANVAS_ORIGIN_MISMATCH'); END IF;
  PERFORM canvas_lock_assets(NEW."ownerId", ARRAY[NEW."assetId"]);
  NEW."createdAt" := clock_timestamp(); RETURN NEW;
END;
$$;
CREATE TRIGGER "CanvasJobAssetUse_immutable_guard" BEFORE INSERT OR UPDATE OR DELETE ON "CanvasJobAssetUse" FOR EACH ROW EXECUTE FUNCTION canvas_guard_job_asset_use();
CREATE TRIGGER "CanvasJobAssetUse_detach_guard" AFTER INSERT ON "CanvasJobAssetUse" FOR EACH ROW EXECUTE FUNCTION canvas_refresh_asset_detach();

CREATE FUNCTION canvas_check_committed_roots() RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE run_row "CanvasRun"%ROWTYPE;
BEGIN
  SELECT * INTO run_row FROM "CanvasRun" WHERE id = NEW.id;
  IF run_row.state = 'COMMITTED' AND EXISTS (SELECT 1 FROM jsonb_array_elements(run_row."inputSnapshot"->'input'->'references') AS ref WHERE ref->>'kind' = 'imported' AND NOT EXISTS (SELECT 1 FROM "CanvasJobAssetUse" WHERE "runId" = run_row.id AND "ownerId" = run_row."ownerId" AND "assetId" = ref->>'assetId' AND ordinal = (ref->>'ordinal')::INTEGER AND "originalJobId" = run_row."originalJobId")) THEN PERFORM canvas_raise('CANVAS_ORIGIN_MISMATCH'); END IF;
  RETURN NULL;
END;
$$;
CREATE CONSTRAINT TRIGGER "CanvasRun_committed_roots_guard" AFTER INSERT OR UPDATE ON "CanvasRun" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION canvas_check_committed_roots();

CREATE FUNCTION canvas_check_saved_roots() RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE document "Canvas"%ROWTYPE; document_id UUID;
BEGIN
  IF TG_TABLE_NAME = 'Canvas' THEN document_id := NEW.id;
  ELSIF TG_OP = 'DELETE' THEN document_id := OLD."canvasId";
  ELSE document_id := NEW."canvasId"; END IF;
  SELECT * INTO document FROM "Canvas" WHERE id = document_id;
  IF EXISTS (SELECT 1 FROM "CanvasSavedAssetUse" AS u WHERE u."canvasId" = document.id AND (document.scene IS NULL OR NOT EXISTS (SELECT 1 FROM jsonb_array_elements(document.scene->'nodes') AS n WHERE n->>'kind' = 'reference' AND n->'source'->>'assetId' = u."assetId")))
    OR (document.scene IS NOT NULL AND EXISTS (SELECT 1 FROM jsonb_array_elements(document.scene->'nodes') AS n WHERE n->>'kind' = 'reference' AND NOT EXISTS (SELECT 1 FROM "CanvasSavedAssetUse" WHERE "canvasId" = document.id AND "assetId" = n->'source'->>'assetId' AND "ownerId" = document."ownerId")))
    THEN PERFORM canvas_raise('CANVAS_ORIGIN_MISMATCH'); END IF;
  RETURN NULL;
END;
$$;
CREATE CONSTRAINT TRIGGER "Canvas_saved_roots_guard" AFTER INSERT OR UPDATE ON "Canvas" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION canvas_check_saved_roots();
CREATE CONSTRAINT TRIGGER "CanvasSavedAssetUse_snapshot_guard" AFTER INSERT OR DELETE ON "CanvasSavedAssetUse" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION canvas_check_saved_roots();

CREATE FUNCTION canvas_validate_scene_resources(p_owner TEXT, p_canvas UUID, p_scene JSONB) RETURNS VOID LANGUAGE plpgsql AS $$
DECLARE node JSONB; edge JSONB; binding JSONB; output JSONB;
BEGIN
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

CREATE FUNCTION canvas_save_snapshot(p_owner TEXT, p_canvas UUID, p_expected_revision INTEGER, p_save_id UUID, p_scene JSONB, p_scene_hash TEXT)
RETURNS TABLE("acknowledgedRevision" INTEGER, "currentRevision" INTEGER, "sceneHash" TEXT, replayed BOOLEAN) LANGUAGE plpgsql AS $$
DECLARE document "Canvas"%ROWTYPE; new_assets TEXT[]; affected_assets TEXT[];
BEGIN
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

CREATE FUNCTION canvas_delete_document(p_owner TEXT, p_canvas UUID, p_expected_revision INTEGER) RETURNS INTEGER LANGUAGE plpgsql AS $$
DECLARE document "Canvas"%ROWTYPE; asset_ids TEXT[];
BEGIN
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

-- The terminal fast path precedes tombstone/media/current-balance checks. A
-- committed original identity is never replaced, including after job deletion.
CREATE FUNCTION canvas_reserve_run(p_owner TEXT, p_canvas UUID, p_node UUID, p_run UUID, p_intent_hash TEXT, p_snapshot JSONB, p_credential_fingerprint TEXT DEFAULT NULL)
RETURNS TABLE(id TEXT, state "CanvasRunState", "preparationToken" UUID, "preparationExpiresAt" TIMESTAMPTZ, "originalJobId" TEXT, "liveJobId" TEXT, replayed BOOLEAN) LANGUAGE plpgsql AS $$
DECLARE run_row "CanvasRun"%ROWTYPE;
BEGIN
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

CREATE FUNCTION canvas_commit_run(p_owner TEXT, p_run UUID, p_preparation_token UUID, p_job_id TEXT) RETURNS TEXT LANGUAGE plpgsql AS $$
DECLARE run_row "CanvasRun"%ROWTYPE; assets TEXT[];
BEGIN
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

CREATE FUNCTION canvas_reject_run(p_owner TEXT, p_run UUID, p_preparation_token UUID, p_error_code TEXT) RETURNS BOOLEAN LANGUAGE plpgsql AS $$
BEGIN
  IF p_error_code IS NULL OR p_error_code !~ '^CANVAS_[A-Z_]+$' THEN PERFORM canvas_raise('CANVAS_INVALID_INPUT'); END IF;
  UPDATE "CanvasRun" SET state = 'REJECTED', "rejectionCode" = p_error_code WHERE "ownerId" = p_owner AND "runId" = p_run AND state = 'PREPARING' AND "preparationToken" = p_preparation_token AND "preparationExpiresAt" > clock_timestamp();
  RETURN FOUND;
END;
$$;

CREATE FUNCTION canvas_acquire_gc_lease(p_token UUID) RETURNS BOOLEAN LANGUAGE plpgsql AS $$
BEGIN
  IF p_token IS NULL THEN PERFORM canvas_raise('CANVAS_INVALID_INPUT'); END IF;
  UPDATE "CanvasGcLease" SET token = p_token, "expiresAt" = clock_timestamp() + interval '90 seconds', "updatedAt" = clock_timestamp()
    WHERE id = 'canvas-imports' AND (token IS NULL OR "expiresAt" <= clock_timestamp() OR token = p_token);
  RETURN FOUND;
END;
$$;

CREATE FUNCTION canvas_claim_imports(p_sweep_token UUID, p_storage_location TEXT, p_limit INTEGER DEFAULT 20) RETURNS SETOF "CanvasImportAsset" LANGUAGE plpgsql AS $$
DECLARE asset "CanvasImportAsset"%ROWTYPE; v_now TIMESTAMPTZ;
BEGIN
  IF p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 100 THEN PERFORM canvas_raise('CANVAS_LIMIT_EXCEEDED'); END IF;
  IF p_storage_location IS NULL OR length(p_storage_location) NOT BETWEEN 1 AND 128 THEN PERFORM canvas_raise('CANVAS_INVALID_INPUT'); END IF;
  PERFORM 1 FROM "CanvasGcLease" WHERE id = 'canvas-imports' AND token = p_sweep_token AND "expiresAt" > clock_timestamp() FOR UPDATE;
  IF NOT FOUND THEN PERFORM canvas_raise('CANVAS_LEASE_LOST'); END IF;
  -- Expired single-PUT reservations are quarantined, never leased to a second PUT.
  FOR asset IN SELECT * FROM "CanvasImportAsset" WHERE state = 'UPLOADING' AND "uploadExpiresAt" <= clock_timestamp() ORDER BY id LIMIT p_limit FOR UPDATE SKIP LOCKED LOOP
    UPDATE "CanvasImportAsset" SET state = 'QUARANTINED', "putOutcome" = CASE WHEN "putOutcome" = 'NOT_STARTED' THEN 'UNKNOWN'::"CanvasPutOutcome" ELSE "putOutcome" END WHERE id = asset.id;
  END LOOP;
  FOR asset IN SELECT * FROM "CanvasImportAsset" AS a WHERE a.kind = 'IMPORT' AND a."storageLocation" = p_storage_location AND a."storageVersionId" IS NULL
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

CREATE FUNCTION canvas_finish_asset_delete(p_asset_id TEXT, p_delete_token UUID, p_outcome "CanvasDeleteOutcome", p_error_code TEXT DEFAULT NULL) RETURNS BOOLEAN LANGUAGE plpgsql AS $$
DECLARE asset "CanvasImportAsset"%ROWTYPE; v_now TIMESTAMPTZ; backoff INTEGER;
BEGIN
  SELECT * INTO asset FROM "CanvasImportAsset" WHERE id = p_asset_id FOR UPDATE;
  v_now := clock_timestamp();
  IF NOT FOUND OR asset.state NOT IN ('DELETING','DELETED') OR asset."storageVersionId" IS NOT NULL OR asset."deleteToken" IS DISTINCT FROM p_delete_token OR asset."deleteExpiresAt" <= v_now THEN RETURN false; END IF;
  IF p_outcome IN ('DELETED','MISSING') THEN
    UPDATE "CanvasImportAsset" SET state = 'DELETED', "deleteOutcome" = p_outcome, "deleteExpiresAt" = v_now, "physicalBytesAccounted" = ("putOutcome" = 'UNKNOWN'), "needsReconciliation" = ("putOutcome" = 'UNKNOWN'), "nextDeleteAt" = CASE WHEN "putOutcome" = 'UNKNOWN' THEN v_now + interval '86400 seconds' ELSE NULL END, "lastStorageErrorCode" = NULL WHERE id = p_asset_id;
  ELSIF p_outcome IN ('FAILED','UNKNOWN') THEN
    backoff := LEAST(3600, (10 * power(2, LEAST(asset."deleteAttempts" - 1, 8)))::INTEGER);
    UPDATE "CanvasImportAsset" SET "deleteOutcome" = p_outcome, "deleteExpiresAt" = v_now, "nextDeleteAt" = v_now + make_interval(secs => backoff), "lastStorageErrorCode" = p_error_code WHERE id = p_asset_id;
  ELSE PERFORM canvas_raise('CANVAS_INVALID_INPUT'); END IF;
  RETURN true;
END;
$$;

ALTER TABLE "Canvas" ADD CONSTRAINT "Canvas_revision_check" CHECK (revision >= 0 AND revision < 2147483647);
ALTER TABLE "Canvas" ADD CONSTRAINT "Canvas_receipt_check" CHECK ((scene IS NULL AND "lastSaveId" IS NULL AND "lastSaveHash" IS NULL AND "lastSaveRevision" IS NULL AND "lastSavedAt" IS NULL) OR (scene IS NOT NULL AND "deletedAt" IS NULL AND "lastSaveId" IS NOT NULL AND "lastSaveHash" IS NOT NULL AND "lastSaveHash" ~ '^[a-f0-9]{64}$' AND "lastSaveRevision" IS NOT NULL AND "lastSaveRevision" > 0 AND "lastSaveRevision" <= revision AND "lastSavedAt" IS NOT NULL));
ALTER TABLE "CanvasImportAsset" ADD CONSTRAINT "CanvasImportAsset_verified_payload_check" CHECK (kind = 'IMPORT' AND "byteLength" BETWEEN 1 AND 8388608 AND sha256 ~ '^[a-f0-9]{64}$' AND "mimeType" IN ('image/png','image/jpeg','image/webp') AND length("storageLocation") > 0 AND length("storageEndpoint") > 0 AND length("storageRegion") > 0 AND length("storageBucket") > 0 AND length("storageKey") > 0);
ALTER TABLE "CanvasImportAsset" ADD CONSTRAINT "CanvasImportAsset_ready_check" CHECK (state <> 'READY' OR ("readyAt" IS NOT NULL AND "putOutcome" = 'CONFIRMED' AND "storageVersionId" IS NULL));
ALTER TABLE "CanvasImportAsset" ADD CONSTRAINT "CanvasImportAsset_delete_fence_check" CHECK (state NOT IN ('DELETING','DELETED') OR ("deleteToken" IS NOT NULL AND "deleteExpiresAt" IS NOT NULL AND "deleteAttempts" > 0));
ALTER TABLE "CanvasImportAsset" ADD CONSTRAINT "CanvasImportAsset_accounting_check" CHECK ("physicalBytesAccounted" OR (state = 'DELETED' AND "putOutcome" <> 'UNKNOWN' AND "deleteOutcome" IN ('DELETED','MISSING')));
ALTER TABLE "CanvasRun" ADD CONSTRAINT "CanvasRun_intent_check" CHECK ("intentHash" ~ '^[a-f0-9]{64}$' AND ("credentialFingerprint" IS NULL OR "credentialFingerprint" ~ '^[a-f0-9]{64}$'));
ALTER TABLE "CanvasRun" ADD CONSTRAINT "CanvasRun_state_check" CHECK ((state = 'PREPARING' AND "originalJobId" IS NULL AND "liveJobId" IS NULL AND "committedAt" IS NULL AND "rejectedAt" IS NULL) OR (state = 'COMMITTED' AND "originalJobId" IS NOT NULL AND "committedAt" IS NOT NULL AND "rejectedAt" IS NULL) OR (state = 'REJECTED' AND "originalJobId" IS NULL AND "liveJobId" IS NULL AND "rejectionCode" IS NOT NULL AND "rejectedAt" IS NOT NULL));
ALTER TABLE "CanvasRun" ADD CONSTRAINT "CanvasRun_rejection_code_check" CHECK ("rejectionCode" IS NULL OR "rejectionCode" ~ '^CANVAS_[A-Z_]+$');
ALTER TABLE "CanvasImportAsset" ADD CONSTRAINT "CanvasImportAsset_last_error_check" CHECK ("lastStorageErrorCode" IS NULL OR "lastStorageErrorCode" ~ '^CANVAS_[A-Z_]+$');
ALTER TABLE "CanvasJobAssetUse" ADD CONSTRAINT "CanvasJobAssetUse_ordinal_check" CHECK (ordinal BETWEEN 1 AND 16);
ALTER TABLE "CanvasGcLease" ADD CONSTRAINT "CanvasGcLease_singleton_check" CHECK (id = 'canvas-imports' AND ((token IS NULL AND "expiresAt" IS NULL) OR (token IS NOT NULL AND "expiresAt" IS NOT NULL)));
INSERT INTO "CanvasGcLease" (id) VALUES ('canvas-imports');
