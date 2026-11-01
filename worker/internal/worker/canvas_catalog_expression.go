package worker

import (
	"bytes"
	"encoding/json"
	"errors"
	"regexp"
	"slices"
	"strings"
	"unicode/utf8"
)

const canvasCatalogExpressionLimit = 32768

var errCanvasCatalogExpression = errors.New("unsupported canvas catalog expression")
var canvasTextColumnType = regexp.MustCompile(`^(?:text|character(?: varying)?\([0-9]+\))$`)

type canvasCatalogExpression []any

type canvasCatalogToken struct {
	kind  string
	value string
}

type canvasCatalogGrammar struct {
	textColumns map[string]bool
	enums       map[string][]string
}

func newCanvasCatalogGrammar(schema CanvasSchemaContract) (canvasCatalogGrammar, error) {
	grammar := canvasCatalogGrammar{make(map[string]bool), make(map[string][]string)}
	for _, object := range schema.Objects {
		switch object.Kind {
		case "column":
			var column struct {
				Type string `json:"type"`
			}
			if err := json.Unmarshal(object.Definition, &column); err != nil {
				return canvasCatalogGrammar{}, errCanvasCatalogExpression
			}
			if canvasTextColumnType.MatchString(column.Type) {
				_, name, found := strings.Cut(object.Name, ".")
				if !found || name == "" {
					return canvasCatalogGrammar{}, errCanvasCatalogExpression
				}
				grammar.textColumns[name] = true
			}
		case "enum":
			var labels []string
			if err := json.Unmarshal(object.Definition, &labels); err != nil {
				return canvasCatalogGrammar{}, errCanvasCatalogExpression
			}
			grammar.enums[object.Name] = labels
		}
	}
	return grammar, nil
}

func tokenizeCanvasCatalogExpression(value string) ([]canvasCatalogToken, error) {
	if !utf8.ValidString(value) {
		return nil, errCanvasCatalogExpression
	}
	characters := 0
	for _, character := range value {
		characters++
		if character > 0xFFFF {
			characters++
		}
		if characters > canvasCatalogExpressionLimit {
			return nil, errCanvasCatalogExpression
		}
	}
	var tokens []canvasCatalogToken
	for offset := 0; offset < len(value); {
		character, size := utf8.DecodeRuneInString(value[offset:])
		if canvasWhitespace(character) {
			offset += size
			continue
		}
		start := offset
		switch {
		case value[offset] == '\'' || value[offset] == '"':
			quote := value[offset]
			offset++
			var decoded strings.Builder
			closed := false
			for offset < len(value) {
				if value[offset] != quote {
					decoded.WriteByte(value[offset])
					offset++
					continue
				}
				offset++
				if offset < len(value) && value[offset] == quote {
					decoded.WriteByte(quote)
					offset++
					continue
				}
				closed = true
				break
			}
			if !closed {
				return nil, errCanvasCatalogExpression
			}
			kind := "string"
			if quote == '"' {
				kind = "identifier"
			}
			tokens = append(tokens, canvasCatalogToken{kind, decoded.String()})
		case value[offset] >= '0' && value[offset] <= '9':
			for offset < len(value) && value[offset] >= '0' && value[offset] <= '9' {
				offset++
			}
			number := strings.TrimLeft(value[start:offset], "0")
			if number == "" {
				number = "0"
			}
			tokens = append(tokens, canvasCatalogToken{"number", number})
		case canvasNameStart(value[offset]):
			for offset < len(value) && (canvasNameStart(value[offset]) || (value[offset] >= '0' && value[offset] <= '9')) {
				offset++
			}
			tokens = append(tokens, canvasCatalogToken{"name", strings.ToLower(value[start:offset])})
		default:
			matched := false
			for _, symbol := range []string{"::", "<=", ">=", "<>", "!=", "!~*", "!~", "~*", "~", "=", "<", ">", "(", ")", "[", "]", ","} {
				if strings.HasPrefix(value[offset:], symbol) {
					tokens = append(tokens, canvasCatalogToken{"symbol", symbol})
					offset += len(symbol)
					matched = true
					break
				}
			}
			if !matched {
				return nil, errCanvasCatalogExpression
			}
		}
	}
	return tokens, nil
}

func canvasNameStart(value byte) bool {
	return value == '_' || (value >= 'a' && value <= 'z') || (value >= 'A' && value <= 'Z')
}

