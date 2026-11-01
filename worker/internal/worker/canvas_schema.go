package worker

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"reflect"
	"regexp"
	"strings"

	"github.com/jackc/pgx/v5/pgxpool"
)

type CanvasSchemaContract struct {
	Contract              string                   `json:"contract"`
	Version               int                      `json:"version"`
	Migration             string                   `json:"migration"`
	MigrationSHA256       string                   `json:"migrationSha256"`
	BodyFingerprint       string                   `json:"bodyFingerprint"`
	CatalogQuery          string                   `json:"catalogQuery"`
	Objects               []CanvasSchemaCatalogRow `json:"objects"`
	ExpressionConformance string                   `json:"expressionConformance"`
	BodyLineEndings       string                   `json:"bodyLineEndings"`
}

type CanvasSchemaCatalogRow struct {
	Kind       string          `json:"kind"`
	Name       string          `json:"name"`
	Definition json.RawMessage `json:"definition"`
}

type canvasCatalogFunction struct {
	Arguments        []string `json:"arguments"`
	ArgumentNames    []string `json:"argumentNames"`
	DefaultCount     int      `json:"defaultCount"`
	ArgumentDefaults *string  `json:"argumentDefaults"`
	ReturnType       string   `json:"returnType"`
	ReturnsSet       bool     `json:"returnsSet"`
	OutputColumns    []struct {
		Name string `json:"name"`
		Type string `json:"type"`
	} `json:"outputColumns"`
	Language        string    `json:"language"`
	Volatility      string    `json:"volatility"`
	SecurityDefiner bool      `json:"securityDefiner"`
	Strict          bool      `json:"strict"`
	Config          *[]string `json:"config"`
	BodyMD5         string    `json:"bodyMd5"`
}

type canvasCatalogKey struct {
	kind string
	name string
}

var canvasCatalogMutation = regexp.MustCompile(`(?i)\b(?:INSERT|UPDATE|DELETE|ALTER|DROP|TRUNCATE|CREATE|GRANT|REVOKE|COPY|CALL|DO)\b`)
var canvasMD5Pattern = regexp.MustCompile(`^[0-9a-f]{32}$`)
var canvasSHA256Pattern = regexp.MustCompile(`^[0-9a-f]{64}$`)

func validateCanvasSchemaContract(schema CanvasSchemaContract) error {
	invalid := errors.New("canvas contract schema.json is unsupported or incomplete")
	if schema.Contract != "narra.canvas.schema" || schema.Version != canvasContractVersion || schema.Migration == "" || !canvasSHA256Pattern.MatchString(schema.MigrationSHA256) ||
		schema.BodyFingerprint == "" || schema.BodyLineEndings != "CRLF_TO_LF_ONLY" || schema.ExpressionConformance != "contracts/canvas/v1/scenarios/catalog-expressions.json" ||
		!strings.HasPrefix(strings.TrimSpace(schema.CatalogQuery), "WITH ") || canvasCatalogMutation.MatchString(schema.CatalogQuery) || len(schema.Objects) == 0 {
		return invalid
	}
	grammar, err := newCanvasCatalogGrammar(schema)
	if err != nil {
		return invalid
	}
	seen := make(map[canvasCatalogKey]bool, len(schema.Objects))
	for _, object := range schema.Objects {
		key := canvasCatalogKey{object.Kind, object.Name}
		if object.Name == "" || seen[key] || len(object.Definition) == 0 {
			return invalid
		}
		seen[key] = true
		target := canvasCatalogDefinitionTarget(object)
		if target == nil || decodeCanvasContractJSON(object.Definition, target) != nil {
			return invalid
		}
		if object.Kind == "enum" && !canvasUniqueStrings(*target.(*[]string), false) {
			return invalid
		}
		if function, ok := target.(*canvasCatalogFunction); ok {
			if !canvasFunctionDefinitionValid(*function) {
				return invalid
			}
		}
		if _, err := normalizeCanvasCatalogDefinition(object.Definition, grammar); err != nil {
			return invalid
		}
	}
	return nil
}

