package worker

import (
	"context"
	"crypto/md5"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"reflect"
	"regexp"
	"strings"
	"testing"
)

func cloneCanvasCatalogRows(rows []CanvasSchemaCatalogRow) []CanvasSchemaCatalogRow {
	cloned := make([]CanvasSchemaCatalogRow, len(rows))
	for index, row := range rows {
		cloned[index] = row
		cloned[index].Definition = append(json.RawMessage(nil), row.Definition...)
	}
	return cloned
}

func changeCanvasCatalogDefinition(t *testing.T, rows []CanvasSchemaCatalogRow, kind, name, key string, value any) {
	t.Helper()
	for index, row := range rows {
		if row.Kind != kind || row.Name != name {
			continue
		}
		var definition map[string]any
		if err := json.Unmarshal(row.Definition, &definition); err != nil {
			t.Fatal(err)
		}
		definition[key] = value
		encoded, err := json.Marshal(definition)
		if err != nil {
			t.Fatal(err)
		}
		rows[index].Definition = encoded
		return
	}
	t.Fatalf("catalog object %s:%s not found", kind, name)
}

func requireCanvasSchemaIssue(t *testing.T, report SchemaContractReport, kind, name, reason string) {
	t.Helper()
	if report.Ready() || report.ContractVersion != 1 {
		t.Fatalf("expected unready v1 schema, got %+v", report)
	}
	for _, issue := range report.Issues {
		if issue.Kind == reason+"_"+kind && issue.Name == name && issue.Actual == reason {
			return
		}
	}
	t.Fatalf("missing %s:%s %s issue: %+v", kind, name, reason, report.Issues)
}

func TestCanvasSchemaRequiresEverySharedCatalogObject(t *testing.T) {
	contract := loadTestCanvasContract(t)
	if report := checkCanvasSchemaInventory(contract.Schema, cloneCanvasCatalogRows(contract.Schema.Objects)); !report.Ready() || report.ContractVersion != 1 {
		t.Fatalf("shared schema is not ready against itself: %+v", report)
	}
	for index, object := range contract.Schema.Objects {
		t.Run(object.Kind+"/"+object.Name, func(t *testing.T) {
			rows := cloneCanvasCatalogRows(contract.Schema.Objects)
			rows = append(rows[:index], rows[index+1:]...)
			report := checkCanvasSchemaInventory(contract.Schema, rows)
			requireCanvasSchemaIssue(t, report, object.Kind, object.Name, "missing")
			if len(report.Issues) != 1 {
				t.Fatalf("one removed object caused unrelated issues: %+v", report.Issues)
			}
		})
	}
}

func TestCanvasSchemaAllowsAdditionsButRejectsAmbiguousInventory(t *testing.T) {
	contract := loadTestCanvasContract(t)
	rows := append(cloneCanvasCatalogRows(contract.Schema.Objects), CanvasSchemaCatalogRow{Kind: "table", Name: "FutureTable", Definition: json.RawMessage(`{}`)})
	if report := checkCanvasSchemaInventory(contract.Schema, rows); !report.Ready() {
		t.Fatalf("unrelated additive table caused drift: %+v", report.Issues)
	}
	for _, kind := range []string{"table", "column", "enum", "index", "constraint", "function", "trigger"} {
		t.Run("duplicate/"+kind, func(t *testing.T) {
			for _, object := range contract.Schema.Objects {
				if object.Kind == kind {
					rows := append(cloneCanvasCatalogRows(contract.Schema.Objects), object)
					requireCanvasSchemaIssue(t, checkCanvasSchemaInventory(contract.Schema, rows), kind, object.Name, "duplicate")
					return
				}
			}
			t.Fatalf("no shared %s object", kind)
		})
	}
	for name, invalid := range map[string][]CanvasSchemaCatalogRow{
		"null":         nil,
		"missing-name": {{Kind: "table", Definition: json.RawMessage(`{}`)}},
		"missing-kind": {{Name: "Canvas", Definition: json.RawMessage(`{}`)}},
		"missing-json": {{Kind: "table", Name: "Canvas"}},
		"invalid-json": {{Kind: "table", Name: "Canvas", Definition: json.RawMessage(`broken`)}},
	} {
		t.Run(name, func(t *testing.T) {
			report := checkCanvasSchemaInventory(contract.Schema, invalid)
			if report.Ready() || len(report.Issues) != 1 || report.Issues[0].Actual != "invalid_catalog" {
				t.Fatalf("invalid catalog was not rejected: %+v", report)
			}
		})
	}
	if report := checkCanvasSchemaInventory(contract.Schema, []CanvasSchemaCatalogRow{}); report.Ready() || len(report.Issues) != len(contract.Schema.Objects) {
		t.Fatal("empty catalog did not report all missing objects")
	}
}

