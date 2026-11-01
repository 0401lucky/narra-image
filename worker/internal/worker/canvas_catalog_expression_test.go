package worker

import (
	"encoding/json"
	"fmt"
	"strings"
	"testing"
)

func TestCanvasCatalogExpressionSharedScenarios(t *testing.T) {
	contract := loadTestCanvasContract(t)
	grammar, err := newCanvasCatalogGrammar(contract.Schema)
	if err != nil {
		t.Fatal(err)
	}
	var fixture struct {
		Equivalent []struct {
			ID          string          `json:"id"`
			Expressions []string        `json:"expressions"`
			Canonical   json.RawMessage `json:"canonical"`
		} `json:"equivalent"`
		Different []struct {
			ID    string `json:"id"`
			Left  string `json:"left"`
			Right string `json:"right"`
		} `json:"different"`
		Unsupported []string `json:"unsupported"`
	}
	if err := json.Unmarshal(contract.Scenarios["catalog-expressions"], &fixture); err != nil {
		t.Fatal(err)
	}
	if count := len(fixture.Equivalent) + len(fixture.Different) + len(fixture.Unsupported); count != 39 {
		t.Fatalf("got %d shared expression vectors, want all 39", count)
	}
	for _, vector := range fixture.Equivalent {
		t.Run("equivalent/"+vector.ID, func(t *testing.T) {
			var expected any
			if err := json.Unmarshal(vector.Canonical, &expected); err != nil {
				t.Fatal(err)
			}
			canonical, err := marshalCanvasCatalogJSON(expected)
			if err != nil {
				t.Fatal(err)
			}
			for _, input := range vector.Expressions {
				actual, err := normalizeCanvasCatalogExpression(input, grammar)
				if err != nil || actual != string(canonical) {
					t.Errorf("%q -> %q, %v; want %s", input, actual, err, canonical)
				}
			}
		})
	}
	for _, vector := range fixture.Different {
		t.Run("different/"+vector.ID, func(t *testing.T) {
			left, err := normalizeCanvasCatalogExpression(vector.Left, grammar)
			if err != nil {
				t.Fatal(err)
			}
			right, err := normalizeCanvasCatalogExpression(vector.Right, grammar)
			if err != nil {
				t.Fatal(err)
			}
			if left == right {
				t.Fatalf("meaningful expression difference was discarded: %q and %q", vector.Left, vector.Right)
			}
		})
	}
	for index, expression := range fixture.Unsupported {
		t.Run(fmt.Sprintf("unsupported/%d", index), func(t *testing.T) {
			if value, err := normalizeCanvasCatalogExpression(expression, grammar); err == nil {
				t.Fatalf("unsupported %q normalized to %s", expression, value)
			}
			rows := cloneCanvasCatalogRows(contract.Schema.Objects)
			changeCanvasCatalogDefinition(t, rows, "constraint", "CanvasRun_intent_check", "expression", expression)
			if report := checkCanvasSchemaInventory(contract.Schema, rows); report.Ready() {
				t.Fatalf("unsupported %q made schema ready", expression)
			}
		})
	}
}

func TestCanvasCatalogExpressionBoundsAndQuotedData(t *testing.T) {
	contract := loadTestCanvasContract(t)
	grammar, err := newCanvasCatalogGrammar(contract.Schema)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := normalizeCanvasCatalogExpression("a"+strings.Repeat(" ", canvasCatalogExpressionLimit-1), grammar); err != nil {
		t.Fatalf("exact expression limit should be accepted: %v", err)
	}
	for _, value := range []string{"a" + strings.Repeat(" ", canvasCatalogExpressionLimit), "'" + strings.Repeat("\U0001F600", canvasCatalogExpressionLimit/2) + "'", string([]byte{0xff})} {
		if _, err := normalizeCanvasCatalogExpression(value, grammar); err == nil {
			t.Fatal("oversized/invalid UTF-8 expression was accepted")
		}
	}
	for _, value := range []string{
		`a -- comment`, `a /* comment */`, `"sha256" !~~ 'x'`, `1 - 0`, `1 / 1`, `length(a,b)`, `length()`, `clock_timestamp(1)`,
		`"CLOCK_TIMESTAMP"()`, `'x'::"TEXT"`, `NULL::boolean`, `ARRAY['x']::"CanvasRunState"[]`, `a = ANY(ARRAY[])`, `a <> ANY(ARRAY[1])`,
	} {
		if _, err := normalizeCanvasCatalogExpression(value, grammar); err == nil {
			t.Errorf("unsupported %q was accepted", value)
		}
	}
	for _, value := range []string{`'x; -- /* not SQL */'`, `"a.b"`, "'line\rone\nline two'", "\uFEFF true \u00A0"} {
		if _, err := normalizeCanvasCatalogExpression(value, grammar); err != nil {
			t.Errorf("quoted/whitespace data %q was rejected: %v", value, err)
		}
	}
	if _, err := normalizeCanvasCatalogExpression("true\u0085", grammar); err == nil {
		t.Fatal("NEL is not ECMAScript catalog whitespace")
	}
}

func TestCanvasCatalogExpressionCastKnowledgeComesFromInventory(t *testing.T) {
	contract := loadTestCanvasContract(t)
	schema := contract.Schema
	schema.Objects = cloneCanvasCatalogRows(schema.Objects)
	schema.Objects = append(schema.Objects,
		CanvasSchemaCatalogRow{Kind: "column", Name: "Canvas.futureText", Definition: json.RawMessage(`{"type":"character varying(40)","nullable":false,"default":null}`)},
		CanvasSchemaCatalogRow{Kind: "enum", Name: "FutureCanvasEnum", Definition: json.RawMessage(`["LABEL"]`)},
	)
	grammar, err := newCanvasCatalogGrammar(schema)
	if err != nil {
		t.Fatal(err)
	}
	for _, expression := range []string{`"futureText"::text`, `'LABEL'::"FutureCanvasEnum"`, `NULL::"FutureCanvasEnum"`} {
		if _, err := normalizeCanvasCatalogExpression(expression, grammar); err != nil {
			t.Fatalf("shared inventory cast %q rejected: %v", expression, err)
		}
	}
	changeCanvasCatalogDefinition(t, schema.Objects, "column", "CanvasImportAsset.mimeType", "type", "integer")
	grammar, err = newCanvasCatalogGrammar(schema)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := normalizeCanvasCatalogExpression(`"mimeType"::text`, grammar); err == nil {
		t.Fatal("removed text type was still trusted through a copied column list")
	}
	if _, err := normalizeCanvasCatalogExpression(`'INVALID'::"FutureCanvasEnum"`, grammar); err == nil {
		t.Fatal("unknown enum label was erased as an innocent cast")
	}
}