// These shapes describe pg_catalog output, not a second list of expected
// objects. Names, definitions and the complete query come only from schema.json.
func canvasCatalogDefinitionTarget(object CanvasSchemaCatalogRow) any {
	switch object.Kind {
	case "enum":
		return new([]string)
	case "table":
		return new(struct {
			Kind        string `json:"kind"`
			Persistence string `json:"persistence"`
		})
	case "column":
		return new(struct {
			Type     string  `json:"type"`
			Nullable bool    `json:"nullable"`
			Default  *string `json:"default"`
		})
	case "index":
		return new(struct {
			Table            string   `json:"table"`
			Unique           bool     `json:"unique"`
			Primary          bool     `json:"primary"`
			Valid            bool     `json:"valid"`
			Ready            bool     `json:"ready"`
			Method           string   `json:"method"`
			Columns          []string `json:"columns"`
			Options          []int    `json:"options"`
			Expressions      bool     `json:"expressions"`
			Predicate        bool     `json:"predicate"`
			NullsNotDistinct bool     `json:"nullsNotDistinct"`
			IncludedColumns  int      `json:"includedColumns"`
		})
	case "function":
		return new(canvasCatalogFunction)
	case "trigger":
		return new(struct {
			Table                 string  `json:"table"`
			Function              string  `json:"function"`
			FunctionCurrentSchema bool    `json:"functionCurrentSchema"`
			Type                  int     `json:"type"`
			Enabled               string  `json:"enabled"`
			Deferrable            bool    `json:"deferrable"`
			Deferred              bool    `json:"deferred"`
			Arguments             int     `json:"arguments"`
			Condition             *string `json:"condition"`
		})
	case "constraint":
		var header struct {
			Type string `json:"type"`
		}
		if json.Unmarshal(object.Definition, &header) != nil {
			return nil
		}
		switch header.Type {
		case "c":
			return new(struct {
				Table      string `json:"table"`
				Type       string `json:"type"`
				Deferrable bool   `json:"deferrable"`
				Deferred   bool   `json:"deferred"`
				Validated  bool   `json:"validated"`
				Expression string `json:"expression"`
			})
		case "p", "u":
			return new(struct {
				Table      string   `json:"table"`
				Type       string   `json:"type"`
				Deferrable bool     `json:"deferrable"`
				Deferred   bool     `json:"deferred"`
				Validated  bool     `json:"validated"`
				Columns    []string `json:"columns"`
			})
		case "f":
			return new(struct {
				Table                  string   `json:"table"`
				Type                   string   `json:"type"`
				Deferrable             bool     `json:"deferrable"`
				Deferred               bool     `json:"deferred"`
				Validated              bool     `json:"validated"`
				Columns                []string `json:"columns"`
				ReferenceTable         string   `json:"referenceTable"`
				ReferenceCurrentSchema bool     `json:"referenceCurrentSchema"`
				ReferenceColumns       []string `json:"referenceColumns"`
				DeleteAction           string   `json:"deleteAction"`
				UpdateAction           string   `json:"updateAction"`
				MatchType              string   `json:"matchType"`
			})
		}
	}
	return nil
}

func canvasFunctionDefinitionValid(function canvasCatalogFunction) bool {
	if !canvasMD5Pattern.MatchString(function.BodyMD5) || function.ReturnType == "" || function.Language == "" || function.Volatility == "" ||
		len(function.ArgumentNames) != len(function.Arguments) || !canvasUniqueStrings(function.ArgumentNames, true) ||
		function.DefaultCount < 0 || function.DefaultCount > len(function.Arguments) {
		return false
	}
	for _, argument := range function.Arguments {
		if argument == "" {
			return false
		}
	}
	for _, column := range function.OutputColumns {
		if column.Name == "" || column.Type == "" {
			return false
		}
	}
	if function.DefaultCount == 0 {
		return function.ArgumentDefaults == nil
	}
	return function.ArgumentDefaults != nil && len(strings.Split(*function.ArgumentDefaults, ",")) == function.DefaultCount
}

func normalizeCanvasCatalogDefinition(definition json.RawMessage, grammar canvasCatalogGrammar) (any, error) {
	var value any
	if err := json.Unmarshal(definition, &value); err != nil {
		return nil, err
	}
	return normalizeCanvasCatalogValue(value, "", grammar)
}

func normalizeCanvasCatalogValue(value any, key string, grammar canvasCatalogGrammar) (any, error) {
	switch value := value.(type) {
	case string:
		switch key {
		case "default", "expression":
			return normalizeCanvasCatalogExpression(value, grammar)
		case "argumentDefaults":
			var defaults []string
			for _, item := range strings.Split(value, ",") {
				normalized, err := normalizeCanvasCatalogExpression(item, grammar)
				if err != nil {
					return nil, err
				}
				defaults = append(defaults, normalized)
			}
			return defaults, nil
		}
	case []any:
		for index, item := range value {
			normalized, err := normalizeCanvasCatalogValue(item, "", grammar)
			if err != nil {
				return nil, err
			}
			value[index] = normalized
		}
	case map[string]any:
		for name, item := range value {
			normalized, err := normalizeCanvasCatalogValue(item, name, grammar)
			if err != nil {
				return nil, err
			}
			value[name] = normalized
		}
	}
	return value, nil
}