func TestCanvasSchemaComparesFullDefinitions(t *testing.T) {
	contract := loadTestCanvasContract(t)
	cases := []struct {
		kind  string
		name  string
		key   string
		value any
	}{
		{"table", "Canvas", "persistence", "u"},
		{"column", "CanvasRun.state", "default", "'COMMITTED'"},
		{"column", "Canvas.userId", "nullable", false},
		{"column", "Canvas.userId", "type", "character varying(128)"},
		{"column", "Canvas.revision", "default", 0},
		{"column", "Canvas.deletedAt", "default", "NULL"},
		{"index", "CanvasImportAsset_owner_upload_key", "unique", false},
		{"index", "CanvasImportAsset_gc_idx", "valid", false},
		{"index", "CanvasImportAsset_gc_idx", "ready", false},
		{"index", "CanvasImportAsset_gc_idx", "predicate", true},
		{"index", "CanvasImportAsset_owner_upload_key", "columns", []string{"uploadId", "ownerId"}},
		{"index", "CanvasImportAsset_owner_upload_key", "options", []int{0, 1}},
		{"constraint", "CanvasRun_liveJobId_fkey", "deleteAction", "c"},
		{"constraint", "CanvasRun_liveJobId_fkey", "referenceCurrentSchema", false},
		{"constraint", "CanvasRun_state_check", "expression", "true"},
		{"constraint", "CanvasRun_state_check", "validated", false},
		{"trigger", "CanvasSavedAssetUse_ready_guard", "enabled", "D"},
		{"trigger", "CanvasRun_committed_roots_guard", "deferred", false},
		{"trigger", "CanvasRun_committed_roots_guard", "functionCurrentSchema", false},
		{"trigger", "CanvasRun_committed_roots_guard", "type", 5},
		{"function", "canvas_lock_assets", "bodyMd5", strings.Repeat("0", 32)},
		{"function", "canvas_claim_imports", "securityDefiner", true},
		{"function", "canvas_lock_assets", "argumentDefaults", "false"},
		{"function", "canvas_lock_assets", "defaultCount", 0},
		{"function", "canvas_lock_assets", "argumentNames", []string{"p_owner", "p_ids", "different_parameter"}},
		{"function", "canvas_lock_assets", "arguments", []string{"text", "uuid[]", "boolean"}},
		{"function", "canvas_lock_assets", "argumentDefaults", nil},
		{"function", "canvas_raise", "argumentDefaults", "NULL"},
		{"function", "canvas_guard_document", "arguments", nil},
		{"function", "canvas_raise", "config", []string{}},
		{"function", "canvas_raise", "strict", true},
		{"function", "canvas_raise", "language", "sql"},
		{"function", "canvas_raise", "returnType", "text"},
		{"function", "canvas_raise", "returnsSet", true},
		{"function", "canvas_save_snapshot", "outputColumns", []any{map[string]any{"name": "acknowledgedRevision", "type": "bigint"}}},
	}
	for _, test := range cases {
		t.Run(test.kind+"/"+test.name+"/"+test.key, func(t *testing.T) {
			rows := cloneCanvasCatalogRows(contract.Schema.Objects)
			changeCanvasCatalogDefinition(t, rows, test.kind, test.name, test.key, test.value)
			report := checkCanvasSchemaInventory(contract.Schema, rows)
			requireCanvasSchemaIssue(t, report, test.kind, test.name, "mismatch")
		})
	}
}

func TestCanvasSchemaPreservesNullListsKeysAndEnumOrder(t *testing.T) {
	contract := loadTestCanvasContract(t)
	for _, kind := range []string{"function", "index", "column", "trigger", "constraint"} {
		t.Run("missing-field/"+kind, func(t *testing.T) {
			rows := cloneCanvasCatalogRows(contract.Schema.Objects)
			for index, row := range rows {
				if row.Kind != kind {
					continue
				}
				var definition map[string]any
				if err := json.Unmarshal(row.Definition, &definition); err != nil {
					t.Fatal(err)
				}
				for key := range definition {
					delete(definition, key)
					break
				}
				encoded, err := json.Marshal(definition)
				if err != nil {
					t.Fatal(err)
				}
				rows[index].Definition = encoded
				requireCanvasSchemaIssue(t, checkCanvasSchemaInventory(contract.Schema, rows), kind, row.Name, "mismatch")
				return
			}
		})
	}
	for _, replacement := range []string{`[]`, `null`, `["READY","UPLOADING","QUARANTINED","DELETING","DELETED"]`, `["UPLOADING","READY","QUARANTINED","DELETING","DELETED","FUTURE"]`} {
		rows := cloneCanvasCatalogRows(contract.Schema.Objects)
		for index := range rows {
			if rows[index].Kind == "enum" && rows[index].Name == "CanvasImportAssetState" {
				rows[index].Definition = json.RawMessage(replacement)
			}
		}
		requireCanvasSchemaIssue(t, checkCanvasSchemaInventory(contract.Schema, rows), "enum", "CanvasImportAssetState", "mismatch")
	}
}

