package worker

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"io"
	"reflect"
	"strings"
)

// Media and Canvas use the same catalogue row wire shape. The media contract
// owns its required objects and does not depend on the Canvas feature flag.
type ImageSchemaCatalogRow = CanvasSchemaCatalogRow

type ImageSchemaContract struct {
	Contract        string `json:"contract"`
	Version         int    `json:"version"`
	StorageRevision int    `json:"storageRevision"`
	Migration       string `json:"migration"`
	MigrationSHA256 string `json:"migrationSha256"`
	Migrations      []struct {
		Name   string `json:"name"`
		SHA256 string `json:"sha256"`
	} `json:"migrations"`
	BodyFingerprint      string                  `json:"bodyFingerprint"`
	BodyLineEndings      string                  `json:"bodyLineEndings"`
	ExpressionComparison string                  `json:"expressionComparison"`
	CatalogQuery         string                  `json:"catalogQuery"`
	Objects              []ImageSchemaCatalogRow `json:"objects"`
}

type ImageSchemaIssue struct {
	Kind   string `json:"kind"`
	Name   string `json:"name"`
	Reason string `json:"reason"`
}

type ImageSchemaReport struct {
	Version         int                `json:"version"`
	StorageRevision int                `json:"storageRevision"`
	Ready           bool               `json:"ready"`
	Code            *string            `json:"code"`
	Issues          []ImageSchemaIssue `json:"issues"`
}

func imageSchemaReport(issues []ImageSchemaIssue) ImageSchemaReport {
	report := ImageSchemaReport{Version: 1, StorageRevision: ImageStorageRevision, Ready: len(issues) == 0, Issues: issues}
	if !report.Ready {
		code := "IMAGE_STORAGE_UNAVAILABLE"
		report.Code = &code
	}
	return report
}

func imageSchemaFailure(reason string) ImageSchemaReport {
	return imageSchemaReport([]ImageSchemaIssue{{Kind: "catalog", Name: "images", Reason: reason}})
}

func decodeImageSchemaJSON(data []byte, target any) error {
	decoder := json.NewDecoder(bytes.NewReader(data))
	decoder.DisallowUnknownFields()
	decoder.UseNumber()
	if err := decoder.Decode(target); err != nil {
		return err
	}
	if decoder.Decode(new(any)) != io.EOF {
		return errors.New("image schema contains trailing JSON")
	}
	return nil
}

func validImageSchemaRow(row ImageSchemaCatalogRow) bool {
	if row.Name == "" {
		return false
	}
	switch row.Kind {
	case "table", "column", "enum", "index", "constraint", "function", "trigger":
	default:
		return false
	}
	var definition map[string]any
	return decodeImageSchemaJSON(row.Definition, &definition) == nil && definition != nil
}

func validateImageSchemaContract(schema ImageSchemaContract) error {
	invalid := errors.New("image schema contract is unsupported or incomplete")
	if schema.Contract != "narra.image.schema" || schema.Version != ImageContractVersion || schema.StorageRevision != ImageStorageRevision ||
		schema.Migration != "20261115180000_image_history" || !imagePublicTokenPattern.MatchString(schema.MigrationSHA256) || len(schema.Migrations) < 4 ||
		schema.BodyFingerprint == "" || schema.BodyLineEndings != "CRLF_TO_LF_ONLY" || schema.ExpressionComparison != "POSTGRESQL_17_EXACT" ||
		!strings.HasPrefix(schema.CatalogQuery, "WITH ") || canvasCatalogMutation.MatchString(schema.CatalogQuery) || len(schema.Objects) == 0 {
		return invalid
	}
	last := schema.Migrations[len(schema.Migrations)-1]
	if last.Name != schema.Migration || last.SHA256 != schema.MigrationSHA256 {
		return invalid
	}
	migrationNames := make(map[string]bool)
	for _, migration := range schema.Migrations {
		if migration.Name == "" || migrationNames[migration.Name] || !imagePublicTokenPattern.MatchString(migration.SHA256) {
			return invalid
		}
		migrationNames[migration.Name] = true
	}
	seen := make(map[string]bool, len(schema.Objects))
	revisionFound := false
	for _, row := range schema.Objects {
		key := row.Kind + ":" + row.Name
		if seen[key] || !validImageSchemaRow(row) {
			return invalid
		}
		seen[key] = true
		if row.Kind == "function" && row.Name == "image_storage_revision" {
			var function canvasCatalogFunction
			if decodeImageSchemaJSON(row.Definition, &function) != nil || !canvasFunctionDefinitionValid(function) {
				return invalid
			}
			revisionFound = true
		}
	}
	if !revisionFound {
		return invalid
	}
	return nil
}

