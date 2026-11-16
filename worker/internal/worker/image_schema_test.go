package worker

import (
	"bytes"
	"context"
	"crypto/md5"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"regexp"
	"slices"
	"strings"
	"testing"
)

func loadTestImageSchema(t *testing.T) ImageSchemaContract {
	t.Helper()
	schema, err := LoadImageSchemaContract()
	if err != nil {
		t.Fatal(err)
	}
	return schema
}

func cloneImageSchemaRows(t *testing.T, rows []ImageSchemaCatalogRow) []ImageSchemaCatalogRow {
	t.Helper()
	encoded, err := json.Marshal(rows)
	if err != nil {
		t.Fatal(err)
	}
	var clone []ImageSchemaCatalogRow
	if err := json.Unmarshal(encoded, &clone); err != nil {
		t.Fatal(err)
	}
	return clone
}

func TestImageSchemaRequiresEntireInventory(t *testing.T) {
	schema := loadTestImageSchema(t)
	if report := checkImageSchemaInventory(schema, schema.Objects); !report.Ready || report.Code != nil || report.StorageRevision != ImageStorageRevision {
		t.Fatalf("expected complete schema ready: %+v", report)
	}
	extra := append(cloneImageSchemaRows(t, schema.Objects), ImageSchemaCatalogRow{Kind: "table", Name: "FutureTable", Definition: json.RawMessage(`{}`)})
	if report := checkImageSchemaInventory(schema, extra); !report.Ready {
		t.Fatalf("unrelated additive table rejected: %+v", report)
	}
	for _, kind := range []string{"table", "column", "enum", "index", "constraint", "function", "trigger"} {
		t.Run(kind, func(t *testing.T) {
			rows := cloneImageSchemaRows(t, schema.Objects)
			index := slices.IndexFunc(rows, func(row ImageSchemaCatalogRow) bool { return row.Kind == kind })
			if index < 0 {
				t.Fatalf("contract omits %s", kind)
			}
			name := rows[index].Name
			rows = append(rows[:index], rows[index+1:]...)
			report := checkImageSchemaInventory(schema, rows)
			if report.Ready || len(report.Issues) != 1 || report.Issues[0].Name != name || report.Issues[0].Reason != "missing" {
				t.Fatalf("omission accepted: %+v", report)
			}
		})
	}
	duplicate := append(cloneImageSchemaRows(t, schema.Objects), schema.Objects[0])
	if report := checkImageSchemaInventory(schema, duplicate); report.Ready || report.Issues[0].Reason != "duplicate" {
		t.Fatalf("duplicate/overloaded object accepted: %+v", report)
	}
}

func TestImageSchemaRejectsGuardDrift(t *testing.T) {
	schema := loadTestImageSchema(t)
	for _, change := range []struct {
		kind, name, key string
		value           any
	}{
		{"column", "ImageQuota.usedBytes", "type", "integer"},
		{"column", "ImageObject.reservationId", "nullable", false},
		{"column", "ImageStorageLocation.volumeId", "nullable", false},
		{"index", "ImageObject_physical_key", "unique", false},
		{"index", "ImageObject_slot_key", "valid", false},
		{"constraint", "ImageAsset_active_object_fkey", "deleteAction", "c"},
		{"constraint", "ImageStorageLocation_provider_check", "expression", "true"},
		{"trigger", "ImageReference_guard", "enabled", "D"},
		{"trigger", "ImageObject_reservation_balance", "deferred", false},
		{"trigger", "GenerationJob_image_inputs", "columns", []string{"prompt"}},
		{"function", "image_storage_revision", "bodyMd5", strings.Repeat("0", 32)},
		{"function", "image_account_delta", "bodyMd5", strings.Repeat("0", 32)},
		{"function", "image_finish_object", "securityDefiner", true},
		{"function", "image_get_asset", "defaultCount", 0},
		{"function", "image_begin_object", "argumentNames", []string{"different_parameter"}},
		{"column", "CanvasGcLease.token", "nullable", false},
		{"constraint", "CanvasGcLease_singleton_check", "expression", "true"},
		{"function", "canvas_claim_imports_v2", "bodyMd5", strings.Repeat("0", 32)},
		{"function", "canvas_finish_asset_delete_v2", "securityDefiner", true},
		{"trigger", "CanvasImportAsset_lifecycle_guard", "enabled", "D"},
		{"enum", "CanvasPutOutcome", "labels", []string{"CONFIRMED", "NOT_STARTED", "UNKNOWN"}},
	} {
		t.Run(change.name+"/"+change.key, func(t *testing.T) {
			rows := cloneImageSchemaRows(t, schema.Objects)
			index := slices.IndexFunc(rows, func(row ImageSchemaCatalogRow) bool { return row.Kind == change.kind && row.Name == change.name })
			if index < 0 {
				t.Fatalf("contract omits %s", change.name)
			}
			var definition map[string]any
			if err := json.Unmarshal(rows[index].Definition, &definition); err != nil {
				t.Fatal(err)
			}
			definition[change.key] = change.value
			encoded, err := json.Marshal(definition)
			if err != nil {
				t.Fatal(err)
			}
			rows[index].Definition = encoded
			report := checkImageSchemaInventory(schema, rows)
			if report.Ready || len(report.Issues) != 1 || report.Issues[0].Name != change.name || report.Issues[0].Reason != "mismatch" {
				t.Fatalf("mutation accepted: %+v", report)
			}
		})
	}
}