func TestCanvasSchemaNormalizesOnlySupportedDeparserForms(t *testing.T) {
	contract := loadTestCanvasContract(t)
	rows := cloneCanvasCatalogRows(contract.Schema.Objects)
	changeCanvasCatalogDefinition(t, rows, "column", "CanvasImportAsset.kind", "default", "'IMPORT'::character varying")
	changeCanvasCatalogDefinition(t, rows, "column", "CanvasRun.state", "default", "'PREPARING'::\"CanvasRunState\"")
	changeCanvasCatalogDefinition(t, rows, "constraint", "CanvasJobAssetUse_ordinal_check", "expression", `((ordinal >= 1) AND (ordinal <= 16))`)
	changeCanvasCatalogDefinition(t, rows, "function", "canvas_reserve_run", "argumentDefaults", "NULL::text")
	changeCanvasCatalogDefinition(t, rows, "function", "canvas_assert_parameters", "argumentDefaults", "(FALSE), 00")
	if report := checkCanvasSchemaInventory(contract.Schema, rows); !report.Ready() {
		t.Fatalf("equivalent deparser output rejected: %+v", report.Issues)
	}
	for name, expression := range map[string]string{
		"CanvasGcLease_singleton_check":   `id = 'canvas-imports' AND (token IS NULL AND "expiresAt" IS NULL) OR (token IS NOT NULL AND "expiresAt" IS NOT NULL)`,
		"CanvasRun_intent_check":          `"intentHash" !~ '^[a-f0-9]{64}$' AND ("credentialFingerprint" IS NULL OR "credentialFingerprint" ~ '^[a-f0-9]{64}$')`,
		"CanvasJobAssetUse_ordinal_check": `ordinal::boolean::integer BETWEEN 1 AND 16`,
	} {
		rows := cloneCanvasCatalogRows(contract.Schema.Objects)
		changeCanvasCatalogDefinition(t, rows, "constraint", name, "expression", expression)
		requireCanvasSchemaIssue(t, checkCanvasSchemaInventory(contract.Schema, rows), "constraint", name, "mismatch")
	}
}

func TestCanvasSchemaSharedQueryAndSafeFailures(t *testing.T) {
	contract := loadTestCanvasContract(t)
	for _, fragment := range []string{"n.nspname=current_schema()", "md5(replace(p.prosrc,chr(13)||chr(10),chr(10)))", "pg_get_expr(p.proargdefaults,0)", "p.pronargdefaults", "p.proargnames[1:p.pronargs]"} {
		if !strings.Contains(contract.Schema.CatalogQuery, fragment) {
			t.Fatalf("catalog query omits required semantics: %s", fragment)
		}
	}
	if canvasCatalogMutation.MatchString(contract.Schema.CatalogQuery) {
		t.Fatal("canvas schema query must not write or repair")
	}
	calls := 0
	report, err := checkCanvasSchemaWithQuery(context.Background(), contract.Schema, func(ctx context.Context, query string) ([]CanvasSchemaCatalogRow, error) {
		calls++
		if ctx.Err() != nil || query != contract.Schema.CatalogQuery {
			t.Fatal("query did not use the actual shared catalog SQL")
		}
		return cloneCanvasCatalogRows(contract.Schema.Objects), nil
	})
	if err != nil || !report.Ready() || calls != 1 {
		t.Fatalf("shared catalog probe failed: %+v, %v, calls=%d", report, err, calls)
	}
	report, err = checkCanvasSchemaWithQuery(context.Background(), contract.Schema, func(context.Context, string) ([]CanvasSchemaCatalogRow, error) {
		return nil, errors.New("postgresql://private-user:private-secret@remote/private-db secret SQL")
	})
	if err == nil || report.Ready() || len(report.Issues) != 1 || report.Issues[0].Actual != "query_failed" {
		t.Fatalf("failed query reported ready: %+v, %v", report, err)
	}
	serialized := fmt.Sprintf("%+v %v", report, err)
	for _, secret := range []string{"private", "postgresql", "remote", "secret SQL"} {
		if strings.Contains(serialized, secret) {
			t.Fatalf("readiness boundary exposed driver details: %s", serialized)
		}
	}
	if report, err := checkCanvasSchemaWithQuery(context.Background(), contract.Schema, nil); err == nil || report.Ready() {
		t.Fatal("missing catalog reader passed readiness")
	}
	invalid := contract.Schema
	invalid.Version = 2
	if report, err := checkCanvasSchemaWithQuery(context.Background(), invalid, func(context.Context, string) ([]CanvasSchemaCatalogRow, error) {
		t.Fatal("an invalid contract executed a catalog query")
		return nil, nil
	}); err == nil || report.Ready() {
		t.Fatal("invalid contract passed readiness")
	}
	if report, err := CheckCanvasSchemaContract(context.Background(), nil); err == nil || report.Ready() {
		t.Fatal("nil pool passed readiness")
	}
}