func normalizeCanvasCatalogExpression(value string, grammar canvasCatalogGrammar) (string, error) {
	tokens, err := tokenizeCanvasCatalogExpression(value)
	if err != nil {
		return "", err
	}
	parser := canvasCatalogParser{tokens: tokens, grammar: grammar}
	expression, err := parser.or()
	if err != nil || parser.cursor != len(tokens) {
		return "", errCanvasCatalogExpression
	}
	data, err := marshalCanvasCatalogJSON(expression)
	return string(data), err
}

type canvasCatalogParser struct {
	tokens  []canvasCatalogToken
	cursor  int
	grammar canvasCatalogGrammar
}

func (p *canvasCatalogParser) is(value string) bool {
	return p.cursor < len(p.tokens) && (p.tokens[p.cursor].kind == "name" || p.tokens[p.cursor].kind == "symbol") && p.tokens[p.cursor].value == value
}

func (p *canvasCatalogParser) accept(value string) bool {
	if !p.is(value) {
		return false
	}
	p.cursor++
	return true
}

func (p *canvasCatalogParser) primary() (canvasCatalogExpression, error) {
	var expression canvasCatalogExpression
	switch {
	case p.accept("("):
		var err error
		expression, err = p.or()
		if err != nil || !p.accept(")") {
			return nil, errCanvasCatalogExpression
		}
	case p.accept("array"):
		if !p.accept("[") {
			return nil, errCanvasCatalogExpression
		}
		items, err := p.primaryList("]")
		if err != nil {
			return nil, err
		}
		expression = append(canvasCatalogExpression{"array"}, items...)
	default:
		if p.cursor >= len(p.tokens) {
			return nil, errCanvasCatalogExpression
		}
		token := p.tokens[p.cursor]
		p.cursor++
		switch {
		case token.kind == "string" || token.kind == "number":
			expression = canvasCatalogExpression{token.kind, token.value}
		case token.kind == "name" && slices.Contains([]string{"true", "false", "null"}, token.value):
			expression = canvasCatalogExpression{"literal", token.value}
		case token.kind == "name" || token.kind == "identifier":
			if !p.accept("(") {
				expression = canvasCatalogExpression{"id", token.value}
				break
			}
			var args []any
			if !p.accept(")") {
				var err error
				args, err = p.primaryList(")")
				if err != nil {
					return nil, err
				}
			}
			if !((token.value == "clock_timestamp" && len(args) == 0) || (token.value == "length" && len(args) == 1)) {
				return nil, errCanvasCatalogExpression
			}
			expression = append(canvasCatalogExpression{"call", token.value}, args...)
		default:
			return nil, errCanvasCatalogExpression
		}
	}
	for p.accept("::") {
		if p.cursor >= len(p.tokens) {
			return nil, errCanvasCatalogExpression
		}
		typeToken := p.tokens[p.cursor]
		p.cursor++
		if typeToken.kind != "name" && typeToken.kind != "identifier" {
			return nil, errCanvasCatalogExpression
		}
		typeName := typeToken.value
		if typeToken.kind == "name" && typeName == "character" {
			if !p.accept("varying") {
				return nil, errCanvasCatalogExpression
			}
			typeName += " varying"
		}
		array := p.accept("[")
		if array && !p.accept("]") {
			return nil, errCanvasCatalogExpression
		}
		if !p.grammar.allowedCast(expression, typeName, array) {
			return nil, errCanvasCatalogExpression
		}
	}
	return expression, nil
}

func (p *canvasCatalogParser) primaryList(end string) ([]any, error) {
	var items []any
	for {
		item, err := p.primary()
		if err != nil {
			return nil, err
		}
		items = append(items, item)
		if !p.accept(",") {
			break
		}
	}
	if !p.accept(end) {
		return nil, errCanvasCatalogExpression
	}
	return items, nil
}

func (g canvasCatalogGrammar) allowedCast(expression canvasCatalogExpression, typeName string, array bool) bool {
	text := typeName == "text" || typeName == "character varying"
	if array {
		if !text || expression[0] != "array" {
			return false
		}
		for _, item := range expression[1:] {
			child, ok := item.(canvasCatalogExpression)
			if !ok || child[0] != "string" {
				return false
			}
		}
		return true
	}
	if text && (expression[0] == "string" || (expression[0] == "id" && g.textColumns[expression[1].(string)])) {
		return true
	}
	labels, enum := g.enums[typeName]
	if expression[0] == "literal" && expression[1] == "null" && (text || enum) {
		return true
	}
	return expression[0] == "string" && enum && slices.Contains(labels, expression[1].(string))
}