func TestImageSchemaMatchesMigrationBodies(t *testing.T) {
	schema := loadTestImageSchema(t)
	cwd, err := os.Getwd()
	if err != nil {
		t.Fatal(err)
	}
	executable, err := os.Executable()
	if err != nil {
		t.Fatal(err)
	}
	directory, err := imageContractRoot(cwd, executable)
	if err != nil {
		t.Fatal(err)
	}
	pattern := regexp.MustCompile(`(?s)CREATE (?:OR REPLACE )?FUNCTION ((?:image|canvas)_\w+)\((.*?)\).*? AS \$\$(.*?)\$\$;`)
	definitions := make(map[string][]string)
	for _, migration := range schema.Migrations {
		data, readErr := os.ReadFile(filepath.Join(directory, "..", "..", "..", "prisma", "migrations", migration.Name, "migration.sql"))
		if readErr != nil {
			t.Fatal(readErr)
		}
		data = bytes.ReplaceAll(data, []byte("\r\n"), []byte("\n"))
		digest := sha256.Sum256(data)
		if hex.EncodeToString(digest[:]) != migration.SHA256 {
			t.Fatalf("image schema fixture migration digest is stale: %s", migration.Name)
		}
		for _, definition := range pattern.FindAllStringSubmatch(string(data), -1) {
			definitions[definition[1]] = definition
		}
	}
	functions := make(map[string]canvasCatalogFunction)
	for _, row := range schema.Objects {
		if row.Kind != "function" {
			continue
		}
		var function canvasCatalogFunction
		if err := decodeImageSchemaJSON(row.Definition, &function); err != nil {
			t.Fatal(err)
		}
		functions[row.Name] = function
	}
	if len(functions) != len(definitions) {
		t.Fatalf("fixture functions %d != migration functions %d", len(functions), len(definitions))
	}
	for _, definition := range definitions {
		function, ok := functions[definition[1]]
		digest := md5.Sum([]byte(definition[3]))
		if !ok || function.BodyMD5 != hex.EncodeToString(digest[:]) {
			t.Fatalf("full body fingerprint differs for %s", definition[1])
		}
	}
}

func TestImageSchemaReadOnlyAndRepositoryBoundary(t *testing.T) {
	schema := loadTestImageSchema(t)
	if canvasCatalogMutation.MatchString(schema.CatalogQuery) || !strings.Contains(schema.CatalogQuery, "g.tgattr::smallint[]") {
		t.Fatal("image schema query is not a complete read-only catalogue probe")
	}
	payload, err := json.Marshal(schema.Objects)
	if err != nil {
		t.Fatal(err)
	}
	queryer := &imageTestQueryer{payload: payload}
	repository := NewImageRepository(queryer)
	if err := repository.VerifySchema(context.Background()); err != nil {
		t.Fatalf("complete schema not ready: %v", err)
	}
	if queryer.query != schema.CatalogQuery || len(queryer.args) != 0 {
		t.Fatal("repository did not execute the bundled catalogue query")
	}
	for _, name := range []string{"CanvasGcLease", "canvas_claim_imports_v2", "CanvasPutOutcome"} {
		rows := slices.DeleteFunc(cloneImageSchemaRows(t, schema.Objects), func(row ImageSchemaCatalogRow) bool { return row.Name == name })
		if len(rows) == len(schema.Objects) {
			t.Fatalf("contract omits dependent Canvas object %s", name)
		}
		queryer.payload, err = json.Marshal(rows)
		if err != nil {
			t.Fatal(err)
		}
		if err := repository.VerifySchema(context.Background()); err == nil || err.Error() != "IMAGE_STORAGE_UNAVAILABLE" {
			t.Fatalf("missing Canvas dependency %s accepted without a Canvas runtime: %v", name, err)
		}
	}
	for _, corrupt := range [][]byte{[]byte(`[]`), []byte(`null`), []byte(`[{"kind":"table"}]`)} {
		queryer.payload = corrupt
		if err := repository.VerifySchema(context.Background()); err == nil || err.Error() != "IMAGE_STORAGE_UNAVAILABLE" {
			t.Fatalf("corrupt catalogue accepted: %v", err)
		}
	}
	queryer.err = errors.New("private database credentials and SQL")
	if err := repository.VerifySchema(context.Background()); err == nil || strings.Contains(err.Error(), "private") || err.Error() != "IMAGE_STORAGE_UNAVAILABLE" {
		t.Fatalf("raw failure leaked: %v", err)
	}
	report := probeImageSchema(context.Background(), schema, func(context.Context, string) ([]byte, error) { return nil, queryer.err })
	encoded, _ := json.Marshal(report)
	if report.Ready || strings.Contains(string(encoded), "private") || report.Issues[0].Reason != "query_failed" {
		t.Fatalf("unsafe report: %s", encoded)
	}
}

func TestImageContractRootRejectsIncompleteNearerDeployment(t *testing.T) {
	workspace := t.TempDir()
	farther := filepath.Join(workspace, "contracts", "media", "v1")
	nearer := filepath.Join(workspace, "app", "contracts", "media", "v1")
	for _, directory := range []string{farther, nearer} {
		if err := os.MkdirAll(directory, 0700); err != nil {
			t.Fatal(err)
		}
	}
	if err := os.WriteFile(filepath.Join(farther, "contract.json"), []byte(`{"contract":"narra.image.storage"}`), 0600); err != nil {
		t.Fatal(err)
	}
	root, err := imageContractRoot(filepath.Join(workspace, "app"), filepath.Join(workspace, "bin", "worker"))
	if err != nil || root != nearer {
		t.Fatalf("incomplete nearer deployment fell back to unrelated artifacts: %q, %v", root, err)
	}
}