func TestCanvasSchemaFunctionBodiesAndSignaturesMatchSharedMigration(t *testing.T) {
	contract := loadTestCanvasContract(t)
	root := canvasFixtureRoot(t)
	path := filepath.Join(root, "..", "..", "..", "prisma", "migrations", contract.Schema.Migration, "migration.sql")
	data, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	sql := strings.ReplaceAll(string(data), "\r\n", "\n")
	digest := sha256.Sum256([]byte(sql))
	if hex.EncodeToString(digest[:]) != contract.Schema.MigrationSHA256 {
		t.Fatal("shared migration fingerprint differs from actual unpublished SQL")
	}
	definitions := regexp.MustCompile(`(?s)CREATE FUNCTION (canvas_\w+)\((.*?)\).*? AS \$\$(.*?)\$\$;`).FindAllStringSubmatch(sql, -1)
	functions := make(map[string]canvasCatalogFunction)
	for _, object := range contract.Schema.Objects {
		if object.Kind == "function" {
			var function canvasCatalogFunction
			if err := json.Unmarshal(object.Definition, &function); err != nil {
				t.Fatal(err)
			}
			functions[object.Name] = function
		}
	}
	if len(definitions) != len(functions) || len(definitions) != 27 {
		t.Fatalf("actual SQL has %d functions, fixture has %d", len(definitions), len(functions))
	}
	for _, definition := range definitions {
		name, parameters, body := definition[1], definition[2], definition[3]
		t.Run(name, func(t *testing.T) {
			function, found := functions[name]
			if !found {
				t.Fatal("actual SQL function absent from shared inventory")
			}
			fingerprint := func(value string) string {
				digest := md5.Sum([]byte(strings.ReplaceAll(value, "\r\n", "\n")))
				return hex.EncodeToString(digest[:])
			}
			if fingerprint(body) != function.BodyMD5 || fingerprint(strings.ReplaceAll(body, "\n", "\r\n")) != function.BodyMD5 {
				t.Fatal("full body fingerprint (CRLF-to-LF only) differs from shared inventory")
			}
			if fingerprint(body+"\r") == function.BodyMD5 {
				t.Fatal("meaningful lone carriage return was discarded")
			}
			names, types, defaults := []string{}, []string{}, []string{}
			if strings.TrimSpace(parameters) != "" {
				for _, parameter := range strings.Split(parameters, ",") {
					declaration, defaultValue, hasDefault := strings.Cut(strings.TrimSpace(parameter), " DEFAULT ")
					parts := strings.Fields(declaration)
					if len(parts) < 2 {
						t.Fatalf("cannot read SQL parameter %q", parameter)
					}
					names = append(names, parts[0])
					typeName := strings.Join(parts[1:], " ")
					if !strings.HasPrefix(typeName, `"`) {
						typeName = strings.ToLower(typeName)
					}
					types = append(types, typeName)
					if hasDefault {
						defaults = append(defaults, defaultValue)
					}
				}
			}
			if !reflect.DeepEqual(function.ArgumentNames, names) || !reflect.DeepEqual(function.Arguments, types) || function.DefaultCount != len(defaults) {
				t.Fatalf("signature names/types/default count differ: %+v, names=%v types=%v defaults=%v", function, names, types, defaults)
			}
			if len(defaults) == 0 && function.ArgumentDefaults != nil {
				t.Fatal("unexpected argument defaults")
			}
			if len(defaults) > 0 && (function.ArgumentDefaults == nil || *function.ArgumentDefaults != strings.Join(defaults, ", ")) {
				t.Fatal("SQL argument defaults differ from shared inventory")
			}
		})
	}
}