func LoadImageSchemaContract() (ImageSchemaContract, error) {
	var schema ImageSchemaContract
	data, err := readImageContractArtifact("schema.json", 2*1024*1024)
	if err != nil {
		return schema, err
	}
	if err := decodeImageSchemaJSON(data, &schema); err != nil {
		return schema, errors.New("image schema contract cannot be decoded")
	}
	return schema, validateImageSchemaContract(schema)
}

// PostgreSQL 17 deparses expressions into the exact shared fixture. Do not
// strip casts, parentheses or operators to make an unrecognised schema ready.
func sameImageSchemaDefinition(actual, expected json.RawMessage) bool {
	var left, right map[string]any
	return decodeImageSchemaJSON(actual, &left) == nil && decodeImageSchemaJSON(expected, &right) == nil && reflect.DeepEqual(left, right)
}

func checkImageSchemaInventory(schema ImageSchemaContract, rows []ImageSchemaCatalogRow) ImageSchemaReport {
	if validateImageSchemaContract(schema) != nil {
		return imageSchemaFailure("invalid_contract")
	}
	if rows == nil {
		return imageSchemaFailure("invalid_catalog")
	}
	inventory := make(map[string][]json.RawMessage, len(rows))
	for _, row := range rows {
		if !validImageSchemaRow(row) {
			return imageSchemaFailure("invalid_catalog")
		}
		key := row.Kind + ":" + row.Name
		inventory[key] = append(inventory[key], row.Definition)
	}
	issues := make([]ImageSchemaIssue, 0)
	for _, expected := range schema.Objects {
		found := inventory[expected.Kind+":"+expected.Name]
		reason := ""
		switch {
		case len(found) == 0:
			reason = "missing"
		case len(found) != 1:
			reason = "duplicate"
		case !sameImageSchemaDefinition(found[0], expected.Definition):
			reason = "mismatch"
		}
		if reason != "" {
			issues = append(issues, ImageSchemaIssue{Kind: expected.Kind, Name: expected.Name, Reason: reason})
		}
	}
	return imageSchemaReport(issues)
}

type imageSchemaQuery func(context.Context, string) ([]byte, error)

func probeImageSchema(ctx context.Context, schema ImageSchemaContract, query imageSchemaQuery) ImageSchemaReport {
	if validateImageSchemaContract(schema) != nil {
		return imageSchemaFailure("invalid_contract")
	}
	if query == nil {
		return imageSchemaFailure("query_failed")
	}
	payload, err := query(ctx, schema.CatalogQuery)
	if err != nil {
		return imageSchemaFailure("query_failed")
	}
	var rows []ImageSchemaCatalogRow
	if decodeImageSchemaJSON(payload, &rows) != nil {
		return imageSchemaFailure("invalid_catalog")
	}
	return checkImageSchemaInventory(schema, rows)
}

func (repository *ImageRepository) VerifySchema(ctx context.Context) error {
	schema, err := LoadImageSchemaContract()
	if err != nil {
		return ImageStorageError{Code: "IMAGE_STORAGE_UNAVAILABLE", Cause: err}
	}
	report := probeImageSchema(ctx, schema, func(ctx context.Context, query string) ([]byte, error) {
		if repository == nil || repository.db == nil {
			return nil, errors.New("image schema query unavailable")
		}
		var payload []byte
		err := repository.db.QueryRow(ctx, query).Scan(&payload)
		return payload, err
	})
	if !report.Ready {
		// Keep driver errors and actual database definitions out of readiness.
		return ImageStorageError{Code: "IMAGE_STORAGE_UNAVAILABLE"}
	}
	return nil
}
