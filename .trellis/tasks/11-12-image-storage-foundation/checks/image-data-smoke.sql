-- Execute ONLY in the root-owned disposable PostgreSQL, after all migrations.
-- All fixture changes roll back, including intentionally lowered policy limits.
BEGIN;
DO $$
DECLARE r JSONB; t JSONB; again JSONB; receipt JSONB; usage JSONB; loc JSONB;
  asset_id UUID; object_id UUID; token UUID; ids UUID[] := ARRAY[]::uuid[]; tokens UUID[] := ARRAY[]::uuid[];
  i INTEGER; message TEXT; foreign_owner TEXT := 'image-smoke-other';
BEGIN
  usage := image_get_usage();
  IF (usage->>'usedBytes')::bigint <> 0 OR (usage->>'reservedBytes')::bigint <> 0 OR (usage->'policy'->>'enabled')::boolean THEN RAISE EXCEPTION 'smoke requires a fresh disabled image policy'; END IF;
  -- More than 2 GiB remains precise even while cleanup is disabled.
  FOR i IN 1..11 LOOP
    r := image_reserve_write(jsonb_build_object('ownerId','image-smoke-owner','intentKey','budget:' || i,'kind','OUTPUT','slotBytes',jsonb_build_array('52428800','52428800','52428800','52428800')));
    ids := array_append(ids,(r->>'id')::uuid); tokens := array_append(tokens,(r->>'token')::uuid);
  END LOOP;
  usage := image_get_usage();
  IF usage->>'reservedBytes' <> '2306867200' THEN RAISE EXCEPTION 'bigint budget lost precision: %',usage; END IF;
  FOR i IN 1..11 LOOP PERFORM image_close_reservation(jsonb_build_object('reservationId',ids[i],'token',tokens[i])); END LOOP;
  UPDATE "ImageStoragePolicy" SET "limitBytes" = 10 WHERE scope = 'images';
  BEGIN
    PERFORM image_reserve_write('{"ownerId":"image-smoke-owner","intentKey":"too-large","kind":"INPUT","slotBytes":["11"]}'::jsonb);
    RAISE EXCEPTION 'quota bypassed with cleanup disabled';
  EXCEPTION WHEN check_violation THEN GET STACKED DIAGNOSTICS message = MESSAGE_TEXT; IF message <> 'IMAGE_QUOTA_EXCEEDED' THEN RAISE; END IF; END;
  loc := image_register_location('{"id":"local-v1:00112233-4455-4677-8899-aabbccddeeff","provider":"LOCAL","volumeId":"00112233-4455-4677-8899-aabbccddeeff"}'::jsonb);
  r := image_reserve_write('{"ownerId":"image-smoke-owner","intentKey":"one-object","kind":"INPUT","slotBytes":["10"]}'::jsonb);
  again := image_reserve_write('{"ownerId":"image-smoke-owner","intentKey":"one-object","kind":"INPUT","slotBytes":["10"]}'::jsonb);
  IF r->>'id' <> again->>'id' THEN RAISE EXCEPTION 'reserve replay created a second budget'; END IF;
  t := image_begin_object(jsonb_build_object('reservationId',r->>'id','token',r->>'token','slot',0,'locationId',loc->>'id','key','reference/image.png','byteLength','10','mimeType','image/png','sha256',repeat('a',64),'purpose','REFERENCE'));
  again := image_begin_object(jsonb_build_object('reservationId',r->>'id','token',r->>'token','slot',0,'locationId',loc->>'id','key','reference/image.png','byteLength','10','mimeType','image/png','sha256',repeat('a',64),'purpose','REFERENCE'));
  IF NOT (t->>'writeGranted')::boolean OR (again->>'writeGranted')::boolean THEN RAISE EXCEPTION 'slot granted physical IO twice'; END IF;
  usage := image_get_usage();
  IF usage->>'usedBytes' <> '10' OR usage->>'reservedBytes' <> '0' THEN RAISE EXCEPTION 'slot conversion double counted: %',usage; END IF;
  asset_id := (t->'asset'->>'id')::uuid; object_id := (t->'object'->>'id')::uuid; token := (t->'object'->>'writeToken')::uuid;
  receipt := image_finish_object(jsonb_build_object('objectId',object_id,'writeToken',token,'outcome','CONFIRMED'));
  IF NOT (receipt->>'accepted')::boolean OR receipt->'asset'->>'state' <> 'AVAILABLE' THEN RAISE EXCEPTION 'confirmed object not available'; END IF;
  PERFORM image_register_alias(jsonb_build_object('assetId',asset_id,'url','https://images.example.test/shared-smoke.png'));
  IF image_resolve_url('https://images.example.test/shared-smoke.png',foreign_owner) IS NOT NULL OR image_resolve_url('https://images.example.test/shared-smoke.png',NULL) IS NULL THEN RAISE EXCEPTION 'owner projection/explicit shared lookup mismatch'; END IF;
  PERFORM image_replace_references(jsonb_build_object('ownerId',foreign_owner,'kind','JOB_INPUT','referenceKey','job:shared','assetIds',jsonb_build_array(asset_id)));
  PERFORM image_replace_references(jsonb_build_object('ownerId',foreign_owner,'kind','JOB_INPUT','referenceKey','job:shared','assetIds','[]'::jsonb));
  IF NOT EXISTS (SELECT 1 FROM "ImageReference" WHERE "assetId" = asset_id AND permanent) THEN RAISE EXCEPTION 'completed/deleted input root was removed'; END IF;
  BEGIN
    UPDATE "ImageAsset" SET state = 'DELETING' WHERE id = asset_id;
    RAISE EXCEPTION 'referenced asset could enter deletion';
  EXCEPTION WHEN check_violation THEN GET STACKED DIAGNOSTICS message = MESSAGE_TEXT; IF message <> 'IMAGE_REFERENCE_CONFLICT' THEN RAISE; END IF; END;
  BEGIN
    UPDATE "ImageObject" SET state = 'DELETING' WHERE id = object_id;
    RAISE EXCEPTION 'active replica could bypass logical protection';
  EXCEPTION WHEN check_violation THEN GET STACKED DIAGNOSTICS message = MESSAGE_TEXT; IF message <> 'IMAGE_REFERENCE_CONFLICT' THEN RAISE; END IF; END;
  UPDATE "ImageStoragePolicy" SET "limitBytes" = 20 WHERE scope = 'images';
  r := image_reserve_write('{"ownerId":"image-smoke-owner","intentKey":"uncertain-object","kind":"INPUT","slotBytes":["10"]}'::jsonb);
  t := image_begin_object(jsonb_build_object('reservationId',r->>'id','token',r->>'token','slot',0,'locationId',loc->>'id','key','reference/uncertain.png','byteLength','10','mimeType','image/png','sha256',repeat('b',64),'purpose','REFERENCE'));
  receipt := image_finish_object(jsonb_build_object('objectId',t->'object'->>'id','writeToken',t->'object'->>'writeToken','outcome','UNKNOWN'));
  receipt := image_finish_object(jsonb_build_object('objectId',t->'object'->>'id','writeToken',t->'object'->>'writeToken','outcome','CONFIRMED'));
  IF (receipt->>'accepted')::boolean OR receipt->'object'->>'putOutcome' <> 'UNKNOWN' THEN RAISE EXCEPTION 'late confirmation reopened unknown write'; END IF;
  PERFORM image_close_reservation(jsonb_build_object('reservationId',r->>'id','token',r->>'token'));
  usage := image_get_usage();
  IF usage->>'usedBytes' <> '20' OR usage->>'reservedBytes' <> '0' THEN RAISE EXCEPTION 'unknown bytes were released'; END IF;
END;
$$;
SET CONSTRAINTS ALL IMMEDIATE;
ROLLBACK;