func canvasBooleanExpression(operator string, left, right canvasCatalogExpression) canvasCatalogExpression {
	var expression canvasCatalogExpression
	if left[0] == operator {
		expression = left
	} else {
		expression = canvasCatalogExpression{operator, left}
	}
	if right[0] == operator {
		return append(expression, right[1:]...)
	}
	return append(expression, right)
}

func (p *canvasCatalogParser) comparison() (canvasCatalogExpression, error) {
	left, err := p.primary()
	if err != nil {
		return nil, err
	}
	if p.accept("is") {
		negated := p.accept("not")
		if !p.accept("null") {
			return nil, errCanvasCatalogExpression
		}
		tag := "is-null"
		if negated {
			tag = "is-not-null"
		}
		return canvasCatalogExpression{tag, left}, nil
	}
	if p.accept("between") {
		lower, err := p.primary()
		if err != nil || !p.accept("and") {
			return nil, errCanvasCatalogExpression
		}
		upper, err := p.primary()
		if err != nil {
			return nil, err
		}
		return canvasBooleanExpression("and", canvasCatalogExpression{">=", left, lower}, canvasCatalogExpression{"<=", left, upper}), nil
	}
	negated := p.accept("not")
	if negated || p.is("in") {
		if !p.accept("in") || !p.accept("(") {
			return nil, errCanvasCatalogExpression
		}
		items, err := p.primaryList(")")
		if err != nil {
			return nil, err
		}
		tag := "in"
		if negated {
			tag = "not-in"
		}
		return append(canvasCatalogExpression{tag, left}, items...), nil
	}
	if p.cursor >= len(p.tokens) || p.tokens[p.cursor].kind != "symbol" || !slices.Contains([]string{"=", "<>", "!=", "<", ">", "<=", ">=", "~", "!~", "~*", "!~*"}, p.tokens[p.cursor].value) {
		return left, nil
	}
	operator := p.tokens[p.cursor].value
	p.cursor++
	if operator == "!=" {
		operator = "<>"
	}
	if (operator == "=" && p.accept("any")) || (operator == "<>" && p.accept("all")) {
		if !p.accept("(") {
			return nil, errCanvasCatalogExpression
		}
		array, err := p.primary()
		if err != nil || array[0] != "array" || !p.accept(")") {
			return nil, errCanvasCatalogExpression
		}
		tag := "in"
		if operator == "<>" {
			tag = "not-in"
		}
		return append(canvasCatalogExpression{tag, left}, array[1:]...), nil
	}
	right, err := p.primary()
	if err != nil {
		return nil, err
	}
	return canvasCatalogExpression{operator, left, right}, nil
}

func (p *canvasCatalogParser) not() (canvasCatalogExpression, error) {
	if p.accept("not") {
		expression, err := p.not()
		if err != nil {
			return nil, err
		}
		return canvasCatalogExpression{"not", expression}, nil
	}
	return p.comparison()
}

func (p *canvasCatalogParser) and() (canvasCatalogExpression, error) {
	expression, err := p.not()
	if err != nil {
		return nil, err
	}
	for p.accept("and") {
		right, err := p.not()
		if err != nil {
			return nil, err
		}
		expression = canvasBooleanExpression("and", expression, right)
	}
	return expression, nil
}

func (p *canvasCatalogParser) or() (canvasCatalogExpression, error) {
	expression, err := p.and()
	if err != nil {
		return nil, err
	}
	for p.accept("or") {
		right, err := p.and()
		if err != nil {
			return nil, err
		}
		expression = canvasBooleanExpression("or", expression, right)
	}
	return expression, nil
}

func marshalCanvasCatalogJSON(value any) ([]byte, error) {
	var output bytes.Buffer
	encoder := json.NewEncoder(&output)
	encoder.SetEscapeHTML(false)
	if err := encoder.Encode(value); err != nil {
		return nil, err
	}
	return bytes.TrimSuffix(output.Bytes(), []byte("\n")), nil
}
