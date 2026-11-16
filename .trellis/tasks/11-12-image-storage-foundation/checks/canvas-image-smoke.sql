-- Root-owned disposable PostgreSQL only. The runner verifies its ownership
-- sentinel before loading this file. No file/S3 IO is claimed by these SQL tests.
BEGIN;
DO $$
DECLARE
  v_owner TEXT := 'canvas-image-smoke-owner'; v_canvas UUID := gen_random_uuid(); v_run UUID := gen_random_uuid();
  v_import TEXT := 'canvas-image-smoke-import'; v_upload UUID := gen_random_uuid(); v_sweep UUID := gen_random_uuid();
  v_location JSONB; v_reservation JSONB; v_ticket JSONB; v_receipt JSONB; v_scene JSONB; v_snapshot JSONB;
  v_asset UUID; v_token UUID; v_run_row RECORD; v_message TEXT; v_count INTEGER;
BEGIN
  INSERT INTO "User" (id,email,credits,"updatedAt") VALUES (v_owner,'canvas-image-smoke@example.test',100,clock_timestamp());
  INSERT INTO "Canvas" (id,"ownerId","userId",title) VALUES (v_canvas,v_owner,v_owner,'LOCAL smoke');
  v_location := image_register_location('{"id":"local-v1:11223344-5566-4788-99aa-bbccddeeff00","provider":"LOCAL","volumeId":"11223344-5566-4788-99aa-bbccddeeff00"}'::jsonb);
  v_reservation := image_reserve_write(jsonb_build_object('ownerId',v_owner,'intentKey','canvas-smoke','kind','INPUT','slotBytes',jsonb_build_array('16'),'leaseSeconds',120));
  v_ticket := image_begin_object(jsonb_build_object('reservationId',v_reservation->>'id','token',v_reservation->>'token',
    'slot',0,'locationId',v_location->>'id','key','canvas-imports/smoke.png','byteLength','16','mimeType','image/png','sha256',repeat('a',64),'purpose','CANVAS_IMPORT','originId',v_import));
  v_asset := (v_ticket->'asset'->>'id')::uuid; v_token := (v_ticket->'object'->>'writeToken')::uuid;
  INSERT INTO "CanvasImportAsset" (id,"ownerId","userId","uploadId",sha256,"byteLength","mimeType","sourceProvider","mediaAssetId",
    "storageLocation","storageKey","uploadToken","uploadExpiresAt")
    VALUES (v_import,v_owner,v_owner,v_upload,repeat('a',64),16,'image/png','LOCAL',v_asset,v_location->>'id','canvas-imports/smoke.png',v_token,clock_timestamp());
  BEGIN
    PERFORM canvas_lock_assets(v_owner, ARRAY[v_import]);
    RAISE EXCEPTION 'unfinished LOCAL input was usable';
  EXCEPTION WHEN check_violation THEN GET STACKED DIAGNOSTICS v_message = MESSAGE_TEXT; IF v_message <> 'CANVAS_INPUT_UNAVAILABLE' THEN RAISE; END IF; END;
  v_receipt := image_finish_object(jsonb_build_object('objectId',v_ticket->'object'->>'id','writeToken',v_token,'outcome','CONFIRMED'));
  IF NOT (v_receipt->>'accepted')::boolean THEN RAISE EXCEPTION 'LOCAL ledger confirmation failed'; END IF;
  UPDATE "CanvasImportAsset" SET state = 'READY', "putOutcome" = 'CONFIRMED' WHERE id = v_import;
  PERFORM canvas_lock_assets(v_owner, ARRAY[v_import]);
  IF image_get_usage()->>'usedBytes' <> '16' OR image_get_usage()->>'reservedBytes' <> '0' THEN RAISE EXCEPTION 'Canvas logical accounting was added to global physical bytes'; END IF;
  IF (SELECT sum("byteLength") FROM "CanvasImportAsset" WHERE "ownerId" = v_owner AND "physicalBytesAccounted") <> 16 THEN RAISE EXCEPTION 'Canvas owner accounting lost'; END IF;
  BEGIN
    UPDATE "CanvasImportAsset" SET "storageEndpoint" = 'https://invalid.test' WHERE id = v_import;
    RAISE EXCEPTION 'nullable immutable source tuple was mutable';
  EXCEPTION WHEN check_violation THEN GET STACKED DIAGNOSTICS v_message = MESSAGE_TEXT; IF v_message <> 'CANVAS_INVENTORY_IMMUTABLE' THEN RAISE; END IF; END;
  BEGIN
    UPDATE "CanvasImportAsset" SET "mediaAssetId" = NULL WHERE id = v_import;
    RAISE EXCEPTION 'managed association was removable';
  EXCEPTION WHEN check_violation THEN GET STACKED DIAGNOSTICS v_message = MESSAGE_TEXT; IF v_message <> 'CANVAS_INVENTORY_IMMUTABLE' THEN RAISE; END IF; END;
  BEGIN
    INSERT INTO "CanvasImportAsset" (id,"ownerId","userId","uploadId",sha256,"byteLength","mimeType","storageLocation","storageKey","uploadToken","uploadExpiresAt")
      VALUES ('bad-null-source',v_owner,v_owner,gen_random_uuid(),repeat('b',64),16,'image/png','s3-v1:missing','bad.png',gen_random_uuid(),clock_timestamp());
    RAISE EXCEPTION 'S3 null tuple bypassed provider check';
  EXCEPTION WHEN check_violation THEN NULL; END;
  v_scene := jsonb_build_object('schemaVersion',1,'nodes',jsonb_build_array(jsonb_build_object('id',gen_random_uuid(), 'kind','reference',
    'position',jsonb_build_object('x',0,'y',0),'source',jsonb_build_object('kind','imported','assetId',v_import))),
    'edges','[]'::jsonb,'viewport',jsonb_build_object('x',0,'y',0,'zoom',1),'runBindings','[]'::jsonb);
  PERFORM canvas_save_snapshot(v_owner,v_canvas,0,gen_random_uuid(),v_scene,repeat('c',64));
  IF NOT EXISTS (SELECT 1 FROM "ImageReference" WHERE "assetId" = v_asset AND kind = 'CANVAS_SAVED' AND "referenceKey" = 'canvas:' || v_canvas::text)
    THEN RAISE EXCEPTION 'saved Canvas image root missing'; END IF;
  v_snapshot := jsonb_build_object('canvasId',v_canvas,'nodeId',gen_random_uuid(),'runId',v_run,
    'input',jsonb_build_object('prompt',jsonb_build_object('sourceNodeId',gen_random_uuid(),'text','frozen'),
      'references',jsonb_build_array(jsonb_build_object('sourceNodeId',gen_random_uuid(),'ordinal',1,'kind','imported','assetId',v_import))),
    'parameters','{"providerMode":"built_in","channelId":null,"model":"gpt-image-2","size":"auto","quality":"auto","outputFormat":"png","outputCompression":null,"moderation":"auto","count":1,"negativePrompt":null,"seed":null,"generationType":"image_to_image"}'::jsonb);
  SELECT * INTO v_run_row FROM canvas_reserve_run(v_owner,v_canvas,(v_snapshot->>'nodeId')::uuid,v_run,repeat('d',64),v_snapshot);
  INSERT INTO "GenerationJob" (id,"userId","providerMode",model,prompt,size,count,"updatedAt")
    VALUES ('canvas-image-smoke-job',v_owner,'BUILT_IN','gpt-image-2','frozen','auto',1,clock_timestamp());
  PERFORM canvas_commit_run(v_owner,v_run,v_run_row."preparationToken",'canvas-image-smoke-job');
  IF NOT EXISTS (SELECT 1 FROM "ImageReference" WHERE "assetId" = v_asset AND kind = 'JOB_INPUT' AND permanent) THEN RAISE EXCEPTION 'Canvas permanent input root missing'; END IF;
  PERFORM canvas_delete_document(v_owner,v_canvas,1);
  IF EXISTS (SELECT 1 FROM "ImageReference" WHERE "assetId" = v_asset AND kind = 'CANVAS_SAVED') THEN RAISE EXCEPTION 'deleted organization kept saved root'; END IF;
  IF NOT EXISTS (SELECT 1 FROM "ImageReference" WHERE "assetId" = v_asset AND kind = 'JOB_INPUT' AND permanent) THEN RAISE EXCEPTION 'organization deletion removed permanent input'; END IF;
  BEGIN
    PERFORM canvas_acquire_gc_lease(v_sweep); RAISE EXCEPTION 'old GC acquire accepted';
  EXCEPTION WHEN check_violation THEN GET STACKED DIAGNOSTICS v_message = MESSAGE_TEXT; IF v_message <> 'CANVAS_VERSION_UNSUPPORTED' THEN RAISE; END IF; END;
  BEGIN
    PERFORM canvas_claim_imports(v_sweep,v_location->>'id',20); RAISE EXCEPTION 'old GC claim accepted';
  EXCEPTION WHEN check_violation THEN GET STACKED DIAGNOSTICS v_message = MESSAGE_TEXT; IF v_message <> 'CANVAS_VERSION_UNSUPPORTED' THEN RAISE; END IF; END;
  BEGIN
    PERFORM canvas_finish_asset_delete(v_import,v_sweep,'DELETED'); RAISE EXCEPTION 'old GC finalizer accepted';
  EXCEPTION WHEN check_violation THEN GET STACKED DIAGNOSTICS v_message = MESSAGE_TEXT; IF v_message <> 'CANVAS_VERSION_UNSUPPORTED' THEN RAISE; END IF; END;
  IF NOT canvas_acquire_gc_lease_v2(v_sweep) THEN RAISE EXCEPTION 'revision2 compatibility GC did not acquire'; END IF;
  SELECT count(*) INTO v_count FROM canvas_claim_imports_v2(v_sweep,v_location->>'id',20);
  IF v_count <> 0 OR (SELECT state FROM "CanvasImportAsset" WHERE id = v_import) <> 'READY' THEN RAISE EXCEPTION 'compatibility GC claimed managed LOCAL object'; END IF;
  IF canvas_finish_asset_delete_v2(v_import,v_sweep,'DELETED') THEN RAISE EXCEPTION 'compatibility finalizer accepted managed object'; END IF;
END;
$$;
SET CONSTRAINTS ALL IMMEDIATE;
ROLLBACK;
