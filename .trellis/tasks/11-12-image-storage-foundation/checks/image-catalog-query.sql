WITH image_tables AS (
  SELECT c.oid, c.relname, c.relkind, c.relpersistence FROM pg_catalog.pg_class AS c
  JOIN pg_catalog.pg_namespace AS n ON n.oid = c.relnamespace
  WHERE n.nspname = current_schema() AND c.relname IN ('ImageStoragePolicy','ImageQuota','ImageStorageLocation','ImageWriteReservation','ImageAsset','ImageObject','ImageReference','ImageUrlAlias','GenerationImage','GenerationJob','LoginCoverConfig','CanvasImportAsset')
), inventory AS (
  SELECT 'table'::text AS kind, t.relname::text AS name, jsonb_build_object('kind',t.relkind,'persistence',t.relpersistence) AS definition FROM image_tables AS t
  UNION ALL
  SELECT 'column', t.relname || '.' || a.attname,
    jsonb_build_object('type',format_type(a.atttypid,a.atttypmod),'nullable',NOT a.attnotnull,'default',pg_get_expr(d.adbin,d.adrelid))
  FROM image_tables AS t JOIN pg_catalog.pg_attribute AS a ON a.attrelid=t.oid
  LEFT JOIN pg_catalog.pg_attrdef AS d ON d.adrelid=t.oid AND d.adnum=a.attnum
  WHERE a.attnum>0 AND NOT a.attisdropped AND (
    left(t.relname,5)='Image'
    OR (t.relname='GenerationImage' AND a.attname IN ('id','jobId','mediaAssetId','showcaseStatus'))
    OR (t.relname='GenerationJob' AND a.attname IN ('id','userId','generationType','count','workerId','status','sourceImageUrls'))
    OR (t.relname='LoginCoverConfig' AND a.attname IN ('scope','mode','customUrl'))
    OR (t.relname='CanvasImportAsset' AND a.attname IN ('mediaAssetId','sourceProvider','storageEndpoint','storageRegion','storageBucket'))
  )
  UNION ALL
  SELECT 'index', c.relname, jsonb_build_object('table',t.relname,'unique',i.indisunique,'primary',i.indisprimary,'valid',i.indisvalid,'ready',i.indisready,'method',m.amname,
    'columns',(SELECT jsonb_agg(a.attname ORDER BY k.n) FROM unnest(i.indkey) WITH ORDINALITY AS k(attnum,n) JOIN pg_catalog.pg_attribute AS a ON a.attrelid=t.oid AND a.attnum=k.attnum WHERE k.n<=i.indnkeyatts),
    'options',to_jsonb(i.indoption::smallint[]),'expressions',pg_get_expr(i.indexprs,i.indrelid),'predicate',pg_get_expr(i.indpred,i.indrelid),'nullsNotDistinct',i.indnullsnotdistinct,'includedColumns',i.indnatts-i.indnkeyatts)
  FROM image_tables AS t JOIN pg_catalog.pg_index AS i ON i.indrelid=t.oid
  JOIN pg_catalog.pg_class AS c ON c.oid=i.indexrelid JOIN pg_catalog.pg_am AS m ON m.oid=c.relam
  WHERE left(t.relname,5)='Image' OR c.relname IN ('GenerationImage_mediaAssetId_key','CanvasImportAsset_mediaAssetId_key')
  UNION ALL
  SELECT 'constraint', c.conname, jsonb_build_object('table',t.relname,'type',c.contype,'deferrable',c.condeferrable,'deferred',c.condeferred,'validated',c.convalidated)
    || CASE WHEN c.contype='c' THEN jsonb_build_object('expression',pg_get_expr(c.conbin,c.conrelid)) ELSE jsonb_build_object('columns',(SELECT jsonb_agg(a.attname ORDER BY k.n) FROM unnest(c.conkey) WITH ORDINALITY AS k(attnum,n) JOIN pg_catalog.pg_attribute AS a ON a.attrelid=t.oid AND a.attnum=k.attnum)) END
    || CASE WHEN c.contype='f' THEN jsonb_build_object('referenceTable',r.relname,'referenceCurrentSchema',rn.nspname=current_schema(),'referenceColumns',(SELECT jsonb_agg(a.attname ORDER BY k.n) FROM unnest(c.confkey) WITH ORDINALITY AS k(attnum,n) JOIN pg_catalog.pg_attribute AS a ON a.attrelid=c.confrelid AND a.attnum=k.attnum),'deleteAction',c.confdeltype,'updateAction',c.confupdtype,'matchType',c.confmatchtype) ELSE '{}'::jsonb END
  FROM image_tables AS t JOIN pg_catalog.pg_constraint AS c ON c.conrelid=t.oid
  LEFT JOIN pg_catalog.pg_class AS r ON r.oid=c.confrelid LEFT JOIN pg_catalog.pg_namespace AS rn ON rn.oid=r.relnamespace WHERE c.contype IN ('p','u','f','c') AND (left(t.relname,5)='Image' OR c.conname IN ('GenerationImage_mediaAssetId_fkey','CanvasImportAsset_mediaAssetId_fkey'))
  UNION ALL
  SELECT 'function', p.proname, jsonb_build_object('arguments',COALESCE((SELECT jsonb_agg(format_type(v.type,NULL) ORDER BY v.n) FROM unnest(p.proargtypes::oid[]) WITH ORDINALITY AS v(type,n)),'[]'::jsonb),
    'argumentNames',COALESCE(to_jsonb(p.proargnames[1:p.pronargs]),'[]'::jsonb),'defaultCount',p.pronargdefaults,'argumentDefaults',pg_get_expr(p.proargdefaults,0),
    'returnType',format_type(p.prorettype,NULL),'returnsSet',p.proretset,'outputColumns',COALESCE((SELECT jsonb_agg(jsonb_build_object('name',p.proargnames[v.n],'type',format_type(v.type,NULL)) ORDER BY v.n) FROM unnest(p.proallargtypes) WITH ORDINALITY AS v(type,n) WHERE p.proargmodes[v.n] IN ('o','b','t')),'[]'::jsonb),
    'language',l.lanname,'volatility',p.provolatile,'securityDefiner',p.prosecdef,'strict',p.proisstrict,'config',to_jsonb(p.proconfig),'bodyMd5',md5(replace(p.prosrc,chr(13)||chr(10),chr(10))))
  FROM pg_catalog.pg_proc AS p JOIN pg_catalog.pg_namespace AS n ON n.oid=p.pronamespace JOIN pg_catalog.pg_language AS l ON l.oid=p.prolang
  WHERE n.nspname=current_schema() AND left(p.proname,6)='image_'
  UNION ALL
  SELECT 'trigger', g.tgname, jsonb_build_object('table',t.relname,'function',p.proname,'functionCurrentSchema',n.nspname=current_schema(),'type',g.tgtype,'enabled',g.tgenabled,'deferrable',g.tgdeferrable,'deferred',g.tginitdeferred,'arguments',g.tgnargs,'argumentBytes',encode(g.tgargs,'hex'),'condition',pg_get_expr(g.tgqual,g.tgrelid),'columns',COALESCE((SELECT jsonb_agg(a.attname ORDER BY k.n) FROM unnest(g.tgattr::smallint[]) WITH ORDINALITY AS k(attnum,n) JOIN pg_catalog.pg_attribute AS a ON a.attrelid=t.oid AND a.attnum=k.attnum),'[]'::jsonb))
  FROM image_tables AS t JOIN pg_catalog.pg_trigger AS g ON g.tgrelid=t.oid
  JOIN pg_catalog.pg_proc AS p ON p.oid=g.tgfoid JOIN pg_catalog.pg_namespace AS n ON n.oid=p.pronamespace WHERE NOT g.tgisinternal AND left(p.proname,6)='image_'
)
SELECT COALESCE(jsonb_agg(jsonb_build_object('kind',kind,'name',name,'definition',definition) ORDER BY kind,name),'[]'::jsonb) AS result FROM inventory;