func sameCanvasCatalogDefinition(actual, expected json.RawMessage, grammar canvasCatalogGrammar) bool {
	normalizedActual, actualErr := normalizeCanvasCatalogDefinition(actual, grammar)
	normalizedExpected, expectedErr := normalizeCanvasCatalogDefinition(expected, grammar)
	return actualErr == nil && expectedErr == nil && reflect.DeepEqual(normalizedActual, normalizedExpected)
}

func canvasSchemaFailure(reason string) SchemaContractReport {
	return SchemaContractReport{
		ContractVersion: canvasContractVersion,
		Issues:          []SchemaIssue{{Kind: "catalog", Name: "canvas", Expected: "canvas contract v1", Actual: reason}},
	}
}

func checkCanvasSchemaInventory(schema CanvasSchemaContract, rows []CanvasSchemaCatalogRow) SchemaContractReport {
	if schema.Version != canvasContractVersion || len(schema.Objects) == 0 {
		return canvasSchemaFailure("invalid_contract")
	}
	grammar, err := newCanvasCatalogGrammar(schema)
	if err != nil {
		return canvasSchemaFailure("invalid_contract")
	}
	if rows == nil {
		return canvasSchemaFailure("invalid_catalog")
	}
	inventory := make(map[canvasCatalogKey][]json.RawMessage, len(rows))
	for _, row := range rows {
		if row.Kind == "" || row.Name == "" || len(row.Definition) == 0 || !json.Valid(row.Definition) {
			return canvasSchemaFailure("invalid_catalog")
		}
		key := canvasCatalogKey{row.Kind, row.Name}
		inventory[key] = append(inventory[key], row.Definition)
	}
	report := SchemaContractReport{ContractVersion: schema.Version, Issues: []SchemaIssue{}}
	for _, expected := range schema.Objects {
		found := inventory[canvasCatalogKey{expected.Kind, expected.Name}]
		reason := ""
		switch {
		case len(found) == 0:
			reason = "missing"
		case len(found) != 1:
			reason = "duplicate"
		case !sameCanvasCatalogDefinition(found[0], expected.Definition, grammar):
			reason = "mismatch"
		}
		if reason != "" {
			report.Issues = append(report.Issues, SchemaIssue{
				Kind: reason + "_" + expected.Kind, Name: expected.Name, Expected: "canvas contract v1", Actual: reason,
			})
		}
	}
	return report
}

type canvasCatalogQuery func(context.Context, string) ([]CanvasSchemaCatalogRow, error)

func checkCanvasSchemaWithQuery(ctx context.Context, schema CanvasSchemaContract, query canvasCatalogQuery) (SchemaContractReport, error) {
	if err := validateCanvasSchemaContract(schema); err != nil {
		return canvasSchemaFailure("invalid_contract"), err
	}
	if query == nil {
		return canvasSchemaFailure("query_failed"), errors.New("canvas schema catalog query unavailable")
	}
	rows, err := query(ctx, schema.CatalogQuery)
	if err != nil {
		// Do not return or log connection strings, SQL or driver diagnostics from
		// this readiness boundary. The report remains unready even if err is ignored.
		return canvasSchemaFailure("query_failed"), errors.New("canvas schema catalog query failed")
	}
	return checkCanvasSchemaInventory(schema, rows), nil
}

func CheckCanvasSchemaContract(ctx context.Context, pool *pgxpool.Pool) (SchemaContractReport, error) {
	contract, err := LoadCanvasContract()
	if err != nil {
		return canvasSchemaFailure("invalid_contract"), err
	}
	if pool == nil {
		return canvasSchemaFailure("query_failed"), errors.New("canvas schema catalog connection unavailable")
	}
	return checkCanvasSchemaWithQuery(ctx, contract.Schema, func(ctx context.Context, query string) ([]CanvasSchemaCatalogRow, error) {
		rows, err := pool.Query(ctx, query)
		if err != nil {
			return nil, err
		}
		defer rows.Close()
		inventory := make([]CanvasSchemaCatalogRow, 0, len(contract.Schema.Objects))
		for rows.Next() {
			var row CanvasSchemaCatalogRow
			if err := rows.Scan(&row.Kind, &row.Name, &row.Definition); err != nil {
				return nil, err
			}
			inventory = append(inventory, row)
		}
		if err := rows.Err(); err != nil {
			return nil, fmt.Errorf("read canvas catalog: %w", err)
		}
		return inventory, nil
	})
}
